import { type AnchorSlot } from '../Drawing';
import type { DrawingPoint, Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/** A triangle through three free vertices, with an optional fill. */
export class Triangle extends SegmentDrawing {
    readonly type = 'triangle' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'v1', free: 'both' },
                { role: 'v2', free: 'both' },
                { role: 'v3', free: 'both' },
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
        const A = px(a);
        const B = px(b);
        const C = px(c);
        if (!A || !B || !C) return null;
        return {
            segments: [
                [A[0], A[1], B[0], B[1]],
                [B[0], B[1], C[0], C[1]],
                [C[0], C[1], A[0], A[1]],
            ],
            fill: [A, B, C],
        };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((p) => p.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
