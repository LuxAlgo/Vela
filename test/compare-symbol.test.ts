import { describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    VisibleRange,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
} from '../src/core/ports/IChartRenderer';
import type { DataProvider, ProviderInfo, SymbolDescriptor } from '../src/core/ports/DataProvider';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { LineLikeSeries } from '../src/core/model/series';
import type { Pane } from '../src/core/model/scene';
import type { ScenePatch } from '../src/core/model/patch';
import type { VelaTheme } from '../src/core/options';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';
import { SceneGraph, percentScaleForModel } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { computePaneScale } from '../src/renderers/native/core/autoscale';
import { TOPBAR_BUILTIN_IDS, TOPBAR_DEFAULT_LEFT } from '../src/widget/topbar-composition';
import { OVERRIDABLE_TOPBAR_IDS } from '../src/widget/contributions';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function seriesBars(closes: readonly number[], startMs = 1_700_000_000_000, stepMs = 3_600_000): OHLCV[] {
    return closes.map((c, i) => ({
        time: startMs + i * stepMs,
        open: c,
        high: c * 1.01,
        low: c * 0.99,
        close: c,
        volume: 100,
    }));
}

class FakeRenderer implements IChartRenderer {
    readonly name = 'fake';
    readonly capabilities: RendererCapabilities = {
        panes: true,
        paneManagement: true,
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
    };
    bars: OHLCV[] = [];
    symbolName: string | undefined;
    readonly models = new Map<string, IndicatorModel>();
    readonly panes = new Map<string, Pane>();

    mount(_container: HTMLElement, _theme: VelaTheme): void {}
    setTheme(_theme: VelaTheme): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[]): void {
        this.bars = bars.slice();
    }
    updateBar(bar: OHLCV): void {
        const last = this.bars[this.bars.length - 1];
        if (last && last.time === bar.time) this.bars[this.bars.length - 1] = bar;
        else this.bars.push(bar);
    }
    setSymbolName(name: string | undefined): void {
        this.symbolName = name;
    }
    ensurePane(pane: Pane): void {
        this.panes.set(pane.id, pane);
    }
    removePane(id: string): void {
        this.panes.delete(id);
    }
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        this.models.set(model.id, structuredClone(model));
        return { id: model.id };
    }
    updateIndicator(handle: IndicatorRenderHandle, patch: ScenePatch): void {
        const m = this.models.get(handle.id);
        if (!m || patch.kind !== 'value') return;
        for (const delta of patch.series) {
            const s = m.series.find((x) => x.id === delta.seriesId);
            if (s && delta.kind === 'points' && 'points' in s) s.points = delta.points;
        }
    }
    removeIndicator(handle: IndicatorRenderHandle): void {
        this.models.delete(handle.id);
    }
    setIndicatorVisible(_handle: IndicatorRenderHandle, _visible: boolean): void {}
    setIndicatorInputs(_handle: IndicatorRenderHandle, _values: Record<string, InputValue>): void {}
    setIndicatorPane(handle: IndicatorRenderHandle, paneId: string, opts?: { ownScale?: boolean }): void {
        const m = this.models.get(handle.id);
        if (m) {
            m.paneId = paneId;
            m.ownScale = opts?.ownScale === true;
        }
    }
    getVisibleRange(): VisibleRange | null {
        return null;
    }
    setVisibleRange(_range: VisibleRange): void {}
    panBy(_fraction: number): void {}
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe {
        return () => {};
    }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe {
        return () => {};
    }
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe {
        return () => {};
    }
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe {
        return () => {};
    }
    onIndicatorVisibilityChange(_cb: (id: string, visible: boolean) => void): Unsubscribe {
        return () => {};
    }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe {
        return () => {};
    }
    readonly features: readonly string[] = ['scaleMode', 'logScale'];
    private feat = new Map<string, unknown>([
        ['scaleMode', 'price'],
        ['logScale', false],
    ]);
    applyFeature(name: string, value: unknown): boolean {
        this.feat.set(name, value);
        return true;
    }
    readFeature(name: string): unknown {
        return this.feat.get(name);
    }
}

class MultiSymbolProvider implements DataProvider {
    private readonly subs = new Map<string, Set<(bar: OHLCV) => void>>();

    constructor(private readonly data: Record<string, OHLCV[]>) {}

    info(): ProviderInfo {
        return {
            name: 'mock',
            displayName: 'Mock',
            capabilities: { enumerate: true, stream: true, symbolInfo: false },
        };
    }

    async listSymbols(): Promise<SymbolDescriptor[]> {
        return Object.keys(this.data).map((ticker) => ({ ticker, provider: 'mock', prefix: 'MOCK', type: 'stock' }));
    }

    async getBars(symbol: string): Promise<OHLCV[]> {
        const key = symbol.replace(/^[^:]+:/, '');
        return (this.data[key] ?? []).slice();
    }

    subscribe(symbol: string, _tf: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        const key = symbol.replace(/^[^:]+:/, '');
        let set = this.subs.get(key);
        if (!set) {
            set = new Set();
            this.subs.set(key, set);
        }
        set.add(onBar);
        return () => set!.delete(onBar);
    }

    pushLive(ticker: string, bar: OHLCV): void {
        for (const cb of this.subs.get(ticker) ?? []) cb(bar);
    }
}

describe('per-series percent/indexed normalization', () => {
    it('rebases percentBaseline:"own" models to their own first visible bar while keeping pane-baseline studies in main units', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0);
        pane.bounds = { top: 0, height: 200 };
        scene.scaleMode = 'percent';
        pane.percentBaseline = 100; // AAPL starts at $100

        const aapl = seriesBars([100, 105, 110]); // 0% -> +5% -> +10%
        const orclModel: IndicatorModel = {
            id: 'cmp-orcl',
            title: 'ORCL · MOCK',
            overlay: true,
            paneHint: 'price',
            paneId: 'price',
            percentBaseline: 'own',
            priceAxisLabel: true,
            series: [
                {
                    id: 'orcl-line',
                    title: 'ORCL',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: aapl[0]!.time, value: 50 }, // 0%
                        { time: aapl[1]!.time, value: 45 }, // -10%
                        { time: aapl[2]!.time, value: 40 }, // -20% (rebased equivalent: 80 in AAPL space)
                    ],
                    style: { color: '#3b82f6', width: 2, lineStyle: 'solid' },
                },
            ],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: [],
            inputValues: {},
        };
        const emaModel: IndicatorModel = {
            id: 'ema-20',
            title: 'EMA',
            overlay: true,
            paneHint: 'price',
            paneId: 'price',
            series: [
                {
                    id: 'ema-line',
                    title: 'EMA',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: aapl[0]!.time, value: 95 }, // -5% in AAPL units
                        { time: aapl[1]!.time, value: 98 },
                        { time: aapl[2]!.time, value: 102 },
                    ],
                    style: { color: '#f59e0b', width: 1, lineStyle: 'solid' },
                },
            ],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: [],
            inputValues: {},
        };

        scene.indicators.set(orclModel.id, orclModel);
        scene.indicators.set(emaModel.id, emaModel);
        scene.modelPercentBaselines.set(orclModel.id, 50);

        // Autoscale folds ORCL's -20% (rebased to 80 in AAPL space) even though AAPL never drops below ~99.
        const valueScaleOf = (id: string): number => {
            const own = scene.modelPercentBaselines.get(id);
            return own ? pane.percentBaseline / own : 1;
        };
        pane.scale = computePaneScale([orclModel, emaModel], aapl, true, 0, 2, null, false, () => 0, { top: 0, bottom: 0 }, valueScaleOf);
        expect(pane.scale.min).toBeCloseTo(80, 6);
        expect(pane.scale.max).toBeCloseTo(aapl[2]!.high, 6);

        const coords = new CoordinateSystem();
        const yMain0 = coords.priceToY(100, pane.scale, pane.bounds);
        const yOrcl0 = coords.priceToY(50, scene.scaleFor(orclModel, pane), pane.bounds);
        expect(yOrcl0).toBeCloseTo(yMain0, 6); // both start at 0.00%

        const yMainMinus20 = coords.priceToY(80, pane.scale, pane.bounds);
        const yOrclMinus20 = coords.priceToY(40, scene.scaleFor(orclModel, pane), pane.bounds);
        expect(yOrclMinus20).toBeCloseTo(yMainMinus20, 6); // -20% lines up identically

        // Standard indicator (EMA) stays in AAPL's units: 95 sits at -5%, below 100 (0%).
        const yEma0 = coords.priceToY(95, scene.scaleFor(emaModel, pane), pane.bounds);
        expect(yEma0).toBeGreaterThan(yMain0);

        // Model-aware percent descriptor hands ORCL its own baseline and EMA the pane's baseline.
        expect(percentScaleForModel(scene, pane, orclModel)).toEqual({ baseline: 50, indexed: false });
        expect(percentScaleForModel(scene, pane, emaModel)).toEqual({ baseline: 100, indexed: false });

        // Indexed mode keeps the same rebasing with indexed: true.
        scene.scaleMode = 'indexed';
        expect(percentScaleForModel(scene, pane, orclModel)).toEqual({ baseline: 50, indexed: true });

        // Price mode and ownScale both disable percent rebasing.
        scene.scaleMode = 'price';
        expect(scene.scaleFor(orclModel, pane)).toBe(pane.scale);
        expect(percentScaleForModel(scene, pane, orclModel)).toBeUndefined();

        scene.scaleMode = 'percent';
        orclModel.ownScale = true;
        expect(percentScaleForModel(scene, pane, orclModel)).toBeUndefined();
    });

    it('handles opposite-sign baselines without collapsing and skips zero-baseline models from raw scale folding', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0);
        pane.bounds = { top: 0, height: 200 };
        scene.scaleMode = 'percent';
        pane.percentBaseline = 100;

        const aapl = seriesBars([100, 110]);
        const spreadModel: IndicatorModel = {
            id: 'cmp-spread',
            title: 'SPREAD',
            overlay: true,
            paneHint: 'price',
            paneId: 'price',
            percentBaseline: 'own',
            series: [
                {
                    id: 'spread-line',
                    title: 'SPREAD',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: aapl[0]!.time, value: -50 }, // 0%
                        { time: aapl[1]!.time, value: -60 }, // (-60 / -50 - 1) = +20%
                    ],
                    style: { color: '#3b82f6', width: 2, lineStyle: 'solid' },
                },
            ],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: [],
            inputValues: {},
        };
        const unbasedModel: IndicatorModel = {
            ...spreadModel,
            id: 'cmp-zero',
            series: [
                {
                    id: 'zero-line',
                    title: 'ZERO',
                    paneId: 'price',
                    kind: 'line',
                    points: [
                        { time: aapl[0]!.time, value: 0 },
                        { time: aapl[1]!.time, value: 90_000 },
                    ],
                    style: { color: '#22c55e', width: 2, lineStyle: 'solid' },
                },
            ],
        };
        scene.indicators.set(spreadModel.id, spreadModel);
        scene.indicators.set(unbasedModel.id, unbasedModel);
        scene.modelPercentBaselines.set(spreadModel.id, -50);

        // `valueScaleOf` returns 0 for un-rebaseable own-baseline models so raw 90,000 never blows out the scale.
        pane.scale = computePaneScale(
            [spreadModel, unbasedModel],
            aapl,
            true,
            0,
            1,
            null,
            false,
            () => 0,
            { top: 0, bottom: 0 },
            (id) => {
                const own = scene.modelPercentBaselines.get(id);
                return own ? pane.percentBaseline / own : 0;
            },
        );
        expect(pane.scale.max).toBeLessThan(200);

        const coords = new CoordinateSystem();
        const sc = scene.scaleFor(spreadModel, pane);
        expect(sc.max).toBeGreaterThan(sc.min);
        expect(sc.invert).toBe(true);
        const yMain0 = coords.priceToY(100, pane.scale, pane.bounds);
        const ySpread0 = coords.priceToY(-50, sc, pane.bounds);
        expect(ySpread0).toBeCloseTo(yMain0, 6);
        const yMainPlus20 = coords.priceToY(120, pane.scale, pane.bounds);
        const ySpreadPlus20 = coords.priceToY(-60, sc, pane.bounds);
        expect(ySpreadPlus20).toBeCloseTo(yMainPlus20, 6);
    });
});

describe('compare native indicator', () => {
    it('fetches, aligns, streams, and supports multiple instances and placements', async () => {
        const t0 = 1_700_000_000_000;
        const step = 3_600_000;
        const provider = new MultiSymbolProvider({
            AAPL: seriesBars([100, 102, 104, 106], t0, step),
            // Starts one bar later than AAPL to prove leading gaps stay null.
            ORCL: seriesBars([50, 48, 46], t0 + step, step),
            NVDA: seriesBars([200, 190, 180, 170], t0, step),
        });

        const renderer = new FakeRenderer();
        const chart = new Vela({} as HTMLElement, { symbol: 'MOCK:AAPL', timeframe: '60', live: true, volume: false }, { renderer });
        chart.data.registerProvider('mock', provider);
        await chart.ready();
        await flush();

        // Main symbol bare ticker is pushed to the renderer for axis badges.
        expect(renderer.symbolName).toBe('AAPL');

        // Excluded from the generic Indicators picker catalog.
        const catalog = await chart.availableNativeIndicators();
        expect(catalog.some((c) => c.type === 'compare')).toBe(false);

        // Add two compared symbols simultaneously (multiInstance).
        const hOrcl = chart.addNativeIndicator('compare', { inputs: { symbol: 'MOCK:ORCL', color: '#3b82f6', scale: 'same' } });
        const hNvda = chart.addNativeIndicator('compare', { inputs: { symbol: 'MOCK:NVDA', color: '#22c55e', scale: 'new-scale' } });
        await flush();

        expect(hOrcl.id).not.toBe(hNvda.id);
        expect(hOrcl.title).toBe('ORCL · MOCK');
        expect(hNvda.title).toBe('NVDA · MOCK');

        const orclModel = renderer.models.get(hOrcl.id)!;
        const nvdaModel = renderer.models.get(hNvda.id)!;
        expect(orclModel.paneId).toBe('price');
        expect(orclModel.ownScale).not.toBe(true);
        expect(orclModel.percentBaseline).toBe('own');
        expect(orclModel.priceAxisLabel).toBe(true);
        const orclPts = (orclModel.series[0] as LineLikeSeries).points;
        expect(orclPts.map((p) => p.value)).toEqual([null, 50, 48, 46]);
        expect(orclModel.series[0]!.title).toBe('ORCL');

        expect(nvdaModel.paneId).toBe('price');
        expect(nvdaModel.ownScale).toBe(true);
        expect((nvdaModel.series[0] as LineLikeSeries).points.map((p) => p.value)).toEqual([200, 190, 180, 170]);

        // Live tick updates the compared symbol's last aligned point.
        provider.pushLive('ORCL', { time: t0 + 3 * step, open: 46, high: 47, low: 45, close: 44, volume: 50 });
        await flush();
        expect(((renderer.models.get(hOrcl.id)!.series[0] as LineLikeSeries).points)[3]!.value).toBe(44);

        // Switching scale input to 'new-pane' routes into its own study pane.
        hOrcl.setInputs({ scale: 'new-pane' });
        await flush();
        expect(renderer.models.get(hOrcl.id)!.paneId).toBe(`pane-${hOrcl.id}`);

        // Locale switch preserves per-instance dynamic compare titles.
        chart.setLocale('fr');
        expect(hOrcl.title).toBe('ORCL · MOCK');
        expect(hNvda.title).toBe('NVDA · MOCK');

        // Hide -> show catches up bars formed while hidden.
        hNvda.setVisible(false);
        await flush();
        hNvda.setVisible(true);
        await flush();
        expect(((renderer.models.get(hNvda.id)!.series[0] as LineLikeSeries).points)[3]!.value).toBe(170);

        // Switching main chart market updates renderer.symbolName.
        await chart.setMarket({ symbol: 'MOCK:NVDA' });
        expect(renderer.symbolName).toBe('NVDA');

        chart.destroy();
    });
});

describe('topbar compare slot', () => {
    it('places compare right after symbol in defaults and marks it overridable', () => {
        expect(TOPBAR_BUILTIN_IDS).toContain('compare');
        expect(OVERRIDABLE_TOPBAR_IDS).toContain('compare');
        expect(TOPBAR_DEFAULT_LEFT.indexOf('compare')).toBe(TOPBAR_DEFAULT_LEFT.indexOf('symbol') + 1);
    });
});
