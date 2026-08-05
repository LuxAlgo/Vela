import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { DrawingPoint, Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { defaultText } from '../style';
import { distToSegment, pointInBox, handleAt } from '../hittest';

/** Approximate px font size for a named text size (the painter measures the glyphs exactly). */
const SIZE_PX: Record<string, number> = { tiny: 10, small: 12, normal: 14, large: 18, huge: 24, auto: 14 };

/**
 * Shared rig for the two-anchor pinned-box annotations — a text box (anchor[1]) tied to a target
 * point (anchor[0]): Callout (speech bubble), Comment (rounded balloon), Price Note (leader + box),
 * Signpost (pole + plate). The geometry, hit-test, the pin-the-target body drag, and the schema are
 * common; subclasses set `type`, an optional `defaultLabel()`, and differ only in the painter.
 */
export abstract class CalloutBase extends Drawing {
    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        // `defaultLabel()` dispatches to the subclass (a prototype method, available during super()).
        // No color seed: the interactive creation path fixes a theme-contrast ink on the
        // fresh drawing; until then the painter auto-contrasts (`undefined` semantics).
        if (!this.text) this.text = defaultText(this.defaultLabel());
    }

    /** The placeholder text seeded for a fresh annotation. */
    protected defaultLabel(): string {
        return 'Callout';
    }

    /** The string used to size the approximate hit box (auto-text subclasses override it). */
    protected labelText(): string {
        return this.text?.value ?? this.defaultLabel();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // click the target (the pointer), move to position the box, click again to place it (default
        // 'click' placement) — so the box follows the cursor between the two clicks.
        return { min: 2, max: 2, slots: [{ role: 'target', free: 'both' }, { role: 'box', free: 'both' }] };
    }

    /** Approximate pixel box around the box anchor (the painter renders the precise glyphs). */
    box(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const c = this.anchors[1];
        if (!c) return null;
        const cy = proj.yOf(c.price, this.paneId);
        if (cy == null) return null;
        const fs = SIZE_PX[this.text?.size ?? 'normal'] ?? 14;
        const lines = this.labelText().split('\n');
        const cols = Math.max(1, ...lines.map((l) => l.length));
        const w = Math.max(20, cols * fs * 0.6) + 16;
        const h = lines.length * fs * 1.4 + 12;
        return { x: proj.xOf(c.time) - w / 2, y: cy - h / 2, w, h };
    }

    /** The target tip + box-center pixels (drives the painter, hit-test, and the tip handle). */
    points(proj: Projector): [[number, number], [number, number]] | null {
        const t = this.anchors[0];
        const c = this.anchors[1];
        if (!t || !c) return null;
        const ty = proj.yOf(t.price, this.paneId);
        const cy = proj.yOf(c.price, this.paneId);
        if (ty == null || cy == null) return null;
        return [
            [proj.xOf(t.time), ty],
            [proj.xOf(c.time), cy],
        ];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const b = this.box(proj);
        if (b && pointInBox(px, py, b.x, b.y, b.x + b.w, b.y + b.h, tol)) return true; // the box body
        const p = this.points(proj);
        return p != null && distToSegment(px, py, p[0][0], p[0][1], p[1][0], p[1][1]) <= tol; // the tail/leader
    }

    /** Only the pointer tip is a draggable handle — the box is moved by dragging its body, so no
     *  handle dot sits over the text. */
    handlePoints(proj: Projector): Array<[number, number]> {
        const p = this.points(proj);
        return p ? [p[0]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    /** A body drag moves only the box; the pointer tip stays pinned at its target. */
    override translateBody(dt: number, dp: number, orig: DrawingPoint[]): DrawingPoint[] {
        const t = orig[0];
        const b = orig[1];
        if (!t || !b) return orig.map((o) => ({ time: o.time + dt, price: o.price + dp }));
        return [
            { time: t.time, price: t.price },
            { time: b.time + dt, price: b.price + dp },
        ];
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        return this.box(proj); // float the settings popup beside the text box
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS], textIsContent: true };
    }
}
