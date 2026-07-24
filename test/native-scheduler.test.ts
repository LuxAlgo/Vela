import { describe, it, expect } from 'vitest';
import { Scheduler, InvalidateLevel, repaintsData } from '../src/renderers/native/core/Scheduler';

/** Controllable rAF: capture the pending callback so the test can fire frames. */
function harness() {
    let pending: (() => void) | null = null;
    const raf = (cb: () => void): number => {
        pending = cb;
        return 1;
    };
    const cancel = (): void => {
        pending = null;
    };
    const frames: InvalidateLevel[] = [];
    const scheduler = new Scheduler((lvl) => frames.push(lvl), raf, cancel);
    const fire = (): void => {
        const cb = pending;
        pending = null;
        cb?.();
    };
    return { scheduler, frames, fire, isArmed: () => pending !== null };
}

describe('native Scheduler', () => {
    it('coalesces multiple invalidations in a frame to the highest level', () => {
        const h = harness();
        h.scheduler.invalidate(InvalidateLevel.Cursor);
        h.scheduler.invalidate(InvalidateLevel.Full);
        h.scheduler.invalidate(InvalidateLevel.Light);
        expect(h.isArmed()).toBe(true);
        h.fire();
        expect(h.frames).toEqual([InvalidateLevel.Full]); // one frame, highest level
    });

    it('re-arms for the next frame after flushing', () => {
        const h = harness();
        h.scheduler.invalidate(InvalidateLevel.Light);
        h.fire();
        h.scheduler.invalidate(InvalidateLevel.Cursor);
        expect(h.isArmed()).toBe(true);
        h.fire();
        expect(h.frames).toEqual([InvalidateLevel.Light, InvalidateLevel.Cursor]);
    });

    it('treats None as a no-op (no frame, no arm)', () => {
        const h = harness();
        h.scheduler.invalidate(InvalidateLevel.None);
        expect(h.isArmed()).toBe(false);
        h.fire();
        expect(h.frames).toEqual([]);
    });

    it('flushNow paints synchronously', () => {
        const h = harness();
        h.scheduler.flushNow(InvalidateLevel.Full);
        expect(h.frames).toEqual([InvalidateLevel.Full]);
        expect(h.isArmed()).toBe(false);
    });

    it('destroy cancels a pending frame', () => {
        const h = harness();
        h.scheduler.invalidate(InvalidateLevel.Full);
        h.scheduler.destroy();
        h.fire();
        expect(h.frames).toEqual([]);
    });
});

describe('native Scheduler · Cursor-tier gate (repaintsData)', () => {
    it('repaints the data layer only at Light or Full', () => {
        expect(repaintsData(InvalidateLevel.None)).toBe(false);
        expect(repaintsData(InvalidateLevel.Cursor)).toBe(false); // hover → crosshair only
        expect(repaintsData(InvalidateLevel.Light)).toBe(true);
        expect(repaintsData(InvalidateLevel.Full)).toBe(true);
    });
});
