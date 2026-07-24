import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * A parallel channel: a baseline through p1→p2 plus a second line parallel to it.
 * The offset is a constant PRICE delta measured at the baseline MIDPOINT (so it's
 * scale-aware AND the third handle always sits on the channel — only the 3rd
 * anchor's price matters, never its time, which keeps the handle from drifting off
 * to one side after editing). The offset handle is rendered at that midpoint.
 */
export class ParallelChannel extends SegmentDrawing {
    readonly type = 'parallelchannel' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'p1', free: 'both' },
                { role: 'p2', free: 'both' },
                { role: 'offset', free: 'y' }, // width only — drag the midpoint handle vertically
            ],
        };
    }

    /** Price delta of the parallel line from the baseline, measured at the midpoint. */
    private offset(): number {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b || !c) return 0;
        return c.price - (a.price + b.price) / 2; // baseline price at the midpoint time
    }

    /** Handles: the two baseline ends + the offset handle ON the parallel line at the midpoint. */
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
            const yc = proj.yOf(c.price, this.paneId); // c.price IS the parallel-line price at the midpoint
            if (yc != null) pts.push([proj.xOf((a.time + b.time) / 2), yc]);
        }
        return pts;
    }

    /** The channel spans the baseline's time only (the offset anchor's time is ignored). */
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
        const d = this.offset();
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        const ya2 = proj.yOf(a.price + d, this.paneId);
        const yb2 = proj.yOf(b.price + d, this.paneId);
        if (ya == null || yb == null || ya2 == null || yb2 == null) return null;
        return {
            segments: [
                [xa, ya, xb, yb],
                [xa, ya2, xb, yb2],
            ],
            fill: [
                [xa, ya],
                [xb, yb],
                [xb, yb2],
                [xa, ya2],
            ],
        };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const d = this.offset();
        const prices = [a.price, b.price, a.price + d, b.price + d];
        const c = this.anchors[2];
        if (c) prices.push(c.price);
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
