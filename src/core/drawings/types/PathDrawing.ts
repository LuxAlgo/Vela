import { type AnchorSlot } from '../Drawing';
import type { Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { SegmentDrawing } from './SegmentDrawing';

/** Cap on a path's point count — bounds freehand sampling and polyline clicks. */
export const MAX_PATH_POINTS = 512;

/**
 * Shared base for open multi-point paths (polyline, freehand). The geometry is the
 * run of segments between consecutive anchors (no fill); the count is variable
 * (`min` 2 → `max` {@link MAX_PATH_POINTS}), with every vertex free on both axes.
 * Subclasses set `type` and, for freehand, the placement mode + handle behavior.
 */
export abstract class PathDrawing extends SegmentDrawing {
    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: MAX_PATH_POINTS, slots: [] }; // variable count; vertices default to free 'both'
    }

    geometry(proj: Projector): SegmentGeometry | null {
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return null;
            pts.push([proj.xOf(a.time), y]);
        }
        if (pts.length < 2) return null;
        const segments: Array<[number, number, number, number]> = [];
        for (let i = 1; i < pts.length; i += 1) segments.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
        return { segments, fill: null };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
