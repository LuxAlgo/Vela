// The viewport bounds. Zooming out stops at a fixed minimum bar spacing, whatever the
// series length: a short series shrinks to a narrow band with the empty past and future
// around it, and a long one shows as many bars as the width holds at that spacing.
// Zooming in still keeps two bars on screen, and so does panning. Framing a range (a
// preset, the first fit) is separate from those bounds and still fits the data.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { MIN_BAR_SPACING, MAX_BAR_SPACING } from '../src/renderers/native/core/ViewportState';
import { DEFAULT_MARGINS } from '../src/renderers/native/core/chartConfig';
import { presetToRange } from '../src/core/visible-range';
import type { OHLCV } from '../src/core/model/ohlcv';

const WIDTH = 1200;

/** 103 month-open bars ending November 2026 — the depth of a young stock's monthly chart. */
function monthlyBars(count = 103): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < count; i += 1) {
        const price = 4 + i * 1.4;
        out.push({ time: Date.UTC(2026, 10 - (count - 1) + i, 1), open: price, high: price * 1.2, low: price * 0.85, close: price * 1.1, volume: 1e9 });
    }
    return out;
}

/** A long intraday series: `count` one-minute bars. */
function minuteBars(count: number): OHLCV[] {
    const t0 = Date.UTC(2026, 9, 1);
    return Array.from({ length: count }, (_, i) => ({ time: t0 + i * 60_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }));
}

type Viewport = { barSpacing: number; rightOffset: number };

/* eslint-disable @typescript-eslint/no-explicit-any -- the bounds live behind the renderer's private clamp; driving it IS the behavior under test */
function makeRenderer(bars: OHLCV[], width = WIDTH) {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(width, 400, 1); // unmounted but sized — the bounds are pure math
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    r.setBars(bars);
    return {
        r,
        anyR,
        clamp: (barSpacing: number, rightOffset: number): Viewport => anyR.clampViewport(barSpacing, rightOffset),
        viewport: (): Viewport => anyR.coords.getViewport(),
        /** Pixel x of a bar index under the current viewport. */
        xOf: (index: number): number => anyR.coords.logicalToX(index),
    };
}

/** Bar centers inside `[0, width]` under the current viewport. */
function barsOnScreen(xOf: (i: number) => number, count: number, width = WIDTH): number {
    let n = 0;
    for (let i = 0; i < count; i += 1) {
        const x = xOf(i);
        if (x >= -1e-6 && x <= width + 1e-6) n += 1;
    }
    return n;
}

describe('zooming out a short series (103 monthly bars)', () => {
    const bars = monthlyBars();

    it('stops at the minimum bar spacing, not where the bars fill the width', () => {
        const { clamp } = makeRenderer(bars);
        expect(clamp(0.01, DEFAULT_MARGINS.right).barSpacing).toBe(MIN_BAR_SPACING);
        // The spacing at which all 103 bars plus the margin fill the width is reachable, and so is everything below it.
        const fill = WIDTH / (bars.length + DEFAULT_MARGINS.right);
        expect(clamp(fill / 2, DEFAULT_MARGINS.right).barSpacing).toBeCloseTo(fill / 2, 9);
        expect(clamp(1, DEFAULT_MARGINS.right).barSpacing).toBe(1);
    });

    it('leaves the empty past and future on screen at full zoom-out', () => {
        const { anyR, clamp, xOf } = makeRenderer(bars);
        anyR.coords.setViewport(clamp(0, 1000)); // the series parked mid-chart
        const first = xOf(0);
        const last = xOf(bars.length - 1);
        expect(last - first).toBeCloseTo((bars.length - 1) * MIN_BAR_SPACING, 6); // a 51 px band
        expect(first).toBeGreaterThan(0); // empty past to its left
        expect(WIDTH - last).toBeCloseTo(1000 * MIN_BAR_SPACING, 6); // empty future to its right
        const range = anyR.coords.visibleTimeRange() as { from: number; to: number };
        expect(range.from).toBeLessThan(bars[0]!.time);
        expect(range.to).toBeGreaterThan(bars[bars.length - 1]!.time);
    });

    it('zooming in still stops with two bars on screen', () => {
        const { clamp } = makeRenderer(bars);
        expect(clamp(1e9, 0).barSpacing).toBe(Math.min(MAX_BAR_SPACING, WIDTH / 2));
    });

    it('panning keeps at least two bars on screen in both directions, at full zoom-out too', () => {
        const { anyR, clamp, xOf } = makeRenderer(bars);
        for (const spacing of [MIN_BAR_SPACING, 2, 40]) {
            const farFuture = clamp(spacing, 1e9); // dragged toward the past: the series slides off to the left
            anyR.coords.setViewport(farFuture);
            expect(farFuture.rightOffset).toBeCloseTo(WIDTH / spacing - 1, 6);
            expect(barsOnScreen(xOf, bars.length)).toBe(2);
            expect(xOf(bars.length - 1)).toBeCloseTo(spacing, 6); // the newest two bars remain at the left edge

            const farPast = clamp(spacing, -1e9); // dragged toward the future: the series slides off to the right
            anyR.coords.setViewport(farPast);
            expect(farPast.rightOffset).toBe(2 - bars.length);
            expect(barsOnScreen(xOf, bars.length)).toBe(2);
            expect(xOf(1)).toBeCloseTo(WIDTH, 6); // the oldest two bars remain at the right edge
        }
    });

    it('a spacing multiplier does not move the zoom-out stop', () => {
        const { anyR, clamp } = makeRenderer(bars);
        anyR.coords.setPitchScale(2);
        expect(clamp(0.01, 0).barSpacing).toBe(MIN_BAR_SPACING);
        expect(clamp(1e9, 0).barSpacing).toBe(WIDTH / (2 * 2)); // two bars at a doubled pitch
    });

    it('an instant wheel zoom reaches the minimum spacing with the right edge pinned', () => {
        const { anyR, viewport } = makeRenderer(bars);
        anyR.animZoom.set(0);
        const before = viewport();
        anyR.zoomTo(0.01, anyR.coords.rightEdgeLogical, WIDTH);
        expect(viewport()).toEqual({ barSpacing: MIN_BAR_SPACING, rightOffset: before.rightOffset });
    });

    it('an eased zoom glides down to the minimum spacing and settles there', () => {
        const { anyR, viewport } = makeRenderer(bars);
        anyR.computeScales = () => {};
        anyR.easeScales = () => false;
        anyR.easeLiveBar = () => false;
        anyR.paintData = () => {};
        anyR.renderCrosshairLayer = () => {};
        anyR.updateLegendValues = () => {};
        anyR.emitViewportChange = () => {};
        const start = viewport().barSpacing;
        anyR.zoomTo(0.01, anyR.coords.rightEdgeLogical, WIDTH);
        expect(anyR.targetBarSpacing).toBe(MIN_BAR_SPACING);
        expect(anyR.animTick(16)).toBe(true); // still gliding after one frame
        const mid = viewport().barSpacing;
        expect(mid).toBeLessThan(start);
        expect(mid).toBeGreaterThan(MIN_BAR_SPACING);
        let frames = 1;
        while (anyR.animTick(16) && frames < 600) frames += 1;
        expect(frames).toBeLessThan(600);
        expect(viewport().barSpacing).toBe(MIN_BAR_SPACING);
    });
});

describe('what a zoom keeps in place around a short series', () => {
    const bars = monthlyBars();

    it('the default anchor keeps the newest bar its distance, in bars, from the right edge, wherever the cursor is', () => {
        const { anyR, viewport, xOf } = makeRenderer(bars);
        anyR.animZoom.set(0);
        const edge = (): { logical: number; x: number } => ({ logical: anyR.coords.rightEdgeLogical, x: WIDTH }); // what the wheel pins by default
        for (const spacing of [6, 2.5, 1, MIN_BAR_SPACING, 3, 9]) {
            const a = edge();
            anyR.zoomTo(spacing, a.logical, a.x);
            expect(viewport()).toEqual({ barSpacing: spacing, rightOffset: DEFAULT_MARGINS.right });
            expect(WIDTH - xOf(bars.length - 1)).toBeCloseTo(DEFAULT_MARGINS.right * spacing, 6);
        }
    });

    it('the same holds with a wide empty future on screen', () => {
        const { anyR, clamp, viewport } = makeRenderer(bars);
        anyR.animZoom.set(0);
        anyR.coords.setViewport(clamp(1.5, 320)); // the series dragged left: 320 empty slots after it
        for (const spacing of [1.8, 2.1, 1.4, MIN_BAR_SPACING]) {
            anyR.zoomTo(spacing, anyR.coords.rightEdgeLogical, WIDTH);
            expect(viewport().rightOffset).toBeCloseTo(320, 9);
        }
    });

    it('a cursor anchor keeps an empty-area point under the cursor', () => {
        const { anyR, clamp, viewport } = makeRenderer(bars);
        anyR.animZoom.set(0);
        anyR.coords.setViewport(clamp(MIN_BAR_SPACING, 1000));
        const cursorX = 300; // far left of the series: the empty past
        const logical = anyR.coords.xToLogical(cursorX) as number;
        expect(logical).toBeLessThan(0);
        for (const spacing of [0.8, 0.6, 0.7]) {
            anyR.zoomTo(spacing, logical, cursorX);
            expect(viewport().barSpacing).toBe(spacing);
            expect(anyR.coords.logicalToX(logical)).toBeCloseTo(cursorX, 6);
        }
    });

    it('zooming in on an empty-area point stops following it once only two bars would remain', () => {
        const { anyR, clamp, viewport, xOf } = makeRenderer(bars);
        anyR.animZoom.set(0);
        anyR.coords.setViewport(clamp(MIN_BAR_SPACING, 1000));
        const cursorX = 300;
        anyR.zoomTo(8, anyR.coords.xToLogical(cursorX), cursorX); // would push the whole series off the right edge
        expect(viewport()).toEqual({ barSpacing: 8, rightOffset: 2 - bars.length });
        expect(barsOnScreen(xOf, bars.length)).toBe(2);
    });
});

describe('fitting a short series back to the screen', () => {
    const bars = monthlyBars();

    it("the 'ALL' preset frames every bar plus the right margin from full zoom-out", () => {
        const { r, anyR, clamp, viewport, xOf } = makeRenderer(bars);
        anyR.coords.setViewport(clamp(0, 1000));
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        const v = viewport();
        expect(v.rightOffset).toBe(DEFAULT_MARGINS.right);
        expect(v.barSpacing).toBeCloseTo(WIDTH / (bars.length - 1 + DEFAULT_MARGINS.right), 6);
        expect(xOf(0)).toBeCloseTo(0, 6); // the oldest bar on the left edge
    });

    it('the time-axis double-click fit frames the series from full zoom-out', () => {
        const { anyR, clamp, viewport, xOf } = makeRenderer(bars);
        anyR.emitViewportChange = () => {};
        anyR.coords.setViewport(clamp(0, 1000));
        anyR.resetView();
        const v = viewport();
        expect(v.rightOffset).toBe(DEFAULT_MARGINS.right);
        expect(v.barSpacing).toBeCloseTo(WIDTH / (bars.length + DEFAULT_MARGINS.right), 6);
        expect(xOf(0)).toBeGreaterThanOrEqual(0);
        expect(xOf(bars.length - 1)).toBeLessThanOrEqual(WIDTH);
    });
});

describe('zooming out a long series (50,000 one-minute bars)', () => {
    const bars = minuteBars(50_000);

    it('stops at the same minimum bar spacing', () => {
        const { clamp } = makeRenderer(bars);
        expect(clamp(0.01, DEFAULT_MARGINS.right).barSpacing).toBe(MIN_BAR_SPACING);
        expect(clamp(0.75, DEFAULT_MARGINS.right).barSpacing).toBe(0.75);
    });

    it('shows as many bars as the width holds at that spacing', () => {
        const { anyR, clamp, xOf } = makeRenderer(bars);
        anyR.coords.setViewport(clamp(0, DEFAULT_MARGINS.right));
        const range = anyR.coords.visibleLogicalRange() as { from: number; to: number };
        expect(range.to - range.from).toBeCloseTo(WIDTH / MIN_BAR_SPACING, 6); // 2,400 bar slots
        expect(xOf(bars.length - 1)).toBeCloseTo(WIDTH - DEFAULT_MARGINS.right * MIN_BAR_SPACING, 6);
        expect(range.from).toBeGreaterThan(0); // older bars continue past the left edge
    });

    it('zooming in still stops with two bars on screen', () => {
        const { clamp } = makeRenderer(bars);
        expect(clamp(1e9, 0).barSpacing).toBe(Math.min(MAX_BAR_SPACING, WIDTH / 2));
    });

    it('panning reaches the oldest and newest bars and keeps two on screen', () => {
        const { anyR, clamp, xOf } = makeRenderer(bars);
        const oldest = clamp(MIN_BAR_SPACING, -1e9);
        expect(oldest.rightOffset).toBe(2 - bars.length);
        anyR.coords.setViewport(oldest);
        expect(xOf(1)).toBeCloseTo(WIDTH, 6);
        expect(xOf(0)).toBeCloseTo(WIDTH - MIN_BAR_SPACING, 6);

        const newest = clamp(MIN_BAR_SPACING, 1e9);
        expect(newest.rightOffset).toBeCloseTo(WIDTH / MIN_BAR_SPACING - 1, 6);
        anyR.coords.setViewport(newest);
        expect(xOf(bars.length - 1)).toBeCloseTo(MIN_BAR_SPACING, 6);
        expect(xOf(bars.length - 2)).toBeCloseTo(0, 6);
    });

    it("the 'ALL' preset lands on the minimum spacing with the newest bar at the right margin", () => {
        const { r, viewport } = makeRenderer(bars);
        r.setVisibleRange(presetToRange('ALL', bars)!, { rightMargin: true });
        expect(viewport()).toEqual({ barSpacing: MIN_BAR_SPACING, rightOffset: DEFAULT_MARGINS.right });
    });
});

describe('degenerate series', () => {
    it('a single bar or an unsized chart only bounds the spacing', () => {
        const one = makeRenderer(monthlyBars(1));
        expect(one.clamp(0.01, 123)).toEqual({ barSpacing: MIN_BAR_SPACING, rightOffset: 123 });
        const unsized = makeRenderer(monthlyBars(), 0);
        expect(unsized.clamp(5000, -7)).toEqual({ barSpacing: MAX_BAR_SPACING, rightOffset: -7 });
    });

    it('two bars keep both on screen', () => {
        const { anyR, clamp, xOf } = makeRenderer(monthlyBars(2));
        anyR.coords.setViewport(clamp(MIN_BAR_SPACING, 1e9));
        expect(barsOnScreen(xOf, 2)).toBe(2);
        anyR.coords.setViewport(clamp(MIN_BAR_SPACING, -1e9));
        expect(barsOnScreen(xOf, 2)).toBe(2);
    });
});
