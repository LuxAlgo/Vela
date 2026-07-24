import { type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

const TIME_LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: false }, // hidden by default
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.382, color: '#ff9800', enabled: true },
    { ratio: 1.618, color: '#089981', enabled: true },
    { ratio: 2, color: '#787b86', enabled: true },
    { ratio: 2.382, color: '#ff9800', enabled: true },
    { ratio: 2.618, color: '#089981', enabled: true },
    { ratio: 3, color: '#787b86', enabled: true },
];

/**
 * Trend-based Fibonacci time: vertical lines at Fibonacci multiples of the base interval
 * (p1→p2), projected forward from the origin p3 — `xOf(p3.time + ratio · (p2.time − p1.time))`.
 * Time-only (the level lines ignore price), like {@link FibTimeZones} but driven by a 3-point trend.
 */
export class TrendFibTime extends FibRatios {
    readonly type = 'trendfibtime' as const;

    defaultLevels(): readonly FibLevel[] {
        return TIME_LEVELS;
    }

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 3, max: 3, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }, { role: 'p3', free: 'both' }] };
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        const c = this.anchors[2];
        if (!a || !b || !c) return null;
        const unit = b.time - a.time; // base interval (signed)
        if (Math.abs(unit) < 1e-9) return null;
        const h = proj.height;
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const x = proj.xOf(c.time + lv.ratio * unit);
            out.push({
                color: lv.color,
                label: lv.label,
                x1: x,
                y1: 0,
                x2: x,
                y2: h,
                numberText: String(lv.ratio),
                numberX: x,
                numberY: 9,
                numberAlign: 'center',
                labelX: x,
                labelY: 24,
            });
        }
        return out;
    }

    priceRange(): { min: number; max: number } | null {
        return null; // vertical lines impose no price constraint
    }

    override timeExtent(): { min: number; max: number } | null {
        return null; // the projected lines run far forward → never time-cull
    }
}
