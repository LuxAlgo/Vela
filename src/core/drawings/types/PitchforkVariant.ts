import { type AnchorSlot } from '../Drawing';
import type { DrawingPoint, Projector, SegmentGeometry } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { extendRay } from '../hittest';
import { SegmentDrawing } from './SegmentDrawing';

/**
 * Shared base for the Schiff pitchfork family. Identical to an Andrews' pitchfork —
 * median through M = midpoint(p2, p3), tines through p2/p3 parallel to it, base line
 * p2–p3 — except the median STARTS at a shifted origin S (computed in data space by
 * each subclass) instead of the pivot p1. The tines track the new median direction, and a
 * construction line p1–p2 keeps the pivot attached to the shape.
 */
export abstract class PitchforkVariant extends SegmentDrawing {
    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'pivot', free: 'both' },
                { role: 'upper', free: 'both' },
                { role: 'lower', free: 'both' },
            ],
        };
    }

    /** The median's start point, in DATA space (time+price), derived from the three anchors. */
    protected abstract medianStart(p0: DrawingPoint, p1: DrawingPoint, p2: DrawingPoint): DrawingPoint;

    geometry(proj: Projector): SegmentGeometry | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const px = (p: DrawingPoint): [number, number] | null => {
            const y = proj.yOf(p.price, this.paneId);
            return y == null ? null : [proj.xOf(p.time), y];
        };
        const P0 = px(a);
        const P1 = px(b);
        if (!P0 || !P1) return null;
        const c = this.anchors[2];
        if (!c) return { segments: [[P0[0], P0[1], P1[0], P1[1]]], fill: null }; // pivot → cursor only (placing)
        const S = px(this.medianStart(a, b, c));
        const P2 = px(c);
        if (!S || !P2) return null;
        const mx = (P1[0] + P2[0]) / 2;
        const my = (P1[1] + P2[1]) / 2; // median target = midpoint of the tine anchors
        const dx = mx - S[0];
        const dy = my - S[1]; // median direction from the shifted origin
        const w = proj.width;
        const h = proj.height;
        return {
            segments: [
                extendRay(S[0], S[1], mx, my, 'right', w, h), // median
                extendRay(P1[0], P1[1], P1[0] + dx, P1[1] + dy, 'right', w, h), // upper tine
                extendRay(P2[0], P2[1], P2[0] + dx, P2[1] + dy, 'right', w, h), // lower tine
                [P1[0], P1[1], P2[0], P2[1]], // base line
                // The median leaves from the shifted origin, not the pivot — without this construction
                // line the pivot handle would float unattached to the shape it defines.
                [P0[0], P0[1], P1[0], P1[1]], // pivot → first tine anchor
            ],
            fill: null,
        };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        const ps = this.anchors.map((p) => p.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...TEXT_FIELDS] };
    }
}
