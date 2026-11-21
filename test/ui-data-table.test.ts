// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createDataTable, type DataTableColumn } from '@luxalgo/vela-ui/data-table';

interface Trade {
    id: string;
    symbol: string;
    pnl: number;
}

const columns: DataTableColumn<Trade>[] = [
    { id: 'symbol', header: 'Symbol', cell: (r) => r.symbol, sort: (r) => r.symbol },
    { id: 'pnl', header: 'P&L', align: 'end', cell: (r) => r.pnl, sort: (r) => r.pnl, tone: (r) => (r.pnl > 0 ? 'profit' : r.pnl < 0 ? 'loss' : null) },
    { id: 'note', header: 'Note', cell: (r) => (r.pnl ? ['a', ['b', 1]] : null) },
];
const rows: Trade[] = [
    { id: '1', symbol: 'ETH', pnl: -20 },
    { id: '2', symbol: 'BTC', pnl: 120 },
    { id: '3', symbol: 'SOL', pnl: 0 },
];
const order = (el: HTMLElement) => [...el.querySelectorAll('[data-slot="data-table-row"]')].map((r) => (r as HTMLElement).dataset.key);

describe('data-table', () => {
    it('sorts by its initial column, and tones and aligns cells', () => {
        const table = createDataTable({ columns, rowKey: (r) => r.id, sort: { column: 'pnl', dir: 'desc' } });
        table.setRows(rows);
        expect(order(table.el)).toEqual(['2', '3', '1']);
        const pnl = table.el.querySelector('[data-key="1"] [data-col="pnl"]') as HTMLElement;
        expect(pnl.dataset.tone).toBe('loss');
        expect(pnl.dataset.align).toBe('end');
        expect(pnl.textContent).toBe('-20');
        expect((table.el.querySelector('[data-key="2"] [data-col="note"]') as HTMLElement).textContent).toBe('ab1');
        expect(table.el.querySelector('[data-col="pnl"]')!.getAttribute('aria-sort')).toBe('descending');
    });

    it('sorts on a header click, flipping the direction on the second', () => {
        const table = createDataTable({ columns, rowKey: (r) => r.id });
        table.setRows(rows);
        const header = () => table.el.querySelector('th[data-col="symbol"]') as HTMLElement;
        header().click();
        expect(order(table.el)).toEqual(['3', '1', '2']);
        header().click();
        expect(order(table.el)).toEqual(['2', '1', '3']);
    });

    it('reports row clicks and shows its empty state without rows', () => {
        const onRowClick = vi.fn();
        const table = createDataTable({ columns, rowKey: (r) => r.id, onRowClick, empty: () => Object.assign(document.createElement('p'), { textContent: 'No trades' }) });
        table.setRows([]);
        expect(table.el.querySelector('[data-slot="data-table-empty"]')!.textContent).toBe('No trades');
        table.setRows(rows.slice(0, 1));
        expect(table.el.querySelector('[data-slot="data-table-empty"]')!.textContent).toBe('');
        (table.el.querySelector('[data-key="1"]') as HTMLElement).click();
        expect(onRowClick).toHaveBeenCalledWith(rows[0], expect.anything());
    });
});
