import { describe, it, expect } from 'vitest';
import { fontPxOf, tableHasContent, mergeRenderPlan } from '../src/renderers/shared/TableOverlay';
import type { DrawingTable, TableCell } from '../src/core/model/drawings';

function cell(over: Partial<TableCell> = {}): TableCell {
    return { hAlign: 'center', vAlign: 'center', textSize: 'normal', fontFamily: 'default', bold: false, italic: false, ...over };
}

function tableOf(cells: Array<Array<TableCell | null>>, merges: DrawingTable['merges'] = []): DrawingTable {
    return {
        id: 't',
        paneId: 'price',
        position: 'top_right',
        columns: cells[0]?.length ?? 0,
        rows: cells.length,
        frameWidth: 0,
        borderWidth: 0,
        cells,
        merges,
    };
}

describe('TableOverlay · fontPxOf', () => {
    it('passes an integer Pine text_size through as raw pixels', () => {
        expect(fontPxOf(14)).toBe(14);
        expect(fontPxOf(23)).toBe(23);
    });

    it('maps named sizes and treats 0/auto as the auto size', () => {
        expect(fontPxOf('large')).toBe(16);
        expect(fontPxOf('auto')).toBe(13);
        expect(fontPxOf(0)).toBe(13);
    });
});

describe('TableOverlay · tableHasContent', () => {
    it('an allocated-but-never-filled table has no content', () => {
        expect(tableHasContent(tableOf([[null, null], [null, null]]))).toBe(false);
    });

    it('a single set cell makes the table render', () => {
        expect(tableHasContent(tableOf([[null, cell({ text: 'x' })], [null, null]]))).toBe(true);
        // A set cell with no text (bgcolor-only) still counts.
        expect(tableHasContent(tableOf([[cell({ bgColor: '#ff0000' })]]))).toBe(true);
    });

    it('merge-absorbed stubs alone do not count as content', () => {
        expect(tableHasContent(tableOf([[cell({ merged: true }), cell({ merged: true })]]))).toBe(false);
    });
});

describe('TableOverlay · mergeRenderPlan', () => {
    it('origin spans, absorbed cells are omitted', () => {
        const t = tableOf([[cell({ text: 'T' }), cell(), cell()]], [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }]);
        const { span, omit } = mergeRenderPlan(t);
        expect(span.get('0:0')).toEqual({ cs: 3, rs: 1 });
        expect(omit.has('0:0')).toBe(false);
        expect(omit.has('0:1')).toBe(true);
        expect(omit.has('0:2')).toBe(true);
    });

    it('never omits the origin, even when the engine stamped `merged` on it', () => {
        // Repeated `table.merge_cells` in PineTS marks the ORIGIN cell `_merged`
        // (self-parent forwarding) — the merged title row must still paint.
        const t = tableOf(
            [[cell({ text: 'T', merged: true }), cell({ merged: true }), cell({ merged: true })]],
            [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
        );
        const { omit } = mergeRenderPlan(t);
        expect(omit.has('0:0')).toBe(false);
        expect(omit.has('0:1')).toBe(true);
    });

    it('duplicate merge records are idempotent', () => {
        const m = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 };
        const t = tableOf([[cell({ text: 'T' }), cell()], [cell(), cell()]], [m, { ...m }, { ...m }]);
        const { span, omit } = mergeRenderPlan(t);
        expect(span.size).toBe(1);
        expect(omit).toEqual(new Set(['0:1', '1:0', '1:1']));
    });

    it('a stray absorbed stub without its merge record is still omitted', () => {
        const t = tableOf([[cell({ text: 'a' }), cell({ merged: true })]]);
        const { omit } = mergeRenderPlan(t);
        expect(omit.has('0:1')).toBe(true);
        expect(omit.has('0:0')).toBe(false);
    });
});
