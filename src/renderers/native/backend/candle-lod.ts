/**
 * Candle level-of-detail tiers, keyed by bar spacing (px between bar centers).
 * Shared by both geometry backends so canvas2d and WebGL2 thin/aggregate at the
 * same zoom thresholds.
 *
 * - `full`: high-low wick + a body (enough room for a visible body).
 * - `wick`: high-low stick only (too thin for a body to read as anything but the wick).
 * - `aggregate`: sub-pixel spacing — bars sharing a pixel column collapse to one
 *   high-low stick, so draw cost stays bounded by screen width when zoomed far out
 *   (true LOD) instead of growing with the bar count.
 */
import type { OHLCV } from '../../../core/model/ohlcv';

export type CandleTier = 'full' | 'wick' | 'aggregate';

/** Below this spacing a candle has no body (wick-only): a body under 2 CSS px is all border. */
export const CANDLE_BODY_MIN_SPACING = 2;
/** Wick line width in CSS px — rounded to whole device pixels per frame so it stays crisp. */
export const CANDLE_WICK_W = 1;
/** Below this spacing bars are bucketed per pixel column (aggregated). */
export const CANDLE_AGG_MAX_SPACING = 1;

/**
 * Candle body width in DEVICE px for a bar spacing (CSS px between bar centers).
 *
 * Zoomed out the body must survive its 1 CSS px border, so the width tracks the spacing
 * closely instead of a fixed fraction of it: a fixed 0.7 gives a 2 px body at 3–4 px
 * spacing, which the border fills completely — the candle degrades to a stick. Here:
 *
 * - `2.5 ≤ spacing ≤ 4`: pinned to 3 CSS px — border + 1 px of fill + border — even
 *   though that can touch or overlap the neighbour by a device pixel.
 * - wider: the body takes a `fill` fraction of the spacing that starts at 1 (bars nearly
 *   touch) and eases to 0.8 at wide zoom, so the inter-candle gap grows with the zoom.
 * - narrower: whatever fits the spacing, never under one device pixel.
 *
 * Shared by both backends so canvas2d and WebGL2 size bodies identically.
 */
export function bodyWidth(spacing: number, dpr: number): number {
    if (spacing >= 2.5 && spacing <= 4) return Math.floor(3 * dpr);
    const fill = 1 - 0.2 * (1 - (4 / Math.max(4, spacing)) ** 2);
    const w = Math.min(Math.floor(spacing * fill * dpr), Math.floor(spacing * dpr));
    return Math.max(1, Math.floor(dpr), w);
}

export function candleTier(spacing: number): CandleTier {
    if (spacing < CANDLE_AGG_MAX_SPACING) return 'aggregate';
    if (spacing < CANDLE_BODY_MIN_SPACING) return 'wick';
    return 'full';
}

/**
 * Snap a CSS-px Y coordinate to the device-pixel grid — the vertical counterpart of
 * candleGeometry's X snapping, applied to candle body tops/bottoms and wick ends.
 * An edge on a whole device pixel rasterizes as one hard step; a fractional one
 * leaves a blended anti-aliasing row that reads as a darker rim on the body. The
 * cost is up to half a device pixel of true position — invisible at any zoom.
 * Shared by both backends so canvas2d and WebGL2 land candles on the same rows.
 */
export function snapY(yCss: number, dpr: number): number {
    return Math.round(yCss * dpr) / dpr;
}

/** Wick + body layout of one candle, in CSS px, with every edge on the device-pixel grid. */
export interface CandleGeometry {
    /** Wick left edge / width. */
    wickX: number;
    wickW: number;
    /** Body left edge / width — always centered on the wick. */
    bodyX: number;
    bodyW: number;
    /** The shared wick/body centerline (the wick stroke's x in canvas2d). */
    center: number;
}

/**
 * Snap one candle's wick + body to the device-pixel grid so the candle stays SYMMETRIC:
 * the wick column is snapped first, then the body is built around it with a device-pixel
 * width of the same parity as the wick's — so both share an exact center and the body
 * extends the same number of device pixels on each side of the wick. (Snapping the two
 * independently lets a 1px wick land on one half of the body, which reads as a lopsided
 * candle once zoomed out.) Body width is constant for a given spacing/dpr, so the gap
 * between candles is uniform to within one device pixel — the raster-grid minimum.
 * Shared by both backends so canvas2d and WebGL2 lay candles out identically.
 */
export function candleGeometry(xCss: number, spacing: number, dpr: number, bodyScale = 1): CandleGeometry {
    const wickDev = Math.max(1, Math.round(CANDLE_WICK_W * dpr));
    const wickLeftDev = Math.round(xCss * dpr - wickDev / 2);
    let bodyDev = Math.max(wickDev, Math.round(bodyWidth(spacing, dpr) * bodyScale));
    // Parity-match so the overhang splits evenly — shrink (stay inside the spacing) unless
    // that would make the body narrower than the wick.
    if ((bodyDev - wickDev) % 2 !== 0) bodyDev += bodyDev - 1 >= wickDev ? -1 : 1;
    const sideDev = (bodyDev - wickDev) / 2;
    return {
        wickX: wickLeftDev / dpr,
        wickW: wickDev / dpr,
        bodyX: (wickLeftDev - sideDev) / dpr,
        bodyW: bodyDev / dpr,
        center: (wickLeftDev + wickDev / 2) / dpr,
    };
}

/** One aggregate-tier stick: a contiguous run of SAME-COLOR price coverage inside one pixel column. */
export interface AggregatedStick {
    /** The rounded CSS-px column shared by the stick's bars (canvas2d strokes at `x + 0.5`). */
    x: number;
    hi: number;
    lo: number;
    /** The resolved paint shared by every bar in the run — the grouping key. */
    color: string;
}

/** One in-progress coverage run of the current column (price space, index-tracked). */
interface Coverage {
    lo: number;
    hi: number;
    color: string;
    /** The run's most recent bar — the column's paint order key. */
    lastIdx: number;
}

/**
 * Aggregate-tier bucketing shared by both backends: bars whose centers round to the
 * same pixel column collapse into high-low sticks. Coverage is kept as the UNION of
 * the bars' true high-low ranges — one stick per contiguous run — instead of one
 * min-to-max span, so a PRICE GAP between bars sharing the column (the bars around
 * an overnight jump, once zoomed far out) stays a visible void instead of being
 * painted over as a solid connection. Runs whose separation is under one pixel
 * (`yOf` measures it) merge anyway: an invisible void isn't worth a second stick, and
 * ordinary contiguous data keeps producing exactly one stick per column.
 *
 * Runs are kept PER COLOR (`colorOf` resolves each bar's paint — direction, barcolor(),
 * wick setting): bars of different colors never merge, so a down bar's long wick stays
 * the down color even when the up bar next to it shares the column. Merging them into
 * one first-open→last-close stick would recolor that wick by whichever bar closed last.
 * Within a column the sticks come out in order of their most recent bar, so where runs
 * of different colors overlap in price the latest bar paints on top — the same result
 * drawing the bars one by one would give.
 */
export function aggregateCandleColumns(
    bars: ArrayLike<OHLCV | undefined>,
    i0: number,
    i1: number,
    xOf: (index: number) => number,
    yOf: (price: number) => number,
    colorOf: (bar: OHLCV) => string,
): AggregatedStick[] {
    const out: AggregatedStick[] = [];
    let col = NaN;
    let runs: Coverage[] = []; // the current column's runs, any color; typically length 1
    const flush = (): void => {
        if (runs.length === 0) return;
        // Coalesce same-color runs whose void is sub-pixel — it cannot render anyway.
        // Same-color runs are disjoint (overlaps merged on insert), so in `lo` order the
        // previous run of a color is the one just below.
        runs.sort((a, b) => a.lo - b.lo);
        const merged: Coverage[] = [];
        for (const next of runs) {
            let prev: Coverage | undefined;
            for (let k = merged.length - 1; k >= 0; k -= 1) {
                if (merged[k]!.color === next.color) {
                    prev = merged[k];
                    break;
                }
            }
            if (prev && Math.abs(yOf(prev.hi) - yOf(next.lo)) < 1) {
                prev.hi = next.hi;
                if (next.lastIdx > prev.lastIdx) prev.lastIdx = next.lastIdx;
            } else {
                merged.push(next);
            }
        }
        merged.sort((a, b) => a.lastIdx - b.lastIdx);
        for (const r of merged) out.push({ x: col, hi: r.hi, lo: r.lo, color: r.color });
        runs = [];
    };
    for (let i = i0; i <= i1; i += 1) {
        const b = bars[i];
        if (!b || b.high <= b.low) continue;
        const x = Math.round(xOf(i));
        if (x !== col) {
            flush();
            col = x;
        }
        // Merge the bar's range into every overlapping run OF ITS COLOR (usually zero or one).
        const color = colorOf(b);
        let lo = b.low;
        let hi = b.high;
        for (let k = runs.length - 1; k >= 0; k -= 1) {
            const r = runs[k]!;
            if (r.color !== color || r.lo > hi || r.hi < lo) continue;
            if (r.lo < lo) lo = r.lo;
            if (r.hi > hi) hi = r.hi;
            runs.splice(k, 1);
        }
        runs.push({ lo, hi, color, lastIdx: i }); // `i` is the newest bar, so it is the run's last
    }
    flush();
    return out;
}
