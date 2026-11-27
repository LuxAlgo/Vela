import type { OHLCV } from '../core/model/ohlcv';
import type { DataProvider } from '../core/ports/DataProvider';
import type { BarRange, SymbolInfo } from '../core/ports/MarketDataFeed';
import type { Unsubscribe } from '../core/util/types';

/**
 * Context handed to a {@link SeriesAdapter} for one `(provider, ticker, timeframe)` request.
 * Everything needed to read base data, metadata, or extended provider surfaces without
 * reaching into feed internals.
 */
export interface SeriesAdapterContext {
    /** Registered provider name (e.g. `'binance'`). */
    readonly providerName: string;
    /** The registered provider instance (narrow with a type guard for extended feeds). */
    readonly provider: DataProvider;
    /** Provider-scoped ticker (without the `provider:` prefix). */
    readonly ticker: string;
    /** Requested chart timeframe (e.g. `'100T'`). */
    readonly timeframe: string;
    /** Trading session (`'regular'` | `'extended'`), when declared. */
    readonly session?: string;
    /** Cached per-symbol metadata from the owning provider, when available. */
    symbolInfo(): Promise<SymbolInfo | undefined>;
}

/**
 * A pluggable series adapter for custom or synthetic timeframe families (tick bars, volume
 * bars, range bars, derived resolutions). Registered globally through
 * {@link registerSeriesAdapter}; `MultiProviderFeed` consults registered adapters before
 * calling a provider's `getBars`/`subscribe` directly.
 */
export interface SeriesAdapter {
    /** Stable id — re-registering an id replaces the previous adapter. */
    readonly id: string;
    /** Return true when this adapter handles `(timeframe, provider)` (first match wins). */
    matches(timeframe: string, provider: DataProvider, providerName: string): boolean;
    /** Fetch historical bars for the adapted series. Throw `DataUnavailableError` to refuse permanently. */
    getBars(ctx: SeriesAdapterContext, range: BarRange): Promise<OHLCV[]>;
    /** Stream live updates for the adapted series. Absent ⇒ the feed polls `getBars`. */
    subscribe?(ctx: SeriesAdapterContext, onBar: (bar: OHLCV) => void): Unsubscribe;
    /** Optional per-symbol availability check powering timeframe picker gating. */
    supports?(ctx: Omit<SeriesAdapterContext, 'timeframe'>, timeframe: string): boolean | Promise<boolean>;
}

const adapters = new Map<string, SeriesAdapter>();

/**
 * Register a {@link SeriesAdapter}. Re-registering the same `id` replaces it. Returns a
 * disposer that removes this registration (leaving any later replacement intact).
 */
export function registerSeriesAdapter(adapter: SeriesAdapter): () => void {
    adapters.set(adapter.id, adapter);
    return () => {
        if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id);
    };
}

/** Remove a registered series adapter by id. */
export function unregisterSeriesAdapter(id: string): void {
    adapters.delete(id);
}

/** All currently registered series adapters, in registration order. */
export function seriesAdapters(): readonly SeriesAdapter[] {
    return [...adapters.values()];
}

/** The first registered adapter that claims `(timeframe, provider, providerName)`, or undefined. */
export function matchSeriesAdapter(timeframe: string, provider: DataProvider, providerName: string): SeriesAdapter | undefined {
    for (const adapter of adapters.values()) {
        if (adapter.matches(timeframe, provider, providerName)) return adapter;
    }
    return undefined;
}
