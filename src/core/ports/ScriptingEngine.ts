import type { OHLCV } from '../model/ohlcv';
import type { InputSchema, InputValue } from '../model/inputs';
import type { IndicatorMeta, IndicatorModel } from '../model/indicator';
import type { SymbolInfo, BarRange } from './MarketDataFeed';
import type { PriceStyle } from '../options';

/**
 * A cache-backed data gateway the engine uses to fetch ANY `(symbol, timeframe)`
 * series it needs — the main series stays in-memory, but secondary series
 * (Pine `request.security` HTF/LTF/cross-symbol) are fetched + cached through
 * this so they get real, correctly-resolved data (no aggregation; timeframes
 * kept separate). Provided by the orchestrator, backed by `MarketDataFeed`.
 */
export type FetchSeries = (symbol: string, timeframe: string, range: BarRange) => Promise<OHLCV[]>;

/** The chart's visible bar-time window (epoch ms of the left/right edges). */
export interface VisibleBarRange {
    left: number;
    right: number;
}

export interface EngineAlert {
    id: string;
    message: string;
    title?: string;
    time: number;
    barIndex: number;
    freq?: string;
}

export interface EngineWarning {
    message: string;
    method?: string;
    bar: number;
}

/**
 * A source script that has been parsed (inputs + declaration metadata extracted)
 * and is ready to execute. `token` is engine-internal and opaque to core — the
 * engine reads it back in `execute()`.
 */
export interface PreparedScript {
    /** The language that produced this (the engine's `language`). */
    language: string;
    inputs: InputSchema[];
    meta: IndicatorMeta;
    /**
     * Whether the script references a viewport built-in (e.g. Pine
     * `chart.left_visible_bar_time`). Detected statically at prepare; an engine
     * may refine it in place after the first run.
     */
    reactsToViewport: boolean;
    readonly token: unknown;
}

/** What an engine can do — lets the orchestrator route without engine-specific checks. */
export interface EngineCapabilities {
    /** Can maintain a persistent incremental context for live ticks (vs a full re-run). */
    streaming: boolean;
    /** Understands viewport-dependent execution (`chart.*_visible_bar_time`-style). */
    visibleRange: boolean;
    /** Exposes an inputs schema (drives the renderer's settings dialog). */
    inputs: boolean;
}

/** Market context an execution needs. Vela owns the bars; this is the metadata. */
export interface ExecutionMarket {
    symbol: string;
    timeframe: string;
    /** Provider symbol metadata (Pine `syminfo.*`). May be absent or partial: the feed
     *  fetches it asynchronously (the `MarketDataFeed.symbolInfo` port is synchronous), so
     *  the first run can see a synthesized fallback and later runs the real values. */
    symbolInfo?: SymbolInfo;
    /** The chart's active price style. An engine adapter encodes a bar-transforming style
     *  into the chart's ticker identity (the extended ticker `"SYM;heikinashi"` — see
     *  `chartTickerOf`), from which chart-type builtins derive. The BARS an execution
     *  receives are already the style's view — this is metadata, not a request to
     *  transform. Optional; engines may ignore it. */
    chartStyle?: PriceStyle;
}

/**
 * One execution request. Vela owns the bars and passes them in — the engine
 * never fetches market data. `mode: 'static'` runs on demand (and re-runs when
 * the session is poked); `mode: 'live'` keeps a streaming context that emits per
 * tick (only requested when `capabilities.streaming`).
 */
export interface ExecutionRequest {
    prepared: PreparedScript;
    market: ExecutionMarket;
    /** The initial bar snapshot. */
    bars: OHLCV[];
    /** Live accessor to Vela's canonical array (read on each re-run / tick). */
    getBars?: () => OHLCV[];
    /**
     * Fetch a secondary `(symbol, timeframe)` series (Pine `request.security`
     * HTF/LTF/cross-symbol). Cache-backed by Vela's data feed. Absent ≡ no
     * gateway (secondary fetches degrade to empty).
     */
    fetchSeries?: FetchSeries;
    inputs?: Record<string, InputValue>;
    visibleRange?: VisibleBarRange;
    mode: 'static' | 'live';
    /**
     * Where the chart's history load stands at session start. `'backfill'` = older
     * chunks are still streaming in (the bars snapshot is a PARTIAL history); the
     * engine decides run policy — the bundled engines defer their first run until
     * the `'complete'` notification, a progressive engine may run immediately.
     * Absent ≡ `'complete'` (history fully loaded — today's behavior).
     */
    historyState?: 'backfill' | 'complete';
}

/** The event sink. `onModel` fires on the first run and on every re-run / live tick. */
export interface ExecutionHandlers {
    onModel(model: IndicatorModel): void;
    onAlert?(alert: EngineAlert): void;
    onWarning?(warning: EngineWarning): void;
    onError?(error: Error): void;
    /** A `static` run finished; not fired for an open live stream. */
    onDone?(): void;
}

/**
 * Why the chart's bars changed, carried on {@link ExecutionSession.notifyBars}.
 * `'backfill'` = older history chunks prepended (the load is still in progress);
 * `'complete'` = the history backfill just finished (fires once). `undefined` =
 * a live tick / new bar at the tail — today's meaning. Run policy is the
 * ENGINE's: the bundled engines skip `'backfill'` and run on `'complete'`/ticks;
 * a progressive engine may re-run on every reason.
 */
export type BarsChangeReason = 'backfill' | 'complete';

/** A running execution — the control surface the orchestrator drives. */
/** A read-only, serializable snapshot of a running script's execution context. */
export interface EngineContextSnapshot {
    language: string;
    /** 'computing' while a static run is in flight, 'streaming' on a live session, 'idle' after done/stop. */
    phase: 'idle' | 'computing' | 'streaming';
    /** Index of the last computed bar. */
    barIndex: number;
    meta: { title: string; overlay: boolean; precision?: number; shorttitle?: string };
    /** Named plot outputs, per key: index-aligned `{time, value}` points. */
    plots: Record<string, ReadonlyArray<{ time: number; value: unknown }>>;
    /** The script's variables — the engine's serializable subset (never live references). */
    variables: Record<string, unknown>;
    /** The script's RETURN value — the designed data-out channel for host code. */
    result: unknown;
    warnings: EngineWarning[];
}

/** Keys a caller may restrict a context snapshot to (limits worker structured-clone cost). */
export type ContextSelect = ReadonlyArray<keyof EngineContextSnapshot>;

export interface ExecutionSession {
    /**
     * OPTIONAL capability — resolve a read-only context snapshot (null when the run
     * hasn't produced one yet). Always a COPY: mutating it never touches the engine.
     */
    getContext?(select?: ContextSelect): Promise<EngineContextSnapshot | null>;
    /** Tear down (stops any streaming / incremental re-execution). */
    stop(): void;
    /** Re-run / re-stream with merged input overrides. */
    update(inputs: Record<string, InputValue>): void;
    /** Update the viewport window (re-runs viewport-dependent scripts; no-op otherwise). */
    setVisibleRange(range: VisibleBarRange): void;
    /** Signal that Vela's bars changed. No reason = live tick; see {@link BarsChangeReason}. */
    notifyBars(reason?: BarsChangeReason): void;
}

/**
 * The scripting-engine abstraction. The orchestrator talks only to this, so every
 * concrete engine is swappable and Vela itself SHIPS none — engines are separate
 * packages (Pine Script: `@luxalgo/vela-pinets`) or host code written against this
 * port (see docs/contributing/adding-an-engine.md). Engines are registered by `language` and selected per
 * `addIndicator({ language })`; market data is owned by Vela's
 * `MarketDataFeed` and passed into `execute`.
 */
export interface ScriptingEngine {
    /** Language id this engine handles, e.g. `'pine'`. The registry key. */
    readonly language: string;
    readonly capabilities: EngineCapabilities;
    /** Parse a script: extract its inputs schema + declaration metadata. No market data. */
    prepare(source: string, instanceId: string): Promise<PreparedScript>;
    /** Execute (static or live). Returns a session control handle. */
    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession;
}
