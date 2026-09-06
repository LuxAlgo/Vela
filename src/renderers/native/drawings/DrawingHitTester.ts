import type { Drawing, Projector } from '../../../core/drawings';

/** Pixel tolerance for grabbing a drawing body / handle. */
export const HIT_TOLERANCE = 6;

/** A normalized rectangle in plot pixels (`w` and `h` are never negative). */
export interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Normalize two corners and clip them to the data plot. Invalid coordinates have no rectangle. */
export function plotRect(x1: number, y1: number, x2: number, y2: number, proj: Pick<Projector, 'width' | 'height'>): PixelRect | null {
    if (![x1, y1, x2, y2, proj.width, proj.height].every(Number.isFinite)) return null;
    const left = Math.max(0, Math.min(proj.width, Math.min(x1, x2)));
    const right = Math.max(0, Math.min(proj.width, Math.max(x1, x2)));
    const top = Math.max(0, Math.min(proj.height, Math.min(y1, y2)));
    const bottom = Math.max(0, Math.min(proj.height, Math.max(y1, y2)));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Inclusive intersection: touching an edge or a zero-width line counts as a hit. */
export function rectsIntersect(a: PixelRect, b: PixelRect): boolean {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function normalizedRect(rect: PixelRect): PixelRect | null {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    return { x: Math.min(rect.x, x2), y: Math.min(rect.y, y2), w: Math.abs(rect.w), h: Math.abs(rect.h) };
}

function clippedRect(a: PixelRect, clip: PixelRect): PixelRect | null {
    const left = Math.max(a.x, clip.x);
    const right = Math.min(a.x + a.w, clip.x + clip.w);
    const top = Math.max(a.y, clip.y);
    const bottom = Math.min(a.y + a.h, clip.y + clip.h);
    return right < left || bottom < top ? null : { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Drawing ids whose projected selection bounds intersect `rect`, in ascending paint order.
 * Bounds and the marquee are clipped to the visible plot/pane before the inclusive test.
 */
export function drawingsIntersectingRect(drawings: readonly Drawing[], rect: PixelRect, proj: Projector): string[] {
    const plot: PixelRect = { x: 0, y: 0, w: proj.width, h: proj.height };
    const selection = clippedRect(rect, plot);
    if (!selection) return [];
    const hits: string[] = [];
    for (const d of drawings) {
        if (!d.visible) continue;
        let clip = plot;
        if (proj.paneRect) {
            const pane = proj.paneRect(d.paneId);
            if (!pane || !Number.isFinite(pane.top) || !Number.isFinite(pane.height) || pane.height <= 0) continue;
            const paneClip = clippedRect(plot, { x: 0, y: pane.top, w: proj.width, h: pane.height });
            if (!paneClip) continue;
            clip = paneClip;
        }
        const bounds = d.bounds(proj);
        const normalized = bounds ? normalizedRect(bounds) : null;
        const visibleBounds = normalized ? clippedRect(normalized, clip) : null;
        if (visibleBounds && rectsIntersect(selection, visibleBounds)) hits.push(d.id);
    }
    return hits;
}

/**
 * The topmost drawing whose body is within `tol` px of (x,y), searching front→back
 * (highest z first). Hidden drawings are skipped. `drawings` is expected in ascending
 * paint order (the store's `all()`), so we iterate from the end.
 */
export function topDrawingAt(
    drawings: readonly Drawing[],
    x: number,
    y: number,
    proj: Projector,
    tol = HIT_TOLERANCE,
): Drawing | null {
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
        const d = drawings[i]!;
        if (!d.visible) continue;
        // A drawing on a hidden pane (collapsed / zeroed by a maximize) isn't painted — don't
        // let an invisible body swallow presses meant for the visible pane underneath.
        const rect = proj.paneRect?.(d.paneId);
        if (rect && rect.height <= 0) continue;
        if (d.hitTest(x, y, proj, tol)) return d;
    }
    return null;
}
