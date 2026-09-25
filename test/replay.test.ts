// chart.replay — rewind to a past bar and reveal the following ones from the history in
// memory. Revealed bars travel the live-bar path; live updates pause meanwhile; stopping
// (or revealing the last bar) restores the full history and resumes them.
import { describe, it, expect, afterEach, vi } from 'vitest';
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
import type { ScriptingEngine, EngineCapabilities, PreparedScript, ExecutionRequest, ExecutionHandlers, ExecutionSession } from '../src/core/ports/ScriptingEngine';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig, VelaTheme } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';
import { registerChartType, unregisterChartType, type SeriesDataEngineHost } from '../src/chart-types/registry';
import { registerNativeIndicator, unregisterNativeIndicator, type NativeIndicatorContext } from '../src/core/native-indicators/NativeIndicator';
import { barsToTicks, lowerTimeframeTicks, type ReplayTick, type ReplayTickSource } from '../src/index';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** The symbol's whole universe: `total` hourly bars, close = index (so a bar is identifiable). */
function universe(total: number): OHLCV[] {
    return Array.from({ length: total }, (_, i) => ({ time: T0 + i * HOUR, open: i, high: i + 1, low: i - 1, close: i, volume: 1 }));
}

/** Serves the NEWEST `cfg.bars` of a fixed universe; records ranges and live (un)subscriptions. */
class ReplayFeed implements MarketDataFeed {
    readonly all: OHLCV[];
    rangeCalls: BarRange[] = [];
    subs = 0;
    unsubs = 0;
    onBar: ((bar: OHLCV) => void) | null = null;

    constructor(total = 200) {
        this.all = universe(total);
    }

    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        if (cfg.data?.length) return cfg.data;
        return this.all.slice(-(cfg.bars ?? 500));
    }

    /** While set, every ranged fetch waits on it — a source slow to serve old history. */
    gate: Promise<void> | null = null;

    async loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls.push({ ...range });
        if (this.gate) await this.gate;
        let out = this.all.filter((b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to));
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return out;
    }

    subscribe(_cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        this.subs += 1;
        this.onBar = onBar;
        return () => {
            this.unsubs += 1;
            this.onBar = null;
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
    priceStyleFeature: unknown = undefined;
    bars: OHLCV[] = [];
    setBarsCalls: { n: number; preserveView: boolean }[] = [];
    updated: OHLCV[] = [];
    nativePushes: Array<[string, unknown]> = [];
    applyFeature(): void {}
    readFeature(key: string): unknown { return key === 'priceStyle' ? this.priceStyleFeature : undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void {
        this.bars = [...bars];
        this.setBarsCalls.push({ n: bars.length, preserveView: !!opts?.preserveView });
    }
    updateBar(bar: OHLCV): void {
        this.updated.push(bar);
        const last = this.bars[this.bars.length - 1];
        if (last && last.time === bar.time) this.bars[this.bars.length - 1] = bar;
        else this.bars.push(bar);
    }
    setNativeData(type: string, data: unknown): void { this.nativePushes.push([type, data]); }
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
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

/** Streaming engine recording every execution's newest bar and every bar notification. */
class RecordingEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: false, inputs: true };
    executions: number[] = [];
    notifications = 0;

    prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({ language: 'pine', inputs: [], meta: { title: 'Rec', overlay: true }, reactsToViewport: false, token: { instanceId } });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const id = (req.prepared.token as { instanceId: string }).instanceId;
        const bars = req.getBars?.() ?? req.bars;
        this.executions.push(bars[bars.length - 1]?.close ?? NaN);
        handlers.onModel({
            id, title: 'Rec', overlay: true, paneHint: 'price',
            series: [{ id: `${id}:line:x#0`, title: 'Rec', paneId: 'unrouted', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.close })), style: { color: '#f00', width: 1, lineStyle: 'solid' } }],
            fills: [], backgrounds: [], priceLines: [], inputs: req.prepared.inputs, inputValues: req.inputs ?? {},
        });
        handlers.onDone?.();
        return { stop: () => {}, update: () => {}, setVisibleRange: () => {}, notifyBars: () => { this.notifications += 1; } };
    }
}

const EL = {} as unknown as HTMLElement;
const charts: Vela[] = [];
function make(opts: { live?: boolean; bars?: number; total?: number; priceStyle?: string; engine?: ScriptingEngine } = {}) {
    const feed = new ReplayFeed(opts.total ?? 200);
    const renderer = new FakeRenderer();
    if (opts.priceStyle) renderer.priceStyleFeature = opts.priceStyle;
    const chart = new Vela(EL, { symbol: 'AAA', timeframe: '60', bars: opts.bars ?? 100, live: opts.live ?? true, volume: false }, { renderer, engines: opts.engine ? [opts.engine] : [], dataFeed: feed });
    charts.push(chart);
    return { chart, feed, renderer };
}

afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    unregisterChartType('replay-probe');
    unregisterNativeIndicator('replay-native');
    vi.restoreAllMocks();
});

describe('chart.replay', () => {
    it('start() cuts the history at `from`, pauses live updates, and reports the queue', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        expect(feed.subs).toBe(1);
        const shown = renderer.bars; // newest 100 of 200 → closes 100..199
        const from = shown[39]!.time;
        const starts: Array<{ cursorTime: number; remaining: number }> = [];
        chart.on('replay:start', (e) => starts.push(e));

        await chart.replay.start({ from });

        expect(renderer.bars.length).toBe(40);
        expect(renderer.bars[renderer.bars.length - 1]!.time).toBe(from);
        expect(feed.unsubs).toBe(1); // live paused
        expect(starts).toEqual([{ cursorTime: from, remaining: 60 }]);
        expect(chart.replay.state).toEqual({ active: true, playing: false, cursorTime: from, remaining: 60, intervalMs: 1000 });
    });

    it('step() reveals the next bar through the live-bar path (renderer, bar event, sessions)', async () => {
        const engine = new RecordingEngine();
        const { chart, renderer } = make({ engine });
        await chart.ready();
        chart.addIndicator('probe');
        await flush();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        await flush();
        // the indicator re-ran over the CUT history — its newest bar is the cursor bar
        expect(engine.executions[engine.executions.length - 1]).toBe(149);
        const notified = engine.notifications;
        const bars: OHLCV[] = [];
        const steps: Array<{ cursorTime: number; remaining: number }> = [];
        chart.on('bar', (b) => bars.push(b));
        chart.on('replay:step', (e) => steps.push(e));

        expect(chart.replay.step()).toBe(true);

        expect(renderer.updated.map((b) => b.close)).toEqual([150]);
        expect(bars.map((b) => b.close)).toEqual([150]);
        expect(steps).toEqual([{ cursorTime: from + HOUR, remaining: 49 }]);
        expect(engine.notifications).toBe(notified + 1);
        expect(chart.replay.state.cursorTime).toBe(from + HOUR);
    });

    it('play() reveals one bar per interval; pause() stops; play() again changes the pace', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[9]!.time });
        const events: string[] = [];
        chart.on('replay:play', (e) => events.push(`play:${e.intervalMs}`));
        chart.on('replay:pause', () => events.push('pause'));

        chart.replay.play(15);
        expect(chart.replay.state.playing).toBe(true);
        await sleep(100);
        chart.replay.pause();
        const revealed = renderer.updated.length;
        expect(revealed).toBeGreaterThanOrEqual(3);
        expect(chart.replay.state.playing).toBe(false);
        await sleep(60);
        expect(renderer.updated.length).toBe(revealed); // paused: nothing more

        chart.replay.play(10);
        chart.replay.play(20); // a pace change while playing
        expect(chart.replay.state.intervalMs).toBe(20);
        chart.replay.pause();
        expect(events).toEqual(['play:15', 'pause', 'play:10', 'play:20', 'pause']);
    });

    it('rejects a non-positive interval without changing the state', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[9]!.time });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        chart.replay.play(0);
        expect(warn).toHaveBeenCalled();
        expect(chart.replay.state.playing).toBe(false);
    });

    it('stop() restores the full history, re-runs indicators, resumes live, and heals the gap', async () => {
        const engine = new RecordingEngine();
        const { chart, feed, renderer } = make({ engine });
        await chart.ready();
        chart.addIndicator('probe');
        await flush();
        await chart.replay.start({ from: renderer.bars[29]!.time });
        chart.replay.step();
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));
        feed.rangeCalls = [];

        chart.replay.stop();
        await flush();

        expect(renderer.bars.length).toBe(100);
        expect(renderer.bars[99]!.close).toBe(199);
        expect(engine.executions[engine.executions.length - 1]).toBe(199); // re-ran over the full history
        expect(feed.subs).toBe(2); // live resumed
        expect(feed.rangeCalls).toEqual([{ from: renderer.bars[99]!.time }]); // heal from the newest known bar
        expect(ends).toEqual(['stopped']);
        expect(chart.replay.state).toMatchObject({ active: false, playing: false, cursorTime: null, remaining: 0 });
        expect(chart.replay.step()).toBe(false);
    });

    it('revealing the last bar ends the replay as finished and resumes live', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[97]!.time });
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));

        expect(chart.replay.step()).toBe(true);
        expect(ends).toEqual([]);
        expect(chart.replay.step()).toBe(true);

        expect(ends).toEqual(['finished']);
        expect(renderer.bars.map((b) => b.close).slice(-3)).toEqual([197, 198, 199]);
        expect(feed.subs).toBe(2);
        expect(chart.replay.state.active).toBe(false);
    });

    it('seeking while active rewinds over the whole tape without ending the replay', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const full = [...renderer.bars];
        await chart.replay.start({ from: full[59]!.time });
        chart.replay.play(1000);
        const events: string[] = [];
        chart.on('replay:end', () => events.push('end'));
        chart.on('replay:pause', () => events.push('pause'));
        chart.on('replay:start', (e) => events.push(`start:${e.remaining}`));

        await chart.replay.start({ from: full[19]!.time }); // backward
        expect(renderer.bars.length).toBe(20);
        await chart.replay.start({ from: full[79]!.time }); // forward, past the old cursor
        expect(renderer.bars.length).toBe(80);

        expect(events).toEqual(['pause', 'start:80', 'start:20']);
        expect(chart.replay.state.playing).toBe(false);
    });

    it('a `from` older than the loaded history deepens it first', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 300 });
        await chart.ready();
        const oldestLoaded = renderer.bars[0]!.time; // close 200
        feed.rangeCalls = [];

        await chart.replay.start({ from: oldestLoaded - 50 * HOUR }); // close 150

        expect(feed.rangeCalls.length).toBeGreaterThan(0);
        expect(renderer.bars[renderer.bars.length - 1]!.close).toBe(150);
        expect(chart.replay.state.remaining).toBe(49 + 100);
    });

    it('bounds span the whole walkable history, hidden bars included', async () => {
        const { chart, renderer } = make();
        expect(chart.replay.bounds).toBeNull();
        await chart.ready();
        const full = [...renderer.bars];
        expect(chart.replay.bounds).toEqual({ first: full[0]!.time, last: full[99]!.time });
        await chart.replay.start({ from: full[40]!.time });
        expect(chart.replay.bounds).toEqual({ first: full[0]!.time, last: full[99]!.time });
    });

    it('a replay that deepened the history hands the depth back when it ends', async () => {
        const { chart, renderer } = make({ bars: 100, total: 300 });
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[0]!.time - 50 * HOUR });
        expect(chart.market.bars).toBeGreaterThan(100);

        chart.replay.stop();
        await flush();

        expect(chart.market.bars).toBe(100);
        expect(renderer.bars.length).toBe(100);
        expect(renderer.bars[99]!.close).toBe(299);
    });

    it('stop() cancels a start still loading older history and hands the depth back', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 300 });
        await chart.ready();
        feed.gate = new Promise(() => {}); // the old history never arrives
        const pending = chart.replay.start({ from: renderer.bars[0]!.time - 50 * HOUR });
        await flush();
        expect(chart.market.bars).toBeGreaterThan(100);
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));

        chart.replay.stop();
        await pending; // released, not left hanging
        await flush();

        expect(chart.replay.state.active).toBe(false);
        expect(chart.market.bars).toBe(100);
        expect(renderer.bars.length).toBe(100);
        expect(ends).toEqual([]); // no replay had started
        expect(feed.subs - feed.unsubs).toBe(1); // live updates run, exactly once
    });

    it('a market switch during a start\'s history load abandons it at the original depth', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 300 });
        await chart.ready();
        feed.gate = new Promise(() => {});
        const pending = chart.replay.start({ from: renderer.bars[0]!.time - 50 * HOUR });
        await flush();
        feed.gate = null;

        await chart.setMarket({ symbol: 'BBB' });
        await pending;

        expect(chart.replay.state.active).toBe(false);
        expect(chart.market.bars).toBe(100);
        expect(renderer.bars.length).toBe(100);
    });

    it('starts at once while a progressive load is still converging, and keeps its cut as snapshots land', async () => {
        const all = universe(300);
        let emit: ((bars: OHLCV[]) => void) | null = null;
        let finish: ((bars: OHLCV[]) => void) | null = null;
        const feed = new ReplayFeed(300);
        (feed as MarketDataFeed).loadProgressive = (_cfg, onBatch) => {
            emit = onBatch;
            onBatch(all.slice(200)); // the newest 100 paint first
            return new Promise<OHLCV[]>((r) => (finish = r));
        };
        const renderer = new FakeRenderer();
        const chart = new Vela(EL, { symbol: 'AAA', timeframe: '60', bars: 300, live: true, volume: false }, { renderer, engines: [], dataFeed: feed });
        charts.push(chart);
        await chart.ready();
        expect(renderer.bars.length).toBe(100);

        const from = all[249]!.time;
        let started = false;
        void chart.replay.start({ from }).then(() => (started = true));
        await flush();
        expect(started).toBe(true); // no wait on the history still converging
        expect(chart.replay.state).toMatchObject({ cursorTime: from, remaining: 50 });

        emit!(all.slice(100)); // a deeper snapshot: 100 older bars join the head
        expect(renderer.bars.length).toBe(150);
        expect(renderer.bars[0]!.time).toBe(all[100]!.time);
        expect(chart.replay.state).toMatchObject({ cursorTime: from, remaining: 50 });

        const newer = { ...all[299]!, time: all[299]!.time + HOUR, close: 300 };
        finish!([...all, newer]); // the final answer: the rest of the head, and one bar past the tape
        await flush();
        expect(renderer.bars.length).toBe(250);
        expect(chart.replay.state).toMatchObject({ cursorTime: from, remaining: 51 });
        expect(chart.replay.bounds).toEqual({ first: all[0]!.time, last: newer.time });
    });

    it('ignores a `from` with no bar after it', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await chart.replay.start({ from: renderer.bars[99]!.time });
        expect(warn).toHaveBeenCalled();
        expect(chart.replay.state.active).toBe(false);
        expect(renderer.bars.length).toBe(100);
    });

    it('a market switch ends the replay', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        chart.replay.play(1000);
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));

        await chart.setMarket({ symbol: 'BBB' });

        expect(ends).toEqual(['market']);
        expect(chart.replay.state).toMatchObject({ active: false, playing: false });
        expect(renderer.bars.length).toBe(100);
        expect(feed.subs).toBe(2); // the switch's own live restart
    });

    it('a timeframe switch keeps the replay: same point, still playing, live still off', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        const cursor = renderer.bars[49]!.time;
        await chart.replay.start({ from: cursor });
        chart.replay.play(10_000);
        const events: string[] = [];
        chart.on('replay:end', (e) => events.push(`end:${e.reason}`));
        chart.on('replay:start', () => events.push('start'));
        chart.on('market:changed', () => events.push('market'));
        const subs = feed.subs;

        await chart.setMarket({ timeframe: '30' }); // finer: every 30m bar of the revealed hour stays
        await flush();

        expect(events).toEqual(['start', 'market']);
        expect(chart.replay.state).toMatchObject({ active: true, playing: true, cursorTime: cursor });
        expect(feed.subs).toBe(subs); // no live subscription while replaying
        chart.replay.stop();
    });

    it('the replay reads active all through a timeframe switch — no off/on while the new bars load', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => (release = r));
        const load = feed.load.bind(feed);
        feed.load = async (cfg) => {
            await gate;
            return load(cfg);
        };

        const switching = chart.setMarket({ timeframe: '30' });
        expect(chart.replay.state.active).toBe(true); // the new bars are still on their way
        release!();
        await switching;
        expect(chart.replay.state.active).toBe(true);
    });

    it('stop() while a replay is carried over a switch cancels it for good', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => (release = r));
        const load = feed.load.bind(feed);
        feed.load = async (cfg) => {
            await gate;
            return load(cfg);
        };
        const subs = feed.subs;

        const switching = chart.setMarket({ timeframe: '30' });
        chart.replay.stop();
        release!();
        await switching;
        await flush();

        expect(chart.replay.state.active).toBe(false);
        expect(ends).toEqual(['stopped']);
        expect(feed.subs).toBe(subs + 1); // back to live
        expect(renderer.bars.length).toBe(100);
    });

    it('a symbol switch landing while a replay is carried over ends it', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => (release = r));
        const load = feed.load.bind(feed);
        feed.load = async (cfg) => {
            if (cfg.symbol === 'AAA' && cfg.timeframe === '30') await gate;
            return load(cfg);
        };

        void chart.setMarket({ timeframe: '30' });
        await chart.setMarket({ symbol: 'BBB' });
        release!();
        await flush();

        expect(chart.replay.state.active).toBe(false);
        expect(ends).toEqual(['market']);
    });

    it('switching to a coarser timeframe hides the bar still open at the replay point', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const cursor = renderer.bars[49]!.time;
        await chart.replay.start({ from: cursor });

        await chart.setMarket({ timeframe: '240' }); // a 4h bar opened 3h before the revealed hour closes is not closed yet
        await flush();

        expect(chart.replay.state).toMatchObject({ active: true, cursorTime: cursor - 3 * HOUR });
    });

    it('a carried replay point older than the new series deepens it, then resumes', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 300 });
        await chart.ready();
        const cursor = renderer.bars[0]!.time;
        await chart.replay.start({ from: cursor });
        const ends: string[] = [];
        chart.on('replay:end', (e) => ends.push(e.reason));
        feed.rangeCalls = [];

        await chart.setMarket({ timeframe: '120' }); // the point sits 1h before the loaded head
        expect(chart.replay.state.active).toBe(true); // on all along, while the older bars load
        await vi.waitFor(() => expect(chart.replay.state.cursorTime).not.toBeNull());

        expect(feed.rangeCalls.length).toBeGreaterThan(0); // deepened
        expect(chart.replay.state.cursorTime).toBe(cursor - HOUR);
        expect(ends).toEqual([]);
    });

    it('native indicators restart without live data, and live again on stop and on finish', async () => {
        const contexts: NativeIndicatorContext[] = [];
        registerNativeIndicator({
            type: 'replay-native', title: 'Replay native', paneHint: 'price', overlay: true,
            inputsSchema: () => [], defaultInputs: () => ({}),
            create: () => ({
                start(ctx: NativeIndicatorContext) { contexts.push(ctx); ctx.emit({}); },
                onBars() {}, onViewport() {}, setInputs() {}, suspend() {}, resume() {}, stop() {},
            }),
        });
        const { chart, renderer } = make();
        await chart.ready();
        chart.addNativeIndicator('replay-native');
        await flush();
        const live = (): boolean[] => contexts.map((c) => c.live);
        expect(live()).toEqual([true]);

        await chart.replay.start({ from: renderer.bars[49]!.time });
        await flush();
        expect(live()).toEqual([true, false]);
        chart.replay.stop();
        await flush();
        expect(live()).toEqual([true, false, true]);

        await chart.replay.start({ from: renderer.bars[98]!.time });
        await flush();
        chart.replay.step(); // the last hidden bar → finished
        await flush();
        expect(live()).toEqual([true, false, true, false, true]);
    });

    it('chart-type data engines are rebuilt without live data and follow each revealed bar', async () => {
        const hosts: SeriesDataEngineHost[] = [];
        const onBars: number[] = [];
        registerChartType({
            id: 'replay-probe',
            dataEngine: () => {
                let host: SeriesDataEngineHost | null = null;
                return {
                    start: (h) => { host = h; hosts.push(h); },
                    suspend: () => {}, resume: () => {}, stop: () => {},
                    onBars: () => { onBars.push(host!.bars().length); },
                };
            },
        });
        const { chart, renderer } = make({ priceStyle: 'replay-probe' });
        await chart.ready();
        await flush();
        expect(hosts.map((h) => h.live)).toEqual([true]);

        await chart.replay.start({ from: renderer.bars[39]!.time });
        await flush();
        expect(hosts.map((h) => h.live)).toEqual([true, false]);
        expect(hosts[1]!.bars().length).toBe(40); // never sees past the cursor

        onBars.length = 0;
        chart.replay.step();
        expect(onBars).toEqual([41]);

        chart.replay.stop();
        await flush();
        expect(hosts.map((h) => h.live)).toEqual([true, false, true]);
    });
});

describe('chart.replay tick replay (setTicks)', () => {
    /** The ticks a test source serves for any bar whose close is `i`: i+0.5, i-0.5, i. */
    const threeTicks: ReplayTickSource = (bar) => [{ price: bar.close + 0.5 }, { price: bar.close - 0.5 }, { price: bar.close }];
    /** Timed playback runs on fake timers — installed once the chart is loaded and cut. */
    const fakeTimers = (): void => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const advance = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
    afterEach(() => {
        vi.useRealTimers();
    });

    it('playing a bar walks the forming candle through its ticks, then settles on the stored bar', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time; // next hidden bar: close 150, high 151, low 149, volume 1
        await chart.replay.start({ from });
        chart.replay.setTicks(threeTicks);
        const events: string[] = [];
        chart.on('replay:tick', (e) => events.push(`tick:${e.index}/${e.count}`));
        chart.on('replay:step', (e) => events.push(`step:${e.remaining}`));
        renderer.updated = [];
        fakeTimers();

        chart.replay.play(60); // the interval is per TICK: the bar opens one interval in, then one tick per 60 ms
        await advance(60);
        expect(renderer.updated).toEqual([{ time: from + HOUR, open: 150.5, high: 150.5, low: 150.5, close: 150.5, volume: 1 / 3 }]);
        await advance(60);
        expect(renderer.updated[1]).toMatchObject({ open: 150.5, high: 150.5, low: 149.5, close: 149.5 });
        await advance(59);
        expect(renderer.updated).toHaveLength(2);
        await advance(1);
        chart.replay.pause();

        expect(renderer.updated[2]).toEqual({ time: from + HOUR, open: 150, high: 151, low: 149, close: 150, volume: 1 });
        expect(events).toEqual(['tick:0/3', 'tick:1/3', 'tick:2/3', 'step:49']);
        expect(chart.replay.state).toMatchObject({ cursorTime: from + HOUR, remaining: 49 });
    });

    it('a timer that fires late catches up on every tick due, so the bar keeps its interval', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        chart.replay.setTicks(threeTicks);
        const steps: number[] = [];
        chart.on('replay:step', (e) => steps.push(e.cursorTime));
        renderer.updated = [];
        fakeTimers();
        let lag = 0;
        const clock = performance.now.bind(performance);
        vi.spyOn(performance, 'now').mockImplementation(() => clock() + lag);

        chart.replay.play(60); // ticks due 0, 60 and 120 ms after the open
        await advance(60);
        expect(renderer.updated).toHaveLength(1);
        lag = 70; // the next beat runs 70 ms late: ticks 1 AND 2 are due
        await advance(60);
        chart.replay.pause();

        expect(renderer.updated[renderer.updated.length - 1]).toEqual({ time: from + HOUR, open: 150, high: 151, low: 149, close: 150, volume: 1 });
        expect(steps).toEqual([from + HOUR]);
    });

    it('volume is spread over ticks without one, and summed from ticks that carry one', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        chart.replay.setTicks((bar) => (bar.close === 150 ? [{ price: 150 }, { price: 150 }, { price: 150 }, { price: 150 }] : [{ price: bar.close, volume: 3 }, { price: bar.close, volume: 4 }]));
        renderer.updated = [];
        fakeTimers();

        chart.replay.play(20); // one tick per 20 ms; the next bar opens 20 ms after the last tick
        await advance(40);
        expect(renderer.updated.map((b) => b.volume)).toEqual([0.25, 0.5]);
        await advance(60);
        chart.replay.pause();
        const next = renderer.updated.filter((b) => b.time === from + 2 * HOUR);
        expect(next[0]!.volume).toBe(3);
    });

    it('step() mid-bar completes it on the stored values', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        chart.replay.setTicks(threeTicks);
        fakeTimers();
        chart.replay.play(600);
        await advance(600); // the open is on screen; the next tick is 600 ms away
        chart.replay.pause();
        expect(renderer.bars[renderer.bars.length - 1]).toMatchObject({ time: from + HOUR, close: 150.5 });
        const steps: number[] = [];
        chart.on('replay:step', (e) => steps.push(e.cursorTime));

        expect(chart.replay.step()).toBe(true);

        expect(renderer.bars[renderer.bars.length - 1]).toEqual({ time: from + HOUR, open: 150, high: 151, low: 149, close: 150, volume: 1 });
        expect(steps).toEqual([from + HOUR]);
        expect(chart.replay.step()).toBe(true); // the next one comes whole
        expect(renderer.bars[renderer.bars.length - 1]!.close).toBe(151);
    });

    it('stepUpdate() reveals one tick at a time, opening the next bar at its first', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        chart.replay.setTicks(threeTicks);
        const steps: number[] = [];
        chart.on('replay:step', (e) => steps.push(e.cursorTime));
        const last = (): OHLCV => renderer.bars[renderer.bars.length - 1]!;

        expect(chart.replay.stepUpdate()).toBe(true);
        expect(last()).toMatchObject({ time: from + HOUR, close: 150.5 });
        chart.replay.stepUpdate();
        expect(last()).toMatchObject({ time: from + HOUR, close: 149.5 });
        chart.replay.stepUpdate(); // the last tick settles the bar
        expect(last()).toEqual({ time: from + HOUR, open: 150, high: 151, low: 149, close: 150, volume: 1 });
        expect(steps).toEqual([from + HOUR]);
        chart.replay.stepUpdate(); // the next bar opens at its first tick
        expect(last()).toMatchObject({ time: from + 2 * HOUR, close: 151.5 });
    });

    it('stepUpdate() without ticks reveals whole bars, and waits for ticks still loading', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        const last = (): OHLCV => renderer.bars[renderer.bars.length - 1]!;
        chart.replay.stepUpdate();
        expect(last()).toMatchObject({ time: from + HOUR, close: 150, high: 151 });

        let release: (() => void) | null = null;
        chart.replay.setTicks(async (bar) => {
            await new Promise<void>((r) => (release = r));
            return [{ price: bar.close - 0.25 }, { price: bar.close }];
        });
        expect(chart.replay.stepUpdate()).toBe(true);
        expect(last().time).toBe(from + HOUR); // nothing yet: the ticks are loading
        release!();
        await flush();
        expect(last()).toMatchObject({ time: from + 2 * HOUR, close: 150.75 });
    });

    it('an async source is asked ahead for the next bar, and playback waits for late ticks', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        const asked: Array<{ time: number; end: number }> = [];
        let release: (() => void) | null = null;
        chart.replay.setTicks(async (bar, { end }) => {
            asked.push({ time: bar.time, end });
            if (bar.time === from + HOUR) await new Promise<void>((r) => (release = r));
            return [{ price: bar.close }, { price: bar.close }];
        });
        expect(asked).toEqual([{ time: from + HOUR, end: from + 2 * HOUR }]); // prefetched on setTicks
        renderer.updated = [];
        fakeTimers();

        chart.replay.play(300);
        await advance(500);
        expect(renderer.updated).toEqual([]); // still waiting on the first bar's ticks

        release!();
        await advance(0);
        expect(renderer.updated[0]).toMatchObject({ time: from + HOUR, close: 150 });
        expect(asked.map((a) => a.time)).toEqual([from + HOUR, from + 2 * HOUR]); // the next bar asked while this one plays
        chart.replay.pause();
    });

    it('an empty or failing source reveals the bar whole', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        chart.replay.setTicks((bar) => {
            if (bar.close === 150) return [];
            throw new Error('no data');
        });
        renderer.updated = [];
        fakeTimers();

        chart.replay.play(20);
        await advance(40);
        chart.replay.pause();

        expect(renderer.updated.map((b) => [b.close, b.high])).toEqual([[150, 151], [151, 152]]);
        expect(warn).toHaveBeenCalled();
    });

    it('a pace faster than a frame batches ticks so updates never come faster than one', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[49]!.time });
        const ticks: ReplayTick[] = Array.from({ length: 10 }, (_, i) => ({ price: 150 + i / 10 }));
        chart.replay.setTicks(() => ticks);
        const indices: number[] = [];
        chart.on('replay:tick', (e) => indices.push(e.index));
        fakeTimers();

        chart.replay.play(5); // one tick per 5 ms → 4 ticks per 20 ms update
        await advance(5 + 2 * 20);
        chart.replay.pause();

        expect(indices).toEqual([3, 7, 9]);
    });

    it('a tick carrying its span stretches the candle to it, and the first one can set the open', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const from = renderer.bars[49]!.time;
        await chart.replay.start({ from });
        chart.replay.setTicks(() => [
            { price: 150.2, open: 149.8, high: 150.6, low: 149.5 },
            { price: 149.9, high: 150.9, low: 149.7 },
            { price: 150 },
        ]);
        renderer.updated = [];
        fakeTimers();

        chart.replay.play(30);
        await advance(60);
        chart.replay.pause();

        expect(renderer.updated[0]).toMatchObject({ open: 149.8, high: 150.6, low: 149.5, close: 150.2 });
        expect(renderer.updated[1]).toMatchObject({ open: 149.8, high: 150.9, low: 149.5, close: 149.9 });
    });

    it('a seek or a stop mid-bar puts the stored bar back and aborts the tick requests', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const full = [...renderer.bars];
        await chart.replay.start({ from: full[49]!.time });
        const signals: AbortSignal[] = [];
        chart.replay.setTicks((bar, { signal }) => {
            signals.push(signal);
            return threeTicks(bar, { end: 0, signal });
        });
        fakeTimers();
        chart.replay.play(600);
        await advance(600);
        chart.replay.pause();
        expect(renderer.bars[renderer.bars.length - 1]!.close).toBe(150.5); // mid-bar

        await chart.replay.start({ from: full[59]!.time }); // forward over the forming bar
        expect(renderer.bars[50]).toEqual(full[50]);
        expect(signals[0]!.aborted).toBe(true);

        chart.replay.play(600);
        await advance(600);
        expect(renderer.bars[renderer.bars.length - 1]!.close).toBe(160.5);
        vi.useRealTimers();
        chart.replay.stop();
        await flush();
        expect(renderer.bars).toEqual(full);
    });
});

describe('lower-timeframe ticks', () => {
    it('barsToTicks makes one update per bar: its close, its span, its volume (and the open)', () => {
        const up = { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 8 };
        const down = { time: 60_000, open: 11, high: 13, low: 10, close: 10 };
        expect(barsToTicks([up, down])).toEqual([
            { price: 11, open: 10, high: 12, low: 9, volume: 8 },
            { price: 10, open: 11, high: 13, low: 10 },
        ]);
    });

    it('lowerTimeframeTicks fetches the finer bars inside the replayed bar from the chart provider', async () => {
        const calls: Array<{ ticker: string; tf: string; range: BarRange }> = [];
        const provider = {
            getBars: (ticker: string, tf: string, range: BarRange): Promise<OHLCV[]> => {
                calls.push({ ticker, tf, range });
                return Promise.resolve([
                    { time: T0 - 60_000, open: 1, high: 1, low: 1, close: 1 }, // before the bar: dropped
                    { time: T0, open: 5, high: 6, low: 4, close: 6 },
                    { time: T0 + HOUR, open: 9, high: 9, low: 9, close: 9 }, // the next bar: dropped
                ]);
            },
        };
        const chart = {
            market: { symbol: 'BINANCE:BTCUSDT', session: 'extended' },
            data: {
                resolve: () => ({ provider: 'binance', ticker: 'BTCUSDT' }),
                providerInstance: (name: string) => (name === 'binance' ? provider : undefined),
            },
        } as unknown as Parameters<typeof lowerTimeframeTicks>[0];
        const source = lowerTimeframeTicks(chart, '1');

        const ticks = await source({ time: T0, open: 5, high: 6, low: 4, close: 6 }, { end: T0 + HOUR, signal: new AbortController().signal });

        expect(calls).toEqual([{ ticker: 'BTCUSDT', tf: '1', range: { from: T0, to: T0 + HOUR - 1, session: 'extended' } }]);
        expect(ticks).toEqual([{ price: 6, open: 5, high: 6, low: 4 }]);
    });

    it('lowerTimeframeTicks serves nothing for a symbol no provider resolves', async () => {
        const chart = { market: { symbol: 'NOPE' }, data: { resolve: () => null, providerInstance: () => undefined } } as unknown as Parameters<typeof lowerTimeframeTicks>[0];
        const ticks = await lowerTimeframeTicks(chart, '1')({ time: T0, open: 1, high: 1, low: 1, close: 1 }, { end: T0 + HOUR, signal: new AbortController().signal });
        expect(ticks).toEqual([]);
    });
});
