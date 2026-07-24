import type { OHLCV } from '../core/model/ohlcv';

/** Cache key for one series. Symbols/timeframes never contain `|`. */
export function seriesKey(provider: string, symbol: string, timeframe: string): string {
    return `${provider}|${symbol}|${timeframe}`;
}

function symbolOf(key: string): string {
    return key.split('|')[1] ?? '';
}

/**
 * In-memory cache of CLOSED bars, keyed by `(provider, symbol, timeframe)`. Each
 * series holds a single time-sorted, de-duplicated array. Scoped to the current
 * symbol — `retainSymbol` evicts other symbols' series (the agreed purge policy;
 * smarter eviction comes later).
 *
 * The default instance (`sharedBarStore`) is shared module-wide so it survives
 * chart re-creation — that's the whole point: a fresh run for the same symbol
 * reuses these bars instead of re-downloading them.
 */
export class BarStore {
    private readonly series = new Map<string, OHLCV[]>();
    /** Earliest bar-open time fetched for a series — what the cache actually covers. */
    private readonly coveredFrom = new Map<string, number>();
    private currentSymbol?: string;

    get(key: string): OHLCV[] | undefined {
        return this.series.get(key);
    }

    /**
     * Record that the series is covered back to `from`. Tracks the EARLIEST such
     * time — what's been fetched, not what bar boundary happens to align. The
     * coverage check uses this instead of the first cached bar's time (which is
     * always at/after the requested `from`, so it can never prove coverage).
     */
    markCovered(key: string, from: number): void {
        this.coveredFrom.set(key, Math.min(this.coveredFrom.get(key) ?? Infinity, from));
    }

    /** The earliest time the series is covered back to, or undefined if never fetched. */
    coveredFromOf(key: string): number | undefined {
        return this.coveredFrom.get(key);
    }

    /** Merge `bars` into the series (dedup by time, incoming wins); keeps it sorted. Returns the merged set. */
    merge(key: string, bars: OHLCV[]): OHLCV[] {
        if (bars.length === 0) return this.series.get(key) ?? [];
        const byTime = new Map<number, OHLCV>();
        for (const b of this.series.get(key) ?? []) byTime.set(b.time, b);
        for (const b of bars) byTime.set(b.time, b);
        const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
        this.series.set(key, merged);
        return merged;
    }

    /**
     * Scope the cache to the current chart symbol. Idempotent per symbol: only
     * purges other-symbol series when the symbol actually CHANGES — so secondary
     * series (request.security cross-symbol/HTF/LTF) fetched during a run survive
     * re-runs of the same chart, and are dropped only when the chart symbol flips.
     */
    retainSymbol(symbol: string): void {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        for (const key of [...this.series.keys()]) {
            if (symbolOf(key) !== symbol) {
                this.series.delete(key);
                this.coveredFrom.delete(key);
            }
        }
    }

    clear(): void {
        this.series.clear();
        this.coveredFrom.clear();
    }
}

/** Shared module-level store — survives chart re-creation so re-runs reuse bars. */
export const sharedBarStore = new BarStore();
