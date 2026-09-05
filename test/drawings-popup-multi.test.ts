import { describe, it, expect } from 'vitest';
import { createDrawing } from '../src/core/drawings';
import { sharedPaths, commonValue, MIXED } from '../src/renderers/native/drawings/DrawingSettingsPopup';

const trend = (id: string, lineColor: string) => createDrawing('trendline', { id, paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 10, price: 10 }], style: { lineColor } })!;
const box = (id: string) => createDrawing('box', { id, paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 10, price: 10 }] })!;
const text = (id: string) => createDrawing('text', { id, paneId: 'price', anchors: [{ time: 0, price: 0 }] })!;

describe('multi-selection settings: shared paths', () => {
    it('same-type drawings share their whole schema', () => {
        const one = new Set(trend('a', '#f00').schema().fields.map((f) => f.path));
        expect(sharedPaths([trend('a', '#f00'), trend('b', '#0f0'), trend('c', '#00f')])).toEqual(one);
    });

    it('mixed types keep only the intersection — type-specific paths drop out', () => {
        const stroked = sharedPaths([trend('a', '#f00'), box('b')]);
        expect(stroked.has('style.lineColor')).toBe(true); // both stroke
        expect(stroked.has('style.fillColor')).toBe(false); // the box's alone
        const paths = sharedPaths([trend('a', '#f00'), box('b'), text('c')]);
        expect(paths.has('style.lineColor')).toBe(false); // a text annotation has no stroke
        for (const p of paths) {
            expect(trend('a', '#f00').schema().fields.some((f) => f.path === p)).toBe(true);
            expect(box('b').schema().fields.some((f) => f.path === p)).toBe(true);
            expect(text('c').schema().fields.some((f) => f.path === p)).toBe(true);
        }
    });

    it('a single drawing shares everything with itself; an empty list shares nothing', () => {
        const b = box('b');
        expect(sharedPaths([b]).size).toBe(b.schema().fields.length);
        expect(sharedPaths([]).size).toBe(0);
    });
});

describe('multi-selection settings: common value', () => {
    it('agreeing drawings yield the value; disagreeing ones yield MIXED', () => {
        const same = [trend('a', '#ff0000'), trend('b', '#ff0000')];
        expect(commonValue(same, (d) => d.style.lineColor)).toBe('#ff0000');
        const differ = [trend('a', '#ff0000'), trend('b', '#0000ff')];
        expect(commonValue(differ, (d) => d.style.lineColor)).toBe(MIXED);
    });

    it('works for booleans (a lock state) without confusing false with mixed', () => {
        const a = trend('a', '#f00');
        const b = trend('b', '#f00');
        expect(commonValue([a, b], (d) => d.locked)).toBe(false);
        b.locked = true;
        expect(commonValue([a, b], (d) => d.locked)).toBe(MIXED);
        a.locked = true;
        expect(commonValue([a, b], (d) => d.locked)).toBe(true);
    });
});
