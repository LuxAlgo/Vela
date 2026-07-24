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

describe('drawings/FibChannel', () => {
    const proj = fakeProjector();
    // baseline (10,50)→(50,50) [horizontal, y50]; width point price 80 (y20) → offset vector (0,−30)
    const make = () =>
        createDrawing('fibchannel', {
            paneId: 'price',
            anchors: [{ time: 10, price: 50 }, { time: 50, price: 50 }, { time: 10, price: 80 }],
        })!;

    it('has a 3-anchor schema, all free', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both', 'both']);
    });

    it('draws each level as the baseline translated by ratio·(p3−p1)', () => {
        const d = make();
        expect(d.hitTest(30, 50, proj, 2)).toBe(true); // level 0 = baseline (y50)
        expect(d.hitTest(30, 35, proj, 2)).toBe(true); // level 0.5 → y35
        expect(d.hitTest(30, 20, proj, 2)).toBe(true); // level 1 → through p3 (y20)
        expect(d.hitTest(30, 90, proj, 2)).toBe(false); // off all levels
    });

    it('reports a price range spanning the enabled levels + round-trips', () => {
        const pr = make().priceRange()!;
        expect(pr.min).toBe(50);
        expect(pr.max).toBeCloseTo(50 + 2.618 * 30, 1); // outermost enabled level (2.618)
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('fibchannel');
    });
});

describe('drawings/FibSpeedFan', () => {
    const proj = fakeProjector();
    // pivot (10,50)→px(10,50); box corner price 30 (y70) at time 50 → dx=40, dy=20
    const make = () => createDrawing('fibspeedfan', { paneId: 'price', anchors: [{ time: 10, price: 50 }, { time: 50, price: 30 }] })!;

    it('has a 2-anchor schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
    });

    it('emits price + time rays subdividing the box edges', () => {
        const d = make();
        expect(d.hitTest(50, 60, proj, 2)).toBe(true); // level 0.5 price ray → (50, 50+20·0.5)
        expect(d.hitTest(30, 70, proj, 2)).toBe(true); // level 0.5 time ray → (10+40·0.5, 70)
        expect(d.hitTest(50, 70, proj, 2)).toBe(true); // level 1 = the diagonal pivot→corner
        expect(d.hitTest(50, 10, proj, 2)).toBe(false); // off all rays
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('fibspeedfan');
    });
});

describe('drawings/TrendFibTime', () => {
    const proj = fakeProjector();
    // base interval p1(10)→p2(30) = 20 bars; origin p3 at time 50
    const make = () =>
        createDrawing('trendfibtime', {
            paneId: 'price',
            anchors: [{ time: 10, price: 50 }, { time: 30, price: 50 }, { time: 50, price: 50 }],
        })!;

    it('has a 3-anchor schema; imposes no price constraint', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
        expect(make().priceRange()).toBeNull();
        expect(make().timeExtent()).toBeNull();
    });

    it('projects vertical lines at p3.time + ratio·(p2−p1)', () => {
        const d = make();
        expect(d.hitTest(50, 30, proj, 2)).toBe(true); // level 0 → x = origin (50)
        expect(d.hitTest(70, 80, proj, 2)).toBe(true); // level 1 → x = 50 + 1·20 = 70
        expect(d.hitTest(15, 50, proj, 2)).toBe(false); // nothing left of the origin
        expect(d.hitTest(60, 50, proj, 1)).toBe(false); // level 0.5 (x=60) is disabled by default
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('trendfibtime');
    });
});
