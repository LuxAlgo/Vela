import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { LineStyle } from '../../model/series';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { distToSegment, pointInPolygon, handleAt } from '../hittest';
import { BEARISH, BULLISH, NEUTRAL } from '../../palette';

/** Standard-deviation multiplier for the channel half-width (a ±2σ band around the fit line). */
const DEVIATIONS = 2;

/** One OHLC bar the regression fits against (only `time` + `close` are used). */
interface FitBar {
    time: number;
    close: number;
}

/** The least-squares result over the bars in range: the fit line endpoints (price), the
 *  band half-width, and the goodness-of-fit R² (0..1). */
export interface RegressionFit {
    /** First / last bar time in range (the channel's horizontal extent). */
    t0: number;
    t1: number;
    /** Midline (fit) price at `t0` / `t1`. */
    mid0: number;
    mid1: number;
    /** Channel half-width in price (`DEVIATIONS` × residual σ). */
    dev: number;
    /** Coefficient of determination, 0..1 (shown as a %). */
    r2: number;
    /** Bar count fitted. */
    n: number;
}

/** Per-line + fill cosmetics for the regression channel (round-trips through `props`). */
export interface RegressionStyle {
    midColor: string;
    midStyle: LineStyle;
    upperColor: string;
    upperStyle: LineStyle;
    lowerColor: string;
    lowerStyle: LineStyle;
    /** Fill between the midline and the upper band. */
    upperFill: string;
    /** Fill between the midline and the lower band. */
    lowerFill: string;
    /** Show the R² readout at the start of the channel. */
    showR2: boolean;
}

function defaultRegressionStyle(): RegressionStyle {
    return {
        midColor: NEUTRAL, // neutral gray midline
        midStyle: 'solid',
        upperColor: BULLISH,
        upperStyle: 'solid',
        lowerColor: BEARISH,
        lowerStyle: 'solid',
        upperFill: `${BULLISH}26`, // translucent, mid → upper
        lowerFill: `${BEARISH}26`, // translucent, mid → lower
        showR2: true,
    };
}

/** Pixel layout the painter/hit-test consume — the three lines' endpoints + the R² readout. */
export interface RegressionLayout {
    x0: number;
    x1: number;
    midY0: number;
    midY1: number;
    upperY0: number;
    upperY1: number;
    lowerY0: number;
    lowerY1: number;
    r2: number;
    showR2: boolean;
}

/** Least-squares line + residual σ + Pearson R² over `(index, close)`. Null when < 2 bars. */
export function computeRegressionFit(bars: readonly FitBar[]): RegressionFit | null {
    const n = bars.length;
    if (n < 2) return null;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;
    for (let i = 0; i < n; i += 1) {
        const y = bars[i]!.close;
        sumX += i;
        sumY += y;
        sumXY += i * y;
        sumXX += i * i;
        sumYY += y * y;
    }
    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    let sse = 0;
    for (let i = 0; i < n; i += 1) {
        const resid = bars[i]!.close - (intercept + slope * i);
        sse += resid * resid;
    }
    const sigma = Math.sqrt(sse / n);
    const den = Math.sqrt(denom * (n * sumYY - sumY * sumY));
    const r = den === 0 ? 0 : (n * sumXY - sumX * sumY) / den;
    return {
        t0: bars[0]!.time,
        t1: bars[n - 1]!.time,
        mid0: intercept,
        mid1: intercept + slope * (n - 1),
        dev: DEVIATIONS * sigma,
        r2: Math.max(0, Math.min(1, r * r)),
        n,
    };
}

/**
 * A linear-regression channel: two anchors bound a time range, and the tool fits a
 * least-squares trendline over the bars' closes in that range, drawing a ±2σ band
 * around it. The R² of the fit is shown (as an integer %) at the start of the channel.
 * The fit is DATA-driven — only the anchors' times matter — so it recomputes live as
 * an endpoint is dragged or new bars arrive, via {@link Projector.barsInRange}.
 */
export class RegressionChannel extends Drawing {
    readonly type = 'regressionchannel' as const;

    /** Per-line + fill cosmetics (seeded from defaults, persisted via props). Definite-assignment:
     *  set either by `readProps` (during `super()`) or by the constructor below — never as a field
     *  initializer, which would run *after* `super()` and clobber a restored value. */
    reg!: RegressionStyle;

    /** Last computed price span (midline ± band), cached so autoscale's `priceRange()`
     *  — which gets no projector — can fold the channel in without recomputing. */
    private cachedRange: { min: number; max: number } | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.reg) this.reg = defaultRegressionStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // Two points bound the time range; the fit ignores their price (data-driven),
        // so handles are constrained to horizontal moves.
        return { min: 2, max: 2, slots: [{ role: 'start', free: 'x' }, { role: 'end', free: 'x' }] };
    }

    /** Fit against the bars in the anchor time-range, caching the price span for autoscale. */
    fit(proj: Projector): RegressionFit | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const from = Math.min(a.time, b.time);
        const to = Math.max(a.time, b.time);
        const bars = proj.barsInRange?.(from, to) ?? null;
        const f = bars ? computeRegressionFit(bars) : null;
        if (f) {
            this.cachedRange = { min: Math.min(f.mid0, f.mid1) - f.dev, max: Math.max(f.mid0, f.mid1) + f.dev };
        }
        return f;
    }

    /** Resolve the fit to pixel geometry for the painter + hit-test. */
    layout(proj: Projector): RegressionLayout | null {
        const f = this.fit(proj);
        if (!f) return null;
        const midY0 = proj.yOf(f.mid0, this.paneId);
        const midY1 = proj.yOf(f.mid1, this.paneId);
        const upperY0 = proj.yOf(f.mid0 + f.dev, this.paneId);
        const upperY1 = proj.yOf(f.mid1 + f.dev, this.paneId);
        const lowerY0 = proj.yOf(f.mid0 - f.dev, this.paneId);
        const lowerY1 = proj.yOf(f.mid1 - f.dev, this.paneId);
        if (midY0 == null || midY1 == null || upperY0 == null || upperY1 == null || lowerY0 == null || lowerY1 == null) return null;
        return {
            x0: proj.xOf(f.t0),
            x1: proj.xOf(f.t1),
            midY0,
            midY1,
            upperY0,
            upperY1,
            lowerY0,
            lowerY1,
            r2: f.r2,
            showR2: this.reg.showR2,
        };
    }

    /** The band outline polygon (upper edge left→right, then lower edge right→left). */
    private band(proj: Projector): Array<[number, number]> | null {
        const L = this.layout(proj);
        if (!L) return null;
        return [
            [L.x0, L.upperY0],
            [L.x1, L.upperY1],
            [L.x1, L.lowerY1],
            [L.x0, L.lowerY0],
        ];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        if (!L) return false;
        const poly: Array<[number, number]> = [
            [L.x0, L.upperY0],
            [L.x1, L.upperY1],
            [L.x1, L.lowerY1],
            [L.x0, L.lowerY0],
        ];
        if (pointInPolygon(px, py, poly)) return true;
        const lines: Array<[number, number, number, number]> = [
            [L.x0, L.midY0, L.x1, L.midY1],
            [L.x0, L.upperY0, L.x1, L.upperY1],
            [L.x0, L.lowerY0, L.x1, L.lowerY1],
        ];
        return lines.some((s) => distToSegment(px, py, s[0], s[1], s[2], s[3]) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const L = this.layout(proj);
        if (L) return [[L.x0, L.midY0], [L.x1, L.midY1]];
        // no fit (e.g. no data yet) → fall back to the raw anchors so the tool stays grabbable
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            pts.push([proj.xOf(a.time), y]);
        }
        return pts;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const poly = this.band(proj);
        if (!poly) return null;
        const xs = poly.map((p) => p[0]);
        const ys = poly.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.cachedRange) return this.cachedRange;
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        // Custom paths the settings popup renders as dedicated regression controls
        // (per-line color + style, the two area fills, and the R² toggle).
        return {
            fields: [
                { path: 'reg.midColor', label: 'Midline color', kind: 'color', group: 'line' },
                { path: 'reg.midStyle', label: 'Midline style', kind: 'lineStyle', group: 'line' },
                { path: 'reg.upperColor', label: 'Upper line color', kind: 'color', group: 'line' },
                { path: 'reg.upperStyle', label: 'Upper line style', kind: 'lineStyle', group: 'line' },
                { path: 'reg.lowerColor', label: 'Lower line color', kind: 'color', group: 'line' },
                { path: 'reg.lowerStyle', label: 'Lower line style', kind: 'lineStyle', group: 'line' },
                { path: 'reg.upperFill', label: 'Upper fill', kind: 'color', group: 'fill' },
                { path: 'reg.lowerFill', label: 'Lower fill', kind: 'color', group: 'fill' },
                { path: 'reg.showR2', label: 'Show R²', kind: 'boolean', group: 'behavior' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.reg };
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.reg = { ...defaultRegressionStyle(), ...(props as Partial<RegressionStyle>) };
    }
}
