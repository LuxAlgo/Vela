import type { OHLCV } from '../model/ohlcv';
import type { MarketConfig } from '../options';
import type { Unsubscribe } from '../util/types';

/**
 * Symbol metadata an engine may need (e.g. Pine `syminfo.*`). Free-form beyond
 * `ticker` — engines read the keys they understand and synthesize a fallback for
 * the rest.
 */
export interface SymbolInfo {
    ticker: string;
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
    /** Load the initial history (from a provider or the offline `data` array). */
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
