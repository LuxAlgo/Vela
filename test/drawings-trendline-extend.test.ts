// A trend line can run on past either of its points to the edge of the chart; the extended part
// is part of the line — it paints and it can be clicked.
import { describe, it, expect } from 'vitest';
import { createDrawing, type Projector, type TrendLine } from '../src/core/drawings';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import type { VelaTheme } from '../src/core/options';

/** x = time, y = 100 − price, 200 × 100 px. */
const proj: Projector = {
    xOf: (t) => t,
    yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
    pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
    paneIdAtY: () => 'price',
    width: 200,
    height: 100,
};

function line(extend: { extendLeft?: boolean; extendRight?: boolean } = {}): TrendLine {
    return createDrawing('trendline', {
        id: 't',
        paneId: 'price',
        anchors: [
            { time: 50, price: 50 },
            { time: 100, price: 50 },
        ],
        style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid', ...extend },
    }) as TrendLine;
}

/** The x-span the painter strokes for the line. */
function paintedSpan(d: TrendLine): [number, number] {
    const xs: number[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
        get: (target, key) => {
            if (key === 'moveTo' || key === 'lineTo') return (x: number) => xs.push(x);
            if (key === 'measureText') return () => ({ width: 0 });
            return key in target ? target[key as string] : () => {};
        },
        set: (target, key, value) => {
            target[key as string] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    new DrawingPainter().paintAll(ctx, [d], proj, { textColor: '#fff', background: '#000', fontFamily: 'sans-serif' } as unknown as VelaTheme);
    return [Math.min(...xs), Math.max(...xs)];
}

describe('extending a trend line', () => {
    it('a plain trend line stops at its points', () => {
        const d = line();
        expect(d.hitTest(150, 50, proj, 3)).toBe(false);
        expect(d.hitTest(20, 50, proj, 3)).toBe(false);
        expect(paintedSpan(d)).toEqual([50, 100]);
    });

    it('extended right, it runs on to the right edge and can be clicked there', () => {
        const d = line({ extendRight: true });
        expect(d.hitTest(180, 50, proj, 3)).toBe(true);
        expect(d.hitTest(20, 50, proj, 3)).toBe(false);
        const [from, to] = paintedSpan(d);
        expect(from).toBe(50);
        expect(to).toBeGreaterThanOrEqual(200);
    });

    it('extended both ways, it crosses the whole chart', () => {
        const d = line({ extendLeft: true, extendRight: true });
        expect(d.hitTest(5, 50, proj, 3)).toBe(true);
        expect(d.hitTest(195, 50, proj, 3)).toBe(true);
        const [from, to] = paintedSpan(d);
        expect(from).toBeLessThanOrEqual(0);
        expect(to).toBeGreaterThanOrEqual(200);
    });
});
