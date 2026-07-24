import type { Projector } from '../geometry';
import type { FibEntryLine } from './FibRatios';
import { FibRatios } from './FibRatios';
import { distToSegment } from '../hittest';

/** Center + base pixel radius + the arc sweep [a0, a1] shared by every concentric-ring fib tool. */
export interface RadialGeom {
    cx: number;
    cy: number;
    R0: number;
    a0: number;
    a1: number;
}

/** True if a cursor angle falls within the arc sweep [a0, a1] (a0 ≤ a1, going clockwise on canvas). */
export function angleInSweep(ang: number, a0: number, a1: number): boolean {
    if (a1 - a0 >= Math.PI * 2 - 1e-3) return true; // full circle
    let d = ang - a0;
    const TWO_PI = Math.PI * 2;
    while (d < 0) d += TWO_PI;
    while (d >= TWO_PI) d -= TWO_PI;
    return d <= a1 - a0 + 1e-6;
}

/**
 * Shared base for the concentric-ring Fibonacci tools (circles, arcs, wedge). Each is the
 * Circle-style hybrid: a data-anchored center with PIXEL-space radii (`R0 · ratio`). Subclasses
 * supply {@link radial} (center + base radius + angular sweep) and any {@link boundingLines};
 * the painter draws each enabled level as `ctx.arc(cx, cy, R0·ratio, a0, a1)`.
 */
export abstract class RadialFib extends FibRatios {
    /** Center, base pixel radius, and the arc sweep — null until enough anchors are placed. */
    abstract radial(proj: Projector): RadialGeom | null;

    /** Straight lines drawn alongside the rings (baseline / wedge rays); previewed before `radial` resolves. */
    boundingLines(_proj: Projector): Array<[number, number, number, number]> {
        return [];
    }

    // Ring tools hit-test by radius, not line segments → entryLines is unused (the painter dispatches
    // them to the arc branch). Satisfy the abstract with an empty set.
    entryLines(_proj: Projector): FibEntryLine[] | null {
        return [];
    }

    override hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const g = this.radial(proj);
        if (g) {
            const dist = Math.hypot(px - g.cx, py - g.cy);
            const ang = Math.atan2(py - g.cy, px - g.cx);
            if (angleInSweep(ang, g.a0, g.a1)) {
                for (const lv of this.levels) {
                    if (lv.enabled && Math.abs(dist - g.R0 * lv.ratio) <= tol) return true;
                }
            }
        }
        return this.boundingLines(proj).some((b) => distToSegment(px, py, b[0], b[1], b[2], b[3]) <= tol);
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }
}
