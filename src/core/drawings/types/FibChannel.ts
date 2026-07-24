import { type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

const CHANNEL_LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true },
    { ratio: 0.236, color: '#f23645', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 0.786, color: '#5b9cf6', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.618, color: '#f23645', enabled: true },
    { ratio: 2.618, color: '#ff9800', enabled: true },
];

/**
 * A Fibonacci channel: a baseline (p1→p2) plus parallel level lines, each the baseline
 * translated by `ratio · (p3 − p1)` (a full 2D offset vector — the third anchor sets both
 * the width and the skew). Level 0 is the baseline; level 1 passes through p3.
 */
export class FibChannel extends FibRatios {
    readonly type = 'fibchannel' as const;

    defaultLevels(): readonly FibLevel[] {
        return CHANNEL_LEVELS;
    }

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }, { role: 'offset', free: 'both' }] };
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const y0 = proj.yOf(a.price, this.paneId);
        const y1 = proj.yOf(b.price, this.paneId);
        if (y0 == null || y1 == null) return null;
        const x0 = proj.xOf(a.time);
        const x1 = proj.xOf(b.time);
        // The offset vector p3 − p1 (zero while only the baseline is placed → levels collapse onto it).
        let dX = 0;
        let dY = 0;
        const c = this.anchors[2];
        if (c) {
            const y2 = proj.yOf(c.price, this.paneId);
            if (y2 == null) return null;
            dX = proj.xOf(c.time) - x0;
            dY = y2 - y0;
        }
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const ox = lv.ratio * dX;
            const oy = lv.ratio * dY;
            const lx2 = x1 + ox;
            const ly2 = y1 + oy;
            out.push({
                color: lv.color,
                label: lv.label,
                x1: x0 + ox,
                y1: y0 + oy,
                x2: lx2,
                y2: ly2,
                numberText: String(lv.ratio),
                numberX: lx2 + 5,
                numberY: ly2,
                numberAlign: 'left',
                labelX: lx2 + 5,
                labelY: ly2 + 13,
            });
        }
        return out;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b) return null;
        const dPrice = c ? c.price - a.price : 0;
        let min = Infinity;
        let max = -Infinity;
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            for (const base of [a.price, b.price]) {
                const p = base + lv.ratio * dPrice;
                if (p < min) min = p;
                if (p > max) max = p;
            }
        }
        return min <= max ? { min, max } : null;
    }
}
