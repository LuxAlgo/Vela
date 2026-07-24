/**
 * A growable triangle batch: interleaved [x, y, r, g, b, a, edgeDist, edgeHalf] vertices in
 * CSS-pixel space, drawn by one per-vertex-color shader. Every primitive the geometry layer
 * needs decomposes into colored triangles here — and a vertical gradient is just a quad whose
 * top/bottom vertices carry different colors (the GPU interpolates it), so no gradient shader
 * is required.
 *
 * `edgeDist`/`edgeHalf` drive analytic line anti-aliasing: for a line segment they carry the
 * signed perpendicular distance from the centerline and the line's half-width, so the fragment
 * shader can feather the edge over ~1 device pixel (crisp, independent of the driver's MSAA).
 * All other primitives push `edgeHalf < 0` — the sentinel for a solid fill with no feathering.
 */
export type RGBA = readonly [number, number, number, number];

const FLOATS_PER_VERT = 8;
/** Perpendicular padding added to each side of a line quad so the ~1px edge feather has room. */
const AA_PAD = 1;

export class Batch {
    private buf: Float32Array;
    private n = 0; // floats used
    /** Alpha multiplier applied to every pushed vertex (1 = opaque) — lets a backend
     *  fade a group of primitives, e.g. indicator models during the intro reveal. */
    alpha = 1;

    constructor(capacityVerts = 4096) {
        this.buf = new Float32Array(capacityVerts * FLOATS_PER_VERT);
    }

    reset(): void {
        this.n = 0;
    }

    get vertexCount(): number {
        return this.n / FLOATS_PER_VERT;
    }

    get view(): Float32Array {
        return this.buf.subarray(0, this.n);
    }

    private ensure(verts: number): void {
        const need = this.n + verts * FLOATS_PER_VERT;
        if (need <= this.buf.length) return;
        let cap = this.buf.length || FLOATS_PER_VERT;
        while (cap < need) cap *= 2;
        const nb = new Float32Array(cap);
        nb.set(this.buf.subarray(0, this.n));
        this.buf = nb;
    }

    // `dist`/`half` default to the solid-fill sentinel (half < 0 ⇒ no edge feathering); only the
    // line builder passes real values, so every other primitive stays a crisp opaque fill.
    private v(x: number, y: number, c: RGBA, dist = 0, half = -1): void {
        const b = this.buf;
        let n = this.n;
        b[n++] = x;
        b[n++] = y;
        b[n++] = c[0];
        b[n++] = c[1];
        b[n++] = c[2];
        b[n++] = c[3] * this.alpha;
        b[n++] = dist;
        b[n++] = half;
        this.n = n;
    }

    /** Triangle with per-vertex color. */
    tri(x0: number, y0: number, c0: RGBA, x1: number, y1: number, c1: RGBA, x2: number, y2: number, c2: RGBA): void {
        this.ensure(3);
        this.v(x0, y0, c0);
        this.v(x1, y1, c1);
        this.v(x2, y2, c2);
    }

    /** Quad from 4 corners (any winding) with per-corner color → 2 triangles. */
    quad4(x0: number, y0: number, c0: RGBA, x1: number, y1: number, c1: RGBA, x2: number, y2: number, c2: RGBA, x3: number, y3: number, c3: RGBA): void {
        this.ensure(6);
        this.v(x0, y0, c0);
        this.v(x1, y1, c1);
        this.v(x2, y2, c2);
        this.v(x0, y0, c0);
        this.v(x2, y2, c2);
        this.v(x3, y3, c3);
    }

    /** Single-color quad from 4 corners. */
    quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGBA): void {
        this.quad4(x0, y0, c, x1, y1, c, x2, y2, c, x3, y3, c);
    }

    /** Axis-aligned rectangle. */
    rect(x: number, y: number, w: number, h: number, c: RGBA): void {
        this.quad(x, y, x + w, y, x + w, y + h, x, y + h, c);
    }

    /**
     * A line segment as a width-w quad (perpendicular expansion; no joins). The quad is padded by
     * {@link AA_PAD} on each side and every vertex carries its signed perpendicular distance from the
     * centerline + the half-width, so the fragment shader feathers the edge analytically (crisp,
     * MSAA-independent). The along-length butt caps are left hard (hidden at a polyline's joints).
     */
    seg(x0: number, y0: number, x1: number, y1: number, w: number, c: RGBA): void {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;
        const hw = w / 2;
        const ext = hw + AA_PAD; // outer edge of the padded quad
        const ex = (-dy / len) * ext;
        const ey = (dx / len) * ext;
        // + side (dist = +ext): corners at (x0,y0)+e and (x1,y1)+e;  − side (dist = −ext): −e
        const ax = x0 + ex, ay = y0 + ey;
        const bx = x1 + ex, by = y1 + ey;
        const cx = x1 - ex, cy = y1 - ey;
        const dxc = x0 - ex, dyc = y0 - ey;
        this.ensure(6);
        this.v(ax, ay, c, ext, hw);
        this.v(bx, by, c, ext, hw);
        this.v(cx, cy, c, -ext, hw);
        this.v(ax, ay, c, ext, hw);
        this.v(cx, cy, c, -ext, hw);
        this.v(dxc, dyc, c, -ext, hw);
    }

    /** A dashed/dotted/solid segment. `pattern` = [onPx, offPx] or null for solid. */
    dashedSeg(x0: number, y0: number, x1: number, y1: number, w: number, c: RGBA, pattern: readonly [number, number] | null): void {
        if (!pattern) {
            this.seg(x0, y0, x1, y1, w, c);
            return;
        }
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;
        const ux = dx / len;
        const uy = dy / len;
        const period = pattern[0] + pattern[1];
        if (period <= 0) {
            this.seg(x0, y0, x1, y1, w, c); // guard against a zero/negative pattern (no infinite loop)
            return;
        }
        let d = 0;
        while (d < len) {
            const on = Math.min(pattern[0], len - d);
            const a = d;
            const b = d + on;
            this.seg(x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b, w, c);
            d += period;
        }
    }

    /** The outline of an axis-aligned rectangle, stroked with width `lineWidth` (4 edge segments). */
    rectStroke(x: number, y: number, w: number, h: number, lineWidth: number, c: RGBA): void {
        this.seg(x, y, x + w, y, lineWidth, c); // top
        this.seg(x + w, y, x + w, y + h, lineWidth, c); // right
        this.seg(x + w, y + h, x, y + h, lineWidth, c); // bottom
        this.seg(x, y + h, x, y, lineWidth, c); // left
    }

    /** Filled circle (triangle fan). */
    circle(cx: number, cy: number, r: number, c: RGBA, segments = 16): void {
        let px = cx + r;
        let py = cy;
        for (let i = 1; i <= segments; i += 1) {
            const a = (i / segments) * Math.PI * 2;
            const nx = cx + Math.cos(a) * r;
            const ny = cy + Math.sin(a) * r;
            this.tri(cx, cy, c, px, py, c, nx, ny, c);
            px = nx;
            py = ny;
        }
    }
}
