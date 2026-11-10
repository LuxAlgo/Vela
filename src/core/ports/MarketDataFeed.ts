import type { OHLCV } from '../model/ohlcv';
import type { MarketConfig } from '../options';
import type { Unsubscribe } from '../util/types';

/**
 * Facts about one symbol, stated by its data source (`DataProvider.getSymbolInfo`): the
 * chart reads the typed keys below, and engines receive the whole record (e.g. Pine
 * `syminfo.*`). Free-form beyond them — engines read the keys they understand and
 * synthesize a fallback for the rest. Every typed key but `ticker` is optional, and an
 * absent one means the usual behavior.
 */
export interface SymbolInfo {
    ticker: string;
    /**
     * The market's IANA time zone (`'America/New_York'`, `'Etc/UTC'`): the zone `session`
     * and `session_extended` are written in, and the zone the "exchange" display time zone
     * follows. Absent or empty ⇒ `'Etc/UTC'`.
     */
    timezone?: string;
    /**
     * The regular trading hours, `HHMM-HHMM` in {@link timezone} (`'0930-1600'`; `2400` is
     * the end of the day). Any other non-empty value marks a market with sessions (the
     * regular/extended toggle, the calendar-driven market status) but shades nothing.
     * `'24x7'`, empty or absent ⇒ a continuous market.
     */
    session?: string;
    /**
     * The whole extended tape, `HHMM-HHMM` in {@link timezone}, containing the `session`
     * window (`'0400-2000'`). A span that wraps midnight (`'1700-1600'`) marks a market whose
     * trading day runs from evening to evening. Absent ⇒ the whole civil day.
     */
    session_extended?: string;
    /**
     * The timeframes the source serves for this symbol. Timeframe strings use the uppercase
     * canonical form: `'1D'` (or `'D'`), `'W'`, `'1M'` (or `'M'`), `'3M'`, `'12M'`, or bare
     * minutes such as `'60'`. Never lowercase: `'1m'` is one minute, not one month. Absent ⇒
     * the provider's `info().supportedTimeframes`, if any.
     */
    timeframes?: {
        /** The finest timeframe served. Every coarser one is served too, unless `list` is present. */
        finest: string;
        /** The source's own frequency: the natural timeframe to show the symbol in. */
        default?: string;
        /** When present, the EXHAUSTIVE list of timeframes served. */
        list?: readonly string[];
    };
    /**
     * `false` when the source has no volume data for this symbol: the chart then does not
     * add its volume indicator on its own (one the user added or saved stays). Absent or
     * `true` ⇒ volume as usual.
     */
    volume?: boolean;
    [key: string]: unknown;
}

/**
 * The market-data abstraction. Vela OWNS the candles: it loads history and
 * streams live ticks through this port, holds the one canonical bar array, and
 * hands it to whichever engine executes. Decoupled from scripting so every
 * registered engine shares the same dataset (no per-engine re-fetch).
 *
 * Swappable: the default is `MultiProviderFeed` (a registry of `DataProvider`s); tests
 * inject a fake; a host app can supply its own backend.
 */
/** A bounded fetch window (epoch ms). `from`/`to` inclusive-ish; `limit` caps the count. */
export interface BarRange {
    /** Oldest bar open-time to fetch from (inclusive). */
    from?: number;
    /** Newest bar open-time to fetch to (defaults to "now" when omitted). */
    to?: number;
    /** Max bars. */
    limit?: number;
    /**
     * Trading session to serve (`'regular'` | `'extended'`) — rides every request on
     * markets that have sessions; absent = the provider's default. A provider without
     * a session concept ignores it.
     */
    session?: string;
}

export interface MarketDataFeed {
    /**
     * Load the initial history (from a provider or the offline `data` array).
     *
     * Every bar method — `load`, `loadProgressive`, `loadRange` — rejects with a
     * `DataUnavailableError` when the source refuses the series for good. On the chart's
     * own market the chart then ends the load, stops live updates and fires
     * `data:unavailable`; on a secondary series the rejection reaches the engine through
     * `fetchSeries`. Feeds should keep transient failures out of this channel.
     */
    load(cfg: MarketConfig): Promise<OHLCV[]>;
    /**
     * Progressive load: emit growing snapshots while the source heals a cold symbol,
     * resolve with the final answer — `DataProvider.getBarsProgressive` semantics
     * (cumulative, confirmed-from-the-newest-bar snapshots; each extends the last).
     * Resolves NULL when the resolved source lacks the capability — the caller then
     * runs its non-progressive paths (single load, deep head + backfill) untouched.
     */
    loadProgressive?(cfg: MarketConfig, onBatch: (bars: OHLCV[]) => void, opts?: { signal?: AbortSignal }): Promise<OHLCV[] | null>;
    /** Subscribe to live forming-candle ticks. Returns an unsubscribe fn. */
    subscribe(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe;
    /** Optional symbol metadata for engines that need it; absent/undefined ≡ engine synthesizes. */
    symbolInfo?(cfg: MarketConfig): SymbolInfo | undefined;
    /**
     * Fetch a bounded range. Used by the cache to pull ONLY the uncached tail
     * (newly-closed + forming bars) instead of re-downloading the whole window.
     * Absent ≡ no ranged support; the cache falls back to a full `load`.
     */
    loadRange?(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]>;
    /**
     * Report that a symbol cannot be served by anything registered — the load is PARKED
     * (it resumes if a capable provider registers later). Hosts surface this instead of
     * leaving a silently blank chart. Absent ≡ the feed never parks.
     */
    onUnresolved?(cb: (info: { symbol: string; providers: string[] }) => void): Unsubscribe;
    /** Release feed-owned resources (parked waits, timers). Absent ≡ nothing to release. */
    destroy?(): void;
}
