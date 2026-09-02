/**
 * Candle level-of-detail tiers, keyed by bar spacing (px between bar centers).
 * Shared by both geometry backends so canvas2d and WebGL2 thin/aggregate at the
 * same zoom thresholds.
 *
 * - `full`: high-low wick + a body (enough room for a visible body).
 * - `wick`: high-low stick only (too thin for a body — the old `spacing < 3` path).
 * - `aggregate`: sub-pixel spacing — bars sharing a pixel column collapse to one
 *   high-low stick, so draw cost stays bounded by screen width when zoomed far out
 *   (true LOD) instead of growing with the bar count.
 */
import type { OHLCV } from '../../../core/model/ohlcv';

export type CandleTier = 'full' | 'wick' | 'aggregate';

/** Below this spacing a candle has no body (wick-only). */
export const CANDLE_BODY_MIN_SPACING = 3;
/** Wick line width in CSS px at wide zoom — rounded to whole device pixels per frame so it stays crisp. */
export const CANDLE_WICK_W = 1.5;
/** Below this spacing bars are bucketed per pixel column (aggregated). */
export const CANDLE_AGG_MAX_SPACING = 1;

/**
 * Wick line width (CSS px) for a given bar spacing. The body is `~spacing·0.7` wide
 * (`half = floor(spacing·0.7)/2`), so a fixed wick reads as a solid body once bars get tight.
 * Cap the wick at the body's half-width and floor it at 1px: a crisp ~1.5px stick at wide zoom
 * that tapers to a 1px hair when zoomed out, never growing as wide as the candle body.
 * Shared by both backends so canvas2d and WebGL2 thin the wick at the same thresholds.
 */
export function wickWidth(spacing: number): number {
    const halfBody = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
    return Math.max(1, Math.min(CANDLE_WICK_W, halfBody));
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
    const wickDev = Math.max(1, Math.round(wickWidth(spacing) * dpr));
    const wickLeftDev = Math.round(xCss * dpr - wickDev / 2);
    let bodyDev = Math.max(wickDev, Math.round(Math.floor(spacing * 0.7 * bodyScale) * dpr));
    if ((bodyDev - wickDev) % 2 !== 0) bodyDev += 1; // parity-match so the overhang splits evenly
    const sideDev = (bodyDev - wickDev) / 2;
    return {
        wickX: wickLeftDev / dpr,
        wickW: wickDev / dpr,
        bodyX: (wickLeftDev - sideDev) / dpr,
        bodyW: bodyDev / dpr,
        center: (wickLeftDev + wickDev / 2) / dpr,
    };
}

/** One aggregate-tier stick: a contiguous run of price coverage inside one pixel column. */
export interface AggregatedStick {
    /** The rounded CSS-px column shared by the stick's bars (canvas2d strokes at `x + 0.5`). */
    x: number;
    hi: number;
    lo: number;
    /** The stick's FIRST bar — the barcolor() lookup key and the direction's open. */
    headTime: number;
    open: number;
    /** The stick's LAST bar's close (direction = `close >= open`, as everywhere). */
    close: number;
}

/** One in-progress coverage interval of the current column (price space, index-tracked). */
interface Coverage {
    lo: number;
    hi: number;
    headIdx: number;
    headTime: number;
    open: number;
    lastIdx: number;
    close: number;
}

/**
 * Aggregate-tier bucketing shared by both backends: bars whose centers round to the
 * same pixel column collapse into high-low sticks. Coverage is kept as the UNION of
 * the bars' true high-low ranges — one stick per contiguous run — instead of one
 * min-to-max span, so a PRICE GAP between bars sharing the column (the bars around
 * an overnight jump, once zoomed far out) stays a visible void instead of being
 * painted over as a solid connection. Runs whose separation is under one pixel
 * (`yOf` measures it) merge anyway: an invisible void isn't worth a second stick, and
 * ordinary contiguous data keeps producing exactly one stick per column. Each stick
 * carries its own first-open/last-close direction and its head bar's time, so
 * barcolor() and up/down coloring follow the run that actually holds those bars.
 */
export function aggregateCandleColumns(
    bars: ArrayLike<OHLCV | undefined>,
    i0: number,
    i1: number,
    xOf: (index: number) => number,
    yOf: (price: number) => number,
): AggregatedStick[] {
    const out: AggregatedStick[] = [];
    let col = NaN;
    let intervals: Coverage[] = []; // sorted by `lo`; typically length 1
    const flush = (): void => {
        if (intervals.length === 0) return;
        // Coalesce runs whose void is sub-pixel — it cannot render anyway.
        const merged: Coverage[] = [intervals[0]!];
        for (let k = 1; k < intervals.length; k += 1) {
            const prev = merged[merged.length - 1]!;
            const next = intervals[k]!;
            if (Math.abs(yOf(prev.hi) - yOf(next.lo)) < 1) {
                prev.hi = next.hi;
                if (next.headIdx < prev.headIdx) {
                    prev.headIdx = next.headIdx;
                    prev.headTime = next.headTime;
                    prev.open = next.open;
                }
                if (next.lastIdx > prev.lastIdx) {
                    prev.lastIdx = next.lastIdx;
                    prev.close = next.close;
                }
            } else {
                merged.push(next);
            }
        }
        for (const iv of merged) out.push({ x: col, hi: iv.hi, lo: iv.lo, headTime: iv.headTime, open: iv.open, close: iv.close });
        intervals = [];
    };
    for (let i = i0; i <= i1; i += 1) {
        const b = bars[i];
        if (!b || b.high <= b.low) continue;
        const x = Math.round(xOf(i));
        if (x !== col) {
            flush();
            col = x;
        }
        // Merge the bar's range into every overlapping interval (usually zero or one).
        let lo = b.low;
        let hi = b.high;
        let headIdx = i;
        let headTime = b.time;
        let open = b.open;
        for (let k = intervals.length - 1; k >= 0; k -= 1) {
            const iv = intervals[k]!;
            if (iv.lo > hi || iv.hi < lo) continue;
            if (iv.lo < lo) lo = iv.lo;
            if (iv.hi > hi) hi = iv.hi;
            if (iv.headIdx < headIdx) {
                headIdx = iv.headIdx;
                headTime = iv.headTime;
                open = iv.open;
            }
            intervals.splice(k, 1);
        }
        let insertAt = 0;
        while (insertAt < intervals.length && intervals[insertAt]!.lo < lo) insertAt += 1;
        intervals.splice(insertAt, 0, { lo, hi, headIdx, headTime, open, lastIdx: i, close: b.close });
    }
    flush();
    return out;
}
