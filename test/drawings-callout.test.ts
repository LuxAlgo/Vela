import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, type Projector, type Callout } from '../src/core/drawings';

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

describe('drawings/callout', () => {
    const proj = fakeProjector();

    it('has a target + box anchor, click-placed (point → move → click), default text', () => {
        const d = createDrawing('callout', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 5 * HR, price: 70 }] })! as Callout;
        expect(d.anchorSchema().min).toBe(2);
        expect(d.placementMode()).toBe('click');
        expect(d.text?.value).toBe('Callout');
    });

    it('hit-tests the box body and the leader line', () => {
        // box centered on anchor[1] (5h, 70) → px (5, 30); target (0, 60) → px (0, 40)
        const d = createDrawing('callout', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 5 * HR, price: 70 }] })! as Callout;
        const b = d.box(proj)!;
        expect(b.x + b.w / 2).toBeCloseTo(5, 6); // box centered at xOf(5h)
        expect(b.y + b.h / 2).toBeCloseTo(30, 6); // yOf(70)
        expect(d.hitTest(5, 30, proj, 2)).toBe(true); // inside the box
        expect(d.hitTest(2.5, 35, proj, 2)).toBe(true); // on the leader (target→box midpoint)
        expect(d.hitTest(2.5, 80, proj, 2)).toBe(false);
        expect(d.priceRange()).toEqual({ min: 60, max: 70 });
    });

    it('shows a single handle at the pointer tip (no center handle over the text)', () => {
        const d = createDrawing('callout', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 5 * HR, price: 70 }] })! as Callout;
        const handles = d.handlePoints(proj);
        expect(handles).toHaveLength(1);
        expect(handles[0]).toEqual([0, 40]); // the target tip — xOf(0)=0, yOf(60)=40
    });

    it('a body drag moves only the box; the pointer tip stays pinned', () => {
        const d = createDrawing('callout', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 5 * HR, price: 70 }] })! as Callout;
        const moved = d.translateBody(2 * HR, -5, d.anchors);
        expect(moved[0]).toEqual({ time: 0, price: 60 }); // tip unchanged
        expect(moved[1]).toEqual({ time: 7 * HR, price: 65 }); // box shifted by (+2h, −5)
    });

    it('round-trips text + fill through serialize', () => {
        const d = createDrawing('callout', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 5 * HR, price: 70 }] })! as Callout;
        d.applySettings({ 'text.value': 'Buy zone', 'style.fillColor': '#101010' });
        const a = d.serialize();
        const round = deserializeDrawing(a)!;
        expect(round.serialize()).toEqual(a);
        expect(round.text?.value).toBe('Buy zone');
        expect(a.type).toBe('callout');
    });
});
