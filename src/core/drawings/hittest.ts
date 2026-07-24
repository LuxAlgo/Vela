/**
 * Pure hit-test geometry for user drawings. Lives in core (not `renderers/`)
 * because {@link Drawing} hit-test methods consume it and core must not import
 * from a renderer. All inputs/outputs are media pixels; no DOM, no canvas.
 */

/** Distance from point (px,py) to the segment (ax,ay)→(bx,by). */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay); // degenerate segment → point
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a polyline (min over its segments); ∞ for <2 points. */
export function distToPolyline(px: number, py: number, pts: ReadonlyArray<readonly [number, number]>): number {
    let best = Infinity;
    for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const d = distToSegment(px, py, a[0], a[1], b[0], b[1]);
        if (d < best) best = d;
    }
    return best;
}

/** Whether (px,py) lies inside the axis-aligned box, expanded by `pad` px. */
export function pointInBox(px: number, py: number, x1: number, y1: number, x2: number, y2: number, pad = 0): boolean {
    const lo = Math.min(x1, x2) - pad;
    const hi = Math.max(x1, x2) + pad;
    const top = Math.min(y1, y2) - pad;
    const bot = Math.max(y1, y2) + pad;
    return px >= lo && px <= hi && py >= top && py <= bot;
}

/** Whether (px,py) is within `r` px of the circle centered at (cx,cy). */
export function pointInCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
    return Math.hypot(px - cx, py - cy) <= r;
}

/** Ray-casting point-in-polygon (for filled channel/shape interiors). <3 points ⇒ false. */
export function pointInPolygon(px: number, py: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
        const a = poly[i]!;
        const b = poly[j]!;
        const intersect = a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0];
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Where the infinite line through (lx1,ly1)→(lx2,ly2) crosses the segment (ax,ay)→(bx,by),
 * or null if they're parallel or the crossing falls outside the segment. Used to clip a
 * head-and-shoulders neckline to where it meets the pattern's outer legs.
 */
export function lineSegmentIntersection(
    lx1: number,
    ly1: number,
    lx2: number,
    ly2: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): [number, number] | null {
    const dx = lx2 - lx1;
    const dy = ly2 - ly1;
    const ex = bx - ax;
    const ey = by - ay;
    const denom = ex * dy - ey * dx;
    if (Math.abs(denom) < 1e-9) return null; // parallel
    const s = ((ay - ly1) * dx - (ax - lx1) * dy) / denom; // segment param at the crossing
    if (s < 0 || s > 1) return null; // crossing is beyond the segment's endpoints
    return [ax + s * ex, ay + s * ey];
}

/**
 * Index of the handle within `rad` px of (px,py), else -1. Handles are tested in
 * order; the first match wins (callers pass them in priority order).
 */
export function handleAt(px: number, py: number, handles: ReadonlyArray<readonly [number, number]>, rad = 6): number {
    for (let i = 0; i < handles.length; i += 1) {
        const h = handles[i]!;
        if (Math.hypot(px - h[0], py - h[1]) <= rad) return i;
    }
    return -1;
}

/**
 * Extend a segment p1→p2 to the chart edges per Pine-style `extend`. Returns the
 * endpoints to stroke (left→right not guaranteed; arrowheads use the originals).
 * Mirrors `renderers/shared/drawing-geometry.extendEndpoints` but lives in core
 * so a drawing's hit-test can extend without importing from a renderer.
 */
export function extendRay(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    extend: 'none' | 'left' | 'right' | 'both',
    width: number,
    height: number,
): [number, number, number, number] {
    if (extend === 'none') return [x1, y1, x2, y2];
    const dx = x2 - x1;
    const left = extend === 'left' || extend === 'both';
    const right = extend === 'right' || extend === 'both';
    if (Math.abs(dx) < 1e-6) {
        // Vertical: extend runs along the line itself.
        if (left && right) return [x1, 0, x2, height];
        const downward = y2 >= y1;
        if (right) return downward ? [x1, y1, x2, height] : [x1, y1, x2, 0];
        return downward ? [x1, 0, x2, y2] : [x1, height, x2, y2];
    }
    const slope = (y2 - y1) / dx;
    const yAt = (x: number): number => y1 + slope * (x - x1);
    const lx = left ? -2 : Math.min(x1, x2);
    const rx = right ? width + 2 : Math.max(x1, x2);
    return [lx, yAt(lx), rx, yAt(rx)];
}
