import type { VelaTheme } from '../../../core/options';
import type { LineStyle } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { formatAxisValue, formatTimeStamp } from './ticks';
import { readableText } from '../backend/gl/color';
import { percentScaleFor } from './ChromeRenderer';

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
    private shade: { x: number; width: number; height: number } | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /** The plot area the last frame veiled for `crosshairOverride.shadeRight` — from the
     *  picked bar's right edge to the price scale, full plot height (the union when both the
     *  local and a synced crosshair veil) — or null when no veil was painted. */
    get shadeRightArea(): { x: number; width: number; height: number } | null {
        return this.shade;
    }

    /** Clear the cursor canvas and (re)draw the crosshair lines + axis chips. The optional
     *  `separatorHoverY` highlights the draggable pane separator under the cursor;
     *  `external` is a SYNCED ghost crosshair (another chart's pointer, pixel-resolved). */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, separatorHoverY: number | null = null, external: { x: number; y: number | null; time: number; price?: number | null; line?: boolean } | null = null): void {
        this.shade = null;
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        // Pane-separator hover affordance — drawn before the crosshair-presence guard so it
        // shows even while a resize drag has the crosshair sitting right on the boundary.
        if (separatorHoverY !== null) this.drawSeparatorHover(ctx, canvas.width / dpr, theme, separatorHoverY);

        // External (synced) ghost — drawn dimmer and FIRST, so a real local pointer
        // paints over it, and drawn regardless of the local-crosshair presence guard.
        if (external) this.drawExternal(ctx, external, scene, coords, theme);

        const ch = scene.crosshair;
        const dataW = coords.width;
        const dataH = coords.height;
        if (!ch || ch.x < 0 || ch.x > dataW || ch.y < 0 || ch.y > dataH) return;

        const cs = scene.style.crosshair;
        const ov = scene.crosshairOverride;
        const vertical = ov?.vertical !== false;
        const horizontal = ov?.horizontal !== false;
        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';

        // snap the vertical line to the nearest bar center
        const logical = Math.round(coords.xToLogical(ch.x));
        const x = crisp(coords.logicalToX(logical), ov?.width ?? cs.width);
        if (vertical && ov?.shadeRight) {
            // From the bar's right edge: the bar under the line stays in the clear.
            const from = Math.max(0, Math.round(coords.logicalToX(logical + 0.5)));
            if (from < dataW) this.paintShade(ctx, ov.shadeRight, from, dataW, dataH);
        }
        ctx.strokeStyle = ov?.color ?? cs.color ?? theme.textColor;
        ctx.lineWidth = ov?.width ?? cs.width;
        ctx.globalAlpha = ov?.opacity ?? cs.opacity;
        setDash(ctx, ov?.style ?? cs.style);
        ctx.beginPath();
        if (vertical) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, dataH);
        }
        if (horizontal) {
            ctx.moveTo(0, Math.round(ch.y) + 0.5);
            ctx.lineTo(dataW, Math.round(ch.y) + 0.5);
        }
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
        // An unscaled pane (axisFormat 'none') has no value axis, so no value chip either.
        if (horizontal && pane && pane.axisFormat !== 'none') {
            const price = coords.yToPrice(ch.y, pane.scale, pane.bounds);
            this.chip(ctx, dataW + 1, ch.y, formatAxisValue(pane.scale, pane.bounds.height, price, percentScaleFor(scene, pane), scene.priceMintick, pane.axisFormat), chipBg, 'left', false, theme.background);
        }
        // time chip on the bottom axis
        if (vertical) this.chip(ctx, x, dataH + 1, formatTimeStamp(coords.logicalToTime(logical), scene.timezone, coords.barInterval), chipBg, 'center', true, theme.background);
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
        this.shade = null;
    }

    /** The synced ghost: a dimmed vertical line at the bar the renderer resolved as
     *  CONTAINING the foreign time (+ horizontal line when a comparable price came
     *  along), with that bar's time chip in this chart's own timezone and — when the
     *  level resolved — the price chip on the right axis. The snap happened upstream
     *  (`externalCrossPx`, floor-to-containing-bar) — this method only draws. Chips
     *  render slightly dimmed so the ghost still reads as foreign. A `crosshairOverride`
     *  applies to the ghost as well — its line style, a dropped horizontal line, and the
     *  `shadeRight` veil from the ghost bar's right edge — so a pick that spans several
     *  charts reads the same on every one of them. */
    private drawExternal(ctx: CanvasRenderingContext2D, ext: { x: number; y: number | null; time: number; price?: number | null; line?: boolean }, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        const cs = scene.style.crosshair;
        const ov = scene.crosshairOverride;
        const dataW = coords.width;
        const dataH = coords.height;
        const x = crisp(ext.x, ov?.width ?? cs.width);
        if (ov?.vertical === false) return;
        if (ov?.shadeRight) {
            // Even with the ghost off the window: left of it, every bar in view is veiled.
            const from = Math.max(0, Math.round(coords.logicalToX(Math.round(coords.xToLogical(ext.x)) + 0.5)));
            if (from < dataW) this.paintShade(ctx, ov.shadeRight, from, dataW, dataH);
        }
        if (ext.line === false || x < 0 || x > dataW) return;
        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = ov?.color ?? cs.color ?? theme.textColor;
        ctx.lineWidth = ov?.width ?? cs.width;
        ctx.globalAlpha = (ov?.opacity ?? cs.opacity) * 0.55; // a ghost — dimmer than the local crosshair
        setDash(ctx, ov?.style ?? cs.style);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, dataH);
        if (ext.y != null && ov?.horizontal !== false) {
            ctx.moveTo(0, Math.round(ext.y) + 0.5);
            ctx.lineTo(dataW, Math.round(ext.y) + 0.5);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8; // chips stay readable but still read as foreign
        const chipBg = cs.labelBackground ?? theme.borderColor;
        if (ext.y != null && ext.price != null && ov?.horizontal !== false) {
            // Same chip the local crosshair puts on the axis, at the ghost's level —
            // formatted on the pane under the line (the price pane, by construction).
            let pane: PaneNode | undefined;
            for (const p of scene.panes.values()) {
                if (ext.y >= p.bounds.top && ext.y <= p.bounds.top + p.bounds.height) {
                    pane = p;
                    break;
                }
            }
            if (pane && pane.axisFormat !== 'none') {
                this.chip(ctx, dataW + 1, ext.y, formatAxisValue(pane.scale, pane.bounds.height, ext.price, percentScaleFor(scene, pane), scene.priceMintick, pane.axisFormat), chipBg, 'left', false, theme.background);
            }
        }
        this.chip(ctx, x, dataH + 1, formatTimeStamp(ext.time, scene.timezone, coords.barInterval), chipBg, 'center', true, theme.background);
        ctx.globalAlpha = 1;
    }

    /** Paint the `shadeRight` veil from `from` to the price scale and record the veiled area. */
    private paintShade(ctx: CanvasRenderingContext2D, shade: { color: string; opacity?: number }, from: number, dataW: number, dataH: number): void {
        ctx.fillStyle = shade.color;
        ctx.globalAlpha = shade.opacity ?? 1;
        ctx.fillRect(from, 0, dataW - from, dataH);
        ctx.globalAlpha = 1;
        const x = this.shade ? Math.min(this.shade.x, from) : from;
        this.shade = { x, width: dataW - x, height: dataH };
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

/** A vertical line's x on the pixel grid: odd widths centre on a half pixel, even ones on
 *  a pixel edge — either way the stroke fills whole pixels instead of blurring across two. */
function crisp(px: number, width: number): number {
    return Math.round(px) + (Math.round(width) % 2 === 1 ? 0.5 : 0);
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}
