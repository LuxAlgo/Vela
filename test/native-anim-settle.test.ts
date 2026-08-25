import { describe, it, expect, afterEach } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

/**
 * Animation SETTLING after a resize — regression guards for two workspace bugs.
 *
 * `clampViewport`'s bounds depend on the chart WIDTH, so a container resize (splitter
 * drag, layout change) can strand the ease targets (`targetBarSpacing`, the
 * scroll-to-latest glide) outside the reachable range. The ease then re-arms forever:
 * a permanent rAF loop that repaints and emits `viewport:changed` every frame and
 * visibly jitters `rightOffset` through the zoom anchor ("shaking" cells) until a
 * pointerdown's freeze-on-touch happens to re-align the target. `animTick` must snap a
 * target the clamp rejects onto the bound so the animation settles.
 *
 * And `syncSize` clears every canvas (the `canvas.width` assignments) before asking for
 * a synchronous repaint — but `renderFrame` yields to the Animator while it runs, so a
 * resize during an animation (live-bar ease, zoom glide) painted NOTHING until the next
 * rAF tick: one blank frame per splitter move ("flashing" cells). While the animator is
 * active, `syncSize` must paint synchronously itself.
 *
 * The vitest env is `node` (no DOM/canvas): the renderer is built unmounted, painting
 * is stubbed, and the REAL coords/clamp/ease math is driven directly — the same
 * technique as native-screenshot.test.ts.
 */

type AnyRenderer = Record<string, any>;

/** An unmounted renderer whose paint layer is stubbed; coords carry `bars` bars at `width` px. */
function setup(bars = 100, width = 800): { renderer: NativeRenderer; r: AnyRenderer; emits: () => number; paints: () => number } {
    const renderer = new NativeRenderer();
    const r = renderer as unknown as AnyRenderer;
    let emits = 0;
    let paints = 0;
    r.coords.setSize(width, 200, 1);
    r.coords.setBars(Array.from({ length: bars }, (_, i) => (i + 1) * 1000));
    r.computeScales = () => {};
    r.easeScales = () => false;
    r.easeLiveBar = () => false;
    r.paintData = () => { paints += 1; };
    r.crosshairLayer = { render: () => {} };
    r.externalCrossPx = () => null;
    r.emitViewportChange = () => { emits += 1; };
    return { renderer, r, emits: () => emits, paints: () => paints };
}

/** Drive animTick like the Animator would; the frame count until it reports settled. */
function ticksToSettle(r: AnyRenderer, maxFrames = 300): number {
    for (let i = 1; i <= maxFrames; i += 1) {
        if (!(r.animTick(16) as boolean)) return i;
    }
    return Infinity;
}

describe('animTick settles when a resize strands its targets outside the clamp', () => {
    it('zoom ease: a targetBarSpacing below the reachable minimum snaps to the bound', () => {
        const { r } = setup(100, 800); // minBs = 800/(100+6) ≈ 7.55
        r.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        r.targetBarSpacing = 2; // stranded below minBs — as after a widening resize
        expect(ticksToSettle(r)).toBeLessThan(10);
        // Settled ON the clamp bound, target re-aligned so the loop stays down.
        const vp = r.coords.getViewport();
        expect(vp.barSpacing).toBeCloseTo(800 / 106, 3);
        expect(r.targetBarSpacing).toBeCloseTo(vp.barSpacing, 6);
    });

    it('zoom ease: a targetBarSpacing above the reachable maximum snaps to the bound', () => {
        const { r } = setup(100, 800); // maxBs = 800/2 = 400
        r.coords.setViewport({ barSpacing: 100, rightOffset: 5 });
        r.targetBarSpacing = 900; // stranded above maxBs — as after a narrowing resize
        expect(ticksToSettle(r)).toBeLessThan(10);
        expect(r.coords.getViewport().barSpacing).toBeCloseTo(400, 3);
    });

    it('an in-bounds zoom ease still glides (several frames) and lands on its target', () => {
        const { r } = setup(100, 800);
        r.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        r.targetBarSpacing = 20;
        const frames = ticksToSettle(r);
        expect(frames).toBeGreaterThan(3); // it eased, not snapped
        expect(frames).toBeLessThan(200);
        expect(r.coords.getViewport().barSpacing).toBeCloseTo(20, 3);
    });

    it('scroll-to-latest glide: an unreachable rightOffset target settles on the pan bound', () => {
        const { r } = setup(100, 800);
        r.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        r.targetBarSpacing = 10; // zoom already settled — isolate the scroll glide
        r.scrollTargetRO = 9999; // beyond maxRo = visBars - (minVisible-1) = 79
        expect(ticksToSettle(r)).toBeLessThan(200);
        expect(r.scrollTargetRO).toBeNull(); // the glide ended
        expect(r.coords.getViewport().rightOffset).toBeCloseTo(79, 2);
    });

    it('the settled loop stops emitting viewport changes', () => {
        const { r, emits } = setup(100, 800);
        r.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        r.targetBarSpacing = 2;
        ticksToSettle(r);
        const settledEmits = emits();
        for (let i = 0; i < 50; i += 1) r.animTick(16); // the Animator would have stopped; even direct ticks must not move anything
        expect(emits()).toBe(settledEmits + 50); // ticks still report, but…
        expect(r.animTick(16)).toBe(false); // …the loop keeps reporting settled (no re-arm)
    });
});

describe('syncSize paints synchronously while the Animator owns the frame', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    afterEach(() => { (globalThis as { window?: unknown }).window = originalWindow; });

    function setupSized(animatorActive: boolean): { r: AnyRenderer; paints: () => number; flushes: () => number } {
        (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
        const { r, paints } = setup();
        let flushes = 0;
        const canvas = () => ({ width: 0, height: 0, style: {} });
        r.wrapper = { clientWidth: 400, clientHeight: 300 };
        r.plot = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) };
        r.backdropCanvas = canvas();
        r.dataCanvas = canvas();
        r.volumeCanvas = canvas();
        r.vpvrCanvas = canvas();
        r.chromeCanvas = canvas();
        r.drawingsCanvas = canvas();
        r.cursorCanvas = canvas();
        r.extLayers = [];
        r.layoutPanes = () => {};
        r.repositionTables = () => {};
        r.didInitialFit = true;
        r.scheduler = { flushNow: () => { flushes += 1; } };
        r.animator = { active: animatorActive };
        return { r, paints, flushes: () => flushes };
    }

    it('animator active: the cleared canvases are repainted in the same task (no blank frame)', () => {
        const { r, paints } = setupSized(true);
        r.syncSize();
        expect(paints()).toBe(1);
    });

    it('animator idle: the synchronous flush repaints as before', () => {
        const { r, paints, flushes } = setupSized(false);
        r.syncSize();
        expect(flushes()).toBe(1);
        expect(paints()).toBe(0); // the stub scheduler absorbs the flush — no double paint path
    });
});
