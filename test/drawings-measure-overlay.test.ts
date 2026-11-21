import { describe, it, expect } from 'vitest';
import { MeasureOverlay } from '../src/renderers/native/drawings/MeasureOverlay';
import type { Projector } from '../src/core/drawings';

/** A one-pane projector whose viewport can pan: `pan.dx` pixels of time scroll, `pan.dy` of price. */
function panningProjector(pan = { dx: 0, dy: 0 }): () => Projector {
    const proj = {
        width: 800,
        height: 600,
        xOf: (time: number) => time - pan.dx,
        yOf: (price: number) => price - pan.dy,
        pxToPoint: (x: number, y: number) => ({ time: x + pan.dx, price: y + pan.dy }),
        paneIdAtY: () => 'price',
    } as unknown as Projector;
    return () => proj;
}

describe('MeasureOverlay (transient ruler)', () => {
    it('click-move-click: a press starts, the cursor sizes, the 2nd press finishes', () => {
        const m = new MeasureOverlay(panningProjector());
        expect(m.isActive()).toBe(false);
        m.down(10, 20);
        expect(m.isActive()).toBe(true);
        expect(m.isFinished()).toBe(false);
        m.move(50, 60); // sized with no button down
        expect(m.isFinished()).toBe(false);
        m.down(50, 60); // 2nd click → finished
        expect(m.isFinished()).toBe(true);
    });

    it('a release near the press does NOT finish (waits for the 2nd click)', () => {
        const m = new MeasureOverlay(panningProjector());
        m.down(10, 20);
        m.up(11, 21); // barely moved → still a click-move-click in progress
        expect(m.isFinished()).toBe(false);
        expect(m.isActive()).toBe(true);
    });

    it('press-drag-release finishes in one gesture', () => {
        const m = new MeasureOverlay(panningProjector());
        m.down(10, 20);
        m.move(80, 90);
        m.up(80, 90); // dragged well past the slop → finished
        expect(m.isFinished()).toBe(true);
    });

    it('clear resets it to idle (vanishes on the next press / pan / zoom)', () => {
        const m = new MeasureOverlay(panningProjector());
        m.down(10, 20);
        m.move(50, 60);
        m.down(50, 60);
        expect(m.isFinished()).toBe(true);
        m.clear();
        expect(m.isActive()).toBe(false);
        expect(m.isFinished()).toBe(false);
        expect(m.points()).toBeNull();
    });

    it('graphic endpoints follow snapped coords; drag slop is judged from the raw press', () => {
        const m = new MeasureOverlay(panningProjector());
        m.down(13, 88, 10, 90); // raw click, magnet-snapped start
        expect(m.points()).toEqual({ start: { x: 10, y: 90 }, end: { x: 10, y: 90 } });
        m.up(14, 89, 10, 90); // tiny raw move — still click-move-click, not a drag finish
        expect(m.isFinished()).toBe(false);
        m.move(50, 40); // cursor sizes to a snapped end
        expect(m.points()?.end).toEqual({ x: 50, y: 40 });
        m.down(47, 43, 50, 40); // 2nd click at the snapped pixel
        expect(m.isFinished()).toBe(true);
        expect(m.points()).toEqual({ start: { x: 10, y: 90 }, end: { x: 50, y: 40 } });
    });

    it('press-drag-release finishes at the snapped release, slop from the raw press', () => {
        const m = new MeasureOverlay(panningProjector());
        m.down(13, 88, 10, 90);
        m.move(50, 40);
        m.up(80, 90, 80, 90); // dragged well past the raw press
        expect(m.isFinished()).toBe(true);
        expect(m.points()?.end).toEqual({ x: 80, y: 90 });
    });

    it('a ruler being placed stays on its time and price when the chart pans', () => {
        const pan = { dx: 0, dy: 0 };
        const m = new MeasureOverlay(panningProjector(pan));
        m.down(100, 200); // first click: the start is set
        m.move(300, 260);
        pan.dx = 50; // a wheel or trackpad pan moves the chart under the ruler
        pan.dy = -20;
        expect(m.points()?.start).toEqual({ x: 50, y: 220 });
        m.move(300, 260); // the cursor sizes the end where it now points
        m.down(300, 260); // the second click finishes
        expect(m.isFinished()).toBe(true);
        expect(m.points()).toEqual({ start: { x: 50, y: 220 }, end: { x: 300, y: 260 } });
        pan.dx = 0; // a finished ruler follows the chart too
        pan.dy = 0;
        expect(m.points()).toEqual({ start: { x: 100, y: 200 }, end: { x: 350, y: 240 } });
    });
});
