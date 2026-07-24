import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, getDrawingType, computeRegressionFit, RegressionChannel, type Projector } from '../src/core/drawings';

const HR = 3600_000;

/** Bars with a chosen close per hour, starting at t=0. */
function bars(closes: number[]): Array<{ time: number; open: number; high: number; low: number; close: number }> {
    return closes.map((c, i) => ({ time: i * HR, open: c, high: c, low: c, close: c }));
}

/** Linear projector (x = time/HR, y = 1000 − price) that serves `data` via barsInRange. */
function fakeProjector(data: Array<{ time: number; open: number; high: number; low: number; close: number }>): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price) => 1000 - price,
        pxToPoint: (x, y) => ({ time: x * HR, price: 1000 - y }),
        paneIdAtY: () => 'price',
        barsInRange: (from, to) => data.filter((b) => b.time >= Math.min(from, to) && b.time <= Math.max(from, to)),
        width: 500,
        height: 1000,
    };
}

describe('drawings/regression fit math', () => {
    it('a perfectly linear series → R²=1, zero band width, correct slope', () => {
        const f = computeRegressionFit(bars([10, 12, 14, 16, 18]))!; // slope +2 per bar
        expect(f.r2).toBeCloseTo(1, 10);
        expect(f.dev).toBeCloseTo(0, 10);
        expect(f.mid0).toBeCloseTo(10, 10);
        expect(f.mid1).toBeCloseTo(18, 10); // intercept + slope*(n-1)
        expect(f.n).toBe(5);
    });

    it('a flat series → slope 0, R²=0, zero deviation', () => {
        const f = computeRegressionFit(bars([50, 50, 50, 50]))!;
        expect(f.mid0).toBeCloseTo(50, 10);
        expect(f.mid1).toBeCloseTo(50, 10);
        expect(f.r2).toBeCloseTo(0, 10);
        expect(f.dev).toBeCloseTo(0, 10);
    });

    it('scatter around a trend → 0 < R² < 1 and a positive band width', () => {
        const f = computeRegressionFit(bars([10, 13, 12, 17, 18]))!;
        expect(f.r2).toBeGreaterThan(0);
        expect(f.r2).toBeLessThan(1);
        expect(f.dev).toBeGreaterThan(0);
    });

    it('fewer than two bars cannot be fit', () => {
        expect(computeRegressionFit(bars([10]))).toBeNull();
        expect(computeRegressionFit([])).toBeNull();
    });
});

describe('drawings/RegressionChannel', () => {
    it('registers in the channels group with a click-placed pair of anchors', () => {
        expect(getDrawingType('regressionchannel')?.group).toBe('channels');
        const d = createDrawing('regressionchannel', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 4 * HR, price: 0 }] })!;
        expect(d.anchorSchema()).toMatchObject({ min: 2, max: 2 });
    });

    it('fits the band from the bars in range (handles + price span come from the fit, not the anchors)', () => {
        const data = bars([10, 12, 14, 16, 18]);
        const proj = fakeProjector(data);
        // anchors carry arbitrary prices — the fit must ignore them and use the data
        const d = createDrawing('regressionchannel', { paneId: 'price', anchors: [{ time: 0, price: 999 }, { time: 4 * HR, price: -999 }] })! as RegressionChannel;
        const f = d.fit(proj)!;
        expect(f.mid0).toBeCloseTo(10, 6);
        expect(f.mid1).toBeCloseTo(18, 6);
        // handles sit on the midline endpoints (y = 1000 − price)
        expect(d.handlePoints(proj)).toEqual([[0, 990], [4, 982]]);
        // priceRange (autoscale) reflects the fitted band, not the anchor prices
        d.layout(proj); // populate the cached range
        expect(d.priceRange()).toEqual({ min: 10, max: 18 });
    });

    it('defaults: gray midline, green/red bands, R² shown', () => {
        const d = createDrawing('regressionchannel', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 4 * HR, price: 0 }] })! as RegressionChannel;
        expect(d.reg.midColor).toBe('#787b86');
        expect(d.reg.upperColor).toBe('#089981');
        expect(d.reg.lowerColor).toBe('#f23645');
        expect(d.reg.showR2).toBe(true);
    });

    it('round-trips its per-line styling + R² toggle through serialize', () => {
        const d = createDrawing('regressionchannel', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 4 * HR, price: 0 }] })! as RegressionChannel;
        d.applySettings({ 'reg.midColor': '#123456', 'reg.upperStyle': 'dashed', 'reg.lowerFill': '#00000080', 'reg.showR2': false });
        const ser = d.serialize();
        expect(ser.props).toMatchObject({ midColor: '#123456', upperStyle: 'dashed', lowerFill: '#00000080', showR2: false });
        const round = deserializeDrawing(ser) as RegressionChannel;
        expect(round.reg.midColor).toBe('#123456');
        expect(round.reg.upperStyle).toBe('dashed');
        expect(round.reg.showR2).toBe(false);
    });

    it('degrades gracefully when the projector exposes no bar data', () => {
        const noData: Projector = { xOf: (t) => t, yOf: (p) => 1000 - p, pxToPoint: (x, y) => ({ time: x, price: 1000 - y }), paneIdAtY: () => 'price', width: 500, height: 1000 };
        const d = createDrawing('regressionchannel', { paneId: 'price', anchors: [{ time: 0, price: 20 }, { time: 5, price: 40 }] })! as RegressionChannel;
        expect(d.fit(noData)).toBeNull();
        expect(d.layout(noData)).toBeNull();
        // falls back to the raw anchors so the tool is still selectable, and autoscale still gets a range
        expect(d.handlePoints(noData)).toEqual([[0, 980], [5, 960]]);
        expect(d.priceRange()).toEqual({ min: 20, max: 40 });
    });
});
