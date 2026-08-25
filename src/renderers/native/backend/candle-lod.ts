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
