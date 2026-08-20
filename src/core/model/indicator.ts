import type { Millis } from './time';
import type { SeriesSpec } from './series';
import type { Fill, Background, PriceLine } from './scene';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from './drawings';
import type { TradeExecution } from './trades';
import type { InputSchema, InputValue } from './inputs';

/** Declaration metadata from the Pine `indicator()` / `strategy()` call. */
export interface IndicatorMeta {
    title: string;
    shorttitle?: string;
    overlay: boolean;
    precision?: number;
    format?: string;
}

/** Where an indicator's plots are placed. */
export type PaneHint = 'price' | 'new';

/** One label of a categorical pane axis: `frac` is the label's center as a fraction of
 *  the pane's height (0 = top, 1 = bottom). */
export interface PaneAxisBand {
    frac: number;
    label: string;
}

/** A pane's value-axis override (see {@link IndicatorModel.paneAxis}): `'none'` = a
 *  blank axis; band labels = a categorical axis, one label per content band/row. */
export type PaneAxis = 'none' | { bands: PaneAxisBand[] };

/**
 * Everything one `addIndicator()` produces — the unit the orchestrator mounts
 * on the renderer. Renderer-neutral.
 */
export interface IndicatorModel {
    /** Per-instance id (stable). */
    id: string;
    /** Full display name (settings dialog, object tree, inspect). */
    title: string;
    /**
     * Compact legend label when the full {@link title} is too long for the chip.
     * Absent ⇒ the legend uses {@link title}. Mirrors Pine `indicator(..., shorttitle=)`.
     */
    shorttitle?: string;
    overlay: boolean;
    paneHint: PaneHint;
    /**
     * Marks a NATIVE indicator (core-computed, no Pine engine) and its type (e.g. `'volume'`,
     * `'volume'`). Absent ⇒ an ordinary Pine indicator. Drives native-only legend styling
     * (distinct title color) + list ordering (native indicators pin to the top).
     */
    native?: { type: string };
    /**
     * Value-axis override for the pane this indicator OWNS — declared by content that is
     * not value-mapped (e.g. a bespoke renderer layer painting in pixel bands), where a
     * derived price scale would label meaningless numbers. `'none'` leaves the axis blank;
     * band labels place text at fractions of the pane's height (a categorical axis — one
     * label per band/row, e.g. `frac: 0.25` centers a label in the top quarter). Either way
     * the renderer draws no price ticks, no horizontal gridlines, and no crosshair value
     * chip in that pane. Only honored while such indicators are the pane's sole content —
     * any real series merged into the pane takes the scale (and its labels) back over.
     */
    paneAxis?: PaneAxis;
    /** Resolved pane id, filled in by the orchestrator after routing. */
    paneId?: string;
    /**
     * When true, this indicator renders on its OWN price scale within its pane (a
     * dedicated axis column to the right of the pane's scale), independent of the
     * pane's master scale — set when the indicator is merged into a pane it does not
     * own. Absent/false ⇒ it shares the pane's scale (the norm; script overlays like
     * a moving average keep sharing the price scale).
     */
    ownScale?: boolean;
    /**
     * Chart time (epoch ms) of the execution's FIRST bar. Index-aligned payloads —
     * dense series point/bar arrays and `bar_index` drawing coordinates — count from
     * this bar, so a renderer aligns them to the chart via the offset of this time in
     * its bar array. Absent ⇒ the model spans the whole chart (offset 0, the norm);
     * set by engines that ran over a SUFFIX of the bars (e.g. mid-backfill).
     */
    anchorTime?: Millis;
    series: SeriesSpec[];
    fills: Fill[];
    backgrounds: Background[];
    priceLines: PriceLine[];
    /** Pine `line.new(...)` drawings (optional; absent ≡ none). */
    lines?: DrawingLine[];
    /** Pine `box.new(...)` drawings (optional; absent ≡ none). */
    boxes?: DrawingBox[];
    /** Pine `label.new(...)` drawings (optional; absent ≡ none). */
    labels?: DrawingLabel[];
    /** Pine `polyline.new(...)` drawings (optional; absent ≡ none). */
    polylines?: DrawingPolyline[];
    /** Pine `linefill.new(...)` fills (optional; absent ≡ none). */
    linefills?: DrawingLinefill[];
    /** Pine `table.new(...)` DOM overlays (optional; absent ≡ none). */
    tables?: DrawingTable[];
    /** Pine `barcolor(...)` per-bar candle recolor (time→color; absent/empty ≡ none). */
    barColors?: Array<{ time: Millis; color: string }>;
    /** Strategy order executions, painted as trade markers on the PRICE pane (optional; absent ≡ none). */
    trades?: TradeExecution[];
    /** Input schema parsed from the Pine source (drives the renderer's settings dialog). */
    inputs: InputSchema[];
    /** Current input values (defaults merged with any user/add-time overrides). */
    inputValues: Record<string, InputValue>;
}
