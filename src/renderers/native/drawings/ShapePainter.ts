import {
    shapeFontSize,
    textAngle,
    type DrawingShape,
    type DrawingStyle,
    type EmbeddedShape,
    type MarkerShape,
    type PathShape,
    type ShapeColor,
    type ShapeCommon,
    type ShapeFill,
    type ShapeHatch,
    type ShapePoint,
    type TextShape,
} from '../../../core/drawings';
import { contrastColor, dashPattern, extendEndpoints } from '../../shared/drawing-geometry';

/** What painting a shape list needs from its drawing and its frame. */
export interface ShapePaintEnv {
    /** The drawing's own style: what a shape without a stroke or with `fill: true` uses. */
    style: DrawingStyle;
    theme: { text: string; background: string; font: string };
    width: number;
    height: number;
    /** `'body'` leaves the `front` shapes out (they paint over the series, on another
     *  layer); `'front'` paints only those. */
    pass: 'all' | 'body' | 'front';
    /** Paint a drawing embedded as a part. */
    embedded(shape: EmbeddedShape): void;
    /** An image once it has loaded, else null (the caller repaints when it lands). */
    image(src: string): CanvasImageSource | null;
    /** A shape could not be painted (the canvas refused a color, a dash, a gradient). */
    failed(err: unknown): void;
}

type Ctx = CanvasRenderingContext2D;

function paintOf(ctx: Ctx, color: ShapeColor): string | CanvasGradient {
    if (typeof color === 'string') return color;
    const g = color.gradient;
    const grad = ctx.createLinearGradient(g.from[0], g.from[1], g.to[0], g.to[1]);
    for (const [offset, c] of g.stops) grad.addColorStop(Math.min(1, Math.max(0, offset)), c);
    return grad;
}

function isHatch(fill: ShapeFill): fill is ShapeHatch {
    return typeof fill === 'object' && 'hatch' in fill;
}

interface Stroke {
    color: ShapeColor;
    width: number;
    dash: number[];
}

function strokeOf(s: ShapeCommon, style: DrawingStyle): Stroke | null {
    const st = s.stroke;
    if (st === null) return null;
    if (st === undefined || typeof st === 'string') return { color: st ?? style.lineColor, width: style.lineWidth, dash: dashPattern(style.lineStyle, style.lineWidth) };
    const width = st.width ?? style.lineWidth;
    const dash = st.dash === undefined ? dashPattern(style.lineStyle, width) : typeof st.dash === 'string' ? dashPattern(st.dash, width) : [...st.dash];
    return { color: st.color ?? style.lineColor, width, dash };
}

/** Lines across the clipped area, `spacing` apart, at `angle`. */
function hatch(ctx: Ctx, h: ShapeHatch['hatch'], env: ShapePaintEnv): void {
    const spacing = Math.max(2, h.spacing ?? 6);
    const reach = env.width + env.height;
    ctx.save();
    ctx.clip();
    ctx.translate(env.width / 2, env.height / 2);
    ctx.rotate(h.angle ?? Math.PI / 4);
    ctx.strokeStyle = h.color;
    ctx.lineWidth = h.width ?? 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let y = -reach; y <= reach; y += spacing) {
        ctx.moveTo(-reach, y);
        ctx.lineTo(reach, y);
    }
    ctx.stroke();
    ctx.restore();
}

/** Fill then outline the path `trace` builds, per the shape's fill and stroke. */
function fillAndStroke(ctx: Ctx, s: ShapeCommon, env: ShapePaintEnv, trace: () => void, strokeTrace: () => void = trace): void {
    const fill = s.fill === true ? env.style.fillColor : s.fill;
    if (fill) {
        ctx.beginPath();
        trace();
        if (isHatch(fill)) hatch(ctx, fill.hatch, env);
        else {
            ctx.fillStyle = paintOf(ctx, fill);
            ctx.fill();
        }
    }
    const st = strokeOf(s, env.style);
    if (!st) return;
    ctx.strokeStyle = paintOf(ctx, st.color);
    ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    strokeTrace();
    ctx.stroke();
    ctx.setLineDash([]);
}

function tracePoints(ctx: Ctx, pts: readonly ShapePoint[], closed: boolean, smooth: boolean): void {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    if (smooth && pts.length > 2) {
        // Through the midpoints, each original point as the control: one continuous curve.
        for (let i = 1; i < pts.length - 1; i += 1) {
            const p = pts[i]!;
            const n = pts[i + 1]!;
            ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
        }
        const last = pts[pts.length - 1]!;
        ctx.lineTo(last[0], last[1]);
    } else {
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
    }
    if (closed) ctx.closePath();
}

function arrowhead(ctx: Ctx, from: ShapePoint, to: ShapePoint, st: Stroke): void {
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const len = Math.max(9, st.width * 3.5);
    const spread = Math.PI / 7;
    ctx.fillStyle = paintOf(ctx, st.color);
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - len * Math.cos(ang - spread), to[1] - len * Math.sin(ang - spread));
    ctx.lineTo(to[0] - len * Math.cos(ang + spread), to[1] - len * Math.sin(ang + spread));
    ctx.closePath();
    ctx.fill();
}

function paintPath(ctx: Ctx, s: PathShape, env: ShapePaintEnv): void {
    const colors = s.colors;
    if (!colors || colors.length === 0) {
        fillAndStroke(ctx, s, env, () => tracePoints(ctx, s.points, s.closed === true, s.smooth === true));
        return;
    }
    // One color per segment: the fill (if any) first, then each segment on its own.
    fillAndStroke(ctx, { ...s, stroke: null }, env, () => tracePoints(ctx, s.points, s.closed === true, false));
    const st = strokeOf(s, env.style);
    if (!st) return;
    ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash);
    ctx.lineCap = 'round';
    const pts = s.closed ? [...s.points, s.points[0]!] : s.points;
    for (let i = 1; i < pts.length; i += 1) {
        ctx.strokeStyle = colors[i - 1] ?? paintOf(ctx, st.color);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
        ctx.lineTo(pts[i]![0], pts[i]![1]);
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
}

function wrap(ctx: Ctx, lines: readonly string[], maxWidth: number): string[] {
    const out: string[] = [];
    for (const line of lines) {
        let cur = '';
        for (const word of line.split(' ')) {
            const next = cur ? `${cur} ${word}` : word;
            if (cur && ctx.measureText(next).width > maxWidth) {
                out.push(cur);
                cur = word;
            } else cur = next;
        }
        out.push(cur);
    }
    return out;
}

interface TextLayout {
    lines: string[];
    font: string;
    lh: number;
    /** The text box (plate included), relative to the anchor before rotation. */
    x: number;
    y: number;
    w: number;
    h: number;
    pad: number;
}

function layoutText(ctx: Ctx, s: TextShape, env: ShapePaintEnv): TextLayout {
    const fs = shapeFontSize(s.size);
    const font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${fs}px ${env.theme.font}`;
    ctx.font = font;
    const raw = s.text.split('\n');
    const lines = s.maxWidth ? wrap(ctx, raw, s.maxWidth) : raw;
    const lh = Math.round(fs * 1.25);
    const pad = s.plate ? (typeof s.plate === 'object' ? (s.plate.padding ?? 4) : 4) : 0;
    const w = Math.max(0, ...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lh + pad * 2;
    const x = s.align === 'center' ? -w / 2 : s.align === 'right' ? -w : 0;
    const y = s.baseline === 'middle' ? -h / 2 : s.baseline === 'bottom' ? -h : 0;
    return { lines, font, lh, x, y, w, h, pad };
}

function paintText(ctx: Ctx, s: TextShape, env: ShapePaintEnv, dy: number): void {
    const L = layoutText(ctx, s, env);
    const angle = textAngle(s);
    ctx.save();
    ctx.translate(s.at[0], s.at[1] + dy);
    if (angle) ctx.rotate(angle);
    const plate = s.plate ? (typeof s.plate === 'object' ? s.plate : {}) : null;
    const plateFill = plate ? (plate.fill ?? env.theme.background) : null;
    if (plate && plateFill) {
        ctx.beginPath();
        roundRect(ctx, L.x, L.y, L.w, L.h, plate.radius ?? 3);
        ctx.fillStyle = plateFill;
        ctx.fill();
        if (plate.stroke) {
            ctx.strokeStyle = plate.stroke;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.stroke();
        }
    }
    ctx.font = L.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = s.align ?? 'left';
    const tx = s.align === 'center' ? L.x + L.w / 2 : s.align === 'right' ? L.x + L.w - L.pad : L.x + L.pad;
    const ink = s.color === 'auto' ? contrastColor(plateFill ?? env.theme.background) : (s.color ?? env.theme.text);
    L.lines.forEach((line, i) => {
        const ty = L.y + L.pad + L.lh * i + L.lh / 2;
        if (s.halo) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = 3;
            ctx.strokeStyle = env.theme.background;
            ctx.strokeText(line, tx, ty);
        }
        ctx.fillStyle = ink;
        ctx.fillText(line, tx, ty);
    });
    ctx.restore();
}

/** How far down each `avoid` text moves so none of them overlaps another: top to bottom,
 *  each one clears the boxes already placed. */
function avoidOffsets(ctx: Ctx, shapes: readonly DrawingShape[], env: ShapePaintEnv): Map<DrawingShape, number> {
    const out = new Map<DrawingShape, number>();
    const texts = shapes.filter((s): s is TextShape => s.kind === 'text' && s.avoid === true && !s.angle);
    if (texts.length < 2) return out;
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const s of [...texts].sort((a, b) => a.at[1] - b.at[1])) {
        const L = layoutText(ctx, s, env);
        const box = { x: s.at[0] + L.x, y: s.at[1] + L.y, w: L.w, h: L.h };
        for (const p of placed) {
            const overlaps = box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h + 2 && p.y < box.y + box.h;
            if (overlaps) box.y = p.y + p.h + 2;
        }
        placed.push(box);
        const dy = box.y - (s.at[1] + L.y);
        if (dy !== 0) out.set(s, dy);
    }
    return out;
}

function paintMarker(ctx: Ctx, s: MarkerShape, env: ShapePaintEnv): void {
    const [x, y] = s.at;
    const size = s.size ?? 8;
    const r = size / 2;
    const st = strokeOf(s, env.style);
    const ink = st ? paintOf(ctx, st.color) : env.style.lineColor;
    if (s.glyph) {
        ctx.font = `${size}px ${env.theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = typeof s.fill === 'string' ? s.fill : ink;
        ctx.fillText(s.glyph, x, y);
        return;
    }
    const shape = s.shape ?? 'circle';
    if (shape === 'cross' || shape === 'plus') {
        const d = shape === 'cross' ? r * Math.SQRT1_2 : 0;
        ctx.strokeStyle = ink;
        ctx.lineWidth = st?.width ?? 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        if (shape === 'cross') {
            ctx.moveTo(x - d, y - d);
            ctx.lineTo(x + d, y + d);
            ctx.moveTo(x + d, y - d);
            ctx.lineTo(x - d, y + d);
        } else {
            ctx.moveTo(x - r, y);
            ctx.lineTo(x + r, y);
            ctx.moveTo(x, y - r);
            ctx.lineTo(x, y + r);
        }
        ctx.stroke();
        return;
    }
    const trace = (): void => {
        switch (shape) {
            case 'square':
                ctx.rect(x - r, y - r, size, size);
                break;
            case 'diamond':
                tracePoints(ctx, [[x, y - r], [x + r, y], [x, y + r], [x - r, y]], true, false);
                break;
            case 'triangle':
                tracePoints(ctx, [[x, y - r], [x + r, y + r], [x - r, y + r]], true, false);
                break;
            case 'triangleDown':
                tracePoints(ctx, [[x, y + r], [x + r, y - r], [x - r, y - r]], true, false);
                break;
            case 'arrowUp':
                tracePoints(ctx, [[x, y - r], [x + r, y], [x + r / 3, y], [x + r / 3, y + r], [x - r / 3, y + r], [x - r / 3, y], [x - r, y]], true, false);
                break;
            case 'arrowDown':
                tracePoints(ctx, [[x, y + r], [x + r, y], [x + r / 3, y], [x + r / 3, y - r], [x - r / 3, y - r], [x - r / 3, y], [x - r, y]], true, false);
                break;
            default:
                ctx.arc(x, y, r, 0, Math.PI * 2);
        }
    };
    // A mark is solid in its line color unless the shape says otherwise.
    const fill = s.fill === undefined ? (typeof ink === 'string' ? ink : env.style.lineColor) : s.fill;
    fillAndStroke(ctx, { ...s, fill, stroke: s.stroke === undefined ? null : s.stroke }, env, trace);
}

function paintOne(ctx: Ctx, s: DrawingShape, env: ShapePaintEnv, dy: number): void {
    switch (s.kind) {
        case 'line': {
            const [x1, y1, x2, y2] = extendEndpoints(s.from[0], s.from[1], s.to[0], s.to[1], s.extend ?? 'none', env.width, env.height);
            fillAndStroke(ctx, { ...s, fill: null }, env, () => {
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
            });
            const st = s.arrows ? strokeOf(s, env.style) : null;
            if (st && (s.arrows === 'end' || s.arrows === 'both')) arrowhead(ctx, s.from, s.to, st);
            if (st && (s.arrows === 'start' || s.arrows === 'both')) arrowhead(ctx, s.to, s.from, st);
            break;
        }
        case 'path':
            paintPath(ctx, s, env);
            break;
        case 'rect': {
            const x = Math.min(s.from[0], s.to[0]);
            const y = Math.min(s.from[1], s.to[1]);
            const w = Math.abs(s.to[0] - s.from[0]);
            const h = Math.abs(s.to[1] - s.from[1]);
            fillAndStroke(ctx, s, env, () => (s.radius ? roundRect(ctx, x, y, w, h, s.radius) : ctx.rect(x, y, w, h)));
            break;
        }
        case 'ellipse': {
            const whole = s.from === undefined && s.to === undefined;
            fillAndStroke(ctx, s, env, () => {
                ctx.ellipse(s.center[0], s.center[1], Math.abs(s.rx), Math.abs(s.ry ?? s.rx), s.rotation ?? 0, s.from ?? 0, s.to ?? Math.PI * 2);
                if (whole) ctx.closePath();
            });
            break;
        }
        case 'curve':
            fillAndStroke(ctx, s, env, () => {
                for (const c of s.d) {
                    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
                    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
                    else if (c[0] === 'Q') ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
                    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
                    else ctx.closePath();
                }
            });
            break;
        case 'band':
            if (s.upper.length > 0 && s.lower.length > 0) {
                fillAndStroke(ctx, { ...s, stroke: null }, env, () => tracePoints(ctx, [...s.upper, ...[...s.lower].reverse()], true, false));
            }
            break;
        case 'rows': {
            const fill = s.fill === true ? env.style.fillColor : s.fill;
            const base = fill && !isHatch(fill) ? paintOf(ctx, fill) : env.style.lineColor;
            for (const r of s.rows) {
                ctx.fillStyle = r.fill ?? base;
                ctx.fillRect(Math.min(s.x, s.x + r.w), r.y, Math.abs(r.w), r.h);
            }
            break;
        }
        case 'text':
            paintText(ctx, s, env, dy);
            break;
        case 'marker':
            paintMarker(ctx, s, env);
            break;
        case 'image': {
            const img = env.image(s.src);
            if (img) ctx.drawImage(img, s.at[0] - s.w / 2, s.at[1] - s.h / 2, s.w, s.h);
            break;
        }
        case 'drawing':
            env.embedded(s);
            break;
        case 'tag':
            break; // axis tags are collected by the controller: they paint outside the plot
    }
}

/**
 * Paint a drawing's shape list, in order. Each shape starts from a clean context state.
 * The list comes from a host's tool, and the canvas throws on what it cannot read (a color
 * stop that is no color, a dash that is no list): such a shape is reported through
 * `env.failed` and left unpainted, and the shapes after it, the drawings after this one and
 * the rest of the frame paint as they would without it.
 */
export function paintShapes(ctx: Ctx, shapes: readonly DrawingShape[], env: ShapePaintEnv): void {
    let offsets: Map<DrawingShape, number>;
    try {
        offsets = avoidOffsets(ctx, shapes, env);
    } catch (err) {
        env.failed(err);
        offsets = new Map();
    }
    for (const s of shapes) {
        if (s.kind === 'tag') continue;
        const front = s.front === true;
        if ((env.pass === 'body' && front) || (env.pass === 'front' && !front)) continue;
        // The shape's state must not stay on the context for what is painted after it.
        ctx.save();
        try {
            if (s.opacity !== undefined) ctx.globalAlpha *= Math.min(1, Math.max(0, s.opacity));
            paintOne(ctx, s, env, offsets.get(s) ?? 0);
        } catch (err) {
            env.failed(err);
        } finally {
            ctx.restore();
        }
    }
}