import type { OHLCV } from '../../../core/model/ohlcv';

/** Fill opacity of the volume columns — the candles behind/above must stay readable. */
export const VOLUME_FILL_ALPHA = 0.5;

/**
 * Geometry the layer precomputes once per frame (keeps this painter free of the
 * CoordinateSystem and therefore unit-testable with a fake 2d context).
 */
export interface VolumeGeom {
    /** Inclusive visible bar-index range into `bars`. */
    i0: number;
    i1: number;
    /** bar index → pixel x of the bar's center. */
    xOf(i: number): number;
    /** Half-width (px) of one column (matched to the candle body). */
    halfW: number;
    /** Pixel y of the pane's bottom edge (columns grow upward from here). */
    bottomY: number;
    /** Pixel height of the tallest visible bar (the layer's own scale). */
    maxH: number;
    /** Largest visible volume (normalization; caller guarantees > 0). */
    maxVol: number;
}

/**
 * Paint the bottom-anchored volume columns: one per visible bar, height proportional to
 * volume relative to the VISIBLE max, colored by bar direction. Pure — every coordinate
 * comes from `geom`.
 */
export function paintVolume(
    ctx: CanvasRenderingContext2D,
    bars: readonly OHLCV[],
    geom: VolumeGeom,
    colors: { up: string; down: string },
): void {
    const { i0, i1, xOf, halfW, bottomY, maxH, maxVol } = geom;
    if (maxVol <= 0 || maxH <= 0) return;
    ctx.globalAlpha = VOLUME_FILL_ALPHA;
    for (let i = i0; i <= i1; i += 1) {
        const b = bars[i];
        const v = b?.volume;
        if (b == null || v == null || !(v > 0)) continue; // volume is optional on OHLCV
        const h = Math.max(1, (v / maxVol) * maxH);
        ctx.fillStyle = b.close >= b.open ? colors.up : colors.down;
        ctx.fillRect(xOf(i) - halfW, bottomY - h, halfW * 2, h);
    }
    ctx.globalAlpha = 1;
}
