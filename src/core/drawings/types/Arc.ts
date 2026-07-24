import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

const ARC_SAMPLES = 40;

/**
 * A half-ellipse dome over a base chord (p1→p2) with an apex (p3) whose height sets the bulge.
 * The apex is pinned to the chord's horizontal midpoint, so the dome stays symmetric about
 * the chord's perpendicular bisector.
 */
export class Arc extends SegmentDrawing {
    readonly type = 'arc' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }, { role: 'apex', free: 'both' }] };
    }

    private pinApex(): void {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const apex = this.anchors[2];
        if (a && b && apex) apex.time = (a.time + b.time) / 2;
    }

    override onPlaced(): void {
        this.pinApex();
    }

    override constrainHandleDrag(): void {
        this.pinApex(); // keep the apex on the chord's midpoint whichever handle moved
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
        const apex = this.anchors[2];
        if (!apex || this.anchors.length < 3) {
            return { segments: [[A[0], A[1], B[0], B[1]]], fill: null }; // chord only (placing)
        }
        const ay = proj.yOf(apex.price, this.paneId);
        if (ay == null) return null;
        const Mx = (A[0] + B[0]) / 2;
        const My = (A[1] + B[1]) / 2;
        const hx = (B[0] - A[0]) / 2; // half-chord vector
        const hy = (B[1] - A[1]) / 2;
        const len = Math.hypot(hx, hy);
        if (len < 1e-6) return { segments: [[A[0], A[1], B[0], B[1]]], fill: null };
        let nx = -hy / len; // unit normal to the chord
        let ny = hx / len;
        const off = (ay - My) * ny; // apex offset along the normal (apex x is pinned to Mx, so its x term is 0)
        if (off < 0) {
            nx = -nx;
            ny = -ny;
        }
        const h = Math.abs(off); // dome height
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= ARC_SAMPLES; i += 1) {
            const t = (i / ARC_SAMPLES) * Math.PI; // 0 → π sweeps B → A over the dome
            const c = Math.cos(t);
            const s = Math.sin(t);
            pts.push([Mx + c * hx + s * h * nx, My + c * hy + s * h * ny]);
        }
        const segments: Array<[number, number, number, number]> = [];
        for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
        segments.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1], pts[0]![0], pts[0]![1]]); // close along the chord
        return { segments, fill: pts };
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
