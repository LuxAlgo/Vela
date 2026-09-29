import { describe, it, expect } from 'vitest';
import {
    barTimeAt,
    clearBar,
    createBook,
    cumulativeDeltaBars,
    foldTrades,
    footprintImbalances,
    levelIndex,
    levelPrice,
    levelSizeFor,
    pruneBefore,
    readBar,
    readBars,
} from '../src/data/tape/footprint';
import type { Trade } from '../src/core/model/tape';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { BarFootprint } from '../src/core/model/orderflow';

const MIN = 60_000;

/** Bars at `barMs` starting at `start`, flat prices (only `time` matters to the book). */
function bars(start: number, count: number, barMs = MIN): OHLCV[] {
    return Array.from({ length: count }, (_, i) => ({
        time: start + i * barMs, open: 1, high: 1, low: 1, close: 1, volume: 0,
    }));
}

function trade(time: number, price: number, size: number, side: 'buy' | 'sell', id?: string): Trade {
    return { time, price, size, side, id };
}

describe('price level bucketing', () => {
    it('levelSizeFor multiplies the tick size by the row count', () => {
        expect(levelSizeFor(0.5, 4)).toBe(2);
        expect(levelSizeFor(0.01, 1)).toBe(0.01);
        expect(levelSizeFor(0.01, 0)).toBe(0.01); // clamped to at least one tick
        expect(levelSizeFor(0, 5)).toBe(5); // no tick size known → 1 per row
    });

    it('levelIndex floors onto the bucket, absorbing binary-float error', () => {
        expect(levelIndex(100, 10)).toBe(10);
        expect(levelIndex(109.99, 10)).toBe(10);
        expect(levelIndex(110, 10)).toBe(11);
        // 0.3 / 0.1 is 2.9999999999999996 in binary floating point — without the epsilon
        // this lands in bucket 2 and the row prints one tick below where it traded.
        expect(levelIndex(0.3, 0.1)).toBe(3);
        expect(levelIndex(-0.05, 0.1)).toBe(-1); // sub-zero prices still floor downward
    });

    it('levelPrice writes the bucket edge at the level size precision', () => {
        expect(levelPrice(3, 0.1)).toBe(0.3); // not 0.30000000000000004
        expect(levelPrice(11, 10)).toBe(110);
        expect(levelPrice(7, 0.005)).toBe(0.035);
    });
});

describe('barTimeAt', () => {
    const b = bars(1_000_000, 5); // 5 one-minute bars

    it('assigns a trade to the bar it falls inside', () => {
        expect(barTimeAt(b, 1_000_000, MIN)).toBe(1_000_000);
        expect(barTimeAt(b, 1_000_000 + MIN - 1, MIN)).toBe(1_000_000);
        expect(barTimeAt(b, 1_000_000 + MIN, MIN)).toBe(1_000_000 + MIN);
        expect(barTimeAt(b, 1_000_000 + 3 * MIN + 5, MIN)).toBe(1_000_000 + 3 * MIN);
    });

    it('drops a trade older than the loaded history, and handles no bars', () => {
        expect(barTimeAt(b, 999_999, MIN)).toBeNull();
        expect(barTimeAt([], 1_000_000, MIN)).toBeNull();
    });

    it('extrapolates past the last bar — the live tape runs ahead of the candle feed', () => {
        const last = 1_000_000 + 4 * MIN;
        expect(barTimeAt(b, last + 10, MIN)).toBe(last); // still inside the forming bar
        expect(barTimeAt(b, last + MIN + 10, MIN)).toBe(last + MIN); // the next bar, not yet delivered
        expect(barTimeAt(b, last + 3 * MIN, MIN)).toBe(last + 3 * MIN);
    });

    it('uses the bars themselves, so a session gap does not shift assignment', () => {
        // Two bars an hour apart (a session break), on a one-minute timeframe.
        const gapped: OHLCV[] = [
            { time: 0, open: 1, high: 1, low: 1, close: 1 },
            { time: 60 * MIN, open: 1, high: 1, low: 1, close: 1 },
        ];
        // A trade 5 minutes after the first bar opens belongs to that bar: epoch bucketing
        // would have invented a bar at minute 5 that the market never printed.
        expect(barTimeAt(gapped, 5 * MIN, MIN)).toBe(0);
        expect(barTimeAt(gapped, 60 * MIN + 30_000, MIN)).toBe(60 * MIN);
    });
});

describe('foldTrades', () => {
    it('splits volume by aggressor side, per price level', () => {
        const book = createBook(1);
        const b = bars(0, 2);
        const touched = foldTrades(book, [
            trade(0, 100.4, 3, 'buy'),
            trade(1, 100.9, 2, 'buy'),
            trade(2, 99.5, 5, 'sell'),
            trade(MIN + 1, 101, 1, 'sell'),
        ], b, MIN);

        expect(touched.sort()).toEqual([0, MIN]);
        const fp = readBar(book, 0)!;
        expect(fp.levels).toEqual([
            { price: 99, buy: 0, sell: 5 },
            { price: 100, buy: 5, sell: 0 }, // 100.4 and 100.9 share the level
        ]);
        expect(fp.buy).toBe(5);
        expect(fp.sell).toBe(5);
        expect(fp.delta).toBe(0);
        expect(fp.volume).toBe(10);
        expect(fp.poc).toBe(99); // 5 vs 5 → the lower level wins the tie
    });

    it('tracks the running delta extremes, not just the total', () => {
        const book = createBook(1);
        const b = bars(0, 1);
        // Delta path: +10 → -5 → 0. Total 0, but the bar ran to +10 and down to -5.
        foldTrades(book, [
            trade(0, 100, 10, 'buy'),
            trade(1, 100, 15, 'sell'),
            trade(2, 100, 5, 'buy'),
        ], b, MIN);
        const fp = readBar(book, 0)!;
        expect(fp.delta).toBe(0);
        expect(fp.deltaHigh).toBe(10);
        expect(fp.deltaLow).toBe(-5);
    });

    it('drops junk prints instead of poisoning a bucket', () => {
        const book = createBook(1);
        const b = bars(0, 1);
        foldTrades(book, [
            trade(0, Number.NaN, 5, 'buy'),
            trade(0, 100, 0, 'buy'),
            trade(0, 100, -3, 'sell'),
            trade(0, 100, Number.POSITIVE_INFINITY, 'buy'),
            trade(0, 100, 2, 'buy'),
        ], b, MIN);
        const fp = readBar(book, 0)!;
        expect(fp.levels).toEqual([{ price: 100, buy: 2, sell: 0 }]);
    });

    it('ignores trades older than the loaded bars', () => {
        const book = createBook(1);
        const b = bars(10 * MIN, 2);
        const touched = foldTrades(book, [trade(0, 100, 5, 'buy')], b, MIN);
        expect(touched).toEqual([]);
        expect(readBars(book)).toEqual([]);
    });
});

describe('reading the book', () => {
    it('coarsens by merging whole levels, keeping totals exact', () => {
        const book = createBook(1); // stored at 1
        const b = bars(0, 1);
        foldTrades(book, [
            trade(0, 100, 1, 'buy'),
            trade(0, 101, 2, 'buy'),
            trade(0, 102, 4, 'sell'),
            trade(0, 105, 8, 'sell'),
        ], b, MIN);

        const fine = readBar(book, 0, 1)!;
        expect(fine.levelSize).toBe(1);
        expect(fine.levels.map((l) => l.price)).toEqual([100, 101, 102, 105]);

        const coarse = readBar(book, 0, 3)!; // levels of 3: [99,102) and [102,105) and [105,108)
        expect(coarse.levelSize).toBe(3);
        expect(coarse.levels).toEqual([
            { price: 99, buy: 3, sell: 0 },
            { price: 102, buy: 0, sell: 4 },
            { price: 105, buy: 0, sell: 8 },
        ]);
        // Coarsening never changes what traded.
        expect(coarse.buy).toBe(fine.buy);
        expect(coarse.sell).toBe(fine.sell);
        expect(coarse.volume).toBe(fine.volume);
        expect(coarse.poc).toBe(105); // 8 is the biggest merged level
    });

    it('readBars returns every bar ascending; prune and clear drop bars', () => {
        const book = createBook(1);
        const b = bars(0, 3);
        foldTrades(book, [
            trade(2 * MIN, 100, 1, 'buy'),
            trade(0, 100, 1, 'buy'),
            trade(MIN, 100, 1, 'buy'),
        ], b, MIN);
        expect(readBars(book).map((f) => f.time)).toEqual([0, MIN, 2 * MIN]);

        clearBar(book, MIN);
        expect(readBars(book).map((f) => f.time)).toEqual([0, 2 * MIN]);
        expect(readBar(book, MIN)).toBeNull();

        pruneBefore(book, 2 * MIN);
        expect(readBars(book).map((f) => f.time)).toEqual([2 * MIN]);
    });
});

/** A footprint literal for the imbalance/CVD tests (totals derived from the levels). */
function footprint(levels: Array<{ price: number; buy: number; sell: number }>, levelSize = 1): BarFootprint {
    const buy = levels.reduce((s, l) => s + l.buy, 0);
    const sell = levels.reduce((s, l) => s + l.sell, 0);
    return {
        time: 0, levelSize, levels, buy, sell,
        delta: buy - sell, volume: buy + sell,
        deltaHigh: Math.max(0, buy - sell), deltaLow: Math.min(0, buy - sell), poc: null,
    };
}

describe('footprintImbalances', () => {
    it('compares diagonally — buyers against the sellers resting one level below', () => {
        const fp = footprint([
            { price: 100, buy: 1, sell: 10 },
            { price: 101, buy: 40, sell: 1 },
        ]);
        const found = footprintImbalances(fp, { ratio: 3 });
        // buy 40 at 101 vs sell 10 at 100 → 4× → flagged.
        expect(found).toContainEqual({ price: 101, side: 'buy', ratio: 4 });
        // sell 10 at 100 vs buy 40 at 101 → 0.25× → not flagged.
        expect(found.some((f) => f.price === 100 && f.side === 'sell')).toBe(false);
    });

    it('flags against an empty neighbour with an infinite ratio', () => {
        const fp = footprint([{ price: 100, buy: 5, sell: 0 }]);
        const found = footprintImbalances(fp, { ratio: 3 });
        expect(found).toEqual([{ price: 100, side: 'buy', ratio: Infinity }]);
    });

    it('minVolume keeps thin levels from flagging', () => {
        const fp = footprint([{ price: 100, buy: 5, sell: 0 }]);
        expect(footprintImbalances(fp, { ratio: 3, minVolume: 10 })).toEqual([]);
    });

    it('a price GAP is not a neighbour — levels must actually adjoin', () => {
        const fp = footprint([
            { price: 100, buy: 0, sell: 30 },
            { price: 105, buy: 20, sell: 0 }, // five levels away
        ]);
        const found = footprintImbalances(fp, { ratio: 3 });
        // 20 at 105 is compared against an EMPTY level 104, not against the 30 at 100.
        expect(found).toContainEqual({ price: 105, side: 'buy', ratio: Infinity });
        expect(found).toContainEqual({ price: 100, side: 'sell', ratio: Infinity });
    });

    it("'level' mode compares the two sides within one level", () => {
        const fp = footprint([{ price: 100, buy: 9, sell: 3 }]);
        expect(footprintImbalances(fp, { ratio: 3, mode: 'level' })).toEqual([
            { price: 100, side: 'buy', ratio: 3 },
        ]);
    });
});

describe('cumulativeDeltaBars', () => {
    /** Footprints carrying an explicit delta path (what the book records per bar). */
    const path = (time: number, delta: number, high: number, low: number): BarFootprint => ({
        time, levelSize: 1, levels: [], buy: Math.max(delta, 0), sell: Math.max(-delta, 0),
        delta, volume: Math.abs(delta), deltaHigh: high, deltaLow: low, poc: null,
    });

    it('carries the running total through open and close', () => {
        const out = cumulativeDeltaBars([path(0, 10, 10, 0), path(MIN, -4, 0, -4), path(2 * MIN, 6, 6, 0)]);
        expect(out.map((b) => [b.open, b.close])).toEqual([[0, 10], [10, 6], [6, 12]]);
    });

    it('takes the extremes from the path inside the bar, not from the total', () => {
        // The bar closes at -1 but ran to +8 first: the candle must show that wick.
        const [bar] = cumulativeDeltaBars([path(0, -1, 8, -3)]);
        expect(bar).toEqual({ time: 0, open: 0, high: 8, low: -3, close: -1 });
    });

    it('brackets high and low around open and close even on an unrecorded path', () => {
        // deltaHigh/deltaLow of 0 (e.g. a bar rebuilt from totals alone) must not produce a
        // candle whose body escapes its own range.
        const [bar] = cumulativeDeltaBars([path(0, 5, 0, 0)]);
        expect(bar!.high).toBe(5);
        expect(bar!.low).toBe(0);
    });

    it('restarts the total where the caller says a new session begins', () => {
        const fps = [path(0, 10, 10, 0), path(MIN, 5, 5, 0), path(2 * MIN, 3, 3, 0)];
        const out = cumulativeDeltaBars(fps, (bar) => bar.time === 2 * MIN);
        expect(out.map((b) => b.close)).toEqual([10, 15, 3]);
        expect(out[2]!.open).toBe(0);
    });
});
