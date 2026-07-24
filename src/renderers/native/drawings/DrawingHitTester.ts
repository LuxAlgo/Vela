import type { Drawing, Projector } from '../../../core/drawings';

/** Pixel tolerance for grabbing a drawing body / handle. */
export const HIT_TOLERANCE = 6;

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
