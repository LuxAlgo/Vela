import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { distToSegment, handleAt, pointInBox } from '../hittest';

/** Behavior + candle cosmetics of the magnifier (round-trips through `props`). */
export interface MagnifierStyle {
    /** `'auto'` (resolve against the chart timeframe) or a canonical value (`'5'`, `'60'`, `'D'`). */
    timeframe: string;
    /** Rising lower-timeframe candles; `''` ⇒ the chart series' own up color, resolved at paint time. */
    upColor: string;
    /** Falling lower-timeframe candles; `''` ⇒ the chart series' own down color. */
    downColor: string;
}

/** The timeframe choices the magnifier offers. `ms` is each option's bar duration so pickers
 *  can drop the choices not strictly below the chart's timeframe (`auto` carries 0 — it always
 *  resolves lower, or the gateway reports that nothing lower exists). */
export const MAGNIFIER_TIMEFRAME_OPTIONS: ReadonlyArray<{ value: string; label: string; ms: number }> = [
    { value: 'auto', label: 'Auto', ms: 0 },
    { value: '1', label: '1m', ms: 60_000 },
    { value: '5', label: '5m', ms: 300_000 },
    { value: '15', label: '15m', ms: 900_000 },
    { value: '30', label: '30m', ms: 1_800_000 },
    { value: '60', label: '1h', ms: 3_600_000 },
    { value: '240', label: '4h', ms: 14_400_000 },
    { value: 'D', label: '1D', ms: 86_400_000 },
];

/** Display label for a magnifier timeframe value (`'60'` → `'1h'`, `'auto'` → `'Auto'`). */
export function magnifierTimeframeLabel(value: string): string {
    const opt = MAGNIFIER_TIMEFRAME_OPTIONS.find((o) => o.value === value);
    if (opt) return opt.label;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
        if (n % 1440 === 0) return `${n / 1440}D`;
        if (n % 60 === 0) return `${n / 60}h`;
        return `${n}m`;
    }
    return value;
}

function defaultMagnifierStyle(): MagnifierStyle {
    // Empty candle colors follow the CHART series' own up/down at paint time, so the inset
    // reads as a finer copy of the main series until the user explicitly recolors it.
    return { timeframe: 'auto', upColor: '', downColor: '' };
}

/**
 * A **magnifier**: a rectangle (two corner anchors, press-drag-release placement) whose
 * interior shows the chart's own market at a FINER timeframe — each chart candle
 * subdivides in place into its lower-timeframe candles, drawn at their true time/price
 * positions on the pane's scales. The bars come through {@link Projector.seriesInRange}
 * (async, cache-backed); while they load — or when no lower timeframe applies — the
 * painter shows a short notice inside the area instead.
 */
export class Magnifier extends Drawing {
    readonly type = 'magnifier' as const;

    /** Behavior + candle cosmetics (seeded from defaults, persisted via props). */
    magnifier!: MagnifierStyle;

    /** Pixel rect of the timeframe chip as painted last frame, caret included — the chip is
     *  an interactive dropdown trigger, so the interaction layer needs the exact rect the
     *  painter measured. Renderer-transient: never serialized, null while unpainted. */
    chipRect: { x: number; y: number; w: number; h: number } | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.magnifier) this.magnifier = defaultMagnifierStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'c1', free: 'both' }, { role: 'c2', free: 'both' }] };
    }

    override placementMode(): 'click' | 'drag' | 'freehand' {
        return 'drag';
    }

    /** The pixel rectangle between the two corner anchors (painter + hit-test share it). */
    rect(proj: Projector): { x1: number; y1: number; x2: number; y2: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ya = proj.yOf(a.price, this.paneId);
        const yb = proj.yOf(b.price, this.paneId);
        if (ya == null || yb == null) return null;
        return { x1: proj.xOf(a.time), y1: ya, x2: proj.xOf(b.time), y2: yb };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const r = this.rect(proj);
        if (!r) return false;
        // The interior is an opaque inset — grabbable anywhere, like a filled box.
        if (pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
        const edges: Array<[number, number, number, number]> = [
            [r.x1, r.y1, r.x2, r.y1],
            [r.x2, r.y1, r.x2, r.y2],
            [r.x2, r.y2, r.x1, r.y2],
            [r.x1, r.y2, r.x1, r.y1],
        ];
        return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const r = this.rect(proj);
        return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const r = this.rect(proj);
        if (!r) return null;
        return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                {
                    path: 'magnifier.timeframe',
                    label: 'Timeframe',
                    kind: 'select',
                    options: MAGNIFIER_TIMEFRAME_OPTIONS,
                    group: 'behavior',
                },
                ...LINE_FIELDS.map((f) => ({ ...f, label: f.label.replace('Line', 'Border') })),
                { path: 'magnifier.upColor', label: 'Up candles', kind: 'color' as const, group: 'fill' as const },
                { path: 'magnifier.downColor', label: 'Down candles', kind: 'color' as const, group: 'fill' as const },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.magnifier };
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.magnifier = { ...defaultMagnifierStyle(), ...(props as Partial<MagnifierStyle>) };
    }
}
