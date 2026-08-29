import type { OHLCV } from '../../model/ohlcv';

/**
 * Pure array math for the classic indicator catalog. Every function is
 * bar-aligned: input and output arrays index 1:1 with the chart's bars, and
 * `NaN` marks "no value yet" (warm-up) or an honest gap (e.g. a volume-less
 * bar in a volume study) — the adapter turns non-finite entries into series
 * whitespace. Windowed ops emit NaN until the window is fully finite, and
 * recursive ops (EMA/RMA) re-seed after a mid-stream gap instead of carrying
 * a stale state across it.
 */

/** Price-source vocabulary shared by every classic with a `source` input. */
export const SOURCES = ['Close', 'Open', 'High', 'Low', 'HL2', 'HLC3', 'OHLC4', 'HLCC4'] as const;
export type SourceName = (typeof SOURCES)[number];

/** Resolve a source name to per-bar values. Unknown names fall back to Close. */
export function sourceValues(bars: readonly OHLCV[], source: string): number[] {
    const out = new Array<number>(bars.length);
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!;
        switch (source) {
            case 'Open': out[i] = b.open; break;
            case 'High': out[i] = b.high; break;
            case 'Low': out[i] = b.low; break;
            case 'HL2': out[i] = (b.high + b.low) / 2; break;
            case 'HLC3': out[i] = (b.high + b.low + b.close) / 3; break;
            case 'OHLC4': out[i] = (b.open + b.high + b.low + b.close) / 4; break;
            case 'HLCC4': out[i] = (b.high + b.low + b.close + b.close) / 4; break;
            default: out[i] = b.close;
        }
    }
    return out;
}

/** Per-bar volume; NaN where the provider reports none (gaps, never fake zeros). */
export function volumes(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => (b.volume != null && Number.isFinite(b.volume) ? b.volume : Number.NaN));
}

export function highs(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => b.high);
}

export function lows(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => b.low);
}

export function closes(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => b.close);
}

export function opens(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => b.open);
}

/** Element-wise combine of same-length arrays; any NaN operand yields NaN. */
export function zip(a: readonly number[], b: readonly number[], f: (x: number, y: number) => number): number[] {
    const out = new Array<number>(a.length);
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        out[i] = Number.isFinite(x) && Number.isFinite(y) ? f(x, y) : Number.NaN;
    }
    return out;
}

export function map(a: readonly number[], f: (x: number) => number): number[] {
    const out = new Array<number>(a.length);
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        out[i] = Number.isFinite(x) ? f(x) : Number.NaN;
    }
    return out;
}

export function add(a: readonly number[], b: readonly number[]): number[] {
    return zip(a, b, (x, y) => x + y);
}

export function sub(a: readonly number[], b: readonly number[]): number[] {
    return zip(a, b, (x, y) => x - y);
}

/** Windowed fold: NaN until `len` consecutive finite values end at the index. */
function windowed(v: readonly number[], len: number, fold: (window: readonly number[], from: number, to: number) => number): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    if (len <= 0) return out;
    // Track the length of the finite run ending at i so a single mid-stream NaN
    // restarts the warm-up instead of poisoning one output only.
    let run = 0;
    for (let i = 0; i < v.length; i++) {
        run = Number.isFinite(v[i]!) ? run + 1 : 0;
        if (run >= len) out[i] = fold(v, i - len + 1, i);
    }
    return out;
}

/** Rolling sum over `len` bars. */
export function sum(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) s += w[k]!;
        return s;
    });
}

/** Simple moving average. */
export function sma(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) s += w[k]!;
        return s / len;
    });
}

/** Linearly weighted moving average (weights 1..len, newest heaviest). */
export function wma(v: readonly number[], len: number): number[] {
    const norm = (len * (len + 1)) / 2;
    return windowed(v, len, (w, from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) s += w[k]! * (k - from + 1);
        return s / norm;
    });
}

/** Volume-weighted moving average. */
export function vwma(src: readonly number[], vol: readonly number[], len: number): number[] {
    const pv = zip(src, vol, (p, q) => p * q);
    return zip(sum(pv, len), sum(vol, len), (a, b) => (b > 0 ? a / b : Number.NaN));
}

/** Population standard deviation over `len` bars. */
export function stdev(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) s += w[k]!;
        const mean = s / len;
        let sq = 0;
        for (let k = from; k <= to; k++) {
            const d = w[k]! - mean;
            sq += d * d;
        }
        return Math.sqrt(sq / len);
    });
}

/** Mean absolute deviation over `len` bars (the CCI denominator). */
export function meanDev(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) s += w[k]!;
        const mean = s / len;
        let dev = 0;
        for (let k = from; k <= to; k++) dev += Math.abs(w[k]! - mean);
        return dev / len;
    });
}

export function highest(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let m = -Infinity;
        for (let k = from; k <= to; k++) if (w[k]! > m) m = w[k]!;
        return m;
    });
}

export function lowest(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let m = Infinity;
        for (let k = from; k <= to; k++) if (w[k]! < m) m = w[k]!;
        return m;
    });
}

/** Bars since the window's highest value (0 = the current bar). */
export function barsSinceHighest(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let m = -Infinity;
        let at = to;
        for (let k = from; k <= to; k++) {
            if (w[k]! >= m) {
                m = w[k]!;
                at = k;
            }
        }
        return to - at;
    });
}

/** Bars since the window's lowest value (0 = the current bar). */
export function barsSinceLowest(v: readonly number[], len: number): number[] {
    return windowed(v, len, (w, from, to) => {
        let m = Infinity;
        let at = to;
        for (let k = from; k <= to; k++) {
            if (w[k]! <= m) {
                m = w[k]!;
                at = k;
            }
        }
        return to - at;
    });
}

/** Recursive average with seed = SMA of the first clean window; re-seeds after a gap. */
function recursive(v: readonly number[], len: number, alpha: number): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    let run = 0;
    let prev = Number.NaN;
    for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        if (!Number.isFinite(x)) {
            run = 0;
            prev = Number.NaN;
            continue;
        }
        run += 1;
        if (Number.isFinite(prev)) {
            prev = alpha * x + (1 - alpha) * prev;
            out[i] = prev;
        } else if (run >= len) {
            let s = 0;
            for (let k = i - len + 1; k <= i; k++) s += v[k]!;
            prev = s / len;
            out[i] = prev;
        }
    }
    return out;
}

/** Exponential moving average (alpha = 2 / (len + 1)). */
export function ema(v: readonly number[], len: number): number[] {
    return recursive(v, len, 2 / (len + 1));
}

/** Smoothed moving average / Wilder's average (alpha = 1 / len). */
export function rma(v: readonly number[], len: number): number[] {
    return recursive(v, len, 1 / len);
}

/** 1-bar (or n-bar) difference. */
export function change(v: readonly number[], n = 1): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = n; i < v.length; i++) {
        const a = v[i]!;
        const b = v[i - n]!;
        if (Number.isFinite(a) && Number.isFinite(b)) out[i] = a - b;
    }
    return out;
}

/** Percentage rate of change over `len` bars. */
export function roc(v: readonly number[], len: number): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = len; i < v.length; i++) {
        const a = v[i]!;
        const b = v[i - len]!;
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) out[i] = (100 * (a - b)) / b;
    }
    return out;
}

/** Shift values `n` bars forward in time (positive n plots past values on later bars). */
export function shift(v: readonly number[], n: number): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = 0; i < v.length; i++) {
        const j = i - n;
        if (j >= 0 && j < v.length) out[i] = v[j]!;
    }
    return out;
}

/** True range per bar (uses the previous close where one exists). */
export function trueRange(bars: readonly OHLCV[]): number[] {
    const out = new Array<number>(bars.length).fill(Number.NaN);
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!;
        if (i === 0) {
            out[i] = b.high - b.low;
            continue;
        }
        const pc = bars[i - 1]!.close;
        out[i] = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    }
    return out;
}

/** Average true range (Wilder's smoothing of the true range). */
export function atr(bars: readonly OHLCV[], len: number): number[] {
    return rma(trueRange(bars), len);
}

/** Relative strength index over `len` bars. */
export function rsi(v: readonly number[], len: number): number[] {
    const d = change(v);
    const up = map(d, (x) => Math.max(x, 0));
    const dn = map(d, (x) => Math.max(-x, 0));
    return zip(rma(up, len), rma(dn, len), (u, w) => (w === 0 ? 100 : 100 - 100 / (1 + u / w)));
}

/** Raw stochastic %K: where the value sits inside its `len`-bar high/low range. */
export function stoch(v: readonly number[], hi: readonly number[], lo: readonly number[], len: number): number[] {
    const hh = highest(hi, len);
    const ll = lowest(lo, len);
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        const h = hh[i]!;
        const l = ll[i]!;
        if (!Number.isFinite(x) || !Number.isFinite(h) || !Number.isFinite(l)) continue;
        out[i] = h === l ? 50 : (100 * (x - l)) / (h - l);
    }
    return out;
}

/** Least-squares linear regression value at each bar (the fit's endpoint). */
export function linreg(v: readonly number[], len: number): number[] {
    // Closed form over x = 0..len-1 with y newest-last: slope/intercept from the
    // standard normal equations, evaluated at x = len - 1.
    const sx = ((len - 1) * len) / 2;
    const sxx = ((len - 1) * len * (2 * len - 1)) / 6;
    const denom = len * sxx - sx * sx;
    return windowed(v, len, (w, from, to) => {
        let sy = 0;
        let sxy = 0;
        for (let k = from; k <= to; k++) {
            const x = k - from;
            sy += w[k]!;
            sxy += x * w[k]!;
        }
        const slope = denom === 0 ? 0 : (len * sxy - sx * sy) / denom;
        const intercept = (sy - slope * sx) / len;
        return intercept + slope * (len - 1);
    });
}

/** Symmetrically weighted moving average over 4 bars (weights 1,2,2,1 / 6). */
export function swma(v: readonly number[]): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = 3; i < v.length; i++) {
        const a = v[i - 3]!;
        const b = v[i - 2]!;
        const c = v[i - 1]!;
        const d = v[i]!;
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
            out[i] = (a + 2 * b + 2 * c + d) / 6;
        }
    }
    return out;
}

/** Percent of the trailing `len` values the current value exceeds (0..100). */
export function percentRank(v: readonly number[], len: number): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    for (let i = len; i < v.length; i++) {
        const x = v[i]!;
        if (!Number.isFinite(x)) continue;
        let below = 0;
        let count = 0;
        for (let k = i - len; k < i; k++) {
            const y = v[k]!;
            if (!Number.isFinite(y)) {
                count = -1;
                break;
            }
            count += 1;
            if (y <= x) below += 1;
        }
        if (count === len) out[i] = (100 * below) / len;
    }
    return out;
}

/** Cumulative running sum; a NaN term is skipped (the accumulation holds). */
export function cumSum(v: readonly number[]): number[] {
    const out = new Array<number>(v.length).fill(Number.NaN);
    let acc = 0;
    let seen = false;
    for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        if (Number.isFinite(x)) {
            acc += x;
            seen = true;
        }
        if (seen) out[i] = acc;
    }
    return out;
}

/** Fixed-value array aligned to a length. */
export function fill(len: number, value: number): number[] {
    return new Array<number>(len).fill(value);
}
