import type { Projector } from '../geometry';
import type { FibLevel } from './FibRatios';
import { RadialFib, type RadialGeom } from './RadialFib';
import { fibLevels } from '../levelPalette';

const CIRCLE_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]);

/** Concentric full circles at Fibonacci-ratio pixel radii from a data-anchored center (center + edge). */
export class FibCircles extends RadialFib {
    readonly type = 'fibcircles' as const;

    defaultLevels(): readonly FibLevel[] {
        return CIRCLE_LEVELS;
    }

    radial(proj: Projector): RadialGeom | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        const cy = proj.yOf(c.price, this.paneId);
        const ey = proj.yOf(e.price, this.paneId);
        if (cy == null || ey == null) return null;
        const cx = proj.xOf(c.time);
        const ex = proj.xOf(e.time);
        return { cx, cy, R0: Math.hypot(ex - cx, ey - cy), a0: 0, a1: Math.PI * 2 };
    }
}
