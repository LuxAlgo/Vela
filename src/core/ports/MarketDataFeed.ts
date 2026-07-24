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
}

export interface MarketDataFeed {
    /** Load the initial history (from a provider or the offline `data` array). */
    load(cfg: MarketConfig): Promise<OHLCV[]>;
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
}
