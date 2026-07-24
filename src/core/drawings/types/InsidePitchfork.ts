import { type AnchorSlot } from '../Drawing';
import type { DrawingPoint, Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { extendRay } from '../hittest';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * An inside pitchfork: the median is anchored at M = midpoint(p2, p3) but takes its slope from
 * d = p3 − midpoint(p1, p2) (the modified base B). The two tines run through p2/p3 parallel to
 * the median; short connector segments (B–p3 and p1–p2) show the construction.
 */
export class InsidePitchfork extends SegmentDrawing {
    readonly type = 'insidepitchfork' as const;

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
        const B = px({ time: (a.time + b.time) / 2, price: (a.price + b.price) / 2 }); // modified base
        const P0 = px(a);
        const P1 = px(b);
        const P2 = px(c);
        if (!B || !P0 || !P1 || !P2) return null;
        const mx = (P1[0] + P2[0]) / 2;
        const my = (P1[1] + P2[1]) / 2; // median target M
        const dx = P2[0] - B[0];
        const dy = P2[1] - B[1]; // median slope d = P2 − B
        const w = proj.width;
        const h = proj.height;
        return {
            segments: [
                extendRay(mx, my, mx + dx, my + dy, 'right', w, h), // median through M
                extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, 'right', w, h), // upper tine
                extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, 'right', w, h), // lower tine
                [P1[0], P1[1], P2[0], P2[1]], // base line
                [B[0], B[1], P2[0], P2[1]], // construction: modified base → p3
                [P0[0], P0[1], P1[0], P1[1]], // construction: the back trend line p1 → p2
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
