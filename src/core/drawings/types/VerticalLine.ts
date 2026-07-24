import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';

/** A vertical line at a single time, spanning the full pane height. */
export class VerticalLine extends Drawing {
    readonly type = 'vline' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // One anchor; only its time (x) matters — its price pins the drag handle.
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'x' }] };
    }

    private x(proj: Projector): number | null {
        const a = this.anchors[0];
        return a ? proj.xOf(a.time) : null;
    }

    hitTest(px: number, _py: number, proj: Projector, tol: number): boolean {
        const x = this.x(proj);
        return x != null && Math.abs(px - x) <= tol; // ignores y → spans full height
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const x = this.x(proj);
        if (!a || x == null) return [];
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? [] : [[x, y]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const x = this.x(proj);
        return x == null ? null : { x: x - 1, y: 0, w: 2, h: proj.height };
    }

    priceRange(): { min: number; max: number } | null {
        return null; // a vertical line doesn't constrain the price axis
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
