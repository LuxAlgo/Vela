import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';

/**
 * A true circle: a data-pinned center anchor + an edge anchor whose pixel distance from
 * the projected center is the radius. Because the radius is a scalar pixel distance (not
 * separate x/y radii), the shape stays perfectly round at any zoom — unlike the
 * bounding-box {@link Ellipse}, which distorts as the x/y scales diverge.
 */
export class Circle extends Drawing {
    readonly type = 'circle' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'center', free: 'both' }, { role: 'edge', free: 'both' }] };
    }

    private geom(proj: Projector): { cx: number; cy: number; r: number } | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        const cy = proj.yOf(c.price, this.paneId);
        const ey = proj.yOf(e.price, this.paneId);
        if (cy == null || ey == null) return null;
        const cx = proj.xOf(c.time);
        const ex = proj.xOf(e.time);
        return { cx, cy, r: Math.hypot(ex - cx, ey - cy) };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const g = this.geom(proj);
        if (!g || g.r < 1) return false;
        const d = Math.hypot(px - g.cx, py - g.cy);
        if (this.style.fillColor && d <= g.r) return true; // inside a filled disc
        return Math.abs(d - g.r) <= tol; // near the ring
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
        const g = this.geom(proj);
        if (!g) return null;
        return { x: g.cx - g.r, y: g.cy - g.r, w: g.r * 2, h: g.r * 2 };
    }

    priceRange(): { min: number; max: number } | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        return { min: Math.min(c.price, e.price), max: Math.max(c.price, e.price) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
