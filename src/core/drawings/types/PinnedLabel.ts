import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import { handleAt, pointInBox } from '../hittest';

/** Approximate px font size for a named text size (the painter measures the glyphs exactly). */
const SIZE_PX: Record<string, number> = { tiny: 10, small: 12, normal: 14, large: 18, huge: 24, auto: 14 };

/**
 * A one-anchor, price-pinned label — the shared base for plain Text, a Note plate, and a Price
 * Label tag. Subclasses supply `type`, `schema()`, an optional `defaultLabel()`/`labelText()`, and
 * (when they paint a body) a painter branch; the anchor geometry, hit-test, handle, bounds, and
 * price range are all common.
 */
export abstract class PinnedLabel extends Drawing {
    /** The placeholder string when no text has been entered yet. */
    protected defaultLabel(): string {
        return 'Text';
    }

    /** The string used to size the approximate hit box (subclasses with computed text override it). */
    protected labelText(): string {
        return this.text?.value ?? this.defaultLabel();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'both' }] };
    }

    /** Approximate pixel box of the label (the painter renders the precise glyphs). */
    protected box(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const a = this.anchors[0];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        if (y == null) return null;
        const fs = SIZE_PX[this.text?.size ?? 'normal'] ?? 14;
        const lines = this.labelText().split('\n');
        const cols = Math.max(1, ...lines.map((l) => l.length));
        return { x: proj.xOf(a.time), y, w: Math.max(12, cols * fs * 0.6) + 8, h: lines.length * fs * 1.4 + 4 };
    }

    hitTest(px: number, py: number, proj: Projector, _tol: number): boolean {
        const b = this.box(proj);
        return b != null && pointInBox(px, py, b.x, b.y, b.x + b.w, b.y + b.h);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const y = a ? proj.yOf(a.price, this.paneId) : null;
        return a && y != null ? [[proj.xOf(a.time), y]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        return this.box(proj);
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }
}
