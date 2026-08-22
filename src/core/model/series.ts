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

interface SeriesBase {
    /** Content-addressed, stable across re-runs of identical source (see identity.ts). */
    id: string;
    title: string;
    /** Pane this series belongs to; resolved by the orchestrator. */
    paneId: string;
    /** Declared draw-order intent; the renderer owns final z-ordering. */
    zOrder?: number;
    visible?: boolean;
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
