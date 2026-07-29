// History-backfill prepends vs LOGICAL interaction anchors: a wheel-zoom glide recomputes
// rightOffset from `zoomAnchorLogical` every frame, and the deep-history chunk landing
// mid-zoom used to leave the anchor pointing thousands of bars into the past — teleporting
// the viewport ("the view jumps to the middle of history" field bug). setBars(preserveView)
// must shift logical anchors by the prepended count, exactly like indicator anchors.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

const mkBars = (n: number, t0: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: t0 + i * 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

/* eslint-disable @typescript-eslint/no-explicit-any -- reaching into private interaction state is the point of this regression */
function makeRenderer() {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1); // unmounted, but sized — the viewport math is pure
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} }; // mount-owned; stub for the unmounted path
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true; // the mount-owned intro reveal is irrelevant to viewport math
    return { r, anyR };
}

describe('setBars(preserveView) shifts logical interaction anchors on prepend', () => {
    it('keeps the anchored rightOffset identical across a deep-history prepend', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(mkBars(100, 1_000_000));
        // A wheel zoom is mid-glide: the anchor pins the right-edge bar.
        anyR.zoomAnchorLogical = 99;
        anyR.zoomAnchorX = 800;
        anyR.hoverLogical = 90;
        const before = anyR.anchoredRightOffset(50);

        // The backfill lands: 400 older bars prepend, same series, view preserved.
        r.setBars([...mkBars(400, 1_000_000 - 400 * 1000), ...mkBars(100, 1_000_000)], { preserveView: true });
        expect(anyR.zoomAnchorLogical).toBe(499); // 99 + 400
        expect(anyR.hoverLogical).toBe(490);
        expect(anyR.anchoredRightOffset(50)).toBeCloseTo(before, 9); // the glide re-anchors to the SAME viewport
    });

    it('a different series (head time not found) shifts nothing', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(mkBars(100, 1_000_000));
        anyR.zoomAnchorLogical = 42;
        r.setBars(mkBars(50, 5_000_000), { preserveView: true }); // unrelated times
        expect(anyR.zoomAnchorLogical).toBe(42);
    });

    it('an append-only update (no prepend) shifts nothing', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(mkBars(100, 1_000_000));
        anyR.zoomAnchorLogical = 42;
        r.setBars([...mkBars(100, 1_000_000), ...mkBars(5, 1_100_000)], { preserveView: true });
        expect(anyR.zoomAnchorLogical).toBe(42); // head unchanged → shift 0
    });
});
