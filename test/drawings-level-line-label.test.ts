// A horizontal line's or ray's label goes where the trader puts it: at the left end, the middle
// or the right end of the line, above or below it.
import { describe, it, expect } from 'vitest';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { createDrawing, type DrawingText, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 200 − price, one 400px-wide pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 200 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 200 - y }),
        paneIdAtY: () => 'price',
        width: 400,
        height: 200,
    };
}

/** Paint one drawing and return where (and how aligned) its label was drawn. */
function paintLabel(type: 'hline' | 'hray', anchorTime: number, text: Partial<DrawingText>): { x: number; y: number; align: CanvasTextAlign } {
    const d = createDrawing(type, { paneId: 'price', anchors: [{ time: anchorTime, price: 100 }] })!;
    d.text = { value: 'Weekly support', size: 'normal', hAlign: 'left', vAlign: 'top', ...text };
    const drawn: Array<{ s: string; x: number; y: number; align: CanvasTextAlign }> = [];
    const noop = () => {};
    const ctx = {
        globalAlpha: 1,
        textAlign: 'left' as CanvasTextAlign,
        save: noop,
        restore: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        fill: noop,
        arc: noop,
        rect: noop,
        setLineDash: noop,
        strokeText: noop,
        fillText(s: string, x: number, y: number) {
            drawn.push({ s, x, y, align: this.textAlign });
        },
        measureText: (s: string) => ({ width: s.length * 6 }),
    };
    const theme = { textColor: '#fff', background: '#000', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    new DrawingPainter().paintAll(ctx as unknown as CanvasRenderingContext2D, [d], fakeProjector(), theme);
    const label = drawn.find((t) => t.s === 'Weekly support');
    expect(label).toBeDefined();
    return label!;
}

const LINE_Y = 100;

describe("a horizontal line's label", () => {
    it('sits at the left edge, the middle or the right edge of the chart', () => {
        expect(paintLabel('hline', 250, { place: 'start' })).toMatchObject({ x: 8, align: 'left' });
        expect(paintLabel('hline', 250, { place: 'middle' })).toMatchObject({ x: 200, align: 'center' });
        expect(paintLabel('hline', 250, { place: 'end' })).toMatchObject({ x: 392, align: 'right' });
    });

    it('stays beside its handle until a position is picked', () => {
        expect(paintLabel('hline', 250, {})).toMatchObject({ x: 258, align: 'left' });
    });

    it('sits above the line, or below it when asked', () => {
        expect(paintLabel('hline', 250, {}).y).toBeLessThan(LINE_Y);
        expect(paintLabel('hline', 250, { side: 'below' }).y).toBeGreaterThan(LINE_Y);
    });
});

describe("a horizontal ray's label", () => {
    it('starts at the anchor, or sits in the middle or at the right end of the ray', () => {
        expect(paintLabel('hray', 100, {})).toMatchObject({ x: 108, align: 'left' });
        expect(paintLabel('hray', 100, { place: 'middle' })).toMatchObject({ x: 250, align: 'center' });
        expect(paintLabel('hray', 100, { place: 'end' })).toMatchObject({ x: 392, align: 'right' });
    });

    it('stays on screen when the anchor has scrolled off to the left', () => {
        expect(paintLabel('hray', -300, { place: 'start' })).toMatchObject({ x: 8, align: 'left' });
        expect(paintLabel('hray', -300, { place: 'middle' })).toMatchObject({ x: 200, align: 'center' });
    });

    it('sits above the ray, or below it when asked', () => {
        expect(paintLabel('hray', 100, {}).y).toBeLessThan(LINE_Y);
        expect(paintLabel('hray', 100, { side: 'below' }).y).toBeGreaterThan(LINE_Y);
    });
});
