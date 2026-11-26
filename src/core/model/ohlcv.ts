import type { Millis } from './time';

/** A single price bar. `time` is the bar's open time in epoch ms. */
export interface OHLCV {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    /**
     * Optional monotonic bar identity within a series, for variable-duration series
     * (such as tick bars) where distinct bars may open in the same millisecond. When
     * present on both bars, updates match by `(time, seq)` instead of `time` alone so a
     * new bar in the same millisecond appends rather than overwriting the closed bar.
     */
    seq?: number;
}

/** Whether `a` and `b` address the same bar slot (live refinement of the forming bar). */
export function isSameBar(a: OHLCV, b: OHLCV): boolean {
    if (a.time !== b.time) return false;
    if (a.seq !== undefined && b.seq !== undefined) return a.seq === b.seq;
    return true;
}

/** Whether `bar` opens strictly after `last` (a new bar to append). */
export function isNewerBar(bar: OHLCV, last: OHLCV): boolean {
    if (bar.time > last.time) return true;
    if (bar.time === last.time && bar.seq !== undefined && last.seq !== undefined) return bar.seq > last.seq;
    return false;
}

/**
 * Index of the closed bar in `bars` (sorted by open time, the forming bar last) that opens
 * when `bar` does, or -1: the candle a late final value replaces. Always -1 for bars that
 * carry `seq`, whose open time does not name a single bar.
 */
export function closedBarIndex(bars: readonly OHLCV[], bar: OHLCV): number {
    if (bar.seq !== undefined) return -1;
    let lo = 0;
    let hi = bars.length - 2;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = bars[mid]!;
        if (at.time === bar.time) return at.seq === undefined ? mid : -1;
        if (at.time < bar.time) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/** Whether two bars hold the same open time, prices and volume. */
export function sameBarValues(a: OHLCV, b: OHLCV): boolean {
    return a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
}
