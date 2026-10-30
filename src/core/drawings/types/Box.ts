import { msg } from '../../i18n/message';
import { Drawing, type AnchorSlot } from '../Drawing';
import type { DrawingPoint, Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { TEXT_FIELDS, BORDER_FIELDS } from '../schema';
import { distToSegment, handleAt, pointInBox } from '../hittest';

/**
 * A rectangle defined by two opposite corners. Optional fill + border.
 *
 * Eight handles: the two anchor corners (0, 1), the other two corners (2, 3), then the edge
 * midpoints (4–7). Corners resize both ways; an edge handle moves only its own side.
 */
export class Box extends Drawing {
    readonly type = 'box' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    private rect(proj: Projector): { x1: number; y1: number; x2: number; y2: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const r = this.rect(proj);
        if (!r) return false;
        // A filled box is grabbable anywhere inside; otherwise only near its border.
        if (this.style.fillColor && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
        const edges: Array<[number, number, number, number]> = [
            [r.x1, r.y1, r.x2, r.y1],
            [r.x2, r.y1, r.x2, r.y2],
            [r.x2, r.y2, r.x1, r.y2],
            [r.x1, r.y2, r.x1, r.y1],
        ];
        return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const r = this.rect(proj);
        if (!r) return [];
        const mx = (r.x1 + r.x2) / 2;
        const my = (r.y1 + r.y2) / 2;
        // The anchor corners stay first: the painter and the label read the box from points 0 and 1.
        return [
            [r.x1, r.y1],
            [r.x2, r.y2],
            [r.x2, r.y1],
            [r.x1, r.y2],
            [mx, r.y1],
            [r.x2, my],
            [mx, r.y2],
            [r.x1, my],
        ];
    }

    override dragHandle(index: number, pt: DrawingPoint): void {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return;
        // Which anchor supplies each handle's x (time) and y (price); null = that axis stays put.
        const map: Array<[DrawingPoint | null, DrawingPoint | null]> = [
            [a, a],
            [b, b],
            [b, a],
            [a, b],
            [null, a],
            [b, null],
            [null, b],
            [a, null],
        ];
        const [tx, ty] = map[index] ?? [null, null];
        if (tx) tx.time = pt.time;
        if (ty) ty.price = pt.price;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const r = this.rect(proj);
        if (!r) return null;
        return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
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
                ...BORDER_FIELDS,
                { path: 'style.fillColor', label: msg('drawing.box.fillColor', 'Fill color'), kind: 'color', group: 'fill' },
                ...TEXT_FIELDS,
            ],
        };
    }
}
