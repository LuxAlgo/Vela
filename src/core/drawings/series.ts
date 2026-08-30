import type { Unsubscribe } from '../util/types';

/**
 * Async series access for data-driven drawings — the ranged, any-timeframe sibling
 * of {@link Projector.barsInRange}. Painting stays synchronous: a read either serves
 * bars from cache or reports `loading` while a fetch runs in the background; the
 * gateway then fires {@link DrawingSeriesGateway.onUpdate} so the renderer repaints
 * and the next read finds the bars. Neutral by design — any drawing that needs bars
 * of a finer timeframe than the chart's reads through this seam.
 */

/** One OHLC(V) bar as the gateway returns it (`time` = bar open, epoch ms). */
export interface DrawingSeriesBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

/**
 * The synchronous answer to a series read. `ready` and `loading` carry the RESOLVED
 * timeframe (an `'auto'` request comes back concrete) and its bar duration so consumers
 * never re-derive timeframe math. `loading` may carry best-effort PARTIAL bars from
 * previously fetched overlapping windows, so a resize keeps painting what it already
 * has while the widened fetch runs; `unavailable` is a terminal state for this
 * request — no fetch was started.
 */
export type DrawingSeriesState =
    | { state: 'loading'; timeframe: string; barMs: number; bars?: ReadonlyArray<DrawingSeriesBar> }
    | { state: 'ready'; bars: ReadonlyArray<DrawingSeriesBar>; timeframe: string; barMs: number }
    | {
          state: 'unavailable';
          /** `no-source` = the market has no ranged feed (inline data); `none-lower` = NO
           *  offered timeframe is below the chart's (the chart is already at the finest);
           *  `not-lower` = the explicit pick does not subdivide the chart's (lower picks
           *  exist); `too-wide` = the range would need more bars than the gateway's cap. */
          reason: 'no-source' | 'none-lower' | 'not-lower' | 'too-wide';
      };

/**
 * The core-owned gateway the renderer hands drawings via {@link Projector.seriesInRange}.
 * `timeframe` accepts a canonical value (`'5'`, `'60'`, `'D'`) or `'auto'` — the gateway
 * resolves `'auto'` against the chart's own timeframe and refuses anything not strictly
 * lower than it.
 */
export interface DrawingSeriesGateway {
    /** Synchronous cache read for the CHART's OWN symbol; kicks a background fetch on a miss. */
    seriesInRange(timeframe: string, from: number, to: number): DrawingSeriesState;
    /** Fires when a background fetch lands new bars (the renderer repaints on it). */
    onUpdate(listener: () => void): Unsubscribe;
}
