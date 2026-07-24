import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, type Projector } from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

describe('drawings/Arrow', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('arrow', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }] })!;

    it('is a 2-anchor line with a default end-head', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(2);
        expect(d.style.arrowRight).toBe(true); // head on by default
        expect(d.hitTest(25, 75, proj, 4)).toBe(true); // on the line (0,100)→(50,50)
        expect(d.hitTest(25, 90, proj, 4)).toBe(false);
        expect(d.priceRange()).toEqual({ min: 0, max: 50 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('arrow');
    });
});

describe('drawings/Ellipse', () => {
    const proj = fakeProjector();
    // box corners (0,0)→(40,40) ⇒ center (20,80), radii (20,20) in px
    const make = () => createDrawing('ellipse', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 40, price: 40 }] })!;

    it('hit-tests its outline and filled interior, not the gap', () => {
        const d = make();
        expect(d.style.fillColor).toBeTruthy();
        expect(d.hitTest(20, 60, proj, 4)).toBe(true); // top of the outline (cy−ry)
        expect(d.hitTest(20, 80, proj, 4)).toBe(true); // dead centre (inside the fill)
        expect(d.hitTest(20, 30, proj, 4)).toBe(false); // outside the ellipse
    });

    it('reports a 2/2 schema + price range', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(2);
        expect(d.priceRange()).toEqual({ min: 0, max: 40 });
    });
});

describe('drawings/Polyline + Freehand', () => {
    const proj = fakeProjector();

    it('polyline: variable anchors, per-segment hit-test, a handle per vertex', () => {
        const d = createDrawing('polyline', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }, { time: 100, price: 0 }] })!;
        const s = d.anchorSchema();
        expect(s.min).toBe(2);
        expect(s.max).toBeGreaterThan(2);
        expect(d.placementMode()).toBe('click');
        expect(d.hitTest(25, 75, proj, 4)).toBe(true); // segment 1 (0,100)→(50,50)
        expect(d.hitTest(75, 75, proj, 4)).toBe(true); // segment 2 (50,50)→(100,100)
        expect(d.hitTest(50, 10, proj, 4)).toBe(false);
        expect(d.handlePoints(proj).length).toBe(3); // every vertex is editable
        expect(d.priceRange()).toEqual({ min: 0, max: 50 });
    });

    it('freehand: capture mode, no per-vertex handles, bounds from the path', () => {
        const d = createDrawing('freehand', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }, { time: 100, price: 0 }] })!;
        expect(d.placementMode()).toBe('freehand');
        expect(d.handlePoints(proj)).toEqual([]); // moved as a whole, not per-point
        expect(d.hitTest(25, 75, proj, 4)).toBe(true);
        expect(d.bounds(proj)).toEqual({ x: 0, y: 50, w: 100, h: 50 }); // path pixel extent
    });

    it('highlighter: freehand capture like the brush, but a wide + translucent default style', () => {
        const d = createDrawing('highlighter', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }, { time: 100, price: 0 }] })!;
        expect(d.type).toBe('highlighter');
        expect(d.placementMode()).toBe('freehand'); // captured like the brush
        expect(d.handlePoints(proj)).toEqual([]);
        expect(d.hitTest(25, 75, proj, 4)).toBe(true);
        // default marker cosmetics: wide stroke + a see-through (alpha < 1) color, unlike the opaque brush
        expect(d.style.lineWidth).toBeGreaterThan(4);
        expect(/^#[0-9a-f]{6}[0-9a-f]{2}$/i.test(d.style.lineColor)).toBe(true);
        // settings expose color + width only (no dash/text — a marker is always a solid swath)
        const paths = d.schema().fields.map((f) => f.path);
        expect(paths).toEqual(['style.lineColor', 'style.lineWidth']);
    });

    it('highlighter: round-trips through serialize', () => {
        const a = createDrawing('highlighter', { paneId: 'price', anchors: [{ time: 0, price: 10 }, { time: 40, price: 30 }] })!.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
    });
});

describe('drawings/Triangle', () => {
    const proj = fakeProjector();
    // vertices (0,100), (40,100), (20,60) in px — base along y=100, apex up at (20,60)
    const make = () => createDrawing('triangle', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 40, price: 0 }, { time: 20, price: 40 }] })!;

    it('hit-tests edges + filled interior; has a 3/3 schema', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(3);
        expect(d.hitTest(20, 100, proj, 4)).toBe(true); // on the base edge
        expect(d.hitTest(20, 87, proj, 4)).toBe(true); // inside (filled)
        expect(d.hitTest(20, 30, proj, 4)).toBe(false); // above the apex → outside
        expect(d.priceRange()).toEqual({ min: 0, max: 40 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('triangle');
    });
});
