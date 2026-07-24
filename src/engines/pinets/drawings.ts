import type { LineStyle } from '../../core/model/series';
import type {
    DrawingLine,
    DrawingBox,
    DrawingXLoc,
    DrawingExtend,
    BoxTextSize,
    BoxHAlign,
    BoxVAlign,
    BoxFontFamily,
    DrawingLabel,
    LabelStyle,
    LabelYLoc,
    PolylinePoint,
    DrawingPolyline,
    DrawingLinefill,
    TablePosition,
    TableCell,
    TableMerge,
    DrawingTable,
} from '../../core/model/drawings';
import type { PinePlot } from './PineRun';
import { asString } from './PineRun';
import { normColor } from './colors';
import { IdentityMap } from './identityMap';

/**
 * Parse PineTS drawing-object containers (`__lines__`, `__boxes__`) into the
 * neutral drawing model. PineTS stores the live (non-deleted) objects as an
 * array on the LAST container point's `value`; each object's fields use the
 * exact constants the engine emits (verified via scripts/capture-drawings.mjs).
 *
 * Robustness: constants are matched defensively (long OR short forms), and any
 * coordinate that arrives as an unresolved Series object `{data,offset}` is
 * coerced to its current value rather than dropped.
 */

/** The array of live drawing objects = the last container point's `value`. */
function liveObjects(plot: PinePlot): Array<Record<string, unknown>> {
    const points = plot.data;
    if (points.length === 0) return [];
    const value = points[points.length - 1]?.value as unknown;
    return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/** Coerce a coordinate to a finite number; tolerate a stray Series `{data,offset}`. */
function coerceNum(v: unknown): number | undefined {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (v && typeof v === 'object') {
        const o = v as { data?: unknown; offset?: unknown };
        if (Array.isArray(o.data)) {
            const off = typeof o.offset === 'number' ? o.offset : 0;
            const x = o.data[o.data.length - 1 - off];
            return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
        }
    }
    return undefined;
}

function normXLoc(raw: unknown): DrawingXLoc {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'bt' || s.includes('time') ? 'bar_time' : 'bar_index';
}

function normExtend(raw: unknown): DrawingExtend {
    const s = (asString(raw) ?? 'none').toLowerCase();
    if (s === 'b' || s === 'both') return 'both';
    if (s === 'l' || s === 'left') return 'left';
    if (s === 'r' || s === 'right') return 'right';
    return 'none';
}

function lineStyleOf(raw: unknown): LineStyle {
    const s = (asString(raw) ?? '').toLowerCase();
    if (s.includes('dot')) return 'dotted';
    if (s.includes('dash')) return 'dashed';
    return 'solid';
}

/** Pine line `color`: '' / omitted → foreground default; na/transparent → invisible. */
function resolveLineColor(raw: unknown): { color?: string; invisible: boolean } {
    if (raw === undefined) return { invisible: false }; // omitted → foreground default
    if (raw === null) return { invisible: true }; // color(na)
    if (typeof raw === 'number') return { invisible: true }; // raw `na` (NaN)
    if (typeof raw === 'string') {
        if (raw === '') return { invisible: false }; // explicit default → foreground
        const c = normColor(raw);
        return c ? { color: c, invisible: false } : { invisible: true }; // transparent → invisible
    }
    return { invisible: true };
}

/** Parse one line object (a `line.new` result or a linefill's inlined line). */
function lineFromObject(o: Record<string, unknown>, id: string): DrawingLine | null {
    const x1 = coerceNum(o.x1);
    const y1 = coerceNum(o.y1);
    const x2 = coerceNum(o.x2);
    const y2 = coerceNum(o.y2);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
    const styleStr = (asString(o.style) ?? '').toLowerCase();
    const arrowLeft = styleStr === 'style_arrow_left' || styleStr === 'style_arrow_both';
    const arrowRight = styleStr === 'style_arrow_right' || styleStr === 'style_arrow_both';
    const { color, invisible } = resolveLineColor(o.color);
    return {
        id,
        paneId: 'unrouted',
        xloc: normXLoc(o.xloc),
        x1,
        y1,
        x2,
        y2,
        extend: normExtend(o.extend),
        color,
        invisible,
        width: Math.max(1, coerceNum(o.width) ?? 1),
        style: lineStyleOf(o.style),
        arrowLeft,
        arrowRight,
        overlay: o.force_overlay === true,
    };
}

export function toLines(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLine[] {
    const out: DrawingLine[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const ln = lineFromObject(o, ids.next(instanceId, 'line', String(o.id ?? out.length)));
        if (ln) out.push(ln);
    }
    return out;
}

/** `linefill.new(line1, line2, color)` — the band between two inlined line objects. */
export function toLinefills(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLinefill[] {
    const out: DrawingLinefill[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const l1 = o.line1 as Record<string, unknown> | undefined;
        const l2 = o.line2 as Record<string, unknown> | undefined;
        if (!l1 || !l2) continue;
        const id = ids.next(instanceId, 'linefill', String(o.id ?? out.length));
        const line1 = lineFromObject(l1, `${id}:a`);
        const line2 = lineFromObject(l2, `${id}:b`);
        if (!line1 || !line2) continue;
        out.push({ id, paneId: 'unrouted', line1, line2, color: normColor(o.color), overlay: o.force_overlay === true });
    }
    return out;
}

/** Pine v6 allows a numeric pixel text_size — map it to the nearest named bucket. */
function nearestNamedSize(px: number): BoxTextSize {
    if (px <= 0) return 'auto';
    if (px <= 9) return 'tiny';
    if (px <= 12) return 'small';
    if (px <= 17) return 'normal';
    if (px <= 28) return 'large';
    return 'huge';
}
function normTextSize(raw: unknown): BoxTextSize {
    if (typeof raw === 'number' && Number.isFinite(raw)) return nearestNamedSize(raw);
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'tiny' || s === 'small' || s === 'normal' || s === 'large' || s === 'huge' ? s : 'auto';
}
function normHAlign(raw: unknown): BoxHAlign {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'left' || s === 'right' ? s : 'center';
}
function normVAlign(raw: unknown): BoxVAlign {
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'top' || s === 'bottom' ? s : 'center';
}
function normFont(raw: unknown): BoxFontFamily {
    return (asString(raw) ?? '').toLowerCase().includes('mono') ? 'monospace' : 'default';
}

export function toBoxes(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingBox[] {
    const out: DrawingBox[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const left = coerceNum(o.left);
        const top = coerceNum(o.top);
        const right = coerceNum(o.right);
        const bottom = coerceNum(o.bottom);
        if (left === undefined || top === undefined || right === undefined || bottom === undefined) continue;

        const fmt = (asString(o.text_formatting) ?? '').toLowerCase();
        const textStr = asString(o.text);

        out.push({
            id: ids.next(instanceId, 'box', String(o.id ?? out.length)),
            paneId: 'unrouted',
            xloc: normXLoc(o.xloc),
            left,
            top,
            right,
            bottom,
            extend: normExtend(o.extend),
            bgColor: normColor(o.bgcolor),
            borderColor: normColor(o.border_color),
            borderWidth: Math.max(0, coerceNum(o.border_width) ?? 1),
            borderStyle: lineStyleOf(o.border_style),
            text: textStr && textStr.length > 0 ? textStr : undefined,
            textColor: normColor(o.text_color),
            textSize: normTextSize(o.text_size),
            hAlign: normHAlign(o.text_halign),
            vAlign: normVAlign(o.text_valign),
            wrap: (asString(o.text_wrap) ?? '').toLowerCase().includes('auto'),
            fontFamily: normFont(o.text_font_family),
            bold: fmt.includes('bold'),
            italic: fmt.includes('italic'),
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

const LABEL_STYLES: readonly LabelStyle[] = [
    'label_up', 'label_down', 'label_left', 'label_right', 'label_center',
    'label_lower_left', 'label_lower_right', 'label_upper_left', 'label_upper_right',
    'circle', 'square', 'diamond', 'flag', 'arrowup', 'arrowdown',
    'triangleup', 'triangledown', 'cross', 'xcross', 'text_outline', 'none',
];

function normLabelStyle(raw: unknown): LabelStyle {
    const s = (asString(raw) ?? '').toLowerCase().replace(/^style_/, '');
    return (LABEL_STYLES as readonly string[]).includes(s) ? (s as LabelStyle) : 'label_down';
}

function normYLoc(raw: unknown): LabelYLoc {
    const s = (asString(raw) ?? '').toLowerCase();
    if (s === 'ab' || s.includes('above')) return 'abovebar';
    if (s === 'bl' || s.includes('below')) return 'belowbar';
    return 'price';
}

function normLabelSize(raw: unknown): BoxTextSize {
    if (typeof raw === 'number' && Number.isFinite(raw)) return nearestNamedSize(raw);
    const s = (asString(raw) ?? '').toLowerCase();
    return s === 'auto' || s === 'tiny' || s === 'small' || s === 'large' || s === 'huge' ? s : 'normal';
}

export function toLabels(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingLabel[] {
    const out: DrawingLabel[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const x = coerceNum(o.x);
        const yloc = normYLoc(o.yloc);
        const yRaw = coerceNum(o.y);
        if (x === undefined) continue;
        if (yloc === 'price' && yRaw === undefined) continue; // price anchor needs a y
        const textStr = asString(o.text);
        const tip = asString(o.tooltip);
        // `color = na` → bubble/marker is invisible, only the text shows (Pine semantics).
        const { color, invisible } = resolveLineColor(o.color);
        out.push({
            id: ids.next(instanceId, 'label', String(o.id ?? out.length)),
            paneId: 'unrouted',
            xloc: normXLoc(o.xloc),
            x,
            y: yRaw ?? 0,
            yloc,
            text: textStr && textStr.length > 0 ? textStr : undefined,
            style: normLabelStyle(o.style),
            color,
            noFill: invisible,
            textColor: normColor(o.textcolor),
            size: normLabelSize(o.size),
            textAlign: normHAlign(o.textalign),
            tooltip: tip && tip.length > 0 ? tip : undefined,
            fontFamily: normFont(o.text_font_family),
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

export function toPolylines(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingPolyline[] {
    const out: DrawingPolyline[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const rawPts = Array.isArray(o.points) ? (o.points as Array<Record<string, unknown>>) : [];
        // Pine's single object-level xloc selects WHICH chart.point field to use for x
        // (index for bar_index, time for bar_time) — uniformly for every vertex.
        const plXloc = normXLoc(o.xloc);
        const points: PolylinePoint[] = [];
        for (const rp of rawPts) {
            const price = coerceNum(rp.price);
            const idx = coerceNum(rp.index);
            const tm = coerceNum(rp.time);
            const primary = plXloc === 'bar_time' ? tm : idx;
            const fallback = plXloc === 'bar_time' ? idx : tm;
            let x: number;
            let xloc: DrawingXLoc;
            if (primary !== undefined) {
                x = primary;
                xloc = plXloc;
            } else if (fallback !== undefined) {
                x = fallback;
                xloc = plXloc === 'bar_time' ? 'bar_index' : 'bar_time';
            } else {
                continue;
            }
            if (price === undefined) continue;
            points.push({ xloc, x, price });
        }
        if (points.length < 2) continue;
        const styleStr = (asString(o.line_style) ?? '').toLowerCase();
        out.push({
            id: ids.next(instanceId, 'polyline', String(o.id ?? out.length)),
            paneId: 'unrouted',
            points,
            curved: o.curved === true,
            closed: o.closed === true,
            lineColor: normColor(o.line_color),
            fillColor: normColor(o.fill_color),
            lineWidth: Math.max(1, coerceNum(o.line_width) ?? 1),
            lineStyle: lineStyleOf(o.line_style),
            arrowLeft: styleStr === 'style_arrow_left' || styleStr === 'style_arrow_both',
            arrowRight: styleStr === 'style_arrow_right' || styleStr === 'style_arrow_both',
            overlay: o.force_overlay === true,
        });
    }
    return out;
}

const TABLE_POSITIONS: readonly TablePosition[] = [
    'top_left', 'top_center', 'top_right',
    'middle_left', 'middle_center', 'middle_right',
    'bottom_left', 'bottom_center', 'bottom_right',
];

function normPosition(raw: unknown): TablePosition {
    const s = (asString(raw) ?? '').toLowerCase();
    return (TABLE_POSITIONS as readonly string[]).includes(s) ? (s as TablePosition) : 'top_right';
}

function parseCell(raw: unknown): TableCell | null {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const text = asString(c.text);
    const tip = asString(c.tooltip);
    const fmt = (asString(c.text_formatting) ?? '').toLowerCase();
    return {
        text: text && text.length > 0 ? text : undefined,
        textColor: normColor(c.text_color),
        bgColor: normColor(c.bgcolor),
        hAlign: normHAlign(c.text_halign),
        vAlign: normVAlign(c.text_valign),
        textSize: normLabelSize(c.text_size),
        fontFamily: normFont(c.text_font_family),
        tooltip: tip && tip.length > 0 ? tip : undefined,
        bold: fmt.includes('bold'),
        italic: fmt.includes('italic'),
        merged: c._merged === true,
    };
}

function parseMerges(raw: unknown): TableMerge[] {
    if (!Array.isArray(raw)) return [];
    const out: TableMerge[] = [];
    for (const m of raw) {
        if (!m || typeof m !== 'object') continue;
        const o = m as Record<string, unknown>;
        const sc = coerceNum(o.startCol ?? o.start_column ?? o.startColumn);
        const sr = coerceNum(o.startRow ?? o.start_row);
        const ec = coerceNum(o.endCol ?? o.end_column ?? o.endColumn);
        const er = coerceNum(o.endRow ?? o.end_row);
        if (sc === undefined || sr === undefined || ec === undefined || er === undefined) continue;
        out.push({
            startCol: Math.min(Math.round(sc), Math.round(ec)),
            startRow: Math.min(Math.round(sr), Math.round(er)),
            endCol: Math.max(Math.round(sc), Math.round(ec)),
            endRow: Math.max(Math.round(sr), Math.round(er)),
        });
    }
    return out;
}

export function toTables(plot: PinePlot, instanceId: string, ids: IdentityMap): DrawingTable[] {
    const out: DrawingTable[] = [];
    for (const o of liveObjects(plot)) {
        if (o._deleted === true) continue;
        const rawCells = Array.isArray(o.cells) ? (o.cells as unknown[]) : [];
        const cells: Array<Array<TableCell | null>> = rawCells.map((row) =>
            (Array.isArray(row) ? (row as unknown[]) : []).map((c) => parseCell(c)),
        );
        out.push({
            id: ids.next(instanceId, 'table', String(o.id ?? out.length)),
            paneId: 'unrouted',
            position: normPosition(o.position),
            columns: Math.max(0, Math.round(coerceNum(o.columns) ?? 0)),
            rows: Math.max(0, Math.round(coerceNum(o.rows) ?? 0)),
            bgColor: normColor(o.bgcolor),
            frameColor: normColor(o.frame_color),
            frameWidth: Math.max(0, coerceNum(o.frame_width) ?? 0),
            borderColor: normColor(o.border_color),
            borderWidth: Math.max(0, coerceNum(o.border_width) ?? 0),
            cells,
            merges: parseMerges(o.merges),
        });
    }
    return out;
}
