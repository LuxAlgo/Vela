import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { pointInBox, handleAt } from '../hittest';

/** Allowed max-curvature presets shown in the settings dropdown. */
export const DEDEKIND_CURVATURE_OPTIONS = [4, 8, 12, 16, 24, 32, 48, 64] as const;

const DEFAULT_MAX_CURVATURE = 24;
const MIN_ARC_PX = 0.75; // cull semicircles smaller than this

/**
 * Whether k/n is the center of a Dedekind circle of curvature n (radius 1/n),
 * per Kocik's algebraic characterization (arXiv:1912.05768).
 */
export function isDedekindCenter(k: number, n: number): boolean {
    if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0) return false;
    const k2m1 = k * k - 1;
    if (n % 2 === 1) return k2m1 % n === 0;
    if (n % 8 === 0) {
        if (k2m1 % n !== 0) return false;
        return (k2m1 / n) % 2 !== 0; // quotient must be odd
    }
    return false;
}

/** Numerators k ∈ [0, n) whose circles of curvature n sit in the unit interval [0, 1). */
export function dedekindCentersInUnit(n: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k += 1) {
        if (isDedekindCenter(k, n)) out.push(k);
    }
    return out;
}

/** Pixel-space layout of the placed box + the hyperbolic-plane scale used inside it. */
export interface DedekindBox {
    left: number;
    right: number;
    top: number;
    bot: number;
    /** Pixels per hyperbolic unit — chosen so the unit semicircle (r = 1) reaches the box top. */
    unitPx: number;
    /** Real-axis start (math) mapped to `left`. */
    x0: number;
    /** Real-axis span covered by the box width. */
    realSpan: number;
}

export type DedekindGeom =
    | { kind: 'arc'; cx: number; cy: number; r: number }
    | { kind: 'vline'; x: number; y0: number; y1: number };

/**
 * Dedekind tessellation — the modular-group tiling of the upper half-plane, drawn as the
 * Dedekind circles (semicircles on the real axis + vertical geodesics at half-integers).
 *
 * Two corners define a time×price box: the bottom edge is the real axis, the box is the
 * visible domain (geometry is clipped to it). Density is controlled by {@link maxCurvature}.
 */
export class DedekindTessellation extends Drawing {
    readonly type = 'dedekind' as const;

    /** Max circle curvature n (denominators 1…n). Higher → denser tessellation. */
    maxCurvature!: number;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.maxCurvature === undefined) this.maxCurvature = DEFAULT_MAX_CURVATURE;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    /** Pixel box + isotropic hyperbolic scale (null until both corners resolve). */
    box(proj: Projector): DedekindBox | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        const left = Math.min(proj.xOf(a.time), proj.xOf(b.time));
        const right = Math.max(proj.xOf(a.time), proj.xOf(b.time));
        const top = Math.min(ya, yb);
        const bot = Math.max(ya, yb);
        const w = right - left;
        const h = bot - top;
        if (w < 1 || h < 1) return null;
        // Unit semicircle (r = 1) reaches the top of the box; real span follows the aspect ratio.
        const unitPx = h;
        const realSpan = w / unitPx;
        return { left, right, top, bot, unitPx, x0: 0, realSpan };
    }

    /**
     * Semicircles + vertical geodesics in media pixels, already culled to the box.
     * Verticals are at every half-integer (Kocik case B); arcs use curvatures 1…maxCurvature.
     */
    geodesics(proj: Projector): DedekindGeom[] | null {
        const box = this.box(proj);
        if (!box) return null;
        const { left, top, bot, unitPx, x0, realSpan } = box;
        const maxN = Math.max(1, Math.min(64, Math.round(this.maxCurvature)));
        const xMin = x0 - 1 / maxN; // pad so edge arcs aren't clipped away early
        const xMax = x0 + realSpan + 1 / maxN;
        const right = left + realSpan * unitPx;
        const out: DedekindGeom[] = [];

        // Vertical geodesics at half-integers (x = k/2, k odd).
        const k0 = Math.floor(xMin * 2);
        const k1 = Math.ceil(xMax * 2);
        for (let k = k0; k <= k1; k += 1) {
            if (k % 2 === 0) continue; // only odd k
            const x = left + (k / 2 - x0) * unitPx;
            if (x < left - 0.5 || x > right + 0.5) continue;
            out.push({ kind: 'vline', x, y0: bot, y1: top });
        }

        // Dedekind semicircles: centers k/n + ℤ, radius 1/n.
        for (let n = 1; n <= maxN; n += 1) {
            const r = 1 / n;
            const rPx = r * unitPx;
            if (rPx < MIN_ARC_PX) continue;
            const ks = dedekindCentersInUnit(n);
            if (ks.length === 0) continue;
            const tLo = Math.floor(xMin) - 1;
            const tHi = Math.ceil(xMax) + 1;
            for (let t = tLo; t <= tHi; t += 1) {
                for (const k of ks) {
                    const c = k / n + t;
                    // Skip if the semicircle's diameter misses the visible real span entirely.
                    if (c + r < xMin || c - r > xMax) continue;
                    const cx = left + (c - x0) * unitPx;
                    if (cx + rPx < left - 1 || cx - rPx > right + 1) continue;
                    out.push({ kind: 'arc', cx, cy: bot, r: rPx });
                }
            }
        }
        return out;
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const b = this.box(proj);
        return b != null && pointInBox(px, py, b.left, b.top, b.right, b.bot, tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const b = this.box(proj);
        return b ? [[b.left, b.top], [b.right, b.bot]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const b = this.box(proj);
        if (!b) return null;
        return { x: b.left, y: b.top, w: b.right - b.left, h: b.bot - b.top };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                {
                    path: 'maxCurvature',
                    label: 'Max curvature',
                    kind: 'number',
                    min: 4,
                    max: 64,
                    step: 4,
                    group: 'behavior',
                },
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { maxCurvature: this.maxCurvature };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.maxCurvature === 'number' && Number.isFinite(props.maxCurvature)) {
            this.maxCurvature = Math.max(1, Math.min(64, Math.round(props.maxCurvature)));
        }
    }
}
