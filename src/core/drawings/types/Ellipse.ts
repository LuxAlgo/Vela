import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { distToPolyline, handleAt } from '../hittest';

const PERIM_SAMPLES = 48; // perimeter samples for outline hit-testing

/** An ellipse inscribed in the bounding box of two opposite corners. Optional fill. */
export class Ellipse extends Drawing {
    readonly type = 'ellipse' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    private oval(proj: Projector): { cx: number; cy: number; rx: number; ry: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        return { cx: (xa + xb) / 2, cy: (ya + yb) / 2, rx: Math.abs(xb - xa) / 2, ry: Math.abs(yb - ya) / 2 };
    }

    private perimeter(o: { cx: number; cy: number; rx: number; ry: number }): Array<[number, number]> {
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= PERIM_SAMPLES; i += 1) {
            const t = (i / PERIM_SAMPLES) * Math.PI * 2;
            pts.push([o.cx + o.rx * Math.cos(t), o.cy + o.ry * Math.sin(t)]);
        }
        return pts;
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const o = this.oval(proj);
        if (!o || o.rx < 1 || o.ry < 1) return false;
        const f = ((px - o.cx) / o.rx) ** 2 + ((py - o.cy) / o.ry) ** 2;
        if (this.style.fillColor && f <= 1) return true; // inside a filled ellipse
        return distToPolyline(px, py, this.perimeter(o)) <= tol; // near the outline
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return [];
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return [];
        return [[proj.xOf(a.time), ya], [proj.xOf(b.time), yb]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const o = this.oval(proj);
        if (!o) return null;
        return { x: o.cx - o.rx, y: o.cy - o.ry, w: o.rx * 2, h: o.ry * 2 };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
