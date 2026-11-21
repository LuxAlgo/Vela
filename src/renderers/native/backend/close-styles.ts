/**
 * Geometry and paint rules of the price styles drawn from the close alone — line with
 * markers, step line and columns. Shared by both geometry backends so canvas2d and
 * WebGL2 place, show and color them identically.
 */
import type { OHLCV } from '../../../core/model/ohlcv';
import { CANDLE_BODY_MIN_SPACING } from './candle-lod';

/** How far a line marker stands out of the line on each side, in CSS px. */
const LINE_MARKER_RIM = 3;
/** Clear space kept between two neighbouring markers, in CSS px. */
export const LINE_MARKER_MIN_GAP = 2;

/** Radius (CSS px) of the line-with-markers dot for a line width: 8 px across on the
 *  default 2 px line, growing with a heavier line so the dot still reads as one. */
export function lineMarkerRadius(lineWidth: number): number {
    return Math.max(1, lineWidth) / 2 + LINE_MARKER_RIM;
}

/**
 * Whether the dots show at this bar pitch (center-to-center px). Below it two neighbours
 * touch or overlap and the dots merge into a lumpy band thicker than the line, which reads
 * worse than the plain line — so a dense view shows just the line (10 px on the default
 * 2 px line: an 8 px dot with 2 px of line between neighbours).
 */
export function lineMarkersVisible(pxPerBar: number, radius: number): boolean {
    return pxPerBar >= 2 * radius + LINE_MARKER_MIN_GAP;
}

/** Whether bar `i`'s column wears the up color: its close is at or above the previous
 *  bar's close (an unchanged value stays up even right after a fall). The first bar has
 *  no previous close and is up. */
export function columnIsUp(bars: readonly OHLCV[], i: number): boolean {
    const bar = bars[i];
    const prev = bars[i - 1];
    if (!bar || !prev) return true;
    return bar.close >= prev.close;
}

/** Gap between two columns, in CSS px. */
export const COLUMN_GAP = 1;

/** One column's horizontal extent, in CSS px, edges on the device-pixel grid. */
export interface ColumnGeometry {
    left: number;
    width: number;
}

/**
 * A column's extent around bar center `x` for body spacing `spacing`: it fills the bar's
 * slot less a {@link COLUMN_GAP} gap, split evenly on both sides where the device pixels
 * allow. Edges snap to the device grid from the slot boundaries, so neighbouring slots
 * share an edge and the gaps stay uniform. Below the candle-body spacing the gap would
 * take a third of every slot, so tight zooms tile the columns into a solid silhouette.
 */
export function columnGeometry(x: number, spacing: number, dpr: number): ColumnGeometry {
    const half = spacing / 2;
    const leftDev = Math.round((x - half) * dpr);
    const rightDev = Math.round((x + half) * dpr);
    const gapDev = spacing >= CANDLE_BODY_MIN_SPACING ? Math.max(1, Math.round(COLUMN_GAP * dpr)) : 0;
    const widthDev = Math.max(1, rightDev - leftDev - gapDev);
    return { left: (leftDev + Math.floor(gapDev / 2)) / dpr, width: widthDev / dpr };
}

/**
 * Snap a stroke's centerline coordinate so a stroke `width` CSS px wide covers whole device
 * pixels: an odd device-pixel width centers on a pixel's middle, an even one on a pixel
 * edge. The step line is only horizontal and vertical runs, which this keeps crisp.
 */
export function snapStroke(v: number, width: number, dpr: number): number {
    const off = Math.max(1, Math.round(width * dpr)) % 2 === 1 ? 0.5 : 0;
    return (Math.round(v * dpr - off) + off) / dpr;
}

/** A point of a close path, in CSS px. */
export interface ClosePoint {
    x: number;
    y: number;
}

/** The contiguous runs of close points over bars `[from, to]`: a bar `pointOf` has no
 *  point for (a hole in the series) ends the run, as it breaks the line style. */
export function closeRuns(from: number, to: number, pointOf: (i: number) => ClosePoint | null): ClosePoint[][] {
    const runs: ClosePoint[][] = [];
    let run: ClosePoint[] = [];
    for (let i = from; i <= to; i += 1) {
        const p = pointOf(i);
        if (p) {
            run.push(p);
            continue;
        }
        if (run.length > 0) runs.push(run);
        run = [];
    }
    if (run.length > 0) runs.push(run);
    return runs;
}

/**
 * The step line's vertices through one run of bar points (left to right): each close held
 * flat to the next bar's x, then a vertical move to that bar's close. A move with no
 * height adds no vertex.
 */
export function stepVertices(pts: readonly ClosePoint[]): ClosePoint[] {
    const out: ClosePoint[] = [];
    for (let k = 0; k < pts.length; k += 1) {
        const p = pts[k]!;
        if (k === 0) {
            out.push({ x: p.x, y: p.y });
            continue;
        }
        const prevY = pts[k - 1]!.y;
        out.push({ x: p.x, y: prevY });
        if (p.y !== prevY) out.push({ x: p.x, y: p.y });
    }
    return out;
}
