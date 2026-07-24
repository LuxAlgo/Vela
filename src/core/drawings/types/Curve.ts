import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

const CURVE_SAMPLES = 40;

/**
 * A quadratic Bézier curve. p1 and p2 are the on-curve endpoints; p3 is the off-curve
 * control handle (the curve bends toward it but does not pass through it). Sampled in
 * pixel space, so it restretches with the endpoints on zoom.
 */
export class Curve extends SegmentDrawing {
    readonly type = 'curve' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }, { role: 'control', free: 'both' }] };
    }

    private px(proj: Projector, i: number): [number, number] | null {
        const a = this.anchors[i];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const P0 = this.px(proj, 0); // start (on-curve)
        const P2 = this.px(proj, 1); // end (on-curve)
        if (!P0 || !P2) return null;
        const C = this.px(proj, 2); // control (off-curve)
        if (!C || this.anchors.length < 3) {
            return { segments: [[P0[0], P0[1], P2[0], P2[1]]], fill: null }; // straight chord (placing)
        }
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
            const t = i / CURVE_SAMPLES;
            const u = 1 - t;
            pts.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1]]);
        }
        const segments: Array<[number, number, number, number]> = [];
        for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
        return { segments, fill: pts }; // the curve↔chord lens — only painted when a fill color is set
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
