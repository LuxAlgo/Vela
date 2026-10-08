// The trend angle's degree readout never sits on its own line: it takes the side of the
// 0° baseline that the line leaves empty, whichever way the line runs.
import { describe, it, expect } from 'vitest';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { createDrawing, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 200 − price, single pane 'price'. */
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

/** A ctx recording where each string is drawn, with 6px-per-glyph text metrics. */
function textCtx() {
    const texts: Array<{ s: string; x: number; y: number }> = [];
    const noop = () => {};
    const ctx = {
        globalAlpha: 1,
        save: noop,
        restore: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        arc: noop,
        setLineDash: noop,
        strokeText: noop,
        fillText: (s: string, x: number, y: number) => texts.push({ s, x, y }),
        measureText: (s: string) => ({ width: s.length * 6 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

/** Does the segment (x1,y1)–(x2,y2) cross the rectangle? (Sampled — the rects are small.) */
function crosses(seg: [number, number, number, number], r: { x: number; y: number; w: number; h: number }): boolean {
    for (let i = 0; i <= 400; i += 1) {
        const t = i / 400;
        const x = seg[0] + (seg[2] - seg[0]) * t;
        const y = seg[1] + (seg[3] - seg[1]) * t;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
}

const theme = { textColor: '#fff', background: '#000', fontFamily: 'sans-serif' } as unknown as VelaTheme;

describe('the trend angle readout stays clear of its line', () => {
    const cases: Array<[string, { time: number; price: number }]> = [
        ['rising to the right', { time: 300, price: 160 }],
        ['falling to the right', { time: 300, price: 40 }],
        ['rising to the left', { time: 20, price: 160 }],
        ['falling to the left', { time: 20, price: 40 }],
        ['nearly flat', { time: 300, price: 108 }],
    ];
    for (const [name, end] of cases) {
        it(`a line ${name}`, () => {
            const start = { time: 120, price: 100 };
            const d = createDrawing('trendangle', { paneId: 'price', anchors: [start, end] })!;
            const { ctx, texts } = textCtx();
            new DrawingPainter().paintAll(ctx, [d], fakeProjector(), theme);
            const label = texts.find((t) => t.s.endsWith('°'))!;
            expect(label).toBeDefined();
            // Alphabetic baseline at an 11px font: the glyphs span ~9px above it, ~3px below.
            const box = { x: label.x, y: label.y - 9, w: label.s.length * 6, h: 12 };
            const seg: [number, number, number, number] = [start.time, 200 - start.price, end.time, 200 - end.price];
            expect(crosses(seg, box)).toBe(false);
        });
    }
});
