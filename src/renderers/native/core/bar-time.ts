/**
 * Pure bar-time ↔ logical-index helpers for the native renderer's coordinate
 * system. Self-contained (no LwC); a future `src/renderers/shared/` extraction
 * can unify these with the LwC renderer's `drawing-geometry` copies.
 */

/** Median spacing between consecutive bar times — robust to gaps/missing bars. */
export function medianInterval(times: readonly number[]): number {
    if (times.length < 2) return 0;
    const diffs: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
        const d = times[i]! - times[i - 1]!;
        if (d > 0) diffs.push(d);
    }
    if (diffs.length === 0) return 0;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * Map a bar time (epoch ms) to a fractional logical bar index. Interpolates
 * between known bars and extrapolates before/after the dataset using `interval`
 * so extended/future drawing anchors still resolve.
 */
export function barTimeToLogical(ms: number, times: readonly number[], interval: number): number {
    const n = times.length;
    if (n === 0) return 0;
    const first = times[0]!;
    const last = times[n - 1]!;
    if (ms <= first) return interval > 0 ? (ms - first) / interval : 0;
    if (ms >= last) return n - 1 + (interval > 0 ? (ms - last) / interval : 0);
    // Binary search for the bracketing bars, then linear-interpolate.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! <= ms) lo = mid;
        else hi = mid;
    }
    const span = times[hi]! - times[lo]!;
    return span > 0 ? lo + (ms - times[lo]!) / span : lo;
}

/** Inverse of {@link barTimeToLogical}: fractional logical index → epoch ms. */
export function logicalToBarTime(logical: number, times: readonly number[], interval: number): number {
    const n = times.length;
    if (n === 0) return 0;
    if (logical <= 0) return times[0]! + (interval > 0 ? logical * interval : 0);
    if (logical >= n - 1) return times[n - 1]! + (interval > 0 ? (logical - (n - 1)) * interval : 0);
    const lo = Math.floor(logical);
    const frac = logical - lo;
    return times[lo]! + (times[lo + 1]! - times[lo]!) * frac;
}
