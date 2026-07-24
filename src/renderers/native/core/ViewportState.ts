/**
 * The authoritative, user-controlled pan/zoom state of the time axis.
 *
 * - `barSpacing`: pixels between adjacent bar centers (the zoom level).
 * - `rightOffset`: how many bar-widths the LAST bar sits from the right edge
 *   (the pan position). May be negative (last bar scrolled off the right).
 *
 * The chart width and bar count are NOT part of this state — they are owned by
 * the renderer (resize / setBars) and combined with the viewport in the
 * CoordinateSystem to produce pixel coordinates.
 */
export interface ViewportState {
    barSpacing: number;
    rightOffset: number;
}

export const MIN_BAR_SPACING = 0.5;
/**
 * A high sanity ceiling for a single bar's pixel width — NOT the practical zoom-in limit. The real
 * max-zoom is governed by `MIN_VISIBLE_BARS` in the renderer's `clampViewport` (keep ≥ N candles on
 * screen ⇒ `barSpacing ≤ width / N`), which on any sub-4K display binds well before this. Kept large
 * so a deep reveal-style zoom (wide candles, a roomy grid, legible per-level numbers) isn't pre-clamped.
 */
export const MAX_BAR_SPACING = 1000;

/** Default zoom/pan before any data is loaded. */
export function defaultViewport(): ViewportState {
    return { barSpacing: 8, rightOffset: 6 };
}

export function clampBarSpacing(spacing: number): number {
    return Math.max(MIN_BAR_SPACING, Math.min(MAX_BAR_SPACING, spacing));
}
