// Canvas painting of the timeline-mark lane: one outlined token per glyph (circle, square,
// diamond or pin) drawn in the mark's color on the plot background, carrying a letter or a
// registry icon in that same color; a hairline stem down to the time-axis line; and a
// background-colored halo so the cards of a collapsed deck separate. The token the pointer
// lands on swells once and settles; the one whose popup is open (or that was just clicked)
// paints filled — color for the body and outline, white ink. Icons are SVG in the registry; the
// canvas gets them as images rasterized once per (icon, ink, size) and cached — the first
// frame after a cache miss paints the bare token and the renderer repaints when the image
// lands.
import { iconMarkup } from '../../../../core/icons';
import type { MarkShape } from '../../../../core/marks/types';
import type { MarkLaneLayout } from './layout';

/** The hover pulse — one swell-and-settle when the pointer lands on a token — ms. */
export const MARK_PULSE_MS = 360;
/** How much the token grows at the pulse's peak (a fraction of its size). */
export const MARK_PULSE_AMPLITUDE = 0.1;
/** Ink of a filled (active) token. */
const ACTIVE_INK = '#ffffff';

export interface MarkPaintDeps {
    /** The time-axis line's y — every stack's base glyph drops a stem onto it. */
    axisY: number;
    /** The plot background: the idle token's fill and the separating halo. */
    background: string;
    /** Stem color (the axis border). */
    stemColor: string;
    fontFamily: string;
    dpr: number;
    icons: MarkIconRaster;
    /** The cluster under the pointer (it pulsed once when the pointer landed) and when that hover began, frame-clock ms. */
    hoverKey: string | null;
    hoverSince: number;
    /** The cluster whose popup is open — painted filled. */
    activeKey: string | null;
    /** A just-clicked content-less cluster — painted filled for a moment. */
    flashKey: string | null;
    /** The frame clock, ms. */
    nowMs: number;
}

/** The hovered token's size multiplier `elapsed` ms into the hover: one swell to 1 + amplitude at mid-pulse, back to 1 at its end, 1 ever after. */
export function pulseScale(elapsedMs: number): number {
    if (!(elapsedMs > 0) || elapsedMs >= MARK_PULSE_MS) return 1;
    return 1 + MARK_PULSE_AMPLITUDE * Math.sin((Math.PI * elapsedMs) / MARK_PULSE_MS);
}

export function paintMarkLane(ctx: CanvasRenderingContext2D, layout: MarkLaneLayout, deps: MarkPaintDeps): void {
    if (layout.glyphs.length === 0) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const g of layout.glyphs) {
        const mark = g.cluster.marks[0];
        if (!mark) continue;
        const key = g.cluster.key;
        const color = mark.glyph.color;
        const active = key === deps.activeKey || key === deps.flashKey;
        const size = g.size * (key === deps.hoverKey ? pulseScale(deps.nowMs - deps.hoverSince) : 1);
        if (g.depth === 0) {
            // The stem ties the stack to its bar on the axis line.
            const sx = Math.round(g.x) + 0.5;
            ctx.lineWidth = 1;
            ctx.strokeStyle = deps.stemColor;
            ctx.beginPath();
            ctx.moveTo(sx, g.y + g.size / 2);
            ctx.lineTo(sx, deps.axisY);
            ctx.stroke();
        }
        const shape = mark.glyph.shape ?? 'circle';
        // Halo: a background-colored ring under the outline separates deck cards and lifts the token off the candles.
        const center = traceShape(ctx, shape, g.x, g.y, size);
        ctx.lineWidth = 4;
        ctx.strokeStyle = deps.background;
        ctx.stroke();
        ctx.fillStyle = active ? color : deps.background;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
        const ink = active ? ACTIVE_INK : color;
        const symbolPx = Math.round(size * 0.62);
        if (mark.glyph.icon) {
            const img = deps.icons.get(mark.glyph.icon, ink, symbolPx, deps.dpr);
            if (img) ctx.drawImage(img, center.x - symbolPx / 2, center.y - symbolPx / 2, symbolPx, symbolPx);
        } else if (mark.glyph.letter) {
            ctx.fillStyle = ink;
            ctx.font = `600 ${Math.round(size * 0.58)}px ${deps.fontFamily}`;
            ctx.fillText(mark.glyph.letter.slice(0, 2), center.x, center.y + 0.5);
        }
    }
    ctx.restore();
}

/** Trace a token outline centered at (x, y) and return where its symbol centers (a pin's head sits above its tail). */
function traceShape(ctx: CanvasRenderingContext2D, shape: MarkShape, x: number, y: number, size: number): { x: number; y: number } {
    const r = size / 2;
    ctx.beginPath();
    switch (shape) {
        case 'square': {
            const c = Math.min(3, r / 2);
            roundedRect(ctx, x - r, y - r, size, size, c);
            return { x, y };
        }
        case 'diamond':
            ctx.moveTo(x, y - r);
            ctx.lineTo(x + r, y);
            ctx.lineTo(x, y + r);
            ctx.lineTo(x - r, y);
            ctx.closePath();
            return { x, y };
        case 'pin': {
            // A round head over a short tail that points at the bar.
            const hr = r * 0.82;
            const hy = y - r + hr;
            ctx.arc(x, hy, hr, Math.PI * 0.75, Math.PI * 0.25, false);
            ctx.lineTo(x, y + r);
            ctx.closePath();
            return { x, y: hy };
        }
        case 'circle':
        default:
            ctx.arc(x, y, r, 0, Math.PI * 2);
            return { x, y };
    }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Registry icons as canvas-drawable images, keyed by (icon, ink, px, dpr). A miss starts
 * the load and answers null; `onReady` fires when the image lands so the owner can
 * repaint. Icons are HTML-parsed then XML-serialized: the registry's markup is written
 * for `innerHTML` (duplicate attributes, no namespace), which a standalone SVG image
 * would refuse.
 */
export class MarkIconRaster {
    private readonly cache = new Map<string, HTMLImageElement | null>();

    constructor(private readonly onReady: () => void) {}

    get(icon: string, ink: string, px: number, dpr: number): HTMLImageElement | null {
        const key = `${icon}|${ink}|${px}|${dpr}`;
        if (this.cache.has(key)) {
            const img = this.cache.get(key);
            return img && img.complete && img.naturalWidth > 0 ? img : null;
        }
        const markup = iconMarkup(icon);
        if (!markup || typeof document === 'undefined' || typeof Image === 'undefined' || typeof XMLSerializer === 'undefined') {
            this.cache.set(key, null);
            return null;
        }
        const svg = standaloneSvg(markup, ink, Math.max(1, Math.ceil(px * dpr)));
        if (!svg) {
            this.cache.set(key, null);
            return null;
        }
        const img = new Image();
        img.onload = () => this.onReady();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        this.cache.set(key, img);
        return null;
    }

    clear(): void {
        this.cache.clear();
    }
}

function standaloneSvg(markup: string, ink: string, px: number): string | null {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup;
    const svg = tpl.content.firstElementChild;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') return null;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(px));
    svg.setAttribute('height', String(px));
    svg.setAttribute('color', ink); // what `currentColor` resolves to in a standalone image
    return new XMLSerializer().serializeToString(svg);
}
