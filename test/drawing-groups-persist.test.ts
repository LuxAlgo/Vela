// @vitest-environment jsdom
// Drawing groups (the object tree's bundles) are part of the chart's drawings: they are
// saved with them, come back with them, and a saved workspace state carries them.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { migrate } from '../src/core/drawings/document';
import { DrawingStore } from '../src/core/drawings/DrawingStore';
import { nextGroupId } from '../src/widget/object-tree-model';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    vi.useRealTimers();
});

function mountWorkspace(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: false, symbol: 'AAA', timeframe: '60', ...opts } as never);
    live.push(ws);
    return ws;
}

const ANCHORS = [
    { time: Date.UTC(2024, 0, 2), price: 100 },
    { time: Date.UTC(2024, 0, 9), price: 120 },
];

/** A chart with three drawings, the first two grouped. */
function grouped() {
    const ws = mountWorkspace();
    const chart = ws.cell('c1')!.chart;
    const a = chart.drawings.add('trendline', { anchors: ANCHORS })!.id;
    const b = chart.drawings.add('hline', { anchors: [ANCHORS[0]!] })!.id;
    const c = chart.drawings.add('hline', { anchors: [ANCHORS[1]!] })!.id;
    chart.drawings.setGroups([{ id: 'grp-1', name: 'Levels', ids: [a, b] }]);
    return { ws, chart, ids: { a, b, c } };
}

describe('drawing groups', () => {
    it('are saved with the drawings and come back with them', () => {
        const { chart, ids } = grouped();
        const doc = chart.drawings.toJSON();
        expect(doc.groups).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b] }]);

        chart.drawings.fromJSON(null);
        expect(chart.drawings.groups()).toEqual([]);
        chart.drawings.fromJSON(doc);
        expect(chart.drawings.groups()).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b] }]);
    });

    it('are in the saved workspace state, and a restored state brings them back', () => {
        const { ws, ids } = grouped();
        const state = ws.getState();
        const saved = state.charts[0]!.drawings as { groups?: unknown };
        expect(saved.groups).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b] }]);

        const other = mountWorkspace();
        other.applyState(state);
        expect(other.cell('c1')!.chart.drawings.groups()).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b] }]);
    });

    it('keep an empty group made to drag drawings into', () => {
        const { chart } = grouped();
        chart.drawings.setGroups([...chart.drawings.groups(), { id: 'grp-2', name: 'Group 2', ids: [], pane: 'price' }]);
        const back = migrate(JSON.parse(JSON.stringify(chart.drawings.toJSON())));
        expect(back.groups?.[1]).toEqual({ id: 'grp-2', name: 'Group 2', ids: [], pane: 'price' });
    });

    it('make the workspace save again when they change', () => {
        vi.useFakeTimers();
        const { ws, chart, ids } = grouped();
        vi.advanceTimersByTime(1000);
        let told = 0;
        ws.on('state:changed', () => void told++);
        chart.drawings.setGroups([{ id: 'grp-1', name: 'Renamed', ids: [ids.a, ids.b] }]);
        vi.advanceTimersByTime(1000);
        expect(told).toBe(1);
    });

    it('say nothing when set to what they already are', () => {
        const { chart, ids } = grouped();
        let told = 0;
        chart.on('drawing:groups', () => void told++);
        chart.drawings.setGroups([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b] }]);
        expect(told).toBe(0);
    });

    it('lose a deleted drawing, and the group goes with its last member', () => {
        const { chart, ids } = grouped();
        chart.drawings.remove(ids.a);
        expect(chart.drawings.groups()).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.b] }]);
        chart.drawings.remove(ids.b);
        expect(chart.drawings.groups()).toEqual([]);
        expect(chart.drawings.toJSON().groups).toBeUndefined();
    });

    it('stay as they are through an undo', () => {
        const { chart, ids } = grouped();
        chart.drawings.update(ids.c, { visible: false });
        chart.drawings.setGroups([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b, ids.c] }]);
        chart.drawings.undo();
        expect(chart.drawings.groups()).toEqual([{ id: 'grp-1', name: 'Levels', ids: [ids.a, ids.b, ids.c] }]);
    });

    it('never hold a drawing the chart does not have, or a drawing twice', () => {
        const { chart, ids } = grouped();
        chart.drawings.setGroups([
            { id: 'g1', name: 'One', ids: [ids.a, 'dw-404'] },
            { id: 'g2', name: 'Two', ids: [ids.a, ids.c] },
            { id: 'g1', name: 'Repeated id', ids: [ids.b] },
        ]);
        expect(chart.drawings.groups()).toEqual([
            { id: 'g1', name: 'One', ids: [ids.a] },
            { id: 'g2', name: 'Two', ids: [ids.c] },
        ]);
    });

    it('drop malformed saved groups instead of failing the load', () => {
        const doc = migrate({ version: 1, drawings: [], groups: [null, 5, { id: 'x' }, { id: 'y', name: 'Y', ids: 'nope' }] });
        expect(doc.groups).toBeUndefined();
    });

    it('get an id no restored group already has', () => {
        expect(nextGroupId([])).toBe('grp-1');
        expect(nextGroupId([{ id: 'grp-4', name: 'A', ids: [] }, { id: 'custom', name: 'B', ids: [] }])).toBe('grp-5');
    });

    it('all go when every drawing is removed, an empty one included', () => {
        const { ws, chart } = grouped();
        chart.drawings.setGroups([...chart.drawings.groups(), { id: 'grp-2', name: 'Group 2', ids: [], pane: 'price' }]);
        chart.drawings.clear();
        expect(chart.drawings.groups()).toEqual([]);

        const bare = mountWorkspace();
        const empty = bare.cell('c1')!.chart;
        empty.drawings.setGroups([{ id: 'grp-1', name: 'Group 1', ids: [] }]);
        let told = 0;
        empty.on('drawing:groups', () => void told++);
        empty.drawings.clear();
        expect(empty.drawings.groups()).toEqual([]);
        expect(told).toBe(1);
        void ws;
    });

    it('belong to the symbol the chart leaves when drawings belong to their symbol, an empty one too', () => {
        const ws = mountWorkspace({ drawings: { clearOnSymbolChange: true } });
        const chart = ws.cell('c1')!.chart;
        chart.drawings.setGroups([{ id: 'grp-1', name: 'Group 1', ids: [], pane: 'price' }]);
        void chart.setMarket({ symbol: 'BBB' });
        expect(chart.drawings.groups()).toEqual([]);
    });

    it('leave nothing behind when the store is cleared', () => {
        const store = new DrawingStore();
        store.setGroups([{ id: 'grp-1', name: 'Group 1', ids: [] }]);
        store.clear();
        expect(store.groups()).toEqual([]);
        expect(store.serialize().groups).toBeUndefined();
    });
});
