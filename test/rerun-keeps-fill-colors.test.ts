// An indicator that runs again over a deeper history (its chart grew: older bars loaded behind
// the view) hands the chart a NEW model, which reaches the renderer as a value patch. The patch
// carried the series points but not the fills, the bgcolor spans, the hlines or the barcolor
// recolors, and the renderer keeps what a patch leaves out: the fill's per-bar colors stayed
// those of the first run, index-aligned to a shorter window, so the newest candles had no fill
// and it never followed the live bars again until the indicator was hidden and shown.
import { describe, it, expect, afterEach } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
} from '../src/core/ports/ScriptingEngine';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig, VelaTheme } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch, ValuePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const UP = 'rgba(41,98,255,0.2)';
const DOWN = 'rgba(247,82,95,0.2)';

const flush = async (): Promise<void> => {
    // Two animation frames (the orchestrator yields to paint before a first run) plus the promise chains.
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 20));
};

/** The bar universe: hourly, alternating up and down so every bar's fill color is known. */
const barAt = (i: number): OHLCV => ({ time: T0 + i * HOUR, open: 100, high: 102, low: 98, close: i % 2 === 0 ? 101 : 99, volume: 1 });
const colorOf = (b: OHLCV): string => (b.close > b.open ? UP : DOWN);

/** An indicator's model over `bars`: two bands, a per-bar colored fill between them, a bgcolor, an hline, barcolors. */
function bandModel(id: string, bars: OHLCV[]): IndicatorModel {
    return {
        id,
        title: 'Bands',
        overlay: true,
        paneHint: 'price',
        anchorTime: bars[0]?.time,
        series: [
            { id: `${id}:hi`, title: 'Hi', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.high })), style: { color: '#fff', width: 1, lineStyle: 'solid' } },
            { id: `${id}:lo`, title: 'Lo', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.low })), style: { color: '#fff', width: 1, lineStyle: 'solid' } },
        ],
        fills: [{ id: `${id}:f0`, paneId: 'unrouted', fromSeriesId: `${id}:hi`, toSeriesId: `${id}:lo`, colors: bars.map(colorOf) }],
        backgrounds: [{ id: `${id}:bg0`, paneId: 'unrouted', from: bars[0]!.time, to: bars[bars.length - 1]!.time, color: '#123' }],
        priceLines: [{ id: `${id}:hl0`, paneId: 'unrouted', price: bars.length }],
        barColors: bars.map((b) => ({ time: b.time, color: colorOf(b) })),
        inputs: [],
        inputValues: {},
    };
}

/** History source: `depth` bars end at the same newest bar, so a deeper ask prepends older ones. */
class DeepFeed implements MarketDataFeed {
    constructor(private readonly depth: number) {}
    private all(): OHLCV[] {
        return Array.from({ length: this.depth }, (_, i) => barAt(i));
    }
    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        return this.all().slice(-Math.min(cfg.bars ?? 500, this.depth));
    }
    async loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        let out = this.all().filter((b) => b.time <= (range.to ?? Infinity));
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return out;
    }
    subscribe(_cfg: MarketConfig, _onBar: (bar: OHLCV) => void): Unsubscribe {
        return () => {};
    }
}

/** Runs once per execution and again when a history load completes, each run a NEW model, like a server-side script. */
class RerunEngine implements ScriptingEngine {
    readonly language = 'bands';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: false, inputs: true };
    runs: IndicatorModel[] = [];
    /** Test knob: runs after the first leave `barColors` out of their model. */
    dropBarColorsAfterFirst = false;

    prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({ language: 'bands', inputs: [], meta: { title: 'Bands', overlay: true }, reactsToViewport: false, token: { instanceId } });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const id = (req.prepared.token as { instanceId: string }).instanceId;
        const run = (): void => {
            const model = bandModel(id, req.getBars?.() ?? req.bars);
            if (this.dropBarColorsAfterFirst && this.runs.length > 0) delete model.barColors;
            this.runs.push(model);
            handlers.onModel(model);
        };
        if (req.historyState !== 'backfill') run();
        return {
            stop: () => {},
            update: () => {},
            setVisibleRange: () => {},
            notifyBars: (reason) => {
                if (reason === 'complete') run();
            },
        };
    }
}

class RecordingRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'recording';
    readonly features: readonly string[] = [];
    bars: OHLCV[] = [];
    mounted: IndicatorModel[] = [];
    updates: ScenePatch[] = [];
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[]): void { this.bars = bars; }
    setLoading(): void {}
    updateBar(bar: OHLCV): void { this.bars.push(bar); }
    setNativeData(): void {}
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { this.mounted.push(model); return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, p: ScenePatch): void { this.updates.push(p); }
    removeIndicator(_h: IndicatorRenderHandle): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(_r: VisibleRange): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
}

const charts: Vela[] = [];
afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
});

describe('an indicator that runs again after its chart loads older bars', () => {
    it('hands the chart the second run’s fill colors, bgcolor, hlines and barcolors', async () => {
        const renderer = new RecordingRenderer();
        const engine = new RerunEngine();
        const chart = new Vela({} as HTMLElement, { symbol: 'AAA', timeframe: '60', bars: 50, volume: false }, { renderer, engines: [engine], dataFeed: new DeepFeed(200) });
        charts.push(chart);
        await chart.ready();
        await chart.historyComplete();
        chart.addIndicator('bands', { language: 'bands' });
        await flush();
        // The first run, over the 50 bars the chart opened on (mounted after the loading placeholder).
        expect(engine.runs).toHaveLength(1);
        expect(renderer.mounted[renderer.mounted.length - 1]!.fills[0]!.colors).toHaveLength(50);

        // The chart deepens in place (older bars stream in behind the view) and the indicator runs again.
        await chart.setMarket({ bars: 200 });
        await chart.historyComplete();
        await flush();

        const second = engine.runs[engine.runs.length - 1]!;
        expect(second.series[0]!.kind === 'line' && second.series[0]!.points).toHaveLength(200);
        const patch = renderer.updates.filter((u): u is ValuePatch => u.kind === 'value').pop();
        expect(patch).toBeDefined();
        expect(patch!.fills?.[0]?.colors).toEqual(second.fills[0]!.colors);
        expect(patch!.fills?.[0]?.colors).toHaveLength(200);
        expect(patch!.backgrounds).toEqual(second.backgrounds);
        expect(patch!.priceLines).toEqual(second.priceLines);
        expect(patch!.barColors).toEqual(second.barColors);
    });

    it('states an empty barcolor set, so a second run without barcolors clears the first run’s', async () => {
        const renderer = new RecordingRenderer();
        const engine = new RerunEngine();
        engine.dropBarColorsAfterFirst = true;
        const chart = new Vela({} as HTMLElement, { symbol: 'AAA', timeframe: '60', bars: 50, volume: false }, { renderer, engines: [engine], dataFeed: new DeepFeed(200) });
        charts.push(chart);
        await chart.ready();
        await chart.historyComplete();
        chart.addIndicator('bands', { language: 'bands' });
        await flush();
        expect(renderer.mounted[renderer.mounted.length - 1]!.barColors).toHaveLength(50);

        await chart.setMarket({ bars: 200 });
        await chart.historyComplete();
        await flush();

        const patch = renderer.updates.filter((u): u is ValuePatch => u.kind === 'value').pop();
        expect(patch?.barColors).toEqual([]);
    });
});

describe('a value patch on the native renderer', () => {
    function rendererWith(model: IndicatorModel): { r: NativeRenderer; scene: SceneGraph } {
        const r = new NativeRenderer();
        const internals = r as unknown as { scene: SceneGraph; scheduler: { invalidate(): void } };
        internals.scheduler = { invalidate: () => {} }; // unmounted: there is no frame to schedule
        // The scene half of `mountIndicator`, without its DOM (legend, panes, tables).
        internals.scene.indicators.set(model.id, model);
        return { r, scene: internals.scene };
    }
    const bars = (from: number, to: number): OHLCV[] => Array.from({ length: to - from }, (_, k) => barAt(from + k));

    it('replaces the fills, bgcolor spans, hlines and barcolors a patch states', () => {
        const { r, scene } = rendererWith(bandModel('ind', bars(150, 200)));
        const next = bandModel('ind', bars(0, 200));
        const patch: ValuePatch = {
            kind: 'value', indicatorId: 'ind', dirty: { from: T0, to: T0 + 199 * HOUR }, anchorTime: next.anchorTime,
            series: next.series.map((s) => ({ seriesId: s.id, kind: 'points' as const, points: s.kind === 'line' ? s.points : [] })),
            fills: next.fills, backgrounds: next.backgrounds, priceLines: next.priceLines, barColors: next.barColors,
        };
        r.updateIndicator({ id: 'ind' }, patch);

        const drawn = scene.indicators.get('ind')!;
        expect(drawn.fills[0]!.colors).toHaveLength(200);
        expect(drawn.fills[0]!.colors).toEqual(next.fills[0]!.colors);
        expect(drawn.backgrounds).toEqual(next.backgrounds);
        expect(drawn.priceLines).toEqual(next.priceLines);
        expect(drawn.barColors).toEqual(next.barColors);
    });

    it('keeps them when a patch leaves them out', () => {
        // A host driving `updateIndicator` itself may send the points alone: the fill must survive that.
        const first = bandModel('ind', bars(150, 200));
        const { r, scene } = rendererWith(first);
        const keep = { fills: first.fills, backgrounds: first.backgrounds, priceLines: first.priceLines, barColors: first.barColors };
        r.updateIndicator({ id: 'ind' }, {
            kind: 'value', indicatorId: 'ind', dirty: { from: T0, to: T0 }, series: first.series.map((s) => ({ seriesId: s.id, kind: 'points' as const, points: s.kind === 'line' ? s.points : [] })),
        });

        const drawn = scene.indicators.get('ind')!;
        expect(drawn.fills).toBe(keep.fills);
        expect(drawn.backgrounds).toBe(keep.backgrounds);
        expect(drawn.priceLines).toBe(keep.priceLines);
        expect(drawn.barColors).toBe(keep.barColors);
    });
});
