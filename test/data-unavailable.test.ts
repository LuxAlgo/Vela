// A source's PERMANENT refusal of a series (`DataUnavailableError`): the guard reads the
// name, never the class; the feed rejects with it instead of reading it as an empty answer
// (and never caches it); on the chart's own market the core ends the load, stops polling
// and fires `data:unavailable` once, while a secondary fetch rejects to the engine and
// leaves the chart alone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vela, DataUnavailableError, isDataUnavailableError } from '../src/index';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { BarStore, seriesKey } from '../src/data/BarStore';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { ScriptingEngine, EngineCapabilities, PreparedScript, ExecutionRequest, ExecutionHandlers, ExecutionSession } from '../src/core/ports/ScriptingEngine';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { VelaEventMap } from '../src/core/events/types';
import type { Unsubscribe } from '../src/core/util/types';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const DAY = 86_400_000;

function makeBars(n: number, stepMs: number): OHLCV[] {
    const start = Date.now() - n * stepMs;
    return Array.from({ length: n }, (_, i) => ({ time: start + i * stepMs, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
}

/** Serves `GDP` at 1D and coarser only; anything finer is refused for good. `refuse` swaps
 *  the refusal for a plain (transient) error. Counts every getBars call per timeframe. */
function macroProvider(opts: { refuse?: 'unavailable' | 'error' } = {}) {
    const calls: Array<{ ticker: string; tf: string; range: unknown }> = [];
    const provider: DataProvider = {
        getBars(ticker, tf, range) {
            calls.push({ ticker, tf, range });
            const coarse = tf === 'D' || tf === '1D' || tf === 'W' || tf === 'M';
            if (!coarse) {
                if (opts.refuse === 'error') return Promise.reject(new Error('network down'));
                return Promise.reject(new DataUnavailableError({ reason: 'timeframe', finest: '1D', default: '1D' }));
            }
            return Promise.resolve(makeBars(range.limit ?? 50, DAY).slice(-(range.limit ?? 50)));
        },
        listSymbols: () => Promise.resolve([{ ticker: 'GDP' }, { ticker: 'CPI' }]),
    };
    return { provider, calls, count: (tf: string) => calls.filter((c) => c.tf === tf).length };
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    bars: OHLCV[] = [];
    loading = false;
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[]): void { this.bars = bars; }
    setLoading(loading: boolean): void { this.loading = loading; }
    updateBar(bar: OHLCV): void { this.bars.push(bar); }
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
}

/** An engine whose script asks the gateway for one secondary series and records the outcome. */
class SecondaryEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: false, visibleRange: false, inputs: true };
    outcome: Promise<unknown> | null = null;
    constructor(private readonly symbol: string, private readonly timeframe: string) {}
    prepare(_source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve({ language: 'pine', inputs: [], meta: { title: 'Sec', overlay: true }, reactsToViewport: false, token: { instanceId } });
    }
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const id = (req.prepared.token as { instanceId: string }).instanceId;
        this.outcome = req.fetchSeries!(this.symbol, this.timeframe, { limit: 10 }).then(
            (bars) => ({ ok: true, bars: bars.length }),
            (e: unknown) => ({ ok: false, error: e }),
        );
        handlers.onModel({ id, title: 'Sec', overlay: true, paneHint: 'price', series: [], fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} });
        handlers.onDone?.();
        return { stop: () => {}, update: () => {}, setVisibleRange: () => {}, notifyBars: () => {} };
    }
}

const charts: Vela[] = [];
function chartOn(symbol: string, timeframe: string, provider: DataProvider, opts: { live?: boolean; engines?: ScriptingEngine[] } = {}) {
    const renderer = new FakeRenderer();
    const feed = new MultiProviderFeed(new BarStore());
    const chart = new Vela({} as HTMLElement, { symbol, timeframe, live: opts.live ?? false, volume: false }, { renderer, engines: opts.engines ?? [], dataFeed: feed });
    charts.push(chart);
    const events: Array<VelaEventMap['data:unavailable']> = [];
    chart.on('data:unavailable', (e) => events.push(e));
    void chart.data.registerProvider('macro', provider);
    return { chart, renderer, events };
}

afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('DataUnavailableError and its guard', () => {
    it('builds a self-explaining message from its fields', () => {
        const e = new DataUnavailableError({ reason: 'timeframe', symbol: 'GDP', timeframe: '60', finest: '1D' });
        expect(e.message).toBe('GDP is not served at 60; its finest timeframe is 1D');
        expect(e.name).toBe('DataUnavailableError');
        expect(e).toBeInstanceOf(Error);
        expect(new DataUnavailableError({ reason: 'timeframe', symbol: 'GDP', timeframe: '60', finest: '1D', default: 'M' }).message).toBe(
            'GDP is not served at 60; its finest timeframe is 1D, its default timeframe is M',
        );
        expect(new DataUnavailableError({ reason: 'delisted', symbol: 'OLD' }).message).toBe('OLD is not available (delisted)');
        expect(new DataUnavailableError({ reason: 'timeframe' }, 'custom').message).toBe('custom');
    });

    it('accepts an error from another copy of Vela by its name and fields, never by its class', () => {
        // What another bundle's class looks like from here: same shape, different constructor.
        class ForeignError extends Error {
            override name = 'DataUnavailableError';
            reason = 'timeframe';
            finest = '1D';
        }
        const foreign = new ForeignError('GDP is not served at 60');
        expect(foreign instanceof DataUnavailableError).toBe(false);
        expect(isDataUnavailableError(foreign)).toBe(true);
        expect(isDataUnavailableError({ name: 'DataUnavailableError', reason: 'timeframe', message: 'x' })).toBe(true);
        expect(isDataUnavailableError(new DataUnavailableError({ reason: 'timeframe' }))).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isDataUnavailableError(new Error('boom'))).toBe(false);
        expect(isDataUnavailableError({ name: 'DataUnavailableError', message: 'no reason' })).toBe(false);
        expect(isDataUnavailableError({ name: 'DataUnavailableError', reason: 3, message: 'x' })).toBe(false);
        expect(isDataUnavailableError({ name: 'DataUnavailableError', reason: 'timeframe', message: 'x', finest: 1440 })).toBe(false);
        expect(isDataUnavailableError({ name: 'OtherError', reason: 'timeframe', message: 'x' })).toBe(false);
        expect(isDataUnavailableError(null)).toBe(false);
        expect(isDataUnavailableError('DataUnavailableError')).toBe(false);
    });
});

describe('MultiProviderFeed — a permanent refusal', () => {
    it('rejects load and loadRange with the error, the refused series filled in', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('macro', macroProvider().provider);
        const load = feed.load({ symbol: 'GDP', timeframe: '60', bars: 50 });
        await expect(load).rejects.toSatisfy(isDataUnavailableError);
        await expect(load).rejects.toMatchObject({ symbol: 'GDP', timeframe: '60', reason: 'timeframe', finest: '1D', default: '1D' });
        await expect(load).rejects.toThrow('GDP is not served at 60; its finest timeframe is 1D');
        await expect(feed.loadRange({ symbol: 'GDP', timeframe: '60' }, { limit: 10 })).rejects.toMatchObject({ name: 'DataUnavailableError', timeframe: '60' });
    });

    it('keeps reading a plain failure as an empty answer', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('macro', macroProvider({ refuse: 'error' }).provider);
        await expect(feed.load({ symbol: 'GDP', timeframe: '60', bars: 50 })).resolves.toEqual([]);
        await expect(feed.loadRange({ symbol: 'GDP', timeframe: '60' }, { limit: 10 })).resolves.toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('never caches a refusal as an empty series: the next ask reaches the provider again', async () => {
        const store = new BarStore();
        const feed = new MultiProviderFeed(store);
        const macro = macroProvider();
        await feed.registerProvider('macro', macro.provider);
        const range = { from: Date.now() - 10 * 3_600_000 };
        await expect(feed.loadRange({ symbol: 'GDP', timeframe: '60' }, range)).rejects.toSatisfy(isDataUnavailableError);
        expect(store.get(seriesKey('macro', 'GDP', '60'))).toBeUndefined();
        expect(store.coveredFromOf(seriesKey('macro', 'GDP', '60'))).toBeUndefined();
        await expect(feed.loadRange({ symbol: 'GDP', timeframe: '60' }, range)).rejects.toSatisfy(isDataUnavailableError);
        expect(macro.count('60')).toBe(2);
    });

    it('stops its live poll on a refusal, and keeps polling through plain failures', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const refuse of ['unavailable', 'error'] as const) {
            const feed = new MultiProviderFeed(new BarStore());
            const macro = macroProvider({ refuse });
            await feed.registerProvider('macro', macro.provider);
            const off = feed.subscribe({ symbol: 'macro:GDP', timeframe: '60' }, () => {});
            await vi.advanceTimersByTimeAsync(30_000);
            if (refuse === 'unavailable') expect(macro.count('60')).toBe(1);
            else expect(macro.count('60')).toBeGreaterThanOrEqual(9);
            off();
        }
    });
});

describe('the chart on a refused market', () => {
    it('ends the load, fires data:unavailable once with the fields, and never polls', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        const macro = macroProvider();
        const { chart, renderer, events } = chartOn('GDP', '60', macro.provider, { live: true });
        const ends: number[] = [];
        chart.on('load:end', (e) => ends.push(e.bars));
        const completes: string[] = [];
        chart.on('history:complete', (e) => completes.push(e.reason));
        await vi.advanceTimersByTimeAsync(10);
        await chart.ready();

        expect(events).toEqual([{ symbol: 'GDP', timeframe: '60', reason: 'timeframe', finest: '1D', default: '1D' }]);
        expect(renderer.loading).toBe(false); // no endless loading animation
        expect(renderer.bars).toEqual([]);
        expect(ends).toEqual([0]);
        expect(completes).toEqual(['aborted']);
        // The core never changes the timeframe the host set.
        expect(chart.market.timeframe).toBe('60');

        // Live is on, but a refused series has nothing to stream: no poll ever starts.
        const asked = macro.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(macro.calls.length).toBe(asked);
        expect(events).toHaveLength(1);
    });

    it('a switch to a refused timeframe settles the switch and stops the old market streaming', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        const macro = macroProvider();
        const { chart, renderer, events } = chartOn('GDP', 'D', macro.provider, { live: true });
        await vi.advanceTimersByTimeAsync(10);
        await chart.ready();
        expect(renderer.bars.length).toBeGreaterThan(0);
        expect(events).toEqual([]);

        await chart.setMarket({ timeframe: '60' }); // resolves — the refusal is handled, not thrown
        expect(events).toEqual([{ symbol: 'GDP', timeframe: '60', reason: 'timeframe', finest: '1D', default: '1D' }]);
        expect(renderer.loading).toBe(false);
        expect(renderer.bars).toEqual([]);

        const asked = macro.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(macro.calls.length).toBe(asked); // neither the old D poll nor a 60 poll runs

        // A served timeframe brings the market back, live included.
        await chart.setMarket({ timeframe: 'D' });
        expect(renderer.bars.length).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(macro.count('D')).toBeGreaterThan(1);
        expect(events).toHaveLength(1);
    });

    it('a progressive source that refuses ends the load the same way', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const macro = macroProvider();
        let progressiveCalls = 0;
        macro.provider.getBarsProgressive = (ticker, tf) => {
            progressiveCalls += 1;
            return Promise.reject(new DataUnavailableError({ reason: 'timeframe', symbol: ticker, timeframe: tf, finest: 'D' }));
        };
        const { chart, renderer, events } = chartOn('GDP', '60', macro.provider);
        await chart.ready();
        expect(progressiveCalls).toBe(1);
        expect(events).toEqual([{ symbol: 'GDP', timeframe: '60', reason: 'timeframe', finest: 'D' }]);
        expect(renderer.loading).toBe(false);
    });

    it('a refusal while deepening the history reports once and keeps what is painted', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const head = makeBars(10_000, 60_000);
        const feed: MarketDataFeed = {
            load: () => Promise.resolve(head),
            loadRange: () => Promise.reject(new DataUnavailableError({ reason: 'timeframe', finest: '1D' })),
            subscribe: () => () => {},
        };
        const renderer = new FakeRenderer();
        const chart = new Vela({} as HTMLElement, { symbol: 'GDP', timeframe: '1', bars: 30_000, volume: false }, { renderer, engines: [], dataFeed: feed });
        charts.push(chart);
        const events: Array<VelaEventMap['data:unavailable']> = [];
        chart.on('data:unavailable', (e) => events.push(e));
        const completes: string[] = [];
        chart.on('history:complete', (e) => completes.push(e.reason));
        await chart.ready();
        await chart.historyComplete();
        expect(events).toEqual([{ symbol: 'GDP', timeframe: '1', reason: 'timeframe', finest: '1D' }]);
        expect(completes).toEqual(['aborted']);
        expect(renderer.bars).toHaveLength(10_000);
    });

    it('a plain provider failure keeps today\'s posture: empty chart, no event, polling continues', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
        const macro = macroProvider({ refuse: 'error' });
        const { chart, renderer, events } = chartOn('GDP', '60', macro.provider, { live: true });
        await vi.advanceTimersByTimeAsync(10);
        await chart.ready();
        expect(renderer.loading).toBe(false);
        expect(renderer.bars).toEqual([]);
        expect(events).toEqual([]);
        const asked = macro.count('60');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(macro.count('60')).toBeGreaterThan(asked); // the transient-failure poll keeps trying
    });

    it('a refused SECONDARY series rejects to the engine and leaves the chart alone', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const macro = macroProvider();
        const engine = new SecondaryEngine('CPI', '60');
        const { chart, renderer, events } = chartOn('GDP', 'D', macro.provider, { engines: [engine] });
        await chart.ready();
        const painted = renderer.bars.length;
        expect(painted).toBeGreaterThan(0);
        const ends: number[] = [];
        chart.on('load:end', (e) => ends.push(e.bars));

        await chart.addIndicator('//@version=6\nindicator("x")', { language: 'pine' });
        await flush();
        const outcome = (await engine.outcome) as { ok: boolean; error?: unknown };
        expect(outcome.ok).toBe(false);
        expect(isDataUnavailableError(outcome.error)).toBe(true);
        expect(outcome.error).toMatchObject({ symbol: 'CPI', timeframe: '60', finest: '1D' });
        expect(String((outcome.error as Error).message)).toBe('CPI is not served at 60; its finest timeframe is 1D');

        expect(events).toEqual([]); // no chart-level event
        expect(ends).toEqual([]); // the chart's load state untouched
        expect(chart.market.timeframe).toBe('D'); // nor its timeframe
        expect(renderer.bars.length).toBe(painted);
    });
});
