import type { Projector } from '../geometry';
import { extendRay } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';
import { fibLevels } from '../levelPalette';

/** A resolved fan ray in pixels. */
export interface FibFanLine {
    ratio: number;
    color: string;
    label?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    labelX: number;
    labelY: number;
}

const FAN_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/**
 * A Fibonacci fan: rays from the first anchor through the fib-divided price levels at
 * the second anchor's time, extended to the right edge. Each ray is an editable level
 * (color / enabled / label) via the gear panel.
 */
export class FibFan extends FibRatios {
    readonly type = 'fibfan' as const;

    defaultLevels(): readonly FibLevel[] {
        return FAN_LEVELS;
    }

    fanLines(proj: Projector): FibFanLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const x0 = proj.xOf(a.time);
        const y0 = proj.yOf(a.price, this.paneId);
        if (y0 == null) return null;
        const xb = proj.xOf(b.time);
        const delta = b.price - a.price;
        const out: FibFanLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const ty = proj.yOf(a.price + lv.ratio * delta, this.paneId);
            if (ty == null) continue;
            const [x1, y1, x2, y2] = extendRay(x0, y0, xb, ty, 'right', proj.width, proj.height);
            out.push({ ratio: lv.ratio, color: lv.color, label: lv.label, x1, y1, x2, y2, labelX: xb + 5, labelY: ty });
        }
        return out;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.fanLines(proj);
        if (!lines) return null;
        return lines.map((l) => ({
            color: l.color,
            label: l.label,
            x1: l.x1,
            y1: l.y1,
            x2: l.x2,
            y2: l.y2,
            numberText: String(l.ratio),
            numberX: l.labelX,
            numberY: l.labelY,
            numberAlign: 'left',
            labelX: l.labelX,
            labelY: l.labelY + 13,
        }));
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }
}
