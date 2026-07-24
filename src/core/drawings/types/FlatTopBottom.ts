import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * A flat top/bottom channel: a sloped baseline p1→p2 plus a FLAT (horizontal) side at a constant
 * price (p3's price). Only p3's price is used — its time is ignored, and the flat side always spans
 * the baseline's time range. Optional fill between the two sides.
 */
export class FlatTopBottom extends SegmentDrawing {
    readonly type = 'flattopbottom' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'p1', free: 'both' },
                { role: 'p2', free: 'both' },
                { role: 'flat', free: 'y' }, // only the flat side's price matters
            ],
        };
    }

    /** Handles: the two baseline ends + the flat-side handle at the baseline midpoint. */
    override handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return [];
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return [];
        const pts: Array<[number, number]> = [
            [proj.xOf(a.time), ya],
            [proj.xOf(b.time), yb],
        ];
        const c = this.anchors[2];
        if (c) {
            const yc = proj.yOf(c.price, this.paneId);
            if (yc != null) pts.push([proj.xOf((a.time + b.time) / 2), yc]);
        }
        return pts;
    }

    /** The channel spans the baseline's time only (the flat anchor's time is ignored). */
    override timeExtent(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.time, b.time), max: Math.max(a.time, b.time) };
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        const c = this.anchors[2];
        if (!c) return { segments: [[xa, ya, xb, yb]], fill: null }; // baseline only (placing)
        const flatY = proj.yOf(c.price, this.paneId);
        if (flatY == null) return null;
        return {
            segments: [
                [xa, ya, xb, yb], // sloped side
                [xa, flatY, xb, flatY], // flat side (constant price)
            ],
            fill: [
                [xa, ya],
                [xb, yb],
                [xb, flatY],
                [xa, flatY],
            ],
        };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const prices = [a.price, b.price];
        const c = this.anchors[2];
        if (c) prices.push(c.price);
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
