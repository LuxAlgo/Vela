import type { OHLCV } from '../../../core/model/ohlcv';
import type { VolumeLayerData } from '../../../core/model/volume-layers';
import type { CoordinateSystem, PaneBounds } from '../core/CoordinateSystem';
import { paintVolume } from './paintVolume';

/** Fraction of its own (study) pane the tallest visible volume column fills — leaves a sliver
 *  of headroom on top. Shared with the renderer's autoscale so the axis labels line up with the
 *  columns exactly (a value `v` sits at `(v / maxVol) * VOLUME_PANE_FILL_FRAC` of the pane). */
export const VOLUME_PANE_FILL_FRAC = 0.96;

/** Half-width (px) of one volume column — the candle body's half-width formula, so columns line up under their candles. */
function columnHalfWidth(barSpacing: number): number {
    return Math.max(0.5, Math.floor(barSpacing * 0.7) / 2);
}

interface VolumeRenderArgs {
    bars: readonly OHLCV[];
    /** Layer config pushed by the volume native indicator (null ⇒ layer off). */
    data: VolumeLayerData | null;
    /** The indicator is mounted and not hidden. */
    visible: boolean;
    coords: CoordinateSystem;
    /** The pixel extent of the pane the volume indicator lives in (columns clip to it). */
    bounds: PaneBounds;
    /** True when the indicator was moved into its own (study) pane — columns fill the pane
     *  instead of hugging `heightFrac` of it (the price-pane overlay proportion). */
    fillPane: boolean;
}

/**
 * The volume layer: its own canvas2d surface mounted BEHIND the data canvas, painting
 * bottom-anchored per-bar volume columns on the price pane. The columns carry their OWN
 * scale — the tallest VISIBLE bar spans `data.heightFrac` of the pane — computed here
 * each frame, so volume units never reach the price autoscale. Renderer-owned +
 * ephemeral (not part of the indicator model), like a plugin renderer layer.
 */
export class VolumeRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    render(args: VolumeRenderArgs): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;
        const { bars, data, visible, coords, bounds, fillPane } = args;

        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); // always clear — a hide/remove must wipe the last frame
        if (!data || !visible || bars.length === 0 || bounds.height <= 0) return;

        // Visible bar-index window (bar index = logical index), padded nowhere — a half-off
        // column at either edge is included via the floor/ceil.
        const r = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(r.from));
        const i1 = Math.min(bars.length - 1, Math.ceil(r.to));
        if (i0 > i1) return;

        let maxVol = 0;
        for (let i = i0; i <= i1; i += 1) {
            const v = bars[i]?.volume;
            if (v != null && v > maxVol) maxVol = v;
        }
        if (maxVol <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, bounds.top, coords.width, bounds.height); // clip to the host pane's data area
        ctx.clip();
        paintVolume(ctx, bars, {
            i0,
            i1,
            xOf: (i) => coords.logicalToX(i),
            halfW: columnHalfWidth(coords.bodySpacing()),
            bottomY: bounds.top + bounds.height,
            // In its own pane the tallest visible bar nearly fills the pane; as a price-pane
            // overlay it occupies the configured bottom fraction.
            maxH: bounds.height * (fillPane ? VOLUME_PANE_FILL_FRAC : data.heightFrac),
            maxVol,
        }, { up: data.upColor, down: data.downColor });
        ctx.restore();
    }
}
