import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { distToSegment, extendRay, handleAt } from '../hittest';

/** A two-point trend line. Both endpoints move freely on time + price; either end can run on
 *  to the chart edge. */
export class TrendLine extends Drawing {
    readonly type = 'trendline' as const;

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

    /** Which ends run on past the anchors. */
    extension(): 'none' | 'left' | 'right' | 'both' {
        const { extendLeft: l, extendRight: r } = this.style;
        return l && r ? 'both' : l ? 'left' : r ? 'right' : 'none';
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const p = this.pixels(proj);
        if (!p) return false;
        const [x1, y1, x2, y2] = extendRay(p[0], p[1], p[2], p[3], this.extension(), proj.width, proj.height);
        return distToSegment(px, py, x1, y1, x2, y2) <= tol;
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
        const x = Math.min(p[0], p[2]);
        const y = Math.min(p[1], p[3]);
        return { x, y, w: Math.abs(p[2] - p[0]), h: Math.abs(p[3] - p[1]) };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                { path: 'style.arrowRight', label: 'Arrow', kind: 'boolean', group: 'line' },
                { path: 'style.extendLeft', label: 'Extend left', kind: 'boolean', group: 'line' },
                { path: 'style.extendRight', label: 'Extend right', kind: 'boolean', group: 'line' },
                ...TEXT_FIELDS,
            ],
        };
    }
}
