import type { MarketDataFeed, BarRange, SymbolInfo } from '../core/ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from '../core/ports/DataProvider';
import type { MarketConfig } from '../core/options';
import type { OHLCV } from '../core/model/ohlcv';

import type { Unsubscribe } from '../core/util/types';
import { ProviderRegistry, type Resolved } from './ProviderRegistry';
import { CachingDataFeed } from './CachingDataFeed';
import { BarStore, sharedBarStore } from './BarStore';


/** (Reserved) cadence of a shared secondary-data poll fallback. */
/** Retry cadence while a subscription's symbol is still unresolvable (index settling). */
const RESOLVE_RETRY_MS = 500;

/** Bar duration in ms for a timeframe (Pine resolution code or `1h`-style) — offline tick cadence. */
function intervalMs(timeframe: string): number {
    const map: Record<string, number> = {
        '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
        '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000,
        '1': 60_000, '5': 300_000, '15': 900_000, '30': 1_800_000, '60': 3_600_000, '240': 14_400_000, D: 86_400_000, W: 604_800_000,
    };
    return map[timeframe] ?? 3_600_000;
}

/**
 * The default `MarketDataFeed`: a router over a registry of named `DataProvider`s.
 * It parses every symbol (`name:SYMBOL` / bare `SYMBOL`), resolves a provider,
 * rewrites the config to that provider's **canonical** identity, and delegates to
 * an internal {@link CachingDataFeed} — so `BTCUSDT` and `BINANCE:BTCUSDT` collapse
 * to one cache entry. Offline `data` bypasses the registry entirely.
 *
 * Providers are registered at runtime via `chart.data.registerProvider(...)`. Until
 * one that resolves the chart symbol is registered, `load` **parks** (its promise
 * stays pending) rather than fetching — so registration drives the first load.
 */
export class MultiProviderFeed implements MarketDataFeed {
    private readonly registry = new ProviderRegistry();
    private readonly cache: CachingDataFeed;
    /** The chart symbol's resolved provider — the default for bare secondary symbols. */
    private primaryProvider: string | null = null;
    /** A copy of offline history, used to synthesize ticks for the `data` path. */
    private liveBars: OHLCV[] = [];
    /** Sync-accessible symbol metadata, warmed by load()/symbolInfoFor (the engine reads it synchronously). */
    private readonly symInfoCache = new Map<string, SymbolInfo>();

    constructor(store: BarStore = sharedBarStore) {
        this.cache = new CachingDataFeed(new RegistryFetchFeed(this.registry), store);
    }

    // ── Registry surface (driven by chart.data / DataControl) ──────────────

    registerProvider(name: string, provider: DataProvider): Promise<void> {
        return this.registry.register(name, provider);
    }

    unregisterProvider(name: string): void {
        this.registry.unregister(name);
    }

    providers(): ProviderInfo[] {
        return this.registry.names().map((n) => this.registry.infoOf(n));
    }

    resolveSymbol(raw: string): Resolved | null {
        return this.registry.resolve(raw, { default: this.primaryProvider });
    }

    /** The registered provider INSTANCE under `name` (undefined if unknown). */
    providerInstance(name: string): DataProvider | undefined {
        return this.registry.get(name);
    }

    symbols(name?: string): SymbolDescriptor[] {
        return this.registry.symbolsOf(name);
    }

    /** Resolves when every registered provider's eager index has settled. */
    ready(): Promise<void> {
        return this.registry.indexReady();
    }

    /** Async per-symbol metadata (the facade's `chart.data.symbolInfo`); also warms the sync cache. */
    async symbolInfoFor(raw: string): Promise<SymbolInfo | undefined> {
        const resolved = this.registry.resolve(raw, { default: this.primaryProvider });
        if (!resolved) return undefined;
        const info = await this.registry.get(resolved.provider)?.getSymbolInfo?.(resolved.ticker);
        if (info) this.symInfoCache.set(symKey(resolved), info);
        return info;
    }

    /**
     * Per-symbol capabilities, resolved through the owning provider's `capabilitiesFor`
     * refinement (an instrument may support more than its provider-wide baseline), falling back to the
     * provider-wide `info()` capabilities. Null when nothing resolves the symbol.
     */
    capabilitiesFor(raw: string): ProviderCapabilities | null {
        const resolved = this.registry.resolve(raw, { default: this.primaryProvider });
        if (!resolved) return null;
        const provider = this.registry.get(resolved.provider);
        if (!provider) return null;
        return provider.capabilitiesFor?.(resolved.ticker) ?? this.registry.infoOf(resolved.provider).capabilities;
    }

    // ── MarketDataFeed ─────────────────────────────────────────────────────

    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        if (cfg.data && cfg.data.length > 0) {
            this.liveBars = cfg.data.map((b) => ({ ...b }));
            return cfg.data;
        }
        const resolved = await this.registry.whenResolvable(rawSymbol(cfg), { default: this.primaryProvider });
        this.primaryProvider ??= resolved.provider;
        // Warm symbol metadata for the engine. Fire-and-forget: one small request that
        // typically lands before the (heavier, paginated) bar load finishes.
        this.prefetchSymbolInfo(resolved);
        return this.cache.load(canonical(cfg, resolved));
    }

    /**
     * Synchronous per-symbol metadata for engines (Pine `syminfo.*`), served from the cache
     * warmed by load(). Undefined until the prefetch lands (the engine then synthesizes a
     * fallback) and real thereafter — the MarketDataFeed port is synchronous by contract.
     */
    symbolInfo(cfg: MarketConfig): SymbolInfo | undefined {
        if (cfg.data && cfg.data.length > 0) return undefined;
        const resolved = this.registry.resolve(rawSymbol(cfg), { default: this.primaryProvider });
        return resolved ? this.symInfoCache.get(symKey(resolved)) : undefined;
    }

    private prefetchSymbolInfo(resolved: Resolved): void {
        const key = symKey(resolved);
        if (this.symInfoCache.has(key)) return;
        const provider = this.registry.get(resolved.provider);
        if (!provider?.getSymbolInfo) return;
        void provider
            .getSymbolInfo(resolved.ticker)
            .then((info) => { if (info) this.symInfoCache.set(key, info); })
            .catch(() => {});
    }

    async loadRange(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        if (cfg.data && cfg.data.length > 0) return this.cache.loadRange(cfg, range);
        // Secondary series (request.security): resolve its OWN prefix, with the chart
        // provider as the bare default. Unresolvable ⇒ empty (the engine degrades).
        const resolved = this.registry.resolve(rawSymbol(cfg), { default: this.primaryProvider });
        if (!resolved) return [];
        return this.cache.loadRange(canonical(cfg, resolved), range);
    }

    subscribe(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        if (cfg.data && cfg.data.length > 0) return this.synthesizeTicks(cfg, onBar);
        const resolved = this.registry.resolve(rawSymbol(cfg), { default: this.primaryProvider });
        if (!resolved) return () => {};
        return this.cache.subscribe(canonical(cfg, resolved), onBar);
    }

    /**
     * Synthesize price-relative ticks for offline `data` runs (no network), so the
     * forming-candle path is exercised at any price scale. Mirrors the bundled
     * provider feed's offline behavior.
     */
    private synthesizeTicks(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        if (this.liveBars.length === 0) return () => {};
        const step = intervalMs(cfg.timeframe ?? '60');
        const timer = setInterval(() => {
            const bars = this.liveBars;
            const forming = bars[bars.length - 1];
            if (!forming) return;
            const jitter = forming.close * 0.0015 * (Math.random() - 0.5) * 2; // ±0.15% of price
            const close = Math.max(0, forming.close + jitter);
            const updated: OHLCV = { ...forming, close, high: Math.max(forming.high, close), low: Math.min(forming.low, close) };
            bars[bars.length - 1] = updated;
            onBar(updated);
            if (Math.random() < 0.12) {
                const next: OHLCV = { time: updated.time + step, open: updated.close, high: updated.close, low: updated.close, close: updated.close, volume: 0 };
                bars.push(next);
                onBar(next);
            }
        }, 1000);
        return () => clearInterval(timer);
    }
}

/** Build the raw symbol string the registry parses: honor a legacy `cfg.provider` as a prefix. */
function rawSymbol(cfg: MarketConfig): string {
    const symbol = cfg.symbol ?? '';
    if (cfg.provider && symbol && !symbol.includes(':')) return `${cfg.provider}:${symbol}`;
    return symbol;
}

/** Rewrite the config to the resolved provider + ticker (so the cache keys on canonical identity). */
function canonical(cfg: MarketConfig, resolved: Resolved): MarketConfig {
    return { ...cfg, provider: resolved.provider, symbol: resolved.ticker };
}

/** Cache key for resolved symbol metadata. */
function symKey(resolved: Resolved): string {
    return `${resolved.provider}|${resolved.ticker}`;
}

/**
 * Call a provider's getBars defensively: a throwing provider yields an empty result + a
 * warning, never a rejected load. Keeps the initial fetch as fault-tolerant as the live
 * poll (which already swallows transient errors) — a bad symbol or network blip empties
 * the chart instead of rejecting the parked load.
 */
async function safeBars(provider: DataProvider, ticker: string, tf: string, range: BarRange): Promise<OHLCV[]> {
    try {
        return await provider.getBars(ticker, tf, range);
    } catch (e) {
        console.warn(`[vela] data fetch failed for ${ticker} ${tf} — ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}

/**
 * The cache's inner feed: given a CANONICAL config (provider name + ticker already
 * resolved), look the provider up and call its neutral `getBars` / `subscribe`.
 * Live ticks use the provider's `subscribe` if it has one, else a generic 3s poll.
 */
class RegistryFetchFeed implements MarketDataFeed {
    constructor(private readonly registry: ProviderRegistry) {}

    load(cfg: MarketConfig): Promise<OHLCV[]> {
        const provider = this.registry.get(cfg.provider ?? '');
        if (!provider) return Promise.resolve([]);
        return safeBars(provider, cfg.symbol ?? '', cfg.timeframe ?? '60', { limit: cfg.bars ?? 500 });
    }

    loadRange(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        const provider = this.registry.get(cfg.provider ?? '');
        if (!provider) return Promise.resolve([]);
        return safeBars(provider, cfg.symbol ?? '', cfg.timeframe ?? '60', range);
    }

    subscribe(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        const provider = this.registry.get(cfg.provider ?? '');
        if (!provider) return () => {};
        const ticker = cfg.symbol ?? '';
        const tf = cfg.timeframe ?? '60';
        if (provider.subscribe) return provider.subscribe(ticker, tf, onBar);

        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const poll = async (): Promise<void> => {
            if (stopped) return;
            try {
                // Last two bars: the (possibly just-closed) previous bar and the forming
                // one. onBar dedupes by time, so the older one is harmless.
                const bars = await provider.getBars(ticker, tf, { limit: 2 });
                // Re-check AFTER the await: an unsubscribe during the fetch (a market
                // switch) must not push the OLD market's bars into the new series — on the
                // same timeframe the forming bar shares its open time, so a stale bar would
                // silently REPLACE the new market's forming candle.
                if (stopped) return;
                for (const b of bars) onBar(b);
            } catch {
                // transient error — keep polling
            }
            if (!stopped) timer = setTimeout(() => void poll(), 3000);
        };
        timer = setTimeout(() => void poll(), 3000);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
    }
}
