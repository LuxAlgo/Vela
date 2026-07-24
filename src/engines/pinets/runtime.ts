import { PineTS, Indicator } from 'pinets';
import type {
    PreparedScript,
    ExecutionMarket,
    VisibleBarRange,
    FetchSeries,
    EngineAlert,
    EngineWarning,
} from '../../core/ports/ScriptingEngine';
import type { OHLCV } from '../../core/model/ohlcv';
import type { InputValue } from '../../core/model/inputs';
import type { IndicatorModel } from '../../core/model/indicator';
import { normalizeContext } from './normalizeContext';
import { toScene } from './toScene';
import { mapInputs, type RawPineInput } from './inputsMeta';

/**
 * The transport-agnostic PineTS runtime: parse a script, run it once over bars,
 * and map the PineTS context to the neutral model. Shared by the in-process
 * `PineEngine` and the worker-backed `PineWorkerEngine` — neither the bars source
 * nor `fetchSeries` care whether they're in-process or across a worker boundary,
 * so the same code runs in both. This (with the `pinets/` mapper) is the only PineTS
 * coupling; everything above it is neutral.
 */

/** One static run's neutral result. */
export interface PineRunResult {
    model: IndicatorModel;
    alerts: EngineAlert[];
    warnings: EngineWarning[];
    reactsToViewport: boolean;
    /** The raw run context — engines derive read-only snapshots from it (never exposed live). */
    ctx: unknown;
}

/** A reusable PineTS Indicator instance, recreated only when the input-set changes. */
export interface IndicatorCache {
    lastKey?: string;
    lastInd?: InstanceType<typeof Indicator>;
}

/** The serializable identity of a prepared script (safe to cross a worker boundary). */
export interface PineToken {
    source: string;
    instanceId: string;
}

/** Parse a Pine source: inputs schema + declaration metadata + viewport-dependence. No market data. */
export function preparePine(source: string, instanceId: string): PreparedScript {
    const inputs = mapInputs(Indicator.from(source).getInputsMeta() as RawPineInput[]);
    const overlay = /overlay\s*[:=]\s*true/.test(source);
    const title = source.match(/indicator\(\s*["']([^"']+)["']/)?.[1] ?? 'Indicator';
    // Statically detect viewport dependence so the orchestrator can route:
    // viewport-dependent scripts keep the (debounced) full-run path; others stream.
    const reactsToViewport = /chart\.(left|right)_visible_bar(_time)?\b/.test(source);
    return { language: 'pine', inputs, meta: { title, overlay }, reactsToViewport, token: { source, instanceId } satisfies PineToken };
}

/**
 * A fresh Indicator per input-set: PineTS bakes input overrides at construction, so
 * reuse the last instance when inputs are unchanged (live ticks / re-runs) to avoid
 * re-transpiling on every poke.
 */
export function indicatorFor(cache: IndicatorCache, source: string, inputs: Record<string, InputValue>): InstanceType<typeof Indicator> {
    const key = JSON.stringify(inputs);
    if (cache.lastKey !== key || !cache.lastInd) {
        cache.lastInd = new Indicator(source, inputs);
        cache.lastKey = key;
    }
    return cache.lastInd;
}

/** Run a prepared script once over `bars`, returning the neutral model + alerts/warnings. */
export async function runPineStatic(opts: {
    ind: InstanceType<typeof Indicator>;
    bars: OHLCV[];
    market: ExecutionMarket;
    visibleRange: VisibleBarRange | undefined;
    prepared: PreparedScript;
    instanceId: string;
    inputs: Record<string, InputValue>;
    fetchSeries: FetchSeries | undefined;
}): Promise<PineRunResult> {
    const { ind, bars, market, visibleRange, prepared, instanceId, inputs, fetchSeries } = opts;
    const klines = toKlines(bars);
    // The virtual provider: serve the chart's own series in-memory (the bars Vela
    // owns), but route any OTHER (symbol, timeframe) — i.e. request.security HTF/LTF/
    // cross-symbol — back to Vela's cache-backed gateway. PineTS reuses this same
    // provider for its secondary contexts, so MTF data is real and timeframe-separated.
    const source = {
        getMarketData: (sym?: string, tf?: string, limit?: number, sDate?: number, eDate?: number) =>
            isChartSeries(sym, tf, market) ? Promise.resolve(klines) : secondaryKlines(fetchSeries, sym, tf, limit, sDate, eDate),
        getSymbolInfo: async (sym?: string) => syminfoForSymbol(market, sym),
    };
    const pine = new PineTS(source as never, chartTickerOf(market), market.timeframe, klines.length);
    await pine.ready();
    // Feed the chart viewport so `chart.left/right_visible_bar_time` resolve to the
    // visible window; a no-op for scripts that don't reference those built-ins.
    if (visibleRange) pine.setVisibleRange(visibleRange.left, visibleRange.right);
    const ctx = (await pine.run(ind)) as PineCtx;
    const reactsToViewport = typeof pine.usesVisibleRange === 'function' ? pine.usesVisibleRange() : false;

    return {
        model: pineCtxToModel(ctx, instanceId, prepared, inputs, bars[0]?.time),
        alerts: (ctx.alerts ?? []).map(mapAlert),
        warnings: (ctx.warnings ?? []).map(mapWarning),
        reactsToViewport,
        ctx, // raw run context — engines derive read-only snapshots from it (never exposed live)
    };
}

/**
 * Map a PineTS run/stream context to the neutral indicator model. `anchorTime` is the
 * time of the FIRST bar this run executed over — index-aligned renderers align the
 * model's dense arrays and `bar_index` drawings to the chart through it (offset 0 when
 * the run spanned the whole chart, the norm).
 */
export function pineCtxToModel(ctx: unknown, instanceId: string, prepared: PreparedScript, inputs: Record<string, InputValue>, anchorTime?: number): IndicatorModel {
    const { model } = toScene(normalizeContext(ctx as never), instanceId);
    model.inputs = prepared.inputs;
    model.inputValues = { ...defaultsOf(prepared.inputs), ...inputs };
    if (anchorTime != null) model.anchorTime = anchorTime;
    return model;
}

/** OHLCV → PineTS kline shape (openTime-keyed). */
export function toKlines(bars: OHLCV[]): Array<Record<string, number>> {
    return bars.map((b) => ({ openTime: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
}

/**
 * The ticker the CHART SERIES is addressed by — THE CHART TYPE IS THE TICKER, the single
 * channel through which PineTS learns it. On a bar-transforming style the chart's data
 * is its derived view, so the chart ticker is the EXTENDED ticker (`"SYM;heikinashi"`):
 * PineTS derives `chart.is_heikinashi` + the `syminfo.tickerid` suffix from it, and a
 * PLAIN same-symbol request becomes unambiguous — it can only mean STANDARD data
 * (routed through the gateway), never the in-memory view. Without this,
 * `security(ticker.standard(...), <chart tf>, …)` would collide with the chart series
 * and silently receive derived bars. Only the bar-transforming style matters — every
 * other Vela price style draws standard data.
 */
export function chartTickerOf(market: ExecutionMarket): string {
    return market.chartStyle === 'heikinashi' ? `${market.symbol};heikinashi` : market.symbol;
}

/** True when PineTS is asking for the chart's own series (served in-memory) — addressed by {@link chartTickerOf}. */
export function isChartSeries(sym: string | undefined, tf: string | undefined, market: ExecutionMarket): boolean {
    return (sym == null || sym === chartTickerOf(market)) && (tf == null || tf === market.timeframe);
}

/** Klines for a secondary (non-chart) series via Vela's cache-backed gateway. */
export async function secondaryKlines(
    fetchSeries: FetchSeries | undefined,
    sym: string | undefined,
    tf: string | undefined,
    limit?: number,
    sDate?: number,
    eDate?: number,
): Promise<Array<Record<string, number>>> {
    if (!fetchSeries || !sym || !tf) return [];
    const bars = await fetchSeries(sym, tf, { from: sDate, to: eDate, limit });
    return toKlines(bars);
}

/** The streaming provider a live PineTS session polls (see {@link makeLiveProvider}). */
export interface LiveProvider {
    markDirty(): void;
    getMarketData(ticker: string, tf: string, limit?: number, sDate?: number, eDate?: number): Promise<unknown[]>;
    getSymbolInfo(ticker?: string): Promise<Record<string, unknown>>;
}

/**
 * A provider adapter that serves the chart's OWN live bars to a streaming PineTS
 * instance (no extra network). Dedupes so the stream only re-executes when the
 * bars actually change (or when `markDirty()` forces it, e.g. on a visible-range
 * change). Mirrors `IProvider.getMarketData(ticker, tf, limit, sDate, eDate)`:
 * `sDate == null` = the stream's initial full-history load; non-null = a live
 * poll for the tail, where an EMPTY result means "no change — skip execution".
 * Shared by the in-process live engine and the worker's streaming session (the
 * only difference is how `getBars` is backed: a closure vs a message-fed array).
 */
export function makeLiveProvider(getBars: () => OHLCV[], getMarket: () => ExecutionMarket, fetchSeries: FetchSeries | undefined): LiveProvider {
    let lastKey = '';
    let dirty = false;
    return {
        markDirty: () => {
            dirty = true;
        },
        getMarketData: async (ticker, tf, limit, sDate, eDate) => {
            // Secondary series (request.security HTF/LTF/cross-symbol) → cache-backed gateway.
            if (!isChartSeries(ticker, tf, getMarket())) {
                return secondaryKlines(fetchSeries, ticker, tf, limit, sDate, eDate);
            }
            const klines = toKlines(getBars());
            // Initial load (no sDate): full history.
            if (sDate == null) return klines;
            // Streaming update: only the forming candle + any newer bars.
            const tail = klines.filter((k) => (k.openTime ?? 0) >= sDate);
            const last = tail[tail.length - 1];
            const sig = last ? `${tail.length}|${last.openTime}|${last.close}|${last.high}|${last.low}|${last.volume}` : '';
            if (!dirty && sig === lastKey) return []; // unchanged → no re-execution
            dirty = false;
            lastKey = sig;
            return tail;
        },
        getSymbolInfo: async (ticker) => syminfoForSymbol(getMarket(), ticker),
    };
}

/** A running live stream (see {@link openLiveStream}). */
export interface LiveStreamHandle {
    stop(): void;
    setVisibleRange(left: number, right: number): void;
    /** Force the next poll through the provider's dedupe (e.g. after a viewport change). */
    markDirty(): void;
    /** The most recent raw run context (null before the first streamed evaluation). */
    lastCtx(): unknown;
}

/**
 * Open ONE persistent streaming PineTS session over the caller's bars: PineTS polls the
 * {@link makeLiveProvider} adapter (its dedupe makes quiet polls free) and re-executes only
 * the forming/new bars per tick; each emission maps to a neutral model stamped with the
 * stream's anchor (its first bar — the history is frozen at open, so a deepened chart needs
 * a REOPEN, not a poke). Shared by the in-process live engine and the worker's live
 * sessions — the transport differs, the session logic doesn't.
 */
export function openLiveStream(opts: {
    token: PineToken;
    cache: IndicatorCache;
    prepared: PreparedScript;
    inputs: Record<string, InputValue>;
    bars: () => OHLCV[];
    market: () => ExecutionMarket;
    fetchSeries?: FetchSeries;
    visibleRange?: VisibleBarRange;
    onModel(model: IndicatorModel): void;
    onAlert?(alert: EngineAlert): void;
    onWarning?(warning: EngineWarning): void;
    onError?(error: Error): void;
}): LiveStreamHandle {
    const bars = opts.bars();
    const ind = indicatorFor(opts.cache, opts.token.source, opts.inputs);
    const anchorTime = bars[0]?.time;
    // pageSize = full length: the initial drain must emit ONE complete model (a smaller
    // page would mount a partial one); ≥1 so an empty array can't zero the page size.
    const initialLen = Math.max(1, bars.length);
    const provider = makeLiveProvider(opts.bars, opts.market, opts.fetchSeries);
    const pine = new PineTS(provider as never, chartTickerOf(opts.market()), opts.market().timeframe, initialLen);
    if (opts.visibleRange) pine.setVisibleRange(opts.visibleRange.left, opts.visibleRange.right);
    const evt = pine.stream(ind, { live: true, interval: 1000, pageSize: initialLen }) as {
        on(e: string, cb: (arg: unknown) => void): void;
        stop(): void;
    };
    let stopped = false;
    let lastCtx: unknown = null;
    evt.on('data', (ctx) => {
        if (stopped) return;
        lastCtx = ctx;
        try {
            opts.onModel(pineCtxToModel(ctx, opts.token.instanceId, opts.prepared, opts.inputs, anchorTime));
        } catch (err) {
            opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
    });
    evt.on('alert', (a) => opts.onAlert?.(mapAlert(a as never)));
    evt.on('warning', (w) => opts.onWarning?.(mapWarning(w as never)));
    evt.on('error', (e) => opts.onError?.(e instanceof Error ? e : new Error(String(e))));
    return {
        stop: () => {
            stopped = true;
            evt.stop();
        },
        setVisibleRange: (left, right) => {
            pine.setVisibleRange(left, right);
            provider.markDirty();
        },
        markDirty: () => provider.markDirty(),
        lastCtx: () => lastCtx,
    };
}

/** syminfo for a (possibly secondary) symbol — synthesizes per-symbol when it differs from the chart. */
export function syminfoForSymbol(market: ExecutionMarket, sym: string | undefined): Record<string, unknown> {
    // A secondary symbol may arrive as an extended ticker ("SYM;heikinashi"); synthesize
    // the display fields from the PLAIN symbol (the modifier is a data-routing marker,
    // not part of the instrument's identity).
    const plain = sym ? sym.split(';')[0]! : sym;
    return plain && plain !== market.symbol ? syminfoFor({ symbol: plain, timeframe: market.timeframe }) : syminfoFor(market);
}

/** Symbol info for execution: prefer the feed's, else synthesize from the ticker. */
function syminfoFor(market: ExecutionMarket): Record<string, unknown> {
    if (market.symbolInfo) return market.symbolInfo;
    const symbol = market.symbol;
    const base = symbol.replace(/(USDT|USDC|USD|PERP|BUSD)$/i, '') || symbol;
    return {
        ticker: symbol,
        tickerid: symbol,
        main_tickerid: symbol,
        description: symbol,
        prefix: '',
        root: symbol,
        type: 'crypto',
        basecurrency: base,
        currency: 'USD',
        timezone: 'UTC',
        session: 'regular',
        mintick: 0.01,
        minmove: 1,
        pointvalue: 1,
        pricescale: 100,
    };
}

interface PineCtx {
    alerts?: RawAlert[];
    warnings?: RawWarning[];
}
interface RawAlert {
    id?: unknown;
    message?: unknown;
    title?: string;
    time?: unknown;
    bar_index?: unknown;
    freq?: string;
}
interface RawWarning {
    message?: unknown;
    method?: string;
    bar?: unknown;
}

function defaultsOf(inputs: PreparedScript['inputs']): Record<string, InputValue> {
    const out: Record<string, InputValue> = {};
    for (const input of inputs) out[input.key] = input.defval;
    return out;
}

export function mapAlert(a: RawAlert): EngineAlert {
    return {
        id: String(a.id ?? ''),
        message: String(a.message ?? ''),
        title: a.title,
        time: Number(a.time ?? 0),
        barIndex: Number(a.bar_index ?? 0),
        freq: a.freq,
    };
}

export function mapWarning(w: RawWarning): EngineWarning {
    return { message: String(w.message ?? ''), method: w.method, bar: Number(w.bar ?? 0) };
}
