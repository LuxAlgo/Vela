import { msg } from '../../i18n/message';
import type { LineStyle } from '../../model/series';
import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { DrawingPoint, Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { TEXT_FIELDS, BORDER_FIELDS, LINE_STYLE_OPTIONS } from '../schema';
import { distToSegment, handleAt, pointInBox } from '../hittest';

/** A rectangle's own settings (round-trip through `props`). */
export interface BoxSettings {
    /** A line at the halfway price between the top and the bottom. */
    midline: boolean;
    /** The midline's color; absent = the border color, followed as it changes. */
    midColor?: string;
    midStyle: LineStyle;
}

function defaults(): BoxSettings {
    return { midline: false, midStyle: 'dashed' };
}

const LINE_STYLES = new Set<string>(LINE_STYLE_OPTIONS.map((o) => o.value));
const MIDLINE_ON = { path: 'box.midline', in: [true] } as const;

/**
 * A rectangle defined by two opposite corners. Optional fill + border, and an optional midline
 * at the halfway price.
 *
 * Eight handles: the two anchor corners (0, 1), the other two corners (2, 3), then the edge
 * midpoints (4–7). Corners resize both ways; an edge handle moves only its own side.
 */
export class Box extends Drawing {
    readonly type = 'box' as const;
    declare box: BoxSettings;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.box) this.box = defaults();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    private rect(proj: Projector): { x1: number; y1: number; x2: number; y2: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const r = this.rect(proj);
        if (!r) return false;
        // A filled box is grabbable anywhere inside; otherwise only near its border.
        if (this.style.fillColor && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
        const edges: Array<[number, number, number, number]> = [
            [r.x1, r.y1, r.x2, r.y1],
            [r.x2, r.y1, r.x2, r.y2],
            [r.x2, r.y2, r.x1, r.y2],
            [r.x1, r.y2, r.x1, r.y1],
        ];
        return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const r = this.rect(proj);
        if (!r) return [];
        const mx = (r.x1 + r.x2) / 2;
        const my = (r.y1 + r.y2) / 2;
        // The anchor corners stay first: the painter and the label read the box from points 0 and 1.
        return [
            [r.x1, r.y1],
            [r.x2, r.y2],
            [r.x2, r.y1],
            [r.x1, r.y2],
            [mx, r.y1],
            [r.x2, my],
            [mx, r.y2],
            [r.x1, my],
        ];
    }

    override dragHandle(index: number, pt: DrawingPoint): void {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return;
        // Which anchor supplies each handle's x (time) and y (price); null = that axis stays put.
        const map: Array<[DrawingPoint | null, DrawingPoint | null]> = [
            [a, a],
            [b, b],
            [b, a],
            [a, b],
            [null, a],
            [b, null],
            [null, b],
            [a, null],
        ];
        const [tx, ty] = map[index] ?? [null, null];
        if (tx) tx.time = pt.time;
        if (ty) ty.price = pt.price;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const r = this.rect(proj);
        if (!r) return null;
        return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
    }

    /**
     * The midline in pixels — at the halfway PRICE between the two corners (not the pixel
     * middle, so it stays true on a log scale), across the box's full width — with its color
     * (the border's unless one was picked) and style. Null while the midline is off.
     */
    midline(proj: Projector): { x1: number; x2: number; y: number; color: string; lineStyle: LineStyle } | null {
        if (!this.box.midline) return null;
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const y = proj.yOf((a.price + b.price) / 2, this.paneId);
        if (y == null) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        return { x1: Math.min(xa, xb), x2: Math.max(xa, xb), y, color: this.box.midColor || this.style.lineColor, lineStyle: this.box.midStyle };
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
                ...BORDER_FIELDS,
                { path: 'style.fillColor', label: msg('drawing.box.fillColor', 'Fill color'), kind: 'color', group: 'fill' },
                { path: 'box.midline', label: msg('drawing.box.midline', 'Midline'), kind: 'boolean', group: 'line' },
                { path: 'box.midColor', label: msg('drawing.box.midlineColor', 'Midline color'), kind: 'color', group: 'line', when: MIDLINE_ON, fallback: 'style.lineColor' },
                { path: 'box.midStyle', label: msg('drawing.box.midlineStyle', 'Midline style'), kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line', when: MIDLINE_ON },
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        const { midline, midColor, midStyle } = this.box;
        // An unpicked color stays absent, so the midline keeps following the border.
        return midColor ? { midline, midColor, midStyle } : { midline, midStyle };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const d = defaults();
        const p = props as Partial<BoxSettings>;
        this.box = {
            midline: typeof p.midline === 'boolean' ? p.midline : d.midline,
            midStyle: typeof p.midStyle === 'string' && LINE_STYLES.has(p.midStyle) ? p.midStyle : d.midStyle,
        };
        if (typeof p.midColor === 'string' && p.midColor) this.box.midColor = p.midColor;
    }
}
