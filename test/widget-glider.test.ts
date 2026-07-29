// The keyboard zoom Glider (src/widget/glide.ts) against a CLAMPING chart — the real
// renderer's getVisibleRange() is data-bounded (whole bars, spans clamped by the zoom
// limits) and setVisibleRange() clamps what it applies. The glide must ease its own
// range toward the target and terminate, never chase the chart's clamped read-back:
// chasing it stalls the rAF loop forever on any unreachable target (setVisibleRange
// every frame, overriding all later wheel/drag gestures).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Glider } from '../src/widget/glide';
import type { Vela } from '../src/Vela';

// ── manual rAF pump (node has no requestAnimationFrame) ──
let frameQueue: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;

function pump(frames: number): void {
    for (let i = 0; i < frames && frameQueue.length > 0; i++) {
        const cbs = frameQueue;
        frameQueue = [];
        for (const cb of cbs) cb(0);
    }
}

beforeEach(() => {
    frameQueue = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => frameQueue.push(cb);
    globalThis.cancelAnimationFrame = (): void => {};
});

afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
});

/** A chart whose READ-BACK clamps like the renderer's: the reported span never drops
 *  below `minSpanMs` (the zoom-in limit). Records every applied range. */
function clampingChart(from: number, to: number, minSpanMs = 0) {
    const applied: Array<{ from: number; to: number }> = [];
    const state = { from, to };
    const chart = {
        getVisibleRange: () => ({ from: Math.min(state.from, state.to - minSpanMs), to: state.to }),
        setVisibleRange: (r: { from: number; to: number }) => {
            state.from = r.from;
            state.to = r.to;
            applied.push({ ...r });
        },
    } as unknown as Vela;
    return { chart, applied };
}

const HOUR = 3_600_000;

describe('Glider under renderer clamping', () => {
    it('zooming toward an unreachable span terminates instead of looping forever', () => {
        // Repeated Ctrl+↑ pushes the target span far below what the chart ever reports
        // back (its zoom clamp floors the read-back at 100h) — the glide must converge
        // on its OWN range and stop, not chase the clamped read-back.
        const { chart, applied } = clampingChart(0, 200 * HOUR, 100 * HOUR);
        const glider = new Glider(() => chart);
        for (let i = 0; i < 10; i++) glider.zoom(0.8);
        pump(1000); // any healthy glide converges in well under 100 frames
        expect(frameQueue.length).toBe(0); // the loop STOPPED (no pending frame)
        const n = applied.length;
        expect(n).toBeLessThan(200);
        pump(50); // and stays stopped — no zombie frames re-applying the range
        expect(applied.length).toBe(n);
    });

    it('a normal (unclamped) glide still eases to its target and stops', () => {
        const { chart, applied } = clampingChart(100 * HOUR, 200 * HOUR);
        const glider = new Glider(() => chart);
        glider.zoom(0.5); // fully reachable: half the span, right edge anchored
        pump(1000);
        expect(frameQueue.length).toBe(0);
        const last = applied[applied.length - 1]!;
        expect(last.to).toBeCloseTo(200 * HOUR, -6); // right edge pinned
        expect(last.to - last.from).toBeCloseTo(50 * HOUR, -6); // span halved
    });

    it('stop() cancels a running glide and clears its state', () => {
        const { chart, applied } = clampingChart(0, 200 * HOUR);
        const glider = new Glider(() => chart);
        glider.zoom(0.8);
        pump(3);
        const n = applied.length;
        glider.stop();
        pump(50);
        expect(applied.length).toBe(n); // nothing applied after stop
    });
});
