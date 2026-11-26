import { Drawing, type AnchorSlot, type DrawingTypeKey, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { distToPolyline, handleAt } from '../hittest';
import type { DrawingShape, ShapeContext } from '../shapes';

/**
 * A drawing whose type is not registered on this page (saved by an app, or a plugin, that
 * is not loaded here). It keeps the saved record whole, so the document round-trips and the
 * drawing comes back as itself once its type is registered; meanwhile it shows as a dashed
 * outline of its points, so it can be found, moved and deleted.
 */
export class UnknownDrawing extends Drawing {
    readonly type: DrawingTypeKey;
    /** The saved per-type settings, untouched. Declared, not initialized: `readProps` fills
     *  it while the base constructor runs. */
    private declare saved: Record<string, unknown> | undefined;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        this.type = init.type ?? 'unknown';
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 0, max: this.anchors.length, slots: [] };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const pts = this.handlePoints(proj);
        if (pts.length === 1) return Math.hypot(px - pts[0]![0], py - pts[0]![1]) <= tol + 4;
        return distToPolyline(px, py, pts) <= tol;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const out: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            out.push([proj.xOf(a.time), y]);
        }
        return out;
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
        return null;
    }

    schema(): SettingsSchema {
        return { fields: [] };
    }

    override shapes(ctx: ShapeContext): DrawingShape[] {
        const stroke = { color: ctx.theme.text, width: 1, dash: 'dashed' as const };
        if (ctx.points.length === 1) return [{ kind: 'marker', at: ctx.points[0]!, shape: 'diamond', size: 9, stroke, fill: null, opacity: 0.7 }];
        return [{ kind: 'path', points: ctx.points, stroke, opacity: 0.7 }];
    }

    protected override writeProps(): Record<string, unknown> | undefined {
        return this.saved;
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.saved = props;
    }
}
