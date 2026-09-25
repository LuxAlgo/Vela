// A new bar only drags the view along when the newest bar is on screen: scrolled back into
// history (the newest bar off the right edge), the view stays on the same bars.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

const bar = (i: number): OHLCV => ({ time: 1_000_000 + i * 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

/* eslint-disable @typescript-eslint/no-explicit-any -- the viewport is private; the test reads it */
function makeRenderer() {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1); // unmounted, but sized — the viewport math is pure
    anyR.scheduler = { invalidate: () => {} };
    anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    r.setBars(Array.from({ length: 200 }, (_, i) => bar(i)));
    const viewport = (): { barSpacing: number; rightOffset: number } => anyR.coords.getViewport();
    const setRightOffset = (ro: number): void => anyR.coords.setViewport({ ...viewport(), rightOffset: ro });
    return { r, anyR, viewport, setRightOffset };
}

describe('a new bar while reading history', () => {
    it('scrolled back: the view stays on the same bars', () => {
        const { r, viewport, setRightOffset } = makeRenderer();
        setRightOffset(-40);
        r.updateBar(bar(200));
        expect(viewport().rightOffset).toBe(-41);
    });

    it('at the newest bar: the view follows it', () => {
        const { r, viewport, setRightOffset } = makeRenderer();
        setRightOffset(3);
        r.updateBar(bar(200));
        expect(viewport().rightOffset).toBe(3);
    });

    it('a tick on the forming bar never moves the view', () => {
        const { r, viewport, setRightOffset } = makeRenderer();
        setRightOffset(-40);
        r.updateBar({ ...bar(199), close: 1.8 });
        expect(viewport().rightOffset).toBe(-40);
    });

    it('a glide back to the newest bars keeps its course', () => {
        const { r, anyR, viewport, setRightOffset } = makeRenderer();
        setRightOffset(-40);
        anyR.scrollTargetRO = 5;
        r.updateBar(bar(200));
        expect(viewport().rightOffset).toBe(-40);
    });
});
