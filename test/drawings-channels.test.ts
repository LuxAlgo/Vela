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

describe('drawings/ParallelChannel', () => {
    const proj = fakeProjector();
    // baseline (0,0)→(50,50) [midpoint price 25]; offset anchor at price 45 ⇒ parallel line +20
    const make = (cTime = 25) =>
        createDrawing('parallelchannel', {
            paneId: 'price',
            anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }, { time: cTime, price: 45 }],
        })!;

    it('has a 3/3 anchor schema; the offset handle is width-only (free y)', () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(3);
        expect(s.max).toBe(3);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both', 'y']);
    });

    it('hit-tests both the baseline and the parallel line, plus the fill interior', () => {
        const d = make();
        expect(d.hitTest(25, 75, proj, 4)).toBe(true); // baseline midpoint (0,100)→(50,50)
        expect(d.hitTest(25, 55, proj, 4)).toBe(true); // parallel line +20 (0,80)→(50,30)
        expect(d.hitTest(25, 65, proj, 1)).toBe(true); // inside the fill
        expect(d.hitTest(25, 20, proj, 4)).toBe(false); // outside both lines + fill
    });

    it('keeps the offset handle ON the channel at the baseline midpoint, whatever the 3rd anchor time', () => {
        expect(make(25).handlePoints(proj)[2]).toEqual([25, 55]); // mid x, parallel-line price
        expect(make(500).handlePoints(proj)[2]).toEqual([25, 55]); // far-in-time 3rd anchor → still at the midpoint
        expect(make(500).hitHandle(25, 55, proj, 4)).toBe(2); // …and it's grabbable
    });

    it('reports a price range spanning both lines + the offset anchor', () => {
        expect(make().priceRange()).toEqual({ min: 0, max: 70 }); // {0,50} baseline + {20,70} parallel
    });

    it('ships a default fill and round-trips through serialize', () => {
        const d = make();
        expect(d.style.fillColor).toBeTruthy();
        const a = d.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('parallelchannel');
    });
});

describe('drawings/DisjointChannel', () => {
    const proj = fakeProjector();
    // top line at price 80, bottom line at price 20 (two independent horizontal-ish segments)
    const make = () =>
        createDrawing('disjointchannel', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 80 },
                { time: 50, price: 80 },
                { time: 0, price: 20 },
                { time: 50, price: 20 },
            ],
        })!;

    it('has a 4/4 anchor schema', () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(4);
        expect(s.max).toBe(4);
    });

    it('hit-tests each segment and the fill between them', () => {
        const d = make();
        expect(d.hitTest(25, 20, proj, 4)).toBe(true); // top line (price 80 → y 20)
        expect(d.hitTest(25, 80, proj, 4)).toBe(true); // bottom line (price 20 → y 80)
        expect(d.hitTest(25, 50, proj, 1)).toBe(true); // inside the fill
        expect(d.hitTest(120, 95, proj, 4)).toBe(false); // outside
    });

    it('reports the price range over all four corners', () => {
        expect(make().priceRange()).toEqual({ min: 20, max: 80 });
    });
});

describe('drawings/Pitchfork', () => {
    const proj = fakeProjector();
    // pivot (0,50); tine anchors (20,80) & (20,20) ⇒ midpoint (20,50) ⇒ horizontal median + tines
    const make = () =>
        createDrawing('pitchfork', {
            paneId: 'price',
            anchors: [{ time: 0, price: 50 }, { time: 20, price: 80 }, { time: 20, price: 20 }],
        })!;

    it('has a 3/3 anchor schema', () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(3);
        expect(s.max).toBe(3);
    });

    it('extends the median + tines to the right edge for hit-testing', () => {
        const d = make();
        expect(d.hitTest(150, 50, proj, 4)).toBe(true); // median (y=50) extended right
        expect(d.hitTest(150, 20, proj, 4)).toBe(true); // upper tine (price 80 → y 20)
        expect(d.hitTest(150, 80, proj, 4)).toBe(true); // lower tine (price 20 → y 80)
        expect(d.hitTest(150, 95, proj, 4)).toBe(false); // off all lines
    });

    it('reports its anchor price span (extension stays unbounded)', () => {
        expect(make().priceRange()).toEqual({ min: 20, max: 80 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('pitchfork');
    });
});
