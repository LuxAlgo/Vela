import type { Projector } from '../geometry';
import { FibRatios, type FibEntryLine } from './FibRatios';

/** A resolved (enabled) level in pixels: its price, color, label, and line to stroke. */
export interface FibLevelLine {
    ratio: number;
    color: string;
    label?: string;
    price: number;
    x1: number;
    x2: number;
    y: number;
}

/**
 * Shared base for the horizontal Fibonacci level tools (retracement, extension): two
 * anchors define a price range; each level is a horizontal line at
 * `p1.price + ratio·(p2.price − p1.price)`, spanning the anchors' time range, with
 * fill bands between consecutive levels. Subclasses just declare the default ratio set.
 */
export abstract class FibLevels extends FibRatios {
    /** Per-level pixel line + price for the ENABLED levels, spanning the anchors' time range. */
    levelLines(proj: Projector): FibLevelLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        const x1 = Math.min(xa, xb);
        const x2 = Math.max(xa, xb);
        const delta = b.price - a.price;
        const out: FibLevelLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const price = a.price + lv.ratio * delta;
            const y = proj.yOf(price, this.paneId);
            if (y == null) continue;
            out.push({ ratio: lv.ratio, color: lv.color, label: lv.label, price, x1, x2, y });
        }
        return out;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.levelLines(proj);
        if (!lines) return null;
        return lines.map((l) => ({
            color: l.color,
            label: l.label,
            x1: l.x1,
            y1: l.y,
            x2: l.x2,
            y2: l.y,
            numberText: `${l.ratio} (${l.price.toFixed(2)})`,
            numberX: l.x1 + 4,
            numberY: l.y - 7,
            numberAlign: 'left',
            labelX: (l.x1 + l.x2) / 2,
            labelY: l.y - 7,
        }));
    }

    override fillBands(proj: Projector): Array<{ color: string; x: number; y: number; w: number; h: number }> {
        const lines = this.levelLines(proj);
        if (!lines) return [];
        const bands: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
        for (let i = 1; i < lines.length; i += 1) {
            const a = lines[i - 1]!;
            const b = lines[i]!;
            bands.push({ color: b.color, x: a.x1, y: Math.min(a.y, b.y), w: a.x2 - a.x1, h: Math.abs(b.y - a.y) });
        }
        return bands;
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const delta = b.price - a.price;
        const prices = this.levels.filter((l) => l.enabled).map((l) => a.price + l.ratio * delta);
        if (prices.length === 0) return null;
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }
}
