import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import { handleAt } from '../hittest';
import { nearestBarIndex, type PriceActionBar } from '../priceAction';

/** A zone in pixels, ready to paint: the box, its halfway line, where it stopped, and the
 *  box it continues as once price flips it. */
export interface PriceZoneGeometry {
    x1: number;
    x2: number;
    yTop: number;
    yBottom: number;
    /** Fill (its alpha is the zone's opacity); the outline and halfway line take its hue, opaque. */
    fill: string;
    border: boolean;
    midY: number | null;
    /** The zone has run its course (tested, filled, broken…) and reads quieter. */
    faded: boolean;
    /** A dot on the zone's edge, at the bar where it stopped. */
    marker: { x: number; y: number } | null;
    /** The zone carried on the other way (an inverse gap, a breaker block). */
    flip: { x1: number; x2: number; fill: string } | null;
    handle: [number, number];
}

/** The settings every zone tool has (round-trip through `props`). */
export interface ZoneSettings {
    /** How far right the zone runs: to an event (`tested`, `half`, the tool's own far-side
     *  event) or `always` on to the latest candle. */
    extend: string;
    /** Fill of a bullish / bearish zone; its alpha is the opacity. */
    upColor: string;
    downColor: string;
    /** The dashed line at the zone's halfway price. */
    midline: boolean;
    border: boolean;
    /** Quieter once the zone has run its course. */
    fade: boolean;
}

/** A zone as a tool reads it off the candles: its span, and the bars it starts, stops and flips at. */
export interface ZoneFormation {
    /** The candle the zone is placed on (its handle). */
    index: number;
    bull: boolean;
    top: number;
    bottom: number;
    mid: number;
    start: number;
    /** Null runs the zone on to the latest candle. */
    end: number | null;
    /** The box it continues as the other way, until bar `to` (null runs on). */
    flip: { from: number; to: number | null } | null;
}

/** A projector lives for one paint or hit test, so every tool reading it shares one copy of the candles. */
const candlesSeen = new WeakMap<Projector, readonly PriceActionBar[]>();

/**
 * Shared base for the price-action tools placed on one candle (a fair value gap, an order
 * block, a liquidity level). Only the anchor's time matters — the tool reads the candles
 * around it and after it — so the anchor moves horizontally, from candle to candle.
 */
export abstract class PriceActionTool extends Drawing {
    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'candle', free: 'x' }] };
    }

    /** The chart's candles, and the one nearest the anchor. */
    protected candles(proj: Projector): { bars: readonly PriceActionBar[]; at: number } | null {
        const a = this.anchors[0];
        if (!a) return null;
        let bars = candlesSeen.get(proj);
        if (!bars) {
            bars = proj.barsInRange?.(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY) ?? [];
            candlesSeen.set(proj, bars);
        }
        return bars.length > 0 ? { bars, at: nearestBarIndex(bars, a.time) } : null;
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

    /** The anchor itself, for a tool with nothing on the candles to hang its handle on. */
    protected anchorHandle(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const y = a ? proj.yOf(a.price, this.paneId) : null;
        return a && y != null ? [[proj.xOf(a.time), y]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    priceRange(): { min: number; max: number } | null {
        return null;
    }
}

/** A zone tool (gap, block): a box with an optional halfway line, stopped by an event. */
export abstract class PriceActionZone extends PriceActionTool {
    protected abstract settings(): ZoneSettings;
    /** The zone the candles form around the anchor, or null when they form none. */
    protected abstract formation(bars: readonly PriceActionBar[], at: number): ZoneFormation | null;

    /** The zone's pixel layout, or null when the candles don't form one. */
    zone(proj: Projector): PriceZoneGeometry | null {
        const c = this.candles(proj);
        const f = c && this.formation(c.bars, c.at);
        if (!c || !f) return null;
        const yt = proj.yOf(f.top, this.paneId);
        const yb = proj.yOf(f.bottom, this.paneId);
        if (yt == null || yb == null) return null;
        const { bars } = c;
        const s = this.settings();
        const left = (i: number): number => proj.xOf(bars[i]!.time) - this.halfBar(proj, bars, i);
        const yTop = Math.min(yt, yb);
        const yBottom = Math.max(yt, yb);
        const midY = proj.yOf(f.mid, this.paneId) ?? (yTop + yBottom) / 2;
        const flip = f.flip && { x1: left(f.flip.from), x2: this.rightEdge(proj, bars, f.flip.to), fill: f.bull ? s.downColor : s.upColor };
        // The dot sits on the edge price reached: the near side, the halfway line or the far side.
        const edge = s.extend === 'tested' ? (f.bull ? f.top : f.bottom) : s.extend === 'half' ? f.mid : f.bull ? f.bottom : f.top;
        const edgeY = proj.yOf(edge, this.paneId);
        return {
            x1: left(f.start),
            x2: this.rightEdge(proj, bars, f.end),
            yTop,
            yBottom,
            fill: f.bull ? s.upColor : s.downColor,
            border: s.border,
            midY: s.midline ? midY : null,
            faded: f.end !== null && s.fade && !flip,
            marker: f.end !== null && !flip && edgeY != null ? { x: proj.xOf(bars[f.end]!.time), y: edgeY } : null,
            flip,
            handle: [proj.xOf(bars[f.index]!.time), midY],
        };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const z = this.zone(proj);
        if (!z) {
            // With no zone under the anchor, the painter's guide at the anchor still selects it.
            const a = this.anchors[0];
            return a != null && Math.abs(px - proj.xOf(a.time)) <= tol;
        }
        const inY = py >= z.yTop - tol && py <= z.yBottom + tol;
        if (inY && px >= z.x1 - tol && px <= z.x2 + tol) return true;
        return z.flip != null && inY && px >= z.flip.x1 - tol && px <= z.flip.x2 + tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const z = this.zone(proj);
        return z ? [z.handle] : this.anchorHandle(proj);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const z = this.zone(proj);
        if (!z) return null;
        const right = Math.min(proj.width, z.flip ? z.flip.x2 : z.x2);
        return { x: z.x1, y: z.yTop, w: Math.max(1, right - z.x1), h: Math.max(1, z.yBottom - z.yTop) };
    }
}
