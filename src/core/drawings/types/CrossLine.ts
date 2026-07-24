import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';

/** A full-width horizontal + full-height vertical line crossing at a single anchor. */
export class CrossLine extends Drawing {
    readonly type = 'crossline' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'both' }] };
    }

    private pt(proj: Projector): [number, number] | null {
        const a = this.anchors[0];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const p = this.pt(proj);
        return p != null && (Math.abs(py - p[1]) <= tol || Math.abs(px - p[0]) <= tol); // either arm
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const p = this.pt(proj);
        return p ? [p] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const p = this.pt(proj);
        return p ? { x: p[0] - 1, y: p[1] - 1, w: 2, h: 2 } : null;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }

    // The horizontal arm spans the full width → never cull by time.
    override timeExtent(): { min: number; max: number } | null {
        return null;
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
