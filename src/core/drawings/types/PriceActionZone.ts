import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import { handleAt } from '../hittest';
import { nearestBarIndex, type PriceActionBar } from '../priceAction';
import { toHex6 } from '../../color';

/** A zone in pixels, ready to paint: the box, its halfway line, where it stopped, and the
 *  box it continues as once price flips it. */
export interface PriceZoneGeometry {
    x1: number;
    x2: number;
    yTop: number;
    yBottom: number;
    /** Fill (its alpha is the zone's opacity). */
    fill: string;
    /** Outline / halfway line: the fill's hue, opaque. */
    stroke: string;
    border: boolean;
    midY: number | null;
    /** The zone has run its course (tested, filled, broken…) and reads quieter. */
    faded: boolean;
    /** A dot on the zone's edge, at the bar where it stopped. */
    marker: { x: number; y: number } | null;
    /** The zone carried on the other way (an inverse gap, a breaker block). */
    flip: { x1: number; x2: number; fill: string; stroke: string } | null;
    handle: [number, number];
}

/**
 * Shared base for the price-action tools placed on one candle (a fair value gap, an order
 * block, a liquidity level). Only the anchor's time matters — the tool reads the candles
 * around it and after it — so the anchor moves horizontally, from candle to candle.
 */
export abstract class PriceActionTool extends Drawing {
    /** Price span of the last layout, for autoscale (which gets no projector). */
    protected cachedRange: { min: number; max: number } | null = null;
    protected cachedExtent: { min: number; max: number } | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'candle', free: 'x' }] };
    }

    /** The chart's candles, and the one nearest the anchor. */
    protected candles(proj: Projector): { bars: readonly PriceActionBar[]; at: number } | null {
        const a = this.anchors[0];
        const bars = proj.barsInRange?.(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY) ?? [];
        if (!a || bars.length === 0) return null;
        return { bars, at: nearestBarIndex(bars, a.time) };
    }

    /** Half a candle's width at bar `i`, in pixels. */
    protected halfBar(proj: Projector, bars: readonly PriceActionBar[], i: number): number {
        const a = bars[Math.max(0, i - 1)];
        const b = bars[Math.min(bars.length - 1, Math.max(1, i))];
        if (!a || !b || a === b) return 3;
        return Math.max(1, Math.abs(proj.xOf(b.time) - proj.xOf(a.time)) / 2);
    }

    /** Pixel x for the right edge of a zone that stops at bar `end`, or runs on to the chart's edge. */
    protected rightEdge(proj: Projector, bars: readonly PriceActionBar[], end: number | null): number {
        if (end === null) return Math.max(proj.width, proj.xOf(bars[bars.length - 1]!.time));
        return proj.xOf(bars[end]!.time) + this.halfBar(proj, bars, end);
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    priceRange(): { min: number; max: number } | null {
        return this.cachedRange;
    }

    override timeExtent(): { min: number; max: number } | null {
        return this.cachedExtent;
    }
}

/** A zone tool (gap, block): a box with an optional halfway line, stopped by an event. */
export abstract class PriceActionZone extends PriceActionTool {
    /** The zone's pixel layout, or null when the candles don't form one. */
    abstract zone(proj: Projector): PriceZoneGeometry | null;

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const z = this.zone(proj);
        if (!z) return false;
        const inY = py >= z.yTop - tol && py <= z.yBottom + tol;
        if (inY && px >= z.x1 - tol && px <= z.x2 + tol) return true;
        return z.flip != null && inY && px >= z.flip.x1 - tol && px <= z.flip.x2 + tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const z = this.zone(proj);
        if (z) return [z.handle];
        const a = this.anchors[0];
        const y = a ? proj.yOf(a.price, this.paneId) : null;
        return a && y != null ? [[proj.xOf(a.time), y]] : [];
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const z = this.zone(proj);
        if (!z) return null;
        const right = Math.min(proj.width, z.flip ? z.flip.x2 : z.x2);
        return { x: z.x1, y: z.yTop, w: Math.max(1, right - z.x1), h: Math.max(1, z.yBottom - z.yTop) };
    }

    /** Build the pixel box for a price span on the zone's pane; null when the pane is gone. */
    protected box(proj: Projector, top: number, bottom: number): { yTop: number; yBottom: number } | null {
        const yt = proj.yOf(top, this.paneId);
        const yb = proj.yOf(bottom, this.paneId);
        if (yt == null || yb == null) return null;
        return { yTop: Math.min(yt, yb), yBottom: Math.max(yt, yb) };
    }
}

/** A fill color's hue, opaque — the zone's outline and lines. */
export function strokeOf(fill: string): string {
    return toHex6(fill, fill);
}
