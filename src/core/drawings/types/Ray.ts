import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { distToSegment, extendRay, handleAt } from '../hittest';

/** A ray: a line through two anchors that extends to the right chart edge. */
export class Ray extends Drawing {
    readonly type = 'ray' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }] };
    }

    private pixels(proj: Projector): [number, number, number, number] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const y1 = proj.yOf(a.price, this.paneId);
        const y2 = proj.yOf(b.price, this.paneId);
        if (y1 == null || y2 == null) return null;
        return [proj.xOf(a.time), y1, proj.xOf(b.time), y2];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const p = this.pixels(proj);
        if (!p) return false;
        const [ex1, ey1, ex2, ey2] = extendRay(p[0], p[1], p[2], p[3], 'right', proj.width, proj.height);
        return distToSegment(px, py, ex1, ey1, ex2, ey2) <= tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const p = this.pixels(proj);
        return p ? [[p[0], p[1]], [p[2], p[3]]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const p = this.pixels(proj);
        if (!p) return null;
        return { x: Math.min(p[0], p[2]), y: Math.min(p[1], p[3]), w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
