import type { Projector } from '../geometry';
import { PathDrawing } from './PathDrawing';

/**
 * Shared base for captured freehand strokes (brush, highlighter): press, drag to
 * capture the sampled path, release to finish. A stroke has too many points to edit
 * per-vertex, so it shows no handles and moves as a whole (its bounds come from the
 * captured path, for the settings-popup anchor). Subclasses set `type` (+ any style
 * schema); the placement/handle/bounds behavior is identical across them.
 */
export abstract class BrushStroke extends PathDrawing {
    override placementMode(): 'click' | 'freehand' {
        return 'freehand';
    }

    override handlePoints(_proj: Projector): Array<[number, number]> {
        return []; // a captured stroke is moved as a whole, not edited per-point
    }

    override bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) continue;
            xs.push(proj.xOf(a.time));
            ys.push(y);
        }
        if (xs.length === 0) return null;
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
}

/** A freehand brush stroke — a solid, thin captured line in the drawing's color. */
export class Freehand extends BrushStroke {
    readonly type = 'freehand' as const;
}
