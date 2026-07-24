import type { ViewportState } from './ViewportState';
import { defaultViewport } from './ViewportState';
import { barTimeToLogical, logicalToBarTime, medianInterval } from './bar-time';

/** A pane's price window (after autoscale + margins). `log` ⇒ logarithmic mapping;
 *  `invert` ⇒ the axis is flipped (high at the bottom), stamped per frame from the pane. */
export interface PriceScale {
    min: number;
    max: number;
    log?: boolean;
    invert?: boolean;
}

/** A pane's vertical pixel extent within the chart's data area (media px). */
export interface PaneBounds {
    top: number;
    height: number;
}

/**
 * The ONE authoritative coordinate transform, shared by every layer (data
 * backend, canvas2d chrome, DOM overlays). Two decoupled axes:
 *
 * - X: a fractional **logical bar index** mapped to pixels by the viewport
 *   (`barSpacing` + `rightOffset`); bar TIME ↔ logical is a separate mapping
 *   over the loaded bar times so time and spacing stay independent.
 * - Y: a per-pane **linear/log/percent price** mapped within that pane's bounds.
 *
 * Everything is in media (CSS) pixels; `toBitmap` converts to device pixels for
 * crisp drawing. Keeping a single instance is what keeps all layers aligned.
 */
export class CoordinateSystem {
    private widthPx = 0;
    private dataHeightPx = 0;
    private devicePixelRatio = 1;
    private viewport: ViewportState = defaultViewport();
    private pitchScale = 1;
    private times: number[] = [];
    private intervalMs = 0;

    // ── geometry inputs (owned by the renderer) ──
    setSize(width: number, dataHeight: number, dpr: number): void {
        this.widthPx = width;
        this.dataHeightPx = dataHeight;
        this.devicePixelRatio = dpr > 0 ? dpr : 1;
    }

    setBars(times: readonly number[]): void {
        // Copy so the instance OWNS its buffer — `appendBar` mutates it in place, so
        // it must not alias an array the caller retains. Cost is one O(n) copy on a
        // (rare) full setData, dwarfed by the median sort below.
        this.times = times.slice();
        this.intervalMs = medianInterval(this.times);
    }

    /**
     * Append one new bar time in O(1). The bar cadence is stable, so the median
     * interval is NOT re-derived (a full re-sort per live tick would be O(n log n)).
     * It's only derived lazily — via the robust median over the bars seen so far —
     * while it's still unknown (cold start at <2 bars); the warm path is a single
     * push. `barCount` reads `times.length`, so the new bar is visible immediately.
     */
    appendBar(time: number): void {
        this.times.push(time);
        if (this.intervalMs <= 0 && this.times.length >= 2) this.intervalMs = medianInterval(this.times);
    }

    setViewport(viewport: ViewportState): void {
        this.viewport = viewport;
    }

    getViewport(): ViewportState {
        return this.viewport;
    }

    /**
     * Spacing multiplier applied to the center-to-center pixel PITCH between adjacent
     * bars (and hence the crosshair's snap step) — independent of the zoom (`barSpacing`).
     * `1` = default; `>1` spreads bars apart with real gaps; `<1` tightens them. It changes
     * only where bars SIT (`logicalToX`/`xToLogical`), never their raw zoom value, so candle
     * bodies keep their width — the extra pitch becomes gap. Body width tracks
     * {@link bodySpacing} so a `<1` multiplier shrinks bodies to fit instead of overlapping.
     */
    setPitchScale(scale: number): void {
        this.pitchScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    get spacingScale(): number {
        return this.pitchScale;
    }

    /** Effective center-to-center pixel pitch between adjacent bars (zoom × spacing multiplier). */
    pxPerBar(): number {
        return this.viewport.barSpacing * this.pitchScale;
    }

    /**
     * Pixel basis for element (candle/bar/column) BODY width. Kept at the raw zoom pitch so
     * bodies keep their width while the multiplier only adds gap; capped at the effective pitch
     * so a `<1` multiplier tightens bodies to fit rather than overlapping the neighbours.
     */
    bodySpacing(): number {
        return this.viewport.barSpacing * Math.min(1, this.pitchScale);
    }

    get width(): number {
        return this.widthPx;
    }

    get height(): number {
        return this.dataHeightPx;
    }

    get dpr(): number {
        return this.devicePixelRatio;
    }

    get barCount(): number {
        return this.times.length;
    }

    get barInterval(): number {
        return this.intervalMs;
    }

    /** The logical index that sits exactly at the right pixel edge of the chart. */
    get rightEdgeLogical(): number {
        return this.barCount - 1 + this.viewport.rightOffset;
    }

    // ── X axis: logical bar index ↔ pixel (via the effective pitch = zoom × spacing multiplier) ──
    logicalToX(logical: number): number {
        return this.widthPx - (this.rightEdgeLogical - logical) * this.pxPerBar();
    }

    xToLogical(x: number): number {
        return this.rightEdgeLogical - (this.widthPx - x) / this.pxPerBar();
    }

    // ── bar time ↔ logical ↔ pixel ──
    timeToLogical(ms: number): number {
        return barTimeToLogical(ms, this.times, this.intervalMs);
    }

    logicalToTime(logical: number): number {
        return logicalToBarTime(logical, this.times, this.intervalMs);
    }

    timeToX(ms: number): number {
        return this.logicalToX(this.timeToLogical(ms));
    }

    // ── Y axis: price ↔ pixel (per pane scale + bounds; linear or logarithmic) ──
    //   `t` is the fraction from min (0) to max (1); a normal axis puts max at the top
    //   (`1 - t`), an inverted axis puts it at the bottom (`t`).
    priceToY(price: number, scale: PriceScale, bounds: PaneBounds): number {
        if (scale.log && scale.min > 0 && scale.max > scale.min && price > 0) {
            const lo = Math.log(scale.min);
            const t = (Math.log(price) - lo) / (Math.log(scale.max) - lo);
            return bounds.top + bounds.height * (scale.invert ? t : 1 - t);
        }
        const span = scale.max - scale.min;
        if (span <= 0) return bounds.top + bounds.height / 2;
        const t = (price - scale.min) / span;
        return bounds.top + bounds.height * (scale.invert ? t : 1 - t);
    }

    yToPrice(y: number, scale: PriceScale, bounds: PaneBounds): number {
        if (bounds.height <= 0) return scale.min;
        const u = (y - bounds.top) / bounds.height; // 0 at the top edge … 1 at the bottom
        const t = scale.invert ? u : 1 - u;
        if (scale.log && scale.min > 0 && scale.max > scale.min) {
            const lo = Math.log(scale.min);
            return Math.exp(lo + t * (Math.log(scale.max) - lo));
        }
        return scale.min + (scale.max - scale.min) * t;
    }

    // ── visible ranges ──
    visibleLogicalRange(): { from: number; to: number } {
        return { from: this.xToLogical(0), to: this.xToLogical(this.widthPx) };
    }

    visibleTimeRange(): { from: number; to: number } {
        const r = this.visibleLogicalRange();
        return { from: this.logicalToTime(r.from), to: this.logicalToTime(r.to) };
    }

    // ── media (CSS px) ↔ bitmap (device px) ──
    toBitmap(mediaPx: number): number {
        return Math.round(mediaPx * this.devicePixelRatio);
    }
}
