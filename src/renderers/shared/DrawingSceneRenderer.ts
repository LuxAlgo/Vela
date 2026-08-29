import type {
    DrawingLine,
    DrawingBox,
    DrawingLabel,
    DrawingPolyline,
    DrawingLinefill,
    DrawingExtend,
    BoxTextSize,
} from '../../core/model/drawings';
import type { VelaTheme } from '../../core/options';
import { dashPattern, extendEndpoints, contrastColor, namedFontSize, autoFontSize } from './drawing-geometry';

/** The full set of Pine drawings for one indicator, batched into one pass. */
export interface DrawingSet {
    lines: DrawingLine[];
    boxes: DrawingBox[];
    labels: DrawingLabel[];
    polylines: DrawingPolyline[];
    linefills: DrawingLinefill[];
}

/** Renderer-side resolvers (kept out of core); identical across backends. */
export interface LayerDeps {
    /** Drawing `bar_time` (ms) → fractional logical bar index. */
    timeToLogical: (ms: number) => number;
    /** Bar high/low at a (rounded) logical index, for label yloc above/below. */
    barAt: (logical: number) => { high: number; low: number } | null;
    theme: VelaTheme;
}

/** Drawing price range over the visible bar window (backend-neutral autoscale geometry). */
export interface DrawingPriceRange {
    min: number;
    max: number;
    aboveMargin: number;
    belowMargin: number;
}

export const EMPTY_DRAWING_SET: DrawingSet = { lines: [], boxes: [], labels: [], polylines: [], linefills: [] };

/** A model shape carrying optional Pine drawing arrays (structurally `IndicatorModel`). */
export interface DrawingSetSource {
    lines?: DrawingLine[];
    boxes?: DrawingBox[];
    labels?: DrawingLabel[];
    polylines?: DrawingPolyline[];
    linefills?: DrawingLinefill[];
}

/** A model's Pine drawings routed ONE way: its own pane (`overlay` false) or forced onto
 *  the price pane (`overlay` true, Pine's `force_overlay`) — every consumer of a model's
 *  drawings splits along this same seam. */
export function modelDrawingSet(m: DrawingSetSource, overlay: boolean): DrawingSet {
    const want = (d: { overlay?: boolean }): boolean => Boolean(d.overlay) === overlay;
    return {
        lines: (m.lines ?? []).filter(want),
        boxes: (m.boxes ?? []).filter(want),
        labels: (m.labels ?? []).filter(want),
        polylines: (m.polylines ?? []).filter(want),
        linefills: (m.linefills ?? []).filter(want),
    };
}

/** True when the set draws nothing at all. */
export function drawingSetEmpty(s: DrawingSet): boolean {
    return !s.lines.length && !s.boxes.length && !s.labels.length && !s.polylines.length && !s.linefills.length;
}

/** Hover hit-rect of one rendered label that carries a tooltip (canvas coords of the last render). */
export interface LabelTipRegion {
    left: number;
    top: number;
    right: number;
    bottom: number;
    text: string;
}

function fontSizePx(size: BoxTextSize): number {
    return size === 'auto' ? 12 : namedFontSize(size);
}

/**
 * Whether any painted part of a line — anchor segment plus its `extend`
 * projection — crosses the visible bar window `[lo, hi]` (logical x). A vertical
 * line (x1 == x2) extends along itself, so extend adds no horizontal coverage.
 */
function lineCoversWindow(a: number, b: number, extend: DrawingExtend, lo: number, hi: number): boolean {
    const minX = Math.min(a, b);
    const maxX = Math.max(a, b);
    if (a === b) return a >= lo && a <= hi;
    if (extend === 'both') return true;
    if (extend === 'left') return maxX >= lo;
    if (extend === 'right') return minX <= hi;
    return maxX >= lo && minX <= hi;
}

/**
 * Backend-agnostic renderer for all Pine drawing objects (line/box/label/
 * polyline/linefill) — shared verbatim by the lightweight-charts `DrawingLayer`
 * primitive and the native renderer. The caller supplies a canvas2d context plus
 * `xOf` (logical→x) / `yOf` (price→y) closures; this class owns ONLY the drawing
 * logic + a measureText cache. Order, bottom→top: linefills → boxes → polylines
 * → lines → labels.
 */
export class DrawingSceneRenderer {
    /** measureText width cache, keyed by `${font} ${text}`, persists across frames. */
    private readonly widthCache = new Map<string, number>();
    /** Tooltip hit-rects captured while drawing the CURRENT set (rebuilt per render). */
    private tipRegions: LabelTipRegion[] = [];
    /**
     * Index offset of the CURRENT set's model: its `xloc:'bar_index'` coordinates count
     * from the model's anchor bar, so they shift by this to land on chart logical indices.
     * 0 (the norm) for whole-chart models; set alongside `setSet` when rendering a model
     * computed over a suffix of the bars. `bar_time` coordinates are unaffected.
     */
    private indexOffset = 0;

    constructor(
        private deps: LayerDeps,
        private set: DrawingSet = EMPTY_DRAWING_SET,
    ) {}

    setSet(set: DrawingSet, indexOffset = 0): void {
        this.set = set;
        this.indexOffset = indexOffset;
    }

    /** Refresh the coordinate/theme resolvers (the native backend rebinds per frame). */
    setDeps(deps: LayerDeps): void {
        this.deps = deps;
    }

    isEmpty(): boolean {
        const s = this.set;
        return !s.lines.length && !s.boxes.length && !s.labels.length && !s.polylines.length && !s.linefills.length;
    }

    /** Tooltip hit-rects of the labels drawn by the LAST `render` call (same coords as `ctx`). */
    labelTipRegions(): readonly LabelTipRegion[] {
        return this.tipRegions;
    }

    /** Draw the whole set into `ctx` using the supplied coordinate closures. */
    render(ctx: CanvasRenderingContext2D, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        this.tipRegions = [];
        if (this.isEmpty()) return;
        ctx.save();
        this.drawLinefills(ctx, W, H, xOf, yOf);
        this.drawBoxes(ctx, W, H, xOf, yOf);
        this.drawPolylines(ctx, W, xOf, yOf);
        this.drawLines(ctx, W, H, xOf, yOf);
        this.drawLabels(ctx, W, H, xOf, yOf);
        ctx.restore();
    }

    /**
     * Price min/max (+ above/below pixel margins) over the drawings intersecting
     * the visible bar range [from, to] — for autoscale. Returns null if nothing
     * in range contributes a price.
     */
    priceRange(from: number, to: number): DrawingPriceRange | null {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        // Painted-part coverage: the anchor span plus the side(s) `extend` projects
        // toward. A one-sided extension paints nothing on its other side, so a window
        // entirely there must not inherit the drawing's prices.
        const visible = (a: number, b: number, extend: DrawingExtend): boolean => {
            if (extend === 'both') return true;
            if (extend === 'left') return Math.max(a, b) >= lo;
            if (extend === 'right') return Math.min(a, b) <= hi;
            return Math.max(a, b) >= lo && Math.min(a, b) <= hi;
        };
        let min = Infinity;
        let max = -Infinity;
        const fold = (v: number): void => {
            if (v < min) min = v;
            if (v > max) max = v;
        };

        for (const ln of this.set.lines) {
            if (ln.invisible) continue;
            // A line folds its ANCHOR prices (y1/y2) while some painted part of it
            // crosses the window: the extension widens WHERE the line is, but its
            // projected values never define the scale. A vertical line (x1 == x2)
            // extends along itself — no horizontal coverage beyond its own bar — so
            // one anchored off-screen contributes nothing (it paints nothing here).
            if (!lineCoversWindow(this.logicalOf(ln.xloc, ln.x1), this.logicalOf(ln.xloc, ln.x2), ln.extend, lo, hi)) continue;
            fold(ln.y1);
            fold(ln.y2);
        }
        for (const bx of this.set.boxes) {
            if (!bx.bgColor && !(bx.borderColor && bx.borderWidth > 0) && !bx.text) continue;
            if (!visible(this.logicalOf(bx.xloc, bx.left), this.logicalOf(bx.xloc, bx.right), bx.extend)) continue;
            fold(bx.top);
            fold(bx.bottom);
        }
        for (const lf of this.set.linefills) {
            if (!lf.color) continue;
            const xs = [lf.line1.x1, lf.line1.x2, lf.line2.x1, lf.line2.x2].map((x, i) => this.logicalOf(i < 2 ? lf.line1.xloc : lf.line2.xloc, x));
            const lfExt: DrawingExtend = lf.line1.extend !== 'none' || lf.line2.extend !== 'none' ? 'both' : 'none';
            if (!visible(Math.min(...xs), Math.max(...xs), lfExt)) continue;
            fold(lf.line1.y1);
            fold(lf.line1.y2);
            fold(lf.line2.y1);
            fold(lf.line2.y2);
        }
        for (const pl of this.set.polylines) {
            if (pl.points.length < 2) continue;
            const xs = pl.points.map((p) => this.logicalOf(p.xloc, p.x));
            if (!visible(Math.min(...xs), Math.max(...xs), 'none')) continue;
            for (const p of pl.points) fold(p.price);
        }
        let aboveMargin = 0;
        let belowMargin = 0;
        for (const lb of this.set.labels) {
            const lx = this.logicalOf(lb.xloc, lb.x);
            if (!visible(lx, lx, 'none')) continue;
            if (lb.yloc === 'price') {
                fold(lb.y);
                continue;
            }
            if (lb.yloc === 'top' || lb.yloc === 'bottom') continue;
            const bar = this.deps.barAt(lx);
            if (!bar) continue;
            fold(lb.yloc === 'abovebar' ? bar.high : bar.low);
            const fontPx = fontSizePx(lb.size);
            const lineCount = Math.max(1, (lb.text ?? '').split('\n').length);
            const ext = this.isPointShape(lb.style)
                ? 14 + Math.max(4, fontPx * 0.6) + 2
                : 14 + fontPx * 1.25 * lineCount + 8 + 7;
            if (lb.yloc === 'abovebar') aboveMargin = Math.max(aboveMargin, ext);
            else belowMargin = Math.max(belowMargin, ext);
        }

        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
        return { min, max, aboveMargin, belowMargin };
    }

    private logicalOf(xloc: 'bar_index' | 'bar_time', x: number): number {
        return xloc === 'bar_time' ? this.deps.timeToLogical(x) : x + this.indexOffset;
    }

    // ── lines ────────────────────────────────────────────────────────────────
    private drawLines(ctx: CanvasRenderingContext2D, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        for (const ln of this.set.lines) {
            if (ln.invisible) continue;
            const x1 = xOf(this.logicalOf(ln.xloc, ln.x1));
            const x2 = xOf(this.logicalOf(ln.xloc, ln.x2));
            const y1 = yOf(ln.y1);
            const y2 = yOf(ln.y2);
            if (y1 === null || y2 === null) continue;

            const extL = ln.extend === 'left' || ln.extend === 'both';
            const extR = ln.extend === 'right' || ln.extend === 'both';
            if (!extL && !extR && (Math.max(x1, x2) < 0 || Math.min(x1, x2) > W)) continue;

            const [ax, ay, bx, by] = extendEndpoints(x1, y1, x2, y2, ln.extend, W, H);
            const color = ln.color ?? this.deps.theme.textColor;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = color;
            ctx.lineWidth = ln.width;
            ctx.setLineDash(dashPattern(ln.style, ln.width));
            ctx.stroke();
            ctx.setLineDash([]);

            const p2Right = x2 >= x1;
            if (ln.arrowRight) {
                const tip = (p2Right ? extR : extL) ? (p2Right ? [bx, by] : [ax, ay]) : [x2, y2];
                this.drawArrow(ctx, tip[0]!, tip[1]!, x1, y1, ln.width, color);
            }
            if (ln.arrowLeft) {
                const tip = (p2Right ? extL : extR) ? (p2Right ? [ax, ay] : [bx, by]) : [x1, y1];
                this.drawArrow(ctx, tip[0]!, tip[1]!, x2, y2, ln.width, color);
            }
        }
    }

    private drawArrow(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, fromX: number, fromY: number, width: number, color: string): void {
        const angle = Math.atan2(tipY - fromY, tipX - fromX);
        const size = 6 + width * 2;
        const spread = 0.45;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - size * Math.cos(angle - spread), tipY - size * Math.sin(angle - spread));
        ctx.lineTo(tipX - size * Math.cos(angle + spread), tipY - size * Math.sin(angle + spread));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    // ── linefills ────────────────────────────────────────────────────────────
    private drawLinefills(ctx: CanvasRenderingContext2D, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        for (const lf of this.set.linefills) {
            if (!lf.color) continue;
            const a = this.resolveLine(lf.line1, W, H, xOf, yOf);
            const b = this.resolveLine(lf.line2, W, H, xOf, yOf);
            if (!a || !b) continue;
            const orient = (s: [number, number, number, number]): [number, number, number, number] =>
                s[0] > s[2] || (s[0] === s[2] && s[1] > s[3]) ? [s[2], s[3], s[0], s[1]] : s;
            const a2 = orient(a);
            const b2 = orient(b);
            ctx.beginPath();
            ctx.moveTo(a2[0], a2[1]);
            ctx.lineTo(a2[2], a2[3]);
            ctx.lineTo(b2[2], b2[3]);
            ctx.lineTo(b2[0], b2[1]);
            ctx.closePath();
            ctx.fillStyle = lf.color;
            ctx.fill();
        }
    }

    private resolveLine(ln: DrawingLine, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): [number, number, number, number] | null {
        const x1 = xOf(this.logicalOf(ln.xloc, ln.x1));
        const x2 = xOf(this.logicalOf(ln.xloc, ln.x2));
        const y1 = yOf(ln.y1);
        const y2 = yOf(ln.y2);
        if (y1 === null || y2 === null) return null;
        return extendEndpoints(x1, y1, x2, y2, ln.extend, W, H);
    }

    // ── polylines ──────────────────────────────────────────────────────────────
    private drawPolylines(ctx: CanvasRenderingContext2D, W: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        for (const pl of this.set.polylines) {
            const pts: Array<[number, number]> = [];
            for (const p of pl.points) {
                const y = yOf(p.price);
                if (y === null) continue;
                pts.push([xOf(this.logicalOf(p.xloc, p.x)), y]);
            }
            if (pts.length < 2) continue;
            let minX = Infinity;
            let maxX = -Infinity;
            for (const p of pts) {
                if (p[0] < minX) minX = p[0];
                if (p[0] > maxX) maxX = p[0];
            }
            if (maxX < 0 || minX > W) continue;

            ctx.beginPath();
            if (pl.curved) this.curvedPath(ctx, pts, pl.closed);
            else {
                ctx.moveTo(pts[0]![0], pts[0]![1]);
                for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
            }
            if (pl.closed) ctx.closePath();

            if (pl.fillColor) {
                ctx.fillStyle = pl.fillColor;
                ctx.fill();
            }
            if (pl.lineColor) {
                ctx.strokeStyle = pl.lineColor;
                ctx.lineWidth = pl.lineWidth;
                ctx.setLineDash(dashPattern(pl.lineStyle, pl.lineWidth));
                ctx.stroke();
                ctx.setLineDash([]);

                if (pl.arrowLeft || pl.arrowRight) {
                    const segs = pl.closed ? pts.length : pts.length - 1;
                    for (let i = 0; i < segs; i += 1) {
                        const a = pts[i]!;
                        const b = pts[(i + 1) % pts.length]!;
                        if (pl.arrowRight) this.drawArrow(ctx, b[0], b[1], a[0], a[1], pl.lineWidth, pl.lineColor);
                        if (pl.arrowLeft) this.drawArrow(ctx, a[0], a[1], b[0], b[1], pl.lineWidth, pl.lineColor);
                    }
                }
            }
        }
    }

    private curvedPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, closed: boolean): void {
        const n = pts.length;
        const at = (i: number): [number, number] => {
            if (closed) return pts[((i % n) + n) % n]!;
            return pts[Math.max(0, Math.min(n - 1, i))]!;
        };
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        const last = closed ? n : n - 1;
        for (let i = 0; i < last; i += 1) {
            const p0 = at(i - 1);
            const p1 = at(i);
            const p2 = at(i + 1);
            const p3 = at(i + 2);
            const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
            const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
            const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
            const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
        }
    }

    // ── boxes ──────────────────────────────────────────────────────────────────
    private drawBoxes(ctx: CanvasRenderingContext2D, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        for (const bx of this.set.boxes) {
            let xl = xOf(this.logicalOf(bx.xloc, bx.left));
            let xr = xOf(this.logicalOf(bx.xloc, bx.right));
            if (bx.extend === 'left' || bx.extend === 'both') xl = -2;
            if (bx.extend === 'right' || bx.extend === 'both') xr = W + 2;
            const yt = yOf(bx.top);
            const yb = yOf(bx.bottom);
            if (yt === null || yb === null) continue;

            const left = Math.min(xl, xr);
            const right = Math.max(xl, xr);
            const top = Math.min(yt, yb);
            const bottom = Math.max(yt, yb);
            const w = right - left;
            const h = bottom - top;

            if (right < 0 || left > W || bottom < 0 || top > H) continue;

            if (bx.bgColor) {
                ctx.fillStyle = bx.bgColor;
                ctx.fillRect(left, top, w, h);
            }
            if (bx.borderColor && bx.borderWidth > 0) {
                ctx.strokeStyle = bx.borderColor;
                ctx.lineWidth = bx.borderWidth;
                ctx.setLineDash(dashPattern(bx.borderStyle, bx.borderWidth));
                ctx.strokeRect(left, top, w, h);
                ctx.setLineDash([]);
            }
            if (bx.text) this.drawBoxText(ctx, bx, left, top, w, h);
        }
    }

    private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
        const key = `${font} ${text}`;
        let cached = this.widthCache.get(key);
        if (cached === undefined) {
            ctx.font = font;
            cached = ctx.measureText(text).width;
            this.widthCache.set(key, cached);
        }
        return cached;
    }

    private wrapText(ctx: CanvasRenderingContext2D, font: string, text: string, maxWidth: number): string[] {
        const out: string[] = [];
        for (const para of text.split('\n')) {
            if (this.measure(ctx, font, para) <= maxWidth) {
                out.push(para);
                continue;
            }
            let line = '';
            for (const word of para.split(/(\s+)/)) {
                const trial = line + word;
                if (line && this.measure(ctx, font, trial) > maxWidth) {
                    out.push(line.trimEnd());
                    line = word.trimStart();
                } else {
                    line = trial;
                }
            }
            if (line.trim()) out.push(line.trimEnd());
        }
        return out;
    }

    private drawBoxText(ctx: CanvasRenderingContext2D, bx: DrawingBox, left: number, top: number, w: number, h: number): void {
        const text = bx.text!;
        const family = bx.fontFamily === 'monospace' ? 'monospace' : this.deps.theme.fontFamily || 'sans-serif';
        const variant = `${bx.italic ? 'italic ' : ''}${bx.bold ? 'bold ' : ''}`;
        const pad = 4;

        let size = namedFontSize(bx.textSize);
        let lines: string[];
        if (size === 0) {
            const initial = `${variant}14px ${family}`;
            lines = bx.wrap ? this.wrapText(ctx, initial, text, Math.max(1, w - pad * 2)) : text.split('\n');
            size = autoFontSize(lines, w, h, bx.bold);
        } else {
            const font = `${variant}${size}px ${family}`;
            lines = bx.wrap ? this.wrapText(ctx, font, text, Math.max(1, w - pad * 2)) : text.split('\n');
        }
        ctx.font = `${variant}${size}px ${family}`;
        ctx.fillStyle = bx.textColor ?? contrastColor(bx.bgColor);

        const lineH = size * 1.3;
        const blockH = lineH * lines.length;

        let tx: number;
        if (bx.hAlign === 'left') {
            ctx.textAlign = 'left';
            tx = left + pad;
        } else if (bx.hAlign === 'right') {
            ctx.textAlign = 'right';
            tx = left + w - pad;
        } else {
            ctx.textAlign = 'center';
            tx = left + w / 2;
        }
        ctx.textBaseline = 'top';
        let blockTop: number;
        if (bx.vAlign === 'top') blockTop = top + pad;
        else if (bx.vAlign === 'bottom') blockTop = top + h - pad - blockH;
        else blockTop = top + (h - blockH) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, w, h);
        ctx.clip();
        for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i]!, tx, blockTop + i * lineH);
        ctx.restore();
    }

    // ── labels ───────────────────────────────────────────────────────────────
    private drawLabels(ctx: CanvasRenderingContext2D, W: number, H: number, xOf: (l: number) => number, yOf: (p: number) => number | null): void {
        for (const lb of this.set.labels) {
            const px = xOf(this.logicalOf(lb.xloc, lb.x));
            if (px < -50 || px > W + 50) continue;

            let py: number | null;
            if (lb.yloc === 'price') {
                py = yOf(lb.y);
            } else if (lb.yloc === 'top') {
                py = 14;
            } else if (lb.yloc === 'bottom') {
                py = H - 14;
            } else {
                const bar = this.deps.barAt(this.logicalOf(lb.xloc, lb.x));
                if (!bar) continue;
                const base = yOf(lb.yloc === 'abovebar' ? bar.high : bar.low);
                py = base === null ? null : base + (lb.yloc === 'abovebar' ? -14 : 14);
            }
            if (py === null) continue;

            const color = lb.color ?? this.deps.theme.textColor;
            const fontPx = fontSizePx(lb.size);

            if (this.isPointShape(lb.style)) {
                if (!lb.noFill) this.drawLabelShape(ctx, lb.style, px, py, fontPx, color);
                if (lb.text) this.drawLabelText(ctx, lb, px, py + fontPx, fontPx);
                if (lb.tooltip) {
                    const r = Math.max(4, fontPx * 0.6) + 3;
                    this.tipRegions.push({ left: px - r, top: py - r, right: px + r, bottom: py + r, text: lb.tooltip });
                }
            } else if (lb.style === 'none' || lb.style === 'text_outline') {
                if (lb.text) {
                    this.drawLabelText(ctx, lb, px, py, fontPx, lb.style === 'text_outline');
                    if (lb.tooltip) this.tipRegions.push(this.textRegion(ctx, lb, px, py, fontPx, lb.tooltip));
                }
            } else {
                // noFill (na color) keeps the bubble style's geometry — drawBubble
                // places the text as if the bubble were there and skips the fill.
                const r = this.drawBubble(ctx, lb, px, py, fontPx, color);
                if (lb.tooltip) this.tipRegions.push({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, text: lb.tooltip });
            }
        }
    }

    /** Canvas font for a label's text — family + Pine `text_formatting` (bold/italic). */
    private labelFont(lb: DrawingLabel, fontPx: number): string {
        const family = lb.fontFamily === 'monospace' ? 'monospace' : this.deps.theme.fontFamily || 'sans-serif';
        return `${lb.italic ? 'italic ' : ''}${lb.bold ? 'bold ' : ''}${fontPx}px ${family}`;
    }

    /** Hover rect of a text-only label (style none/text_outline/noFill), centered like drawLabelText. */
    private textRegion(ctx: CanvasRenderingContext2D, lb: DrawingLabel, cx: number, cy: number, fontPx: number, text: string): LabelTipRegion {
        const font = this.labelFont(lb, fontPx);
        const lines = (lb.text ?? '').split('\n');
        const w = Math.max(1, ...lines.map((l) => this.measure(ctx, font, l)));
        const h = fontPx * 1.25 * lines.length;
        const left = lb.textAlign === 'left' ? cx : lb.textAlign === 'right' ? cx - w : cx - w / 2;
        return { left, top: cy - h / 2, right: left + w, bottom: cy + h / 2, text };
    }

    private isPointShape(style: DrawingLabel['style']): boolean {
        switch (style) {
            case 'circle':
            case 'square':
            case 'diamond':
            case 'flag':
            case 'arrowup':
            case 'arrowdown':
            case 'triangleup':
            case 'triangledown':
            case 'cross':
            case 'xcross':
                return true;
            default:
                return false;
        }
    }

    private drawLabelText(ctx: CanvasRenderingContext2D, lb: DrawingLabel, cx: number, cy: number, fontPx: number, outline = false): void {
        ctx.font = this.labelFont(lb, fontPx);
        ctx.textAlign = lb.textAlign === 'left' ? 'left' : lb.textAlign === 'right' ? 'right' : 'center';
        ctx.textBaseline = 'middle';
        const lines = lb.text!.split('\n');
        const lineH = fontPx * 1.25;
        const startY = cy - (lineH * (lines.length - 1)) / 2;
        if (outline) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = contrastColor(lb.textColor ?? this.deps.theme.textColor);
            for (let i = 0; i < lines.length; i += 1) ctx.strokeText(lines[i]!, cx, startY + i * lineH);
        }
        ctx.fillStyle = lb.textColor ?? this.deps.theme.textColor;
        for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i]!, cx, startY + i * lineH);
    }

    private drawLabelShape(ctx: CanvasRenderingContext2D, style: DrawingLabel['style'], cx: number, cy: number, fontPx: number, color: string): void {
        const r = Math.max(4, fontPx * 0.6);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.beginPath();
        switch (style) {
            case 'circle':
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'square':
                ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
                break;
            case 'diamond':
                ctx.moveTo(cx, cy - r);
                ctx.lineTo(cx + r, cy);
                ctx.lineTo(cx, cy + r);
                ctx.lineTo(cx - r, cy);
                ctx.closePath();
                ctx.fill();
                break;
            case 'triangleup':
            case 'arrowup':
                ctx.moveTo(cx, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.lineTo(cx - r, cy + r);
                ctx.closePath();
                ctx.fill();
                break;
            case 'triangledown':
            case 'arrowdown':
                ctx.moveTo(cx, cy + r);
                ctx.lineTo(cx + r, cy - r);
                ctx.lineTo(cx - r, cy - r);
                ctx.closePath();
                ctx.fill();
                break;
            case 'flag':
                ctx.moveTo(cx - r * 0.7, cy - r);
                ctx.lineTo(cx - r * 0.7, cy + r);
                ctx.moveTo(cx - r * 0.7, cy - r);
                ctx.lineTo(cx + r, cy - r * 0.4);
                ctx.lineTo(cx - r * 0.7, cy + r * 0.2);
                ctx.stroke();
                ctx.fill();
                break;
            case 'cross':
                ctx.moveTo(cx, cy - r);
                ctx.lineTo(cx, cy + r);
                ctx.moveTo(cx - r, cy);
                ctx.lineTo(cx + r, cy);
                ctx.stroke();
                break;
            case 'xcross':
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.moveTo(cx + r, cy - r);
                ctx.lineTo(cx - r, cy + r);
                ctx.stroke();
                break;
            default:
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
        }
    }

    /** Draw a bubble label; returns the bubble body rect (for tooltip hit-testing). */
    private drawBubble(ctx: CanvasRenderingContext2D, lb: DrawingLabel, px: number, py: number, fontPx: number, color: string): { x: number; y: number; w: number; h: number } {
        ctx.font = this.labelFont(lb, fontPx);
        const lines = (lb.text ?? '').split('\n');
        const padX = 6;
        const padY = 4;
        const lineH = fontPx * 1.25;
        const textW = Math.max(1, ...lines.map((l) => this.measure(ctx, ctx.font, l)));
        const w = textW + padX * 2;
        const h = lineH * lines.length + padY * 2;
        const ptr = 7;

        let bx = px - w / 2;
        let by = py - h - ptr;
        let pointer: 'down' | 'up' | 'left' | 'right' | 'none' = 'down';
        switch (lb.style) {
            case 'label_up':
                bx = px - w / 2; by = py + ptr; pointer = 'up'; break;
            case 'label_left':
                bx = px + ptr; by = py - h / 2; pointer = 'left'; break;
            case 'label_right':
                bx = px - w - ptr; by = py - h / 2; pointer = 'right'; break;
            case 'label_center':
                bx = px - w / 2; by = py - h / 2; pointer = 'none'; break;
            case 'label_lower_left':
                bx = px + ptr; by = py - h - ptr; pointer = 'none'; break;
            case 'label_lower_right':
                bx = px - w - ptr; by = py - h - ptr; pointer = 'none'; break;
            case 'label_upper_left':
                bx = px + ptr; by = py + ptr; pointer = 'none'; break;
            case 'label_upper_right':
                bx = px - w - ptr; by = py + ptr; pointer = 'none'; break;
            default:
                bx = px - w / 2; by = py - h - ptr; pointer = 'down';
        }

        if (!lb.noFill) {
            ctx.fillStyle = color;
            this.roundRect(ctx, bx, by, w, h, 4);
            ctx.fill();
            if (pointer !== 'none') {
                ctx.beginPath();
                if (pointer === 'down') {
                    ctx.moveTo(px - ptr, by + h);
                    ctx.lineTo(px + ptr, by + h);
                    ctx.lineTo(px, py);
                } else if (pointer === 'up') {
                    ctx.moveTo(px - ptr, by);
                    ctx.lineTo(px + ptr, by);
                    ctx.lineTo(px, py);
                } else if (pointer === 'left') {
                    ctx.moveTo(bx, py - ptr);
                    ctx.lineTo(bx, py + ptr);
                    ctx.lineTo(px, py);
                } else {
                    ctx.moveTo(bx + w, py - ptr);
                    ctx.lineTo(bx + w, py + ptr);
                    ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
            }
        }

        if (lb.text) {
            // With no bubble behind it, contrast-of-bubble is meaningless — fall
            // back to the theme's text color (same default as bare label text).
            ctx.fillStyle = lb.textColor ?? (lb.noFill ? this.deps.theme.textColor : contrastColor(color));
            ctx.textBaseline = 'middle';
            // Pine `textalign` aligns the LINES inside the bubble (the bubble itself stays put).
            let tx: number;
            if (lb.textAlign === 'left') {
                ctx.textAlign = 'left';
                tx = bx + padX;
            } else if (lb.textAlign === 'right') {
                ctx.textAlign = 'right';
                tx = bx + w - padX;
            } else {
                ctx.textAlign = 'center';
                tx = bx + w / 2;
            }
            const startY = by + padY + lineH / 2;
            for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i]!, tx, startY + i * lineH);
        }
        return { x: bx, y: by, w, h };
    }

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
}
