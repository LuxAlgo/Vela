import type { DrawingTable, TableCell, BoxTextSize, TablePosition } from '../../core/model/drawings';
import type { VelaTheme } from '../../core/options';

const SIZE_PX: Record<BoxTextSize, number> = {
    auto: 13,
    tiny: 10,
    small: 11,
    normal: 13,
    large: 16,
    huge: 20,
};

/** Font size in px: a Pine integer `text_size` passes through as-is. */
export function fontPxOf(size: TableCell['textSize']): number {
    if (typeof size === 'number') return size > 0 ? size : SIZE_PX.auto;
    return SIZE_PX[size] ?? SIZE_PX.auto;
}

/**
 * True when at least one cell was actually set via `table.cell()`. A merely
 * allocated table (`table.new` with rows × columns of nulls, or only
 * merge-absorbed stubs) occupies no space in Pine — it must not paint, not
 * even its background or frame.
 */
export function tableHasContent(t: DrawingTable): boolean {
    return t.cells.some((row) => row?.some((c) => c != null && !c.merged));
}

/** How each merge region renders: the origin spans, the absorbed cells are omitted. */
export interface MergeRenderPlan {
    /** Origin key (`row:col`) → col/row spans. */
    span: Map<string, { cs: number; rs: number }>;
    /** Cells to omit entirely (absorbed by a merge region). */
    omit: Set<string>;
}

/**
 * Resolve merge regions to spans + omissions. Defensive on two engine quirks:
 * duplicate merge records are idempotent, and a `merged` flag stamped on the
 * ORIGIN cell never omits it — only genuinely absorbed cells are omitted
 * (region members other than the origin, plus stray `merged`-flagged cells
 * whose region record is missing).
 */
export function mergeRenderPlan(t: DrawingTable): MergeRenderPlan {
    const span = new Map<string, { cs: number; rs: number }>();
    const omit = new Set<string>();
    for (const m of t.merges) {
        span.set(`${m.startRow}:${m.startCol}`, { cs: m.endCol - m.startCol + 1, rs: m.endRow - m.startRow + 1 });
        for (let r = m.startRow; r <= m.endRow; r += 1) {
            for (let c = m.startCol; c <= m.endCol; c += 1) {
                if (r !== m.startRow || c !== m.startCol) omit.add(`${r}:${c}`);
            }
        }
    }
    for (let r = 0; r < t.rows; r += 1) {
        for (let c = 0; c < t.columns; c += 1) {
            if (t.cells[r]?.[c]?.merged && !span.has(`${r}:${c}`)) omit.add(`${r}:${c}`);
        }
    }
    for (const key of span.keys()) omit.delete(key);
    return { span, omit };
}

/**
 * Renders Pine `table.new` objects as DOM overlays anchored to the chart corners.
 * lightweight-charts has no table primitive; tables are chrome over the canvas,
 * so this owns a positioned container appended to the chart element. One overlay
 * per indicator; `update()` rebuilds from the (small) table snapshot each tick.
 */
/** Pixel bounds of the pane a table belongs to, plus the right price-axis width. */
export type PaneBounds = (paneId: string) => { top: number; height: number; rightAxis: number };

export class TableOverlay {
    private readonly root: HTMLDivElement;

    constructor(
        private readonly container: HTMLElement,
        private readonly theme: VelaTheme,
        private readonly paneBounds: PaneBounds,
    ) {
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        this.root = document.createElement('div');
        Object.assign(this.root.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: '3',
        } satisfies Partial<CSSStyleDeclaration>);
        container.appendChild(this.root);
    }

    private lastTables: DrawingTable[] = [];

    update(tables: DrawingTable[]): void {
        this.lastTables = tables;
        this.root.replaceChildren();
        for (const t of tables) {
            if (tableHasContent(t)) this.root.appendChild(this.renderTable(t));
        }
    }

    /** Re-render at the current pane geometry — after layout settles or on resize. */
    reposition(): void {
        if (this.root.isConnected) this.update(this.lastTables);
    }

    /** Show/hide the whole overlay. Tables anchor to pane corners, not to bars, so unlike the
     *  series content they DON'T vanish with an emptied chart — the loading state hides them. */
    setVisible(visible: boolean): void {
        this.root.style.display = visible ? '' : 'none';
    }

    destroy(): void {
        this.root.remove();
    }

    private renderTable(t: DrawingTable): HTMLElement {
        const b = this.paneBounds(t.paneId);
        const wrap = document.createElement('div');
        wrap.style.position = 'absolute';
        // Frame as the wrapper's border: an OUTER stroke around the table's outline,
        // never covered by cell backgrounds (an inset shadow on the table would be).
        if (t.frameColor && t.frameWidth > 0) wrap.style.border = `${t.frameWidth}px solid ${t.frameColor}`;
        this.anchor(wrap, t.position, b);

        const table = document.createElement('table');
        Object.assign(table.style, {
            borderCollapse: 'collapse',
            background: t.bgColor ?? 'transparent',
            fontFamily: this.theme.fontFamily || 'sans-serif',
            border: 'none',
            tableLayout: 'auto',
            // Re-enable pointer events on the table only (root is none) so cell tooltips work.
            pointerEvents: 'auto',
        } satisfies Partial<CSSStyleDeclaration>);

        const { span, omit } = mergeRenderPlan(t);
        // Pine cell width/height are percents of the pane's plot area.
        const plotW = Math.max(0, (this.root.clientWidth || this.container.clientWidth) - b.rightAxis);
        const paneH = b.height;

        const cellBorder = t.borderColor && t.borderWidth > 0 ? `${t.borderWidth}px solid ${t.borderColor}` : 'none';
        for (let r = 0; r < t.rows; r += 1) {
            const tr = document.createElement('tr');
            for (let c = 0; c < t.columns; c += 1) {
                if (omit.has(`${r}:${c}`)) continue; // absorbed by a merge
                const cell = t.cells[r]?.[c] ?? null;
                const td = document.createElement('td');
                if (cell === null) {
                    // Never set via table.cell() → occupies no space: an unused
                    // row/column collapses instead of painting an empty grid.
                    Object.assign(td.style, { padding: '0', border: 'none' } satisfies Partial<CSSStyleDeclaration>);
                    tr.appendChild(td);
                    continue;
                }
                const sp = span.get(`${r}:${c}`);
                if (sp) {
                    if (sp.cs > 1) td.colSpan = sp.cs;
                    if (sp.rs > 1) td.rowSpan = sp.rs;
                }
                Object.assign(td.style, {
                    border: cellBorder,
                    padding: '2px 6px',
                    background: cell.bgColor ?? 'transparent',
                    color: cell.textColor ?? this.theme.textColor,
                    textAlign: cell.hAlign,
                    verticalAlign: cell.vAlign === 'top' ? 'top' : cell.vAlign === 'bottom' ? 'bottom' : 'middle',
                    fontSize: `${fontPxOf(cell.textSize)}px`,
                    fontFamily: cell.fontFamily === 'monospace' ? 'monospace' : 'inherit',
                    fontWeight: cell.bold ? 'bold' : 'normal',
                    fontStyle: cell.italic ? 'italic' : 'normal',
                    // Pine cell text never wraps; `\n` still breaks lines. Wrapping
                    // used to collapse unicode sparklines and ━━━ dividers.
                    whiteSpace: 'pre',
                } satisfies Partial<CSSStyleDeclaration>);
                if (cell.width) td.style.width = `${(cell.width / 100) * plotW}px`;
                if (cell.height) td.style.height = `${(cell.height / 100) * paneH}px`;
                if (cell.tooltip) td.title = cell.tooltip;
                td.textContent = cell.text ?? '';
                tr.appendChild(td);
            }
            table.appendChild(tr);
        }
        wrap.appendChild(table);
        return wrap;
    }

    /**
     * Position the wrapper at a Pine `position.*` corner/edge of the table's PANE
     * (not the whole chart), inset past the right price axis so it never overlaps
     * the Y-axis labels.
     */
    private anchor(el: HTMLElement, position: TablePosition, b: { top: number; height: number; rightAxis: number }): void {
        const m = 6;
        const containerH = this.root.clientHeight || this.container.clientHeight;
        const paneBottom = b.top + b.height;

        if (position.startsWith('top')) el.style.top = `${b.top + m}px`;
        else if (position.startsWith('bottom')) el.style.bottom = `${Math.max(0, containerH - paneBottom) + m}px`;
        else el.style.top = `${b.top + b.height / 2}px`; // middle of the pane

        if (position.endsWith('left')) el.style.left = `${m}px`;
        else if (position.endsWith('right')) el.style.right = `${b.rightAxis + m}px`; // clear the Y axis
        else el.style.left = `calc(50% - ${b.rightAxis / 2}px)`; // center of the plot area

        const tx = position.endsWith('center') ? '-50%' : '0';
        const ty = position.startsWith('middle') ? '-50%' : '0';
        if (tx !== '0' || ty !== '0') el.style.transform = `translate(${tx}, ${ty})`;
    }
}
