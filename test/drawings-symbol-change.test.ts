// @vitest-environment jsdom
// Drawings that belong to the chart's SYMBOL (`clearOnSymbolChange`): a switch to another
// symbol removes them as it starts, a restored state keeps the drawings it carries, and
// `clear()` is the user-level "remove everything".
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

describe('the drawing:replaced event', () => {
    it('says why the drawings changed as a whole: a document loaded, or the symbol changed', () => {
        const { chart } = drawn(SCOPED);
        const seen: string[] = [];
        chart.on('drawing:replaced', (e) => seen.push(e.cause));
        chart.drawings.fromJSON(chart.drawings.toJSON());
        expect(seen).toEqual(['load']);
        void chart.setMarket({ symbol: 'BBB' });
        expect(seen).toEqual(['load', 'symbol']);
        // A chart with nothing to drop drops nothing.
        void chart.setMarket({ symbol: 'CCC' });
        expect(seen).toEqual(['load', 'symbol']);
        chart.drawings.fromJSON(null);
        expect(seen).toEqual(['load', 'symbol', 'load']);
    });

    it('stays silent when the user removes drawings, and when a chart keeps its drawings across symbols', () => {
        const { chart, removed } = drawn();
        const seen: string[] = [];
        chart.on('drawing:replaced', (e) => seen.push(e.cause));
        void chart.setMarket({ symbol: 'BBB' });
        chart.drawings.clear();
        expect(removed).toHaveLength(2);
        expect(seen).toEqual([]);
    });

    it('a restored state announces the drawings it puts in place', () => {
        const { ws: first } = drawn(SCOPED);
        const saved = JSON.parse(JSON.stringify(first.getState())) as never;
        const second = mountWorkspace({ ...SCOPED, symbol: 'BBB' });
        const chart = second.cell('c1')!.chart;
        chart.drawings.add('box', { anchors: ANCHORS });
        const seen: string[] = [];
        chart.on('drawing:replaced', (e) => seen.push(`${e.cause}:${chart.drawings.all().length}`));
        second.applyState(saved);
        // The chart's own drawing goes with its symbol, then the state's two arrive.
        expect(seen).toEqual(['symbol:0', 'load:2']);
    });

    it('takes the dead drawing steps out of the shell’s undo, so Undo is not left lit over nothing', () => {
        const { ws, chart } = drawn(SCOPED);
        const history = (ws.cell('c1') as unknown as { history: { canUndo: boolean } }).history;
        expect(history.canUndo).toBe(true);
        void chart.setMarket({ symbol: 'BBB' });
        expect(history.canUndo).toBe(false);
    });
});

describe('the workspace reports the drawing changes that raise no created, edited or removed event', () => {
    /** Whether `act` makes the workspace announce a state change (flushed by the destroy that follows). */
    function announces(act: (chart: ReturnType<typeof drawn>['chart']) => void): boolean {
        vi.useFakeTimers();
        try {
            const { ws, chart } = drawn();
            vi.advanceTimersByTime(1000); // the drawing of the setup is announced and done with
            let told = 0;
            ws.on('state:changed', () => void told++);
            act(chart);
            vi.advanceTimersByTime(1000);
            return told > 0;
        } finally {
            vi.useRealTimers();
        }
    }

    it('an undo and a redo', () => {
        expect(announces((chart) => chart.drawings.undo())).toBe(true);
        expect(
            announces((chart) => {
                chart.drawings.undo();
                vi.advanceTimersByTime(1000);
                chart.drawings.redo();
            }),
        ).toBe(true);
    });

    it('a document put in place', () => {
        expect(announces((chart) => chart.drawings.fromJSON(null))).toBe(true);
    });

    it('and stays quiet when nothing changed', () => {
        expect(announces(() => {})).toBe(false);
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
