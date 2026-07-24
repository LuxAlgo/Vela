/**
 * Right-gutter column geometry, shared by the renderer (which reserves the gutter and
 * routes input) and the chrome layer (which draws the tick labels). The gutter holds the
 * pane's master price scale in the leftmost column (nearest the data), and one extra
 * column per merged (own-scale) indicator to its right.
 */
export const AXIS_MASTER_W = 64; // px — the pane master-scale column (nearest the data)
export const AXIS_MERGED_W = 56; // px — each additional merged-indicator scale column

/** Thickness of the horizontal separator drawn at each stacked pane's top edge (data + gutter). */
export const PANE_SEPARATOR_PX = 3;

/** Total right-gutter width for a given number of merged scale columns. */
export function axisGutterWidth(mergedColumns: number): number {
    return AXIS_MASTER_W + AXIS_MERGED_W * Math.max(0, mergedColumns);
}

/** Left x (relative to the data area's right edge `dataW`) of a scale column.
 *  Column 0 is the master scale; columns ≥ 1 are merged-indicator scales. */
export function axisColumnX(dataW: number, column: number): number {
    return column === 0 ? dataW : dataW + AXIS_MASTER_W + (column - 1) * AXIS_MERGED_W;
}

/** Width of a scale column (master vs merged). */
export function axisColumnWidth(column: number): number {
    return column === 0 ? AXIS_MASTER_W : AXIS_MERGED_W;
}
