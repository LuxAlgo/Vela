import type { MarketDataFeed, BarRange, SymbolInfo } from '../core/ports/MarketDataFeed';
import type { MarketConfig } from '../core/options';
import type { OHLCV } from '../core/model/ohlcv';
import type { Unsubscribe } from '../core/util/types';
import { BarStore, seriesKey, sharedBarStore } from './BarStore';
import { parseSymbol } from './ProviderRegistry';
import { timeframeToMs } from './timeframe';

/** Series cache key — the symbol's own grammar carries the venue: a `provider:` prefix
 *  keys per venue (the multi-provider feed hands canonical prefixed symbols down); a
 *  bare symbol keys venue-less, whatever serves it (single-feed setups). A non-default
 *  session keys its own series (regular and extended bars genuinely differ). */
function cacheKey(symbol: string, timeframe: string, session?: string): string {
    const { provider, ticker } = parseSymbol(symbol);
    return seriesKey(provider ?? '', ticker, timeframe, session);
}

/** Page size for big ranged fetches (mirrors the orchestrator's history chunks). */
const PAGE_BARS = 10_000;
/**
 * At/below this a ranged fetch stays a SINGLE request. One above {@link PAGE_BARS} so the
 * orchestrator's own backfill chunks (`CHUNK_BARS + 1` for the overlap bar) never split.
 */
const SINGLE_FETCH_BARS = PAGE_BARS + 1;

/**
 * A `MarketDataFeed` decorator that caches CLOSED bars in a shared in-memory
 * `BarStore`. A new indicator run for the same `(provider, symbol, timeframe)`
 * serves the already-fetched bars and re-downloads only the uncached **tail**
 * (newly-closed bars + the forming candle). The forming bar is never cached — the
 * live poll re-fetches it.
 *
 * Savings on a re-run ≈ ⌈N/1000⌉ − 1 requests: dormant for ≤1000-bar charts (the
 * single tail request is the whole fetch either way), paying off with deep
 * history. Needs the inner feed's `loadRange`; without it — or for offline
 * `data` — it transparently falls back to a full `load`.
 */
export class CachingDataFeed implements MarketDataFeed {
    constructor(
        private readonly inner: MarketDataFeed,
        private readonly store: BarStore = sharedBarStore,
    ) {}

    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        // Offline data is already in memory — nothing to cache.
        if (cfg.data && cfg.data.length > 0) return this.inner.load(cfg);

        const symbol = cfg.symbol ?? 'TEST';
        const key = cacheKey(symbol, cfg.timeframe ?? '60', cfg.session);
        this.store.retainSymbol(symbol); // current-symbol-only purge
        const cached = this.store.get(key);
        const n = cfg.bars ?? 500;

        // Tail-only path: enough closed history is cached to cover the requested
        // window (`n - 1` accounts for the forming bar we always drop). Fetch just
        // the tail from the last cached bar and merge.
        const lastCached = cached?.[cached.length - 1];
        if (cached && lastCached && cached.length >= n - 1 && this.inner.loadRange) {
            const { bars: tail } = await this.fetchRange(cfg, { from: lastCached.time });
            const closed = this.store.merge(key, dropForming(tail));
            return attachForming(closed, tail[tail.length - 1]).slice(-n);
        }

        // Cold path / requested more than cached: full fetch, cache the closed bars.
        const bars = await this.inner.load(cfg);
        this.store.merge(key, dropForming(bars));
        return bars;
    }

    /**
     * Progressive twin of {@link load}: a COLD load streams through the inner feed's
     * progressive path — batches forwarded verbatim, the FINAL answer cached exactly as
     * `load` caches — while a cache-covered load answers once through `load` itself (a
     * warm chart has nothing to stream). Falls back to `load` wholesale when the inner
     * feed lacks the capability, so callers may prefer this method unconditionally.
     */
    async loadProgressive(cfg: MarketConfig, onBatch: (bars: OHLCV[]) => void, opts?: { signal?: AbortSignal }): Promise<OHLCV[] | null> {
        if (cfg.data && cfg.data.length > 0) return this.inner.load(cfg);
        if (!this.inner.loadProgressive) return null;
        const symbol = cfg.symbol ?? 'TEST';
        const key = cacheKey(symbol, cfg.timeframe ?? '60', cfg.session);
        const cached = this.store.get(key);
        const n = cfg.bars ?? 500;
        const lastCached = cached?.[cached.length - 1];
        if (cached && lastCached && cached.length >= n - 1 && this.inner.loadRange) return this.load(cfg); // warm: the tail-merge path
        this.store.retainSymbol(symbol);
        const bars = await this.inner.loadProgressive(cfg, onBatch, opts);
        if (bars == null) return null; // the resolved provider turned out incapable
        this.store.merge(key, dropForming(bars));
        return bars;
    }

    /**
     * Cache-backed ranged fetch — the gateway engines use for secondary series
     * (`request.security` HTF/LTF/cross-symbol) and the orchestrator's backward
     * history chunks. Caches per `(provider, symbol, timeframe)` in the shared
     * store. Three cache-friendly shapes:
     * - **historical** (`to` before the cached tip): served straight from cache
     *   when it provably holds the window, else fetched whole (and cached — no
     *   forming bar can exist there);
     * - **backward extension** (`from` older than coverage): fetch ONLY the
     *   missing head, never the already-covered remainder again;
     * - **tail** (everything else covered): refresh only from the last cached bar.
     * Falls back to a full `load` when the inner feed has no ranged support.
     */
    async loadRange(cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        if (!this.inner.loadRange) return this.inner.load(cfg);
        const key = cacheKey(cfg.symbol ?? 'TEST', cfg.timeframe ?? '60', cfg.session);
        let cached = this.store.get(key);
        let newest = cached?.[cached.length - 1];

        // Historical request — strictly older than the cached tip. The tail path can
        // never serve it (it only extends the NEWEST edge; before this branch existed,
        // a count-bounded `{to, limit}` walk would read "covered" off the bar COUNT and
        // return the whole cache unfiltered, so a backward chunk loop never progressed).
        if (range.to != null && newest && range.to < newest.time) {
            const older = cached!.filter((b) => b.time <= range.to!);
            const covFrom = this.store.coveredFromOf(key) ?? Infinity;
            const covered = range.limit != null
                ? older.length >= range.limit && (range.from == null || covFrom <= range.from)
                : range.from != null && covFrom <= range.from;
            if (covered) {
                let out = range.from != null ? older.filter((b) => b.time >= range.from!) : older;
                if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
                return out;
            }
            // Every bar at/before `to` predates the cached tip → closed → cache whole.
            // The `to` filter guards against providers that over-serve past the bound.
            const fetched = await this.fetchRange(cfg, range);
            const bars = fetched.bars.filter((b) => b.time <= range.to!);
            if (bars.length > 0) {
                this.store.merge(key, bars);
                this.store.markCovered(key, fetched.coveredDownTo ?? bars[0]!.time);
            }
            return bars;
        }

        // Backward extension: the request reaches OLDER than coverage — fetch only the
        // missing head `[from, coveredFrom]`, merge, and serve the rest from cache below
        // (a re-run over deepened history must never re-download the covered middle).
        if (newest && range.from != null) {
            const covFrom = this.store.coveredFromOf(key);
            if (covFrom != null && covFrom > range.from) {
                const { bars: head, coveredDownTo } = await this.fetchRange(cfg, { from: range.from, to: covFrom });
                this.store.merge(key, head.filter((b) => b.time <= covFrom)); // capped at the covered edge → closed
                this.store.markCovered(key, coveredDownTo ?? range.from);
                cached = this.store.get(key);
                newest = cached?.[cached.length - 1];
            }
        }

        const coveredFrom = this.store.coveredFromOf(key);
        // Tail-only path: the cache was fetched from at/before the requested `from`
        // (or holds enough bars when the request is count-bounded with no `from`).
        // Uses the recorded covered-from, NOT the first cached bar's time — that's
        // always at/after `from`, so it can never prove coverage (the HTF-warmup bug).
        const covers = !!cached && cached.length > 0 && !!newest && (
            range.from != null ? coveredFrom != null && coveredFrom <= range.from : range.limit == null || cached.length >= range.limit
        );
        if (covers && newest) {
            const { bars: tail } = await this.fetchRange(cfg, { from: newest.time, to: range.to, limit: range.limit });
            const closed = this.store.merge(key, dropForming(tail));
            const full = attachForming(closed, tail[tail.length - 1]);
            let out = range.from != null ? full.filter((b) => b.time >= range.from!) : full;
            if (range.to != null) out = out.filter((b) => b.time <= range.to!);
            return out;
        }

        // Miss: fetch the requested range, cache its closed bars, and record coverage.
        const { bars, coveredDownTo } = await this.fetchRange(cfg, range);
        this.store.merge(key, dropForming(bars));
        this.store.markCovered(key, coveredDownTo ?? range.from ?? bars[0]?.time ?? 0);
        return bars;
    }

    /**
     * THE provider round-trip chokepoint for ranged fetches. Two jobs:
     * - Every request goes out with an **explicit `limit`** — some sources clip a
     *   limit-less request to a small default window and tail-slice, silently
     *   truncating wide date-bounded fetches (the `request.security` bug).
     * - A request bigger than one page walks **backward in bounded pages**, so a
     *   multi-hundred-thousand-bar series arrives as digestible responses instead
     *   of one giant clip-prone payload.
     * Returns ascending merged bars plus the oldest time the walk PROVED
     * (`coveredDownTo`) — honest coverage marking: a count-satisfied early stop
     * must never claim the requested `from`.
     */
    private async fetchRange(cfg: MarketConfig, range: BarRange): Promise<{ bars: OHLCV[]; coveredDownTo: number | undefined }> {
        const tfMs = timeframeToMs(cfg.timeframe ?? '60');
        const estimate = estimateBars(range, tfMs);
        if (estimate <= SINGLE_FETCH_BARS) {
            const bars = await this.inner.loadRange!(cfg, { ...range, limit: range.limit ?? estimate });
            return { bars, coveredDownTo: range.from ?? bars[0]?.time };
        }
        // Backward count-paged walk from the newest edge.
        const byTime = new Map<number, OHLCV>();
        let cursor = range.to ?? Date.now();
        for (;;) {
            if (range.from != null && cursor < range.from) break;
            const want = range.limit != null ? range.limit - byTime.size : PAGE_BARS;
            if (want <= 0) break;
            const page = await this.inner.loadRange!(cfg, { to: cursor, limit: Math.min(PAGE_BARS, want) });
            let oldest = Infinity;
            for (const b of page) {
                if (b.time < oldest) oldest = b.time;
                if (b.time <= cursor && (range.from == null || b.time >= range.from)) byTime.set(b.time, b);
            }
            if (page.length === 0) {
                // Empty-page semantics differ by source: a count-based provider spans quiet
                // gaps, so empty means nothing older exists (stop — the genesis signal). A
                // time-window source can return an empty WINDOW inside a legit gap — with a
                // `from` bound we keep stepping the window down (a genesis-aware server
                // answers pre-genesis steps locally, so this stays cheap).
                if (range.from == null) break;
                cursor -= PAGE_BARS * tfMs;
                continue;
            }
            if (oldest - 1 >= cursor) break; // defensive: no backward progress
            cursor = oldest - 1;
        }
        const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
        // Proven floor: a from-bounded walk that ran out the bottom covered down to `from`;
        // an early stop only proves down to the oldest bar actually seen.
        const walkedOut = range.from != null && cursor < range.from;
        return { bars, coveredDownTo: walkedOut ? range.from : bars[0]?.time };
    }

    subscribe(cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        return this.inner.subscribe(cfg, onBar);
    }

    symbolInfo(cfg: MarketConfig): SymbolInfo | undefined {
        return this.inner.symbolInfo?.(cfg);
    }
}

/**
 * Estimated bar count of a range — drives single-vs-paged and the explicit limit put on
 * date-bounded requests. The 1.1× + 2 slack absorbs variable-length periods (calendar
 * months on 'M') and the forming bar, so a computed limit can never under-serve.
 */
function estimateBars(range: BarRange, tfMs: number): number {
    if (range.limit != null) return range.limit;
    if (range.from == null) return PAGE_BARS; // unbounded and unlimited — page-sized default
    const span = Math.max(0, (range.to ?? Date.now()) - range.from);
    return Math.ceil((span / tfMs) * 1.1) + 2;
}

/** Drop the last bar — treated as the forming/in-progress candle, never cached. */
function dropForming(bars: OHLCV[]): OHLCV[] {
    return bars.length > 0 ? bars.slice(0, -1) : bars;
}

/** Re-attach the live forming bar to the closed set for display (if it's genuinely newer). */
function attachForming(closed: OHLCV[], forming: OHLCV | undefined): OHLCV[] {
    if (!forming) return closed;
    const last = closed[closed.length - 1];
    return !last || forming.time > last.time ? [...closed, forming] : closed;
}
