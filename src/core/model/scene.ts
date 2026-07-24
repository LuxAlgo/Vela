import type { Millis } from './time';
import type { OHLCV } from './ohlcv';
import type { SeriesSpec, LineStyle } from './series';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from './drawings';

export type PaneKind = 'price' | 'study';

export interface Pane {
    id: string;
    kind: PaneKind;
    /** Display order, top-to-bottom; the price pane is conventionally order 0. */
    order: number;
    /** Relative height weight among panes (the renderer normalizes). */
    heightWeight?: number;
    title?: string;
}

/** One bar's vertical gradient stop for a gradient `fill()` (color@price). */
export interface FillGradientStop {
    topValue: number;
    bottomValue: number;
    topColor: string;
    bottomColor: string;
}

/** A band fill between two value series (Pine `fill(plot1, plot2, ...)`). */
export interface Fill {
    id: string;
    paneId: string;
    /** RESOLVED series ids (the orchestrator resolves Pine plot refs to ids). */
    fromSeriesId: string;
    toSeriesId: string;
    /** Flat band color (no per-bar variation). */
    color?: string;
    /** Per-bar solid color (conditional fills), aligned to the anchor points by index. */
    colors?: Array<string | null>;
    /** Per-bar vertical gradient (gradient-fill overload), aligned by index. */
    gradient?: Array<FillGradientStop | null>;
}

/** A vertical background tint over a time span (Pine `bgcolor()` / session bands). */
export interface Background {
    id: string;
    paneId: string;
    /** Inclusive start, epoch ms. */
    from: Millis;
    /** Exclusive end, epoch ms. */
    to: Millis;
    color: string;
}

/** A horizontal price line (Pine `hline()`). */
export interface PriceLine {
    id: string;
    paneId: string;
    price: number;
    color?: string;
    lineStyle?: LineStyle;
    width?: number;
    title?: string;
}

/**
 * The renderer-neutral, full description of what to draw. In the engine-owned
 * design the orchestrator usually drives the renderer per-indicator
 * (`mountIndicator`), but `Scene` is the conceptual aggregate the reconciler
 * diffs against.
 */
export interface Scene {
    bars: OHLCV[];
    panes: Pane[];
    series: SeriesSpec[];
    fills: Fill[];
    backgrounds: Background[];
    priceLines: PriceLine[];
    lines?: DrawingLine[];
    boxes?: DrawingBox[];
    labels?: DrawingLabel[];
    polylines?: DrawingPolyline[];
    linefills?: DrawingLinefill[];
    tables?: DrawingTable[];
}
