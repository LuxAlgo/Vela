import type { Millis } from './time';
import type { OHLCV } from './ohlcv';
import type { SeriesPoint, SeriesSpec, MarkerPoint, CandleBarColor } from './series';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from './drawings';
import type { TradeExecution } from './trades';
import type { Fill, Background, PriceLine } from './scene';

export interface DirtyRange {
    from: Millis;
    to: Millis;
}

/** Per-series changed tail in a value patch. */
export type SeriesValueDelta =
    | { seriesId: string; kind: 'points'; points: SeriesPoint[] }
    | {
          seriesId: string;
          kind: 'bars';
          bars: OHLCV[];
          /**
           * The series' per-bar colors (see `CandleSeries.barColors`), index-aligned to `bars`.
           * Omitted keeps the current ones; the orchestrator always states them, `[]` included,
           * so a run that emits no colors clears the previous set instead of leaving it on new bars.
           */
          barColors?: Array<CandleBarColor | null>;
      }
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
     * it for index-aligned rendering to re-derive its offset. `null` states the run
     * spanned the WHOLE chart and clears any previous anchor — an omitted key cannot,
     * so a model that once had an anchor would otherwise keep that stale offset.
     */
    anchorTime?: Millis | null;
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
    /** Trade executions follow the same full-snapshot-per-tick pattern as the drawings. */
    trades?: TradeExecution[];
    /**
     * The run's `fill()` bands. Their per-bar `colors` / `gradient` are index-aligned like the
     * series points, so a re-run over a different bar window (a deeper history, a page of older
     * bars) must replace them together with the points: kept, the previous run's colors slide
     * onto whatever candles now hold their indices, and the bars past them get no fill at all.
     * Absent keeps the current set.
     */
    fills?: Fill[];
    /** The run's `bgcolor()` spans (time-keyed). Absent keeps the current set. */
    backgrounds?: Background[];
    /** The run's `hline()`s. Absent keeps the current set. */
    priceLines?: PriceLine[];
    /** The run's `barcolor()` recolors (time-keyed; `[]` clears them). Absent keeps the current set. */
    barColors?: Array<{ time: Millis; color: string }>;
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
