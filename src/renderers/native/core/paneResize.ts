/**
 * Pure math for dragging the separator between two vertically-adjacent panes.
 * Kept separate from the renderer so the weight redistribution is unit-testable
 * without a DOM.
 *
 * Panes are laid out by relative `heightWeight` (see `NativeRenderer.layoutPanes`).
 * Moving one separator should only ever resize the two panes it sits between, so
 * we redistribute their COMBINED weight across the new boundary and leave every
 * other pane's weight (and therefore pixel height) untouched.
 */

/** A snapshot of the two adjacent panes' shared pixel span when a resize drag begins. */
export interface PaneSplit {
    /** Pixel top of the upper pane (top of the combined span). */
    combinedTop: number;
    /** Combined pixel height of the upper + lower pane. */
    combinedHeight: number;
    /** Combined `heightWeight` of the upper + lower pane (preserved across the drag). */
    combinedWeight: number;
    /** Pixel y of the separator (the lower pane's top) when the drag began. */
    startBoundaryY: number;
}

/** Smallest pixel height either pane may be dragged down to (degrades to an even
 *  split when the combined span is too short to honor it on both sides). */
export const MIN_PANE_PX = 24;

/**
 * Given the drag snapshot and the TOTAL pixel drag (down ⇒ grow the upper pane),
 * return the new `{ above, below }` height weights. Their sum equals the original
 * `combinedWeight`, so sibling panes keep their sizes; the boundary is clamped so
 * neither pane shrinks below `minPx`.
 */
export function resizeSplit(split: PaneSplit, dyTotal: number, minPx = MIN_PANE_PX): { above: number; below: number } {
    const { combinedTop, combinedHeight, combinedWeight, startBoundaryY } = split;
    const margin = Math.min(minPx, combinedHeight / 2);
    const lo = combinedTop + margin;
    const hi = combinedTop + combinedHeight - margin;
    const boundary = Math.max(lo, Math.min(hi, startBoundaryY + dyTotal));
    const aboveHeight = boundary - combinedTop;
    const above = combinedHeight > 0 ? combinedWeight * (aboveHeight / combinedHeight) : combinedWeight / 2;
    return { above, below: combinedWeight - above };
}
