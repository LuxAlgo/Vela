import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vela } from '../src/index';
import { ACCENT, BEARISH, BULLISH } from '../src/core/palette';
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
    VisibleBarRange,
    EngineContextSnapshot,
    ContextSelect,
} from '../src/core/ports/ScriptingEngine';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from '../src/core/ports/DataProvider';
import type { OHLCV } from '../src/core/model/ohlcv';
import { registerNativeIndicator, unregisterNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { heikinAshiFull } from '../src/core/price-styles/heikin-ashi';
import { registerChartType, unregisterChartType, type SeriesDataEngineHost } from '../src/chart-types/registry';
import type { BarTransform } from '../src/core/price-styles/BarTransform';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../src/core/native-indicators/NativeIndicator';
import type { Pane } from '../src/core/model/scene';
import type { DrawingLine } from '../src/core/model/drawings';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { VelaTheme, PriceStyle } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import type { ScriptRun } from '../src/core/script-run';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function makeBars(n: number): OHLCV[] {
    const bars: OHLCV[] = [];
    let price = 100;
    for (let i = 0; i < n; i += 1) {
        price += Math.sin(i / 3);
        bars.push({ time: 1_700_000_000_000 + i * 3_600_000, open: price, high: price + 1, low: price - 1, close: price, volume: 10 });
    }
    return bars;
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    mounted = false;
    bars: OHLCV[] = [];
    ctsCb: ((typeId: string, values: Record<string, unknown>) => void) | null = null;
    onChartTypeSettingsChange(cb: (typeId: string, values: Record<string, unknown>) => void): () => void {
        this.ctsCb = cb;
        return () => (this.ctsCb = null);
    }
    panes: Pane[] = [];
    mountedModels: IndicatorModel[] = [];
    removed: string[] = [];
    updatedIds: string[] = [];
    setBarsCalls: { n: number; preserveView: boolean }[] = [];
    private viewportCb: ((r: VisibleRange) => void) | null = null;
    private removeCb: ((id: string) => void) | null = null;

    mount(_c: HTMLElement, _t: VelaTheme): void { this.mounted = true; }
    themes: VelaTheme[] = [];
    setTheme(t: VelaTheme): void { this.themes.push(t); }
    resize(): void {}
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    applyFeature(): void {}
    /** Test knob: what `readFeature('priceStyle')` reports (a chart CONSTRUCTED in a style). */
    priceStyleFeature: unknown = undefined;
    readFeature(key: string): unknown { return key === 'priceStyle' ? this.priceStyleFeature : undefined; }
    destroy(): void {}
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void { this.bars = bars; this.setBarsCalls.push({ n: bars.length, preserveView: !!opts?.preserveView }); }
    updatedBars: OHLCV[] = [];
    updateBar(bar: OHLCV): void { this.updatedBars.push(bar); }
    ensurePane(pane: Pane): void { this.panes.push(pane); }
    removedPanes: string[] = [];
    removePane(id: string): void { this.removedPanes.push(id); }
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { this.mountedModels.push(model); return { id: model.id }; }
    updatedPatches: ScenePatch[] = [];
    updateIndicator(h: IndicatorRenderHandle, p: ScenePatch): void { this.updatedIds.push(h.id); this.updatedPatches.push(p); }
    removeIndicator(h: IndicatorRenderHandle): void { this.removed.push(h.id); }
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    indicatorVisible = new Map<string, boolean>();
    setIndicatorVisible(h: IndicatorRenderHandle, visible: boolean): void { this.indicatorVisible.set(h.id, visible); }
    private inputChangeCb: ((e: InputChangeEvent) => void) | null = null;
    onInputChange(cb: (e: InputChangeEvent) => void): Unsubscribe { this.inputChangeCb = cb; return () => { this.inputChangeCb = null; }; }
    /** Test helper: simulate a settings-dialog edit (input or declaration prop). */
    fireInputChange(e: InputChangeEvent): void { this.inputChangeCb?.(e); }
    onRemoveIndicator(cb: (id: string) => void): Unsubscribe { this.removeCb = cb; return () => { this.removeCb = null; }; }
    private toggleVisibleCb: ((id: string, visible: boolean) => void) | null = null;
    onToggleIndicatorVisible(cb: (id: string, visible: boolean) => void): Unsubscribe { this.toggleVisibleCb = cb; return () => { this.toggleVisibleCb = null; }; }
    /** Test helper: simulate the in-chart legend eye toggle. */
    fireToggleVisible(id: string, visible: boolean): void { this.toggleVisibleCb?.(id, visible); }
    /** Test helper: simulate the in-chart legend ✕ on an indicator. */
    fireRemove(id: string): void { this.removeCb?.(id); }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    visibleRangeCalls: VisibleRange[] = [];
    setVisibleRange(r: VisibleRange): void { this.visibleRangeCalls.push(r); }
    onViewportChange(cb: (r: VisibleRange) => void): Unsubscribe { this.viewportCb = cb; return () => { this.viewportCb = null; }; }
    /** Test helper: simulate a pan/zoom viewport change. */
    fireViewport(range: VisibleRange): void { this.viewportCb?.(range); }
    // Native-layer data: capture each push by type (presence of setNativeData also gates auto-add).
    volumePushes: unknown[] = [];
    vpvrPushes: unknown[] = [];
    pendingPushes: Array<ReadonlyArray<readonly [number, number]>> = [];
    nativePushes: Array<[string, unknown]> = [];
    setNativeData(type: string, data: unknown): void {
        this.nativePushes.push([type, data]);
        if (type === 'volume') this.volumePushes.push(data);
        else if (type === 'vpvr') this.vpvrPushes.push(data);
    }
    // Price-style change seam (style-driven data engines follow it).
    private priceStyleCb: ((style: PriceStyle) => void) | null = null;
    onPriceStyleChange(cb: (style: PriceStyle) => void): Unsubscribe { this.priceStyleCb = cb; return () => { this.priceStyleCb = null; }; }
    /** Test helper: simulate the chart-type dropdown / settings dialog switching the price style. */
    firePriceStyle(style: PriceStyle): void { this.priceStyleCb?.(style); }
    statuses: { id: string; status: string }[] = [];
    setIndicatorStatus(h: IndicatorRenderHandle, status: string): void { this.statuses.push({ id: h.id, status }); }
}

const FIVE_MIN = 300_000;

/** Market-data feed: synthesizes 50 bars, no live ticks. */
class MockDataFeed implements MarketDataFeed {
    load(): Promise<OHLCV[]> { return Promise.resolve(makeBars(50)); }
    subscribe(): Unsubscribe { return () => {}; }
}

/** A feed that honors `cfg.bars`, for exercising the preview→full split. */
/** One fixed 30k-bar universe: `load` serves the tail, `loadRange` a window — so the
 *  progressive head + its backfill extensions see one consistent market. */
class SizedDataFeed implements MarketDataFeed {
    private readonly all = makeBars(30_000);
    load(cfg: { bars?: number }): Promise<OHLCV[]> { return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)).map((b) => ({ ...b }))); }
    subscribe(): Unsubscribe { return () => {}; }
    loadRange(_cfg: unknown, range: BarRange): Promise<OHLCV[]> {
        const to = range.to ?? Infinity;
        let out = this.all.filter((b) => b.time <= to);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out.map((b) => ({ ...b })));
    }
}

/** One synthetic hourly bar (aligned with makeBars' time base). */
function mkBar(time: number, close = 100): OHLCV {
    return { time, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

/** A deep-history feed: `load` serves the most-recent N; `loadRange({to, limit})` the window ending at `to`. */
class DeepHistoryFeed implements MarketDataFeed {
    rangeCalls: BarRange[] = [];
    /** Test knob: every ranged fetch rejects (a failing backfill). */
    failRanges = false;
    /** Test knob: hold every ranged fetch until {@link release} (races destroy vs in-flight chunk). */
    gate = false;
    private gated: (() => void)[] = [];
    private readonly all: OHLCV[];
    constructor(total: number) { this.all = makeBars(total); }
    load(cfg: { bars?: number }): Promise<OHLCV[]> { return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)).map((b) => ({ ...b }))); }
    async loadRange(_cfg: unknown, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls.push({ ...range });
        if (this.gate) await new Promise<void>((r) => this.gated.push(r));
        if (this.failRanges) throw new Error('backfill fetch failed');
        const to = range.to ?? Infinity;
        let out = this.all.filter((b) => b.time <= to);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return out.map((b) => ({ ...b }));
    }
    /** Release every gated ranged fetch. */
    release(): void { const g = this.gated; this.gated = []; for (const r of g) r(); }
    subscribe(): Unsubscribe { return () => {}; }
}

/** A live feed the test drives by hand: captures the subscriber + records ranged backfills. */
class GapFeed implements MarketDataFeed {
    push: ((bar: OHLCV) => void) | null = null;
    rangeCalls: BarRange[] = [];
    rangeResult: OHLCV[] = [];
    constructor(private readonly n: number) {}
    load(): Promise<OHLCV[]> { return Promise.resolve(makeBars(this.n)); }
    loadRange(_cfg: unknown, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls.push(range);
        return Promise.resolve(this.rangeResult);
    }
    subscribe(_cfg: unknown, onBar: (bar: OHLCV) => void): Unsubscribe {
        this.push = onBar;
        return () => { this.push = null; };
    }
}

class MockEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true };
    /** Test knob: defer static runs under historyState 'backfill' until the 'complete' poke (policy A). */
    policyA = false;
    /** Test knob: emit a strategy-style trade-execution pair with every model. */
    emitTrades = false;
    /** Test knob: prepare-time meta declares this compact shorttitle. */
    declareShortTitle: string | undefined;
    runCount: Record<string, number> = {};
    lastVisibleRange: Record<string, VisibleBarRange | undefined> = {};
    streamStarts: Record<string, number> = {};
    streamStops: Record<string, number> = {};
    private liveSinks: Record<string, { handlers: ExecutionHandlers; req: ExecutionRequest; inputs?: Record<string, InputValue> }> = {};

    prepare(source: string, instanceId: string): Promise<PreparedScript> {
        const overlay = /overlay\s*=\s*true/.test(source);
        const reactsToViewport = /visible/i.test(source);
        return Promise.resolve({
            language: 'pine',
            inputs: [{ key: 'Length', title: 'Length', type: 'int', defval: 14 }],
            meta: { title: 'Mock', overlay, ...(this.declareShortTitle ? { shorttitle: this.declareShortTitle } : {}) },
            reactsToViewport,
            token: { instanceId, overlay },
        });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const token = req.prepared.token as { instanceId: string; overlay: boolean };
        const id = token.instanceId;
        let inputs = req.inputs;
        let stopped = false;
        const emit = (): void => {
            if (stopped) return;
            this.runCount[id] = (this.runCount[id] ?? 0) + 1;
            handlers.onModel(this.buildModel(req.prepared, req.getBars?.() ?? req.bars, inputs));
            handlers.onDone?.();
        };

        // Live: don't emit until the test drives a tick via emitStream().
        if (req.mode === 'live') {
            this.streamStarts[id] = (this.streamStarts[id] ?? 0) + 1;
            const sink = { handlers, req, inputs };
            this.liveSinks[id] = sink;
            return {
                stop: () => {
                    stopped = true;
                    this.streamStops[id] = (this.streamStops[id] ?? 0) + 1;
                },
                update: (next) => { inputs = next; sink.inputs = next; },
                setVisibleRange: (r) => { this.lastVisibleRange[id] = r; },
                notifyBars: () => {},
            };
        }

        // Static: run now, and re-run whenever the session is poked. With the policyA knob
        // set, mirror the bundled engines: hold every run while the history backfill is in
        // progress and fire the first one on the 'complete' notification.
        let deferred = this.policyA && req.historyState === 'backfill';
        if (!deferred) emit();
        return {
            stop: () => { stopped = true; },
            update: (next) => { inputs = next; if (!deferred) emit(); },
            setVisibleRange: (r) => { this.lastVisibleRange[id] = r; if (!deferred) emit(); },
            notifyBars: (reason) => {
                if (this.policyA && reason === 'backfill') return;
                if (reason === 'complete') deferred = false;
                if (!deferred) emit();
            },
        };
    }

    /** Test helper: simulate a live stream emitting a fresh model (initial run or a live tick). */
    emitStream(instanceId: string): void {
        const s = this.liveSinks[instanceId];
        if (s) s.handlers.onModel(this.buildModel(s.req.prepared, s.req.getBars?.() ?? s.req.bars, s.inputs));
    }

    private buildModel(prepared: PreparedScript, bars: OHLCV[], inputs?: Record<string, InputValue>): IndicatorModel {
        const token = prepared.token as { instanceId: string; overlay: boolean };
        const length = Number(inputs?.Length ?? 14);
        const trades = this.emitTrades && bars.length >= 2
            ? {
                  trades: [
                      { time: bars[0]!.time, price: bars[0]!.close, side: 'buy' as const, kind: 'entry' as const, label: 'Long', qty: 2, tradeId: 't1' },
                      { time: bars[bars.length - 1]!.time, price: bars[bars.length - 1]!.close, side: 'sell' as const, kind: 'exit' as const, label: 'Exit', qty: 2, tradeId: 't1' },
                  ],
              }
            : {};
        return {
            ...trades,
            id: token.instanceId,
            title: 'Mock',
            overlay: token.overlay,
            paneHint: token.overlay ? 'price' : 'new',
            series: [
                {
                    id: `${token.instanceId}:line:mock#0`,
                    title: 'Mock',
                    paneId: 'unrouted',
                    kind: 'line',
                    points: bars.map((b) => ({ time: b.time, value: b.close + length })),
                    style: { color: '#f00', width: 2, lineStyle: 'solid' },
                },
            ],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: prepared.inputs,
            inputValues: inputs ?? {},
        };
    }
}

/** A test native indicator: records its lifecycle hook calls + emits one line series from the bars. */
class TestNativeIndicator implements NativeIndicator {
    calls = { start: 0, onBars: 0, onViewport: 0, setInputs: 0, suspend: 0, resume: 0, stop: 0 };
    private ctx: NativeIndicatorContext | null = null;
    private suspended = false;
    start(ctx: NativeIndicatorContext): void { this.calls.start += 1; this.ctx = ctx; this.emit(); }
    onBars(): void { this.calls.onBars += 1; this.emit(); }
    onViewport(): void { this.calls.onViewport += 1; this.emit(); }
    setInputs(): void { this.calls.setInputs += 1; if (!this.suspended) this.emit(); }
    suspend(): void { this.calls.suspend += 1; this.suspended = true; }
    resume(): void { this.calls.resume += 1; this.suspended = false; this.emit(); }
    stop(): void { this.calls.stop += 1; }
    private emit(): void {
        const bars = this.ctx?.bars() ?? [];
        this.ctx?.emit({
            series: [{ id: 'native:line:0', title: 'Native', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.close })), style: { color: '#7d8aa0', width: 2, lineStyle: 'solid' } }],
        });
    }
}

let lastNative: TestNativeIndicator;
const testNativeDescriptor: NativeIndicatorDescriptor = {
    type: 'test-native', title: 'Native Test', paneHint: 'price', overlay: true, reactsToViewport: true,
    inputsSchema: () => [{ key: 'len', title: 'Length', type: 'int', defval: 5 }],
    defaultInputs: () => ({ len: 5 }),
    create: () => (lastNative = new TestNativeIndicator()),
};

describe('EngineOrchestrator', () => {
    it('loads bars, routes overlay to price + study to its own pane, and re-runs on setInput', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        // volume:false — this test counts mounted models; keep the default-on volume indicator out of it.
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });

        const ema = chart.addIndicator('//@version=5\nindicator("EMA", overlay=true)\nplot(close)');
        chart.addIndicator('//@version=5\nindicator("RSI")\nplot(close)');

        // The handle exposes the source it was added with — what a host editor opens
        // from a legend action. Natives have none (see the native-indicator suites).
        expect(ema.source).toBe('//@version=5\nindicator("EMA", overlay=true)\nplot(close)');

        await chart.ready();
        await flush();

        expect(renderer.mounted).toBe(true);
        expect(renderer.bars.length).toBe(50);
        // Each indicator mounts twice: the immediate legend placeholder, then the computed model.
        expect(renderer.mountedModels.length).toBe(4);

        const computed = renderer.mountedModels.filter((m) => m.series.length > 0);
        expect(computed.length).toBe(2);
        const overlayModel = computed.find((m) => m.overlay);
        const paneModel = computed.find((m) => !m.overlay);
        expect(overlayModel?.paneId).toBe('price');
        expect(paneModel?.paneId).not.toBe('price');
        // every series inherits the routed pane id
        expect(overlayModel?.series.every((s) => s.paneId === 'price')).toBe(true);

        const beforeMounts = renderer.mountedModels.length;
        ema.setInput('Length', 50);
        await flush();
        // input change re-runs via mountIndicator (idempotent refresh) — no teardown,
        // so the legend/settings dialog stay alive
        expect(renderer.mountedModels.length).toBe(beforeMounts + 1);
        expect(renderer.mountedModels[renderer.mountedModels.length - 1]?.id).toBe(ema.id);
        expect(renderer.removed).toHaveLength(0);
    });

    it('setTheme re-skins the renderer and emits theme:changed; a same-theme call no-ops', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        const seen: string[] = [];
        chart.on('theme:changed', (t) => seen.push(t.background));
        chart.setTheme('light');
        expect(renderer.themes.map((t) => t.background)).toEqual(['#ffffff']);
        expect(seen).toEqual(['#ffffff']);
        // Candle hues are shared across themes — a theme swap never recolors the series.
        expect(renderer.themes[0]!.upColor).toBe(BULLISH);
        expect(renderer.themes[0]!.downColor).toBe(BEARISH);
        chart.setTheme('light'); // already active → no re-skin, no event (breaks host echo loops)
        expect(renderer.themes).toHaveLength(1);
        expect(seen).toHaveLength(1);
        chart.setTheme('dark');
        expect(seen).toHaveLength(2);
    });

    it('the in-chart legend ✕ removes the indicator (renderer teardown + stream stop + event)', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("Stream", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();
        engine.emitStream(ind.id); // mount it
        await flush();

        const removedEvents: string[] = [];
        chart.on('indicator:removed', (e) => removedEvents.push(e.id));

        renderer.fireRemove(ind.id); // simulate the legend ✕

        expect(renderer.removed).toContain(ind.id); // renderer tore down its visuals + pane
        expect(engine.streamStops[ind.id]).toBe(1); // the engine stream was stopped
        expect(removedEvents).toEqual([ind.id]); // the public event fired (so a host UI can sync)
    });

    it('hide suspends an indicator (drops visuals, keeps the record); show re-runs + re-mounts it', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("X", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        expect(ind.visible).toBe(true);
        const mountsBefore = renderer.mountedModels.filter((m) => m.id === ind.id).length;
        expect(mountsBefore).toBeGreaterThan(0);

        ind.setVisible(false);
        expect(ind.visible).toBe(false);
        expect(renderer.indicatorVisible.get(ind.id)).toBe(false); // renderer told to hide the visuals
        expect(renderer.removed).not.toContain(ind.id); // hidden ≠ removed — still in the registry

        ind.setVisible(true);
        await flush();
        expect(ind.visible).toBe(true);
        expect(renderer.indicatorVisible.get(ind.id)).toBe(true);
        // Re-executed (a fresh model) → re-mounted on show.
        expect(renderer.mountedModels.filter((m) => m.id === ind.id).length).toBeGreaterThan(mountsBefore);
    });

    it('a hidden indicator does not re-run on viewport changes (resource suspension); the legend eye toggles it', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const vr = chart.addIndicator('//@version=6\nindicator("VR", overlay=true)\nx = chart.right_visible_bar_time\nplot(close)');
        await chart.ready();
        await flush();

        renderer.fireToggleVisible(vr.id, false); // hide via the in-chart legend eye (renderer → core)
        expect(vr.visible).toBe(false);

        const runsBefore = engine.runCount[vr.id] ?? 0;
        renderer.fireViewport({ from: 1_700_000_036_000, to: 1_700_000_144_000 });
        await new Promise((r) => setTimeout(r, 220)); // > debounce
        await flush();
        expect(engine.runCount[vr.id]).toBe(runsBefore); // suspended: no session ⇒ no viewport re-run

        renderer.fireToggleVisible(vr.id, true); // show via the eye → re-executes
        await flush();
        expect(vr.visible).toBe(true);
        expect(engine.runCount[vr.id] ?? 0).toBeGreaterThan(runsBefore);
    });

    it('addNativeIndicator: mounts via the shared pipeline, is single-instance per type, and inspect tags it', async () => {
        registerNativeIndicator(testNativeDescriptor);
        try {
            const renderer = new FakeRenderer();
            const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
            const h1 = chart.addNativeIndicator('test-native');
            await chart.ready();
            await flush();

            expect(h1.visible).toBe(true);
            expect(lastNative.calls.start).toBe(1);
            // Mounted through the SAME path as a Pine indicator — with the native tag + the emitted series.
            const mounted = renderer.mountedModels.find((m) => m.id === h1.id);
            expect(mounted?.native?.type).toBe('test-native');
            expect(mounted?.series.length).toBe(1);
            // Settings schema reached the public handle.
            expect(h1.inputs.map((i) => i.key)).toEqual(['len']);

            // Single instance per type: a second add returns the SAME handle, no re-create.
            const h2 = chart.addNativeIndicator('test-native');
            expect(h2).toBe(h1);
            expect(lastNative.calls.start).toBe(1);

            // inspect() tags it native.
            const summary = chart.inspect().indicators.find((s) => s.id === h1.id);
            expect(summary?.native).toBe(true);
            expect(summary?.nativeType).toBe('test-native');
        } finally {
            unregisterNativeIndicator('test-native');
        }
    });

    it("an output's paneAxis override is stamped onto the mounted model (and only then)", async () => {
        // A layer-painting native: series-less output declaring a categorical pane axis.
        class UnscaledNative implements NativeIndicator {
            private ctx: NativeIndicatorContext | null = null;
            start(ctx: NativeIndicatorContext): void { this.ctx = ctx; this.emit(); }
            onBars(): void { this.emit(); }
            onViewport(): void {}
            setInputs(): void { this.emit(); }
            suspend(): void {}
            resume(): void { this.emit(); }
            stop(): void {}
            private emit(): void {
                this.ctx?.emit({ paneAxis: { bands: [{ frac: 0.25, label: 'Top' }, { frac: 0.75, label: 'Bottom' }] } });
            }
        }
        const unscaledDescriptor: NativeIndicatorDescriptor = {
            ...testNativeDescriptor, type: 'test-unscaled', title: 'Unscaled Native', paneHint: 'new', overlay: false,
            create: () => new UnscaledNative(),
        };
        registerNativeIndicator(testNativeDescriptor);
        registerNativeIndicator(unscaledDescriptor);
        try {
            const renderer = new FakeRenderer();
            const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
            const plain = chart.addNativeIndicator('test-native');
            const unscaled = chart.addNativeIndicator('test-unscaled');
            await chart.ready();
            await flush();

            // The override rides the model so the renderer can relabel/suppress the pane's axis.
            const unscaledModel = renderer.mountedModels.find((m) => m.id === unscaled.id && m.native);
            expect(unscaledModel?.paneAxis).toEqual({ bands: [{ frac: 0.25, label: 'Top' }, { frac: 0.75, label: 'Bottom' }] });
            expect(unscaledModel?.series).toEqual([]);
            // An output without the override leaves the model without it (the renderer scales as usual).
            const plainModel = renderer.mountedModels.find((m) => m.id === plain.id && m.native);
            expect(plainModel?.paneAxis).toBeUndefined();
        } finally {
            unregisterNativeIndicator('test-native');
            unregisterNativeIndicator('test-unscaled');
        }
    });

    it('native indicators sort to the TOP of inspect().indicators (even when added last)', async () => {
        registerNativeIndicator(testNativeDescriptor);
        try {
            const renderer = new FakeRenderer();
            const engine = new MockEngine();
            const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
            const pine = chart.addIndicator('//@version=5\nindicator("P", overlay=true)\nplot(close)'); // added FIRST
            const nat = chart.addNativeIndicator('test-native'); // added SECOND
            await chart.ready();
            await flush();

            const ids = chart.inspect().indicators.map((s) => s.id);
            expect(ids[0]).toBe(nat.id); // native pinned to the top despite being added second
            expect(ids.indexOf(nat.id)).toBeLessThan(ids.indexOf(pine.id));
        } finally {
            unregisterNativeIndicator('test-native');
        }
    });

    it('availableNativeIndicators: catalogs registered types with supported/present/beta state', async () => {
        const betaDescriptor: NativeIndicatorDescriptor = {
            type: 'test-beta', title: 'Beta Native', paneHint: 'price', overlay: true, beta: true,
            inputsSchema: () => [], defaultInputs: () => ({}),
            create: () => new TestNativeIndicator(),
            isSupported: () => true, // has a gate, but this chart sets no symbol → treated as unsupported
        };
        registerNativeIndicator(testNativeDescriptor);
        registerNativeIndicator(betaDescriptor);
        try {
            const renderer = new FakeRenderer();
            const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
            await chart.ready();

            const before = await chart.availableNativeIndicators();
            const plain = before.find((n) => n.type === 'test-native');
            const beta = before.find((n) => n.type === 'test-beta');
            expect(plain).toMatchObject({ title: 'Native Test', supported: true, present: false }); // no isSupported ⇒ always supported
            expect(plain!.beta).toBeFalsy();
            expect(beta).toMatchObject({ supported: false, present: false, beta: true }); // has isSupported + no symbol ⇒ unsupported; beta passes through

            // Adding an instance flips its `present` to true.
            chart.addNativeIndicator('test-native');
            await flush();
            const after = await chart.availableNativeIndicators();
            expect(after.find((n) => n.type === 'test-native')!.present).toBe(true);
        } finally {
            unregisterNativeIndicator('test-native');
            unregisterNativeIndicator('test-beta');
        }
    });

    it('heals a live-bar gap: a discontinuous tick triggers a ranged backfill from the last known bar', async () => {
        const HOUR = 3_600_000;
        const feed = new GapFeed(10); // last loaded bar opens at T0 + 9h
        const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer: new FakeRenderer(), engines: [], dataFeed: feed });
        const seen: number[] = [];
        chart.on('bar', (b) => seen.push(b.time));
        await chart.ready();
        await flush();
        const lastT = 1_700_000_000_000 + 9 * HOUR;

        // The backfill the provider would return: the last known bar (corrected), the two missed
        // bars, and the forming one.
        feed.rangeResult = [lastT, lastT + HOUR, lastT + 2 * HOUR, lastT + 3 * HOUR].map((t) => mkBar(t));
        // A live tick lands 3 intervals ahead — bars closed unseen (throttled tab / reconnect).
        feed.push!(mkBar(lastT + 3 * HOUR, 999));
        await flush();

        expect(feed.rangeCalls.length).toBe(1);
        expect(feed.rangeCalls[0]!.from).toBe(lastT); // re-fetch includes the last known bar
        // The missed bars were filled in order, then the buffered live tick replayed on top.
        expect(seen).toEqual([lastT, lastT + HOUR, lastT + 2 * HOUR, lastT + 3 * HOUR, lastT + 3 * HOUR]);
        expect(seen[seen.length - 1]).toBe(lastT + 3 * HOUR);
    });

    it('accepts a legitimate market gap after an empty heal (cooldown — no refetch loop)', async () => {
        const HOUR = 3_600_000;
        const feed = new GapFeed(10);
        const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer: new FakeRenderer(), engines: [], dataFeed: feed });
        const seen: number[] = [];
        chart.on('bar', (b) => seen.push(b.time));
        await chart.ready();
        await flush();
        const lastT = 1_700_000_000_000 + 9 * HOUR;

        feed.rangeResult = []; // the provider has nothing in between — an empty interval, not a miss
        feed.push!(mkBar(lastT + 3 * HOUR));
        await flush();
        expect(feed.rangeCalls.length).toBe(1);
        expect(seen).toEqual([lastT + 3 * HOUR]); // the discontinuous bar was accepted as-is

        // Another discontinuity inside the cooldown applies directly — no second backfill.
        feed.push!(mkBar(lastT + 6 * HOUR));
        await flush();
        expect(feed.rangeCalls.length).toBe(1);
        expect(seen).toEqual([lastT + 3 * HOUR, lastT + 6 * HOUR]);
    });

    it('does not heal on contiguous live bars (the normal tick path stays fetch-free)', async () => {
        const HOUR = 3_600_000;
        const feed = new GapFeed(10);
        const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer: new FakeRenderer(), engines: [], dataFeed: feed });
        await chart.ready();
        await flush();
        const lastT = 1_700_000_000_000 + 9 * HOUR;

        feed.push!(mkBar(lastT, 101)); // forming-bar update
        feed.push!(mkBar(lastT + HOUR)); // the next bar, exactly one interval on
        await flush();
        expect(feed.rangeCalls.length).toBe(0);
    });

    it('a heal notifies indicator sessions ONCE, not once per backfilled bar', async () => {
        registerNativeIndicator(testNativeDescriptor);
        try {
            const HOUR = 3_600_000;
            const feed = new GapFeed(10);
            const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer: new FakeRenderer(), engines: [], dataFeed: feed });
            chart.addNativeIndicator('test-native');
            const barEvents: number[] = [];
            chart.on('bar', (b) => barEvents.push(b.time));
            await chart.ready();
            await flush();
            const lastT = 1_700_000_000_000 + 9 * HOUR;
            const base = lastNative.calls.onBars;

            // 4 missed bars + the forming one come back from the backfill; the live tick is buffered.
            feed.rangeResult = [0, 1, 2, 3, 4, 5].map((k) => mkBar(lastT + k * HOUR));
            feed.push!(mkBar(lastT + 5 * HOUR, 999));
            await flush();

            expect(lastNative.calls.onBars - base).toBe(1); // coalesced: one re-run for the whole heal
            expect(barEvents.length).toBeGreaterThan(1); // …while the public 'bar' event stays per-bar

            // A normal (contiguous) tick still notifies immediately, once.
            feed.push!(mkBar(lastT + 5 * HOUR, 1000));
            await flush();
            expect(lastNative.calls.onBars - base).toBe(2);
        } finally {
            unregisterNativeIndicator('test-native');
        }
    });

    it('native indicator lifecycle: live tick + settings recompute; hide suspends, show resumes + re-mounts; remove stops it', async () => {
        registerNativeIndicator(testNativeDescriptor);
        try {
            const renderer = new FakeRenderer();
            const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
            const h = chart.addNativeIndicator('test-native');
            await chart.ready();
            await flush();
            const inst = lastNative;
            const mountsBefore = renderer.mountedModels.filter((m) => m.id === h.id).length;

            // settings edit → the instance recomputes
            h.setInput('len', 10);
            expect(inst.calls.setInputs).toBe(1);

            // hide → suspend (instance.suspend + renderer drops visuals), NOT removed
            h.setVisible(false);
            expect(h.visible).toBe(false);
            expect(inst.calls.suspend).toBe(1);
            expect(renderer.indicatorVisible.get(h.id)).toBe(false);
            expect(renderer.removed).not.toContain(h.id);

            // show → resume (re-emit) → re-mount
            h.setVisible(true);
            await flush();
            expect(h.visible).toBe(true);
            expect(inst.calls.resume).toBe(1);
            expect(renderer.mountedModels.filter((m) => m.id === h.id).length).toBeGreaterThan(mountsBefore);

            // remove → instance torn down + the public event fires
            const removed: string[] = [];
            chart.on('indicator:removed', (e) => removed.push(e.id));
            h.remove();
            expect(inst.calls.stop).toBe(1);
            expect(removed).toContain(h.id);
        } finally {
            unregisterNativeIndicator('test-native');
        }
    });

    it('addNativeIndicator with an unregistered type returns a fail-soft handle (no mount, a warning)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        const h = chart.addNativeIndicator('does-not-exist');
        await chart.ready();
        await flush();
        expect(renderer.mountedModels.some((m) => m.id === h.id)).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no native indicator registered'));
        warn.mockRestore();
    });

    it('on viewport change, re-runs ONLY visible-range-dependent scripts (debounced), passing the new range', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });

        const vr = chart.addIndicator('//@version=6\nindicator("VR", overlay=true)\nx = chart.left_visible_bar_time\nplot(close)');
        const plain = chart.addIndicator('//@version=5\nindicator("Plain", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        const before = { ...engine.runCount };
        renderer.fireViewport({ from: 1_700_000_036_000, to: 1_700_000_144_000 });
        await new Promise((r) => setTimeout(r, 220)); // > debounce
        await flush();

        // viewport-dependent script re-ran once with the new window…
        expect(engine.runCount[vr.id]).toBe((before[vr.id] ?? 0) + 1);
        expect(engine.lastVisibleRange[vr.id]).toEqual({ left: 1_700_000_036_000, right: 1_700_000_144_000 });
        // …the plain script did NOT re-run.
        expect(engine.runCount[plain.id]).toBe(before[plain.id] ?? 0);
        // the re-run went through the value-patch path (updateIndicator), not a remount.
        expect(renderer.updatedIds).toContain(vr.id);
        expect(renderer.updatedIds).not.toContain(plain.id);
    });

    it('coalesces a burst of viewport events into a single re-run', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const vr = chart.addIndicator('//@version=6\nindicator("VR", overlay=true)\nx = chart.right_visible_bar_time\nplot(close)');
        await chart.ready();
        await flush();

        const before = engine.runCount[vr.id] ?? 0;
        for (let i = 0; i < 8; i += 1) renderer.fireViewport({ from: 1_700_000_000_000 + i * 1000, to: 1_700_000_100_000 });
        await new Promise((r) => setTimeout(r, 220));
        await flush();
        expect(engine.runCount[vr.id]).toBe(before + 1); // 8 events → 1 re-run
    });

    it('live + non-visible-range → streams (mount on first emit, patch after); no full re-run on bar', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: true }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("Stream", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        // The orchestrator started a stream (not the full-run path). Until the first
        // emit, only the loading placeholder (no series) is mounted.
        expect(engine.streamStarts[ind.id]).toBe(1);
        expect(engine.runCount[ind.id] ?? 0).toBe(0);
        const preEmit = renderer.mountedModels.filter((m) => m.id === ind.id);
        expect(preEmit.length).toBe(1);
        expect(preEmit[0]?.series).toHaveLength(0);

        engine.emitStream(ind.id); // first 'data' → the computed model remounts over the placeholder
        await flush();
        expect(renderer.mountedModels.filter((m) => m.id === ind.id).length).toBe(2);

        engine.emitStream(ind.id); // subsequent tick → value patch (no remount)
        await flush();
        expect(renderer.mountedModels.filter((m) => m.id === ind.id).length).toBe(2);
        expect(renderer.updatedIds.filter((x) => x === ind.id).length).toBe(1);

        // Removing the indicator stops the stream.
        ind.remove();
        expect(engine.streamStops[ind.id]).toBe(1);
    });

    it('an ordinary depth arrives in ONE request — no head, no steps', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 2000 }, { renderer, engines: [new MockEngine()], dataFeed: new SizedDataFeed() });
        await chart.ready();
        await chart.historyComplete();
        // Splitting this range only ever bought a faster FIRST candle, and nothing downstream
        // can use it: an indicator's first run is held until the full depth lands anyway.
        expect(renderer.setBarsCalls).toEqual([{ n: 2000, preserveView: false }]);
    });

    it('the single-request depth boundary: 5000 in one pass, and 5001 still one (a chunk covers it)', async () => {
        const atLimit = new FakeRenderer();
        const a = new Vela({} as unknown as HTMLElement, { bars: 5000 }, { renderer: atLimit, engines: [new MockEngine()], dataFeed: new SizedDataFeed() });
        await a.ready();
        await a.historyComplete();
        expect(atLimit.setBarsCalls).toEqual([{ n: 5000, preserveView: false }]);

        // Past the line the load is chunked, but the first chunk is 10 000 bars — so any depth
        // up to that still lands in a single round trip.
        const past = new FakeRenderer();
        const b = new Vela({} as unknown as HTMLElement, { bars: 5001 }, { renderer: past, engines: [new MockEngine()], dataFeed: new SizedDataFeed() });
        await b.ready();
        await b.historyComplete();
        expect(past.setBarsCalls).toEqual([{ n: 5001, preserveView: false }]);
    });

    it('a requested initial window loads in ONE pass and is framed BEFORE the first paint', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela(
            {} as unknown as HTMLElement,
            { bars: 2000, visibleRange: '1D' }, // deep enough that it would normally preview-split
            { renderer, engines: [new MockEngine()], dataFeed: new SizedDataFeed() },
        );
        await chart.ready();
        await flush();
        // No preview pass: its recent-bars window would paint the WRONG range for a moment.
        expect(renderer.setBarsCalls).toEqual([{ n: 2000, preserveView: false }]);
        // …and the window was framed in the same turn as the bars (so the first paint has it).
        expect(renderer.visibleRangeCalls.length).toBe(1);
        const framed = renderer.visibleRangeCalls[0]!;
        expect(framed.to - framed.from).toBe(86_400_000); // exactly one day
    });

    it('an explicit initial {from,to} is framed as given', async () => {
        const renderer = new FakeRenderer();
        const range = { from: 1_000, to: 5_000 };
        const chart = new Vela(
            {} as unknown as HTMLElement,
            { bars: 2000, visibleRange: range },
            { renderer, engines: [new MockEngine()], dataFeed: new SizedDataFeed() },
        );
        await chart.ready();
        await flush();
        expect(renderer.visibleRangeCalls).toEqual([range]);
    });

    it('a RANGELESS feed keeps the preview-then-full shape (stepping would re-download the head)', async () => {
        const renderer = new FakeRenderer();
        const feed = {
            load: (cfg: { bars?: number }) => Promise.resolve(makeBars(cfg.bars ?? 500)),
            subscribe: (): Unsubscribe => () => {},
        };
        const chart = new Vela({} as unknown as HTMLElement, { bars: 8000 }, { renderer, engines: [new MockEngine()], dataFeed: feed });
        await chart.ready();
        await flush();
        expect(renderer.setBarsCalls).toEqual([
            { n: 300, preserveView: false },
            { n: 8000, preserveView: true },
        ]);
    });

    it('a small request loads in one shot', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 200 }, { renderer, engines: [new MockEngine()], dataFeed: new SizedDataFeed() });
        await chart.ready();
        await flush();
        expect(renderer.setBarsCalls).toEqual([{ n: 200, preserveView: false }]);
    });

    it('a mid-sized chart loads in one pass and completes with reason depth', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 500 }, { renderer, engines: [new MockEngine()], dataFeed: new SizedDataFeed() });
        const completes: { reason: string; barsLoaded: number }[] = [];
        chart.on('history:complete', (e) => completes.push(e));
        await chart.ready();
        await chart.historyComplete();
        expect(renderer.setBarsCalls).toEqual([{ n: 500, preserveView: false }]);
        expect(completes).toEqual([{ reason: 'depth', oldestTime: renderer.bars[0]!.time, barsLoaded: 500 }]);
    });

    it('very deep charts: a first chunk on screen, then flat 10k steps, remainder-bounded', async () => {
        const renderer = new FakeRenderer();
        const feed = new DeepHistoryFeed(40_000);
        feed.gate = true; // park the backfill so the interactive intermediate state is observable
        const chart = new Vela({} as unknown as HTMLElement, { bars: 25_000, volume: false }, { renderer, engines: [new MockEngine()], dataFeed: feed });
        const progress: { loaded: number; target: number }[] = [];
        const completes: { reason: string; barsLoaded: number }[] = [];
        chart.on('history:progress', (e) => progress.push(e));
        chart.on('history:complete', (e) => completes.push(e));

        await chart.ready(); // resolves at the FIRST paint — interactive on the first full chunk
        expect(renderer.setBarsCalls).toEqual([{ n: 10_000, preserveView: false }]);

        feed.gate = false;
        feed.release(); // let the parked backfill run to completion
        await chart.historyComplete();
        // Flat chunks behind the interactive chart, the last one bounded by the remainder.
        const sizes = [10_000, 20_000, 25_000];
        expect(renderer.setBarsCalls).toEqual(sizes.map((n, i) => ({ n, preserveView: i > 0 })));
        expect(progress).toEqual(sizes.slice(1).map((loaded) => ({ loaded, target: 25_000 })));
        expect(completes).toEqual([{ reason: 'depth', oldestTime: renderer.bars[0]!.time, barsLoaded: 25_000 }]);
        // Steps were requested backward, overlap-by-one, bounded by the remaining depth.
        expect(feed.rangeCalls.map((r) => r.limit)).toEqual([10_001, 5_001]);
        // Bars stay strictly monotonic across every seam.
        for (let i = 1; i < renderer.bars.length; i += 1) expect(renderer.bars[i]!.time).toBeGreaterThan(renderer.bars[i - 1]!.time);
    });

    it('the backfill stops at genesis when a chunk adds nothing older, and reports it', async () => {
        const renderer = new FakeRenderer();
        const feed = new DeepHistoryFeed(12_000); // less than requested exists
        const chart = new Vela({} as unknown as HTMLElement, { bars: 25_000, volume: false }, { renderer, engines: [new MockEngine()], dataFeed: feed });
        const completes: { reason: string; barsLoaded: number }[] = [];
        chart.on('history:complete', (e) => completes.push(e));

        await chart.ready();
        await chart.historyComplete();
        expect(renderer.bars.length).toBe(12_000); // everything that exists
        expect(completes).toEqual([{ reason: 'genesis', oldestTime: renderer.bars[0]!.time, barsLoaded: 12_000 }]);
    });

    it('a failing backfill fetch keeps the loaded bars and completes with reason aborted', async () => {
        const renderer = new FakeRenderer();
        const feed = new DeepHistoryFeed(40_000);
        feed.failRanges = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const chart = new Vela({} as unknown as HTMLElement, { bars: 25_000, volume: false }, { renderer, engines: [new MockEngine()], dataFeed: feed });
        const completes: { reason: string }[] = [];
        chart.on('history:complete', (e) => completes.push(e));

        await chart.ready();
        await chart.historyComplete();
        expect(renderer.bars.length).toBe(10_000); // the painted first chunk survives
        expect(completes).toEqual([expect.objectContaining({ reason: 'aborted', barsLoaded: 10_000 })]);
        warn.mockRestore();
    });

    it('destroy mid-backfill abandons the loop and resolves historyComplete()', async () => {
        const renderer = new FakeRenderer();
        const feed = new DeepHistoryFeed(40_000);
        feed.gate = true; // hold every ranged fetch until released
        const chart = new Vela({} as unknown as HTMLElement, { bars: 25_000, volume: false }, { renderer, engines: [new MockEngine()], dataFeed: feed });
        await chart.ready();
        expect(renderer.bars.length).toBe(10_000);

        chart.destroy();
        feed.release(); // the in-flight step lands AFTER destroy — it must be discarded
        await chart.historyComplete(); // resolves (never hangs) even though the backfill never finished
        await flush();
        expect(renderer.setBarsCalls.length).toBe(1); // the head only — no post-destroy prepend
    });

    it('a policy-A engine executes exactly once, over the FULL backfilled history', async () => {
        const renderer = new FakeRenderer();
        const feed = new DeepHistoryFeed(40_000);
        const engine = new MockEngine();
        engine.policyA = true; // defer under historyState 'backfill' until the 'complete' notification
        const chart = new Vela({} as unknown as HTMLElement, { bars: 25_000, volume: false }, { renderer, engines: [engine], dataFeed: feed });
        const ind = chart.addIndicator('//@version=5\nindicator("Deep", overlay=true)\nplot(close)');

        await chart.ready();
        await chart.historyComplete();
        await flush();
        expect(engine.runCount[ind.id]).toBe(1); // held through both backfill chunks, ran once on 'complete'
        const computed = renderer.mountedModels.filter((m) => m.id === ind.id && m.series.length > 0);
        expect(computed).toHaveLength(1);
        // The single run saw the whole 25k-bar history, not the first chunk.
        expect((computed[0]!.series[0] as { points: unknown[] }).points).toHaveLength(25_000);
    });

    it('last engine registered for a language wins, warning on the replacement', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const first = new MockEngine();
        const second = new MockEngine(); // also 'pine' — replaces the first
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [first, second], dataFeed: new MockDataFeed() });

        const ind = chart.addIndicator('//@version=5\nindicator("X", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        // Last-declared 'pine' engine ran it; the first was replaced (a swap, not a dupe-ignore).
        expect(second.runCount[ind.id] ?? 0).toBeGreaterThan(0);
        expect(first.runCount[ind.id] ?? 0).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('language "pine"'));
        warn.mockRestore();
    });

    it('registerEngine adds an engine after construction', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        chart.registerEngine('pine', engine);

        const ind = chart.addIndicator('//@version=5\nindicator("X", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        expect(engine.runCount[ind.id] ?? 0).toBeGreaterThan(0);
        expect(renderer.mountedModels.some((m) => m.id === ind.id)).toBe(true);
    });

    it('strategy trade executions ride the model into mounts, value patches and inspect()', async () => {
        const renderer = new FakeRenderer();
        const engine = new MockEngine();
        engine.emitTrades = true;
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });

        // 'visible' in the source flags the script viewport-dependent, so a viewport poke re-runs it.
        const ind = chart.addIndicator('//@version=6\nindicator("S", overlay=true)\nx = chart.left_visible_bar_time\nplot(close)');
        await chart.ready();
        await flush();

        // The retained model carries the executions (the first pre-bars emission may not
        // have had them yet — they ride every later emission, mount or value patch).
        const carried = renderer.mountedModels
            .filter((m) => m.id === ind.id)
            .flatMap((m) => m.trades ?? [])
            .concat(renderer.updatedPatches.flatMap((p) => (p.kind === 'value' && p.indicatorId === ind.id ? (p.trades ?? []) : [])));
        expect(carried.some((t) => t.side === 'buy' && t.kind === 'entry' && t.label === 'Long' && t.qty === 2 && t.tradeId === 't1')).toBe(true);

        // inspect() counts them — the oracle's deterministic signal.
        expect(chart.inspect().indicators.find((s) => s.id === ind.id)?.trades).toBe(2);
        expect(chart.inspect().totals.trades).toBe(2);

        // A non-structural re-run value-patches; the executions travel as a full snapshot.
        renderer.updatedPatches.length = 0;
        renderer.fireViewport({ from: 1_700_000_036_000, to: 1_700_000_144_000 });
        await new Promise((r) => setTimeout(r, 220)); // > viewport debounce
        await flush();
        const patch = renderer.updatedPatches.find((p) => p.kind === 'value' && p.indicatorId === ind.id);
        expect(patch?.kind === 'value' ? patch.trades : undefined).toHaveLength(2);
    });

    it('with no engine registered: candles still render, addIndicator raises an actionable error', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });

        const errors: Error[] = [];
        chart.on('indicator:error', (e) => errors.push(e.error));

        const ind = chart.addIndicator('//@version=5\nindicator("X")\nplot(close)');
        await chart.ready();
        await flush();

        // Candles render — the engine isn't needed for market data.
        expect(renderer.bars.length).toBe(50);
        // …but the indicator fails with a message that tells you how to fix it.
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]?.message).toContain('no scripting engine registered');
        expect(errors[0]?.message).toContain('registerEngine');
        expect(renderer.mountedModels.some((m) => m.id === ind.id)).toBe(false);
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});

/**
 * A MockEngine whose static execution does NOT emit until the test releases it —
 * models the window while a heavy script is still computing.
 */
class DeferredEngine extends MockEngine {
    private pending: Array<() => void> = [];
    private failers: Array<(e: Error) => void> = [];
    override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const token = req.prepared.token as { instanceId: string; overlay: boolean };
        this.pending.push(() => {
            handlers.onModel(this.deferredModel(token.instanceId, this.emitOverlay ?? token.overlay));
            handlers.onDone?.();
        });
        this.failers.push((e) => handlers.onError?.(e));
        return { stop: () => {}, update: () => {}, setVisibleRange: () => {}, notifyBars: () => {} };
    }
    /** When set, emitted models carry THIS overlay flag (to diverge from the prepare-time guess). */
    emitOverlay: boolean | undefined;
    /** When set, emitted models carry THIS compact shorttitle. */
    emitShortTitle: string | undefined;
    /** Release every deferred execution (the "compute finished" moment). */
    finish(): void {
        const run = this.pending;
        this.pending = [];
        for (const emit of run) emit();
    }
    /** Fail every deferred execution. */
    failAll(message: string): void {
        const fail = this.failers;
        this.failers = [];
        this.pending = [];
        for (const f of fail) f(new Error(message));
    }
    private deferredModel(id: string, overlay: boolean): IndicatorModel {
        return {
            id, title: 'Mock', overlay, paneHint: overlay ? 'price' : 'new',
            ...(this.emitShortTitle ? { shorttitle: this.emitShortTitle } : {}),
            series: [{ id: `${id}:line:mock#0`, title: 'Mock', paneId: 'unrouted', kind: 'line', points: [{ time: 1, value: 1 }], style: { color: '#fff', width: 1, lineStyle: 'solid' } }],
            fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
        };
    }
}

describe('EngineOrchestrator — loading placeholder + legend status', () => {
    it('mounts a legend placeholder with a loading spinner immediately, before the first computed model', async () => {
        const renderer = new FakeRenderer();
        const engine = new DeferredEngine();
        // volume:false — this test asserts nothing else is announced/inspectable pre-compute.
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const added: string[] = [];
        chart.on('indicator:added', (e) => added.push(e.id));

        const ind = chart.addIndicator('//@version=5\nindicator("Slow")\nplot(close)');
        await chart.ready();
        await flush();

        // Compute still in flight: the placeholder is mounted (empty, routed to a study
        // pane, correct title), the spinner shows, but nothing is announced/inspectable.
        const placeholder = renderer.mountedModels.find((m) => m.id === ind.id);
        expect(placeholder).toBeDefined();
        expect(placeholder?.series).toHaveLength(0);
        expect(placeholder?.title).toBe('Mock');
        expect(placeholder?.paneId).not.toBe('price');
        expect(renderer.statuses[renderer.statuses.length - 1]).toEqual({ id: ind.id, status: 'loading' });
        expect(added).toHaveLength(0);
        expect(chart.inspect().indicators).toHaveLength(0);

        engine.finish();
        await flush();

        // Computed: remounted over the placeholder (same id → legend reused), spinner
        // cleared, announced exactly once, inspect() sees the real content.
        const last = renderer.mountedModels[renderer.mountedModels.length - 1];
        expect(last?.id).toBe(ind.id);
        expect(last?.series).toHaveLength(1);
        expect(renderer.statuses[renderer.statuses.length - 1]).toEqual({ id: ind.id, status: 'idle' });
        expect(added).toEqual([ind.id]);
        expect(chart.inspect().indicators).toHaveLength(1);
        expect(renderer.removed).toHaveLength(0);
    });

    it('keeps the FULL title while loading; the shorttitle arrives with the first computed model', async () => {
        const renderer = new FakeRenderer();
        const engine = new DeferredEngine();
        engine.declareShortTitle = 'MK'; // prepare-time meta already declares the compact name…
        engine.emitShortTitle = 'MK'; // …and the computed model carries it
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });

        const ind = chart.addIndicator('//@version=5\nindicator("Slow", "MK")\nplot(close)');
        await chart.ready();
        await flush();

        // Loading: the placeholder identifies the script by its full name — never the shorttitle.
        const placeholder = renderer.mountedModels.find((m) => m.id === ind.id);
        expect(placeholder?.title).toBe('Mock');
        expect(placeholder?.shorttitle).toBeUndefined();

        engine.finish();
        await flush();

        // Loaded: the computed remount carries the compact name (legend + settings dialog swap to it).
        const last = renderer.mountedModels[renderer.mountedModels.length - 1];
        expect(last?.id).toBe(ind.id);
        expect(last?.title).toBe('Mock');
        expect(last?.shorttitle).toBe('MK');
    });

    it('re-routes to the right pane when the computed overlay differs from the prepare-time guess', async () => {
        const renderer = new FakeRenderer();
        const engine = new DeferredEngine();
        engine.emitOverlay = true; // prepare (regex) sees no overlay=true, the REAL model is an overlay
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });

        const ind = chart.addIndicator('//@version=5\nindicator("Guess")\nplot(close)');
        await chart.ready();
        await flush();
        const placeholderPane = renderer.mountedModels.find((m) => m.id === ind.id)?.paneId;
        expect(placeholderPane).not.toBe('price');

        engine.finish();
        await flush();
        const last = renderer.mountedModels[renderer.mountedModels.length - 1];
        expect(last?.paneId).toBe('price'); // moved to the price pane
        expect(renderer.removedPanes).toContain(placeholderPane); // placeholder study pane torn down
    });

    it('an input change shows the spinner during the re-compute and clears it on the new model', async () => {
        const renderer = new FakeRenderer();
        const engine = new DeferredEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("X")\nplot(close)');
        await chart.ready();
        await flush();
        engine.finish();
        await flush();
        expect(renderer.statuses[renderer.statuses.length - 1]?.status).toBe('idle');

        ind.setInput('Length', 50);
        await flush();
        expect(renderer.statuses[renderer.statuses.length - 1]).toEqual({ id: ind.id, status: 'loading' });
    });

    it('a failed compute stops the spinner and keeps the legend row (removable)', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const renderer = new FakeRenderer();
        const engine = new DeferredEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const errors: Error[] = [];
        chart.on('indicator:error', (e) => errors.push(e.error));

        const ind = chart.addIndicator('//@version=5\nindicator("Boom")\nplot(close)');
        await chart.ready();
        await flush();
        expect(renderer.statuses[renderer.statuses.length - 1]?.status).toBe('loading');

        engine.failAll('kaboom');
        await flush();
        expect(errors.map((e) => e.message)).toContain('kaboom');
        expect(renderer.statuses[renderer.statuses.length - 1]).toEqual({ id: ind.id, status: 'idle' });
        expect(renderer.removed).toHaveLength(0); // the row stays; the user can ✕ it
        renderer.fireRemove(ind.id); // …and removing it still tears down cleanly
        await flush();
        expect(renderer.removed).toContain(ind.id);
        err.mockRestore();
    });
});

/** MockEngine that additionally captures every ExecutionRequest (market metadata / fetchSeries). */
class RequestCaptureEngine extends MockEngine {
    requests: ExecutionRequest[] = [];
    override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        this.requests.push(req);
        return super.execute(req, handlers);
    }
}

describe('EngineOrchestrator — heikin ashi price style (bar transform)', () => {
    const HOUR = 3_600_000;

    it('switching to heikinashi rebuilds the view (viewport preserved) and re-executes indicators on it', async () => {
        const renderer = new FakeRenderer();
        const engine = new RequestCaptureEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("X", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();

        const raw = makeBars(50);
        const ha = heikinAshiFull(raw);
        const runsBefore = engine.runCount[ind.id]!;
        expect(renderer.bars).toEqual(raw);

        renderer.firePriceStyle('heikinashi');
        await flush();
        // The renderer got the DERIVED series without a viewport jump…
        expect(renderer.bars).toEqual(ha);
        expect(renderer.setBarsCalls[renderer.setBarsCalls.length - 1]).toEqual({ n: 50, preserveView: true });
        // …and the indicator re-executed ON the derived series (its plot follows HA closes).
        expect(engine.runCount[ind.id]).toBeGreaterThan(runsBefore);
        const model = renderer.mountedModels[renderer.mountedModels.length - 1]!;
        const points = (model.series[0] as { points: Array<{ value: number | null }> }).points;
        expect(points.map((p) => p.value)).toEqual(ha.map((b) => b.close + 14)); // MockEngine plots close + Length
        expect(engine.requests[engine.requests.length - 1]!.market.chartStyle).toBe('heikinashi');

        // Switching back restores the RAW series (untouched underneath) + re-executes again.
        renderer.firePriceStyle('candles');
        await flush();
        expect(renderer.bars).toEqual(raw);
        expect(engine.requests[engine.requests.length - 1]!.market.chartStyle).toBe('candles');
    });

    it('a chart CONSTRUCTED in heikinashi style loads the derived view from the start', async () => {
        const renderer = new FakeRenderer();
        renderer.priceStyleFeature = 'heikinashi';
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        expect(renderer.bars).toEqual(heikinAshiFull(makeBars(50)));
        void chart;
    });

    it('live ticks derive the HA forming bar incrementally; the bar EVENT stays raw', async () => {
        const feed = new GapFeed(10);
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: true, volume: false }, { renderer, engines: [], dataFeed: feed });
        const seen: OHLCV[] = [];
        chart.on('bar', (b) => seen.push(b));
        await chart.ready();
        await flush();
        renderer.firePriceStyle('heikinashi');
        await flush();

        const raw = makeBars(10);
        const lastT = raw[9]!.time;
        // Replace the forming bar, then append a new one.
        const corrected = mkBar(lastT, 105);
        const appended = mkBar(lastT + HOUR, 106);
        feed.push!(corrected);
        feed.push!(appended);
        await flush();

        // The renderer received DERIVED bars, exactly matching a full recompute of the raw stream.
        const expected = heikinAshiFull([...raw.slice(0, 9), corrected, appended]);
        expect(renderer.updatedBars.slice(-2)).toEqual([expected[9], expected[10]]);
        // The 'bar' event carried the RAW bars — the data plane never sees synthetic values.
        expect(seen.slice(-2)).toEqual([corrected, appended]);
    });

    it('fetchSeries: the extended-ticker modifier decides — plain symbols stay raw, ";heikinashi" transforms', async () => {
        const renderer = new FakeRenderer();
        const engine = new RequestCaptureEngine();
        const chart = new Vela(
            {} as unknown as HTMLElement,
            { symbol: 'TEST', live: false, volume: false },
            { renderer, engines: [engine], dataFeed: new MockDataFeed() },
        );
        chart.addIndicator('//@version=5\nindicator("X", overlay=true)\nplot(close)');
        await chart.ready();
        await flush();
        renderer.firePriceStyle('heikinashi');
        await flush();

        const gateway = engine.requests[engine.requests.length - 1]!.fetchSeries!;
        const raw = makeBars(50); // MockDataFeed serves the same series for any symbol
        const ha = heikinAshiFull(raw);
        // The engine composes the modifier (syminfo.tickerid carries ";heikinashi" on an HA
        // chart); the gateway itself is explicit-only — a plain symbol is a standard-data
        // request even for the chart's own symbol (ticker.standard() semantics).
        await expect(gateway('TEST', '60', { limit: 50 })).resolves.toEqual(raw); // plain → raw, chart symbol or not
        await expect(gateway('OTHER', '60', { limit: 50 })).resolves.toEqual(raw);
        await expect(gateway('TEST;heikinashi', '60', { limit: 50 })).resolves.toEqual(ha); // explicit opt-in
        await expect(gateway('OTHER;heikinashi', '60', { limit: 50 })).resolves.toEqual(ha);
        await expect(gateway('TEST;standard', '60', { limit: 50 })).resolves.toEqual(raw); // explicit opt-out marker
    });
});

describe('EngineOrchestrator — built-in volume native indicators', () => {
    async function makeChart(options: { volume?: boolean } = {}): Promise<{ chart: Vela; renderer: FakeRenderer }> {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, ...options }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        return { chart, renderer };
    }

    it('auto-adds the volume indicator by default and pushes its layer config', async () => {
        const { chart, renderer } = await makeChart();
        const model = renderer.mountedModels.find((m) => m.native?.type === 'volume');
        expect(model).toBeDefined(); // legend row mounted (no series — the layer draws outside the model)
        expect(model!.series).toHaveLength(0);
        expect(model!.paneId).toBe('price');
        expect(renderer.volumePushes).toEqual([{ upColor: BULLISH, downColor: BEARISH, heightFrac: 0.2 }]);
        const summary = chart.inspect().indicators.find((s) => s.nativeType === 'volume');
        expect(summary?.native).toBe(true);
        expect(summary?.inputs).toBe(3); // colors + height% drive the settings dialog
    });

    it('volume: false opts out; a manual add still works and stays single-instance', async () => {
        const { chart, renderer } = await makeChart({ volume: false });
        expect(renderer.volumePushes).toHaveLength(0);
        expect(chart.inspect().indicators.some((s) => s.nativeType === 'volume')).toBe(false);

        const h1 = chart.addNativeIndicator('volume');
        await flush();
        expect(renderer.volumePushes).toHaveLength(1);
        const h2 = chart.addNativeIndicator('volume'); // second add returns the existing handle
        expect(h2.id).toBe(h1.id);
        expect(renderer.mountedModels.filter((m) => m.native?.type === 'volume')).toHaveLength(1);
    });

    it('an input change re-pushes the resolved config (percent → fraction, clamped)', async () => {
        const { chart, renderer } = await makeChart();
        const handle = chart.addNativeIndicator('volume'); // existing (auto-added) handle
        handle.setInputs({ upColor: '#112233', heightPct: 35 });
        await flush();
        const last = renderer.volumePushes[renderer.volumePushes.length - 1] as { upColor: string; downColor: string; heightFrac: number };
        expect(last).toEqual({ upColor: '#112233', downColor: BEARISH, heightFrac: 0.35 });
    });

    it('the VPVR is not auto-added; adding it mounts a legend row and pushes its config', async () => {
        const { chart, renderer } = await makeChart();
        expect(renderer.vpvrPushes).toHaveLength(0);

        chart.addNativeIndicator('vpvr');
        await flush();
        const model = renderer.mountedModels.find((m) => m.native?.type === 'vpvr');
        expect(model).toBeDefined();
        expect(model!.title).toBe('Visible Range Volume Profile');
        expect(model!.shorttitle).toBe('VRVP');
        expect(model!.series).toHaveLength(0);
        expect(model!.paneId).toBe('price');
        expect(renderer.vpvrPushes).toEqual([
            { rows: 24, widthFrac: 0.3, upColor: ACCENT, downColor: BEARISH, showPoc: true, valueAreaFrac: 0.7 },
        ]);
        expect(chart.inspect().indicators.some((s) => s.nativeType === 'vpvr')).toBe(true);
    });

    it('hide suspends via the renderer flag; show re-pushes the config', async () => {
        const { chart, renderer } = await makeChart();
        const native = chart.inspect().indicators.find((s) => s.nativeType === 'volume')!;
        const pushesBefore = renderer.volumePushes.length;

        renderer.fireToggleVisible(native.id, false); // the legend eye
        await flush();
        expect(renderer.indicatorVisible.get(native.id)).toBe(false); // layer suppressed, row kept

        renderer.fireToggleVisible(native.id, true);
        await flush();
        expect(renderer.indicatorVisible.get(native.id)).toBe(true);
        expect(renderer.volumePushes.length).toBeGreaterThan(pushesBefore); // resume re-pushed the config
    });

    it('remove tears the indicator down (legend + registry)', async () => {
        const { chart, renderer } = await makeChart();
        const native = chart.inspect().indicators.find((s) => s.nativeType === 'volume')!;
        renderer.fireRemove(native.id);
        await flush();
        expect(renderer.removed).toContain(native.id);
        expect(chart.inspect().indicators.some((s) => s.nativeType === 'volume')).toBe(false);
    });
});

describe('EngineOrchestrator — chart-type SDK (registerChartType)', () => {
    afterEach(() => unregisterChartType('doubled'));

    const DOUBLE: BarTransform = {
        full: (raw) => raw.map((b) => ({ ...b, open: b.open * 2, high: b.high * 2, low: b.low * 2, close: b.close * 2 })),
        next: (raw) => ({ ...raw, open: raw.open * 2, high: raw.high * 2, low: raw.low * 2, close: raw.close * 2 }),
    };

    it('a registered bar-transform type rides the same path as the built-in heikinashi', async () => {
        registerChartType({ id: 'doubled', barTransform: DOUBLE });
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        const raw = makeBars(50);
        expect(renderer.bars).toEqual(raw);

        renderer.firePriceStyle('doubled');
        await flush();
        expect(renderer.bars).toEqual(DOUBLE.full(raw)); // the view is the plugin's derived series
        expect(renderer.setBarsCalls[renderer.setBarsCalls.length - 1]).toEqual({ n: 50, preserveView: true });

        renderer.firePriceStyle('candles');
        await flush();
        expect(renderer.bars).toEqual(raw); // raw underneath, untouched
        void chart;
    });

    it('a data-engine type starts on entry, pushes through its channels, suspends/resumes, stops at destroy', async () => {
        const calls: string[] = [];
        let host: SeriesDataEngineHost | null = null;
        registerChartType({
            id: 'doubled',
            dataEngine: () => ({
                start(h) {
                    calls.push('start');
                    host = h;
                    h.pushData(['payload']);
                    h.pushPending([[1, 2]]);
                },
                suspend() { calls.push('suspend'); },
                resume() { calls.push('resume'); },
                stop() { calls.push('stop'); },
                onViewport(r) { calls.push(`viewport:${r.from}`); },
            }),
        });
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();

        renderer.firePriceStyle('doubled');
        await flush();
        expect(calls).toEqual(['start']); // created lazily, started after ready
        expect(renderer.nativePushes).toContainEqual(['doubled', ['payload']]); // data channel = the style id
        expect(renderer.nativePushes).toContainEqual(['doubled-pending', [[1, 2]]]); // the loading protocol channel
        expect(host!.bars().length).toBe(50); // the host serves the chart's current view bars
        expect(host!.live).toBe(false);

        // Pan/zoom pokes the ACTIVE engine (debounced).
        renderer.fireViewport({ from: 123, to: 456 });
        await new Promise((r) => setTimeout(r, 220));
        expect(calls).toContain('viewport:123');

        renderer.firePriceStyle('candles');
        await flush();
        expect(calls[calls.length - 1]).toBe('suspend'); // leaving the style suspends, never stops

        renderer.firePriceStyle('doubled');
        await flush();
        expect(calls[calls.length - 1]).toBe('resume'); // re-entry is a cheap resume

        chart.destroy();
        expect(calls[calls.length - 1]).toBe('stop'); // destroy releases the engine
    });

    it('a chart CONSTRUCTED in an engine style starts the engine once ready', async () => {
        const calls: string[] = [];
        registerChartType({ id: 'doubled', dataEngine: () => ({ start: () => { calls.push('start'); }, suspend() {}, resume() {}, stop() {} }) });
        const renderer = new FakeRenderer();
        renderer.priceStyleFeature = 'doubled';
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        expect(calls).toEqual(['start']);
        chart.destroy();
    });
});

describe('Vela.runIndicator — execute-and-inject with structured failure', () => {
    async function makeChart(engine: MockEngine) {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        return { chart, renderer };
    }

    it('resolves ok with the live handle after the first successful evaluation', async () => {
        const { chart } = await makeChart(new MockEngine());
        const result = await chart.runIndicator('plot(close)');
        expect(result.ok).toBe(true);
        expect(result.error).toBeNull();
        expect(result.handle).not.toBeNull();
        expect(chart.indicators().some((h) => h.id === result.handle!.id)).toBe(true);
    });

    it('resolves ok:false with the error and removes the failed indicator again', async () => {
        const engine = new DeferredEngine();
        const { chart } = await makeChart(engine);
        const before = chart.indicators().length; // the auto-added volume indicator
        const pending = chart.runIndicator('plot(close)');
        await flush();
        expect(chart.indicators().length).toBe(before + 1); // mounted while running
        engine.failAll('boom: bad script');
        const result = await pending;
        expect(result.ok).toBe(false);
        expect(result.handle).toBeNull();
        expect(result.error?.message).toContain('boom: bad script');
        await flush();
        expect(chart.indicators().length).toBe(before); // no dead legend row left behind
    });
});

const STRATEGY_STATE = {
    position: 2,
    avgPrice: 100,
    equity: 10_500,
    openPnl: 250,
    netPnl: 500,
    grossProfit: 700,
    grossLoss: 200,
    wins: 3,
    losses: 1,
    even: 0,
    maxDrawdown: 80,
    maxRunup: 300,
    initialCapital: 10_000,
};

describe('handle.context — positive proof the capability is wired end to end', () => {
    class ContextEngine extends MockEngine {
        override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
            const base = super.execute(req, handlers);
            return {
                ...base,
                getContext: (select): Promise<EngineContextSnapshot | null> =>
                    Promise.resolve({
                        language: 'pine',
                        phase: 'idle' as const,
                        barIndex: 9,
                        meta: { title: 'Ctx', overlay: false },
                        plots: (select && !select.includes('plots') ? {} : { a: [{ time: 1, value: 2 }] }) as EngineContextSnapshot['plots'],
                        variables: {},
                        strategy: STRATEGY_STATE,
                        warnings: [],
                    }),
            };
        }
    }

    it('resolves a snapshot through handle.context and fires context:changed', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [new ContextEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const changed: string[] = [];
        chart.on('context:changed', ({ id }) => changed.push(id));
        const handle = chart.addIndicator('plot(close)');
        await flush();
        const snap = await handle.context();
        expect(snap).not.toBeNull(); // would FAIL if the session wiring silently vanished
        expect(snap!.strategy).toEqual(STRATEGY_STATE);
        expect(snap!.barIndex).toBe(9);
        const filtered = await handle.context(['strategy']);
        expect(filtered!.plots).toEqual({}); // select honored
        expect(changed).toContain(handle.id); // the notification fired for a capable session
        chart.destroy();
    });

    it('resolves null (not a hang, not a throw) on an engine without the capability', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [new MockEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const handle = chart.addIndicator('plot(close)');
        await flush();
        expect(await handle.context()).toBeNull();
        chart.destroy();
    });
});

describe('chart.panBy — the drag-equivalent keyboard pan', () => {
    class PanRenderer extends FakeRenderer {
        range: VisibleRange | null = { from: 10_000, to: 20_000 };
        override getVisibleRange(): VisibleRange | null {
            return this.range;
        }
        panCalls: number[] = [];
        panBy(fraction: number): void {
            this.panCalls.push(fraction);
        }
    }

    it("prefers the renderer's own drag-clamped pan when it has one", async () => {
        const renderer = new PanRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        const before = renderer.visibleRangeCalls.length;
        chart.panBy(0.2);
        chart.panBy(-0.2);
        expect(renderer.panCalls).toEqual([0.2, -0.2]); // fraction passes through untouched
        expect(renderer.visibleRangeCalls.length).toBe(before); // never the range fallback
        chart.destroy();
    });

    it('falls back to an instant range shift on a renderer without panBy', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        const before = renderer.visibleRangeCalls.length;
        chart.panBy(0.5); // FakeRenderer.getVisibleRange() is null → nothing to shift, no throw
        expect(renderer.visibleRangeCalls.length).toBe(before);

        class RangedRenderer extends FakeRenderer {
            override getVisibleRange(): VisibleRange | null {
                return { from: 10_000, to: 20_000 };
            }
        }
        const ranged = new RangedRenderer();
        const chart2 = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: ranged, engines: [], dataFeed: new MockDataFeed() });
        await chart2.ready();
        const n = ranged.visibleRangeCalls.length;
        chart2.panBy(0.5); // span 10000 × 0.5 → shift +5000
        expect(ranged.visibleRangeCalls.length).toBe(n + 1);
        expect(ranged.visibleRangeCalls[n]).toEqual({ from: 15_000, to: 25_000 });
        chart2.panBy(-0.5);
        expect(ranged.visibleRangeCalls[n + 1]).toEqual({ from: 5_000, to: 15_000 });
        chart.destroy();
        chart2.destroy();
    });
});

describe('chart-type SDK settings — renderer edits reach the type engine', () => {
    it('forwards onChartTypeSettingsChange to the ACTIVE type engine onSettings', async () => {
        const received: Array<Record<string, unknown>> = [];
        registerChartType({
            id: 'settings-type',
            dataEngine: () => ({
                start() {},
                suspend() {},
                resume() {},
                stop() {},
                onSettings: (values) => received.push(values),
            }),
        });
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [], dataFeed: new MockDataFeed() });
        await chart.ready();
        await flush();
        renderer.firePriceStyle('settings-type'); // enter the style → the engine starts
        await flush();
        renderer.ctsCb?.('settings-type', { levels: 12 });
        expect(received).toEqual([{ levels: 12 }]); // positive proof of the whole path
        renderer.ctsCb?.('other-type', { x: 1 });
        expect(received).toHaveLength(1); // only the matching engine hears it
        unregisterChartType('settings-type');
        chart.destroy();
    });
});

// ── script:run — the run IS the payload ────────────────────────────────────────────
/** A MockEngine that also answers `getContext`, so a run can carry vars/strategy/trades. */
class RunEngine extends MockEngine {
    contextCalls: ContextSelect[] = [];
    strategy: typeof STRATEGY_STATE | undefined = STRATEGY_STATE;

    override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const base = super.execute(req, handlers);
        return {
            ...base,
            getContext: (select): Promise<EngineContextSnapshot | null> => {
                this.contextCalls.push(select ?? []);
                return Promise.resolve({
                    language: 'pine',
                    phase: 'idle' as const,
                    barIndex: 49,
                    meta: { title: 'Ctx', overlay: false },
                    plots: { Mock: [{ time: 1, value: 2 }] },
                    variables: { posSize: 2, len: 14 },
                    ...(this.strategy ? { strategy: this.strategy } : {}),
                    trades: [{ id: 't1', side: 'long' as const, qty: 2, entry: { id: 'Long', time: 1, price: 100 }, open: true }],
                    warnings: [],
                });
            },
        };
    }
}

describe('script:run — the run carries the data, not a signal to go fetch it', () => {
    it('the first run reports the declared title, its plots, and cause "history"', async () => {
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [new RunEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const runs: ScriptRun[] = [];
        chart.on('script:run', (run) => runs.push(run));
        chart.addIndicator('plot(close)');
        await flush();

        expect(runs).toHaveLength(1);
        const run = runs[0]!;
        expect(run.title).toBe('Mock'); // the DECLARED title, not the 'Indicator' placeholder
        expect(run.cause).toBe('history');
        expect(run.first).toBe(true);
        expect(run.kind).toBe('strategy'); // the engine reported broker state
        expect(run.strategy).toEqual(STRATEGY_STATE);
        expect(run.vars).toEqual({ posSize: 2, len: 14 }); // source names, at the current bar
        expect(typeof run.plots.Mock).toBe('number'); // the plot's value at the last bar
        expect(run.forming).toBe(false); // not a live chart
        expect(run.complete).toBe(true);
        chart.destroy();
    });

    it('costs nothing when nobody listens — no context pull without a subscriber', async () => {
        const engine = new RunEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [engine], dataFeed: new MockDataFeed() });
        await chart.ready();
        chart.addIndicator('plot(close)');
        await flush();
        expect(engine.contextCalls).toHaveLength(0); // would FAIL if the payload were built eagerly

        chart.on('script:run', () => undefined);
        chart.indicators()[0]!.setInput('Length', 21);
        await flush();
        expect(engine.contextCalls.length).toBeGreaterThan(0);
        chart.destroy();
    });

    it('the unbounded parts stay off the event: trades() is a separate, explicit pull', async () => {
        const engine = new RunEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [engine], dataFeed: new MockDataFeed() });
        await chart.ready();
        const runs: ScriptRun[] = [];
        chart.on('script:run', (run) => runs.push(run));
        chart.addIndicator('plot(close)');
        await flush();

        expect(engine.contextCalls.every((s) => !s.includes('trades'))).toBe(true); // never rides the run
        const trades = await runs[0]!.trades();
        expect(trades).toHaveLength(1);
        expect(engine.contextCalls.some((s) => s.includes('trades'))).toBe(true); // pulled on demand
        chart.destroy();
    });

    it('attributes an input edit to "inputs" and a market switch to "market"', async () => {
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [new RunEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const causes: string[] = [];
        chart.on('script:run', (run) => causes.push(run.cause));
        chart.addIndicator('plot(close)');
        await flush();
        causes.length = 0;

        chart.indicators()[0]!.setInput('Length', 21);
        await flush();
        expect(causes).toContain('inputs');

        causes.length = 0;
        await chart.setMarket({ timeframe: '240' });
        await flush();
        expect(causes).toContain('market');
        chart.destroy();
    });

    it('a new bar is "bar" and is never throttled away; forming-bar ticks collapse', async () => {
        const feed = new GapFeed(50);
        const engine = new RunEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: true, volume: false }, { renderer: new FakeRenderer(), engines: [engine], dataFeed: feed });
        await chart.ready();
        const runs: ScriptRun[] = [];
        chart.on('script:run', (run) => runs.push(run));
        const handle = chart.addIndicator('plot(close)');
        await flush();
        runs.length = 0;

        const last = makeBars(50)[49]!;
        // Three refinements of the SAME bar, back to back: the stream emits one model each.
        for (let i = 1; i <= 3; i += 1) {
            feed.push!({ ...last, close: last.close + i });
            engine.emitStream(handle.id);
            await flush();
        }
        expect(runs.filter((r) => r.cause === 'tick')).toHaveLength(1); // collapsed to ~1/s

        // A NEW bar opens: the previous one is final, and this must never be dropped.
        feed.push!({ ...last, time: last.time + 3_600_000 });
        engine.emitStream(handle.id);
        await flush();
        const closed = runs.filter((r) => r.cause === 'bar');
        expect(closed).toHaveLength(1); // would FAIL if the throttle treated it like a tick
        expect(closed[0]!.forming).toBe(true); // the newly opened bar is itself provisional
        chart.destroy();
    });

    it('never fires for a native indicator — there is no script to run', async () => {
        registerNativeIndicator(testNativeDescriptor);
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [new RunEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const runs: ScriptRun[] = [];
        chart.on('script:run', (run) => runs.push(run));
        chart.addNativeIndicator('test-native');
        await flush();
        expect(runs).toHaveLength(0);
        unregisterNativeIndicator('test-native');
        chart.destroy();
    });
});

describe('chart.runScript — execute and receive the run', () => {
    it('resolves the FIRST run, then follows later ones through onUpdate', async () => {
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [new RunEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const result = await chart.runScript('plot(close)');

        expect(result.ok).toBe(true);
        expect(result.run).not.toBeNull(); // would FAIL if it resolved on `ready` instead of the run
        expect(result.run!.title).toBe('Mock');
        expect(result.run!.strategy).toEqual(STRATEGY_STATE);

        const later: ScriptRun[] = [];
        result.onUpdate((run) => later.push(run));
        chart.indicators()[0]!.setInput('Length', 21);
        await flush();
        expect(later.map((r) => r.cause)).toContain('inputs');

        result.remove();
        await flush();
        expect(chart.indicators()).toHaveLength(0);
        chart.destroy();
    });

    it('a failing script resolves ok:false and leaves no dead legend row', async () => {
        class FailingEngine extends RunEngine {
            override prepare(): Promise<PreparedScript> {
                return Promise.reject(new Error('compile blew up'));
            }
        }
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer: new FakeRenderer(), engines: [new FailingEngine()], dataFeed: new MockDataFeed() });
        await chart.ready();
        const result = await chart.runScript('bad(');
        expect(result.ok).toBe(false);
        expect(result.run).toBeNull();
        expect(result.error?.message).toBe('compile blew up');
        expect(chart.indicators()).toHaveLength(0);
        chart.destroy();
    });
});

/** A study engine whose model carries `force_overlay`-flagged items next to own ones. */
class ForcedOverlayEngine extends MockEngine {
    override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const token = req.prepared.token as { instanceId: string };
        const id = token.instanceId;
        const bars = req.getBars?.() ?? req.bars;
        const points = bars.map((b) => ({ time: b.time, value: b.close }));
        const line = (name: string, overlay: boolean): DrawingLine => ({
            id: `${id}:line-drawing:${name}`, paneId: 'unrouted', xloc: 'bar_time',
            x1: bars[0]!.time, y1: 100, x2: bars[1]!.time, y2: 101, extend: 'none',
            invisible: false, width: 1, style: 'solid', arrowLeft: false, arrowRight: false, overlay,
        });
        handlers.onModel({
            id, title: 'Mock', overlay: false, paneHint: 'new',
            series: [
                { id: `${id}:line:own#0`, title: 'own', paneId: 'unrouted', kind: 'line', points, style: { color: '#fff', width: 1, lineStyle: 'solid' } },
                { id: `${id}:line:forced#0`, title: 'forced', paneId: 'unrouted', kind: 'line', points, overlay: true, style: { color: '#0f0', width: 1, lineStyle: 'solid' } },
            ],
            fills: [],
            backgrounds: [{ id: `${id}:bg#0`, paneId: 'unrouted', from: bars[0]!.time, to: bars[1]!.time, color: '#123456', overlay: true }],
            priceLines: [],
            lines: [line('own', false), line('forced', true)],
            boxes: [
                { id: `${id}:box:own`, paneId: 'unrouted', xloc: 'bar_time', left: bars[0]!.time, top: 105, right: bars[1]!.time, bottom: 95, extend: 'none', borderWidth: 1, borderStyle: 'solid', textSize: 'auto', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false, overlay: false },
                { id: `${id}:box:forced`, paneId: 'unrouted', xloc: 'bar_time', left: bars[0]!.time, top: 105, right: bars[1]!.time, bottom: 95, extend: 'none', borderWidth: 1, borderStyle: 'solid', textSize: 'auto', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false, overlay: true },
            ],
            labels: [
                { id: `${id}:label:own`, paneId: 'unrouted', xloc: 'bar_time', x: bars[0]!.time, y: 100, yloc: 'price', style: 'label_down', size: 'normal', textAlign: 'center', fontFamily: 'default', overlay: false },
                { id: `${id}:label:forced`, paneId: 'unrouted', xloc: 'bar_time', x: bars[0]!.time, y: 100, yloc: 'price', style: 'label_down', size: 'normal', textAlign: 'center', fontFamily: 'default', overlay: true },
            ],
            polylines: [
                { id: `${id}:poly:own`, paneId: 'unrouted', points: [{ xloc: 'bar_time', x: bars[0]!.time, price: 100 }, { xloc: 'bar_time', x: bars[1]!.time, price: 101 }], curved: false, closed: false, lineWidth: 1, lineStyle: 'solid', arrowLeft: false, arrowRight: false, overlay: false },
                { id: `${id}:poly:forced`, paneId: 'unrouted', points: [{ xloc: 'bar_time', x: bars[0]!.time, price: 100 }, { xloc: 'bar_time', x: bars[1]!.time, price: 101 }], curved: false, closed: false, lineWidth: 1, lineStyle: 'solid', arrowLeft: false, arrowRight: false, overlay: true },
            ],
            linefills: [
                { id: `${id}:lf:own`, paneId: 'unrouted', line1: line('lf-own-a', false), line2: line('lf-own-b', false), color: '#123456', overlay: false },
                { id: `${id}:lf:forced`, paneId: 'unrouted', line1: line('lf-forced-a', true), line2: line('lf-forced-b', true), color: '#654321', overlay: true },
            ],
            tables: [{ id: `${id}:tb#0`, paneId: 'unrouted', position: 'top_right', columns: 1, rows: 1, frameWidth: 0, borderWidth: 0, cells: [[null]], merges: [], overlay: true }],
            inputs: [], inputValues: {},
        });
        handlers.onDone?.();
        return { stop: () => {}, update: () => {}, setVisibleRange: () => {}, notifyBars: () => {} };
    }
}

/** An engine that exposes a declaration-props schema and records what it receives. */
class PropsEngine extends MockEngine {
    executeProps: Array<Record<string, InputValue> | undefined> = [];
    updates: Array<{ inputs: Record<string, InputValue>; props?: Record<string, InputValue> }> = [];

    override prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({
            language: 'pine',
            inputs: [{ key: 'Length', title: 'Length', type: 'int', defval: 14 }],
            props: [
                { key: 'initial_capital', title: 'Initial capital', type: 'float', defval: 50000 },
                { key: 'pyramiding', title: 'Pyramiding', type: 'int', defval: 0 },
            ],
            meta: { title: 'Props', overlay: false },
            reactsToViewport: false,
            token: { instanceId, overlay: false },
        });
    }

    override execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const token = req.prepared.token as { instanceId: string };
        this.executeProps.push(req.props);
        const emit = (): void => {
            handlers.onModel({
                id: token.instanceId,
                title: 'Props',
                overlay: false,
                paneHint: 'new',
                series: [],
                fills: [],
                backgrounds: [],
                priceLines: [],
                inputs: req.prepared.inputs,
                inputValues: req.inputs ?? {},
            });
            handlers.onDone?.();
        };
        emit();
        return {
            stop: () => {},
            update: (inputs, props) => {
                this.updates.push({ inputs, ...(props ? { props } : {}) });
                emit();
            },
            setVisibleRange: () => {},
            notifyBars: () => {},
        };
    }
}

describe('EngineOrchestrator — declaration props', () => {
    it('merges schema defaults with add-time overrides and passes them to execute', async () => {
        const renderer = new FakeRenderer();
        const engine = new PropsEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('indicator("P")', { props: { initial_capital: 25000 } });
        await chart.ready();
        await flush();

        // Schema defaults fill the gaps; the add-time override wins on its key.
        expect(engine.executeProps[0]).toEqual({ initial_capital: 25000, pyramiding: 0 });
        // The handle exposes the props schema once prepared.
        expect(ind.props.map((p) => p.key)).toEqual(['initial_capital', 'pyramiding']);
        chart.destroy();
    });

    it('setProps re-runs the session with merged prop overrides', async () => {
        const renderer = new FakeRenderer();
        const engine = new PropsEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('indicator("P")');
        await chart.ready();
        await flush();

        ind.setProps({ pyramiding: 3 });
        expect(engine.updates).toHaveLength(1);
        expect(engine.updates[0]!.props).toEqual({ initial_capital: 50000, pyramiding: 3 });
        // Inputs travel alongside — the session re-runs with both bags current.
        expect(engine.updates[0]!.inputs).toEqual({ Length: 14 });

        // setProp (singular) merges on top of the previous overrides.
        ind.setProp('initial_capital', 10000);
        expect(engine.updates[1]!.props).toEqual({ initial_capital: 10000, pyramiding: 3 });
        chart.destroy();
    });

    it("routes a renderer 'prop' edit to the props bag and an input edit to inputs", async () => {
        const renderer = new FakeRenderer();
        const engine = new PropsEngine();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [engine], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('indicator("P")');
        await chart.ready();
        await flush();

        renderer.fireInputChange({ indicatorId: ind.id, key: 'initial_capital', value: 75000, kind: 'prop' });
        expect(engine.updates[0]!.props).toEqual({ initial_capital: 75000, pyramiding: 0 });

        renderer.fireInputChange({ indicatorId: ind.id, key: 'Length', value: 21 });
        expect(engine.updates[1]!.inputs).toEqual({ Length: 21 });
        // An input edit re-runs through update(inputs) — prop overrides are not resent
        // but stay intact for the NEXT props-driven update.
        renderer.fireInputChange({ indicatorId: ind.id, key: 'pyramiding', value: 1, kind: 'prop' });
        expect(engine.updates[2]!.props).toEqual({ initial_capital: 75000, pyramiding: 1 });
        chart.destroy();
    });
});

describe('EngineOrchestrator — force_overlay routing', () => {
    it('stamps force_overlay items with the price pane while own items keep the study pane', async () => {
        const renderer = new FakeRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false }, { renderer, engines: [new ForcedOverlayEngine()], dataFeed: new MockDataFeed() });
        const ind = chart.addIndicator('//@version=5\nindicator("Study")\nplot(close)');
        await chart.ready();
        await flush();

        // The loading placeholder mounts first (empty series); the computed model remounts last.
        const mounted = renderer.mountedModels.filter((x) => x.id === ind.id);
        const m = mounted[mounted.length - 1]!;
        const studyPane = m.paneId!;
        expect(studyPane).not.toBe('price'); // the indicator itself still routes to its own pane

        expect(m.series.find((s) => s.title === 'own')?.paneId).toBe(studyPane);
        expect(m.series.find((s) => s.title === 'forced')?.paneId).toBe('price');
        expect(m.backgrounds[0]?.paneId).toBe('price');
        expect(m.tables?.[0]?.paneId).toBe('price');
        // Every drawing kind: the forced instance routes to price, the own one stays put.
        for (const kind of ['lines', 'boxes', 'labels', 'polylines', 'linefills'] as const) {
            const items = m[kind]!;
            expect(items.find((d) => d.id.endsWith(':own'))?.paneId).toBe(studyPane);
            expect(items.find((d) => d.id.endsWith(':forced'))?.paneId).toBe('price');
        }

        // The deterministic oracle signal: inspect() counts the flagged items.
        const summary = chart.inspect().indicators.find((s) => s.id === ind.id)!;
        // forced series + background + table + one of each drawing kind (line, box, label, polyline, linefill)
        expect(summary.forcedOverlay).toBe(8);
        chart.destroy();
    });
});
