import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, MeasureBox, PositionTool, formatDuration, type Projector } from '../src/core/drawings';

const HR = 3600000;

/** Linear projector: x = time/hour, y = 100 − price, with a 1-bar-per-hour bar count. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        barsBetween: (t1, t2) => Math.abs(t2 - t1) / HR,
        width: 200,
        height: 100,
    };
}

describe('drawings/measurement range', () => {
    const proj = fakeProjector();

    it('shows both the price and date deltas by default; red when down; box hit-test', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 3 * HR, price: 54 }] })! as MeasureBox;
        const lines = d.measureLabel(proj);
        expect(lines[0]).toBe('-6.00 (-10.00%)');
        expect(lines[1]).toBe('3 bars, 3h');
        expect(d.isUp()).toBe(false);
        expect(d.priceRange()).toEqual({ min: 54, max: 60 });
        expect(d.hitTest(1.5, 43, proj, 4)).toBe(true); // inside the box (x 0..3, y 40..46)
        expect(d.hitTest(1.5, 80, proj, 4)).toBe(false);
    });

    it('the showPrice / showDate toggles drop either line', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }] })! as MeasureBox;
        expect(d.measureLabel(proj)).toEqual(['+10.00 (+20.00%)', '5 bars, 5h']); // both on
        d.showDate = false;
        expect(d.measureLabel(proj)).toEqual(['+10.00 (+20.00%)']); // price only
        d.showDate = true;
        d.showPrice = false;
        expect(d.measureLabel(proj)).toEqual(['5 bars, 5h']); // date only
        d.showDate = false;
        expect(d.measureLabel(proj)).toEqual([]); // both off
    });

    it('round-trips the toggles + label text styling through serialize', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })! as MeasureBox;
        d.showPrice = false;
        d.applySettings({ 'text.color': '#ff0000', 'text.size': 'large' });
        const a = d.serialize();
        const round = deserializeDrawing(a)!;
        expect(round.serialize()).toEqual(a);
        expect((round as MeasureBox).showPrice).toBe(false);
        expect(round.text?.color).toBe('#ff0000');
        expect(a.type).toBe('datepricerange');
    });
});

describe('drawings/position tools', () => {
    const proj = fakeProjector();

    it('long position: risk:reward + reward/risk %, box hit-test', () => {
        // entry 50, stop 40 (risk 10), target 70 (reward 20) → R:R 2.0
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })!;
        expect(d.anchorSchema().min).toBe(2); // click entry + click stop; onPlaced derives the target
        expect(d.anchorSchema().max).toBe(2);
        const p = d as PositionTool;
        expect(p.directionLabel()).toBe('LONG'); // target (70) above entry (50)
        expect(p.rr()).toBeCloseTo(2, 6);
        expect(p.rewardPct()).toBeCloseTo(40, 6);
        expect(p.riskPct()).toBeCloseTo(20, 6);
        expect(d.priceRange()).toEqual({ min: 40, max: 70 });
        expect(d.hitTest(5, 45, proj, 4)).toBe(true); // inside the position box
    });

    it('short scenario labels SHORT and computes R:R', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }, { time: 10 * HR, price: 30 }] })!;
        expect((d as PositionTool).directionLabel()).toBe('SHORT');
        expect((d as PositionTool).rr()).toBeCloseTo(2, 6); // |30−50| / |50−60| = 20/10
    });

    it('direction is purely geometric — the same tool reads SHORT when the target is below the entry', () => {
        // target (30) below entry (50) → SHORT (one tool covers both directions, by where the stop/target land)
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }, { time: 10 * HR, price: 30 }] })!;
        expect((d as PositionTool).directionLabel()).toBe('SHORT');
    });

    it('dragging the stop across the entry flips the target to the opposite side (never same direction)', () => {
        // long: entry 50, stop 40 (below), target 70 (above)
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[1]!.price = 60; // drag the stop UP, past the entry → would be same side as target
        d.constrainHandleDrag(1);
        expect(d.anchors[2]!.price).toBe(30); // target reflected across entry (50): 2·50 − 70 → below
        expect(d.directionLabel()).toBe('SHORT'); // now a short, sides still opposed
    });

    it('dragging the target across the entry flips the stop to the opposite side', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[2]!.price = 45; // drag the target DOWN, below the entry
        d.constrainHandleDrag(2);
        expect(d.anchors[1]!.price).toBe(60); // stop reflected across entry (50): 2·50 − 40 → above
    });

    it('no flip while the stop and target already straddle the entry', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[1]!.price = 45; // still below the entry
        d.constrainHandleDrag(1);
        expect(d.anchors[2]!.price).toBe(70); // target untouched
    });

    it('round-trips through serialize', () => {
        const a = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })!.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('position');
    });
});

describe('formatDuration', () => {
    it('formats spans compactly', () => {
        expect(formatDuration(2 * 86400000 + 4 * HR)).toBe('2d 4h');
        expect(formatDuration(3 * HR + 15 * 60000)).toBe('3h 15m');
        expect(formatDuration(45 * 60000)).toBe('45m');
    });
});
