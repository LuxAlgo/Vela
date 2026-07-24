import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, getDrawingType, buildToolbar, computeVwap, AnchoredVwap, type Projector } from '../src/core/drawings';

const HR = 3600_000;

interface Bar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** Flat OHLC bars (H=L=C=price) with a per-bar volume (default 0), one per hour from t=0. */
function bars(rows: Array<[price: number, volume?: number]>): Bar[] {
    return rows.map(([p, v], i) => ({ time: i * HR, open: p, high: p, low: p, close: p, volume: v ?? 0 }));
}

/** Linear projector (x = time/HR, y = 1000 − price) that serves `data` via barsInRange. */
function fakeProjector(data: Bar[]): Projector {
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

describe('drawings/vwap math', () => {
    it('volume-weights the running average of the typical price', () => {
        // typical price = close here (flat bars). Weighted mean at each step.
        const pts = computeVwap([{ time: 0, high: 10, low: 10, close: 10, volume: 1 }, { time: HR, high: 20, low: 20, close: 20, volume: 3 }], 1)!;
        expect(pts[0]!.mid).toBeCloseTo(10, 10);
        // (10*1 + 20*3) / (1+3) = 70/4 = 17.5
        expect(pts[1]!.mid).toBeCloseTo(17.5, 10);
    });

    it('the first sample has zero band width (no dispersion yet)', () => {
        const pts = computeVwap(bars([[10, 5]]), 2)!;
        expect(pts[0]!.upper).toBeCloseTo(10, 10);
        expect(pts[0]!.lower).toBeCloseTo(10, 10);
    });

    it('the multiplier scales the band half-width linearly', () => {
        const rows = bars([[10, 1], [20, 1], [12, 1], [18, 1]]);
        const one = computeVwap(rows, 1)!;
        const two = computeVwap(rows, 2)!;
        const last = rows.length - 1;
        const half1 = one[last]!.upper - one[last]!.mid;
        const half2 = two[last]!.upper - two[last]!.mid;
        expect(half1).toBeGreaterThan(0);
        expect(half2).toBeCloseTo(half1 * 2, 10);
        // bands are symmetric about the midline
        expect(one[last]!.mid - one[last]!.lower).toBeCloseTo(half1, 10);
    });

    it('falls back to equal weights when the series carries no volume', () => {
        const withZero = computeVwap([{ time: 0, high: 10, low: 10, close: 10, volume: 0 }, { time: HR, high: 20, low: 20, close: 20, volume: 0 }], 1)!;
        // no volume anywhere → simple average: (10 + 20)/2 = 15
        expect(withZero[1]!.mid).toBeCloseTo(15, 10);
    });

    it('returns null with no bars', () => {
        expect(computeVwap([], 1)).toBeNull();
    });
});

describe('drawings/AnchoredVwap', () => {
    it('registers in the measure group as a single-anchor tool', () => {
        expect(getDrawingType('anchoredvwap')?.group).toBe('measure');
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: 0, price: 0 }] })! as AnchoredVwap;
        expect(d.anchorSchema()).toMatchObject({ min: 1, max: 1 });
    });

    it('appears under a Volume section in the Measurements toolbar group', () => {
        const { definition } = buildToolbar(true);
        const measure = definition.groups.find((g) => g.id === 'measurements');
        expect(measure?.sections?.map((s) => s.label)).toEqual(['Measurements', 'Volume']);
        expect(measure?.sections?.find((s) => s.label === 'Volume')?.tools.map((t) => t.type)).toEqual([
            'anchoredvwap',
            'fixedrangevp',
        ]);
    });

    it('computes the curve from the anchor time forward, ignoring the anchor price', () => {
        const data = bars([[10, 1], [20, 1], [30, 1]]);
        const proj = fakeProjector(data);
        // arbitrary anchor price — the VWAP must use the bar data, not the anchor
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: 0, price: 999 }] })! as AnchoredVwap;
        const pts = d.series(proj)!;
        expect(pts).toHaveLength(3);
        expect(pts[0]!.mid).toBeCloseTo(10, 6);
        expect(pts[2]!.mid).toBeCloseTo(20, 6); // (10+20+30)/3
        // the grab handle sits on the curve's anchor end (y = 1000 − mid)
        expect(d.handlePoints(proj)).toEqual([[0, 990]]);
        // autoscale range reflects the computed band, not the anchor price
        const r = d.priceRange()!;
        expect(r.min).toBeLessThanOrEqual(10);
        expect(r.max).toBeGreaterThanOrEqual(20);
    });

    it('a later anchor only accumulates the bars to its right (live re-anchor)', () => {
        const data = bars([[10, 1], [20, 1], [30, 1]]);
        const proj = fakeProjector(data);
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: HR, price: 0 }] })! as AnchoredVwap;
        const pts = d.series(proj)!;
        expect(pts).toHaveLength(2); // bars at t=HR and t=2HR
        expect(pts[0]!.mid).toBeCloseTo(20, 6);
        expect(pts[1]!.mid).toBeCloseTo(25, 6); // (20+30)/2
    });

    it('defaults: #5b9cf6 midline, transparent band edges, translucent fill, ×1 multiplier', () => {
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: 0, price: 0 }] })! as AnchoredVwap;
        expect(d.vwap.midColor).toBe('#5b9cf6');
        expect(d.vwap.upperColor).toBe('#5b9cf600');
        expect(d.vwap.lowerColor).toBe('#5b9cf600');
        expect(d.vwap.bandFill).toBe('#5b9cf633');
        expect(d.vwap.multiplier).toBe(1);
    });

    it('round-trips its styling + multiplier through serialize', () => {
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: 0, price: 0 }] })! as AnchoredVwap;
        d.applySettings({ 'vwap.midColor': '#123456', 'vwap.multiplier': 2.5, 'vwap.bandFill': '#00000080' });
        const ser = d.serialize();
        expect(ser.props).toMatchObject({ midColor: '#123456', multiplier: 2.5, bandFill: '#00000080' });
        const round = deserializeDrawing(ser) as AnchoredVwap;
        expect(round.vwap.midColor).toBe('#123456');
        expect(round.vwap.multiplier).toBe(2.5);
    });

    it('degrades gracefully when the projector exposes no bar data', () => {
        const noData: Projector = { xOf: (t) => t, yOf: (p) => 1000 - p, pxToPoint: (x, y) => ({ time: x, price: 1000 - y }), paneIdAtY: () => 'price', width: 500, height: 1000 };
        const d = createDrawing('anchoredvwap', { paneId: 'price', anchors: [{ time: 0, price: 20 }] })! as AnchoredVwap;
        expect(d.series(noData)).toBeNull();
        expect(d.layout(noData)).toBeNull();
        // falls back to the raw anchor so the tool is still grabbable
        expect(d.handlePoints(noData)).toEqual([[0, 980]]);
    });
});
