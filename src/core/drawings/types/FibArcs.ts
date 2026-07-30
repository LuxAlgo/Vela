import type { Projector } from '../geometry';
import type { FibLevel } from './FibRatios';
import { RadialFib, type RadialGeom } from './RadialFib';
import { fibLevels } from '../levelPalette';

const ARC_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]);

/**
 * Fibonacci speed/resistance arcs: concentric semicircles centered at the pivot (p1), at radii
 * `R0 · ratio` where `R0 = |p2 − p1|`, bulging toward the far anchor (p2). The p1→p2 baseline is drawn too.
 */
export class FibArcs extends RadialFib {
    readonly type = 'fibarcs' as const;

    defaultLevels(): readonly FibLevel[] {
        return ARC_LEVELS;
    }

    private pts(proj: Projector): { cx: number; cy: number; ex: number; ey: number } | null {
        const c = this.anchors[0];
        const e = this.anchors[1];
        if (!c || !e) return null;
        const cy = proj.yOf(c.price, this.paneId);
        const ey = proj.yOf(e.price, this.paneId);
        if (cy == null || ey == null) return null;
        return { cx: proj.xOf(c.time), cy, ex: proj.xOf(e.time), ey };
    }

    radial(proj: Projector): RadialGeom | null {
        const p = this.pts(proj);
        if (!p) return null;
        const R0 = Math.hypot(p.ex - p.cx, p.ey - p.cy);
        const phi = Math.atan2(p.ey - p.cy, p.ex - p.cx); // direction toward the far anchor
        return { cx: p.cx, cy: p.cy, R0, a0: phi - Math.PI / 2, a1: phi + Math.PI / 2 };
    }

    override boundingLines(proj: Projector): Array<[number, number, number, number]> {
        const p = this.pts(proj);
        return p ? [[p.cx, p.cy, p.ex, p.ey]] : []; // the pivot→far baseline
    }
}
