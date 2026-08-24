import type { DrawingTable, TableCell, TablePosition } from '../../core/model/drawings';
import type { VelaTheme } from '../../core/options';
import { fontPxOf, tableHasContent, mergeRenderPlan } from './TableOverlay';
import type { LabelTipRegion } from './DrawingSceneRenderer';

// Mirrors the DOM TableOverlay's box model: 2px 6px cell padding, a 6px anchor
// margin, and the browser's default ~1.2 line height for `white-space: pre` text.
const PAD_X = 6;
const PAD_Y = 2;
const MARGIN = 6;
const LINE_HEIGHT = 1.2;

/** Geometry the painter anchors against — all in PANE-RELATIVE pixels
 *  (the caller's ctx is translated to the pane's top and clipped to it). */
export interface TablePaintArgs {
    paneHeight: number;
    /** Plot-area width (excludes the right price-axis strip) — Pine cell widths are percents of it. */
    plotWidth: number;
    theme: VelaTheme;
}

interface CellBox {
    cell: TableCell;
    r: number;
    c: number;
    cs: number;
    rs: number;
}

interface TableLayout {
    colW: number[];
    rowH: number[];
    w: number;
    h: number;
    boxes: CellBox[];
}

/**
 * Paints one Pine `table.new` onto a canvas, mirroring the DOM TableOverlay's
 * layout semantics (nine-position pane anchoring past the axis, auto/percent cell
 * sizing, merges, collapsed borders, outer frame, bold/italic/mono, `\n` line
 * breaks without wrapping). Painting on canvas is what lets a table ride its
 * indicator's interleave slice and follow the object-tree stacking; cell tooltips
 * survive as hit-rects appended to `tips` (pane space — the caller shifts them).
 */
export function paintTable(ctx: CanvasRenderingContext2D, t: DrawingTable, args: TablePaintArgs, tips: LabelTipRegion[]): void {
    if (!tableHasContent(t)) return;
    const layout = layoutTable(ctx, t, args);
    if (!layout || layout.w <= 0 || layout.h <= 0) return;

    const fw = t.frameColor && t.frameWidth > 0 ? t.frameWidth : 0;
    const { x, y } = anchorOrigin(t.position, layout.w + 2 * fw, layout.h + 2 * fw, args);
    const x0 = x + fw;
    const y0 = y + fw;

    // Table background behind every cell, then the outer frame stroke around it.
    if (t.bgColor) {
        ctx.fillStyle = t.bgColor;
        ctx.fillRect(x0, y0, layout.w, layout.h);
    }
    if (fw > 0 && t.frameColor) {
        ctx.strokeStyle = t.frameColor;
        ctx.lineWidth = fw;
        ctx.strokeRect(x + fw / 2, y + fw / 2, layout.w + fw, layout.h + fw);
    }

    // Column/row pixel origins (prefix sums).
    const colX: number[] = [0];
    for (const w of layout.colW) colX.push(colX[colX.length - 1]! + w);
    const rowY: number[] = [0];
    for (const h of layout.rowH) rowY.push(rowY[rowY.length - 1]! + h);

    // Cell backgrounds + text.
    const prevBaseline = ctx.textBaseline;
    const prevAlign = ctx.textAlign;
    ctx.textBaseline = 'middle';
    for (const box of layout.boxes) {
        const rx = x0 + colX[box.c]!;
        const ry = y0 + rowY[box.r]!;
        const rw = colX[box.c + box.cs]! - colX[box.c]!;
        const rh = rowY[box.r + box.rs]! - rowY[box.r]!;
        const cell = box.cell;
        if (cell.bgColor) {
            ctx.fillStyle = cell.bgColor;
            ctx.fillRect(rx, ry, rw, rh);
        }
        const text = cell.text ?? '';
        if (text.length > 0) {
            const px = fontPxOf(cell.textSize);
            ctx.font = cellFont(cell, px, args.theme);
            ctx.fillStyle = cell.textColor ?? args.theme.textColor;
            const lines = text.split('\n');
            const blockH = lines.length * px * LINE_HEIGHT;
            const blockTop = cell.vAlign === 'top' ? ry + PAD_Y : cell.vAlign === 'bottom' ? ry + rh - PAD_Y - blockH : ry + (rh - blockH) / 2;
            const tx = cell.hAlign === 'left' ? rx + PAD_X : cell.hAlign === 'right' ? rx + rw - PAD_X : rx + rw / 2;
            ctx.textAlign = cell.hAlign;
            lines.forEach((line, i) => ctx.fillText(line, tx, blockTop + (i + 0.5) * px * LINE_HEIGHT));
        }
        if (cell.tooltip) tips.push({ left: rx, top: ry, right: rx + rw, bottom: ry + rh, text: cell.tooltip });
    }
    ctx.textBaseline = prevBaseline;
    ctx.textAlign = prevAlign;

    // Collapsed cell borders: each grid edge stroked ONCE (adjacent cells share
    // theirs), so translucent border colors don't double up on inner lines.
    if (t.borderColor && t.borderWidth > 0) {
        ctx.strokeStyle = t.borderColor;
        ctx.lineWidth = t.borderWidth;
        const seen = new Set<string>();
        ctx.beginPath();
        const edge = (ax: number, ay: number, bx: number, by: number): void => {
            const key = `${ax},${ay},${bx},${by}`;
            if (seen.has(key)) return;
            seen.add(key);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
        };
        for (const box of layout.boxes) {
            const l = Math.round(x0 + colX[box.c]!);
            const r = Math.round(x0 + colX[box.c + box.cs]!);
            const tp = Math.round(y0 + rowY[box.r]!);
            const bt = Math.round(y0 + rowY[box.r + box.rs]!);
            edge(l, tp, r, tp);
            edge(l, bt, r, bt);
            edge(l, tp, l, bt);
            edge(r, tp, r, bt);
        }
        ctx.stroke();
    }
}

/** DOM-table auto layout, approximated: content-sized columns/rows (explicit percent
 *  sizes act as minimums, like a `width` on a `pre` cell), spans distributing their
 *  deficit evenly, and never-set cells occupying no space. */
function layoutTable(ctx: CanvasRenderingContext2D, t: DrawingTable, args: TablePaintArgs): TableLayout | null {
    const { span, omit } = mergeRenderPlan(t);
    const colW = new Array<number>(t.columns).fill(0);
    const rowH = new Array<number>(t.rows).fill(0);
    const boxes: CellBox[] = [];
    for (let r = 0; r < t.rows; r += 1) {
        for (let c = 0; c < t.columns; c += 1) {
            if (omit.has(`${r}:${c}`)) continue;
            const cell = t.cells[r]?.[c];
            if (cell == null) continue; // never set via table.cell() → occupies no space
            const sp = span.get(`${r}:${c}`);
            boxes.push({ cell, r, c, cs: Math.min(sp?.cs ?? 1, t.columns - c), rs: Math.min(sp?.rs ?? 1, t.rows - r) });
        }
    }
    if (boxes.length === 0) return null;

    const sizeOf = (cell: TableCell): { w: number; h: number } => {
        const px = fontPxOf(cell.textSize);
        ctx.font = cellFont(cell, px, args.theme);
        const lines = (cell.text ?? '').split('\n');
        let maxW = 0;
        for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width);
        let w = Math.ceil(maxW) + 2 * PAD_X;
        let h = Math.ceil(lines.length * px * LINE_HEIGHT) + 2 * PAD_Y;
        if (cell.width) w = Math.max(w, (cell.width / 100) * args.plotWidth);
        if (cell.height) h = Math.max(h, (cell.height / 100) * args.paneHeight);
        return { w, h };
    };

    // Pass 1: non-spanning cells size their own column/row.
    const spanning: Array<{ box: CellBox; w: number; h: number }> = [];
    for (const box of boxes) {
        const { w, h } = sizeOf(box.cell);
        if (box.cs === 1) colW[box.c] = Math.max(colW[box.c]!, w);
        if (box.rs === 1) rowH[box.r] = Math.max(rowH[box.r]!, h);
        if (box.cs > 1 || box.rs > 1) spanning.push({ box, w, h });
    }
    // Pass 2: a span wider/taller than its tracks spreads the deficit evenly.
    for (const { box, w, h } of spanning) {
        if (box.cs > 1) {
            let sum = 0;
            for (let c = box.c; c < box.c + box.cs; c += 1) sum += colW[c]!;
            if (w > sum) for (let c = box.c; c < box.c + box.cs; c += 1) colW[c]! += (w - sum) / box.cs;
        }
        if (box.rs > 1) {
            let sum = 0;
            for (let r = box.r; r < box.r + box.rs; r += 1) sum += rowH[r]!;
            if (h > sum) for (let r = box.r; r < box.r + box.rs; r += 1) rowH[r]! += (h - sum) / box.rs;
        }
    }
    let w = 0;
    for (const cw of colW) w += cw;
    let h = 0;
    for (const rh of rowH) h += rh;
    return { colW, rowH, w, h, boxes };
}

/** Top-left of the table's OUTER box (frame included) for a Pine `position.*` anchor —
 *  the same 6px margins and axis-clearing insets the DOM overlay computes. */
function anchorOrigin(position: TablePosition, totalW: number, totalH: number, args: TablePaintArgs): { x: number; y: number } {
    let y: number;
    if (position.startsWith('top')) y = MARGIN;
    else if (position.startsWith('bottom')) y = args.paneHeight - MARGIN - totalH;
    else y = args.paneHeight / 2 - totalH / 2;
    let x: number;
    if (position.endsWith('left')) x = MARGIN;
    else if (position.endsWith('right')) x = args.plotWidth - MARGIN - totalW;
    else x = args.plotWidth / 2 - totalW / 2;
    return { x, y };
}

function cellFont(cell: TableCell, px: number, theme: VelaTheme): string {
    const family = cell.fontFamily === 'monospace' ? 'monospace' : theme.fontFamily || 'sans-serif';
    return `${cell.italic ? 'italic ' : ''}${cell.bold ? 'bold ' : ''}${px}px ${family}`;
}
