// DataTable: a sortable table with a sticky header in its own scroller (positions, orders,
// trades). Columns say how to draw, sort and tone their cell; rows are replaced wholesale on
// `setRows`, which for tens to a few thousand rows is cheaper than diffing. A row's
// `actions` part (buttons in a cell) shows while the row is hovered or focused.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { append, h, type Child } from '../lib/h';
import { t } from '../lib/t';

export const dataTableDef = defineComponent({
    name: 'data-table',
    parts: ['root', 'table', 'head', 'sort', 'row', 'cell', 'actions', 'empty'],
    settings: { 'row-height': '28px', 'head-height': '28px', 'head-z': '1' },
});

export interface DataTableColumn<T> {
    id: string;
    header: string;
    /** What the header stands for, on hover (`MFE`: maximum favorable excursion). */
    title?: string;
    align?: 'start' | 'end' | 'center';
    width?: string;
    /** The cell's content; a string or a number renders as text. */
    cell(row: T): Child;
    /** The value the column sorts by; without it the column does not sort. */
    sort?(row: T): number | string;
    tone?(row: T): 'profit' | 'loss' | 'muted' | null;
}

export interface DataTableProps<T> {
    columns: readonly DataTableColumn<T>[];
    rowKey(row: T): string;
    onRowClick?(row: T, e: MouseEvent): void;
    /** What shows when there are no rows. */
    empty?: () => HTMLElement;
    /** The initial sort. */
    sort?: { column: string; dir: 'asc' | 'desc' };
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface DataTableHandle<T> {
    readonly el: HTMLElement;
    setRows(rows: readonly T[]): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-data-table',
    css`
        @layer vela.ui {
            [data-slot='data-table'] {
                height: 100%;
                min-height: 0;
                overflow: auto;
                scrollbar-width: thin;
                scrollbar-color: ${t.scroll} transparent;
            }
            [data-slot='data-table-table'] {
                width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                font-size: 12px;
            }
            [data-slot='data-table-head'] {
                position: sticky;
                top: 0;
                z-index: ${dataTableDef.vars['head-z']};
                height: ${dataTableDef.vars['head-height']};
                padding: 0 10px;
                text-align: start;
                font-weight: 500;
                font-size: 11px;
                color: ${t.fg.muted};
                background: ${t.surface};
                border-bottom: 1px solid ${t.border.faint};
                white-space: nowrap;
                user-select: none;

                &[data-sortable] {
                    cursor: pointer;
                }
                &[data-sortable]:hover {
                    color: ${t.fg};
                }
            }
            [data-slot='data-table-sort'] {
                display: inline-block;
                margin-inline-start: 4px;
                opacity: 0.8;
                font-size: 9px;
            }
            [data-slot='data-table-row'] {
                transition: background ${t.dur.fast} ease;

                &:hover {
                    background: ${t.hover};
                }
                &[data-clickable] {
                    cursor: pointer;
                }
            }
            [data-slot='data-table-cell'] {
                height: ${dataTableDef.vars['row-height']};
                padding: 0 10px;
                border-bottom: 1px solid ${t.border.faint};
                white-space: nowrap;
                color: ${t.fg};

                &[data-tone='profit'] {
                    color: ${t.profit};
                }
                &[data-tone='loss'] {
                    color: ${t.loss};
                }
                &[data-tone='muted'] {
                    color: ${t.fg.muted};
                }
            }
            [data-slot~='data-table-head'],
            [data-slot~='data-table-cell'] {
                &[data-align='end'] {
                    text-align: end;
                    font-variant-numeric: tabular-nums;
                }
                &[data-align='center'] {
                    text-align: center;
                }
            }
            [data-slot='data-table-actions'] {
                gap: 2px;
                opacity: 0;
                transition: opacity ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: inline-flex;
                }
                &:focus-within,
                &:is([data-slot='data-table-row']:hover *) {
                    opacity: 1;
                }
            }
        }
    `,
);

export function createDataTable<T>(props: DataTableProps<T>): DataTableHandle<T> {
    injectStyles(document);
    let rows: readonly T[] = [];
    let sort = props.sort ?? null;
    const table = h('table', { slot: dataTableDef.slot('table') });
    const thead = table.createTHead();
    const tbody = h('tbody');
    const emptyHost = h('div', { slot: dataTableDef.slot('empty') });
    const el = h('div', { className: props.className, slot: dataTableDef.slot('root') }, table, emptyHost);
    table.appendChild(tbody);

    const renderHead = (): void => {
        const tr = h('tr');
        for (const col of props.columns) {
            const th = h('th', {
                slot: dataTableDef.slot('head'),
                data: { align: col.align ?? null, sortable: !!col.sort, col: col.id },
                attrs: { title: col.title ?? null, scope: 'col', 'aria-sort': sort?.column === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null },
                text: col.header,
            });
            if (col.width) th.style.width = col.width;
            if (col.sort) {
                if (sort?.column === col.id) th.appendChild(h('span', { slot: dataTableDef.slot('sort'), attrs: { 'aria-hidden': 'true' }, text: sort.dir === 'asc' ? '▲' : '▼' }));
                th.addEventListener('click', () => {
                    sort = { column: col.id, dir: sort?.column === col.id && sort.dir === 'desc' ? 'asc' : 'desc' };
                    renderHead();
                    renderBody();
                });
            }
            tr.appendChild(th);
        }
        thead.replaceChildren(tr);
    };

    const renderBody = (): void => {
        let shown = rows;
        const col = sort ? props.columns.find((c) => c.id === sort!.column) : undefined;
        if (sort && col?.sort) {
            const dir = sort.dir === 'asc' ? 1 : -1;
            shown = [...rows].sort((a, b) => {
                const va = col.sort!(a);
                const vb = col.sort!(b);
                return dir * (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb)));
            });
        }
        const frag = document.createDocumentFragment();
        for (const row of shown) {
            const tr = h('tr', { slot: dataTableDef.slot('row'), data: { key: props.rowKey(row), clickable: !!props.onRowClick } });
            if (props.onRowClick) tr.addEventListener('click', (e) => props.onRowClick!(row, e));
            for (const c of props.columns) {
                const td = h('td', { slot: dataTableDef.slot('cell'), data: { align: c.align ?? null, tone: c.tone?.(row) ?? null, col: c.id } });
                append(td, [c.cell(row)]);
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        }
        tbody.replaceChildren(frag);
        const empty = shown.length === 0 && props.empty ? props.empty() : null;
        emptyHost.replaceChildren(...(empty ? [empty] : []));
    };

    renderHead();
    return {
        el,
        setRows(next) {
            rows = next;
            renderBody();
        },
        destroy: () => el.remove(),
    };
}
