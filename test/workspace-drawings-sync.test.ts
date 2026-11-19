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
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { OHLCV } from '../src/core/model/ohlcv';
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

// A drawing's anchors are a time and a price on ONE instrument: the link only joins charts
// that show the same market, whatever their link group says.
describe('drawings link between charts on different symbols', () => {
    function grid(): VelaWorkspace {
        const ws = mountWorkspace({ layout: '4', sync: { drawings: true } });
        for (const id of ['c1', 'c3', 'c4']) ws.cell(id)!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('ETHUSDT');
        return ws;
    }

    it('a new drawing is copied onto the charts on its symbol only', () => {
        const ws = grid();
        ws.cell('c1')!.chart.drawings.add('fixedrangevp', { anchors: ANCHORS });
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
        for (const id of ['c3', 'c4']) expect(ws.cell(id)!.chart.drawings.all().map((d) => d.type)).toEqual(['fixedrangevp']);
    });

    it('a placement in progress shows its ghost on the charts on its symbol only', () => {
        const ws = grid();
        const ghosts = new Map<string, unknown>();
        for (const id of ['c2', 'c3']) {
            const drawings = ws.cell(id)!.chart.drawings;
            const set = drawings.setExternalGhost.bind(drawings);
            drawings.setExternalGhost = (doc) => {
                ghosts.set(id, doc);
                return set(doc);
            };
        }
        (ws as unknown as { propagateDraft(origin: string, doc: unknown): void }).propagateDraft('c1', { type: 'trendline', paneId: 'price', anchors: ANCHORS });
        expect(ghosts.has('c2')).toBe(false);
        expect(ghosts.get('c3')).not.toBeUndefined();
    });

    it('a linked copy left on a chart that moved to another symbol no longer follows', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('BTCUSDT');
        const original = ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS })!;
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);

        ws.cell('c2')!.setSymbol('ETHUSDT');
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];
        ws.cell('c1')!.chart.drawings.update(original.id, { anchors: moved });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(ANCHORS);
        ws.cell('c1')!.chart.drawings.remove(original.id);
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
    });

    it('a chart a layout switch brings back on another symbol does not receive the group drawings', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('ETHUSDT');
        ws.setLayout('1'); // c2 waits in the pool, still on ETHUSDT
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.setLayout('2h');
        const c2 = ws.cell('c2')!;
        expect(c2.symbol).toBe('ETHUSDT');
        expect(c2.chart.drawings.all()).toHaveLength(0);
    });

    it('identical drawings on charts of different symbols do not relink', () => {
        const ws = mountWorkspace({ layout: '2h' });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('ETHUSDT');
        const a = ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS })!;
        ws.cell('c2')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        ws.sync.set('drawings', true); // relinks identical copies — never across symbols
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];
        ws.cell('c1')!.chart.drawings.update(a.id, { anchors: moved });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(ANCHORS);
    });

    it('a chart its host is switching to another symbol receives nothing while the switch loads', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('BTCUSDT');
        // The host switches the chart itself: the cell names the old symbol until the switch lands.
        void ws.cell('c2')!.chart.setMarket({ symbol: 'ETHUSDT' });
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(0);
    });

    it('one market written with and without its venue is one market', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('binance:BTCUSDT');
        ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS });
        expect(ws.cell('c2')!.chart.drawings.all()).toHaveLength(1);
    });

    it('linked copies that two charts carry to another symbol together stay linked', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { drawings: true } });
        ws.cell('c1')!.setSymbol('BTCUSDT');
        ws.cell('c2')!.setSymbol('BTCUSDT');
        const original = ws.cell('c1')!.chart.drawings.add('trendline', { anchors: ANCHORS })!;
        ws.cell('c1')!.setSymbol('ETHUSDT');
        ws.cell('c2')!.setSymbol('ETHUSDT');
        const moved = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];
        ws.cell('c1')!.chart.drawings.update(original.id, { anchors: moved });
        expect(ws.cell('c2')!.chart.drawings.all()[0]!.anchors).toEqual(moved);
        ws.cell('c2')!.chart.drawings.remove(ws.cell('c2')!.chart.drawings.all()[0]!.id);
        expect(ws.cell('c1')!.chart.drawings.all()).toHaveLength(0);
    });
});

// Where a chart's drawings belong to its symbol (`clearOnSymbolChange`), a symbol switch
// swaps the document the chart holds. That document missed what the link did while the
// chart showed another symbol: once the switch has landed, the chart is brought in line
// with the charts already on the market.
describe('drawings link where a chart keeps its drawings per symbol', () => {
    const MINUTE = 60_000;
    /** A symbol whose bars never answer: a switch to it never lands. */
    const PARKED = 'SLOWUSDT';
    const provider: DataProvider = {
        getBars(ticker, tf, range) {
            if (ticker === PARKED) return new Promise(() => {});
            const n = Math.min(range.limit ?? 50, 50);
            const start = Date.now() - n * MINUTE;
            const bars = Array.from({ length: n }, (_, i): OHLCV => ({ time: start + i * MINUTE, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));
            // The 4h bars take a moment: a switch can start while they load.
            return tf === '240' ? new Promise((resolve) => setTimeout(() => resolve(bars), 20)) : Promise.resolve(bars);
        },
        listSymbols: () => Promise.resolve(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', PARKED].map((ticker) => ({ ticker }))),
    };

    /** Two charts side by side, landed on `symbols`, their drawings belonging to their symbol. */
    async function mount(symbols: [string, string], opts: Record<string, unknown> = {}): Promise<VelaWorkspace> {
        const ws = mountWorkspace({
            layout: '2h',
            symbol: 'SOLUSDT',
            volume: false,
            persist: false,
            providers: { binance: () => provider },
            drawings: { clearOnSymbolChange: true },
            sync: { drawings: true },
            ...opts,
        });
        await Promise.all([show(ws, 'c1', symbols[0]), show(ws, 'c2', symbols[1])]);
        keepPerSymbol(ws);
        return ws;
    }

    /**
     * What a host that keeps drawings per symbol does, for each chart on its own: it saves
     * the chart's document under the symbol as it changes, and puts the symbol's saved
     * document back on the chart once a switch to it has landed.
     */
    function keepPerSymbol(ws: VelaWorkspace): void {
        for (const id of ['c1', 'c2']) {
            const chart = ws.cell(id)!.chart;
            const saved = new Map<string, unknown>();
            const save = (): void => void saved.set(chart.market.symbol ?? '', JSON.parse(JSON.stringify(chart.drawings.toJSON())));
            for (const event of ['drawing:created', 'drawing:edited', 'drawing:removed'] as const) chart.on(event, save);
            chart.on('market:changed', () => {
                const doc = saved.get(chart.market.symbol ?? '');
                if (doc && chart.drawings.all().length === 0) chart.drawings.fromJSON(doc);
            });
        }
    }

    /** Switch a chart to `symbol` and wait until the switch has landed and the link has run. */
    async function show(ws: VelaWorkspace, id: string, symbol: string): Promise<void> {
        const cell = ws.cell(id)!;
        const landed = new Promise<void>((resolve) => {
            const off = cell.chart.on('market:changed', (e) => {
                if (e.symbol !== symbol) return;
                off();
                resolve();
            });
        });
        cell.setSymbol(symbol);
        await landed;
        await new Promise((r) => setTimeout(r, 0));
    }

    const drawingsOf = (ws: VelaWorkspace, id: string) => ws.cell(id)!.chart.drawings;
    const MOVED = [ANCHORS[0]!, { time: Date.UTC(2024, 0, 16), price: 140 }];

    it('a chart that arrives on a symbol shows the drawings of the chart already on it, linked', async () => {
        const ws = await mount(['BTCUSDT', 'ETHUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
        drawingsOf(ws, 'c2').update(drawingsOf(ws, 'c2').all()[0]!.id, { anchors: MOVED });
        expect(drawingsOf(ws, 'c1').all()[0]!.anchors).toEqual(MOVED);
        drawingsOf(ws, 'c1').remove(original.id);
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
    });

    it('a drawing edited while the other chart showed another symbol is edited there when it is back', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        await show(ws, 'c2', 'ETHUSDT');
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
        drawingsOf(ws, 'c1').update(original.id, { anchors: MOVED });

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([MOVED]);
    });

    it('the later edit wins when both charts left the symbol in turn, whichever is back first', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        await show(ws, 'c2', 'ETHUSDT');
        drawingsOf(ws, 'c1').update(original.id, { anchors: MOVED }); // c2 misses this edit
        await show(ws, 'c1', 'SOLUSDT');

        await show(ws, 'c2', 'BTCUSDT'); // back first, with the copy from before the edit
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
        await show(ws, 'c1', 'BTCUSDT');
        expect(drawingsOf(ws, 'c1').all().map((d) => d.anchors)).toEqual([MOVED]);
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([MOVED]);
    });

    it('a drawing removed while the other chart showed another symbol does not come back with it', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        await show(ws, 'c2', 'ETHUSDT');
        drawingsOf(ws, 'c1').remove(original.id);

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
        expect(drawingsOf(ws, 'c1').all()).toHaveLength(0);
    });

    it('a removal is owed to a chart that is away even when no chart is left on the symbol', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        await show(ws, 'c2', 'ETHUSDT');
        drawingsOf(ws, 'c1').remove(original.id);
        await show(ws, 'c1', 'ETHUSDT');

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
    });

    it('a drawing made while the switch back is loading is not taken for the removed copy', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        const copyId = drawingsOf(ws, 'c2').all()[0]!.id;
        await show(ws, 'c2', 'ETHUSDT');
        drawingsOf(ws, 'c1').remove(original.id);
        await show(ws, 'c1', 'ETHUSDT');

        const back = show(ws, 'c2', 'BTCUSDT');
        const fresh = drawingsOf(ws, 'c2').add('hline', { anchors: [ANCHORS[0]!] })!; // before the bars are in
        expect(fresh.id).toBe(copyId);
        await back;
        expect(drawingsOf(ws, 'c2').all().map((d) => d.type)).toEqual(['hline']);
    });

    it('the arriving chart keeps the drawings of its own it saved for the symbol', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT'], { sync: {} });
        drawingsOf(ws, 'c2').add('hline', { anchors: [ANCHORS[0]!] }); // its own: the link is off
        await show(ws, 'c2', 'ETHUSDT');
        ws.sync.set('drawings', true);
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.type).sort()).toEqual(['hline', 'trendline']);
        expect(drawingsOf(ws, 'c1').all().map((d) => d.type)).toEqual(['trendline']);
    });

    it('a drawing of another symbol with the same id leaves a linked set alone', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        const copyId = drawingsOf(ws, 'c2').all()[0]!.id;
        await show(ws, 'c2', 'ETHUSDT');
        // The ETH document starts its ids over: this drawing takes the id the BTC copy has.
        const other = drawingsOf(ws, 'c2').add('hline', { anchors: [ANCHORS[0]!] })!;
        expect(other.id).toBe(copyId);
        drawingsOf(ws, 'c2').remove(other.id);
        expect(drawingsOf(ws, 'c1').all()).toHaveLength(1);

        await show(ws, 'c2', 'BTCUSDT');
        drawingsOf(ws, 'c1').update(original.id, { anchors: MOVED });
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([MOVED]);
    });

    it('a restored document is not brought in line: its drawings are the ones it carries', async () => {
        const ws = await mount(['BTCUSDT', 'ETHUSDT']);
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });
        const state = JSON.parse(JSON.stringify(ws.getState())) as WorkspaceState;
        state.charts[1] = { ...state.charts[1]!, symbol: 'BTCUSDT', drawings: { version: 1, drawings: [] } as never };
        const landed = new Promise<void>((resolve) => ws.cell('c2')!.chart.on('market:changed', () => resolve()));
        ws.applyState(state);
        await landed;
        await new Promise((r) => setTimeout(r, 0));
        expect(ws.cell('c2')!.chart.market.symbol).toContain('BTCUSDT');
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
    });

    it('a timeframe change brings nothing in line', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT'], { sync: {} });
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS }); // c1's own: the link is off
        ws.sync.set('drawings', true);
        const cell = ws.cell('c2')!;
        const landed = new Promise<void>((resolve) => cell.chart.on('market:changed', () => resolve()));
        cell.setTimeframe('240');
        await landed;
        await new Promise((r) => setTimeout(r, 0));
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
    });

    // A switch that never lands still took the symbol's drawings off the chart as it
    // started: the chart that comes back missed what the link did in between.
    it('a chart back from a switch that never landed catches up with what it missed', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const edited = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        const removed = drawingsOf(ws, 'c1').add('hline', { anchors: [ANCHORS[0]!] })!;
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(2);

        ws.cell('c2')!.setSymbol(PARKED);
        await new Promise((r) => setTimeout(r, 0));
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
        drawingsOf(ws, 'c1').update(edited.id, { anchors: MOVED });
        drawingsOf(ws, 'c1').remove(removed.id);
        drawingsOf(ws, 'c1').add('ray', { anchors: ANCHORS });

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.type).sort()).toEqual(['ray', 'trendline']);
        expect(drawingsOf(ws, 'c2').all().find((d) => d.type === 'trendline')!.anchors).toEqual(MOVED);
        expect(drawingsOf(ws, 'c1').all().map((d) => d.type).sort()).toEqual(['ray', 'trendline']);
    });

    it('a chart back from a symbol nothing serves catches up with what it missed', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        ws.cell('c2')!.setSymbol('NOPEUSDT');
        await new Promise((r) => setTimeout(r, 0));
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
    });

    it('a switch that never landed, started while a timeframe change was loading, is still a switch', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const cell = ws.cell('c2')!;
        cell.setTimeframe('240'); // still loading when the symbol changes
        cell.setSymbol(PARKED);
        await new Promise((r) => setTimeout(r, 0));
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });

        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
    });

    // From the start of a switch until it has landed, the chart is empty: its saved document
    // is not back yet. The link leaves it alone meanwhile, and the arrival catches it up.
    it('a drawing made on a peer while a chart is still loading the symbol reaches it with its saved drawings', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT'], { sync: {} });
        drawingsOf(ws, 'c2').add('ray', { anchors: ANCHORS }); // c2's own: the link is off
        ws.sync.set('drawings', true);
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });
        await show(ws, 'c2', 'ETHUSDT');

        const back = show(ws, 'c2', 'BTCUSDT');
        drawingsOf(ws, 'c1').add('hline', { anchors: [ANCHORS[0]!] }); // before c2's bars are in
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
        await back;
        expect(drawingsOf(ws, 'c2').all().map((d) => d.type).sort()).toEqual(['hline', 'ray', 'trendline']);
        expect(drawingsOf(ws, 'c1').all().map((d) => d.type).sort()).toEqual(['hline', 'trendline']);
    });

    it('a linked drawing removed on a peer while a chart is still loading the symbol does not come back with it', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        await show(ws, 'c2', 'ETHUSDT');

        const back = show(ws, 'c2', 'BTCUSDT');
        drawingsOf(ws, 'c1').remove(original.id);
        await back;
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
    });

    it('a drawing made on a chart that is still loading the symbol is not taken for a linked copy it had saved', async () => {
        const ws = await mount(['BTCUSDT', 'BTCUSDT']);
        const original = drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS })!;
        const copyId = drawingsOf(ws, 'c2').all()[0]!.id;
        await show(ws, 'c2', 'ETHUSDT');

        const back = show(ws, 'c2', 'BTCUSDT');
        // Before the saved document is back: the ids start over, and this one takes the copy's.
        const fresh = drawingsOf(ws, 'c2').add('hline', { anchors: [ANCHORS[0]!] })!;
        expect(fresh.id).toBe(copyId);
        await back;
        for (const id of ['c1', 'c2']) {
            const all = drawingsOf(ws, id).all();
            expect(all.map((d) => d.type).sort()).toEqual(['hline', 'trendline']);
            expect(all.find((d) => d.type === 'hline')!.anchors).toEqual([ANCHORS[0]]);
            expect(all.find((d) => d.type === 'trendline')!.anchors).toEqual(ANCHORS);
        }
        drawingsOf(ws, 'c1').update(original.id, { anchors: MOVED });
        expect(drawingsOf(ws, 'c2').all().find((d) => d.type === 'trendline')!.anchors).toEqual(MOVED);
        expect(drawingsOf(ws, 'c2').all().find((d) => d.type === 'hline')!.anchors).toEqual([ANCHORS[0]]);
    });

    it('charts that switch to a symbol together each catch up with the chart already on it', async () => {
        const ws = mountWorkspace({
            layout: '4',
            symbol: 'SOLUSDT',
            volume: false,
            persist: false,
            providers: { binance: () => provider },
            drawings: { clearOnSymbolChange: true },
            sync: { drawings: true },
        });
        await Promise.all([show(ws, 'c1', 'ETHUSDT'), show(ws, 'c2', 'ETHUSDT'), show(ws, 'c3', 'BTCUSDT')]);
        const original = drawingsOf(ws, 'c3').add('trendline', { anchors: ANCHORS })!;

        // As a symbol link moves them: each is empty and loading while the other lands.
        await Promise.all([show(ws, 'c1', 'BTCUSDT'), show(ws, 'c2', 'BTCUSDT')]);
        expect(drawingsOf(ws, 'c1').all().map((d) => d.anchors)).toEqual([ANCHORS]);
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
        drawingsOf(ws, 'c3').update(original.id, { anchors: MOVED });
        expect(drawingsOf(ws, 'c1').all().map((d) => d.anchors)).toEqual([MOVED]);
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([MOVED]);
    });

    it('after a restored document, the next arrival on its market is brought in line again', async () => {
        const ws = await mount(['BTCUSDT', 'ETHUSDT']);
        drawingsOf(ws, 'c1').add('trendline', { anchors: ANCHORS });
        const state = JSON.parse(JSON.stringify(ws.getState())) as WorkspaceState;
        state.charts[1] = { ...state.charts[1]!, symbol: 'BTCUSDT', drawings: { version: 1, drawings: [] } as never };
        ws.applyState(state);
        await new Promise((r) => setTimeout(r, 20));
        expect(drawingsOf(ws, 'c2').all()).toHaveLength(0);
        // The restore is spent: the next arrival on the market is an arrival again.
        await show(ws, 'c2', 'ETHUSDT');
        await show(ws, 'c2', 'BTCUSDT');
        expect(drawingsOf(ws, 'c2').all().map((d) => d.anchors)).toEqual([ANCHORS]);
    });
});
