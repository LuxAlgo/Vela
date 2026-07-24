import type { Projector } from '../geometry';
import { pointInBox } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

/** The H/V grid subdivisions (editable, like GannBox), applied to both the price + time axes. */
const GRID_LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true, label: '0' },
    { ratio: 0.25, color: '#f23645', enabled: true, label: '0.25' },
    { ratio: 0.382, color: '#ff9800', enabled: true, label: '0.382' },
    { ratio: 0.5, color: '#4caf50', enabled: true, label: '0.5' },
    { ratio: 0.618, color: '#089981', enabled: true, label: '0.618' },
    { ratio: 0.75, color: '#5b9cf6', enabled: true, label: '0.75' },
    { ratio: 1, color: '#787b86', enabled: true, label: '1' },
];

/** The Gann angle fan, all from the origin corner p1. `x` = time units, `y` = price units. */
const FAN: ReadonlyArray<{ label: string; x: number; y: number; color: string }> = [
    { label: '3x1', x: 3, y: 1, color: '#f23645' },
    { label: '2x1', x: 2, y: 1, color: '#ff9800' },
    { label: '1x1', x: 1, y: 1, color: '#b2b5be' },
    { label: '1x2', x: 1, y: 2, color: '#089981' },
    { label: '1x3', x: 1, y: 3, color: '#5b9cf6' },
];

/** Concentric quarter-ellipse arc radii (as a fraction of the box), centered on p1. */
export const GANN_SQUARE_ARCS: ReadonlyArray<{ k: number; color: string }> = [
    { k: 0.25, color: '#f23645' },
    { k: 0.5, color: '#ff9800' },
    { k: 0.75, color: '#4caf50' },
    { k: 1, color: '#089981' },
];

interface GannBox {
    ox: number;
    oy: number;
    bx: number;
    py: number;
    left: number;
    top: number;
    right: number;
    bot: number;
}

/**
 * A Gann square: a price/time box with an H/V fib grid, the Gann angle fan emanating from the
 * origin corner (p1), and concentric quarter-ellipse arcs centered on p1. The grid + fan are
 * straight {@link FibEntryLine}s (the shared fib painter); the arcs get a dedicated paint branch.
 */
export class GannSquare extends FibRatios {
    readonly type = 'gannsquare' as const;

    defaultLevels(): readonly FibLevel[] {
        return GRID_LEVELS;
    }

    // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
    // sets the opposite one — matching the plain Rectangle tool.

    private box(proj: Projector): GannBox | null {
        const c1 = this.anchors[0];
        const c2 = this.anchors[1];
        if (!c1 || !c2) return null;
        const oy = proj.yOf(c1.price, this.paneId);
        const ey = proj.yOf(c2.price, this.paneId);
        if (oy == null || ey == null) return null;
        const ox = proj.xOf(c1.time);
        const ex = proj.xOf(c2.time);
        return { ox, oy, bx: ex - ox, py: ey - oy, left: Math.min(ox, ex), top: Math.min(oy, ey), right: Math.max(ox, ex), bot: Math.max(oy, ey) };
    }

    /** The origin corner + box pixel deltas, consumed by the arc painter. */
    arcGeom(proj: Projector): { ox: number; oy: number; bx: number; py: number } | null {
        const b = this.box(proj);
        return b ? { ox: b.ox, oy: b.oy, bx: b.bx, py: b.py } : null;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const b = this.box(proj);
        if (!b) return null;
        const c1 = this.anchors[0]!;
        const c2 = this.anchors[1]!;
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const hy = proj.yOf(c1.price + lv.ratio * (c2.price - c1.price), this.paneId); // horizontal (price) line
            if (hy != null) {
                out.push({ color: lv.color, x1: b.left, y1: hy, x2: b.right, y2: hy, numberText: lv.label ?? String(lv.ratio), numberX: b.left - 5, numberY: hy, numberAlign: 'right', labelX: b.left, labelY: hy });
            }
            const vx = proj.xOf(c1.time + lv.ratio * (c2.time - c1.time)); // vertical (time) line — unlabelled
            out.push({ color: lv.color, x1: vx, y1: b.top, x2: vx, y2: b.bot, numberText: '', numberX: vx, numberY: b.top, numberAlign: 'center', labelX: vx, labelY: b.top });
        }
        for (const f of FAN) {
            let u: number;
            let v: number;
            if (f.x > f.y) {
                u = b.ox + b.bx; // shallow → reaches the far vertical edge at fraction y/x of the height
                v = b.oy + (f.y / f.x) * b.py;
            } else {
                v = b.oy + b.py; // steep → reaches the far horizontal edge at fraction x/y of the width
                u = b.ox + (f.x / f.y) * b.bx;
            }
            out.push({ color: f.color, x1: b.ox, y1: b.oy, x2: u, y2: v, numberText: f.label, numberX: u + 4, numberY: v, numberAlign: 'left', labelX: u + 4, labelY: v });
        }
        return out;
    }

    override hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const b = this.box(proj);
        return b != null && pointInBox(px, py, b.left, b.top, b.right, b.bot, tol); // grabbable anywhere inside
    }

    priceRange(): { min: number; max: number } | null {
        const c1 = this.anchors[0];
        const c2 = this.anchors[1];
        if (!c1 || !c2) return null;
        return { min: Math.min(c1.price, c2.price), max: Math.max(c1.price, c2.price) };
    }
}
