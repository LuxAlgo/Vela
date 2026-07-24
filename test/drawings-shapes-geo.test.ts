import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, type Projector } from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price', 200×100 plot. */
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

describe('drawings/Circle', () => {
    const proj = fakeProjector();
    // center price 50 (y 50) at time 50; edge price 80 (y 20) at time 50 → pixel radius 30
    const make = () => createDrawing('circle', { paneId: 'price', anchors: [{ time: 50, price: 50 }, { time: 50, price: 80 }] })!;

    it('has a 2/2 center+edge schema, both free', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both']);
    });

    it('is a true pixel circle (constant radius in every direction)', () => {
        const d = make();
        expect(d.hitTest(50, 20, proj, 4)).toBe(true); // ring, straight up (r=30)
        expect(d.hitTest(80, 50, proj, 4)).toBe(true); // ring, straight right (same r=30 → round)
        expect(d.hitTest(50, 50, proj, 4)).toBe(true); // inside the default-filled disc
        expect(d.hitTest(50, 95, proj, 4)).toBe(false); // outside (d=45)
    });

    it('reports a square pixel bounds + anchor price extent', () => {
        expect(make().bounds(proj)).toEqual({ x: 20, y: 20, w: 60, h: 60 });
        expect(make().priceRange()).toEqual({ min: 50, max: 80 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('circle');
    });
});

describe('drawings/RotatedRect', () => {
    const proj = fakeProjector();
    // baseline (10,50)→(40,50) horizontal; width point at price 80 (y 20) → rect spans y 20..50
    const make = () =>
        createDrawing('rotatedrect', {
            paneId: 'price',
            anchors: [{ time: 10, price: 50 }, { time: 40, price: 50 }, { time: 25, price: 80 }],
        })!;

    it('has a 3/3 anchor schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
    });

    it('builds the rectangle from the baseline + perpendicular width', () => {
        const d = make();
        expect(d.hitTest(25, 35, proj, 1)).toBe(true); // inside the filled rect (y 20..50)
        expect(d.hitTest(25, 50, proj, 4)).toBe(true); // on the baseline edge
        expect(d.hitTest(25, 10, proj, 4)).toBe(false); // above the far edge (y=20)
    });

    it('reports the anchor price span', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 80 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('rotatedrect');
    });
});

describe('drawings/Path', () => {
    const proj = fakeProjector();
    const make = () =>
        createDrawing('path', { paneId: 'price', anchors: [{ time: 10, price: 50 }, { time: 30, price: 70 }, { time: 50, price: 60 }] })!;

    it('is a variable-length polyline (min 2)', () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(2);
        expect(s.max).toBeGreaterThan(3);
    });

    it('hit-tests its segments', () => {
        const d = make();
        expect(d.hitTest(20, 40, proj, 2)).toBe(true); // midpoint of (10,50)→(30,30)
        expect(d.hitTest(20, 80, proj, 2)).toBe(false);
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('path');
    });
});

describe('drawings/Arc', () => {
    const proj = fakeProjector();
    // base (10,50)→(50,50); apex price 80 (y 20) → symmetric dome peaking at (30,20)
    const make = () =>
        createDrawing('arc', { paneId: 'price', anchors: [{ time: 10, price: 50 }, { time: 50, price: 50 }, { time: 30, price: 80 }] })!;

    it('has a 3/3 anchor schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
    });

    it('fills the dome region between the arc and the base chord', () => {
        const d = make();
        expect(d.hitTest(30, 30, proj, 1)).toBe(true); // inside the dome (below the apex, above the chord)
        expect(d.hitTest(30, 65, proj, 1)).toBe(false); // below the chord → outside
    });

    it('reports the anchor price span', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 80 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('arc');
    });
});

describe('drawings/Curve', () => {
    const proj = fakeProjector();
    // start (10,50), end (50,50), control price 80 (y 20) → quadratic apex at (30,35)
    const make = () =>
        createDrawing('curve', { paneId: 'price', anchors: [{ time: 10, price: 50 }, { time: 50, price: 50 }, { time: 30, price: 80 }] })!;

    it('has a 3/3 anchor schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
    });

    it('bends toward (not through) the control point', () => {
        const d = make();
        expect(d.hitTest(30, 35, proj, 2)).toBe(true); // the curve apex (0.25·P0 + 0.5·C + 0.25·P2)
        expect(d.hitTest(30, 20, proj, 2)).toBe(false); // the control point itself — curve does NOT pass through it
        expect(d.hitTest(30, 50, proj, 2)).toBe(false); // the chord — curve sits above it
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('curve');
    });
});

describe('drawings/ArrowMark', () => {
    const proj = fakeProjector();
    const up = () => createDrawing('arrowmarkup', { paneId: 'price', anchors: [{ time: 50, price: 50 }] })!;
    const down = () => createDrawing('arrowmarkdown', { paneId: 'price', anchors: [{ time: 50, price: 50 }] })!;

    it('has a 1/1 anchor schema', () => {
        const s = up().anchorSchema();
        expect([s.min, s.max]).toEqual([1, 1]);
    });

    it('stamps an up glyph with the tip on the anchor + body below', () => {
        const d = up();
        expect(d.hitTest(50, 65, proj, 0)).toBe(true); // in the stem, below the tip
        expect(d.hitTest(50, 35, proj, 0)).toBe(false); // above the tip → no body there
        expect(d.hitTest(20, 50, proj, 0)).toBe(false); // left of the glyph
    });

    it('flips the body for the down glyph', () => {
        const d = down();
        expect(d.hitTest(50, 35, proj, 0)).toBe(true); // body is above the tip
        expect(d.hitTest(50, 65, proj, 0)).toBe(false); // nothing below the tip
    });

    it('round-trips both directions through serialize', () => {
        for (const d of [up(), down()]) {
            const a = d.serialize();
            expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        }
        expect(up().serialize().type).toBe('arrowmarkup');
        expect(down().serialize().type).toBe('arrowmarkdown');
    });
});
