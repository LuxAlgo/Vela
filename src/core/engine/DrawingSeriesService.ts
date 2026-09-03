import { timeframeToMs } from '../../data/timeframe';
import type { OHLCV } from '../model/ohlcv';
import type { BarRange } from '../ports/MarketDataFeed';
import type { Unsubscribe } from '../util/types';
import type { DrawingSeriesGateway, DrawingSeriesState } from '../drawings/series';

/** Hard cap on the bars one request may demand — a huge area at a tiny timeframe must
 *  degrade to `too-wide`, not melt the provider. */
const MAX_BARS = 5000;
/** Fetch padding as a fraction of the requested span, each side — small anchor drags stay cache hits. */
const PAD_FRAC = 0.25;
/** Bounded memory: total cached windows across all (market, timeframe) keys. */
const MAX_ENTRIES = 16;
/** A failed fetch parks its window this long before a paint may retry it. */
const RETRY_MS = 15_000;
/** The steps `'auto'` resolves against — the largest one at least 4× finer than the chart. */
const AUTO_STEPS = ['240', '60', '30', '15', '5', '1'] as const;

/** One fetched (or in-flight) time window of one (market, timeframe) series. */
interface RangeEntry {
    from: number;
    to: number;
    bars: OHLCV[];
    /** 0 while the first fetch is in flight. */
    fetchedAt: number;
    pending: boolean;
    /** Set when the last fetch failed — the window answers `loading` until {@link RETRY_MS} passes. */
    failedAt: number;
}

/** What the service needs from its owner (the orchestrator) — all read live per call. */
export interface DrawingSeriesDeps {
    /** Ranged fetch of the chart's own symbol at `timeframe` (the cache-backed feed path). */
    fetchBars(timeframe: string, range: BarRange): Promise<OHLCV[]>;
    /** False when the market has no ranged source (inline `data` series, no `loadRange`). */
    canFetch(): boolean;
    /** The chart's own timeframe (canonical string) — what `'auto'` and `not-lower` resolve against. */
    chartTimeframe(): string;
    /** Cache identity of the current market (symbol + session) — a market switch simply misses. */
    marketKey(): string;
}

/**
 * The core implementation of {@link DrawingSeriesGateway}: a synchronous window cache
 * over the feed's ranged fetch. A read either serves a covering cached window, or kicks
 * ONE background fetch for the (padded) window and answers `loading`; completion fires
 * `onUpdate` and the next paint finds the bars. Windows whose right edge reaches the
 * live bar refresh at most once per bar interval — the refetch rides the feed's own
 * closed-bar cache, so it stays cheap.
 */
export class DrawingSeriesService implements DrawingSeriesGateway {
    /** Cached windows per `market|timeframe` key, newest-used last (LRU across keys). */
    private readonly cache = new Map<string, RangeEntry[]>();
    private readonly listeners = new Set<() => void>();

    constructor(private readonly deps: DrawingSeriesDeps) {}

    seriesInRange(timeframe: string, from: number, to: number): DrawingSeriesState {
        if (!this.deps.canFetch()) return { state: 'unavailable', reason: 'no-source' };
        const resolved = this.resolveTimeframe(timeframe);
        if (typeof resolved !== 'string') return { state: 'unavailable', reason: resolved.reason };
        const barMs = timeframeToMs(resolved);
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        if (!(hi > lo) || !(barMs > 0)) return { state: 'unavailable', reason: 'not-lower' };
        if ((hi - lo) / barMs > MAX_BARS) return { state: 'unavailable', reason: 'too-wide' };

        const key = `${this.deps.marketKey()}|${resolved}`;
        const entries = this.cache.get(key) ?? [];
        const covering = entries.find((e) => e.from <= lo && e.to >= hi);
        if (covering) {
            if (covering.pending) return this.loading(entries, resolved, barMs, lo, hi);
            if (covering.failedAt > 0) {
                if (Date.now() - covering.failedAt < RETRY_MS) return this.loading(entries, resolved, barMs, lo, hi);
                entries.splice(entries.indexOf(covering), 1); // parked long enough — refetch below
            } else {
                this.maybeRefresh(key, covering, resolved, barMs, hi);
                return { state: 'ready', bars: this.slice(covering.bars, lo, hi), timeframe: resolved, barMs };
            }
        }
        this.fetchWindow(key, entries, resolved, lo, hi);
        return this.loading(entries, resolved, barMs, lo, hi);
    }

    onUpdate(listener: () => void): Unsubscribe {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // ── internals ──

    /** `'auto'` → the largest standard step at least 4× finer than the chart (else the finest
     *  step still below it); an explicit timeframe passes only when strictly finer. Failures
     *  distinguish "this pick isn't lower" from "NOTHING lower exists" (the chart is already
     *  at the finest offered step) so the consumer can word its notice honestly. */
    private resolveTimeframe(timeframe: string): string | { reason: 'not-lower' | 'none-lower' } {
        const chartMs = timeframeToMs(this.deps.chartTimeframe());
        const finest = AUTO_STEPS[AUTO_STEPS.length - 1]!;
        if (timeframeToMs(finest) >= chartMs) return { reason: 'none-lower' };
        const tf = timeframe.trim() || 'auto';
        if (tf === 'auto') {
            for (const step of AUTO_STEPS) {
                if (timeframeToMs(step) <= chartMs / 4) return step;
            }
            return finest; // no step subdivides 4× — the finest one below the chart still magnifies
        }
        return timeframeToMs(tf) < chartMs ? tf : { reason: 'not-lower' };
    }

    /** The `loading` answer, carrying best-effort PARTIAL bars from settled overlapping
     *  windows — a widened window keeps painting what it already has while it fetches. */
    private loading(entries: RangeEntry[], timeframe: string, barMs: number, lo: number, hi: number): DrawingSeriesState {
        const partial = new Map<number, OHLCV>();
        for (const e of entries) {
            if (e.pending || e.failedAt > 0) continue;
            if (e.to < lo || e.from > hi) continue;
            for (const b of this.slice(e.bars, lo, hi)) partial.set(b.time, b);
        }
        if (partial.size === 0) return { state: 'loading', timeframe, barMs };
        const bars = [...partial.values()].sort((a, b) => a.time - b.time);
        return { state: 'loading', timeframe, barMs, bars };
    }

    /** Kick ONE background fetch for the padded window. Any OVERLAPPING in-flight fetch
     *  defers this one (a corner drag repaints per pointer move — kicking a window per
     *  frame would spam the provider); when it lands, the next paint re-evaluates. */
    private fetchWindow(key: string, entries: RangeEntry[], timeframe: string, lo: number, hi: number): void {
        if (entries.some((e) => e.pending && e.to >= lo && e.from <= hi)) return;
        const pad = (hi - lo) * PAD_FRAC;
        const entry: RangeEntry = { from: lo - pad, to: hi + pad, bars: [], fetchedAt: 0, pending: true, failedAt: 0 };
        entries.push(entry);
        this.cache.set(key, entries);
        this.evict();
        void this.deps
            .fetchBars(timeframe, { from: entry.from, to: entry.to })
            .then((bars) => {
                entry.bars = bars;
                entry.fetchedAt = Date.now();
                entry.pending = false;
                this.absorbOverlaps(key, entry);
                this.fire();
            })
            .catch(() => {
                // Environmental (network/provider) — park the window so paints don't hot-loop
                // retries; RETRY_MS later a paint drops it and tries again.
                entry.pending = false;
                entry.failedAt = Date.now();
                this.fire();
            });
    }

    /** A window whose right edge reaches the newest fetched bar refreshes at most once per
     *  bar interval — new closed bars ride the feed's cache, only the live tail re-fetches. */
    private maybeRefresh(key: string, entry: RangeEntry, timeframe: string, barMs: number, hi: number): void {
        if (entry.pending) return;
        const lastBar = entry.bars.length > 0 ? entry.bars[entry.bars.length - 1]!.time : entry.from;
        if (hi < lastBar) return; // fully historical — closed bars don't change
        if (Date.now() - entry.fetchedAt < barMs) return;
        entry.pending = true;
        void this.deps
            .fetchBars(timeframe, { from: entry.from, to: entry.to })
            .then((bars) => {
                entry.bars = bars;
                entry.fetchedAt = Date.now();
                entry.pending = false;
                this.fire();
            })
            .catch(() => {
                // Keep serving the stale window; the next eligible paint retries.
                entry.pending = false;
                entry.fetchedAt = Date.now();
            });
    }

    /** Merge windows that overlap `entry` into it (dedupe by bar time) so a key's list
     *  converges instead of accumulating slivers. */
    private absorbOverlaps(key: string, entry: RangeEntry): void {
        const entries = this.cache.get(key);
        if (!entries) return;
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const other = entries[i]!;
            if (other === entry || other.pending || other.failedAt > 0) continue;
            if (other.to < entry.from || other.from > entry.to) continue;
            const byTime = new Map<number, OHLCV>();
            for (const b of other.bars) byTime.set(b.time, b);
            for (const b of entry.bars) byTime.set(b.time, b); // the fresh fetch wins ties
            entry.bars = [...byTime.values()].sort((a, b) => a.time - b.time);
            entry.from = Math.min(entry.from, other.from);
            entry.to = Math.max(entry.to, other.to);
            entry.fetchedAt = Math.min(entry.fetchedAt, other.fetchedAt || entry.fetchedAt);
            entries.splice(i, 1);
        }
    }

    /** Drop the oldest settled windows once the global count passes {@link MAX_ENTRIES}. */
    private evict(): void {
        let total = 0;
        for (const entries of this.cache.values()) total += entries.length;
        while (total > MAX_ENTRIES) {
            let oldestKey: string | null = null;
            let oldestIdx = -1;
            let oldestAt = Infinity;
            for (const [key, entries] of this.cache) {
                for (let i = 0; i < entries.length; i += 1) {
                    const e = entries[i]!;
                    if (e.pending) continue; // never drop an in-flight window
                    const at = e.fetchedAt || e.failedAt;
                    if (at < oldestAt) {
                        oldestKey = key;
                        oldestIdx = i;
                        oldestAt = at;
                    }
                }
            }
            if (oldestKey == null) return; // everything in flight — nothing evictable
            const entries = this.cache.get(oldestKey)!;
            entries.splice(oldestIdx, 1);
            if (entries.length === 0) this.cache.delete(oldestKey);
            total -= 1;
        }
    }

    /** Bars whose open time falls within `[lo, hi]` (ascending input → linear scan is fine). */
    private slice(bars: readonly OHLCV[], lo: number, hi: number): OHLCV[] {
        const out: OHLCV[] = [];
        for (const b of bars) {
            if (b.time < lo) continue;
            if (b.time > hi) break;
            out.push(b);
        }
        return out;
    }

    private fire(): void {
        for (const l of [...this.listeners]) l();
    }
}
