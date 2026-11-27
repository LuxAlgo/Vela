// A horizontal line's or ray's label goes where the trader puts it: at the left end, the middle
// or the right end of the line, above or below it.
import { describe, it, expect } from 'vitest';
import { DrawingPainter, keepLabelInside } from '../src/renderers/native/drawings/DrawingPainter';
import { createDrawing, type DrawingText, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 200 − price, one 400px-wide pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 200 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 200 - y }),
        paneIdAtY: () => 'price',
        paneRect: (paneId) => (paneId === 'price' ? { top: 0, height: 200 } : null),
        width: 400,
        height: 200,
    };
}

type Drawn = { x: number; y: number; align: CanvasTextAlign };

/** Paint one drawing and return where (and how aligned) its label was drawn. */
function paintLabel(type: 'hline' | 'hray', anchorTime: number, text: Partial<DrawingText>, price = 100): Drawn {
    const label = drawnLabel(type, anchorTime, text, price);
    expect(label).toBeDefined();
    return label!;
}

/** Paint one drawing; its label as drawn, or undefined when none was. */
function drawnLabel(type: 'hline' | 'hray', anchorTime: number, text: Partial<DrawingText>, price = 100): Drawn | undefined {
    const d = createDrawing(type, { paneId: 'price', anchors: [{ time: anchorTime, price }] })!;
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
        clip: noop,
        setLineDash: noop,
        strokeText: noop,
        fillText(s: string, x: number, y: number) {
            drawn.push({ s, x, y, align: this.textAlign });
        },
        measureText: (s: string) => ({ width: s.length * 6 }),
    };
    const theme = { textColor: '#fff', background: '#000', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    new DrawingPainter().paintAll(ctx as unknown as CanvasRenderingContext2D, [d], fakeProjector(), theme);
    return drawn.find((t) => t.s === 'Weekly support');
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

    // "Weekly support" is 84px wide at the test's 6px a glyph.
    it('beside its handle, stays whole on the chart when the handle nears an edge or scrolls off', () => {
        expect(paintLabel('hline', -500, {})).toMatchObject({ x: 8, align: 'left' });
        expect(paintLabel('hline', 380, {})).toMatchObject({ x: 308, align: 'left' });
        expect(paintLabel('hline', 900, {})).toMatchObject({ x: 308, align: 'left' });
    });

    it('sits above the line, or below it when asked', () => {
        expect(paintLabel('hline', 250, {}).y).toBeLessThan(LINE_Y);
        expect(paintLabel('hline', 250, { side: 'below' }).y).toBeGreaterThan(LINE_Y);
    });
});

describe('a label at the top or bottom of its pane', () => {
    it('moves to the side of the line that has room rather than being cut off', () => {
        for (const type of ['hline', 'hray'] as const) {
            // Price 195 → 5px from the pane's top: no room above.
            expect(paintLabel(type, 100, {}, 195).y, type).toBeGreaterThan(5);
            // Price 5 → 5px from the pane's bottom: no room below.
            expect(paintLabel(type, 100, { side: 'below' }, 5).y, type).toBeLessThan(195);
        }
    });
});

describe('a label too wide for the chart', () => {
    it('starts at the left edge', () => {
        expect(keepLabelInside(200, 'center', 500, 400)).toBe(258);
        expect(keepLabelInside(392, 'right', 500, 400)).toBe(508);
        expect(keepLabelInside(108, 'left', 500, 400)).toBe(8);
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

    it('stays whole on the chart when the anchor is near the right edge', () => {
        expect(paintLabel('hray', 380, {})).toMatchObject({ x: 308, align: 'left' });
        expect(paintLabel('hray', 380, { place: 'middle' })).toMatchObject({ x: 350, align: 'center' });
        expect(paintLabel('hray', 380, { place: 'end' })).toMatchObject({ x: 392, align: 'right' });
    });

    it('shows nowhere while the anchor is still off to the right', () => {
        for (const place of ['start', 'middle', 'end'] as const) {
            expect(drawnLabel('hray', 400, { place }), place).toBeUndefined();
            expect(drawnLabel('hray', 450, { place }), place).toBeUndefined();
        }
    });

    it('sits above the ray, or below it when asked', () => {
        expect(paintLabel('hray', 100, {}).y).toBeLessThan(LINE_Y);
        expect(paintLabel('hray', 100, { side: 'below' }).y).toBeGreaterThan(LINE_Y);
    });
});
