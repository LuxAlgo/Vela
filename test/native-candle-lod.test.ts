import { describe, it, expect } from 'vitest';
import { candleTier, bodyWidth, candleGeometry, aggregateCandleColumns, CANDLE_AGG_MAX_SPACING, CANDLE_BODY_MIN_SPACING } from '../src/renderers/native/backend/candle-lod';
import type { OHLCV } from '../src/core/model/ohlcv';

describe('native candle LOD tiers', () => {
    it('draws a full body when bars are wide enough', () => {
        expect(candleTier(CANDLE_BODY_MIN_SPACING)).toBe('full');
        expect(candleTier(8)).toBe('full');
        expect(candleTier(120)).toBe('full');
    });

    it('drops the body (wick-only) between the aggregate and body thresholds', () => {
        expect(candleTier(CANDLE_AGG_MAX_SPACING)).toBe('wick');
        expect(candleTier(1.5)).toBe('wick');
        expect(candleTier(CANDLE_BODY_MIN_SPACING - 0.001)).toBe('wick');
    });

    it('aggregates per pixel column below the sub-pixel threshold', () => {
        expect(candleTier(CANDLE_AGG_MAX_SPACING - 0.001)).toBe('aggregate');
        expect(candleTier(0.5)).toBe('aggregate');
    });

    it('keeps the thresholds ordered', () => {
        expect(CANDLE_AGG_MAX_SPACING).toBeLessThan(CANDLE_BODY_MIN_SPACING);
    });
});

describe('candle body width', () => {
    const dprs = [1, 1.5, 2, 3];

    it('pins the body to 3 CSS px at 2.5–4 px spacing so a 1px border still shows fill', () => {
        for (const dpr of dprs) {
            for (const s of [2.5, 3, 3.5, 4]) expect(bodyWidth(s, dpr)).toBe(Math.floor(3 * dpr));
        }
    });

    it('nearly fills the spacing just past the pin and eases to ~0.8 of it at wide zoom', () => {
        expect(bodyWidth(4.01, 1)).toBe(4);
        expect(bodyWidth(4.01, 2)).toBe(8);
        expect(bodyWidth(8, 10) / 80).toBeCloseTo(0.85, 2);
        expect(bodyWidth(40, 1) / 40).toBeCloseTo(0.8, 1);
        expect(bodyWidth(400, 1) / 400).toBeCloseTo(0.8, 2);
    });

    it('never exceeds the spacing outside the pin band and never drops below a device pixel', () => {
        for (const dpr of dprs) {
            for (let s = CANDLE_AGG_MAX_SPACING; s <= 40; s += 0.25) {
                const w = bodyWidth(s, dpr);
                expect(w).toBeGreaterThanOrEqual(Math.max(1, Math.floor(dpr)));
                if (s < 2.5 || s > 4) expect(w).toBeLessThanOrEqual(Math.floor(s * dpr));
            }
        }
    });

    it('leaves fill visible inside a 1 CSS px border at every body-tier spacing (no border-only sticks)', () => {
        // The regression: zoomed out to 3–4 px spacing the old 0.7·spacing body was 2 px
        // wide, which the border covered completely.
        for (const dpr of dprs) {
            for (let s = 2.5; s <= 40; s += 0.25) {
                const g = candleGeometry(5, s, dpr);
                expect(g.bodyW - 2).toBeGreaterThan(0);
            }
        }
    });
});

describe('candle geometry (device-pixel snapping)', () => {
    const dprs = [1, 1.5, 2, 3];
    const spacings = [3, 3.5, 4, 4.7, 5, 6.3, 8, 12.5, 20];

    it('keeps the wick exactly centered in the body at every zoom and dpr', () => {
        for (const dpr of dprs) {
            for (const spacing of spacings) {
                for (let x = 0; x < 40; x += spacing / 3 + 0.137) {
                    const g = candleGeometry(x, spacing, dpr);
                    const wickCenter = g.wickX + g.wickW / 2;
                    const bodyCenter = g.bodyX + g.bodyW / 2;
                    expect(bodyCenter).toBeCloseTo(wickCenter, 9);
                    expect(g.center).toBeCloseTo(wickCenter, 9);
                }
            }
        }
    });

    it('lands every edge on the device-pixel grid (crisp, no half-covered columns)', () => {
        for (const dpr of dprs) {
            for (const spacing of spacings) {
                const g = candleGeometry(7.3, spacing, dpr);
                for (const edge of [g.wickX, g.wickX + g.wickW, g.bodyX, g.bodyX + g.bodyW]) {
                    const dev = edge * dpr;
                    expect(Math.abs(dev - Math.round(dev))).toBeLessThan(1e-6);
                }
            }
        }
    });

    it('gives every candle the same body width (uniform gaps within a device pixel)', () => {
        for (const dpr of dprs) {
            for (const spacing of spacings) {
                const widths = new Set<number>();
                const centerError: number[] = [];
                for (let i = 0; i < 50; i += 1) {
                    const x = i * spacing + 0.31; // fractional phase, like a panned viewport
                    const g = candleGeometry(x, spacing, dpr);
                    widths.add(g.bodyW);
                    centerError.push(Math.abs(g.center - x));
                }
                expect(widths.size).toBe(1); // constant width ⇒ gap variation comes only from center snapping
                for (const err of centerError) expect(err).toBeLessThanOrEqual(0.5 / dpr + 1e-6); // snap ≤ half a device px
            }
        }
    });

    it('never makes the body narrower than the wick', () => {
        for (const dpr of dprs) {
            for (const spacing of spacings) {
                const g = candleGeometry(5, spacing, dpr);
                expect(g.bodyW).toBeGreaterThanOrEqual(g.wickW);
            }
        }
    });
});

describe('aggregateCandleColumns (sub-pixel LOD bucketing)', () => {
    const bar = (time: number, open: number, high: number, low: number, close: number): OHLCV => ({ time, open, high, low, close, volume: 0 });
    // 10 px per price unit, chart top at price 100 — plenty of resolution for the void checks.
    const yOf = (price: number): number => (100 - price) * 10;
    const oneColumn = (): number => 0;
    // The backends' paint resolution, reduced to its direction fallback.
    const dirColor = (b: OHLCV): string => (b.close >= b.open ? 'up' : 'down');

    it('collapses a column of overlapping same-color bars into ONE min-to-max stick', () => {
        const bars = [bar(1, 10, 12, 9, 11), bar(2, 11, 13, 10, 12), bar(3, 12, 14, 11, 13)];
        const sticks = aggregateCandleColumns(bars, 0, 2, oneColumn, yOf, dirColor);
        expect(sticks).toEqual([{ x: 0, hi: 14, lo: 9, color: 'up' }]);
    });

    it('keeps a PRICE GAP inside a column as a void — two sticks, never one solid span', () => {
        // The regression: the bars around a large price jump land in the same pixel
        // column once zoomed far out; a single min-to-max stick would paint the void.
        const bars = [bar(1, 10, 12, 9, 11), bar(2, 40, 42, 39, 41)];
        const sticks = aggregateCandleColumns(bars, 0, 1, oneColumn, yOf, dirColor);
        expect(sticks).toEqual([
            { x: 0, hi: 12, lo: 9, color: 'up' },
            { x: 0, hi: 42, lo: 39, color: 'up' },
        ]);
    });

    it('coalesces a SUB-PIXEL void — an invisible gap is not worth a second stick', () => {
        // 0.05 price units = 0.5 px: below one pixel, the runs merge back into one.
        const bars = [bar(1, 10, 12, 9, 11), bar(2, 12.1, 12.15, 12.05, 12.1)];
        const sticks = aggregateCandleColumns(bars, 0, 1, oneColumn, yOf, dirColor);
        expect(sticks).toEqual([{ x: 0, hi: 12.15, lo: 9, color: 'up' }]);
    });

    it('a later bar bridging two disjoint same-color runs merges them', () => {
        const bars = [bar(1, 10, 12, 9, 11), bar(2, 40, 42, 39, 41), bar(3, 25, 41, 10, 30)];
        const sticks = aggregateCandleColumns(bars, 0, 2, oneColumn, yOf, dirColor);
        expect(sticks).toEqual([{ x: 0, hi: 42, lo: 9, color: 'up' }]);
    });

    it('emits one stick per pixel column and skips holes and zero-range bars', () => {
        const bars: Array<OHLCV | undefined> = [
            bar(1, 10, 12, 9, 11),
            bar(2, 11, 13, 10, 12),
            undefined,
            bar(4, 20, 20, 20, 20), // zero-range: skipped
            bar(5, 30, 32, 29, 31),
        ];
        // Two bars in column 0, the last one in column 1.
        const xOf = (i: number): number => (i < 2 ? 0 : 1);
        const sticks = aggregateCandleColumns(bars, 0, 4, xOf, yOf, dirColor);
        expect(sticks).toEqual([
            { x: 0, hi: 13, lo: 9, color: 'up' },
            { x: 1, hi: 32, lo: 29, color: 'up' },
        ]);
    });

    it('sticks carry their OWN bars\u2019 color (a gap-up column colors each side by its bars)', () => {
        // Below the gap: a down bar (open 12 → close 10). Above: an up bar (40 → 42).
        const bars = [bar(1, 12, 13, 9, 10), bar(2, 40, 43, 39, 42)];
        const sticks = aggregateCandleColumns(bars, 0, 1, oneColumn, yOf, dirColor);
        expect(sticks.find((s) => s.hi === 13)!.color).toBe('down');
        expect(sticks.find((s) => s.hi === 43)!.color).toBe('up');
    });

    it('a down bar\u2019s long wick keeps the down color when an up bar shares its column', () => {
        // The regression: zoomed in, a down bar with a deep lower wick is red; once the
        // tall up bar right after it lands in the same pixel column, one merged
        // first-open→last-close stick turns the whole wick green. Bars of different
        // colors must stay separate sticks, each covering only its own bars' range.
        const down = bar(1, 94.4, 94.5, 82, 94.1); // wick down to 82
        const up = bar(2, 94.1, 100.2, 94.05, 100.1); // recovery, barely overlapping the down bar
        const sticks = aggregateCandleColumns([down, up], 0, 1, oneColumn, yOf, dirColor);
        expect(sticks).toEqual([
            { x: 0, hi: 94.5, lo: 82, color: 'down' },
            { x: 0, hi: 100.2, lo: 94.05, color: 'up' },
        ]);
    });

    it('paints a column\u2019s sticks latest-bar-last so the newest bar wins where colors overlap', () => {
        // An up bar fully inside an earlier down bar's range: both sticks exist, the up
        // one comes out AFTER (drawn on top), as sequential per-bar drawing would give.
        const bars = [bar(1, 20, 30, 10, 15), bar(2, 18, 22, 16, 21)];
        const sticks = aggregateCandleColumns(bars, 0, 1, oneColumn, yOf, dirColor);
        expect(sticks.map((s) => s.color)).toEqual(['down', 'up']);
        // Reverse the time order and the down bar paints on top instead.
        const flipped = aggregateCandleColumns([bars[1]!, bars[0]!], 0, 1, oneColumn, yOf, dirColor);
        expect(flipped.map((s) => s.color)).toEqual(['up', 'down']);
    });

    it('groups by the RESOLVED paint, so a barcolor()ed bar forms its own run', () => {
        const bars = [bar(1, 10, 12, 9, 11), bar(2, 11, 13, 10, 12), bar(3, 12, 14, 11, 13)];
        const tinted = (b: OHLCV): string => (b.time === 2 ? '#ff0' : dirColor(b));
        const sticks = aggregateCandleColumns(bars, 0, 2, oneColumn, yOf, tinted);
        expect(sticks).toEqual([
            { x: 0, hi: 13, lo: 10, color: '#ff0' },
            { x: 0, hi: 14, lo: 9, color: 'up' }, // bars 1 and 3 bridge across bar 2's range
        ]);
    });
});
