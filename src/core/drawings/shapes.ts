/**
 * The neutral shape vocabulary a drawing paints with. A drawing returns a list of these from
 * `shapes()`; the renderer draws them, and hit-testing, bounds and hover parts derive from the
 * same list — so a type describes its look once and nothing else needs to know its class.
 *
 * Every coordinate is in PLOT PIXELS (the frame {@link Projector} resolves into), the same
 * space the built-in tools compute their geometry in. A part pinned to a data point with a
 * fixed pixel size is therefore just a projected point plus an offset.
 */

import type { DrawingPoint, Projector } from './geometry';
import type { DrawingStyle, DrawingText } from './style';
import { distToPolyline, distToSegment, extendRay, pointInBox, pointInPolygon } from './hittest';
import { BEARISH, BULLISH, NEUTRAL } from '../palette';

/** A point in plot pixels. */
export type ShapePoint = readonly [number, number];

export type ShapeDash = 'solid' | 'dashed' | 'dotted' | readonly number[];

/** A linear gradient between two plot points. */
export interface ShapeGradient {
    gradient: { from: ShapePoint; to: ShapePoint; stops: ReadonlyArray<readonly [offset: number, color: string]> };
}

/** Parallel lines clipped to the shape (a hatched fill). */
export interface ShapeHatch {
    hatch: { color: string; spacing?: number; angle?: number; width?: number };
}

export type ShapeColor = string | ShapeGradient;
export type ShapeFill = string | ShapeGradient | ShapeHatch;

export interface ShapeStroke {
    /** Absent: the drawing's line color. */
    color?: ShapeColor;
    /** Absent: the drawing's line width. */
    width?: number;
    /** Absent: the drawing's line style. */
    dash?: ShapeDash;
}

/** What every shape accepts. */
export interface ShapeCommon {
    /** The outline. Absent: the drawing's own line settings. A string: that color at the
     *  drawing's width and dash. `null`: no outline. */
    stroke?: string | ShapeStroke | null;
    /** The interior. Absent or `null`: none. `true`: the drawing's fill color. */
    fill?: ShapeFill | true | null;
    /** 0..1, multiplied into the drawing's own opacity. */
    opacity?: number;
    /** Names this shape as a part of the drawing: hover and click report it, and the paint
     *  context says which part is under the cursor. */
    part?: string;
    /** Paint over the series even when the drawing sits under them (a label on a zone that
     *  is drawn behind the candles). */
    front?: boolean;
    /** `false` keeps the shape out of hit-testing (decoration the pointer passes through). */
    hit?: boolean;
    /** CSS cursor while the pointer is over this shape. */
    cursor?: string;
    /** A short text shown beside the pointer while it is over this shape. */
    tip?: string;
}

export interface LineShape extends ShapeCommon {
    kind: 'line';
    from: ShapePoint;
    to: ShapePoint;
    /** Run past an end to the plot's edge. */
    extend?: 'none' | 'left' | 'right' | 'both';
    /** Arrowheads at the ends. */
    arrows?: 'start' | 'end' | 'both';
}

export interface PathShape extends ShapeCommon {
    kind: 'path';
    points: readonly ShapePoint[];
    /** Join the last point back to the first (a polygon). */
    closed?: boolean;
    /** Round the corners into one continuous curve through the points. */
    smooth?: boolean;
    /** One color per segment (`colors[i]` paints `points[i]` → `points[i + 1]`). */
    colors?: readonly string[];
}

export interface RectShape extends ShapeCommon {
    kind: 'rect';
    from: ShapePoint;
    to: ShapePoint;
    radius?: number;
}

export interface EllipseShape extends ShapeCommon {
    kind: 'ellipse';
    center: ShapePoint;
    rx: number;
    /** Absent: a circle of radius `rx`. */
    ry?: number;
    rotation?: number;
    /** An arc: start and end angles in radians, clockwise on screen. Absent: the full ellipse. */
    from?: number;
    to?: number;
}

/** One step of a {@link CurveShape}: move, line, quadratic, cubic, close. */
export type PathCommand =
    | readonly ['M', number, number]
    | readonly ['L', number, number]
    | readonly ['Q', number, number, number, number]
    | readonly ['C', number, number, number, number, number, number]
    | readonly ['Z'];

export interface CurveShape extends ShapeCommon {
    kind: 'curve';
    d: readonly PathCommand[];
}

/** The area between two series of points (the edges are not outlined: add paths for them). */
export interface BandShape extends ShapeCommon {
    kind: 'band';
    upper: readonly ShapePoint[];
    lower: readonly ShapePoint[];
}

/** Horizontal histogram rows growing from one x (a profile). */
export interface RowsShape extends ShapeCommon {
    kind: 'rows';
    x: number;
    /** `y`/`h`: the row's top and height. `w`: its length; negative grows to the left. */
    rows: ReadonlyArray<{ y: number; h: number; w: number; fill?: string }>;
}

export interface TextShape extends Omit<ShapeCommon, 'stroke' | 'fill'> {
    kind: 'text';
    at: ShapePoint;
    text: string;
    /** Absent: the chart's text color. `'auto'`: the readable ink over the plate (or the
     *  chart background). */
    color?: string;
    size?: number | DrawingText['size'];
    bold?: boolean;
    italic?: boolean;
    align?: 'left' | 'center' | 'right';
    baseline?: 'top' | 'middle' | 'bottom';
    /** Rotation in radians around `at` (text along a slope). */
    angle?: number;
    /** Flip a rotated text that would read upside down. */
    upright?: boolean;
    /** A box behind the text. `true`: the chart background. */
    plate?: boolean | { fill?: string; stroke?: string; radius?: number; padding?: number };
    /** Wrap onto several lines at this width. */
    maxWidth?: number;
    /** Outline the glyphs in the chart background so they read over lines. */
    halo?: boolean;
    /** Move this text clear of the drawing's other `avoid` texts. */
    avoid?: boolean;
}

export type MarkerGlyph = 'circle' | 'square' | 'diamond' | 'triangle' | 'triangleDown' | 'cross' | 'plus' | 'arrowUp' | 'arrowDown';

/** A fixed-size mark at a point: the same pixels at any zoom. */
export interface MarkerShape extends ShapeCommon {
    kind: 'marker';
    at: ShapePoint;
    shape?: MarkerGlyph;
    /** A character drawn in place of `shape` (an icon font glyph, an emoji). */
    glyph?: string;
    size?: number;
}

export interface ImageShape extends Omit<ShapeCommon, 'stroke' | 'fill'> {
    kind: 'image';
    /** The image's center. */
    at: ShapePoint;
    w: number;
    h: number;
    /** A URL or a `data:` URI. */
    src: string;
}

/** A tag on the price axis (`value` is a price) or the time axis (`value` is epoch ms). */
export interface TagShape {
    kind: 'tag';
    axis: 'price' | 'time';
    value: number;
    /** Absent: the formatted value. */
    text?: string;
    /** Absent: the drawing's line color. */
    color?: string;
}

/** Another registered drawing painted as a part of this one, from anchors this one derives. */
export interface EmbeddedShape extends Pick<ShapeCommon, 'part' | 'front' | 'hit' | 'cursor' | 'tip' | 'opacity'> {
    kind: 'drawing';
    type: string;
    anchors: readonly DrawingPoint[];
    style?: Partial<DrawingStyle>;
    text?: DrawingText;
    props?: Record<string, unknown>;
}

export type DrawingShape =
    | LineShape
    | PathShape
    | RectShape
    | EllipseShape
    | CurveShape
    | BandShape
    | RowsShape
    | TextShape
    | MarkerShape
    | ImageShape
    | TagShape
    | EmbeddedShape;

/** The chart's bars as a drawing reads them. */
export interface ShapeBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

/** What the paint tells a drawing about the frame it is drawn in. */
export interface ShapeView {
    selected: boolean;
    hovered: boolean;
    /** The part under the pointer, when the drawing is hovered. */
    part: string | null;
    /** The drawing is still being placed (its anchors may be incomplete). */
    placing: boolean;
}

export interface ShapeTheme {
    text: string;
    background: string;
    font: string;
    up: string;
    down: string;
}

/** What the renderer adds to a paint: none of it changes geometry. */
export interface ShapeEnv {
    view?: Partial<ShapeView>;
    theme?: Partial<ShapeTheme>;
    /** A price in the chart's own format. */
    price?: (price: number) => string;
}

/** The data half of a context: everything that exists without a viewport. */
export interface DrawingData<P = Record<string, unknown>, S = unknown> {
    readonly id: string;
    readonly type: string;
    readonly paneId: string;
    /** The drawing's points, in time and price. */
    readonly anchors: readonly DrawingPoint[];
    readonly props: P;
    readonly style: DrawingStyle;
    readonly text: DrawingText | undefined;
    /** What `compute` last returned (undefined before its first result). */
    readonly state: S | undefined;
    /** An asynchronous `compute` is still running; `state` is the previous result. */
    readonly pending: boolean;
    /** The chart's bars in a time range (empty without a renderer). */
    bars(from: number, to: number): ReadonlyArray<ShapeBar>;
}

/** What `shapes()` receives. */
export interface ShapeContext<P = Record<string, unknown>, S = unknown> extends DrawingData<P, S> {
    readonly proj: Projector;
    /** The time zone the chart shows its times in, as an IANA name (`'UTC'` when the
     *  renderer does not say). */
    readonly timeZone: string;
    /** The anchors in plot pixels (an anchor on a pane that is gone is left out). */
    readonly points: readonly ShapePoint[];
    readonly width: number;
    readonly height: number;
    readonly view: ShapeView;
    readonly theme: ShapeTheme;
    /** Plot x of a time. */
    x(time: number): number;
    /** Plot y of a price on the drawing's pane (NaN when the pane is gone). */
    y(price: number): number;
    /** Plot pixels of a time and price. */
    point(p: DrawingPoint): ShapePoint;
    /** A price in the chart's format. */
    price(price: number): string;
}

/** How deep a drawing may embed other drawings as parts (a type that embeds itself would
 *  otherwise never end). */
export const MAX_EMBED_DEPTH = 4;

const reported = new Set<string>();

/**
 * A hook of a host's drawing type threw. The chart carries on without what the hook would
 * have given (no shapes, the previous result), and says so once per type and hook: the same
 * failure on every frame would bury the console.
 */
export function reportDrawingError(type: string, hook: string, err: unknown): void {
    const key = `${type}:${hook}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`[vela] drawing type "${type}": ${hook} failed`, err);
}

/** What a context carries when no renderer supplied a theme (a hit-test, a headless read). */
const DEFAULT_THEME: ShapeTheme = { text: NEUTRAL, background: '#ffffff', font: 'sans-serif', up: BULLISH, down: BEARISH };

/** Build the context a drawing's `shapes()` reads, from its data and the frame's projector. */
export function shapeContext<P, S>(data: DrawingData<P, S>, proj: Projector, env: ShapeEnv = {}): ShapeContext<P, S> {
    const y = (price: number): number => proj.yOf(price, data.paneId) ?? NaN;
    const point = (p: DrawingPoint): ShapePoint => [proj.xOf(p.time), y(p.price)];
    const points: ShapePoint[] = [];
    for (const a of data.anchors) {
        const p = point(a);
        if (Number.isFinite(p[1])) points.push(p);
    }
    return {
        ...data,
        bars: data.bars,
        proj,
        timeZone: proj.timeZone ?? 'UTC',
        points,
        width: proj.width,
        height: proj.height,
        view: { selected: false, hovered: false, part: null, placing: false, ...env.view },
        theme: { ...DEFAULT_THEME, ...env.theme },
        x: (time) => proj.xOf(time),
        y,
        point,
        price: env.price ?? ((p) => p.toFixed(proj.priceDecimals?.(data.paneId) ?? 2)),
    };
}

/**
 * The price of the straight line through `a` and `b` at `time`, or null for a vertical one.
 * With the chart's projector the line is read as it is painted: straight on screen, whatever
 * the price scale (a logarithmic one bends it in price) and the gaps in the time axis.
 * Without one it is straight in time and price. `extend` says how far the line runs: between
 * the points only, on to the chart's right edge, to its left edge, or both ways. Left and
 * right are the chart's, whichever order the two points were given in, as the line is drawn.
 */
export function lineValueAt(
    p1: DrawingPoint,
    p2: DrawingPoint,
    time: number,
    opts: { extend?: 'none' | 'left' | 'right' | 'both'; paneId?: string; proj?: Projector | null } = {},
): number | null {
    if (p1.time === p2.time) return null;
    const [a, b] = p1.time < p2.time ? [p1, p2] : [p2, p1];
    const along = (time - a.time) / (b.time - a.time); // 0 at the earlier point, 1 at the later
    const extend = opts.extend ?? 'none';
    if (along < 0 && extend !== 'left' && extend !== 'both') return null;
    if (along > 1 && extend !== 'right' && extend !== 'both') return null;
    const proj = opts.proj;
    const paneId = opts.paneId ?? 'price';
    const ya = proj?.yOf(a.price, paneId);
    const yb = proj?.yOf(b.price, paneId);
    if (proj && ya != null && yb != null) {
        const xa = proj.xOf(a.time);
        const xb = proj.xOf(b.time);
        if (xa !== xb) {
            const x = proj.xOf(time);
            return proj.pxToPoint(x, ya + ((yb - ya) * (x - xa)) / (xb - xa), paneId).price;
        }
    }
    return a.price + (b.price - a.price) * along;
}

// ── geometry shared by the hit-test and the painter ──

const TAU = Math.PI * 2;

/** The points of an ellipse or arc, as a polyline. */
export function ellipsePoints(s: EllipseShape, steps = 48): ShapePoint[] {
    const ry = s.ry ?? s.rx;
    const a0 = s.from ?? 0;
    const a1 = s.to ?? a0 + TAU;
    const rot = s.rotation ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const out: ShapePoint[] = [];
    for (let i = 0; i <= steps; i += 1) {
        const a = a0 + ((a1 - a0) * i) / steps;
        const ex = s.rx * Math.cos(a);
        const ey = ry * Math.sin(a);
        out.push([s.center[0] + ex * cos - ey * sin, s.center[1] + ex * sin + ey * cos]);
    }
    return out;
}

/** A curve's commands as one polyline per subpath (Béziers sampled). */
export function flattenCurve(d: readonly PathCommand[], steps = 16): Array<{ points: ShapePoint[]; closed: boolean }> {
    const out: Array<{ points: ShapePoint[]; closed: boolean }> = [];
    let cur: ShapePoint[] | null = null;
    const start = (x: number, y: number): ShapePoint[] => {
        cur = [[x, y]];
        out.push({ points: cur, closed: false });
        return cur;
    };
    for (const c of d) {
        if (c[0] === 'M') {
            start(c[1], c[2]);
            continue;
        }
        if (c[0] === 'Z') {
            const last = out[out.length - 1];
            if (last) last.closed = true;
            continue;
        }
        const pts: ShapePoint[] = cur ?? start(0, 0);
        const [x0, y0] = pts[pts.length - 1]!;
        if (c[0] === 'L') pts.push([c[1], c[2]]);
        else if (c[0] === 'Q') {
            for (let i = 1; i <= steps; i += 1) {
                const t = i / steps;
                const u = 1 - t;
                pts.push([u * u * x0 + 2 * u * t * c[1] + t * t * c[3], u * u * y0 + 2 * u * t * c[2] + t * t * c[4]]);
            }
        } else {
            for (let i = 1; i <= steps; i += 1) {
                const t = i / steps;
                const u = 1 - t;
                pts.push([
                    u * u * u * x0 + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
                    u * u * u * y0 + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
                ]);
            }
        }
    }
    return out;
}

/** The pixel size a text shape's `size` stands for. */
export function shapeFontSize(size: TextShape['size']): number {
    if (typeof size === 'number') return size;
    switch (size) {
        case 'tiny':
            return 8;
        case 'small':
            return 10;
        case 'large':
            return 16;
        case 'huge':
            return 24;
        default:
            return 12;
    }
}

/** The angle a text shape is painted at: its own, turned half a circle when `upright` says
 *  it would otherwise read upside down. */
export function textAngle(s: TextShape): number {
    let angle = s.angle ?? 0;
    if (s.upright && angle) {
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
    }
    return angle;
}

/** A text shape's box before rotation, from an average glyph width: the model has no canvas
 *  to measure with, and a hit area a few pixels off the glyphs is still the text's own. */
function textBox(s: TextShape): { x: number; y: number; w: number; h: number } {
    const fs = shapeFontSize(s.size);
    const lines = s.text.split('\n');
    const pad = s.plate ? (typeof s.plate === 'object' ? (s.plate.padding ?? 4) : 4) : 0;
    const widest = Math.max(1, ...lines.map((l) => l.length));
    const w = Math.min(s.maxWidth ?? Infinity, widest * fs * 0.58) + pad * 2;
    const h = lines.length * fs * 1.25 + pad * 2;
    const x = s.align === 'center' ? s.at[0] - w / 2 : s.align === 'right' ? s.at[0] - w : s.at[0];
    const y = s.baseline === 'middle' ? s.at[1] - h / 2 : s.baseline === 'bottom' ? s.at[1] - h : s.at[1];
    return { x, y, w, h };
}

function strokeWidthOf(s: DrawingShape, fallback: number): number {
    const st = (s as ShapeCommon).stroke;
    return st && typeof st === 'object' ? (st.width ?? fallback) : fallback;
}

/** What the plot's size and an embedded drawing's own hit-test contribute to a shape hit. */
export interface ShapeHitEnv {
    width: number;
    height: number;
    lineWidth?: number;
    /** Hit-test an embedded drawing (the model resolves its instance). */
    embedded?: (shape: EmbeddedShape) => boolean;
}

function hitOne(s: DrawingShape, px: number, py: number, tol: number, env: ShapeHitEnv): boolean {
    const reach = tol + strokeWidthOf(s, env.lineWidth ?? 1) / 2;
    switch (s.kind) {
        case 'line': {
            const [x1, y1, x2, y2] = extendRay(s.from[0], s.from[1], s.to[0], s.to[1], s.extend ?? 'none', env.width, env.height);
            return distToSegment(px, py, x1, y1, x2, y2) <= reach;
        }
        case 'path': {
            if (s.points.length === 0) return false;
            if (s.closed && s.fill && pointInPolygon(px, py, s.points)) return true;
            const pts = s.closed ? [...s.points, s.points[0]!] : s.points;
            return pts.length === 1 ? Math.hypot(px - pts[0]![0], py - pts[0]![1]) <= reach : distToPolyline(px, py, pts) <= reach;
        }
        case 'rect': {
            if (s.fill) return pointInBox(px, py, s.from[0], s.from[1], s.to[0], s.to[1], tol);
            return pointInBox(px, py, s.from[0], s.from[1], s.to[0], s.to[1], reach) && !pointInBox(px, py, s.from[0], s.from[1], s.to[0], s.to[1], -reach);
        }
        case 'ellipse': {
            const pts = ellipsePoints(s);
            if (s.fill && s.from === undefined && pointInPolygon(px, py, pts)) return true;
            return distToPolyline(px, py, pts) <= reach;
        }
        case 'curve':
            return flattenCurve(s.d).some((sub) => (sub.closed && s.fill && pointInPolygon(px, py, sub.points)) || distToPolyline(px, py, sub.closed ? [...sub.points, sub.points[0]!] : sub.points) <= reach);
        case 'band':
            // A band is its fill: without one nothing is painted, so nothing is hit.
            return !!s.fill && pointInPolygon(px, py, [...s.upper, ...[...s.lower].reverse()]);
        case 'rows':
            return s.rows.some((r) => pointInBox(px, py, s.x, r.y, s.x + r.w, r.y + r.h, tol));
        case 'text': {
            let x = px;
            let y = py;
            const angle = textAngle(s);
            if (angle) {
                // Into the text's own frame: undo the rotation around its anchor.
                const cos = Math.cos(-angle);
                const sin = Math.sin(-angle);
                x = s.at[0] + (px - s.at[0]) * cos - (py - s.at[1]) * sin;
                y = s.at[1] + (px - s.at[0]) * sin + (py - s.at[1]) * cos;
            }
            const b = textBox(s);
            return pointInBox(x, y, b.x, b.y, b.x + b.w, b.y + b.h, tol);
        }
        case 'marker':
            return Math.hypot(px - s.at[0], py - s.at[1]) <= (s.size ?? 8) / 2 + tol;
        case 'image':
            return pointInBox(px, py, s.at[0] - s.w / 2, s.at[1] - s.h / 2, s.at[0] + s.w / 2, s.at[1] + s.h / 2, tol);
        case 'drawing':
            return env.embedded?.(s) ?? false;
        case 'tag':
            return false;
    }
}

/** The front-most shape under (px, py), or null. Shapes paint in list order, so the last hit wins. */
export function hitShapes(shapes: readonly DrawingShape[], px: number, py: number, tol: number, env: ShapeHitEnv): DrawingShape | null {
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
        const s = shapes[i]!;
        if (s.kind === 'tag' || s.hit === false) continue;
        if (hitOne(s, px, py, tol, env)) return s;
    }
    return null;
}

/** The points a shape occupies, for bounds (a rough outline is enough). */
function outline(s: DrawingShape): ShapePoint[] {
    switch (s.kind) {
        case 'line':
            return [s.from, s.to];
        case 'path':
            return [...s.points];
        case 'rect':
            return [s.from, s.to];
        case 'ellipse':
            return ellipsePoints(s, 12);
        case 'curve':
            return flattenCurve(s.d, 6).flatMap((sub) => sub.points);
        case 'band':
            return [...s.upper, ...s.lower];
        case 'rows':
            return s.rows.flatMap((r): ShapePoint[] => [[s.x, r.y], [s.x + r.w, r.y + r.h]]);
        case 'text': {
            const b = textBox(s);
            return [[b.x, b.y], [b.x + b.w, b.y + b.h]];
        }
        case 'marker': {
            const r = (s.size ?? 8) / 2;
            return [[s.at[0] - r, s.at[1] - r], [s.at[0] + r, s.at[1] + r]];
        }
        case 'image':
            return [[s.at[0] - s.w / 2, s.at[1] - s.h / 2], [s.at[0] + s.w / 2, s.at[1] + s.h / 2]];
        default:
            return [];
    }
}

/** The box around a list of shapes and extra points, or null when there is nothing finite. */
export function shapesBounds(shapes: readonly DrawingShape[], extra: readonly ShapePoint[] = []): { x: number; y: number; w: number; h: number } | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (p: ShapePoint): void => {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
    };
    for (const s of shapes) for (const p of outline(s)) add(p);
    for (const p of extra) add(p);
    return x0 <= x1 && y0 <= y1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
