import { type AnchorSlot } from '../Drawing';
import type { DrawingPoint, Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { extendRay } from '../hittest';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * An Andrews' pitchfork: a median line from the pivot (p1) through the midpoint of
 * p2/p3, plus two tines parallel to the median running through p2 and p3. All three
 * lines extend to the right edge; a base line joins p2–p3.
 */
export class Pitchfork extends SegmentDrawing {
    readonly type = 'pitchfork' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'pivot', free: 'both' },
                { role: 'upper', free: 'both' },
                { role: 'lower', free: 'both' },
            ],
        };
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b || !c) return null;
        const px = (p: DrawingPoint): [number, number] | null => {
            const y = proj.yOf(p.price, this.paneId);
            return y == null ? null : [proj.xOf(p.time), y];
        };
        const P0 = px(a);
        const P1 = px(b);
        const P2 = px(c);
        if (!P0 || !P1 || !P2) return null;
        const mx = (P1[0] + P2[0]) / 2;
        const my = (P1[1] + P2[1]) / 2; // midpoint of the two tine anchors
        const dx = mx - P0[0];
        const dy = my - P0[1]; // median direction
        const w = proj.width;
        const h = proj.height;
        return {
            segments: [
                extendRay(P0[0], P0[1], mx, my, 'right', w, h), // median
                extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, 'right', w, h), // upper tine
                extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, 'right', w, h), // lower tine
                [P1[0], P1[1], P2[0], P2[1]], // base line p2–p3
            ],
            fill: null,
        };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((p) => p.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
