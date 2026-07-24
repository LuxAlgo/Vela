import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { distToPolyline, handleAt } from '../hittest';

const PHI = 1.6180339887;
const GROWTH = Math.log(PHI) / (Math.PI / 2); // radius ×φ per quarter turn → r = R0·e^(GROWTH·s)
const STEP = Math.PI / 64;
const MAX_S = Math.PI; // sample a half-turn past the edge anchor
const MIN_R = 0.5; // stop winding inward once the radius is sub-pixel

/**
 * A golden (logarithmic) Fibonacci spiral: a data-anchored center (p1, the "eye") + an edge anchor
 * (p2) that fixes the initial pixel radius `R0 = |p2 − p1|` and the rotation. The radius multiplies
 * by φ every quarter turn; sampled as a polyline, clockwise by default.
 */
export class FibSpiral extends Drawing {
    readonly type = 'fibspiral' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'center', free: 'both' }, { role: 'edge', free: 'both' }] };
    }

    /** The spiral sampled to pixel points (eye → through the edge anchor → a little beyond). */
    spiralPoints(proj: Projector): Array<[number, number]> | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        const cy = proj.yOf(c.price, this.paneId);
        const ey = proj.yOf(e.price, this.paneId);
        if (cy == null || ey == null) return null;
        const cx = proj.xOf(c.time);
        const ex = proj.xOf(e.time);
        const R0 = Math.hypot(ex - cx, ey - cy);
        if (R0 < 1) return null;
        const theta0 = Math.atan2(ey - cy, ex - cx);
        const sMin = Math.max(Math.log(MIN_R / R0) / GROWTH, -8 * Math.PI * 2); // inward until sub-pixel (capped)
        const pts: Array<[number, number]> = [];
        for (let s = sMin; s <= MAX_S; s += STEP) {
            const r = R0 * Math.exp(GROWTH * s);
            const ang = theta0 + s; // dir = +1 → clockwise on a y-down canvas
            pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
        return pts;
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const pts = this.spiralPoints(proj);
        return pts != null && pts.length >= 2 && distToPolyline(px, py, pts) <= tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return [];
        const cy = proj.yOf(c.price, this.paneId);
        const ey = proj.yOf(e.price, this.paneId);
        if (cy == null || ey == null) return [];
        return [[proj.xOf(c.time), cy], [proj.xOf(e.time), ey]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const pts = this.handlePoints(proj);
        if (pts.length < 2) return null;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    priceRange(): { min: number; max: number } | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        return { min: Math.min(c.price, e.price), max: Math.max(c.price, e.price) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
