import { describe, it, expect } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import { buildVpvrProfile } from '../src/renderers/native/vpvr/profile';

function bar(low: number, high: number, volume: number, up = true, time = 0): OHLCV {
    const open = up ? low : high;
    const close = up ? high : low;
    return { time, open, high, low, close, volume };
}

describe('buildVpvrProfile', () => {
    it('conserves total volume exactly across the rows', () => {
        const bars = [bar(100, 110, 500), bar(103, 118, 750, false), bar(95, 105, 250)];
        const p = buildVpvrProfile(bars, 0, 2, 24, 0.7)!;
        const total = p.rows.reduce((s, r) => s + r.up + r.down, 0);
        expect(total).toBeCloseTo(1500, 6);
    });

    it('splits up/down volume by bar direction', () => {
        // One up bar and one down bar over the SAME range → per-row up == down.
        const bars = [bar(100, 110, 600, true), bar(100, 110, 600, false)];
        const p = buildVpvrProfile(bars, 0, 1, 10, 0.7)!;
        for (const r of p.rows) expect(r.up).toBeCloseTo(r.down, 6);
        expect(p.rows.reduce((s, r) => s + r.up, 0)).toBeCloseTo(600, 6);
    });

    it('puts the POC where the most volume overlaps', () => {
        // Two bars overlap only in [104, 106] — the middle rows carry double volume.
        const bars = [bar(100, 106, 600), bar(104, 110, 600)];
        const p = buildVpvrProfile(bars, 0, 1, 10, 0.7)!;
        const rowH = p.rowH; // (110-100)/10 = 1
        const pocPrice = p.rows[p.poc]!.price;
        expect(rowH).toBeCloseTo(1, 6);
        expect(pocPrice).toBeGreaterThanOrEqual(104 - 1e-9);
        expect(pocPrice + rowH).toBeLessThanOrEqual(106 + 1e-9);
    });

    it('grows the value area around the POC to cover the requested volume fraction', () => {
        const bars = [bar(100, 106, 600), bar(104, 110, 600)];
        const p = buildVpvrProfile(bars, 0, 1, 10, 0.7)!;
        const total = p.rows.reduce((s, r) => s + r.up + r.down, 0);
        let va = 0;
        for (let k = p.vaFrom; k <= p.vaTo; k += 1) va += p.rows[k]!.up + p.rows[k]!.down;
        expect(va).toBeGreaterThanOrEqual(total * 0.7 - 1e-6);
        expect(p.vaFrom).toBeLessThanOrEqual(p.poc);
        expect(p.vaTo).toBeGreaterThanOrEqual(p.poc);
        // Full-coverage request spans every row; zero-coverage collapses to the POC alone.
        const full = buildVpvrProfile(bars, 0, 1, 10, 1)!;
        expect([full.vaFrom, full.vaTo]).toEqual([0, full.rows.length - 1]);
        const none = buildVpvrProfile(bars, 0, 1, 10, 0)!;
        expect([none.vaFrom, none.vaTo]).toEqual([none.poc, none.poc]);
    });

    it('handles a flat (zero-range) window as a single row and skips volumeless bars', () => {
        const flat: OHLCV = { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 400 };
        const noVol: OHLCV = { time: 1, open: 90, high: 120, low: 80, close: 95 }; // volume undefined
        const p = buildVpvrProfile([flat, noVol], 0, 1, 24, 0.7)!;
        expect(p.rows).toHaveLength(1);
        expect(p.rows[0]!.up).toBeCloseTo(400, 6);
        expect(p.maxTotal).toBeCloseTo(400, 6);
    });

    it('returns null when the window holds no volume or no bars', () => {
        const noVol: OHLCV = { time: 0, open: 90, high: 120, low: 80, close: 95 };
        expect(buildVpvrProfile([noVol], 0, 0, 24, 0.7)).toBeNull();
        expect(buildVpvrProfile([], 0, 0, 24, 0.7)).toBeNull();
        expect(buildVpvrProfile([bar(100, 110, 100)], 5, 9, 24, 0.7)).toBeNull(); // window outside the array
    });

    it('a point bar (high == low) lands all volume in its containing row', () => {
        const bars = [bar(100, 110, 1000), { time: 1, open: 105, high: 105, low: 105, close: 105, volume: 5000 } as OHLCV];
        const p = buildVpvrProfile(bars, 0, 1, 10, 0.7)!;
        const k = p.rows.findIndex((r) => 105 >= r.price && 105 < r.price + p.rowH);
        expect(p.poc).toBe(k);
        expect(p.rows[k]!.up).toBeGreaterThanOrEqual(5000);
    });
});
