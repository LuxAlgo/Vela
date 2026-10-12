// @vitest-environment jsdom
// A price-style switch is announced BEFORE it happens: the native renderer's one runtime
// write path calls `onPriceStyleWillChange(from, to)` while its scene still holds `from`, the
// chart emits it as `priceStyle:change`, and the workspace relays it as `cell:priceStyle` for
// the one cell that switched.
import { describe, it, expect, beforeAll } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

describe('NativeRenderer onPriceStyleWillChange', () => {
    it('announces each runtime write before the scene switches, and never a no-op write', () => {
        const r = new NativeRenderer();
        const log: string[] = [];
        r.onPriceStyleWillChange((from, to) => log.push(`will ${from}>${to} showing ${String(r.readFeature('priceStyle'))}`));
        r.onPriceStyleChange((style) => log.push(`changed ${style}`));

        r.applyFeature('priceStyle', 'candles');
        expect(log).toEqual([]);

        r.applyFeature('priceStyle', 'area'); // the style menu, ctx.setPriceStyle, renderer.set
        r.applyConfig({ series: { style: 'bars' } }); // the settings dialog, a template, a restore
        expect(log).toEqual(['will candles>area showing candles', 'changed area', 'will area>bars showing area', 'changed bars']);
    });
});

describe('workspace event cell:priceStyle', () => {
    it('relays one event, from the switched cell only, while that cell still shows the old style', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: '4' } as never);
        const [a, b] = ws.cells().map((c) => c.id) as [string, string];
        const seen: Array<{ id: string; from: string; to: string; showing: string }> = [];
        ws.on('cell:priceStyle', (e) => seen.push({ ...e, showing: ws.cell(e.id)!.priceStyle }));

        ws.cell(b)!.setPriceStyle('line');
        ws.cell(a)!.chart.renderer.set('priceStyle', 'area');
        ws.cell(b)!.setPriceStyle('line');

        expect(seen).toEqual([
            { id: b, from: 'candles', to: 'line', showing: 'candles' },
            { id: a, from: 'candles', to: 'area', showing: 'candles' },
        ]);
        ws.destroy();
    });
});
