import type { Projector } from '../geometry';
import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { FibRatios, type FibEntryLine } from './FibRatios';

/** Which side of the levels their ratio and price text sits on. */
export type FibLabelSide = 'left' | 'right';

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
    /** Show each level's ratio beside it. */
    declare showRatios: boolean;
    /** Show each level's price beside it. */
    declare showPrices: boolean;
    /** Where the ratio / price text sits. */
    declare labelSide: FibLabelSide;
    /** Tint the bands between levels. */
    declare background: boolean;

    // `declare`d: the base constructor reads saved props before these could be initialized.
    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.showRatios === undefined) this.showRatios = true;
        if (this.showPrices === undefined) this.showPrices = true;
        if (this.labelSide === undefined) this.labelSide = 'left';
        if (this.background === undefined) this.background = true;
    }

    /** Price of a level for the two anchor prices; subclasses override to change which anchor ratio 0 sits on. */
    protected levelPrice(ratio: number, p1: number, p2: number): number {
        return p1 + ratio * (p2 - p1);
    }

    /** Per-level pixel line + price for the ENABLED levels, spanning the anchors' time range. */
    levelLines(proj: Projector): FibLevelLine[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        // Extended levels run on to the chart's edge on that side.
        const x1 = this.style.extendLeft ? 0 : Math.min(xa, xb);
        const x2 = this.style.extendRight ? proj.width : Math.max(xa, xb);
        const out: FibLevelLine[] = [];
        for (const lv of this.levels) {
            if (!lv.enabled) continue;
            const price = this.levelPrice(lv.ratio, a.price, b.price);
            const y = proj.yOf(price, this.paneId);
            if (y == null) continue;
            out.push({ ratio: lv.ratio, color: lv.color, label: lv.label, price, x1, x2, y });
        }
        return out;
    }

    entryLines(proj: Projector): FibEntryLine[] | null {
        const lines = this.levelLines(proj);
        if (!lines) return null;
        const right = this.labelSide === 'right';
        return lines.map((l) => ({
            color: l.color,
            label: l.label,
            x1: l.x1,
            y1: l.y,
            x2: l.x2,
            y2: l.y,
            numberText: this.levelText(l.ratio, l.price),
            numberX: right ? l.x2 - 4 : l.x1 + 4,
            numberY: l.y - 7,
            numberAlign: right ? 'right' : 'left',
            labelX: (l.x1 + l.x2) / 2,
            labelY: l.y - 7,
        }));
    }

    /** The text beside a level: its ratio, its price, both, or nothing. */
    private levelText(ratio: number, price: number): string {
        const p = price.toFixed(2);
        if (this.showRatios && this.showPrices) return `${ratio} (${p})`;
        if (this.showRatios) return String(ratio);
        return this.showPrices ? p : '';
    }

    override fillBands(proj: Projector): Array<{ color: string; x: number; y: number; w: number; h: number }> {
        if (!this.background) return [];
        // Bands join neighbouring levels by ratio, however the list is ordered.
        const lines = this.levelLines(proj)?.sort((p, q) => p.ratio - q.ratio);
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
        const prices = this.levels.filter((l) => l.enabled).map((l) => this.levelPrice(l.ratio, a.price, b.price));
        if (prices.length === 0) return null;
        return { min: Math.min(...prices), max: Math.max(...prices) };
    }

    override schema(): SettingsSchema {
        const base = super.schema();
        return {
            fields: [
                ...base.fields,
                { path: 'style.extendLeft', label: 'Extend left', kind: 'boolean', group: 'line' },
                { path: 'style.extendRight', label: 'Extend right', kind: 'boolean', group: 'line' },
                { path: 'showRatios', label: 'Ratios', kind: 'boolean', group: 'text' },
                { path: 'showPrices', label: 'Prices', kind: 'boolean', group: 'text' },
                {
                    path: 'labelSide',
                    label: 'Labels',
                    kind: 'select',
                    group: 'text',
                    options: [
                        { value: 'left', label: 'Left' },
                        { value: 'right', label: 'Right' },
                    ],
                },
                { path: 'background', label: 'Background', kind: 'boolean', group: 'fill' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...super.writeProps(), showRatios: this.showRatios, showPrices: this.showPrices, labelSide: this.labelSide, background: this.background };
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        if (typeof props.showRatios === 'boolean') this.showRatios = props.showRatios;
        if (typeof props.showPrices === 'boolean') this.showPrices = props.showPrices;
        if (props.labelSide === 'left' || props.labelSide === 'right') this.labelSide = props.labelSide;
        if (typeof props.background === 'boolean') this.background = props.background;
    }
}
