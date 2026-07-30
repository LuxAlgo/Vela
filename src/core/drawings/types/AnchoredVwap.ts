import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { LineStyle } from '../../model/series';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { distToSegment, pointInPolygon, handleAt } from '../hittest';
import { INFO } from '../../palette';

/** One OHLCV bar the VWAP accumulates over (typical price × volume). */
interface VwapBar {
    time: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** One computed VWAP sample: the running VWAP plus its ±(mult·σ) band edges, per bar. */
export interface VwapPoint {
    time: number;
    /** Volume-weighted average price up to this bar (the midline). */
    mid: number;
    /** `mid + multiplier · σ` (upper band). */
    upper: number;
    /** `mid − multiplier · σ` (lower band). */
    lower: number;
}

/** Cosmetics for the anchored VWAP (round-trips through `props`). */
export interface VwapStyle {
    /** VWAP midline color. */
    midColor: string;
    midStyle: LineStyle;
    /** Standard-deviation multiplier for the band half-width. */
    multiplier: number;
    /** Upper band line color (fully transparent by default — the fill carries the visuals). */
    upperColor: string;
    upperStyle: LineStyle;
    /** Lower band line color (fully transparent by default). */
    lowerColor: string;
    lowerStyle: LineStyle;
    /** Fill between the upper and lower bands. */
    bandFill: string;
}

/** Fully-transparent variant of the band hue — bumping its opacity in the picker keeps the color. */
const TRANSPARENT_BAND = `${INFO}00`;

function defaultVwapStyle(): VwapStyle {
    return {
        midColor: INFO, // VWAP midline (opaque)
        midStyle: 'solid',
        multiplier: 1,
        upperColor: TRANSPARENT_BAND, // band edges hidden by default
        upperStyle: 'solid',
        lowerColor: TRANSPARENT_BAND,
        lowerStyle: 'solid',
        bandFill: `${INFO}33`, // band hue at ~20% opacity
    };
}

/**
 * Volume-weighted average price (with ±σ bands) accumulated from the first bar in `bars`.
 * Uses the typical price `(H+L+C)/3` weighted by volume; the band half-width is the
 * volume-weighted standard deviation of the typical price around the running VWAP, scaled
 * by `mult`. When the series carries no volume (feeds may omit it) every bar is weighted
 * equally, so the tool still produces a meaningful curve. Null when there are no bars.
 */
export function computeVwap(bars: readonly VwapBar[], mult: number): VwapPoint[] | null {
    const n = bars.length;
    if (n < 1) return null;
    let totalVol = 0;
    for (const b of bars) totalVol += b.volume > 0 ? b.volume : 0;
    const useVol = totalVol > 0; // no volume anywhere → equal-weight fallback
    let cumW = 0;
    let cumPV = 0;
    let cumP2V = 0;
    const out: VwapPoint[] = [];
    for (let i = 0; i < n; i += 1) {
        const b = bars[i]!;
        const tp = (b.high + b.low + b.close) / 3;
        const w = useVol ? Math.max(0, b.volume) : 1;
        cumW += w;
        cumPV += tp * w;
        cumP2V += tp * tp * w;
        const mid = cumW > 0 ? cumPV / cumW : tp;
        const variance = cumW > 0 ? Math.max(0, cumP2V / cumW - mid * mid) : 0;
        const dev = Math.sqrt(variance) * mult;
        out.push({ time: b.time, mid, upper: mid + dev, lower: mid - dev });
    }
    return out;
}

/** Pixel geometry the painter/hit-test consume — the three polylines (mid/upper/lower). */
export interface VwapLayout {
    mid: Array<[number, number]>;
    upper: Array<[number, number]>;
    lower: Array<[number, number]>;
}

/**
 * An **anchored VWAP**: a single time anchor from which the volume-weighted average price
 * (plus ±σ bands and a fill between them) accumulates forward across every bar to the right.
 * The curve is DATA-driven — only the anchor's time matters — so it recomputes live as the
 * anchor is dragged or new bars arrive, via {@link Projector.barsInRange}.
 */
export class AnchoredVwap extends Drawing {
    readonly type = 'anchoredvwap' as const;

    /** Cosmetics (seeded from defaults, persisted via props). Definite-assignment: set by
     *  `readProps` during `super()` or by the constructor — never a field initializer, which
     *  would run after `super()` and clobber a restored value. */
    vwap!: VwapStyle;

    /** Last computed price span (min lower … max upper), cached so autoscale's `priceRange()`
     *  — which gets no projector — folds the curve in without recomputing. */
    private cachedRange: { min: number; max: number } | null = null;
    /** Last computed time span (anchor bar … last bar), cached for `timeExtent()` culling. */
    private cachedExtent: { min: number; max: number } | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.vwap) this.vwap = defaultVwapStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // A single anchor bounds only the START time; the VWAP is data-driven and ignores
        // the anchor's price, so its handle is constrained to horizontal moves.
        return { min: 1, max: 1, slots: [{ role: 'anchor', free: 'x' }] };
    }

    /** Compute the VWAP samples from the anchor time forward, caching the price + time spans. */
    series(proj: Projector): VwapPoint[] | null {
        const a = this.anchors[0];
        if (!a) return null;
        const bars = proj.barsInRange?.(a.time, Number.POSITIVE_INFINITY) ?? null;
        if (!bars || bars.length < 1) return null;
        const pts = computeVwap(
            bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })),
            this.vwap.multiplier,
        );
        if (pts && pts.length > 0) {
            let min = Infinity;
            let max = -Infinity;
            for (const p of pts) {
                if (p.lower < min) min = p.lower;
                if (p.upper > max) max = p.upper;
            }
            this.cachedRange = { min, max };
            this.cachedExtent = { min: pts[0]!.time, max: pts[pts.length - 1]!.time };
        }
        return pts;
    }

    /** Resolve the samples to pixel polylines for the painter + hit-test. */
    layout(proj: Projector): VwapLayout | null {
        const pts = this.series(proj);
        if (!pts) return null;
        const mid: Array<[number, number]> = [];
        const upper: Array<[number, number]> = [];
        const lower: Array<[number, number]> = [];
        for (const p of pts) {
            const x = proj.xOf(p.time);
            const my = proj.yOf(p.mid, this.paneId);
            const uy = proj.yOf(p.upper, this.paneId);
            const ly = proj.yOf(p.lower, this.paneId);
            if (my == null || uy == null || ly == null) continue;
            mid.push([x, my]);
            upper.push([x, uy]);
            lower.push([x, ly]);
        }
        return mid.length > 0 ? { mid, upper, lower } : null;
    }

    /** The band outline polygon (upper edge left→right, then lower edge right→left). */
    private bandPolygon(L: VwapLayout): Array<[number, number]> {
        return [...L.upper, ...[...L.lower].reverse()];
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        if (!L) return false;
        if (pointInPolygon(px, py, this.bandPolygon(L))) return true;
        return polylineHit(px, py, L.mid, tol) || polylineHit(px, py, L.upper, tol) || polylineHit(px, py, L.lower, tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const L = this.layout(proj);
        if (L && L.mid.length > 0) return [L.mid[0]!]; // the grab handle sits on the curve's anchor end
        const a = this.anchors[0];
        if (!a) return [];
        const y = proj.yOf(a.price, this.paneId);
        return y == null ? [] : [[proj.xOf(a.time), y]];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const L = this.layout(proj);
        if (!L) return null;
        const pts = [...L.upper, ...L.lower];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    priceRange(): { min: number; max: number } | null {
        return this.cachedRange;
    }

    /** Spans anchor→last-bar (cached from the last compute); null before the first paint so it
     *  isn't culled from autoscale prematurely. */
    override timeExtent(): { min: number; max: number } | null {
        return this.cachedExtent;
    }

    schema(): SettingsSchema {
        // Custom paths the settings popup renders as dedicated VWAP controls (midline color +
        // style, the band multiplier, the two band-line colors, and the fill).
        return {
            fields: [
                { path: 'vwap.midColor', label: 'VWAP color', kind: 'color', group: 'line' },
                { path: 'vwap.midStyle', label: 'VWAP style', kind: 'lineStyle', group: 'line' },
                { path: 'vwap.multiplier', label: 'Band multiplier', kind: 'number', min: 0.5, max: 5, step: 0.5, group: 'behavior' },
                { path: 'vwap.upperColor', label: 'Upper band color', kind: 'color', group: 'line' },
                { path: 'vwap.lowerColor', label: 'Lower band color', kind: 'color', group: 'line' },
                { path: 'vwap.bandFill', label: 'Band fill', kind: 'color', group: 'fill' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.vwap };
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.vwap = { ...defaultVwapStyle(), ...(props as Partial<VwapStyle>) };
    }
}

/** True when the pixel is within `tol` of any segment of a polyline. */
function polylineHit(px: number, py: number, pts: ReadonlyArray<[number, number]>, tol: number): boolean {
    for (let i = 1; i < pts.length; i += 1) {
        if (distToSegment(px, py, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]) <= tol) return true;
    }
    return false;
}
