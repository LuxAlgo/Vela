import type { LineStyle } from './series';

/**
 * Renderer-neutral models for Pine drawing objects (`line.new`, `box.new`, …).
 * Coordinates are kept in their Pine form, tagged by {@link DrawingXLoc}: the
 * renderer converts a bar index or epoch-ms time to a pixel via the time scale.
 */

/** How a drawing's x-coordinates are interpreted (Pine `xloc`). */
export type DrawingXLoc = 'bar_index' | 'bar_time';

/** Pine `extend`: which side(s) the drawing runs out to the chart edge. */
export type DrawingExtend = 'none' | 'left' | 'right' | 'both';

export type BoxTextSize = 'auto' | 'tiny' | 'small' | 'normal' | 'large' | 'huge';
export type BoxHAlign = 'left' | 'center' | 'right';
export type BoxVAlign = 'top' | 'center' | 'bottom';
export type BoxFontFamily = 'default' | 'monospace';

/**
 * A Pine `line.new(...)`. `x1/x2` are bar indices (xloc `bar_index`) or epoch ms
 * (xloc `bar_time`); `y1/y2` are prices.
 */
export interface DrawingLine {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    extend: DrawingExtend;
    /** Stroke color. `undefined` → use the renderer's default foreground color. */
    color?: string;
    /** `na` color → the line exists but is not stroked (e.g. a linefill anchor). */
    invisible: boolean;
    /** Pine line width in px (uncapped, unlike a series `lineWidth`). */
    width: number;
    style: LineStyle;
    /** Arrowhead at the first point (`style_arrow_left` / `style_arrow_both`). */
    arrowLeft: boolean;
    /** Arrowhead at the second point (`style_arrow_right` / `style_arrow_both`). */
    arrowRight: boolean;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

/** A Pine `box.new(...)`. `left/right` follow `xloc`; `top/bottom` are prices. */
export interface DrawingBox {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    left: number;
    top: number;
    right: number;
    bottom: number;
    extend: DrawingExtend;
    /** Fill color (may carry alpha). `undefined` → no fill (`na`). */
    bgColor?: string;
    /** Border color. `undefined` → no border (`na`). */
    borderColor?: string;
    borderWidth: number;
    borderStyle: LineStyle;
    /** Box text. `undefined`/empty → no text drawn. */
    text?: string;
    /** Text color. `undefined` → auto-contrast against the fill. */
    textColor?: string;
    textSize: BoxTextSize;
    hAlign: BoxHAlign;
    vAlign: BoxVAlign;
    /** `text.wrap_auto` → wrap to the box width; otherwise single line per `\n`. */
    wrap: boolean;
    fontFamily: BoxFontFamily;
    bold: boolean;
    italic: boolean;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

/** Pine `label.style_*` (the bubble/pointer variants and the point-marker shapes). */
export type LabelStyle =
    | 'label_up'
    | 'label_down'
    | 'label_left'
    | 'label_right'
    | 'label_center'
    | 'label_lower_left'
    | 'label_lower_right'
    | 'label_upper_left'
    | 'label_upper_right'
    | 'circle'
    | 'square'
    | 'diamond'
    | 'flag'
    | 'arrowup'
    | 'arrowdown'
    | 'triangleup'
    | 'triangledown'
    | 'cross'
    | 'xcross'
    | 'text_outline'
    | 'none';

/**
 * Where a label/marker anchors vertically. Pine `yloc` (price/abovebar/belowbar)
 * plus the `plotshape` pane-relative `location.top`/`location.bottom`.
 */
export type LabelYLoc = 'price' | 'abovebar' | 'belowbar' | 'top' | 'bottom';

/** A Pine `label.new(...)`. `x` follows `xloc`; `y` is a price (used when yloc='price'). */
export interface DrawingLabel {
    id: string;
    paneId: string;
    xloc: DrawingXLoc;
    x: number;
    y: number;
    yloc: LabelYLoc;
    text?: string;
    style: LabelStyle;
    /** Bubble / marker color. `undefined` → renderer default. */
    color?: string;
    textColor?: string;
    size: BoxTextSize;
    textAlign: BoxHAlign;
    tooltip?: string;
    fontFamily: BoxFontFamily;
    /** na bubble/marker color → render text only (no bubble/shape fill). */
    noFill?: boolean;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

/** One vertex of a polyline (Pine `chart.point`). `x` follows `xloc`; `price` is y. */
export interface PolylinePoint {
    xloc: DrawingXLoc;
    x: number;
    price: number;
}

/** A Pine `polyline.new(...)` — a multi-point path, optionally curved and/or closed. */
export interface DrawingPolyline {
    id: string;
    paneId: string;
    points: PolylinePoint[];
    curved: boolean;
    closed: boolean;
    /** Stroke color. `undefined` → no stroke. */
    lineColor?: string;
    /** Fill color (closed paths). `undefined` → no fill. */
    fillColor?: string;
    lineWidth: number;
    lineStyle: LineStyle;
    /** Arrowheads at segment starts/ends (`line.style_arrow_*`). */
    arrowLeft: boolean;
    arrowRight: boolean;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

/** A Pine `linefill.new(line1, line2, color)` — the band between two lines. */
export interface DrawingLinefill {
    id: string;
    paneId: string;
    line1: DrawingLine;
    line2: DrawingLine;
    /** Fill color. `undefined` → nothing drawn. */
    color?: string;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

/** Pine `position.*` — which chart corner/edge a table anchors to. */
export type TablePosition =
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'middle_left'
    | 'middle_center'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right';

/** One `table.cell(...)`. */
export interface TableCell {
    text?: string;
    textColor?: string;
    bgColor?: string;
    hAlign: BoxHAlign;
    vAlign: BoxVAlign;
    /** A named size, or Pine's integer `text_size` as a raw pixel value. */
    textSize: BoxTextSize | number;
    fontFamily: BoxFontFamily;
    tooltip?: string;
    bold: boolean;
    italic: boolean;
    /** Cell width as a percent of the pane's width (absent/0 = size to content). */
    width?: number;
    /** Cell height as a percent of the pane's height (absent/0 = size to content). */
    height?: number;
    /** A non-origin cell absorbed by a `table.merge_cells` region → not rendered.
     *  Engines may also (spuriously) stamp this on the merge ORIGIN — renderers must
     *  resolve visibility against `DrawingTable.merges`, not this flag alone. */
    merged?: boolean;
}

/** A `table.merge_cells` region (inclusive, in column/row coordinates). */
export interface TableMerge {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
}

/** A Pine `table.new(...)` — a DOM-overlay grid anchored to a chart corner. */
export interface DrawingTable {
    id: string;
    paneId: string;
    position: TablePosition;
    columns: number;
    rows: number;
    bgColor?: string;
    frameColor?: string;
    frameWidth: number;
    borderColor?: string;
    borderWidth: number;
    /** Row-major: `cells[row][col]`; entries may be null (empty cell). */
    cells: Array<Array<TableCell | null>>;
    /** Merged-cell regions (`table.merge_cells`); origin spans, others are dropped. */
    merges: TableMerge[];
}
