import { type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { FibLevel } from './FibRatios';
import { RadialFib, type RadialGeom } from './RadialFib';
import { fibLevels } from '../levelPalette';

const WEDGE_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/**
 * A Fibonacci wedge: an apex (p1) with a base radius `R0 = |p2 − p1|` and an angular sweep between
 * the two rays p1→p2 and p1→p3 (p3 contributes only its angle). Each level is a circular arc of
 * radius `R0 · ratio` spanning the (minor) wedge angle, plus the two bounding rays.
 */
export class FibWedge extends RadialFib {
    readonly type = 'fibwedge' as const;

    defaultLevels(): readonly FibLevel[] {
        return WEDGE_LEVELS;
    }

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'apex', free: 'both' }, { role: 'radius', free: 'both' }, { role: 'angle', free: 'both' }] };
    }

    private px(proj: Projector, i: number): [number, number] | null {
        const a = this.anchors[i];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    radial(proj: Projector): RadialGeom | null {
        const p0 = this.px(proj, 0);
        const p1 = this.px(proj, 1);
        const p2 = this.px(proj, 2);
        if (!p0 || !p1 || !p2) return null;
        const R0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (R0 < 1) return null;
        const angle1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const angle2 = Math.atan2(p2[1] - p0[1], p2[0] - p0[0]);
        let lo = Math.min(angle1, angle2);
        let hi = Math.max(angle1, angle2);
        if (hi - lo > Math.PI) [lo, hi] = [hi, lo + Math.PI * 2]; // take the minor (wedge) sweep
        return { cx: p0[0], cy: p0[1], R0, a0: lo, a1: hi };
    }

    override boundingLines(proj: Projector): Array<[number, number, number, number]> {
        const p0 = this.px(proj, 0);
        const p1 = this.px(proj, 1);
        if (!p0 || !p1) return [];
        const out: Array<[number, number, number, number]> = [[p0[0], p0[1], p1[0], p1[1]]]; // apex→radius ray
        const p2 = this.px(proj, 2);
        if (p2) {
            const R0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
            if (len > 1e-6) {
                // the second ray re-projected to the same radius R0 (only its angle matters)
                out.push([p0[0], p0[1], p0[0] + ((p2[0] - p0[0]) / len) * R0, p0[1] + ((p2[1] - p0[1]) / len) * R0]);
            }
        }
        return out;
    }
}
