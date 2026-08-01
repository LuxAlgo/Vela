import type { Projector } from '../geometry';
import { extendRay } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';
import { fibLevels, LEVEL_AMBER, LEVEL_AQUA, LEVEL_BLUE, LEVEL_GREEN, LEVEL_ORANGE, LEVEL_PURPLE, LEVEL_RED, LEVEL_TEAL, LEVEL_UNITY } from '../levelPalette';

/**
 * The Gann angles: price-per-time ratios relative to the 1×1 (the line through the second
 * anchor). A ratio > 1 is steeper (more price per unit time), < 1 shallower.
 */
const GANN_FAN_LEVELS = fibLevels([
    { ratio: 0.125, color: LEVEL_RED, label: '1/8' },
    { ratio: 0.25, color: LEVEL_ORANGE, label: '1/4' },
    { ratio: 0.333, color: LEVEL_AMBER, label: '1/3' },
    { ratio: 0.5, color: LEVEL_GREEN, label: '1/2' },
    { ratio: 1, color: LEVEL_UNITY, label: '1/1' },
    { ratio: 2, color: LEVEL_TEAL, label: '2/1' },
    { ratio: 3, color: LEVEL_BLUE, label: '3/1' },
    { ratio: 4, color: LEVEL_AQUA, label: '4/1' },
    { ratio: 8, color: LEVEL_PURPLE, label: '8/1' },
]);

/**
 * A Gann fan — rays from the first anchor at the Gann angles, scaled so the 1×1 passes
 * through the second anchor (which sets the price-per-time unit). Each angle is an editable
 * level (color / enabled / label) via the gear panel; rendered by the shared fib painter.
 */
export class GannFan extends FibRatios {
    readonly type = 'gannfan' as const;

    defaultLevels(): readonly FibLevel[] {
        return GANN_FAN_LEVELS;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const x0 = proj.xOf(a.time);
        const y0 = proj.yOf(a.price, this.paneId);
        if (y0 == null) return null;
        const xb = proj.xOf(b.time);
        const dp = b.price - a.price; // the 1×1 rise; ratio r scales it to dp·r
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const ty = proj.yOf(a.price + dp * lv.ratio, this.paneId);
            if (ty == null) continue;
            const [x1, y1, x2, y2] = extendRay(x0, y0, xb, ty, 'right', proj.width, proj.height);
            out.push({
                color: lv.color,
                x1,
                y1,
                x2,
                y2,
                numberText: lv.label ?? String(lv.ratio),
                numberX: xb + 5,
                numberY: ty,
                numberAlign: 'left',
                labelX: xb + 5,
                labelY: ty,
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
