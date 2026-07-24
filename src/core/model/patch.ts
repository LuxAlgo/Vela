import type { Millis } from './time';
import type { OHLCV } from './ohlcv';
import type { SeriesPoint, SeriesSpec, MarkerPoint } from './series';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from './drawings';

export interface DirtyRange {
    from: Millis;
    to: Millis;
}

/** Per-series changed tail in a value patch. */
export type SeriesValueDelta =
    | { seriesId: string; kind: 'points'; points: SeriesPoint[] }
    | { seriesId: string; kind: 'bars'; bars: OHLCV[] }
    | { seriesId: string; kind: 'markers'; markers: MarkerPoint[] };

/**
 * Value-only update to existing series — legal as an in-place renderer update
 * (the renderer chooses `update()` vs `setData(tail)` by time comparison).
 */
export interface ValuePatch {
    kind: 'value';
    indicatorId: string;
    dirty: DirtyRange;
    /**
     * The emitting run's anchor (see `IndicatorModel.anchorTime`): a re-run over a
     * DIFFERENT bar window arrives as a value patch, so the anchor must travel with
     * it for index-aligned rendering to re-derive its offset. Absent ≡ whole-chart.
     */
    anchorTime?: Millis;
    series: SeriesValueDelta[];
    /**
     * Full drawing snapshots for this tick. Pine drawing containers are emitted
     * as a small, capped, already-final set each run, so live updates replace
     * the whole set rather than diffing. Absent ≡ unchanged/none.
     */
    lines?: DrawingLine[];
    boxes?: DrawingBox[];
    labels?: DrawingLabel[];
    polylines?: DrawingPolyline[];
    linefills?: DrawingLinefill[];
    tables?: DrawingTable[];
}

/**
 * Structural change — series added/removed/kind-changed, or panes changed.
 * Forces a remount of the affected series (a series' kind is fixed at creation
 * in most backends).
 */
export interface SchemaPatch {
    kind: 'schema';
    indicatorId: string;
    added: SeriesSpec[];
    removed: string[];
    changed: Array<{ seriesId: string; reason: 'kind' | 'pane' }>;
}

export type ScenePatch = ValuePatch | SchemaPatch;
