import type { VelaTheme } from '../../../core/options';
import type { LineStyle } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { formatAxisValue } from './ticks';
import { readableText } from '../backend/gl/color';
import { percentScaleFor } from './ChromeRenderer';
import { zonedDate } from './tz';

/**
 * Renderer-owned crosshair layer (chrome). Lives on its OWN transparent canvas
 * stacked above the data canvas so a pointer move repaints ONLY the crosshair —
 * the data layer (series/fills/drawings/axes/grid) is left untouched. This is the
 * Scheduler's "Cursor" tier: hovering no longer clears + re-autoscales + redraws
 * the whole scene every frame.
 *
 * It is always canvas2d and independent of the data backend (canvas2d now, the
 * WebGL2 backend later) — the GPU path never touches the crosshair.
 */
export class CrosshairRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /** Clear the cursor canvas and (re)draw the crosshair lines + axis chips. The optional
     *  `separatorHoverY` highlights the draggable pane separator under the cursor. */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, separatorHoverY: number | null = null): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // Pane-separator hover affordance — drawn before the crosshair-presence guard so it
        // shows even while a resize drag has the crosshair sitting right on the boundary.
        if (separatorHoverY !== null) this.drawSeparatorHover(ctx, canvas.width / dpr, theme, separatorHoverY);

        const ch = scene.crosshair;
        const dataW = coords.width;
        const dataH = coords.height;
        if (!ch || ch.x < 0 || ch.x > dataW || ch.y < 0 || ch.y > dataH) return;

        const cs = scene.style.crosshair;
        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';

        // snap the vertical line to the nearest bar center
        const logical = Math.round(coords.xToLogical(ch.x));
        const x = Math.round(coords.logicalToX(logical)) + 0.5;
        ctx.strokeStyle = cs.color ?? theme.textColor;
        ctx.lineWidth = cs.width;
        ctx.globalAlpha = cs.opacity;
        setDash(ctx, cs.style);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, dataH);
        ctx.moveTo(0, Math.round(ch.y) + 0.5);
        ctx.lineTo(dataW, Math.round(ch.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;

        // price chip on the right axis for the pane under the cursor. Linear scan
        // over the pane map (no sort/alloc) — panes don't overlap in Y, and this
        // runs on the hot Cursor-tier path on every pointer move.
        let pane: PaneNode | undefined;
        for (const p of scene.panes.values()) {
            if (ch.y >= p.bounds.top && ch.y <= p.bounds.top + p.bounds.height) {
                pane = p;
                break;
            }
        }
        const chipBg = cs.labelBackground ?? theme.borderColor;
        if (pane) {
            const price = coords.yToPrice(ch.y, pane.scale, pane.bounds);
            this.chip(ctx, dataW + 1, ch.y, formatAxisValue(pane.scale, pane.bounds.height, price, percentScaleFor(scene, pane), scene.priceMintick, pane.axisFormat), chipBg, 'left', false, theme.background);
        }
        // time chip on the bottom axis
        this.chip(ctx, x, dataH + 1, formatStamp(coords.logicalToTime(logical), scene.timezone), chipBg, 'center', true, theme.background);
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    /** A soft band + a brighter crisp center line over the hovered separator, so it reads as
     *  a draggable handle (the cursor is already `row-resize`). Spans the full width (data +
     *  scale gutter) to match the separator itself. Theme-derived (textColor). */
    private drawSeparatorHover(ctx: CanvasRenderingContext2D, fullW: number, theme: VelaTheme, y: number): void {
        const yy = Math.round(y);
        ctx.fillStyle = theme.textColor;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(0, yy - 4, fullW, 8);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, yy - 1, fullW, 2);
        ctx.globalAlpha = 1;
    }

    private chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, align: 'left' | 'center', below = false, over = '#000000'): void {
        const w = ctx.measureText(text).width + 8;
        const h = 16;
        const rx = align === 'left' ? x : x - w / 2;
        const ry = below ? y : y - h / 2;
        ctx.fillStyle = bg;
        ctx.fillRect(rx, ry, w, h);
        ctx.fillStyle = readableText(bg, over); // legible whatever the chip color is (light or dark)
        ctx.textAlign = 'center';
        ctx.fillText(text, rx + w / 2, ry + h / 2 + (below ? 2 : 0));
        ctx.textAlign = 'start';
    }
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

function formatStamp(ms: number, timeZone: string): string {
    const d = zonedDate(ms, timeZone);
    const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
