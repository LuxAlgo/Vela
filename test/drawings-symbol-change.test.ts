// @vitest-environment jsdom
// Drawings that belong to the chart's SYMBOL (`clearOnSymbolChange`): a switch to another
// symbol removes them as it starts, a restored state keeps the drawings it carries, and
// `clear()` is the user-level "remove everything".
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
    const ws = new VelaWorkspace(host, { layout: false, symbol: 'AAA', timeframe: '60', ...opts } as never);
    live.push(ws);
    return ws;
}

const ANCHORS = [
    { time: Date.UTC(2024, 0, 2), price: 100 },
    { time: Date.UTC(2024, 0, 9), price: 120 },
];

/** The chart of the workspace's one cell, with two drawings on it and a count of the removals it announced. */
function drawn(opts: Record<string, unknown> = {}) {
    const ws = mountWorkspace(opts);
    const chart = ws.cell('c1')!.chart;
    chart.drawings.add('trendline', { anchors: ANCHORS });
    chart.drawings.add('hline', { anchors: [ANCHORS[0]!] });
    const removed: string[] = [];
    chart.on('drawing:removed', (e) => removed.push(e.id));
    const types = (): string[] => chart.drawings.all().map((d) => d.type);
    return { ws, chart, removed, types };
}

const SCOPED = { drawings: { clearOnSymbolChange: true } };

describe('drawings across a symbol change', () => {
    it('stay on the chart by default', () => {
        const { chart, types } = drawn();
        expect(chart.drawings.getClearOnSymbolChange()).toBe(false);
        void chart.setMarket({ symbol: 'BBB' });
        expect(types()).toEqual(['trendline', 'hline']);
    });

    it('with clearOnSymbolChange, go as the switch starts: no removal announced, nothing to undo', () => {
        const { chart, removed, types } = drawn(SCOPED);
        expect(chart.drawings.getClearOnSymbolChange()).toBe(true);
        expect(chart.drawings.canUndo()).toBe(true);
        void chart.setMarket({ symbol: 'BBB' });
        // Before the new bars load: the old symbol's drawings never sit on the new one's prices.
        expect(types()).toEqual([]);
        expect(removed).toEqual([]);
        expect(chart.drawings.canUndo()).toBe(false);
    });

    it('with clearOnSymbolChange, stay through a timeframe change and a switch to the same symbol', () => {
        const { chart, types } = drawn(SCOPED);
        void chart.setMarket({ timeframe: '240' });
        expect(types()).toEqual(['trendline', 'hline']);
        void chart.setMarket({ symbol: 'AAA', timeframe: '15' });
        expect(types()).toEqual(['trendline', 'hline']);
        expect(chart.drawings.canUndo()).toBe(true);
    });

    it('a document loaded right after the switch call is the new symbol’s, and is kept', () => {
        const { chart, types } = drawn(SCOPED);
        const kept = chart.drawings.toJSON();
        kept.drawings = kept.drawings.slice(0, 1);
        void chart.setMarket({ symbol: 'BBB' });
        chart.drawings.fromJSON(kept);
        expect(types()).toEqual(['trendline']);
    });

    it('the setting turns on and off on a live chart', () => {
        const { chart, types } = drawn();
        chart.drawings.setClearOnSymbolChange(true);
        void chart.setMarket({ symbol: 'BBB' });
        expect(types()).toEqual([]);
        chart.drawings.setClearOnSymbolChange(false);
        chart.drawings.add('hline', { anchors: [ANCHORS[1]!] });
        void chart.setMarket({ symbol: 'CCC' });
        expect(types()).toEqual(['hline']);
    });

    it('a restored state keeps the drawings it carries, though it names another symbol', () => {
        const { ws: first } = drawn(SCOPED);
        const saved = JSON.parse(JSON.stringify(first.getState())) as never;
        const second = mountWorkspace({ ...SCOPED, symbol: 'BBB' });
        const chart = second.cell('c1')!.chart;
        chart.drawings.add('box', { anchors: ANCHORS });
        expect(chart.drawings.all().map((d) => d.type)).toEqual(['box']);
        second.applyState(saved);
        // The document's two drawings, on the document's symbol; the chart's own went with its symbol.
        expect(chart.market.symbol).toBe('AAA');
        expect(chart.drawings.all().map((d) => d.type)).toEqual(['trendline', 'hline']);
    });
});

describe('chart.drawings.clear()', () => {
    it('removes every drawing, locked ones included, as one undo step', () => {
        const { chart, removed, types } = drawn();
        const [first] = chart.drawings.all();
        chart.drawings.lock(first!.id);
        chart.drawings.clear();
        expect(types()).toEqual([]);
        expect(removed).toHaveLength(2);
        chart.drawings.undo();
        expect(types()).toEqual(['trendline', 'hline']);
    });

    it('on an empty chart changes nothing and leaves nothing to undo', () => {
        const ws = mountWorkspace({});
        const chart = ws.cell('c1')!.chart;
        chart.drawings.clear();
        expect(chart.drawings.all()).toEqual([]);
        expect(chart.drawings.canUndo()).toBe(false);
    });
});

describe('the drawing:history event', () => {
    it('tells a host that an undo or a redo changed the drawings, which no other drawing event does', () => {
        const { chart, removed, types } = drawn();
        const seen: string[] = [];
        chart.on('drawing:history', (e) => seen.push(e.action));
        chart.on('drawing:created', () => seen.push('created'));
        chart.drawings.undo();
        expect(types()).toEqual(['trendline']);
        chart.drawings.redo();
        expect(types()).toEqual(['trendline', 'hline']);
        expect(seen).toEqual(['undo', 'redo']);
        expect(removed).toEqual([]);
        // Nothing left to redo: no step, no event.
        chart.drawings.redo();
        expect(seen).toEqual(['undo', 'redo']);
    });

    it('does not fire for a document put in place, nor for the removal on a symbol change', () => {
        const { chart } = drawn(SCOPED);
        const seen: string[] = [];
        chart.on('drawing:history', (e) => seen.push(e.action));
        chart.drawings.fromJSON(chart.drawings.toJSON());
        void chart.setMarket({ symbol: 'BBB' });
        expect(seen).toEqual([]);
    });
});
