import type { Millis } from './time';
import type { OHLCV } from './ohlcv';

/** Value-series kinds drawn as a connected/point series. */
export type LineLikeKind = 'line' | 'area' | 'step' | 'histogram' | 'columns' | 'circles' | 'cross';

/**
 * All renderable series kinds. NOTE: `fill`, `background`, and `hline` are
 * intentionally NOT series kinds — they are modeled as overlays on a pane
 * (see scene.ts), and `barcolor` is a recolor of the price candles, not a
 * series.
 */
export type SeriesKind = LineLikeKind | 'candle' | 'bar' | 'markers';

export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** A single point of a value series. `value: null` marks a gap (whitespace). */
export interface SeriesPoint {
    time: Millis;
    value: number | null;
    /** Per-point color override (e.g. `plot(x, color = cond ? c1 : c2)`). */
    color?: string;
}

export interface LineLikeStyle {
    color: string;
    width: number;
    lineStyle: LineStyle;
    /** Baseline for histogram/area; ignored by the line family. */
    base?: number;
}

export interface CandleStyle {
    up: string;
    down: string;
    wickUp?: string;
    wickDown?: string;
    borderUp?: string;
    borderDown?: string;
}

/** Per-bar plotcandle/plotbar override (body / wick / border colours). */
export interface CandleBarColor {
    color?: string;
    wickColor?: string;
    borderColor?: string;
}

export interface MarkerPoint {
    time: Millis;
    position: 'aboveBar' | 'belowBar' | 'inBar';
    /** Neutral shape token (e.g. 'arrowUp', 'circle', 'square'); mapped per renderer. */
    shape: string;
    color: string;
    text?: string;
    size?: 'tiny' | 'small' | 'normal' | 'large' | 'huge';
}

/** A chart surface a series can show on (see {@link SeriesDisplay}). */
export type SeriesSurface = 'pane' | 'priceScale' | 'legend' | 'dataWindow';

/**
 * Where a series shows, surface by surface. Every flag defaults to shown; `false` takes
 * the series off that one surface while it keeps anchoring fills:
 * - `pane` — painted in its pane;
 * - `priceScale` — present on the price scale: its values keep the pane's autoscale in
 *   view, and back any axis value label a renderer draws for it;
 * - `legend` — its value beside the indicator's legend title;
 * - `dataWindow` — its row in the data window.
 * A series off both the pane and the price scale has no on-chart extent, so it never
 * stretches the scale (see {@link seriesInScale}).
 */
export interface SeriesDisplay {
    pane?: boolean;
    priceScale?: boolean;
    legend?: boolean;
    dataWindow?: boolean;
}

interface SeriesBase {
    /** Content-addressed, stable across re-runs of identical source (see identity.ts). */
    id: string;
    title: string;
    /** Pane this series belongs to; resolved by the orchestrator. */
    paneId: string;
    /** Declared draw-order intent; the renderer owns final z-ordering. */
    zOrder?: number;
    /**
     * `false` hides the series from every surface — a fill anchor that shows nowhere.
     * The shorthand form: when {@link display} is set it decides instead, surface by surface.
     */
    visible?: boolean;
    /** Per-surface visibility; absent ⇒ every surface {@link visible} allows. */
    display?: SeriesDisplay;
    /** `force_overlay` → render on the price pane regardless of the indicator's pane. */
    overlay?: boolean;
}

export interface LineLikeSeries extends SeriesBase {
    kind: LineLikeKind;
    points: SeriesPoint[];
    style: LineLikeStyle;
}

export interface CandleSeries extends SeriesBase {
    kind: 'candle' | 'bar';
    bars: OHLCV[];
    style?: Partial<CandleStyle>;
    /** Per-bar plotcandle/plotbar colours, aligned to `bars` by index (null ≡ use defaults). */
    barColors?: Array<CandleBarColor | null>;
}

export interface MarkerSeries extends SeriesBase {
    kind: 'markers';
    markers: MarkerPoint[];
}

export type SeriesSpec = LineLikeSeries | CandleSeries | MarkerSeries;

/** True for value series carrying `points` (line/area/step/histogram/columns/circles/cross). */
export function isLineLikeSeries(spec: SeriesSpec): spec is LineLikeSeries {
    return spec.kind !== 'candle' && spec.kind !== 'bar' && spec.kind !== 'markers';
}

/** Whether a series shows on `surface`: its `display` flag when it carries one, else its `visible` shorthand. */
export function seriesShownOn(spec: Pick<SeriesSpec, 'visible' | 'display'>, surface: SeriesSurface): boolean {
    if (spec.display) return spec.display[surface] !== false;
    return spec.visible !== false;
}

/**
 * Whether a series takes part in its pane's autoscale: it is painted there, or its value
 * sits on the price scale. A series that only reports a value (legend, data window) has
 * nothing on the chart to keep in view and must not stretch the scale.
 */
export function seriesInScale(spec: Pick<SeriesSpec, 'visible' | 'display'>): boolean {
    return seriesShownOn(spec, 'pane') || seriesShownOn(spec, 'priceScale');
}
