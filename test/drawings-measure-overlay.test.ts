import { describe, it, expect } from 'vitest';
import { MeasureOverlay } from '../src/renderers/native/drawings/MeasureOverlay';

describe('MeasureOverlay (transient ruler)', () => {
    it('click-move-click: a press starts, the cursor sizes, the 2nd press finishes', () => {
        const m = new MeasureOverlay();
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
        const m = new MeasureOverlay();
        m.down(10, 20);
        m.up(11, 21); // barely moved → still a click-move-click in progress
        expect(m.isFinished()).toBe(false);
        expect(m.isActive()).toBe(true);
    });

    it('press-drag-release finishes in one gesture', () => {
        const m = new MeasureOverlay();
        m.down(10, 20);
        m.move(80, 90);
        m.up(80, 90); // dragged well past the slop → finished
        expect(m.isFinished()).toBe(true);
    });

    it('clear resets it to idle (vanishes on the next press / pan / zoom)', () => {
        const m = new MeasureOverlay();
        m.down(10, 20);
        m.move(50, 60);
        m.down(50, 60);
        expect(m.isFinished()).toBe(true);
        m.clear();
        expect(m.isActive()).toBe(false);
        expect(m.isFinished()).toBe(false);
    });
});
