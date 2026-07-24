import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { TEXT_FIELDS } from '../schema';
import { handleAt } from '../hittest';

/** The selectable glyph set (monochrome symbols tint with the stamp color). */
export const GLYPH_OPTIONS = ['★', '☆', '●', '◆', '▲', '▼', '➤', '⚑', '✚', '✕', '❤', '♦'] as const;

/** Named stamp sizes + their on-screen px (constant — the stamp never scales with zoom). */
export const STAMP_SIZE_OPTIONS = ['small', 'normal', 'large', 'huge'] as const;
const STAMP_PX: Record<string, number> = { small: 16, normal: 22, large: 32, huge: 44 };

/**
 * A single-anchor glyph/icon stamp: a fixed-pixel unicode symbol drawn at one point (centered on
 * the anchor), never scaling with zoom. The glyph + size are per-instance props chosen from {@link
 * GLYPH_OPTIONS} / {@link STAMP_SIZE_OPTIONS}; subclasses set `type` + the default glyph. Mirrors
 * the ArrowMark stamp rig.
 */
export abstract class GlyphStamp extends Drawing {
    // no initializers — a field initializer runs after super() and would clobber readProps()
    glyph!: string;
    size!: string;

    protected abstract defaultGlyph(): string;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.glyph) this.glyph = this.defaultGlyph();
        if (!this.size) this.size = 'normal';
    }

    /** The on-screen glyph size in px for the current named size. */
    sizePx(): number {
        return STAMP_PX[this.size] ?? STAMP_PX.normal!;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'both' }] };
    }

    /** The anchor pixel (the glyph box is sizePx() square, centered here). */
    center(proj: Projector): [number, number] | null {
        const a = this.anchors[0];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? null : [proj.xOf(a.time), y];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const c = this.center(proj);
        if (!c) return false;
        const r = this.sizePx() / 2 + tol;
        return Math.abs(px - c[0]) <= r && Math.abs(py - c[1]) <= r;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const c = this.center(proj);
        return c ? [c] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const c = this.center(proj);
        if (!c) return null;
        const s = this.sizePx();
        return { x: c[0] - s / 2, y: c[1] - s / 2, w: s, h: s };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }

    schema(): SettingsSchema {
        return {
            fields: [
                { path: 'glyph', label: 'Icon', kind: 'select', options: GLYPH_OPTIONS.map((g) => ({ value: g, label: g })), group: 'line' },
                { path: 'size', label: 'Size', kind: 'select', options: STAMP_SIZE_OPTIONS.map((s) => ({ value: s, label: s })), group: 'line' },
                { path: 'style.lineColor', label: 'Color', kind: 'color', group: 'line' },
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { glyph: this.glyph, size: this.size };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.glyph === 'string') this.glyph = props.glyph;
        if (typeof props.size === 'string') this.size = props.size;
    }
}

/** A flag marker stamp. */
export class FlagMark extends GlyphStamp {
    readonly type = 'flagmark' as const;
    protected defaultGlyph(): string {
        return '⚑';
    }
}

/** A general icon stamp (glyph chosen from the picker). */
export class IconStamp extends GlyphStamp {
    readonly type = 'iconstamp' as const;
    protected defaultGlyph(): string {
        return '★';
    }
}
