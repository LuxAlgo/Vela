import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS } from '../schema';
import { distToPolyline, handleAt } from '../hittest';

/**
 * Shared base for the pattern tools (harmonic XABCD / ABCD, Elliott waves, head &
 * shoulders): a fixed-vertex polyline whose anchors are labelled, optionally tinted,
 * and optionally annotated with consecutive-leg ratios. Each subclass only supplies its
 * vertex labels (which fix the anchor count) and toggles ratios / fill / neckline.
 */
export abstract class PatternDrawing extends Drawing {
    /** The label drawn at each anchor (empty string ⇒ no label). Its length is the vertex count. */
    abstract vertexLabels(): readonly string[];
    /** Show consecutive-leg retracement ratios (harmonic patterns). */
    legRatios(): boolean {
        return false;
    }
    /** Vertex-index triples to tint (the harmonic body), or none. */
    fillTriangles(): ReadonlyArray<readonly [number, number, number]> {
        return [];
    }
    /** Two vertex indices whose line is drawn as an extended neckline (head & shoulders), or null. */
    necklineIndices(): readonly [number, number] | null {
        return null;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        const n = this.vertexLabels().length;
        const slots: AnchorSlot[] = [];
        for (let i = 0; i < n; i += 1) slots.push({ role: `p${i}`, free: 'both' });
        return { min: n, max: n, slots };
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            pts.push([proj.xOf(a.time), y]);
        }
        return pts;
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const pts = this.handlePoints(proj);
        return pts.length >= 2 && distToPolyline(px, py, pts) <= tol;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const pts = this.handlePoints(proj);
        if (pts.length === 0) return null;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    // ── harmonic validation hooks (overridden by HarmonicPattern; null = not a validated pattern) ──
    /** The harmonic pattern's name (drawn as a badge), or null for a plain pattern. */
    patternName(): string | null {
        return null;
    }
    /** Whether the leg ratio shown at vertex `i` is within the pattern's ideal band (null = no rule). */
    ratioOk(_i: number): boolean | null {
        return null;
    }
    /** Whether ALL the pattern's defining ratios are satisfied (null = not enough points / not harmonic). */
    valid(): boolean | null {
        return null;
    }

    /** Consecutive-leg ratio at vertex `i` (≥2): |leg(i-1,i)| / |leg(i-2,i-1)| in price. */
    ratioAt(i: number): number | null {
        const a = this.anchors[i - 2];
        const b = this.anchors[i - 1];
        const c = this.anchors[i];
        if (!a || !b || !c) return null;
        const prev = Math.abs(b.price - a.price);
        return prev < 1e-9 ? null : Math.abs(c.price - b.price) / prev;
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...(this.fillTriangles().length ? FILL_FIELDS : [])] };
    }
}
