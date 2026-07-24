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

// Shared anchors: pivot (10,60)→px(10,40); upper (30,80)→px(30,20); lower (30,40)→px(30,60)
const forkAnchors = [
    { time: 10, price: 60 },
    { time: 30, price: 80 },
    { time: 30, price: 40 },
];

describe('drawings/SchiffPitchfork', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('schiffpitchfork', { paneId: 'price', anchors: forkAnchors })!;

    it('has the 3-anchor pitchfork schema', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
    });

    it('starts the median at the PRICE-shifted origin (not the Andrews pivot)', () => {
        const d = make();
        // S = (10, mean(60,80)=70) → px (10,30); the Andrews median would instead pass through px(10,40)
        expect(d.hitTest(10, 30, proj, 2)).toBe(true);
        expect(d.hitTest(10, 40, proj, 2)).toBe(false);
    });

    it('reports the anchor price span + round-trips', () => {
        expect(make().priceRange()).toEqual({ min: 40, max: 80 });
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('schiffpitchfork');
    });
});

describe('drawings/ModifiedSchiffPitchfork', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('modifiedschiffpitchfork', { paneId: 'price', anchors: forkAnchors })!;

    it('starts the median at the full midpoint of the pivot + first tine point', () => {
        const d = make();
        // S = (mean(10,30)=20, mean(60,80)=70) → px (20,30)
        expect(d.hitTest(20, 30, proj, 2)).toBe(true);
        expect(d.hitTest(20, 40, proj, 2)).toBe(false);
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('modifiedschiffpitchfork');
    });
});

describe('drawings/InsidePitchfork', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('insidepitchfork', { paneId: 'price', anchors: forkAnchors })!;

    it('anchors the median at M with slope d = p3 − midpoint(p1,p2)', () => {
        const d = make();
        // B=px(20,30), M=px(30,40), d=(10,30) → median at x=40 is y=70
        expect(d.hitTest(40, 70, proj, 2)).toBe(true);
        // the back connector p1→p2 runs px(10,40)→px(30,20); its midpoint (20,30) is on it
        expect(d.hitTest(20, 30, proj, 2)).toBe(true);
        expect(d.hitTest(40, 20, proj, 2)).toBe(false);
    });

    it('reports the anchor price span + round-trips', () => {
        expect(make().priceRange()).toEqual({ min: 40, max: 80 });
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('insidepitchfork');
    });
});

describe('drawings/FlatTopBottom', () => {
    const proj = fakeProjector();
    // baseline (10,40)→px(10,60) and (50,60)→px(50,40); flat side at price 80 → px y 20
    const make = () =>
        createDrawing('flattopbottom', {
            paneId: 'price',
            anchors: [{ time: 10, price: 40 }, { time: 50, price: 60 }, { time: 30, price: 80 }],
        })!;

    it('has a 3-anchor schema with a price-only flat handle', () => {
        const s = make().anchorSchema();
        expect([s.min, s.max]).toEqual([3, 3]);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both', 'y']);
    });

    it('fills between the sloped baseline and the flat (constant-price) side', () => {
        const d = make();
        expect(d.hitTest(30, 30, proj, 1)).toBe(true); // inside the channel (flat y20 .. sloped y50 at x30)
        expect(d.hitTest(30, 20, proj, 2)).toBe(true); // on the flat side
        expect(d.hitTest(30, 70, proj, 2)).toBe(false); // below the sloped side
    });

    it('puts the flat handle at the baseline midpoint + reports the price span', () => {
        expect(make().handlePoints(proj)[2]).toEqual([30, 20]); // midpoint x, flat price y
        expect(make().priceRange()).toEqual({ min: 40, max: 80 });
        expect(make().timeExtent()).toEqual({ min: 10, max: 50 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('flattopbottom');
    });
});
