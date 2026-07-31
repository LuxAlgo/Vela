// chart.setMarket() — the in-place market switch. The chart instance survives: bars
// reload through the shared pipeline, Pine sessions re-execute over the new market,
// native indicators restart with a fresh context, the active chart-type data engine is
// rebuilt, the live subscription re-targets, and history tracking re-arms per load.
import { describe, it, expect, afterEach } from 'vitest';
import { Vela } from '../src/index';
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
import type { MarketConfig } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { VelaTheme } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import { registerNativeIndicator, unregisterNativeIndicator, type NativeIndicatorDescriptor, type NativeIndicatorContext } from '../src/core/native-indicators/NativeIndicator';
import { registerChartType, unregisterChartType, type SeriesDataEngineHost } from '../src/chart-types/registry';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/** Synthetic hourly bars whose close encodes the SYMBOL (so the painted market is assertable). */
function makeBars(n: number, base: number): OHLCV[] {
    const bars: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        bars.push({ time: 1_700_000_000_000 + i * 3_600_000, open: base, high: base + 1, low: base - 1, close: base, volume: 1 });
    }
    return bars;
}

const PRICE: Record<string, number> = { AAA: 100, BBB: 200, CCC: 300, SLOW: 900 };

/** Per-symbol feed: records loads/ranges, counts live (un)subscriptions, gates slow symbols. */
class SwitchFeed implements MarketDataFeed {
    loads: MarketConfig[] = [];
    rangeCalls: BarRange[] = [];
    subs: Record<string, number> = {};
    unsubs: Record<string, number> = {};
    /** Symbols whose LOAD is held until release() — the parked/slow-load knob. */
    readonly gatedLoads = new Set<string>();
    /** Symbols whose LOAD rejects — the provider-failure knob. */
    readonly failLoads = new Set<string>();
    /** Hold every loadRange until release() — races a backfill against a switch. */
    gateRanges = false;
    /** Bars available per symbol (default 50). */
    depth: Record<string, number> = {};
    private waiters: Array<() => void> = [];
    private unresolvedCb: ((info: { symbol: string; providers: string[] }) => void) | null = null;

    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        this.loads.push({ ...cfg });
        if (cfg.data?.length) return cfg.data;
        const sym = cfg.symbol ?? 'TEST';
        if (this.failLoads.has(sym)) throw new Error(`no venue serves ${sym}`);
        if (this.gatedLoads.has(sym)) await new Promise<void>((r) => this.waiters.push(r));
        const have = this.depth[sym] ?? 50;
        // The TAIL of the symbol's fixed universe — so a progressive head + its ranged
        // extensions see one consistent market (loadRange shares the same makeBars grid).
        return makeBars(have, PRICE[sym] ?? 1).slice(-Math.min(cfg.bars ?? 500, have));
    }

    onUnresolved(cb: (info: { symbol: string; providers: string[] }) => void): () => void {
        this.unresolvedCb = cb;
        return () => {
            this.unresolvedCb = null;
        };
    }

    /** Report a parked load (what MultiProviderFeed does for a symbol nothing serves). */
    park(symbol: string): void {
        this.unresolvedCb?.({ symbol, providers: [] });
    }

    async loadRange(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls.push({ ...range });
        if (this.gateRanges) await new Promise<void>((r) => this.waiters.push(r));
        const sym = cfg.symbol ?? 'TEST';
        const all = makeBars(this.depth[sym] ?? 50, PRICE[sym] ?? 1);
        const to = range.to ?? Infinity;
        let out = all.filter((b) => b.time <= to);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return out;
    }

    /** Release every held load/range. */
    release(): void {
        const w = this.waiters;
        this.waiters = [];
        for (const r of w) r();
    }

    subscribe(cfg: MarketConfig, _onBar: (bar: OHLCV) => void): Unsubscribe {
        const sym = cfg.symbol ?? 'TEST';
        this.subs[sym] = (this.subs[sym] ?? 0) + 1;
        return () => {
            this.unsubs[sym] = (this.unsubs[sym] ?? 0) + 1;
        };
    }
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    /** Test knob: the price style a chart is CONSTRUCTED in (drives chart-type engines). */
    priceStyleFeature: unknown = undefined;
    bars: OHLCV[] = [];
    setBarsCalls: { n: number; close: number | undefined; preserveView: boolean }[] = [];
    visibleRangeCalls: VisibleRange[] = [];
    nativePushes: Array<[string, unknown]> = [];
    mountedModels: IndicatorModel[] = [];
    /** Whether the loading affordance is up right now. */
    loading = false;
    /** Interleaved series/loading timeline — the ORDER is what the load-state tests pin. */
    timeline: string[] = [];
    applyFeature(): void {}
    readFeature(key: string): unknown { return key === 'priceStyle' ? this.priceStyleFeature : undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void {
        this.bars = bars;
        this.setBarsCalls.push({ n: bars.length, close: bars[0]?.close, preserveView: !!opts?.preserveView });
        this.timeline.push(`bars:${bars.length}`);
    }
    setLoading(loading: boolean): void {
        if (loading !== this.loading) this.timeline.push(`loading:${loading}`);
        this.loading = loading;
    }
    updateBar(bar: OHLCV): void { this.bars.push(bar); }
    setNativeData(type: string, data: unknown): void { this.nativePushes.push([type, data]); }
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { this.mountedModels.push(model); return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(_h: IndicatorRenderHandle): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(r: VisibleRange): void { this.visibleRangeCalls.push(r); }
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
}

/** Static engine that records the market of every execution and every session stop. */
class RecordingEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: false, visibleRange: false, inputs: true };
    executions: Array<{ symbol: string; timeframe: string; barClose: number | undefined }> = [];
    stops = 0;

    prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({
            language: 'pine',
            inputs: [],
            meta: { title: 'Rec', overlay: true },
            reactsToViewport: false,
            token: { instanceId },
        });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const id = (req.prepared.token as { instanceId: string }).instanceId;
        const bars = req.getBars?.() ?? req.bars;
        this.executions.push({ symbol: req.market.symbol, timeframe: req.market.timeframe, barClose: bars[0]?.close });
        handlers.onModel({
            id,
            title: 'Rec',
            overlay: true,
            paneHint: 'price',
            series: [{ id: `${id}:line:x#0`, title: 'Rec', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.close })), style: { color: '#f00', width: 1, lineStyle: 'solid' } }],
            fills: [], backgrounds: [], priceLines: [],
            inputs: req.prepared.inputs,
            inputValues: req.inputs ?? {},
        });
        handlers.onDone?.();
        return {
            stop: () => { this.stops += 1; },
            update: () => {},
            setVisibleRange: () => {},
            notifyBars: () => {},
        };
    }
}

/** A probe native-indicator type: records each instance's start context + lifecycle. */
function probeNative(): { descriptor: NativeIndicatorDescriptor; instances: Array<{ symbol?: string; started: number; stopped: number; resumed: number; suspended: number }> } {
    const instances: Array<{ symbol?: string; started: number; stopped: number; resumed: number; suspended: number }> = [];
    const descriptor: NativeIndicatorDescriptor = {
        type: 'probe',
        title: 'Probe',
        paneHint: 'price',
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => {
            const rec = { symbol: undefined as string | undefined, started: 0, stopped: 0, resumed: 0, suspended: 0 };
            instances.push(rec);
            return {
                start(ctx: NativeIndicatorContext) { rec.started += 1; rec.symbol = ctx.symbol; ctx.emit({}); },
                onBars() {},
                onViewport() {},
                setInputs() {},
                suspend() { rec.suspended += 1; },
                resume() { rec.resumed += 1; },
                stop() { rec.stopped += 1; },
            };
        },
    };
    return { descriptor, instances };
}

const EL = {} as unknown as HTMLElement;
const charts: Vela[] = [];
function make(options: ConstructorParameters<typeof Vela>[1], deps: ConstructorParameters<typeof Vela>[2]): Vela {
    const chart = new Vela(EL, options, deps);
    charts.push(chart);
    return chart;
}

afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    unregisterNativeIndicator('probe');
    unregisterChartType('probe-style');
});

describe('setMarket — in-place market switch', () => {
    it('reloads bars, re-frames (no preserveView), and emits market:changed with prev', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const events: Array<{ symbol: string; timeframe: string; prev: { symbol: string; timeframe: string } }> = [];
        chart.on('market:changed', (e) => events.push(e));

        await chart.setMarket({ symbol: 'BBB', timeframe: '240' });

        expect(renderer.bars[0]?.close).toBe(PRICE.BBB);
        const last = renderer.setBarsCalls[renderer.setBarsCalls.length - 1]!;
        expect(last.preserveView).toBe(false); // a fresh series re-frames the view
        expect(events).toEqual([{ symbol: 'BBB', timeframe: '240', prev: { symbol: 'AAA', timeframe: '60' } }]);
        expect(feed.loads[feed.loads.length - 1]).toMatchObject({ symbol: 'BBB', timeframe: '240' });
    });

    it('chart.market snapshots the REQUESTED identity — an in-flight switch shows immediately', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        expect(chart.market).toMatchObject({ symbol: 'AAA', timeframe: '60', offline: false });

        const done = chart.setMarket({ symbol: 'BBB', timeframe: '240' });
        // Before the load lands: the snapshot already answers with the new identity
        // (persist-on-close must capture the INTENT, not the last committed market).
        expect(chart.market).toMatchObject({ symbol: 'BBB', timeframe: '240' });
        await done;
        expect(chart.market).toMatchObject({ symbol: 'BBB', timeframe: '240', offline: false });
        // A snapshot, not the live config — mutating it changes nothing.
        const snap = chart.market;
        snap.symbol = 'ZZZ';
        expect(chart.market.symbol).toBe('BBB');
    });

    it('frames a requested visibleRange on the first paint of the new market', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();

        const range = { from: 1_700_000_000_000, to: 1_700_036_000_000 };
        await chart.setMarket({ symbol: 'BBB', visibleRange: range });
        expect(renderer.visibleRangeCalls).toContainEqual(range);
    });

    it('re-executes Pine sessions over the new market (fresh ExecutionRequest.market)', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const engine = new RecordingEngine();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [engine], dataFeed: feed });
        chart.addIndicator('rec');
        await chart.ready();
        await flush();
        expect(engine.executions).toEqual([{ symbol: 'AAA', timeframe: '60', barClose: PRICE.AAA }]);

        await chart.setMarket({ symbol: 'BBB' });
        await flush();

        expect(engine.stops).toBe(1); // the old session was torn down
        expect(engine.executions[1]).toEqual({ symbol: 'BBB', timeframe: '60', barClose: PRICE.BBB });
    });

    it('restarts a native indicator with a fresh context, keeping the record id', async () => {
        const { descriptor, instances } = probeNative();
        registerNativeIndicator(descriptor);
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        const handle = chart.addNativeIndicator('probe');
        await chart.ready();
        await flush();
        expect(instances).toHaveLength(1);
        expect(instances[0]!.symbol).toBe('AAA');

        await chart.setMarket({ symbol: 'BBB' });
        await flush();

        expect(instances[0]!.stopped).toBe(1); // old instance released
        expect(instances).toHaveLength(2); // fresh instance from the descriptor
        expect(instances[1]!.symbol).toBe('BBB'); // …started over the NEW market
        expect(chart.indicators().some((h) => h.id === handle.id)).toBe(true); // same record/legend
    });

    it('a hidden native goes stale: shown again, it STARTS fresh instead of resuming', async () => {
        const { descriptor, instances } = probeNative();
        registerNativeIndicator(descriptor);
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        const handle = chart.addNativeIndicator('probe');
        await chart.ready();
        await flush();
        handle.setVisible(false);
        expect(instances[0]!.suspended).toBe(1);

        await chart.setMarket({ symbol: 'BBB' });
        await flush();
        expect(instances).toHaveLength(2);
        expect(instances[1]!.started).toBe(0); // hidden — not started yet

        handle.setVisible(true);
        await flush();
        expect(instances[1]!.started).toBe(1); // started fresh…
        expect(instances[1]!.symbol).toBe('BBB'); // …over the new market
        expect(instances[1]!.resumed).toBe(0); // never resume()d (that would revive the old compute)
    });

    it('rebuilds the active chart-type data engine against the new market', async () => {
        const hosts: SeriesDataEngineHost[] = [];
        let stops = 0;
        registerChartType({
            id: 'probe-style',
            dataEngine: () => ({
                start: (host) => { hosts.push(host); },
                suspend: () => {},
                resume: () => {},
                stop: () => { stops += 1; },
            }),
        });
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        renderer.priceStyleFeature = 'probe-style'; // constructed in the plugin style
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        await flush();
        expect(hosts).toHaveLength(1);
        expect(hosts[0]!.symbol).toBe('AAA');

        await chart.setMarket({ symbol: 'BBB' });
        await flush();

        expect(stops).toBe(1); // the old engine was stopped (its host captured the old market)
        expect(hosts).toHaveLength(2);
        expect(hosts[1]!.symbol).toBe('BBB');
    });

    it('an identity switch silences the active type engine and blanks its channels for the gap', async () => {
        let suspends = 0;
        registerChartType({
            id: 'probe-style',
            dataEngine: () => ({
                start: (host) => { host.pushData({ cells: 'old-market' }); },
                suspend: () => { suspends += 1; },
                resume: () => {},
                stop: () => {},
            }),
        });
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        renderer.priceStyleFeature = 'probe-style';
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        await flush();
        expect(renderer.nativePushes).toContainEqual(['probe-style', { cells: 'old-market' }]);
        renderer.nativePushes.length = 0;

        const done = chart.setMarket({ symbol: 'SLOW' });
        // Synchronously at the switch — the old engine's per-bar payloads must not survive
        // into the gap where they would map onto the new market's first candles.
        expect(suspends).toBe(1);
        expect(renderer.nativePushes).toContainEqual(['probe-style', undefined]);
        expect(renderer.nativePushes).toContainEqual(['probe-style-pending', []]);

        feed.release();
        await done;
        await flush();
        // The post-load rebuild starts a fresh engine, which pushes the NEW market's data.
        expect(renderer.nativePushes.filter(([t, d]) => t === 'probe-style' && d !== undefined).length).toBeGreaterThan(0);
    });

    it('a chart CONSTRUCTED in a plugin style starts its data engine only after the first load', async () => {
        // The restore path: a persisted plugin style comes back through the chart
        // OPTIONS. The engine seed must await the REAL readyPromise — seeding before
        // its assignment awaited `undefined`, started the engine with no market, and
        // a later style re-select only resumed the empty engine (nothing painted).
        let startedBeforeData: boolean | null = null;
        let dataLanded = false;
        registerChartType({
            id: 'probe-style',
            dataEngine: () => ({
                start: () => { startedBeforeData ??= !dataLanded; },
                suspend: () => {}, resume: () => {}, stop: () => {},
            }),
        });
        const feed = new SwitchFeed();
        feed.gatedLoads.add('AAA'); // hold the FIRST load — construction must wait behind it
        const renderer = new FakeRenderer();
        renderer.priceStyleFeature = 'probe-style';
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await flush(); // without the ctor-order fix the engine starts HERE, before any data
        dataLanded = true;
        feed.release();
        await chart.ready();
        await flush();
        expect(startedBeforeData).toBe(false); // the engine saw a loaded market at start
    });

    it('a REMOVED auto-added volume stays removed across market switches (opt-out sticks)', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: true }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        await flush();
        const volume = chart.indicators().find((h) => h.title === 'Volume');
        expect(volume).toBeDefined(); // default-on auto-add
        volume!.remove();
        expect(chart.indicators().some((h) => h.title === 'Volume')).toBe(false);

        await chart.setMarket({ symbol: 'BBB' });
        await flush();
        // The auto-add fires on every load's first paint — the user's removal must win.
        expect(chart.indicators().some((h) => h.title === 'Volume')).toBe(false);
    });

    it('re-targets the live subscription', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', live: true, volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        expect(feed.subs).toEqual({ AAA: 1 });

        await chart.setMarket({ symbol: 'BBB' });

        expect(feed.unsubs).toEqual({ AAA: 1 }); // old stream closed
        expect(feed.subs).toEqual({ AAA: 1, BBB: 1 }); // new stream opened
    });

    it('re-arms historyComplete() per load (the old promise resolves, the event fires again)', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        const completes: string[] = [];
        chart.on('history:complete', (e) => completes.push(e.reason));
        const p1 = chart.historyComplete();
        await chart.ready();
        await p1;
        expect(completes).toEqual(['depth']);

        await chart.setMarket({ symbol: 'BBB' });
        await chart.historyComplete(); // the NEW load's promise
        expect(completes).toEqual(['depth', 'depth']);
    });

    it('same-market call is a no-op (no reload, no event)', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const events: unknown[] = [];
        chart.on('market:changed', (e) => events.push(e));
        const loadsBefore = feed.loads.length;

        await chart.setMarket({ symbol: 'AAA', timeframe: '60' });
        await chart.setMarket({});

        expect(feed.loads.length).toBe(loadsBefore);
        expect(events).toEqual([]);
    });

    it('a depth-only reload fetches but does NOT emit market:changed', async () => {
        const feed = new SwitchFeed();
        feed.depth.AAA = 900;
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', bars: 100, volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const events: unknown[] = [];
        chart.on('market:changed', (e) => events.push(e));

        await chart.setMarket({ bars: 800 }); // resolves at the progressive head…
        await chart.historyComplete(); // …the depth streams in behind it

        expect(renderer.bars.length).toBe(800);
        expect(events).toEqual([]);
    });

    it('rapid double switch: the last call wins, the superseded one resolves silently', async () => {
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const events: Array<{ symbol: string }> = [];
        chart.on('market:changed', (e) => events.push(e));

        const pSlow = chart.setMarket({ symbol: 'SLOW' }); // load parks on the gate
        const pFast = chart.setMarket({ symbol: 'BBB' }); // supersedes it
        await pFast;
        await pSlow; // must resolve promptly (raced against supersession), not hang

        expect(renderer.bars[0]?.close).toBe(PRICE.BBB);
        feed.release(); // the stale SLOW load finally lands…
        await flush();
        expect(renderer.bars[0]?.close).toBe(PRICE.BBB); // …and is dropped, never painted
        expect(events.map((e) => e.symbol)).toEqual(['BBB']); // one switch, one event
    });

    it('switches to offline data (and a later symbol switch drops the offline dataset)', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();

        const offline = makeBars(30, 777);
        await chart.setMarket({ data: offline });
        expect(renderer.bars.length).toBe(30);
        expect(renderer.bars[0]?.close).toBe(777);

        await chart.setMarket({ symbol: 'CCC' }); // back to the provider path
        expect(renderer.bars[0]?.close).toBe(PRICE.CCC);
    });

    it('a switch mid-backfill abandons the old backfill loop', async () => {
        const feed = new SwitchFeed();
        feed.depth.AAA = 15_000;
        feed.gateRanges = true;
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', bars: 12_000, volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready(); // preview + first chunk painted; backfill parked on the gate
        const progress: number[] = [];
        chart.on('history:progress', (e) => progress.push(e.loaded));
        const oldComplete = chart.historyComplete();

        await chart.setMarket({ symbol: 'BBB', bars: 50 });
        await oldComplete; // the superseded load's promise resolves rather than hanging
        expect(renderer.bars[0]?.close).toBe(PRICE.BBB);

        feed.release(); // the old backfill chunk finally lands…
        await flush();
        expect(progress).toEqual([]); // …but the abandoned loop emitted nothing
        expect(renderer.bars[0]?.close).toBe(PRICE.BBB); // and the new market stayed put
    });

    it('destroy mid-switch releases the awaiter', async () => {
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();

        const p = chart.setMarket({ symbol: 'SLOW' });
        chart.destroy();
        await p; // resolves (silently) instead of hanging on the parked load
    });
});

describe('presentNativeIndicators — the sync presence read', () => {
    it('reflects an add and a remove in the same tick (no async catalog round-trip)', async () => {
        const { descriptor } = probeNative();
        registerNativeIndicator(descriptor);
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        expect(chart.presentNativeIndicators()).toEqual([]);

        const handle = chart.addNativeIndicator('probe');
        // Synchronous: an unload-time persist flush must see this immediately.
        expect(chart.presentNativeIndicators()).toEqual(['probe']);
        handle.remove();
        expect(chart.presentNativeIndicators()).toEqual([]);
    });
});

describe('load states — the cleared chart + the loading affordance', () => {
    it('first load: the affordance is up from the start and ends with the first batch', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        expect(renderer.timeline).toEqual(['loading:true', 'bars:50', 'loading:false']);
        expect(chart).toBeTruthy();
    });

    it('an identity switch blanks the chart immediately and raises the affordance until the new bars land', async () => {
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        renderer.timeline = [];

        const done = chart.setMarket({ symbol: 'SLOW' });
        // Synchronously on the call: old candles gone, affordance up — nothing waits on the fetch.
        expect(renderer.bars).toEqual([]);
        expect(renderer.loading).toBe(true);

        feed.release();
        await done;
        expect(renderer.bars[0]?.close).toBe(PRICE.SLOW);
        expect(renderer.loading).toBe(false);
        // The affordance rises BEFORE the blank (load:start reaches plugins first), and falls
        // with the new market's first batch.
        expect(renderer.timeline).toEqual(['loading:true', 'bars:0', 'bars:50', 'loading:false']);
    });

    it('the load:start/load:end pair brackets a switch for plugins — start before the blank, end with the first batch', async () => {
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const seen: Array<{ ev: string; symbol: string; barsPainted: number; payloadBars?: number; firstLoad?: boolean }> = [];
        chart.on('load:start', (e) => seen.push({ ev: 'start', symbol: e.symbol, barsPainted: renderer.bars.length, firstLoad: e.firstLoad }));
        chart.on('load:end', (e) => seen.push({ ev: 'end', symbol: e.symbol, barsPainted: renderer.bars.length, payloadBars: e.bars }));

        const done = chart.setMarket({ symbol: 'SLOW', timeframe: '240' });
        // start already out, carrying the NEW identity, with the OLD series still painted —
        // a plugin hides its own visuals before anything is blanked.
        expect(seen).toEqual([{ ev: 'start', symbol: 'SLOW', barsPainted: 50, firstLoad: false }]);

        feed.release();
        await done;
        expect(seen[1]).toEqual({ ev: 'end', symbol: 'SLOW', barsPainted: 50, payloadBars: 50 });
        expect(seen).toHaveLength(2); // exactly one end per start
    });

    it('load:end fires alone (bars: 0) for a failed load and for a parked symbol', async () => {
        const feed = new SwitchFeed();
        feed.failLoads.add('DOWN');
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        const ends: number[] = [];
        chart.on('load:end', (e) => ends.push(e.bars));

        await expect(chart.setMarket({ symbol: 'DOWN' })).rejects.toThrow();
        expect(ends).toEqual([0]); // the pair still closes — plugins never wait forever

        const pending = chart.setMarket({ symbol: 'SLOW' });
        feed.park('SLOW');
        expect(ends).toEqual([0, 0]); // parked: closed immediately, not when (if) bars arrive
        feed.release();
        await pending;
    });

    it('a depth-only reload keeps the bars painted and never raises the affordance', async () => {
        const feed = new SwitchFeed();
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();
        renderer.timeline = [];

        await chart.setMarket({ bars: 80 });
        expect(renderer.timeline).toEqual(['bars:50']); // the feed has 50 — one silent reload
    });

    it('a failed load still ends the affordance (empty chart, no eternal dots)', async () => {
        const feed = new SwitchFeed();
        feed.failLoads.add('DOWN');
        const renderer = new FakeRenderer();
        const chart = make({ symbol: 'AAA', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await chart.ready();

        await expect(chart.setMarket({ symbol: 'DOWN' })).rejects.toThrow();
        expect(renderer.bars).toEqual([]); // blanked at the switch; nothing came back
        expect(renderer.loading).toBe(false);
    });

    it('a parked load (no venue serves the symbol) drops the affordance instead of promising bars', async () => {
        const feed = new SwitchFeed();
        feed.gatedLoads.add('SLOW');
        const renderer = new FakeRenderer();
        make({ symbol: 'SLOW', timeframe: '60', volume: false }, { renderer, engines: [], dataFeed: feed });
        await flush();
        expect(renderer.loading).toBe(true); // first load in flight

        feed.park('SLOW'); // what MultiProviderFeed reports when nothing can serve the symbol
        expect(renderer.loading).toBe(false);
        expect(renderer.bars).toEqual([]);

        feed.release(); // a provider shows up later — the parked load resumes and paints
        await flush();
        expect(renderer.bars[0]?.close).toBe(PRICE.SLOW);
        expect(renderer.loading).toBe(false);
    });
});
