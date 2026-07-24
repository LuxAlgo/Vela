import type { Projector } from '../geometry';
import type { AnchorSlot } from '../Drawing';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

/** Trend-based ratios: the move plus projections for price targets. */
const LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.618, color: '#f23645', enabled: true },
    { ratio: 2.618, color: '#9c27b0', enabled: true },
];

/**
 * Trend-based Fibonacci extension: three anchors A→B→C. Levels project the A–B price
 * move from the C anchor — `price = C.price + ratio·(B.price − A.price)` — drawn as
 * horizontal lines across the anchors' time span. Per-level config via the gear panel.
 */
export class FibExtensionTrend extends FibRatios {
    readonly type = 'fibextensiontrend' as const;

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return {
            min: 3,
            max: 3,
            slots: [
                { role: 'a', free: 'both' },
                { role: 'b', free: 'both' },
                { role: 'c', free: 'both' },
            ],
        };
    }

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b || !c) return null;
        const move = b.price - a.price;
        const xs = [proj.xOf(a.time), proj.xOf(b.time), proj.xOf(c.time)];
        const x1 = Math.min(...xs);
        const x2 = Math.max(...xs);
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const price = c.price + lv.ratio * move;
            const y = proj.yOf(price, this.paneId);
            if (y == null) continue;
            out.push({
                color: lv.color,
                label: lv.label,
                x1,
                y1: y,
                x2,
                y2: y,
                numberText: `${lv.ratio} (${price.toFixed(2)})`,
                numberX: x1 + 4,
                numberY: y - 7,
                numberAlign: 'left',
                labelX: (x1 + x2) / 2,
                labelY: y - 7,
            });
        }
        return out;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b || !c) return null;
        const move = b.price - a.price;
        const prices = this.levels.filter((l) => l.enabled).map((l) => c.price + l.ratio * move);
        prices.push(a.price, b.price, c.price);
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }
}
