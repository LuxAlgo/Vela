import { msg } from '../../i18n/message';
import type { Translator } from '../../i18n/types';
import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import { measureLines } from '../measureText';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_SIZE_OPTIONS } from '../schema';
import { pointInBox, handleAt } from '../hittest';

/** A compact duration string for a millisecond span (e.g. "2d 4h", "3h 15m"). */
export function formatDuration(ms: number): string {
    const m = Math.abs(ms);
    const DAY = 86400000;
    const HR = 3600000;
    const MIN = 60000;
    if (m >= DAY) {
        const d = Math.floor(m / DAY);
        const h = Math.round((m % DAY) / HR);
        return h ? `${d}d ${h}h` : `${d}d`;
    }
    if (m >= HR) {
        const h = Math.floor(m / HR);
        const mn = Math.round((m % HR) / MIN);
        return mn ? `${h}h ${mn}m` : `${h}h`;
    }
    if (m >= MIN) return `${Math.round(m / MIN)}m`;
    return `${Math.round(m / 1000)}s`;
}

/**
 * The measurement box (the persistent Date & Price Range drawing): a two-corner box
 * tinted green/red by direction, with a centered label of the price delta and/or the
 * date delta. Each line is toggled via `showPrice` / `showDate` in settings, and the
 * label is styled by the drawing's `text` color/size — so the one tool covers the
 * price-only, date-only, and combined cases.
 */
export abstract class MeasureBox extends Drawing {
    // Declared with `!` (no initializer) so a field default never clobbers readProps, which the
    // base constructor runs before subclass fields would initialize. Defaulted below after super().
    /** Show the `Δprice (Δ%)` line. */
    showPrice!: boolean;
    /** Show the `N bars, duration` line. */
    showDate!: boolean;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.showPrice === undefined) this.showPrice = true;
        if (this.showDate === undefined) this.showDate = true;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
    // sets the opposite one — consistent with the box/Gann tools.

    /** The measurement lines, filtered by the enabled toggles, in `i18n`'s language
     *  (English without one): the headline, then the quieter detail line. */
    measureLabel(proj: Projector, i18n?: Translator): string[] {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return [];
        return measureLines(a, b, proj, this.paneId, i18n, { price: this.showPrice, time: this.showDate });
    }

    /** Up (later price ≥ earlier) → green; else red. */
    isUp(): boolean {
        const a = this.anchors[0];
        const b = this.anchors[1];
        return a != null && b != null && b.price >= a.price;
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
        return r != null && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2, tol); // shaded box → grabbable anywhere inside
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const r = this.rect(proj);
        return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const r = this.rect(proj);
        if (!r) return null;
        return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
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
                { path: 'showPrice', label: msg('drawing.measure.showPrice', 'Show price'), kind: 'boolean', group: 'behavior' },
                { path: 'showDate', label: msg('drawing.measure.showDate', 'Show date'), kind: 'boolean', group: 'behavior' },
                ...LINE_FIELDS.filter((f) => f.path !== 'style.lineColor'), // box border (the fill is direction-tinted)
                { path: 'text.color', label: msg('drawing.field.textColor', 'Text color'), kind: 'color', group: 'text' },
                { path: 'text.size', label: msg('drawing.field.textSize', 'Text size'), kind: 'select', options: TEXT_SIZE_OPTIONS, group: 'text' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { showPrice: this.showPrice, showDate: this.showDate };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.showPrice === 'boolean') this.showPrice = props.showPrice;
        if (typeof props.showDate === 'boolean') this.showDate = props.showDate;
    }
}
