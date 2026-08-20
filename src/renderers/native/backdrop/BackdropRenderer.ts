import type { VelaTheme } from '../../../core/options';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import { percentScaleFor, type SceneGraph } from '../core/SceneGraph';
import { paneAxisTicks, timeTicks } from '../chrome/ticks';
import { tzOffsetMs } from '../chrome/tz';

/**
 * The backdrop layer (L-2): session highlights + the axis gridlines, on their own
 * canvas at the very BOTTOM of the canvas pile. The grid used to be painted inside the
 * data canvas, but SDK layer canvases can slot BELOW that canvas (an indicator
 * restacked behind the candles takes its layer canvas along) — and nothing may ever
 * paint under the grid. Keeping the grid on the bottom-most canvas makes that
 * invariant structural instead of hoping every layer stays above it. Repainted on
 * data frames only, from the same scene/coords the geometry backend reads.
 */
export class BackdropRenderer {
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

    /** Paint one frame: highlight bands first, gridlines on top (the order they had inside
     *  the data canvas). `gridAlpha` fades the gridlines as a reveal-under layer opens. */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, gridAlpha: number): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // Same gate as the geometry backend: no grid before data reaches the view.
        const n = coords.barCount;
        if (n === 0) return;
        const vr = coords.visibleLogicalRange();
        if (Math.min(n - 1, Math.ceil(vr.to)) < Math.max(0, Math.floor(vr.from))) return;

        this.drawHighlights(ctx, scene, coords);
        this.drawGrid(ctx, scene, coords, theme, coords.width, gridAlpha);
    }

    /** Renderer-owned session highlight bands: full-height (all panes), behind the grid.
     *  Session-zone washes (pre/post-market) paint first, host highlights on top. */
    private drawHighlights(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem): void {
        const bands = [...scene.sessionHighlightBands(), ...scene.highlights];
        if (bands.length === 0) return;
        for (const band of bands) {
            const x1 = coords.timeToX(band.from);
            const x2 = coords.timeToX(band.to);
            if (x2 < 0 || x1 > coords.width || x2 <= x1) continue;
            const cx = Math.max(0, x1);
            const cw = Math.min(coords.width, x2) - cx;
            if (cw <= 0) continue;
            ctx.fillStyle = band.color;
            ctx.fillRect(cx, 0, cw, coords.height);
        }
    }

    // ── grid ── vert/horz gate on `scene.showGrid` AND their own per-axis visibility
    // (style); each uses its own color. Pane separators are drawn on the chrome layer
    // (full-width, above the data) so series never overpaint them.
    private drawGrid(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, gridAlpha: number): void {
        const panes = scene.orderedPanes();
        const { gridVert, gridHorz } = scene.style;
        const vertColor = gridVert.color ?? theme.gridColor;
        const horzColor = gridHorz.color ?? theme.gridColor;
        ctx.lineWidth = 1;
        if (scene.showGrid && gridVert.visible) {
            ctx.globalAlpha = gridAlpha; // fade the grid out as a reveal-under style opens up
            ctx.strokeStyle = vertColor;
            const tr = coords.visibleTimeRange();
            const offset = tzOffsetMs((tr.from + tr.to) / 2, scene.timezone);
            ctx.beginPath();
            for (const tick of timeTicks(tr.from, tr.to, 8, offset)) {
                const x = Math.round(coords.timeToX(tick.time)) + 0.5;
                if (x < 0 || x > dataW) continue;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, coords.height);
            }
            ctx.stroke();
        }
        for (const pane of panes) {
            if (scene.showGrid && gridHorz.visible && !pane.collapsed) {
                ctx.globalAlpha = gridAlpha; // fade horizontal gridlines so they don't show through fading candles
                ctx.strokeStyle = horzColor;
                const pct = percentScaleFor(scene, pane);
                ctx.beginPath();
                for (const t of paneAxisTicks(pane.scale, pane.bounds.height, pct, undefined, pane.axisFormat)) {
                    const y = Math.round(coords.priceToY(t.price, pane.scale, pane.bounds)) + 0.5;
                    if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) continue;
                    ctx.moveTo(0, y);
                    ctx.lineTo(dataW, y);
                }
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }
}
