import type { LineStyle } from '../../core/model/series';
import type { DrawingExtend, BoxTextSize } from '../../core/model/drawings';

/**
 * Pure geometry/colour/text helpers for the {@link DrawingLayer}. No
 * lightweight-charts dependency, so they are unit-testable in isolation.
 */

/**
 * Map a bar-time (epoch ms) to a fractional logical bar index, given the sorted
 * bar times and the median bar interval. Extrapolates linearly past either end
 * (negative before the first bar, > n-1 after the last) so drawings anchored to
 * future/extended times still resolve.
 */
export function barTimeToLogical(ms: number, times: readonly number[], intervalMs: number): number {
    const n = times.length;
    if (n === 0) return 0;
    const first = times[0]!;
    const last = times[n - 1]!;
    if (ms <= first) {
        const iv = n > 1 ? times[1]! - first : intervalMs || 1;
        return iv > 0 ? (ms - first) / iv : 0;
    }
    if (ms >= last) {
        const iv = intervalMs || (n > 1 ? last - times[n - 2]! : 1);
        return iv > 0 ? n - 1 + (ms - last) / iv : n - 1;
    }
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = times[mid]!;
        if (t === ms) return mid;
        if (t < ms) lo = mid + 1;
        else hi = mid - 1;
    }
    const i = hi; // times[i] < ms < times[i+1]
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    return t1 > t0 ? i + (ms - t0) / (t1 - t0) : i;
}

/** Median of consecutive diffs (robust bar interval). */
export function medianInterval(times: readonly number[]): number {
    const diffs: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
        const d = times[i]! - times[i - 1]!;
        if (d > 0) diffs.push(d);
    }
    if (diffs.length === 0) return 0;
    diffs.sort((a, b) => a - b);
    return diffs[diffs.length >> 1] ?? 0;
}

/** Canvas dash pattern (px) for a Pine line style, scaled by width. */
export function dashPattern(style: LineStyle, width: number): number[] {
    const w = Math.max(1, width);
    if (style === 'dotted') return [w, w * 2];
    if (style === 'dashed') return [w * 4, w * 3];
    return [];
}

/**
 * Endpoints to actually stroke for a line, applying Pine `extend`. The returned
 * segment is left→right; arrowheads should use the ORIGINAL endpoints, not these.
 * A vertical line with any extend spans the full pane height.
 */
export function extendEndpoints(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    extend: DrawingExtend,
    width: number,
    height: number,
): [number, number, number, number] {
    if (extend === 'none') return [x1, y1, x2, y2];
    const dx = x2 - x1;
    const left = extend === 'left' || extend === 'both';
    const right = extend === 'right' || extend === 'both';
    if (Math.abs(dx) < 1e-6) {
        // Vertical line: extend runs along the line itself (it has no horizontal
        // room). both → full height; right → ray from p1 through p2 to the edge;
        // left → ray from p2 through p1 to the edge.
        if (left && right) return [x1, 0, x2, height];
        const downward = y2 >= y1; // p2 below p1 on canvas (y grows downward)
        if (right) return downward ? [x1, y1, x2, height] : [x1, y1, x2, 0];
        return downward ? [x1, 0, x2, y2] : [x1, height, x2, y2];
    }
    const slope = (y2 - y1) / dx;
    const yAt = (x: number): number => y1 + slope * (x - x1);
    const lx = left ? -2 : Math.min(x1, x2);
    const rx = right ? width + 2 : Math.max(x1, x2);
    return [lx, yAt(lx), rx, yAt(rx)];
}

export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Parse #RGB / #RRGGBB / #RRGGBBAA / rgb()/rgba() → channels, or null. */
export function parseColor(c: string): Rgba | null {
    const s = c.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1]!;
        return { r: parseInt(h[0]! + h[0]!, 16), g: parseInt(h[1]! + h[1]!, 16), b: parseInt(h[2]! + h[2]!, 16), a: 1 };
    }
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (m) {
        const h = m[1]!;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            a: m[2] ? parseInt(m[2], 16) / 255 : 1,
        };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const p = m[1]!.split(',').map((x) => parseFloat(x.trim()));
        return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
    }
    return null;
}

export function relativeLuminance(r: number, g: number, b: number): number {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Black or white, whichever contrasts the given background better. */
export function contrastColor(bg: string | undefined): string {
    if (!bg) return '#000000';
    const c = parseColor(bg);
    if (!c) return '#000000';
    return relativeLuminance(c.r, c.g, c.b) > 0.55 ? '#000000' : '#ffffff';
}

/** Line height (px) for multi-line drawing labels — one value shared by the canvas painter and
 *  the inline text editor, so the glyphs don't shift when an edit starts. */
export function labelLineHeight(fontSize: number): number {
    return Math.round(fontSize * 1.4);
}

/** How far the frame around a targeted/edited text label extends past its glyph box — horizontally
 *  (`inset`) and vertically (`rise`). Shared by the canvas painter (selection/hover frame) and the
 *  inline editor (border + padding), which keeps the two frames coincident by construction. */
export const TEXT_FRAME_INSET = 5;
export const TEXT_FRAME_RISE = 3;

/** Fixed px for a named box text size; `auto` returns 0 (caller fits to box). */
export function namedFontSize(size: BoxTextSize): number {
    switch (size) {
        case 'tiny':
            return 10;
        case 'small':
            return 12;
        case 'large':
            return 18;
        case 'huge':
            return 28;
        case 'normal':
            return 14;
        default:
            return 0; // auto
    }
}

/** Auto font size that fits `lines` within a box (px). */
export function autoFontSize(lines: readonly string[], boxW: number, boxH: number, bold: boolean): number {
    // In-place max (no per-frame allocation, no argument-spread overflow on long wraps).
    let maxChars = 1;
    for (const l of lines) if (l.length > maxChars) maxChars = l.length;
    const ratio = bold ? 0.62 : 0.55;
    const byWidth = (boxW * 0.9) / (maxChars * ratio);
    const byHeight = (boxH * 0.85) / (lines.length * 1.3);
    return Math.max(6, Math.min(byWidth, byHeight, 48));
}
