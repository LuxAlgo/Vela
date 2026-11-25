import { describe, it, expect } from 'vitest';
import { computePaneScale } from '../src/renderers/native/core/autoscale';
import type { OHLCV } from '../src/core/model/ohlcv';

/**
 * The configurable top/bottom margins: a percent of pane PIXEL height, so the data
 * occupies the middle `1 − top − bottom` of the pane. Verified as the pixel share the
 * window leaves above the high and below the low.
 */

const bars: OHLCV[] = [
    { time: 0, open: 100, high: 200, low: 100, close: 150, volume: 1 },
    { time: 1, open: 150, high: 180, low: 120, close: 160, volume: 1 },
];

/** Pixel shares of the window above the data max and below the data min. */
function shares(scale: { min: number; max: number }, dataMin: number, dataMax: number): { above: number; below: number } {
    const span = scale.max - scale.min;
    return { above: (scale.max - dataMax) / span, below: (dataMin - scale.min) / span };
}

describe('autoscale — configurable margins', () => {
    it('defaults to 10% above and 10% below', () => {
        const s = computePaneScale([], bars, true, 0, 1);
        const { above, below } = shares(s, 100, 200);
        expect(above).toBeCloseTo(0.1, 10);
        expect(below).toBeCloseTo(0.1, 10);
    });

    it('honors the configured percentages as pixel shares', () => {
        const s = computePaneScale([], bars, true, 0, 1, null, false, () => 0, { top: 20, bottom: 8 });
        const { above, below } = shares(s, 100, 200);
        expect(above).toBeCloseTo(0.2, 10);
        expect(below).toBeCloseTo(0.08, 10);
    });

    it('zero margins fit the data edge to edge', () => {
        const s = computePaneScale([], bars, true, 0, 1, null, false, () => 0, { top: 0, bottom: 0 });
        expect(s).toEqual({ min: 100, max: 200 });
    });

    it('applies the same pixel shares in log space', () => {
        const s = computePaneScale([], bars, true, 0, 1, null, true, () => 0, { top: 30, bottom: 20 });
        const lmin = Math.log(s.min);
        const lmax = Math.log(s.max);
        const lspan = lmax - lmin;
        expect((lmax - Math.log(200)) / lspan).toBeCloseTo(0.3, 10);
        expect((Math.log(100) - lmin) / lspan).toBeCloseTo(0.2, 10);
        expect(s.log).toBe(true);
    });
});

describe('autoscale — rounding-error slivers', () => {
    it('treats a one-ulp range like a flat series', () => {
        const v = 24.43;
        const sliver: OHLCV[] = [{ time: 0, open: v, high: v + 2 * Number.EPSILON * v, low: v, close: v, volume: 1 }];
        const flat: OHLCV[] = [{ time: 0, open: v, high: v, low: v, close: v, volume: 1 }];
        const s = computePaneScale([], sliver, true, 0, 0);
        const f = computePaneScale([], flat, true, 0, 0);
        expect(s.min).toBeCloseTo(f.min, 9);
        expect(s.max).toBeCloseTo(f.max, 9);
        expect(s.max - s.min).toBeGreaterThan(1);
    });
});
