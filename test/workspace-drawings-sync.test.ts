// @vitest-environment jsdom
// The drawings link across a layout switch: what a chart the switch adds (or brings back
// from the pool) arrives with.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

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

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
});

function mountWorkspace(opts: Record<string, unknown>): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, opts as never);
    live.push(ws);
    return ws;
}

const ANCHORS = [
    { time: Date.UTC(2024, 0, 2), price: 100 },
    { time: Date.UTC(2024, 0, 9), price: 120 },
];

describe('drawings link across a layout switch', () => {
    it('drawings already on the chart are copied onto the charts the switch adds, and stay linked', () => {
        const ws = mountWorkspace({ layout: '1', sync: { drawings: true } });
        const c1 = ws.cell('c1')!.chart.drawings;
        const original = c1.add('trendline', { anchors: ANCHORS, style: { lineColor: '#ff8800' } })!;
        expect(original).not.toBeNull();

        ws.setLayout('2h');

        const c2 = ws.cell('c2')!.chart.drawings;
        const copies = c2.all();
        expect(copies).toHaveLength(1);
        expect(copies[0]!.type).toBe('trendline');
        expect(copies[0]!.anchors).toEqual(ANCHORS);
        expect(copies[0]!.style.lineColor).toBe('#ff8800');

        // Linked like any synced drawing: an edit and a removal on either side follow.
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];
        c1.update(original.id, { anchors: moved });
        expect(c2.all()[0]!.anchors).toEqual(moved);
        c2.remove(copies[0]!.id);
        expect(c1.all()).toHaveLength(0);
    });

    it('several charts added at once share one link group with the original', () => {
        const ws = mountWorkspace({ layout: '1', sync: { drawings: true } });
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('4');
        for (const id of ['c2', 'c3', 'c4']) expect(ws.cell(id)!.chart.drawings.all()).toHaveLength(1);

        // An edit on any copy reaches the original and every other copy.
        const c3 = ws.cell('c3')!.chart.drawings;
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 30), price: 80 }];
        c3.update(c3.all()[0]!.id, { anchors: moved });
        for (const id of ['c1', 'c2', 'c4']) expect(ws.cell(id)!.chart.drawings.all()[0]!.anchors).toEqual(moved);
    });

    it('the arrival is not an undoable edit on the new chart', () => {
        const ws = mountWorkspace({ layout: '1', sync: { drawings: true } });
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('2h');
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
        expect(ws.cell('c2')!.history.canUndo).toBe(false);
    });

    it('a chart returning from the pool catches up on its linked copies instead of duplicating them', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        const c1 = ws.cell('c1')!.chart.drawings;
        const original = c1.add('trendline', { anchors: ANCHORS })!;
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);

        ws.setLayout('1'); // c2 goes dormant and misses the next edit
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 20), price: 90 }];
        c1.update(original.id, { anchors: moved });
        ws.setLayout('2h');

        const back = ws.cell('c2')!.chart.drawings.all();
        expect(back).toHaveLength(1);
        expect(back[0]!.anchors).toEqual(moved);
    });

    it('a returning chart whose linked copy was undone gets a fresh linked copy', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        const c1 = ws.cell('c1')!.chart.drawings;
        const original = c1.add('trendline', { anchors: ANCHORS })!;
        ws.cell('c2')!.history.undo(); // drops the copy without a removal event — the link goes stale
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);

        ws.setLayout('1');
        ws.setLayout('2h');
        const c2 = ws.cell('c2')!.chart.drawings;
        expect(c2.all()).toHaveLength(1);

        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 25), price: 70 }];
        c1.update(original.id, { anchors: moved });
        expect(c2.all()[0]!.anchors).toEqual(moved);
    });

    it("a returning chart keeps its own drawings and never sends them to the group", () => {
        const ws = mountWorkspace({ layout: '2h' });
        ws.cell('c2')!.chart.drawings.add('hline', { anchors: [{ time: Date.UTC(2024, 0, 3), price: 105 }] });
        ws.setLayout('1');
        ws.sync.set('drawings', true);
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('2h');

        expect(ws.cell('c2')!.chart.drawings.all().map((d) => d.type).sort()).toEqual(['hline', 'trendline']);
        expect(ws.cell('c1')!.chart.drawings.all().map((d) => d.type)).toEqual(['trendline']);
    });

    it('a named group copies onto its own members only', () => {
        const ws = mountWorkspace({ layout: '1', sync: { drawings: { c1: 'a', c2: 'a', c3: 'b' } } });
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('4');
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
        expect(ws.cell('c3')!.chart.drawings.all()).toHaveLength(0);
        expect(ws.cell('c4')!.chart.drawings.all()).toHaveLength(0);
    });

    it('with the link off, the added charts start without the drawings', () => {
        const ws = mountWorkspace({ layout: '1' });
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('2h');
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
    });
});
