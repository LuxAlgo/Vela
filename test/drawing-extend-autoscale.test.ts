import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET, type DrawingSet } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingLine } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

/**
 * Lines and autoscale: a line folds its ANCHOR prices (y1/y2) while some painted
 * part of it — anchor segment plus its `extend` projection — crosses the visible
 * bar window. The extension widens WHERE the line is, but its projected y-values
 * never define the scale, and a vertical line (x1 == x2) extends along itself,
 * so one anchored off-screen paints nothing in the window and contributes
 * nothing — its far-away anchor prices must not squeeze the pane.
 */

const theme = { textColor: '#fff' } as VelaTheme;

function line(over: Partial<DrawingLine>): DrawingLine {
    return {
        id: 'ln',
        paneId: 'price',
        xloc: 'bar_index',
        extend: 'none',
        x1: 100,
        y1: 5,
        x2: 110,
        y2: 6,
        color: '#0f0',
        width: 1,
        style: 'solid',
        invisible: false,
        arrowLeft: false,
        arrowRight: false,
        ...over,
    };
}

function rangeOf(ln: DrawingLine, from: number, to: number) {
    const set: DrawingSet = { ...EMPTY_DRAWING_SET, lines: [ln] };
    const r = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme });
    r.setSet(set);
    return r.priceRange(from, to);
}

describe('extended lines and autoscale (priceRange)', () => {
    it('folds y1/y2 while the anchor segment is in view — extended or not', () => {
        for (const extend of ['none', 'left', 'right', 'both'] as const) {
            const r = rangeOf(line({ extend }), 90, 120);
            expect(r).not.toBeNull();
            expect(r!.min).toBe(5);
            expect(r!.max).toBe(6);
        }
    });

    it('extend.both keeps folding y1/y2 with OFF-SCREEN anchors — the projection crosses every window', () => {
        for (const window of [[500, 600], [0, 50]] as const) {
            const r = rangeOf(line({ extend: 'both' }), window[0], window[1]);
            expect(r).not.toBeNull();
            expect(r!.min).toBe(5);
            expect(r!.max).toBe(6);
        }
    });

    it('extend.left / extend.right fold only on the side the projection covers', () => {
        // Segment at bars 100..110; extend.right covers [100, ∞).
        expect(rangeOf(line({ extend: 'right' }), 500, 600)).not.toBeNull();
        expect(rangeOf(line({ extend: 'right' }), 0, 50)).toBeNull();
        // extend.left covers (-∞, 110].
        expect(rangeOf(line({ extend: 'left' }), 0, 50)).not.toBeNull();
        expect(rangeOf(line({ extend: 'left' }), 500, 600)).toBeNull();
    });

    it('unextended off-screen lines stay excluded (regression baseline)', () => {
        expect(rangeOf(line({}), 500, 600)).toBeNull();
        expect(rangeOf(line({}), 0, 50)).toBeNull();
    });

    it('a vertical/point line (x1 == x2) + extend — the vertical-line idiom — folds only while its bar is in view', () => {
        for (const extend of ['left', 'right', 'both'] as const) {
            const point = line({ x1: 100, x2: 100, y1: 7, y2: 7, extend });
            // Anchor bar visible: only the anchor price folds (the full-height
            // vertical extension is paint-time and contributes nothing).
            const r = rangeOf(point, 90, 120);
            expect(r).not.toBeNull();
            expect(r!.min).toBe(7);
            expect(r!.max).toBe(7);
            // Anchor bar off-screen: the vertical extension adds no horizontal
            // coverage — nothing paints in the window, nothing folds.
            expect(rangeOf(point, 500, 600)).toBeNull();
            expect(rangeOf(point, 0, 50)).toBeNull();
        }
    });
});
