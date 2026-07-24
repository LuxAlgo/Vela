import type { OHLCV } from '../../../core/model/ohlcv';

/** One profile row: `[price, price + rowH)` with the up/down volume that landed in it. */
export interface VpvrRow {
    /** The row's LOWER price bound. */
    price: number;
    up: number;
    down: number;
}

/** The bucketed visible-range volume-by-price profile. */
export interface VpvrProfile {
    /** Ascending by price; length = requested row count (a degenerate flat range yields 1). */
    rows: VpvrRow[];
    /** Price height of one row. */
    rowH: number;
    /** Price floor of the profile (rows[0].price). */
    min: number;
    /** Largest single-row total volume (normalization; > 0). */
    maxTotal: number;
    /** Index of the point-of-control (highest total-volume) row. */
    poc: number;
    /** Value-area row span, inclusive `[vaFrom, vaTo]`. */
    vaFrom: number;
    vaTo: number;
}

/**
 * Bucket the visible bars' volume by price. Each bar's volume is distributed over the
 * rows its high–low range overlaps, proportionally to the overlap, and split up/down by
 * the bar's close direction — so total volume is conserved exactly. The value area is
 * grown from the POC by repeatedly absorbing the larger adjacent row until it covers
 * `valueAreaFrac` of the total volume. Pure — the renderer memoizes calls on the
 * visible range; unit-tested directly.
 *
 * Returns null when the window holds no volume (or no bars).
 */
export function buildVpvrProfile(
    bars: readonly OHLCV[],
    i0: number,
    i1: number,
    rowCount: number,
    valueAreaFrac: number,
): VpvrProfile | null {
    const from = Math.max(0, i0);
    const to = Math.min(bars.length - 1, i1);
    if (from > to) return null;

    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i <= to; i += 1) {
        const b = bars[i]!;
        if (!(b.volume != null && b.volume > 0)) continue; // volume is optional on OHLCV
        if (b.low < min) min = b.low;
        if (b.high > max) max = b.high;
    }
    if (!Number.isFinite(min)) return null; // no visible volume at all

    // A flat window (every volumed bar at one price) still profiles — as a single row.
    const n = max > min ? Math.max(1, Math.round(rowCount)) : 1;
    const rowH = max > min ? (max - min) / n : 1;
    const rows: VpvrRow[] = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));

    for (let i = from; i <= to; i += 1) {
        const b = bars[i]!;
        const v = b.volume;
        if (!(v != null && v > 0)) continue;
        const side = b.close >= b.open ? 'up' : 'down';
        const span = b.high - b.low;
        if (span <= 0) {
            // Point bar: all volume in the row containing its price.
            const k = clampIndex(Math.floor((b.low - min) / rowH), n);
            rows[k]![side] += v;
            continue;
        }
        // Distribute over overlapped rows, proportional to overlap.
        const kFirst = clampIndex(Math.floor((b.low - min) / rowH), n);
        const kLast = clampIndex(Math.floor((b.high - min) / rowH - 1e-9), n);
        for (let k = kFirst; k <= kLast; k += 1) {
            const rowBot = min + k * rowH;
            const overlap = Math.min(b.high, rowBot + rowH) - Math.max(b.low, rowBot);
            if (overlap > 0) rows[k]![side] += (v * overlap) / span;
        }
    }

    let total = 0;
    let maxTotal = 0;
    let poc = 0;
    for (let k = 0; k < n; k += 1) {
        const t = rows[k]!.up + rows[k]!.down;
        total += t;
        if (t > maxTotal) {
            maxTotal = t;
            poc = k;
        }
    }
    if (maxTotal <= 0) return null;

    // Grow the value area from the POC: absorb whichever adjacent row is larger until
    // the area covers the target volume fraction.
    const target = total * Math.min(1, Math.max(0, valueAreaFrac));
    let vaFrom = poc;
    let vaTo = poc;
    let acc = maxTotal;
    while (acc < target && (vaFrom > 0 || vaTo < n - 1)) {
        const below = vaFrom > 0 ? rows[vaFrom - 1]!.up + rows[vaFrom - 1]!.down : -1;
        const above = vaTo < n - 1 ? rows[vaTo + 1]!.up + rows[vaTo + 1]!.down : -1;
        if (above > below) {
            vaTo += 1;
            acc += above;
        } else {
            vaFrom -= 1;
            acc += below;
        }
    }

    return { rows, rowH, min, maxTotal, poc, vaFrom, vaTo };
}

function clampIndex(k: number, n: number): number {
    return k < 0 ? 0 : k >= n ? n - 1 : k;
}
