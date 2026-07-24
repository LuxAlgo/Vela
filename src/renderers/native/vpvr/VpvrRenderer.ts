import type { OHLCV } from '../../../core/model/ohlcv';
import type { VpvrLayerData } from '../../../core/model/volume-layers';
import type { VelaTheme } from '../../../core/options';
import type { CoordinateSystem, PriceScale, PaneBounds } from '../core/CoordinateSystem';
import { buildVpvrProfile, type VpvrProfile } from './profile';
import { paintVpvr } from './paintVpvr';

interface VpvrRenderArgs {
    bars: readonly OHLCV[];
    /** Layer config pushed by the VPVR native indicator (null ⇒ layer off). */
    data: VpvrLayerData | null;
    /** The indicator is mounted and not hidden. */
    visible: boolean;
    coords: CoordinateSystem;
    /** The price pane's scale (row y-positions are real prices) + pixel extent. */
    scale: PriceScale;
    bounds: PaneBounds;
    theme: VelaTheme;
}

/**
 * The VPVR layer: its own canvas2d surface mounted ABOVE the data canvas (the profile
 * reads over the candles), painting the visible-range
 * volume-by-price rows against the right edge. It re-buckets from the chart's bars per
 * frame — memoized on the visible window — so the profile tracks pan/zoom smoothly with
 * no orchestrator round-trip. Row widths are screen fractions (its own horizontal
 * scale); only the y-axis uses the shared price scale, so autoscale is untouched.
 */
export class VpvrRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private memoKey = '';
    private memo: VpvrProfile | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
        this.memoKey = '';
        this.memo = null;
    }

    render(args: VpvrRenderArgs): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;
        const { bars, data, visible, coords, scale, bounds, theme } = args;

        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); // always clear — a hide/remove must wipe the last frame
        if (!data || !visible || bars.length === 0 || bounds.height <= 0) return;

        const r = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(r.from));
        const i1 = Math.min(bars.length - 1, Math.ceil(r.to));
        if (i0 > i1) return;

        // Memoize the bucketing on the visible window + the forming bar (its OHLCV mutates
        // in place on live ticks) + the shape inputs; pans/zooms hit the cache mid-gesture
        // only when the window is unchanged, which is exactly when recompute is waste.
        const last = bars[i1]!;
        const key = `${i0}:${i1}:${bars.length}:${last.high}:${last.low}:${last.close}:${last.volume ?? 0}:${data.rows}:${data.valueAreaFrac}`;
        if (key !== this.memoKey) {
            this.memoKey = key;
            this.memo = buildVpvrProfile(bars, i0, i1, data.rows, data.valueAreaFrac);
        }
        const profile = this.memo;
        if (!profile) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, bounds.top, coords.width, bounds.height); // clip to the price pane's data area
        ctx.clip();
        paintVpvr(ctx, profile, {
            rightX: coords.width,
            maxW: coords.width * data.widthFrac,
            yOf: (p) => coords.priceToY(p, scale, bounds),
        }, { upColor: data.upColor, downColor: data.downColor, showPoc: data.showPoc, pocColor: theme.textColor });
        ctx.restore();
    }
}
