import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, type Projector, type GannFan, type GannBox } from '../src/core/drawings';

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

describe('drawings/gann fan', () => {
    const proj = fakeProjector();

    it('draws a ray per enabled Gann ratio, labelled 1/8 … 8/1', () => {
        const d = createDrawing('gannfan', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 10 * HR, price: 60 }] })! as GannFan;
        expect(d.anchorSchema().min).toBe(2);
        const lines = d.entryLines(proj)!;
        expect(lines.length).toBe(9); // all 9 default ratios enabled
        expect(lines.map((l) => l.numberText)).toEqual(['1/8', '1/4', '1/3', '1/2', '1/1', '2/1', '3/1', '4/1', '8/1']);
        expect(d.editableLevels()!.length).toBe(9);
    });

    it('a disabled level drops its ray', () => {
        const d = createDrawing('gannfan', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 10 * HR, price: 60 }] })! as GannFan;
        d.levels[0]!.enabled = false;
        expect(d.entryLines(proj)!.length).toBe(8);
    });

    it('round-trips its levels through serialize', () => {
        const d = createDrawing('gannfan', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 10 * HR, price: 60 }] })! as GannFan;
        d.levels[4]!.color = '#123456';
        const a = d.serialize();
        const round = deserializeDrawing(a)!;
        expect(round.serialize()).toEqual(a);
        expect((round as GannFan).levels[4]!.color).toBe('#123456');
        expect(a.type).toBe('gannfan');
    });
});

describe('drawings/gann box', () => {
    const proj = fakeProjector();

    it('builds a grid (H+V per ratio) + the 2 diagonals; click-placed; grabbable inside', () => {
        const d = createDrawing('gannbox', { paneId: 'price', anchors: [{ time: 0, price: 40 }, { time: 10 * HR, price: 60 }] })! as GannBox;
        const lines = d.entryLines(proj)!;
        expect(lines.length).toBe(7 * 2 + 2); // 7 ratios × (horizontal + vertical) + 2 diagonals
        expect(d.placementMode()).toBe('click'); // click-move-click, like the plain Rectangle
        expect(d.hitTest(5, 50, proj, 4)).toBe(true); // inside the box (x 0..10, y 40..60)
        expect(d.hitTest(5, 90, proj, 4)).toBe(false);
        expect(d.priceRange()).toEqual({ min: 40, max: 60 });
    });

    it('round-trips through serialize', () => {
        const d = createDrawing('gannbox', { paneId: 'price', anchors: [{ time: 0, price: 40 }, { time: 10 * HR, price: 60 }] })! as GannBox;
        const a = d.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('gannbox');
    });
});
