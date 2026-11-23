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
