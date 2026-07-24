import { Drawing } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import { distToSegment, handleAt, pointInPolygon } from '../hittest';

/**
 * Shared base for multi-line drawings (channels, pitchfork). The line math lives in
 * one place — the abstract {@link geometry} (pixel segments + optional fill) — and
 * hit-testing, handle positions, and bounds all derive from it + the anchors.
 * Subclasses supply `type`, `anchorSchema`, `geometry`, `priceRange`, and `schema`.
 */
export abstract class SegmentDrawing extends Drawing {
    /** Pixel line segments + optional fill polygon (consumed by hit-test AND the painter). */
    abstract geometry(proj: Projector): SegmentGeometry | null;

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const g = this.geometry(proj);
        if (!g) return false;
        if (this.style.fillColor && g.fill && pointInPolygon(px, py, g.fill)) return true;
        return g.segments.some((s) => distToSegment(px, py, s[0], s[1], s[2], s[3]) <= tol);
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
}
