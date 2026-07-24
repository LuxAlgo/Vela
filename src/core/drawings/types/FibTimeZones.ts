import type { Projector } from '../geometry';
import { DEFAULT_DRAWING_COLOR } from '../style';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

/** A resolved time-zone line: its Fibonacci index, color, label, and pixel x. */
export interface FibZoneLine {
    n: number;
    color: string;
    label?: string;
    x: number;
}

/** Fibonacci sequence (the time multiples drawn as vertical lines). */
const TZ_LEVELS: readonly FibLevel[] = [0, 1, 2, 3, 5, 8, 13, 21, 34].map((n) => ({ ratio: n, color: DEFAULT_DRAWING_COLOR, enabled: true }));

/**
 * Fibonacci time zones: vertical lines at Fibonacci multiples of the base interval
 * (the time span between the two anchors), projecting forward. Each line is an editable
 * level (color / enabled / label) via the gear panel. Price-agnostic — the lines span
 * the full pane height and don't affect the price scale.
 */
export class FibTimeZones extends FibRatios {
    readonly type = 'fibtimezones' as const;

    defaultLevels(): readonly FibLevel[] {
        return TZ_LEVELS;
    }

    zoneLines(proj: Projector): FibZoneLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const unit = b.time - a.time;
        if (Math.abs(unit) < 1e-9) return null;
        const out: FibZoneLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            out.push({ n: lv.ratio, color: lv.color, label: lv.label, x: proj.xOf(a.time + lv.ratio * unit) });
        }
        return out;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.zoneLines(proj);
        if (!lines) return null;
        const h = proj.height;
        return lines.map((l) => ({
            color: l.color,
            label: l.label,
            x1: l.x,
            y1: 0,
            x2: l.x,
            y2: h,
            numberText: String(l.n),
            numberX: l.x,
            numberY: 9,
            numberAlign: 'center',
            labelX: l.x,
            labelY: 24,
        }));
    }

    priceRange(): { min: number; max: number } | null {
        return null; // vertical lines impose no price constraint
    }

    override timeExtent(): { min: number; max: number } | null {
        return null; // the zones project far forward → never time-cull
    }
}
