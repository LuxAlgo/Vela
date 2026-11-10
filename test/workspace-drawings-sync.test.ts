// @vitest-environment jsdom
// The drawings link across a layout switch (what a chart the switch adds, or brings back
// from the pool, arrives with) and across a reload (which copies are still linked).
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
import { encodeState, type WorkspaceState } from '../src/workspace/persist';
import { drawingTypeEntries } from '../src/core/drawings/registry';

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

/** A fresh workspace booted from `state` the way a page reload does it: a persisted
 *  document in a synchronous storage, read before the first chart is built. */
function reload(state: WorkspaceState, opts: Record<string, unknown> = {}): VelaWorkspace {
    const saved = encodeState(state);
    return mountWorkspace({ ...opts, persist: 'drawings-link-test', storage: { get: () => saved, set() {} } });
}

/** One saved drawing, shaped like what an earlier session wrote to storage. */
function saved(id: string, anchors = ANCHORS, style: Record<string, unknown> = { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' }) {
    return { id, type: 'trendline', paneId: 'price', anchors, style, locked: false, visible: true, zIndex: 1, createdAt: 1 };
}

/** A saved document: `layout`, the drawings link setting, and each chart's drawings. */
function savedDocument(layout: string, drawingsLink: unknown, charts: Record<string, Array<ReturnType<typeof saved>>>): WorkspaceState {
    return {
        version: 1,
        layout,
        sync: { drawings: drawingsLink },
        charts: Object.entries(charts).map(([id, drawings]) => ({ id, drawings: { version: 1, drawings } })),
    } as unknown as WorkspaceState;
}

const MOVED = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];

describe('drawings link after a reload', () => {
    it('moving a drawing from an earlier session moves its copy on the other chart', () => {
        const first = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        first.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS, style: { lineColor: '#ff8800' } });
        const ws = reload(first.getState());

        const c1 = ws.cell('c1')!.chart.drawings;
        const c2 = ws.cell('c2')!.chart.drawings;
        c1.update(c1.all()[0]!.id, { anchors: MOVED });
        expect(c2.all()).toHaveLength(1);
        expect(c2.all()[0]!.anchors).toEqual(MOVED);

        // Both ways: the copy on the second chart leads just as well.
        const back = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 23), price: 95 }];
        c2.update(c2.all()[0]!.id, { anchors: back });
        expect(c1.all()[0]!.anchors).toEqual(back);
    });

    it('linked copies of every drawing tool relink after a reload', () => {
        const first = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        const c1First = first.cell('c1')!.chart.drawings;
        const points = [...ANCHORS, { time: Date.UTC(2024, 0, 12), price: 110 }];
        const types = drawingTypeEntries().map((e) => e.type);
        expect(types.length).toBeGreaterThan(20);
        for (const type of types) c1First.add(type, { anchors: points, text: { value: 'note', size: 'normal', hAlign: 'left', vAlign: 'top' } });
        expect(first.cell('c2')!.chart.drawings.all()).toHaveLength(c1First.all().length);

        const ws = reload(first.getState());
        const c1 = ws.cell('c1')!.chart.drawings;
        const c2 = ws.cell('c2')!.chart.drawings;
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }, { time: Date.UTC(2024, 0, 19), price: 130 }];
        const stayedBehind: string[] = [];
        for (const doc of c1.all()) {
            c1.update(doc.id, { anchors: moved });
            const copy = c2.all().find((d) => d.type === doc.type);
            if (JSON.stringify(copy?.anchors) !== JSON.stringify(moved)) stayedBehind.push(doc.type);
        }
        expect(stayedBehind).toEqual([]);
    });

    it('a document saved before links were restored relinks its identical copies', () => {
        const ws = reload(savedDocument('2h', true, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        const c1 = ws.cell('c1')!.chart.drawings;
        c1.update('dw-1', { anchors: MOVED, style: { lineColor: '#00aa55', lineWidth: 2, lineStyle: 'solid' } });
        const copy = ws.cell('c2')!.chart.drawings.all()[0]!;
        expect(copy.anchors).toEqual(MOVED);
        expect(copy.style.lineColor).toBe('#00aa55');
    });

    it('deleting a drawing from an earlier session deletes its copy on the other chart', () => {
        const ws = reload(savedDocument('2h', true, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        ws.cell('c2')!.chart.drawings.remove('dw-1');
        expect(ws.cell('c1')!.chart.drawings.all()).toHaveLength(0);
    });

    it('a restored document applied to the open workspace relinks its copies', () => {
        // Same layout: the document lands on the live charts in place.
        const inPlace = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        inPlace.applyState(savedDocument('2h', true, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        inPlace.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(inPlace.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(MOVED);

        // Another layout: every chart is rebuilt from the document.
        const rebuilt = mountWorkspace({ layout: '1' });
        rebuilt.applyState(savedDocument('2h', true, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        rebuilt.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(rebuilt.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(MOVED);
    });

    it('a copy edited while the link was off stays independent after a reload', () => {
        const first = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        first.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        first.sync.set('drawings', false);
        const c2First = first.cell('c2')!.chart.drawings;
        const own = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 12), price: 60 }];
        c2First.update(c2First.all()[0]!.id, { anchors: own });
        first.sync.set('drawings', true);

        const ws = reload(first.getState());
        const c1 = ws.cell('c1')!.chart.drawings;
        c1.update(c1.all()[0]!.id, { anchors: MOVED });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(own);
        c1.remove(c1.all()[0]!.id);
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
    });

    it('identical duplicates pair one to one, in order', () => {
        const ws = reload(
            savedDocument('2h', true, {
                c1: [saved('dw-1'), saved('dw-2'), saved('dw-3')],
                c2: [saved('dw-1'), saved('dw-2')],
            }),
        );
        const c1 = ws.cell('c1')!.chart.drawings;
        const c2 = ws.cell('c2')!.chart.drawings;
        const at = (id: string) => c2.all().find((d) => d.id === id)!.anchors;

        c1.update('dw-1', { anchors: MOVED });
        expect(at('dw-1')).toEqual(MOVED);
        expect(at('dw-2')).toEqual(ANCHORS);

        const other = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 30), price: 50 }];
        c1.update('dw-2', { anchors: other });
        expect(at('dw-1')).toEqual(MOVED);
        expect(at('dw-2')).toEqual(other);

        // The third has no partner left on the second chart: it moves and deletes alone.
        c1.update('dw-3', { anchors: [ANCHORS[0]!, { time: Date.UTC(2024, 1, 6), price: 30 }] });
        c1.remove('dw-3');
        expect(c2.all().map((d) => d.anchors)).toEqual([MOVED, other]);
    });

    it('with link groups, copies relink only with charts in the same group', () => {
        const ws = reload(
            savedDocument('4', { c1: 'a', c2: 'a', c3: 'b', c4: 'b' }, {
                c1: [saved('dw-1')],
                c2: [saved('dw-1')],
                c3: [saved('dw-1')],
                c4: [saved('dw-1')],
            }),
        );
        const anchorsOn = (id: string) => ws.cell(id)!.chart.drawings.all()[0]!.anchors;
        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(anchorsOn('c2')).toEqual(MOVED);
        expect(anchorsOn('c3')).toEqual(ANCHORS);
        expect(anchorsOn('c4')).toEqual(ANCHORS);

        const other = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 30), price: 50 }];
        ws.cell('c4')!.chart.drawings.update('dw-1', { anchors: other });
        expect(anchorsOn('c3')).toEqual(other);
        expect(anchorsOn('c1')).toEqual(MOVED);
    });

    it('a chart outside every link group keeps its identical copy to itself', () => {
        const ws = reload(savedDocument('2h', { c1: 'a' }, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(ANCHORS);
    });

    it('turning the link on links identical copies the same way a reload does', () => {
        const ws = reload(savedDocument('2h', false, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(ANCHORS); // off: independent

        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: ANCHORS }); // identical again
        ws.sync.set('drawings', true);
        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(MOVED);
    });

    it('a chart brought back after a reload links its saved copies instead of duplicating them', () => {
        // Saved on a four-chart grid, reloaded showing two: the other two wait in the pool.
        const doc = savedDocument('4', true, { c1: [saved('dw-1')], c2: [saved('dw-1')], c3: [saved('dw-1')], c4: [saved('dw-1')] });
        const ws = reload({ ...doc, layout: '2h' });
        ws.setLayout('4');
        for (const id of ['c3', 'c4']) expect(ws.cell(id)!.chart.drawings.all()).toHaveLength(1);

        ws.cell('c1')!.chart.drawings.update('dw-1', { anchors: MOVED });
        for (const id of ['c2', 'c3', 'c4']) expect(ws.cell(id)!.chart.drawings.all()[0]!.anchors).toEqual(MOVED);
    });

    it('a drawing reloaded with the link off stays independent', () => {
        const ws = reload(savedDocument('2h', false, { c1: [saved('dw-1')], c2: [saved('dw-1')] }));
        ws.cell('c1')!.chart.drawings.remove('dw-1');
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
    });
});
