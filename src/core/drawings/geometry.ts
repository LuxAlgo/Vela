/**
 * Geometry seam for user drawings. A drawing stores its anchors in DATA space
 * ({@link DrawingPoint}); every pixel it needs is resolved on demand through a
 * {@link Projector} the renderer supplies. The model never stores pixels, so a
 * drawing survives reload, pan/zoom, bar-prepend, and timezone changes — the
 * same invariant Pine drawings get from `xloc:'bar_time'`.
 */

import type { DrawingSeriesState } from './series';

/** A drawing anchor in DATA space (epoch-ms time + data-space price). */
export interface DrawingPoint {
    /** Epoch ms — resolved to a fractional logical bar index by the time scale. */
    time: number;
    /** Data-space price (not normalized, not pane-relative). */
    price: number;
}

/** Axes a handle is free to move along — drives drag constraints + handle generation. */
export type FreeAxis = 'both' | 'x' | 'y' | 'none';

/**
 * Pixel render-geometry for multi-line drawings (channels, pitchforks): the stroked
 * line segments plus an optional fill polygon. A pure function of the anchors +
 * {@link Projector}, so the model owns the math once and both the hit-tester and the
 * painter consume it (no duplicated geometry).
 */
export interface SegmentGeometry {
    /** Line segments to stroke, each `[x1, y1, x2, y2]` in media px. */
    segments: Array<[number, number, number, number]>;
    /** A polygon `[x, y][]` to fill between lines, or null when there's no fill. */
    fill: Array<[number, number]> | null;
}

/**
 * Magnet (snap-to-candle) strength. `off` never snaps; `strong` always snaps the
 * anchor to the nearest bar/OHLC; `weak` snaps only when the candle point is within
 * a small pixel radius of the cursor (so you can place freely between candles).
 * Holding Ctrl/Cmd is a momentary `strong` override regardless of the sticky mode.
 */
export type SnapMode = 'off' | 'weak' | 'strong';

/**
 * The renderer-supplied data→pixel transform. The native renderer builds it from
 * its {@link CoordinateSystem} (`xOf = timeToX`, `yOf = priceToY` against the
 * pane's live scale + bounds); any other renderer can build the same from its own
 * coordinate closures. Defined in core so the model depends only on the interface.
 */
export interface Projector {
    /** Pixel x for an epoch-ms time (extrapolates past either edge). */
    xOf(time: number): number;
    /** Pixel y for a price on a pane; `null` when the pane is gone. */
    yOf(price: number, paneId: string): number | null;
    /** Inverse — pixel → data point on a pane (used on create/drag commit). */
    pxToPoint(x: number, y: number, paneId: string): DrawingPoint;
    /** Which pane owns a pixel y, or `null` outside every pane. */
    paneIdAtY(y: number): string | null;
    /**
     * A pane's vertical pixel extent, or `null` when the pane is gone. `height` is 0 while
     * the pane is hidden (collapsed to a legend strip, or zeroed by another pane's maximize) —
     * painters clip each drawing to this rect so panes stay visually separated; optional.
     */
    paneRect?(paneId: string): { top: number; height: number } | null;
    /** Approximate whole bars between two times (for measurement labels); optional. */
    barsBetween?(t1: number, t2: number): number;
    /**
     * OHLC(V) bars whose time falls within `[from, to]` (inclusive), in ascending time —
     * the data a statistical drawing (e.g. a regression channel or anchored VWAP) fits
     * against. `volume` is optional (some feeds omit it). Optional itself: renderers without
     * series access (or with user-drawings disabled) may omit the method, and such drawings
     * then degrade gracefully to an anchor-only fallback.
     */
    barsInRange?(from: number, to: number): ReadonlyArray<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>;
    /**
     * Bars of a FINER timeframe than the chart's, for the same symbol — the async sibling
     * of {@link barsInRange} (see {@link DrawingSeriesGateway}): a cache read that reports
     * `loading` while the background fetch runs, after which the renderer repaints.
     * Optional: renderers without a series gateway omit it, and such drawings degrade to
     * an anchors-only rendering.
     */
    seriesInRange?(timeframe: string, from: number, to: number): DrawingSeriesState;
    /** Plot width in media px (excludes the right price-axis strip). */
    readonly width: number;
    /** Plot height in media px (excludes the bottom time-axis strip). */
    readonly height: number;
}
