import type { DrawingTable, BoxTextSize, TablePosition } from '../../core/model/drawings';
import type { VelaTheme } from '../../core/options';

const SIZE_PX: Record<BoxTextSize, number> = {
    auto: 13,
    tiny: 10,
    small: 11,
    normal: 13,
    large: 16,
    huge: 20,
};

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
        for (const t of tables) this.root.appendChild(this.renderTable(t));
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
        const wrap = document.createElement('div');
        wrap.style.position = 'absolute';
        this.anchor(wrap, t.position, this.paneBounds(t.paneId));

        const table = document.createElement('table');
        Object.assign(table.style, {
            borderCollapse: 'collapse',
            background: t.bgColor ?? 'transparent',
            fontFamily: this.theme.fontFamily || 'sans-serif',
            // Frame as an inset shadow (not a `border`) so it stays independent of the
            // collapsed cell borders even when frame_width != border_width.
            boxShadow: t.frameColor && t.frameWidth > 0 ? `inset 0 0 0 ${t.frameWidth}px ${t.frameColor}` : 'none',
            border: 'none',
            tableLayout: 'auto',
            // Re-enable pointer events on the table only (root is none) so cell tooltips work.
            pointerEvents: 'auto',
        } satisfies Partial<CSSStyleDeclaration>);

        // Merged regions: the origin cell spans; the absorbed cells are not emitted.
        const span = new Map<string, { cs: number; rs: number }>();
        const skip = new Set<string>();
        for (const m of t.merges) {
            span.set(`${m.startRow}:${m.startCol}`, { cs: m.endCol - m.startCol + 1, rs: m.endRow - m.startRow + 1 });
            for (let r = m.startRow; r <= m.endRow; r += 1) {
                for (let c = m.startCol; c <= m.endCol; c += 1) {
                    if (r !== m.startRow || c !== m.startCol) skip.add(`${r}:${c}`);
                }
            }
        }

        const cellBorder = t.borderColor && t.borderWidth > 0 ? `${t.borderWidth}px solid ${t.borderColor}` : 'none';
        for (let r = 0; r < t.rows; r += 1) {
            const tr = document.createElement('tr');
            for (let c = 0; c < t.columns; c += 1) {
                const cell = t.cells[r]?.[c] ?? null;
                if (skip.has(`${r}:${c}`) || cell?.merged) continue; // absorbed by a merge
                const td = document.createElement('td');
                const sp = span.get(`${r}:${c}`);
                if (sp) {
                    if (sp.cs > 1) td.colSpan = sp.cs;
                    if (sp.rs > 1) td.rowSpan = sp.rs;
                }
                Object.assign(td.style, {
                    border: cellBorder,
                    padding: '2px 6px',
                    background: cell?.bgColor ?? 'transparent',
                    color: cell?.textColor ?? this.theme.textColor,
                    textAlign: cell?.hAlign ?? 'center',
                    verticalAlign: cell?.vAlign === 'top' ? 'top' : cell?.vAlign === 'bottom' ? 'bottom' : 'middle',
                    fontSize: `${SIZE_PX[cell?.textSize ?? 'normal']}px`,
                    fontFamily: cell?.fontFamily === 'monospace' ? 'monospace' : 'inherit',
                    fontWeight: cell?.bold ? 'bold' : 'normal',
                    fontStyle: cell?.italic ? 'italic' : 'normal',
                    whiteSpace: 'pre-line',
                } satisfies Partial<CSSStyleDeclaration>);
                if (cell?.tooltip) td.title = cell.tooltip;
                td.textContent = cell?.text ?? '';
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
