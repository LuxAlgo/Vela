import type { OHLCV } from '../core/model/ohlcv';

/** Cache key for one series. Symbols/timeframes never contain `|`. The session is a
 *  KEY dimension when non-default: regular and extended bars of one symbol genuinely
 *  differ (extended has more bars, and session dailies differ in OHLC), so they must
 *  never share a series. Absent/`regular` stays keyless — existing keys don't move. */
export function seriesKey(provider: string, symbol: string, timeframe: string, session?: string): string {
    return `${provider}|${symbol}|${timeframe}${session && session !== 'regular' ? `|${session}` : ''}`;
}

function symbolOf(key: string): string {
    return key.split('|')[1] ?? '';
}

/**
 * In-memory cache of CLOSED bars, keyed by `(provider, symbol, timeframe)`. Each
 * series holds a single time-sorted, de-duplicated array. Scoped to the current
 * symbol — `retainSymbol` evicts other symbols' series (the agreed purge policy;
 * smarter eviction comes later) — except symbols protected via `retain`, the
 * multi-chart seam: a workspace declares every cell's symbol so one cell's load
 * never evicts the others' history.
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
    /** Symbols protected from the current-symbol purge (multi-chart cells) — the UNION
     *  of every owner's declaration. Empty = legacy single-chart behavior. */
    private retained: ReadonlySet<string> = new Set();
    /** Per-owner declarations behind {@link retained} — several shells on one page must
     *  not clobber (or, on destroy, evict) each other's protected symbols. */
    private readonly retainedByOwner = new Map<unknown, ReadonlySet<string>>();

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
     * Symbols declared via {@link retain} are never purged.
     */
    retainSymbol(symbol: string): void {
        if (this.currentSymbol === symbol) return;
        this.currentSymbol = symbol;
        this.purgeOutside(symbol);
    }

    /**
     * Declare the set of symbols a multi-chart workspace is displaying (CANONICAL
     * tickers, post-registry resolution — `chart.data.resolve(sym).ticker`). These
     * survive every {@link retainSymbol} purge, so cells loading different symbols
     * stop evicting each other's history. Replaces the previous set FOR THAT OWNER
     * (pass the shell instance as `owner`; several shells on one page keep separate
     * declarations, the effective set is their union) and purges anything now outside
     * the union ∪ {currentSymbol} immediately. An empty set releases the owner's
     * declaration — with no owners left, the legacy single-chart policy is back.
     * Note: SECONDARY symbols a script fetches (`request.security` cross-symbol) are
     * not in this set and still drop on cross-cell loads — correctness is unaffected
     * (they re-fetch on demand).
     */
    retain(symbols: ReadonlySet<string>, owner: unknown = 'default'): void {
        if (symbols.size === 0) this.retainedByOwner.delete(owner);
        else this.retainedByOwner.set(owner, new Set(symbols));
        const union = new Set<string>();
        for (const set of this.retainedByOwner.values()) for (const s of set) union.add(s);
        this.retained = union;
        this.purgeOutside(this.currentSymbol);
    }

    /** Drop every series whose symbol is neither `current` nor retained. */
    private purgeOutside(current: string | undefined): void {
        for (const key of [...this.series.keys()]) {
            const sym = symbolOf(key);
            if (sym !== current && !this.retained.has(sym)) {
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
