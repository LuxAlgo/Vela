import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * A disjoint channel: two independent line segments (top p1→p2, bottom p3→p4) with
 * an optional fill between them. Unlike a parallel channel, the two lines need not
 * be parallel — every corner is free.
 */
export class DisjointChannel extends SegmentDrawing {
    readonly type = 'disjointchannel' as const;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 4,
            max: 4,
            slots: [
                { role: 'top1', free: 'both' },
                { role: 'top2', free: 'both' },
                { role: 'bot1', free: 'both' },
                { role: 'bot2', free: 'both' },
            ],
        };
    }

    private seg(i: number, j: number, proj: Projector): [number, number, number, number] | null {
        const a = this.anchors[i];
        const b = this.anchors[j];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        return [proj.xOf(a.time), ya, proj.xOf(b.time), yb];
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const top = this.seg(0, 1, proj);
        const bot = this.seg(2, 3, proj);
        const segments = [top, bot].filter((s): s is [number, number, number, number] => s != null);
        if (segments.length === 0) return null;
        const fill: Array<[number, number]> | null =
            top && bot
                ? [
                      [top[0], top[1]],
                      [top[2], top[3]],
                      [bot[2], bot[3]],
                      [bot[0], bot[1]],
                  ]
                : null;
        return { segments, fill };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
