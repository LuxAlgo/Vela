import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';

/** A single-price horizontal line spanning the full plot width. */
export class HorizontalLine extends Drawing {
    readonly type = 'hline' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // One anchor; only its price (y) matters — its time pins the drag handle.
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'y' }] };
    }

    private y(proj: Projector): number | null {
        const a = this.anchors[0];
        return a ? proj.yOf(a.price, this.paneId) : null;
    }

    hitTest(_px: number, py: number, proj: Projector, tol: number): boolean {
        const y = this.y(proj);
        return y != null && Math.abs(py - y) <= tol; // ignores x → spans full width
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const y = this.y(proj);
        if (!a || y == null) return [];
        return [[proj.xOf(a.time), y]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const y = this.y(proj);
        return y == null ? null : { x: 0, y: y - 1, w: proj.width, h: 2 };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }

    // A horizontal line spans the full width → never cull by time.
    override timeExtent(): { min: number; max: number } | null {
        return null;
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
