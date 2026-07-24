import type { Projector } from '../geometry';
import { pointInBox } from '../hittest';
import { FibRatios, type FibEntryLine, type FibLevel } from './FibRatios';

/** The Gann-box subdivisions, applied to BOTH the price (horizontal) and time (vertical) axes. */
const GANN_BOX_LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true, label: '0' },
    { ratio: 0.25, color: '#f23645', enabled: true, label: '0.25' },
    { ratio: 0.382, color: '#ff9800', enabled: true, label: '0.382' },
    { ratio: 0.5, color: '#4caf50', enabled: true, label: '0.5' },
    { ratio: 0.618, color: '#089981', enabled: true, label: '0.618' },
    { ratio: 0.75, color: '#5b9cf6', enabled: true, label: '0.75' },
    { ratio: 1, color: '#787b86', enabled: true, label: '1' },
];

/**
 * A Gann box — a price/time grid between two corners, with horizontal + vertical lines at the
 * Gann ratios plus the two diagonals. Each ratio is an editable level (color / enabled / label)
 * via the gear panel; rendered by the shared fib painter (each grid line is an entry line).
 */
export class GannBox extends FibRatios {
    readonly type = 'gannbox' as const;

    defaultLevels(): readonly FibLevel[] {
        return GANN_BOX_LEVELS;
    }

    // Placed click-move-click (the inherited 'click' mode): first click sets a corner, the second
    // sets the opposite one — matching the plain Rectangle tool.

    private corners(proj: Projector): { c1: { time: number; price: number }; c2: { time: number; price: number }; left: number; right: number; top: number; bot: number } | null {
        const c1 = this.anchors[0];
        const c2 = this.anchors[1];
        if (!c1 || !c2) return null;
        const xa = proj.xOf(c1.time);
        const xb = proj.xOf(c2.time);
        const ya = proj.yOf(c1.price, this.paneId);
        const yb = proj.yOf(c2.price, this.paneId);
        if (ya == null || yb == null) return null;
        return { c1, c2, left: Math.min(xa, xb), right: Math.max(xa, xb), top: Math.min(ya, yb), bot: Math.max(ya, yb) };
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const g = this.corners(proj);
        if (!g) return null;
        const { c1, c2, left, right, top, bot } = g;
        const out: FibEntryLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            // horizontal (price) gridline — labelled at the left edge
            const py = proj.yOf(c1.price + lv.ratio * (c2.price - c1.price), this.paneId);
            if (py != null) {
                out.push({ color: lv.color, x1: left, y1: py, x2: right, y2: py, numberText: lv.label ?? String(lv.ratio), numberX: left - 5, numberY: py, numberAlign: 'right', labelX: left, labelY: py });
            }
            // vertical (time) gridline — unlabelled to avoid clutter
            const vx = proj.xOf(c1.time + lv.ratio * (c2.time - c1.time));
            out.push({ color: lv.color, x1: vx, y1: top, x2: vx, y2: bot, numberText: '', numberX: vx, numberY: top, numberAlign: 'center', labelX: vx, labelY: top });
        }
        // the two diagonals (in the 1.0 level's color)
        const diag = this.levels.find((l) => l.ratio === 1)?.color ?? '#787b86';
        out.push({ color: diag, x1: left, y1: top, x2: right, y2: bot, numberText: '', numberX: 0, numberY: 0, numberAlign: 'left', labelX: 0, labelY: 0 });
        out.push({ color: diag, x1: left, y1: bot, x2: right, y2: top, numberText: '', numberX: 0, numberY: 0, numberAlign: 'left', labelX: 0, labelY: 0 });
        return out;
    }

    override hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const g = this.corners(proj);
        return g != null && pointInBox(px, py, g.left, g.top, g.right, g.bot, tol); // grabbable anywhere inside
    }

    priceRange(): { min: number; max: number } | null {
        const c1 = this.anchors[0];
        const c2 = this.anchors[1];
        if (!c1 || !c2) return null;
        return { min: Math.min(c1.price, c2.price), max: Math.max(c1.price, c2.price) };
    }
}
