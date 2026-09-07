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

/**
 * What a selection-wide delete removes: a lone selected drawing goes regardless, but inside a
 * multi-selection a LOCKED drawing is protected — the others go and it stays (selected).
 */
export function deletableSelection(selected: Iterable<string>, drawings: readonly Drawing[]): string[] {
    const ids = [...selected];
    if (ids.length < 2) return ids;
    return ids.filter((id) => !drawings.find((d) => d.id === id)?.locked);
}

/**
 * What a delete-at-cursor press removes when `hit` is the drawing under it. A hit on a member of
 * a multi-selection (with `withSelection`) takes the selection's deletable members — even when
 * the hit itself is locked, so a middle-click on the locked one still clears the rest of the
 * group. Any other locked hit is protected and nothing is removed.
 */
export function deleteTargets(hit: Drawing, selected: ReadonlySet<string>, drawings: readonly Drawing[], withSelection: boolean): string[] {
    if (withSelection && selected.size >= 2 && selected.has(hit.id)) return deletableSelection(selected, drawings);
    return hit.locked ? [] : [hit.id];
}
