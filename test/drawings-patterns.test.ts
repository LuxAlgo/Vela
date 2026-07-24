import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, lineSegmentIntersection, type Projector, type PatternDrawing } from '../src/core/drawings';

const HR = 3600000;

/** Linear projector: x = time/hour, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

const at = (h: number, price: number): { time: number; price: number } => ({ time: h * HR, price });

describe('drawings/patterns', () => {
    const proj = fakeProjector();

    it('XABCD has 5 vertices, labels X–D, fills two triangles, shows leg ratios', () => {
        const d = createDrawing('xabcd', { paneId: 'price', anchors: [at(0, 50), at(1, 70), at(2, 60), at(3, 80), at(4, 55)] })! as PatternDrawing;
        expect(d.anchorSchema().min).toBe(5);
        expect(d.vertexLabels()).toEqual(['X', 'A', 'B', 'C', 'D']);
        expect(d.legRatios()).toBe(true);
        expect(d.fillTriangles()).toEqual([[0, 1, 2], [2, 3, 4]]);
        // AB/XA = |60−70| / |70−50| = 10/20 = 0.5
        expect(d.ratioAt(2)).toBeCloseTo(0.5, 6);
        // BC/AB = |80−60| / |60−70| = 20/10 = 2
        expect(d.ratioAt(3)).toBeCloseTo(2, 6);
    });

    it('ABCD has 4 vertices + ratios; hit-tests on its polyline', () => {
        const d = createDrawing('abcd', { paneId: 'price', anchors: [at(0, 40), at(2, 60), at(4, 50), at(6, 70)] })! as PatternDrawing;
        expect(d.anchorSchema().min).toBe(4);
        expect(d.vertexLabels()).toEqual(['A', 'B', 'C', 'D']);
        // on the A→B leg midpoint: (1h, 50) → px (1, 50)
        expect(d.hitTest(1, 50, proj, 4)).toBe(true);
        expect(d.hitTest(1, 90, proj, 4)).toBe(false);
        expect(d.priceRange()).toEqual({ min: 40, max: 70 });
    });

    it('Elliott impulse / correction label 1–5 and A–C with no ratios', () => {
        const imp = createDrawing('elliottimpulse', { paneId: 'price', anchors: [at(0, 10), at(1, 20), at(2, 15), at(3, 30), at(4, 25)] })! as PatternDrawing;
        expect(imp.vertexLabels()).toEqual(['1', '2', '3', '4', '5']);
        expect(imp.legRatios()).toBe(false);
        const corr = createDrawing('elliottcorrection', { paneId: 'price', anchors: [at(0, 30), at(1, 20), at(2, 26)] })! as PatternDrawing;
        expect(corr.anchorSchema().min).toBe(3);
        expect(corr.vertexLabels()).toEqual(['A', 'B', 'C']);
    });

    it('Head & shoulders has 7 vertices, peaks labelled, neckline through the troughs', () => {
        const d = createDrawing('headshoulders', { paneId: 'price', anchors: [at(0, 40), at(1, 60), at(2, 50), at(3, 70), at(4, 50), at(5, 60), at(6, 40)] })! as PatternDrawing;
        expect(d.anchorSchema().min).toBe(7);
        expect(d.vertexLabels()).toEqual(['', 'LS', '', 'H', '', 'RS', '']);
        expect(d.necklineIndices()).toEqual([2, 4]);
    });

    it('neckline clips to a leg crossing (lineSegmentIntersection), else null', () => {
        // horizontal neckline y=450 through (460,450)-(660,450); left leg (300,500)→(380,350) crosses at x≈326.67
        const left = lineSegmentIntersection(460, 450, 660, 450, 300, 500, 380, 350)!;
        expect(left[0]).toBeCloseTo(326.667, 2);
        expect(left[1]).toBeCloseTo(450, 6);
        // a leg that never reaches the neckline → null (the painter falls back to the trough)
        expect(lineSegmentIntersection(460, 450, 660, 450, 300, 300, 380, 320)).toBeNull();
        // parallel lines → null
        expect(lineSegmentIntersection(0, 0, 10, 0, 0, 5, 10, 5)).toBeNull();
    });

    it('round-trips through serialize', () => {
        const a = createDrawing('xabcd', { paneId: 'price', anchors: [at(0, 50), at(1, 70), at(2, 60), at(3, 80), at(4, 55)] })!.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('xabcd');
    });
});
