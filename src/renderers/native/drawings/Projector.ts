import type { Projector, DrawingPoint } from '../../../core/drawings';
import type { CoordinateSystem, PriceScale, PaneBounds } from '../core/CoordinateSystem';

/** A pane's live price window + pixel extent (the subset the projector needs). */
export interface PaneView {
    scale: PriceScale;
    bounds: PaneBounds;
    /** Collapsed to a legend-only strip — drawings on it are hidden (treated as zero-height). */
    collapsed?: boolean;
}

/** One OHLC(V) bar as the projector exposes it to statistical drawings (time in epoch ms).
 *  `volume` is optional — some feeds omit it, so VWAP-style drawings must tolerate its absence. */
export interface ProjectorBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

/**
 * Build a {@link Projector} over the native {@link CoordinateSystem}. Every drawing
 * resolves its data-space anchors to media pixels through this one transform, so it
 * stays aligned with the candles/chrome (which share the same `coords`). Rebuilt per
 * paint (cheap) so it always reflects the current viewport + pane scales.
 */
export function createProjector(
    coords: CoordinateSystem,
    paneOf: (paneId: string) => PaneView | null,
    paneIdAtY: (y: number) => string | null,
    barsInRange?: (from: number, to: number) => ReadonlyArray<ProjectorBar>,
): Projector {
    return {
        xOf: (time: number): number => coords.timeToX(time),
        yOf: (price: number, paneId: string): number | null => {
            const p = paneOf(paneId);
            return p ? coords.priceToY(price, p.scale, p.bounds) : null;
        },
        pxToPoint: (x: number, y: number, paneId: string): DrawingPoint => {
            const p = paneOf(paneId);
            const time = coords.logicalToTime(coords.xToLogical(x));
            const price = p ? coords.yToPrice(y, p.scale, p.bounds) : 0;
            return { time, price };
        },
        paneIdAtY,
        paneRect: (paneId: string): { top: number; height: number } | null => {
            const p = paneOf(paneId);
            if (!p) return null;
            return { top: p.bounds.top, height: p.collapsed ? 0 : p.bounds.height };
        },
        barsBetween: (t1: number, t2: number): number => Math.abs(coords.timeToLogical(t2) - coords.timeToLogical(t1)),
        barsInRange: barsInRange ? (from: number, to: number): ReadonlyArray<ProjectorBar> => barsInRange(from, to) : undefined,
        width: coords.width,
        height: coords.height,
    };
}
