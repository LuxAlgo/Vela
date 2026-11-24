// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';
import { Vela } from '../src/Vela';
import { registerNativeIndicator, unregisterNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { Batch } from '../src/renderers/native/backend/gl/Batch';
import { WebGL2Backend } from '../src/renderers/native/backend/WebGL2Backend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { SymbolPicker } from '../src/widget/symbol-picker';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function makeBars(n: number, base = 100): OHLCV[] {
    return Array.from({ length: n }, (_, i) => ({
        time: T0 + i * HOUR,
        open: base + i,
        high: base + i + 2,
        low: base + i - 2,
        close: base + i,
        volume: 100,
    }));
}

function fakeRenderer(): IChartRenderer {
    return {
        name: 'fake',
        features: [],
        capabilities: {
            panes: true,
            paneManagement: false,
            fills: 'primitive',
            bgcolor: 'primitive',
            hline: 'native',
            markers: true,
            barcolor: 'approximated',
            perPointColor: true,
            drawings: true,
            userDrawings: false,
            tables: true,
            inputsUI: true,
        },
        mount: () => {},
        setTheme: () => {},
        resize: () => {},
        applyFeature: () => {},
        readFeature: () => undefined,
        destroy: () => {},
        setBars: () => {},
        updateBar: () => {},
        ensurePane: () => {},
        removePane: () => {},
        mountIndicator: (m) => ({ id: m.id }),
        updateIndicator: () => {},
        removeIndicator: () => {},
        setIndicatorInputs: () => {},
        setIndicatorVisible: () => {},
        onInputChange: () => () => {},
        onRemoveIndicator: () => () => {},
        onToggleIndicatorVisible: () => () => {},
        onCrosshairMove: () => () => {},
        onClick: () => () => {},
        getVisibleRange: () => null,
        setVisibleRange: () => {},
        onViewportChange: () => () => {},
    };
}

describe('WebGL2Backend crossing fill triangulation', () => {
    it('splits crossing ribbons into two non-overlapping triangles meeting at the intersection', () => {
        const backend = new WebGL2Backend();
        const b = new Batch();
        const triSpy = vi.spyOn(b, 'tri');
        const quadSpy = vi.spyOn(b, 'quad');

        const scene = new SceneGraph();
        scene.bars = makeBars(3, 100);
        const pane = scene.ensurePane('price', 'price', 0, 1);
        pane.bounds = { top: 0, height: 100 };
        pane.scale = { min: 0, max: 100 };

        const coords = new CoordinateSystem();
        coords.setSize(300, 100, 1);
        coords.setBars(scene.bars.map((bar) => bar.time));

        // Bar 0 → Bar 1: series A drops from 80 to 20, series B rises from 20 to 80 → crosses at midpoint y = 50.
        // Bar 1 → Bar 2: A stays below B (20→10 vs 80→90) → non-crossing quad.
        const model: IndicatorModel = {
            id: 'ichi',
            title: 'Ichimoku',
            overlay: true,
            paneHint: 'price',
            paneId: 'price',
            series: [
                {
                    id: 'a',
                    title: 'A',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: T0, value: 80 },
                        { time: T0 + HOUR, value: 20 },
                        { time: T0 + 2 * HOUR, value: 10 },
                    ],
                    style: { color: '#00ff00', width: 1, lineStyle: 'solid' },
                },
                {
                    id: 'b',
                    title: 'B',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: T0, value: 20 },
                        { time: T0 + HOUR, value: 80 },
                        { time: T0 + 2 * HOUR, value: 90 },
                    ],
                    style: { color: '#ff0000', width: 1, lineStyle: 'solid' },
                },
            ],
            fills: [{ id: 'cloud', paneId: 'price', fromSeriesId: 'a', toSeriesId: 'b', color: '#00ff0040' }],
            backgrounds: [],
            priceLines: [],
            inputs: [],
            inputValues: {},
        };

        (backend as unknown as { emitFill: (...args: unknown[]) => void }).emitFill(b, model, model.fills[0], pane, coords, 0, 2, 0);

        // Segment 0→1 crossed: emitted two triangles meeting at the exact midpoint (xCross, yCross).
        expect(triSpy).toHaveBeenCalledTimes(2);
        const x0 = coords.logicalToX(0);
        const x1 = coords.logicalToX(1);
        const xMid = (x0 + x1) / 2;
        const yMid = coords.priceToY(50, pane.scale, pane.bounds);
        expect(triSpy.mock.calls[0]![3]).toBeCloseTo(xMid, 6);
        expect(triSpy.mock.calls[0]![4]).toBeCloseTo(yMid, 6);
        expect(triSpy.mock.calls[1]![0]).toBeCloseTo(xMid, 6);
        expect(triSpy.mock.calls[1]![1]).toBeCloseTo(yMid, 6);
        // Segment 1→2 did not cross: emitted one plain quad.
        expect(quadSpy).toHaveBeenCalledTimes(1);
    });
});

describe('EngineOrchestrator NativeIndicatorContext secondary series seam', () => {
    const TYPE = '__test-secondary-native';

    afterEach(() => {
        unregisterNativeIndicator(TYPE);
    });

    it('routes fetchSeries and subscribeSeries through the feed and tears down subscriptions on remove', async () => {
        const primaryBars = makeBars(10, 100);
        const secondaryBars = makeBars(10, 200);
        const loadRangeCalls: Array<{ symbol: string; range: BarRange }> = [];
        let secondaryCb: ((bar: OHLCV) => void) | null = null;
        let unsubscribed = false;

        const feed: MarketDataFeed = {
            load: async (cfg) => (cfg.symbol === 'ETHUSDT' ? secondaryBars : primaryBars),
            loadRange: async (cfg, range) => {
                loadRangeCalls.push({ symbol: cfg.symbol ?? '', range });
                return cfg.symbol === 'ETHUSDT' ? secondaryBars : primaryBars;
            },
            subscribe: (cfg, cb) => {
                if (cfg.symbol === 'ETHUSDT') {
                    secondaryCb = cb;
                    return () => { unsubscribed = true; };
                }
                return () => {};
            },
        };

        let fetched: OHLCV[] = [];
        const liveReceived: OHLCV[] = [];

        registerNativeIndicator({
            type: TYPE,
            title: 'Test Secondary',
            paneHint: 'new',
            overlay: false,
            inputsSchema: () => [],
            defaultInputs: () => ({}),
            create: () => ({
                start(ctx) {
                    void ctx.fetchSeries?.('ETHUSDT', ctx.timeframe, { from: T0, to: T0 + 10 * HOUR }).then((b) => {
                        fetched = b;
                    });
                    ctx.subscribeSeries?.('ETHUSDT', ctx.timeframe, (bar) => liveReceived.push(bar));
                    ctx.emit({ series: [] });
                },
                onBars() {},
                onViewport() {},
                setInputs() {},
                suspend() {},
                resume() {},
                stop() {},
            }),
        });

        const chart = new Vela(
            document.createElement('div'),
            { symbol: 'BTCUSDT', timeframe: '60', live: true, volume: false },
            { renderer: fakeRenderer(), dataFeed: feed },
        );
        await chart.ready();

        const handle = chart.addNativeIndicator(TYPE);
        await new Promise((r) => setTimeout(r, 0));

        expect(loadRangeCalls.some((c) => c.symbol === 'ETHUSDT')).toBe(true);
        expect(fetched).toHaveLength(10);
        expect(secondaryCb).not.toBeNull();

        secondaryCb!({ time: T0 + 10 * HOUR, open: 210, high: 212, low: 208, close: 211, volume: 50 });
        expect(liveReceived).toHaveLength(1);

        // Removing the indicator revokes the context and unsubscribes secondary feeds automatically.
        handle.remove();
        expect(unsubscribed).toBe(true);
        secondaryCb!({ time: T0 + 11 * HOUR, open: 211, high: 213, low: 209, close: 212, volume: 50 });
        expect(liveReceived).toHaveLength(1);
        chart.destroy();
    });

    it('propagates updated fills through ValuePatch when an async indicator resolves after initial mount', async () => {
        const primaryBars = makeBars(25, 100);
        const secondaryBars = makeBars(25, 200);
        const feed: MarketDataFeed = {
            load: async (cfg) => (cfg.symbol === 'ETHUSDT' ? secondaryBars : primaryBars),
            loadRange: async (cfg) => (cfg.symbol === 'ETHUSDT' ? secondaryBars : primaryBars),
            subscribe: () => () => {},
        };

        const patches: Array<{ fills?: unknown[] }> = [];
        const renderer = fakeRenderer();
        const origUpdate = renderer.updateIndicator.bind(renderer);
        renderer.updateIndicator = (handle, patch) => {
            if (patch.kind === 'value') patches.push({ fills: patch.fills });
            origUpdate(handle, patch);
        };

        const chart = new Vela(
            document.createElement('div'),
            { symbol: 'BTCUSDT', timeframe: '60', live: false, volume: false },
            { renderer, dataFeed: feed },
        );
        await chart.ready();

        const handle = chart.addNativeIndicator('correlation-coefficient', { inputs: { symbol: 'ETHUSDT', length: 10 } });
        await new Promise((r) => setTimeout(r, 10));

        expect(patches.length).toBeGreaterThan(0);
        const lastFills = patches[patches.length - 1]!.fills as Array<{ colors?: Array<string | null> }> | undefined;
        expect(lastFills).toHaveLength(1);
        expect(lastFills![0]!.colors?.[24]).toMatch(/^#[0-9a-f]{6}33$/i);

        handle.remove();
        chart.destroy();
    });
});

describe('SymbolPicker one-shot pick override', () => {
    it('routes selection to the one-shot onSelect callback without triggering the default chart switcher', async () => {
        if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
        const host = document.createElement('div');
        document.body.appendChild(host);
        const mainSelected: string[] = [];
        const pickSelected: string[] = [];
        const openStates: Array<{ open: boolean; picking: boolean }> = [];

        const picker = new SymbolPicker({
            host,
            onSelect: (s) => mainSelected.push(s),
            onOpenChange: (open) => openStates.push({ open, picking: picker.isPicking }),
        });
        picker.setSource(() => [
            { ticker: 'BTCUSDT', description: 'BTC / USDT', type: 'crypto', provider: 'binance', prefix: 'BINANCE' },
            { ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto', provider: 'binance', prefix: 'BINANCE' },
        ]);

        picker.open('ETH', { onSelect: (s) => pickSelected.push(s) });
        await new Promise((r) => setTimeout(r, 0));
        expect(picker.isPicking).toBe(true);
        expect(openStates[0]).toEqual({ open: true, picking: true });

        const row = host.querySelector<HTMLElement>('.vela-sp-row[data-ticker="ETHUSDT"]');
        expect(row).not.toBeNull();
        row!.click();
        await new Promise((r) => setTimeout(r, 0));

        expect(pickSelected).toEqual(['BINANCE:ETHUSDT']);
        expect(mainSelected).toEqual([]);
        expect(picker.isPicking).toBe(false);

        // Subsequent plain open restores default main-chart selection behavior.
        picker.open('BTC');
        await new Promise((r) => setTimeout(r, 0));
        expect(picker.isPicking).toBe(false);
        const btcRow = host.querySelector<HTMLElement>('.vela-sp-row[data-ticker="BTCUSDT"]');
        expect(btcRow).not.toBeNull();
        btcRow!.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(mainSelected).toEqual(['BINANCE:BTCUSDT']);

        picker.destroy();
        host.remove();
    });
});
