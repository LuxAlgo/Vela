import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { TEXT_FIELDS } from '../schema';
import { handleAt, pointInPolygon } from '../hittest';

/** Pixel glyph dimensions (constant on-screen size — the marker never scales with zoom). */
const GLYPH = { head: 11, headW: 9, stemW: 3.5, len: 22 };

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * A fixed-size directional arrow marker stamped at a single anchor, with the tip ON the anchor
 * and the body extending away from it. The glyph is a constant-pixel polygon, so it never
 * scales or distorts with zoom (unlike a data-space shape).
 */
export abstract class ArrowMark extends Drawing {
    protected abstract dir(): Dir;

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 1, max: 1, slots: [{ role: 'p', free: 'both' }] };
    }

    /** The filled glyph polygon in pixel space, tip at the anchor. */
    glyphPoints(proj: Projector): Array<[number, number]> | null {
        const a = this.anchors[0];
        if (!a) return null;
        const y = proj.yOf(a.price, this.paneId);
        if (y == null) return null;
        const x = proj.xOf(a.time);
        const { head, headW, stemW, len } = GLYPH;
        // base glyph points UP (tip at origin, body extends down +y); rotated per direction.
        const base: Array<[number, number]> = [
            [0, 0],
            [-headW, head],
            [-stemW, head],
            [-stemW, len],
            [stemW, len],
            [stemW, head],
            [headW, head],
        ];
        const dir = this.dir();
        const rot = ([bx, by]: [number, number]): [number, number] => {
            switch (dir) {
                case 'up':
                    return [bx, by];
                case 'down':
                    return [bx, -by];
                case 'left':
                    return [by, bx];
                default:
                    return [-by, bx]; // right
            }
        };
        return base.map((p) => {
            const [rx, ry] = rot(p);
            return [x + rx, y + ry];
        });
    }

    hitTest(px: number, py: number, proj: Projector, _tol: number): boolean {
        const g = this.glyphPoints(proj);
        return g != null && pointInPolygon(px, py, g);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        if (!a) return [];
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? [] : [[proj.xOf(a.time), y]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const g = this.glyphPoints(proj);
        if (!g) return null;
        const xs = g.map((p) => p[0]);
        const ys = g.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        return a ? { min: a.price, max: a.price } : null;
    }

    schema(): SettingsSchema {
        return { fields: [{ path: 'style.lineColor', label: 'Color', kind: 'color', group: 'line' }, ...TEXT_FIELDS] };
    }
}

/** An upward arrow marker — tip on the anchor, body hanging below. */
export class ArrowMarkUp extends ArrowMark {
    readonly type = 'arrowmarkup' as const;
    protected dir(): Dir {
        return 'up';
    }
}

/** A downward arrow marker — tip on the anchor, body rising above. */
export class ArrowMarkDown extends ArrowMark {
    readonly type = 'arrowmarkdown' as const;
    protected dir(): Dir {
        return 'down';
    }
}
