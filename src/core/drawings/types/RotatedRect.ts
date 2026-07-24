import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * A rectangle at any angle: the baseline p1→p2 sets length + rotation, and p3 sets the
 * perpendicular thickness. The four corners are constructed in pixel space each frame
 * (so the figure shears with the x/y scale, like every data-space drawing).
 */
export class RotatedRect extends SegmentDrawing {
    readonly type = 'rotatedrect' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }, { role: 'w', free: 'both' }] };
    }

    private px(proj: Projector, i: number): [number, number] | null {
        const a = this.anchors[i];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const A = this.px(proj, 0);
        const B = this.px(proj, 1);
        if (!A || !B) return null;
        const W = this.px(proj, 2);
        if (!W || this.anchors.length < 3) {
            return { segments: [[A[0], A[1], B[0], B[1]]], fill: null }; // baseline only (placing)
        }
        const vx = B[0] - A[0];
        const vy = B[1] - A[1];
        const len = Math.hypot(vx, vy);
        if (len < 1e-6) return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
        const nx = -vy / len; // unit perpendicular
        const ny = vx / len;
        const h = (W[0] - A[0]) * nx + (W[1] - A[1]) * ny; // signed perpendicular distance of the width point
        const ox = nx * h;
        const oy = ny * h;
        const C0: [number, number] = A;
        const C1: [number, number] = B;
        const C2: [number, number] = [B[0] + ox, B[1] + oy];
        const C3: [number, number] = [A[0] + ox, A[1] + oy];
        return {
            segments: [
                [C0[0], C0[1], C1[0], C1[1]],
                [C1[0], C1[1], C2[0], C2[1]],
                [C2[0], C2[1], C3[0], C3[1]],
                [C3[0], C3[1], C0[0], C0[1]],
            ],
            fill: [C0, C1, C2, C3],
        };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace('Line', 'Border') })), ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
