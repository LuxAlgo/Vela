// @vitest-environment jsdom
// The drawing tools' shared preferences in a workspace: a tool's remembered settings follow
// across charts, ride `getState()`, and come back on `applyState()` — together with the
// magnet and stay-in-drawing-mode — so a reload keeps them.
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

describe('drawing tool preferences in a workspace', () => {
    it('styling a trend line on one chart makes the next one on another chart look the same', () => {
        const ws = mountWorkspace({ layout: '2h' });
        const c1 = ws.cell('c1')!.chart.drawings;
        const d = c1.add('trendline', { anchors: ANCHORS })!;
        c1.update(d.id, { style: { lineColor: '#ff8800', lineWidth: 3, lineStyle: 'solid' } });

        const next = ws.cell('c2')!.chart.drawings.add('trendline', { anchors: ANCHORS })!;
        expect(next.style.lineColor).toBe('#ff8800');
        expect(next.style.lineWidth).toBe(3);
    });

    it('the remembered settings survive a save and a restore into a fresh workspace', () => {
        const first = mountWorkspace({ layout: '1' });
        const c1 = first.cell('c1')!.chart.drawings;
        const fib = c1.add('fibretracement', { anchors: ANCHORS })!;
        const levels = [
            { ratio: 0, color: '#111111', enabled: true },
            { ratio: 0.705, color: '#222222', enabled: true },
            { ratio: 1, color: '#333333', enabled: true },
        ];
        c1.update(fib.id, { props: { levels } });
        const saved = JSON.parse(JSON.stringify(first.getState()));
        expect(saved.drawingTools?.defaults?.fibretracement).toBeDefined();

        const second = mountWorkspace({ layout: '1' });
        second.applyState(saved);
        const next = second.cell('c1')!.chart.drawings.add('fibretracement', { anchors: ANCHORS })!;
        expect(next.serialize().props?.levels).toEqual(levels);
    });

    it('a workspace persisted to storage boots with the remembered settings already in place', () => {
        const store = new Map<string, string>();
        const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) };
        const first = mountWorkspace({ layout: '1', persist: 'prefs-test', storage });
        const c1 = first.cell('c1')!.chart.drawings;
        c1.add('hline', { anchors: [ANCHORS[0]!], style: { lineColor: '#00aa55' } });
        first.destroy(); // flushes the pending save

        const second = mountWorkspace({ layout: '1', persist: 'prefs-test', storage });
        expect(second.cell('c1')!.chart.drawings.add('hline', { anchors: [ANCHORS[1]!] })!.style.lineColor).toBe('#00aa55');
    });

    it('the magnet and stay-in-drawing-mode come back after a restore', () => {
        const first = mountWorkspace({ layout: '1' });
        const c1 = first.cell('c1')!.chart.drawings;
        c1.setSnapMode('strong');
        c1.setStayMode(true);
        const saved = JSON.parse(JSON.stringify(first.getState()));
        expect(saved.drawingTools).toMatchObject({ magnet: 'strong', stay: true });

        const second = mountWorkspace({ layout: '1' });
        second.applyState(saved);
        const c = second.cell('c1')!.chart.drawings;
        expect(c.getSnapMode()).toBe('strong');
        expect(c.getStayMode()).toBe(true);
    });

    it('untouched preferences add nothing to the saved document', () => {
        const ws = mountWorkspace({ layout: '1' });
        expect(ws.getState().drawingTools).toBeUndefined();
    });
});
