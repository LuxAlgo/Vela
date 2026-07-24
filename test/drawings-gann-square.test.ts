import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, GannSquare, type Projector } from '../src/core/drawings';

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

describe('drawings/GannSquare', () => {
    const proj = fakeProjector();
    // c1 (10,60)→px(10,40); c2 (50,20)→px(50,80) → box 10..50 × 40..80, origin corner (10,40)
    const make = () => createDrawing('gannsquare', { paneId: 'price', anchors: [{ time: 10, price: 60 }, { time: 50, price: 20 }] })! as GannSquare;

    it('has a 2-anchor schema + click-move-click placement', () => {
        const d = make();
        const s = d.anchorSchema();
        expect([s.min, s.max]).toEqual([2, 2]);
        expect(d.placementMode()).toBe('click'); // click-move-click, like the plain Rectangle
    });

    it('emits the H/V grid + the Gann angle fan from the origin corner', () => {
        const lines = make().entryLines(proj)!;
        // the 1×1 fan ray = the box diagonal (origin → opposite corner)
        expect(lines.some((l) => l.x1 === 10 && l.y1 === 40 && l.x2 === 50 && l.y2 === 80)).toBe(true);
        // the 2×1 fan ray reaches the far vertical edge at half height: (10,40)→(50,60)
        expect(lines.some((l) => l.x1 === 10 && l.y1 === 40 && l.x2 === 50 && l.y2 === 60)).toBe(true);
        // the 0.5 horizontal grid line spans the box at y60
        expect(lines.some((l) => l.x1 === 10 && l.x2 === 50 && l.y1 === 60 && l.y2 === 60)).toBe(true);
    });

    it('exposes the arc geometry (origin corner + box pixel deltas)', () => {
        expect(make().arcGeom(proj)).toEqual({ ox: 10, oy: 40, bx: 40, py: 40 });
    });

    it('is grabbable anywhere inside the box', () => {
        const d = make();
        expect(d.hitTest(30, 60, proj, 0)).toBe(true); // inside
        expect(d.hitTest(60, 60, proj, 0)).toBe(false); // right of the box
    });

    it('reports the anchor price span + round-trips', () => {
        expect(make().priceRange()).toEqual({ min: 20, max: 60 });
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('gannsquare');
    });
});
