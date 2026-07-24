import type { VpvrProfile } from './profile';

/** Row fill opacity inside / outside the value area (the profile overlays the candles). */
export const VPVR_VA_ALPHA = 0.62;
export const VPVR_OUTSIDE_ALPHA = 0.28;
/** Opacity of the point-of-control row outline. */
export const VPVR_POC_ALPHA = 0.9;

/** Geometry the layer hands the painter (pane-resolved price→y + the profile's anchor edge). */
export interface VpvrGeom {
    /** Right pixel edge of the data area (rows hug this, extending left). */
    rightX: number;
    /** Pixel width of the largest row (the profile's horizontal scale). */
    maxW: number;
    /** price → pixel y. */
    yOf(price: number): number;
}

export interface VpvrPaintStyle {
    upColor: string;
    downColor: string;
    showPoc: boolean;
    /** Outline color for the POC row (the theme's text color). */
    pocColor: string;
}

/**
 * Paint the visible-range volume profile: one horizontal row per price bucket, anchored
 * to the right edge and extending left, width proportional to the row's total volume
 * relative to the largest row. Each row splits into an up segment (left part) and a down
 * segment (right part, against the axis). Rows inside the value area draw brighter; the
 * POC row is outlined. Pure — every coordinate comes from `geom`.
 */
export function paintVpvr(
    ctx: CanvasRenderingContext2D,
    profile: VpvrProfile,
    geom: VpvrGeom,
    style: VpvrPaintStyle,
): void {
    const { rows, rowH, maxTotal, poc, vaFrom, vaTo } = profile;
    const { rightX, maxW, yOf } = geom;
    if (maxTotal <= 0 || maxW <= 0) return;

    for (let k = 0; k < rows.length; k += 1) {
        const row = rows[k]!;
        const total = row.up + row.down;
        if (total <= 0) continue;
        const yTop = yOf(row.price + rowH);
        const h = Math.max(1, yOf(row.price) - yTop - 1); // 1px inter-row gap
        const w = (total / maxTotal) * maxW;
        const upW = (row.up / total) * w;
        ctx.globalAlpha = k >= vaFrom && k <= vaTo ? VPVR_VA_ALPHA : VPVR_OUTSIDE_ALPHA;
        if (upW > 0) {
            ctx.fillStyle = style.upColor;
            ctx.fillRect(rightX - w, yTop, upW, h);
        }
        if (w - upW > 0) {
            ctx.fillStyle = style.downColor;
            ctx.fillRect(rightX - w + upW, yTop, w - upW, h);
        }
    }

    if (style.showPoc) {
        const row = rows[poc]!;
        const yTop = yOf(row.price + rowH);
        const h = Math.max(1, yOf(row.price) - yTop - 1);
        ctx.globalAlpha = VPVR_POC_ALPHA;
        ctx.strokeStyle = style.pocColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(rightX - maxW + 0.5, yTop + 0.5, maxW - 1, h);
    }
    ctx.globalAlpha = 1;
}
