import type { Projector } from '../geometry';
import { extendRay } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';
import { fibLevels } from '../levelPalette';

const FAN_LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/**
 * A Fibonacci speed/resistance fan: from the pivot (p1), each level emits TWO rays that
 * subdivide the edges of the p1→p2 box — a price ray to (full width, ratio·height) and a
 * time ray to (ratio·width, full height) — both extended to the chart edge. Purely pixel-
 * space subdivision of the box (it tracks the box on zoom), matching the reference.
 */
export class FibSpeedFan extends FibRatios {
    readonly type = 'fibspeedfan' as const;

    defaultLevels(): readonly FibLevel[] {
        return FAN_LEVELS;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const y1 = proj.yOf(a.price, this.paneId);
        const y2 = proj.yOf(b.price, this.paneId);
        if (y1 == null || y2 == null) return null;
        const x1 = proj.xOf(a.time);
        const x2 = proj.xOf(b.time);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dir = dx >= 0 ? 'right' : 'left';
        const w = proj.width;
        const h = proj.height;
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            // price ray: pivot → (full width, ratio·height) — subdivides the box's right edge
            const pex = x1 + dx;
            const pey = y1 + dy * lv.ratio;
            const pr = extendRay(x1, y1, pex, pey, dir, w, h);
            out.push({
                color: lv.color,
                label: lv.label,
                x1: pr[0],
                y1: pr[1],
                x2: pr[2],
                y2: pr[3],
                numberText: String(lv.ratio),
                numberX: dir === 'right' ? pex + 5 : pex - 5,
                numberY: pey,
                numberAlign: dir === 'right' ? 'left' : 'right',
                labelX: pex,
                labelY: pey,
            });
            if (lv.ratio === 1) continue; // the time ray at ratio 1 is the same diagonal as the price ray
            // time ray: pivot → (ratio·width, full height) — subdivides the box's bottom edge
            const tex = x1 + dx * lv.ratio;
            const tey = y1 + dy;
            const tr = extendRay(x1, y1, tex, tey, dir, w, h);
            out.push({
                color: lv.color,
                label: lv.label,
                x1: tr[0],
                y1: tr[1],
                x2: tr[2],
                y2: tr[3],
                numberText: String(lv.ratio),
                numberX: tex,
                numberY: tey + (dy >= 0 ? 12 : -12),
                numberAlign: 'center',
                labelX: tex,
                labelY: tey + 12,
            });
        }
        return out;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }
}
