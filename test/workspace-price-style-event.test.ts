// @vitest-environment jsdom
// `cell:priceStyle`: each cell's `priceStyle:change` relayed up with the cell's identity —
// only the cell whose style switches emits, on every write path, with the chart still in
// the outgoing style, and cells minted by a later layout change relay exactly once.
import { describe, it, expect, beforeAll } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

type Seen = { id: string; from: string; to: string; showing: string };

function mountWorkspace() {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '4' } as never);
    const seen: Seen[] = [];
    ws.on('cell:priceStyle', (e) => seen.push({ ...e, showing: ws.cell(e.id)!.priceStyle }));
    return { ws, seen, ids: ws.cells().map((c) => c.id) };
}

describe('workspace event cell:priceStyle', () => {
    it('relays one event, from the switched cell only, on every write path, before the cell repaints', () => {
        const { ws, seen, ids } = mountWorkspace();
        const [a, b, c, d] = ids as [string, string, string, string];

        ws.cell(b)!.setPriceStyle('line'); // the topbar style menu's path
        expect(seen).toEqual([{ id: b, from: 'candles', to: 'line', showing: 'candles' }]);

        ws.cell(c)!.chart.renderer.set('priceStyle', 'area');
        ws.cell(d)!.chart.renderer.applyConfig({ series: { style: 'bars' } }); // settings dialog / template
        ws.setActiveCell(a);
        ws.context().setPriceStyle('baseline');
        expect(seen.slice(1)).toEqual([
            { id: c, from: 'candles', to: 'area', showing: 'candles' },
            { id: d, from: 'candles', to: 'bars', showing: 'candles' },
            { id: a, from: 'candles', to: 'baseline', showing: 'candles' },
        ]);

        ws.cell(b)!.setPriceStyle('line'); // already shown: silent
        expect(seen).toHaveLength(4);
        ws.destroy();
    });

    it('covers a state document applied in place', () => {
        const { ws, seen, ids } = mountWorkspace();
        const doc = ws.getState();
        const chart = doc.charts.find((ch) => ch.id === ids[2])!;
        chart.priceStyle = 'area';
        (chart.rendererConfig as { series: { style: string } }).series.style = 'area';

        ws.applyState(doc);

        expect(seen).toEqual([{ id: ids[2], from: 'candles', to: 'area', showing: 'candles' }]);
        ws.destroy();
    });

    it('cells rebuilt by a layout change relay exactly once, and the torn-down charts stay silent', () => {
        const { ws, seen, ids } = mountWorkspace();
        const gone = ws.cell(ids[3]!)!.chart;
        ws.setLayout('1');
        ws.setLayout('4');
        expect(seen).toEqual([]); // building and restoring cells is not a switch

        gone.renderer.set('priceStyle', 'line'); // the destroyed instance no longer relays
        const reborn = ws.cell(ids[3]!)!;
        expect(reborn.chart).not.toBe(gone);
        reborn.setPriceStyle('area');
        expect(seen).toEqual([{ id: ids[3], from: 'candles', to: 'area', showing: 'candles' }]);
        ws.destroy();
    });
});
