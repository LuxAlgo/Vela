import type { Projector } from '../geometry';
import { distToSegment, extendRay } from '../hittest';
import { TwoPointLine } from './TwoPointLine';

/** A straight line through two anchors, extended to both chart edges. */
export class ExtendedLine extends TwoPointLine {
    readonly type = 'extendedline' as const;

    override hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const p = this.pixels(proj);
        if (!p) return false;
        const [ex1, ey1, ex2, ey2] = extendRay(p[0], p[1], p[2], p[3], 'both', proj.width, proj.height);
        return distToSegment(px, py, ex1, ey1, ex2, ey2) <= tol;
    }

    // Spans the full width in both directions → never cull by time.
    override timeExtent(): { min: number; max: number } | null {
        return null;
    }
}
