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

describe('drawings/ExtendedLine', () => {
    const proj = fakeProjector();
    // horizontal at price 50 (y 50), anchors at time 50 & 100 → extends to both edges
    const make = () => createDrawing('extendedline', { paneId: 'price', anchors: [{ time: 50, price: 50 }, { time: 100, price: 50 }] })!;

    it('has a 2/2 anchor schema, both handles free', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both']);
    });

    it('hit-tests past BOTH anchors (extended to each edge)', () => {
        const d = make();
        expect(d.hitTest(10, 50, proj, 4)).toBe(true); // left of the first anchor
        expect(d.hitTest(190, 50, proj, 4)).toBe(true); // right of the second anchor
        expect(d.hitTest(100, 80, proj, 4)).toBe(false); // off the line
    });

    it('spans all time (never culls) and reports its price span', () => {
        expect(make().timeExtent()).toBeNull();
        expect(make().priceRange()).toEqual({ min: 50, max: 50 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('extendedline');
    });
});

describe('drawings/VerticalLine', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('vline', { paneId: 'price', anchors: [{ time: 50, price: 30 }] })!;

    it('has a 1/1 anchor schema; the handle is time-only (free x)', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([1, 1]);
        expect(s.slots.map((x) => x.free)).toEqual(['x']);
    });

    it('hit-tests the full height at its time, ignoring y', () => {
        const d = make();
        expect(d.hitTest(50, 10, proj, 4)).toBe(true);
        expect(d.hitTest(50, 90, proj, 4)).toBe(true);
        expect(d.hitTest(60, 50, proj, 4)).toBe(false);
    });

    it('places its handle at the clicked point and does not constrain the price axis', () => {
        expect(make().handlePoints(proj)).toEqual([[50, 70]]); // y = 100 − 30
        expect(make().priceRange()).toBeNull();
        expect(make().bounds(proj)).toEqual({ x: 49, y: 0, w: 2, h: 100 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('vline');
    });
});

describe('drawings/HorizontalRay', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('hray', { paneId: 'price', anchors: [{ time: 50, price: 50 }] })!;

    it('has a 1/1 anchor schema, free both', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([1, 1]);
        expect(s.slots.map((x) => x.free)).toEqual(['both']);
    });

    it('extends only to the RIGHT of its anchor', () => {
        const d = make();
        expect(d.hitTest(100, 50, proj, 4)).toBe(true); // right of the anchor
        expect(d.hitTest(190, 50, proj, 4)).toBe(true); // far right
        expect(d.hitTest(10, 50, proj, 4)).toBe(false); // left of the anchor → nothing there
        expect(d.hitTest(100, 80, proj, 4)).toBe(false); // off the level
    });

    it('reports its price level + a right-unbounded time extent', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 50 });
        expect(make().timeExtent()).toEqual({ min: 50, max: Infinity });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('hray');
    });
});

describe('drawings/CrossLine', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('crossline', { paneId: 'price', anchors: [{ time: 50, price: 50 }] })!;

    it('has a 1/1 anchor schema, free both', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([1, 1]);
        expect(s.slots.map((x) => x.free)).toEqual(['both']);
    });

    it('hit-tests either arm (full-width horizontal + full-height vertical)', () => {
        const d = make();
        expect(d.hitTest(10, 50, proj, 4)).toBe(true); // horizontal arm, far left
        expect(d.hitTest(190, 50, proj, 4)).toBe(true); // horizontal arm, far right
        expect(d.hitTest(50, 10, proj, 4)).toBe(true); // vertical arm, top
        expect(d.hitTest(50, 90, proj, 4)).toBe(true); // vertical arm, bottom
        expect(d.hitTest(100, 80, proj, 4)).toBe(false); // off both arms
    });

    it('folds its price level into autoscale but spans all time', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 50 });
        expect(make().timeExtent()).toBeNull();
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('crossline');
    });
});

describe('drawings/InfoLine', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('infoline', { paneId: 'price', anchors: [{ time: 50, price: 50 }, { time: 100, price: 60 }] })!;

    it('has a 2/2 anchor schema, both handles free', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both']);
    });

    it('hit-tests the finite segment only', () => {
        const d = make();
        expect(d.hitTest(75, 45, proj, 4)).toBe(true); // segment midpoint (50,50)→(100,40)
        expect(d.hitTest(75, 10, proj, 4)).toBe(false); // off the segment
    });

    it('reports the price span of its two anchors', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 60 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('infoline');
    });
});

describe('drawings/TrendAngle', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('trendangle', { paneId: 'price', anchors: [{ time: 50, price: 50 }, { time: 100, price: 60 }] })!;

    it('has a 2/2 anchor schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
    });

    it('hit-tests the finite segment and does NOT extend past the second anchor', () => {
        const d = make();
        expect(d.hitTest(75, 45, proj, 4)).toBe(true); // on the segment
        expect(d.hitTest(150, 30, proj, 4)).toBe(false); // on the infinite line but past p2 → no hit
    });

    it('reports its anchor price span', () => {
        expect(make().priceRange()).toEqual({ min: 50, max: 60 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('trendangle');
    });
});
