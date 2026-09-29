import type { MarketDataFeed, SymbolInfo, BarRange } from './ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor, TradeDepth, TradeRange } from './ports/DataProvider';
import type { Trade } from './model/tape';
import type { Unsubscribe } from './util/types';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import type { Resolved } from '../data/ProviderRegistry';

/**
 * The chart's data control surface (`chart.data`) — the sibling of `chart.renderer`.
 * Registers market-data providers and queries the registry (resolve a symbol, list
 * providers/symbols, fetch per-symbol metadata).
 *
 * It operates on the default {@link MultiProviderFeed}. If a fully custom feed was
 * injected via `deps.dataFeed`, that feed manages its own data and the
 * registration/query methods warn + no-op (mirroring `chart.renderer.set` on an
 * unsupported feature).
 */
export class DataControl {
    private readonly registry: MultiProviderFeed | null;

    constructor(feed: MarketDataFeed) {
        this.registry = feed instanceof MultiProviderFeed ? feed : null;
    }

    /**
     * Register (or replace) a data provider under `name`. Any symbol prefixed `name:`
     * (case-insensitive), or a bare symbol the provider's index contains, routes to it.
     * Returns synchronously and is chainable: it kicks a background symbol-index build,
     * and if the chart symbol resolves through this provider the parked initial load
     * fires. Await `chart.ready()` for that load, or `chart.data.ready()` for the index.
     */
    registerProvider(name: string, provider: DataProvider): this {
        if (!this.registry) {
            console.warn(
                `[vela] chart.data.registerProvider("${name}") ignored — the active data feed ` +
                    `is a custom feed (deps.dataFeed), not the default provider registry.`,
            );
            return this;
        }
        void this.registry.registerProvider(name, provider);
        return this;
    }

    /** Remove a registered provider. */
    unregisterProvider(name: string): this {
        this.registry?.unregisterProvider(name);
        return this;
    }

    /** Metadata for every registered provider. */
    providers(): ProviderInfo[] {
        return this.registry?.providers() ?? [];
    }

    /** Resolve a symbol string to `{ provider, ticker }`, or null if nothing serves it. */
    resolve(symbol: string): Resolved | null {
        return this.registry?.resolveSymbol(symbol) ?? null;
    }

    /**
     * The DISPLAY prefix for `symbol` — the listing venue its descriptor declares
     * (`NASDAQ` for AAPL) or the resolved provider name. Null while unresolvable.
     */
    displayPrefix(symbol: string): string | null {
        return this.registry?.displayPrefix(symbol) ?? null;
    }

    /** The canonical `PREFIX:TICKER` form of `symbol`, or null while unresolvable. */
    canonicalSymbol(symbol: string): string | null {
        return this.registry?.canonicalSymbol(symbol) ?? null;
    }

    /**
     * The registered provider INSTANCE under `name` — the seam for EXTENDED provider
     * surfaces: a provider may implement interfaces beyond the `DataProvider` port
     * (extra data kinds, venue-specific APIs); consumers retrieve the instance and
     * narrow it with their own type guard. Returns undefined if the name is unknown
     * (or a custom `deps.dataFeed` bypasses the registry).
     */
    providerInstance(name: string): DataProvider | undefined {
        return this.registry?.providerInstance(name);
    }

    /** Indexed symbols for one provider (or all) — for autocomplete. */
    symbols(provider?: string): SymbolDescriptor[] {
        return this.registry?.symbols(provider) ?? [];
    }

    /** The icon URL for `symbol` — its owning provider's `resolveSymbolIcon`, routed
     *  through resolution. Undefined while unresolvable, when the provider declares no
     *  resolver, or on a custom `deps.dataFeed` — the shells then show initials. */
    symbolIcon(symbol: string): string | undefined {
        return this.registry?.symbolIcon(symbol);
    }

    /** Per-symbol metadata (Pine `syminfo.*`), resolved through the owning provider. */
    symbolInfo(symbol: string): Promise<SymbolInfo | undefined> {
        return this.registry?.symbolInfoFor(symbol) ?? Promise.resolve(undefined);
    }

    /**
     * The full resolved capabilities for `symbol` — per-instrument when the provider refines
     * them (`capabilitiesFor`), else its provider-wide declaration. Null while nothing
     * resolves the symbol (a provider may still be registering), so callers that can act
     * later should re-read rather than latch the first answer.
     */
    capabilities(symbol: string): ProviderCapabilities | null {
        return this.registry?.capabilitiesFor(symbol) ?? null;
    }

    /**
     * Fetch the TAPE for `symbol` over `range` — the executions behind the bars, each
     * with its aggressor side. This is the raw door; order-flow consumers that want the
     * tape folded into per-bar price clusters use the aggregation layer instead of
     * bucketing it themselves.
     *
     * Empty when the symbol does not resolve yet, when the venue serves no trade history,
     * or when the requested window is out of the provider's reach (see {@link tradeDepth}) —
     * all three are final answers with nothing to retry. A fetch that FAILS rejects, so a
     * caller can tell a failed window from a quiet one and retry it; accumulating a tape
     * without that distinction means summing across a hole and reporting the result as
     * complete.
     */
    trades(symbol: string, range: TradeRange = {}, opts?: { signal?: AbortSignal }): Promise<Trade[]> {
        return this.registry?.tradesFor(symbol, range, opts) ?? Promise.resolve([]);
    }

    /**
     * Subscribe to `symbol`'s live tape; trades arrive in batches. A no-op unsubscribe
     * comes back when the venue streams no tape. Prefer ONE subscription shared between
     * views over one per view — every consumer of the same symbol reads the same prints.
     */
    subscribeTrades(symbol: string, onTrades: (trades: readonly Trade[]) => void): Unsubscribe {
        return this.registry?.subscribeTradesFor(symbol, onTrades) ?? (() => {});
    }

    /**
     * How far back `symbol`'s tape reaches (see {@link TradeDepth}) — what an order-flow
     * view checks before promising to reconstruct history. `'none'` while nothing
     * resolves the symbol, so callers that can act later should re-read rather than
     * latch the first answer.
     */
    tradeDepth(symbol: string): TradeDepth {
        return this.registry?.tradeDepthFor(symbol) ?? 'none';
    }

    /** Whether `symbol`'s venue can stream a live tape (`subscribeTrades` delivers). */
    tradeStream(symbol: string): boolean {
        return this.registry?.tradeStreamFor(symbol) ?? false;
    }

    /** Resolves when every registered provider's eager index has settled. */
    ready(): Promise<void> {
        return this.registry?.ready() ?? Promise.resolve();
    }
}
