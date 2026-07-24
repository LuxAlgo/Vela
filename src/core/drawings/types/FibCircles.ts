import type { Projector } from '../geometry';
import type { FibLevel } from './FibRatios';
import { RadialFib, type RadialGeom } from './RadialFib';

const CIRCLE_LEVELS: readonly FibLevel[] = [
    { ratio: 0.236, color: '#f23645', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 0.786, color: '#5b9cf6', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.618, color: '#f23645', enabled: true },
    { ratio: 2.618, color: '#ff9800', enabled: true },
];

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
