// @vitest-environment jsdom
// Framing a named range preset keeps the configured right margin. Every preset ('ALL',
// '1M', 'YTD'…) ends on the newest bar, and "Reset chart view" (the chart menu row and
// its Alt+R key) frames 'ALL' — so a preset that landed the newest bar flush against the
// price axis dropped the margin the user set in Settings → Canvas → Margins. A plain
// setVisibleRange (a host's explicit window, the keyboard zoom glide, layout sync) still
// frames exactly the range it is given.
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { DEFAULT_MARGINS } from '../src/renderers/native/core/chartConfig';
import { presetToRange } from '../src/core/visible-range';
import type { OHLCV } from '../src/core/model/ohlcv';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const T0 = 1_700_000_000_000;
const STEP = 60_000;
const WIDTH = 800;

const mkBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: T0 + i * STEP, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

/* eslint-disable @typescript-eslint/no-explicit-any -- the viewport lives behind the renderer's coords; reading it IS the behavior under test */
function makeRenderer(bars: OHLCV[]) {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(WIDTH, 200, 1); // unmounted but sized — the framing math is pure
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    r.setBars(bars);
    return { r, viewport: () => anyR.coords.getViewport() as { barSpacing: number; rightOffset: number } };
}

describe('a range preset keeps the right margin', () => {
    it('framing all history leaves the default right margin past the newest bar', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        const v = viewport();
        expect(v.rightOffset).toBe(DEFAULT_MARGINS.right);
        expect(v.barSpacing).toBeCloseTo(WIDTH / (bars.length - 1 + DEFAULT_MARGINS.right), 6);
    });

    it('a right margin set in the settings is the one the frame keeps', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.applyConfig({ margins: { right: 40 } });
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        expect(viewport().rightOffset).toBe(40);
    });

    it('the oldest bar stays on screen when the margin is wider than the zoom-out breathing room', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.applyConfig({ margins: { right: 40 } });
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        const v = viewport();
        const visibleBars = WIDTH / v.barSpacing;
        // logical 0 (the oldest bar) sits at the left edge, not scrolled off it
        expect(visibleBars - v.rightOffset).toBeGreaterThanOrEqual(bars.length - 1 - 1e-6);
    });

    it('a shorter preset keeps the margin too', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.applyConfig({ margins: { right: 25 } });
        const range = { from: bars[199]!.time, to: bars[299]!.time }; // the newest 100 bars
        r.setVisibleRange(range, { rightMargin: true });
        const v = viewport();
        expect(v.rightOffset).toBe(25);
        expect(v.barSpacing).toBeCloseTo(WIDTH / (100 + 25), 6);
    });

    it('a zero right margin frames the newest bar at the edge', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.applyConfig({ margins: { right: 0 } });
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        expect(viewport().rightOffset).toBe(0);
    });

    it('a plain visible range is framed exactly, with no margin added', () => {
        const bars = mkBars(300);
        const { r, viewport } = makeRenderer(bars);
        r.setVisibleRange({ from: bars[199]!.time, to: bars[299]!.time });
        const v = viewport();
        expect(v.rightOffset).toBe(0);
        expect(v.barSpacing).toBeCloseTo(WIDTH / 100, 6);
    });
});

describe('a chart framing a preset (what "Reset chart view" does)', () => {
    let restoreCanvas: () => void;
    beforeAll(() => {
        restoreCanvas = installCanvasStandIn();
    });
    afterAll(() => restoreCanvas());
    const disposers: Array<() => void> = [];
    afterEach(() => {
        while (disposers.length) disposers.pop()!();
        document.body.replaceChildren();
    });

    it('lands the newest bar on the right margin set in the settings', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const renderer = new NativeRenderer();
        renderer.applyFeature('intro', false);
        const chart = new Vela(host, { data: mkBars(300), live: false }, { renderer });
        disposers.push(() => chart.destroy());
        await new Promise((r) => setTimeout(r, 0)); // the chart loads its data asynchronously
        const anyR = renderer as any;
        anyR.coords.setSize(WIDTH, 200, 1);
        renderer.applyConfig({ margins: { right: 30 } });
        anyR.coords.setViewport({ barSpacing: 12, rightOffset: -50 }); // the user zoomed and panned into history

        chart.setVisibleRangePreset('ALL');

        const v = anyR.coords.getViewport() as { barSpacing: number; rightOffset: number };
        expect(v.rightOffset).toBe(30);
        expect(v.barSpacing).toBeCloseTo(WIDTH / (299 + 30), 6);
    });
});
