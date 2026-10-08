// Price-action tools: a fair value gap, an order block and a liquidity level are each placed on
// one candle, found on the candles around it, and followed as price comes back — each runs right
// until the event the user picked (tested, half-filled, filled, broken, swept), then marks it.
import { describe, it, expect } from 'vitest';
import {
    blockState,
    buildToolbar,
    createDrawing,
    gapAt,
    gapState,
    liquidityState,
    nearestBarIndex,
    nearestGap,
    type FairValueGap,
    type Liquidity,
    type OrderBlock,
    type PriceActionBar,
    type Projector,
} from '../src/core/drawings';

const MIN5 = 300_000;
/** Candles from [open, high, low, close] rows, five minutes apart. */
function candles(rows: ReadonlyArray<readonly [number, number, number, number]>): PriceActionBar[] {
    return rows.map(([open, high, low, close], i) => ({ time: i * MIN5, open, high, low, close }));
}

// A bullish gap at bar 2: bar 1's high (102) stays below bar 3's low (104).
const GAP_UP = candles([
    [100, 101, 99, 100.5],
    [100.5, 102, 100, 101.8], // 1
    [101.8, 106, 100.8, 105.5], // 2 — the displacement candle
    [105.5, 107, 104, 106.5], // 3
    [106.5, 107.5, 104.5, 107], // 4
    [107, 107.2, 103.5, 104], // 5 — trades into the gap (top 104)
    [104, 106, 102.8, 103], // 6 — past halfway (103)
    [103, 104, 101.5, 101.8], // 7 — through the bottom (102): filled, and closes below it
    [101.8, 103, 101, 101.2], // 8
]);

/** x = time / 5 min · 10 px, y = 300 − price · 2. */
const proj = (bars: readonly PriceActionBar[]): Projector => ({
    xOf: (t) => (t / MIN5) * 10,
    yOf: (price, paneId) => (paneId === 'price' ? 300 - price * 2 : null),
    pxToPoint: (x, y) => ({ time: (x / 10) * MIN5, price: (300 - y) / 2 }),
    paneIdAtY: () => 'price',
    width: 400,
    height: 300,
    barsInRange: (from, to) => bars.filter((b) => b.time >= from && b.time <= to),
});

describe('finding the formation on the candles', () => {
    it('a bullish fair value gap is the space between the first candle’s high and the third candle’s low', () => {
        expect(gapAt(GAP_UP, 2)).toEqual({ bull: true, top: 104, bottom: 102 });
        expect(gapAt(GAP_UP, 1)).toBeNull();
    });

    it('a click a candle or two off still finds the nearest gap', () => {
        expect(nearestGap(GAP_UP, 4)?.index).toBe(2);
        expect(nearestGap(GAP_UP, 8, 1)).toBeNull();
    });

    it('a click between candles lands on the nearest one', () => {
        expect(nearestBarIndex(GAP_UP, 2 * MIN5 + MIN5 * 0.4)).toBe(2);
        expect(nearestBarIndex(GAP_UP, 2 * MIN5 + MIN5 * 0.6)).toBe(3);
        expect(nearestBarIndex(GAP_UP, -1e9)).toBe(0);
        expect(nearestBarIndex(GAP_UP, 1e12)).toBe(GAP_UP.length - 1);
    });
});

describe('a fair value gap follows price back into it', () => {
    it('it records when price tested it, reached its halfway line, filled it, and closed through it', () => {
        const s = gapState(GAP_UP, 2, 'filled')!;
        expect([s.tested, s.half, s.filled, s.inverted]).toEqual([5, 6, 7, 7]);
        expect(s.mid).toBe(103);
    });

    it('each extension stops the gap at its own event, or runs on', () => {
        expect(gapState(GAP_UP, 2, 'tested')!.end).toBe(5);
        expect(gapState(GAP_UP, 2, 'half')!.end).toBe(6);
        expect(gapState(GAP_UP, 2, 'filled')!.end).toBe(7);
        expect(gapState(GAP_UP, 2, 'always')!.end).toBeNull();
    });

    it('on the chart it spans from the first candle to the fill, with its halfway line and a dot where it filled', () => {
        const d = createDrawing('fairvaluegap', { paneId: 'price', anchors: [{ time: 2 * MIN5, price: 103 }] }) as FairValueGap;
        const z = d.zone(proj(GAP_UP))!;
        expect(z.x1).toBe(5); // bar 1's left edge
        expect(z.x2).toBe(75); // bar 7's right edge
        expect([z.yTop, z.yBottom]).toEqual([300 - 104 * 2, 300 - 102 * 2]);
        expect(z.midY).toBe(300 - 103 * 2);
        expect(z.marker).toEqual({ x: 70, y: 300 - 102 * 2 });
        expect(z.faded).toBe(true);
        expect(d.hitTest(40, 300 - 103 * 2, proj(GAP_UP), 2)).toBe(true);
        expect(d.hitTest(90, 300 - 103 * 2, proj(GAP_UP), 2)).toBe(false);
    });

    it('set to flip, a filled gap that price closed through carries on the other way', () => {
        const d = createDrawing('fairvaluegap', { paneId: 'price', anchors: [{ time: 2 * MIN5, price: 103 }], props: { inverse: true } }) as FairValueGap;
        const z = d.zone(proj(GAP_UP))!;
        expect(z.flip).not.toBeNull();
        expect(z.flip!.x1).toBe(65);
        expect(z.flip!.fill).toBe(d.gap.downColor);
        expect(z.faded).toBe(false);
    });

    it('with no gap near the candle there is nothing to draw', () => {
        const d = createDrawing('fairvaluegap', { paneId: 'price', anchors: [{ time: 8 * MIN5, price: 101 }] }) as FairValueGap;
        expect(d.zone(proj(GAP_UP))).toBeNull();
    });
});

// A down-close candle at bar 1 (a bullish block: body 98–100), then price leaves, returns and breaks.
const BLOCK = candles([
    [99, 100, 98.5, 99.5],
    [100, 100.5, 97.5, 98], // 1 — the block (body 98–100, range 97.5–100.5)
    [98, 103, 97.8, 102.5], // 2 — still touching the block
    [102.5, 105, 101, 104.5], // 3 — clear of it (low 101 > top 100)
    [104.5, 105, 99.5, 100.5], // 4 — back into it (low 99.5 ≤ 100)
    [100.5, 101, 98.8, 99], // 5 — past halfway (99)
    [99, 99.2, 96, 96.5], // 6 — closes below the bottom (98): broken
    [96.5, 97.5, 95, 97], // 7 — below the block
    [97, 98.5, 96.5, 98.2], // 8 — back up into it from below: the breaker is retested
]);

describe('an order block', () => {
    it('a down-close candle marks demand; its body is the zone unless the full range is chosen', () => {
        expect(blockState(BLOCK, 1, 'body', 'broken')).toMatchObject({ bull: true, top: 100, bottom: 98 });
        expect(blockState(BLOCK, 1, 'wick', 'broken')).toMatchObject({ top: 100.5, bottom: 97.5 });
    });

    it('tests count only after price has left the block; then it is tested, half-filled, broken and retested', () => {
        const s = blockState(BLOCK, 1, 'body', 'broken')!;
        expect([s.tested, s.half, s.broken, s.retest]).toEqual([4, 5, 6, 8]);
    });

    it('once broken it can carry on as a breaker, the other way, until price returns to it', () => {
        const d = createDrawing('orderblock', { paneId: 'price', anchors: [{ time: MIN5, price: 99 }] }) as OrderBlock;
        const z = d.zone(proj(BLOCK))!;
        expect(z.x2).toBe(65); // stopped at the break
        expect(z.flip).toMatchObject({ x1: 55, x2: 85 });
        expect(z.flip!.fill).toBe(d.block.downColor);
        d.applySettings({ 'block.breaker': false });
        expect(d.zone(proj(BLOCK))!.flip).toBeNull();
    });
});

// A swing high at bar 2 (high 105), swept by bar 5's wick, closed above by bar 7.
const SWEEP = candles([
    [100, 101, 99, 100.5],
    [100.5, 103, 100, 102.5],
    [102.5, 105, 102, 103], // 2 — the high
    [103, 103.5, 100, 100.5],
    [100.5, 102, 99.5, 101.5],
    [101.5, 105.6, 101, 104], // 5 — wicks above 105 and closes back below: a sweep
    [104, 104.8, 102, 103],
    [103, 106, 102.5, 105.5], // 7 — closes above: broken
]);

describe('a liquidity level', () => {
    it('it rests above the high and is taken by the first wick through it, broken by the first close beyond', () => {
        const s = liquidityState(SWEEP, 2, 'high', 'swept')!;
        expect([s.price, s.swept, s.broken, s.end]).toEqual([105, 5, 7, 5]);
        expect(liquidityState(SWEEP, 2, 'high', 'broken')!.end).toBe(7);
    });

    it('a click nearer the candle’s high sets buy-side liquidity, nearer its low sell-side', () => {
        const hi = createDrawing('liquidity', { paneId: 'price', anchors: [{ time: 2 * MIN5, price: 104.5 }] }) as Liquidity;
        const lo = createDrawing('liquidity', { paneId: 'price', anchors: [{ time: 2 * MIN5, price: 102.2 }] }) as Liquidity;
        expect(hi.state(proj(SWEEP))).toMatchObject({ high: true, price: 105 });
        expect(lo.state(proj(SWEEP))).toMatchObject({ high: false, price: 102 });
    });

    it('the line runs to the sweep, which is marked just past the sweeping wick', () => {
        const d = createDrawing('liquidity', { paneId: 'price', anchors: [{ time: 2 * MIN5, price: 104.5 }] }) as Liquidity;
        const l = d.line(proj(SWEEP))!;
        expect([l.x1, l.x2, l.y]).toEqual([20, 55, 300 - 105 * 2]);
        expect(l.sweep).toEqual({ x: 50, y: 300 - 105.6 * 2 - 9 });
        expect(d.hitTest(40, l.y, proj(SWEEP), 3)).toBe(true);
    });
});

describe('the price action tools in the toolbar and their settings', () => {
    it('they sit in their own Price Action section of the Fibonacci flyout, just above Gann', () => {
        const fib = buildToolbar(true).definition.groups.find((g) => g.id === 'fibonacci-gann')!;
        const labels = fib.sections!.map((s) => s.label);
        expect(labels.indexOf('Price Action')).toBe(labels.indexOf('Gann') - 1);
        expect(fib.sections!.find((s) => s.label === 'Price Action')!.tools.map((t) => t.label)).toEqual(['Fair Value Gap', 'Order Block', 'Liquidity']);
    });

    it('their settings survive a save and a restore', () => {
        const d = createDrawing('fairvaluegap', { paneId: 'price', anchors: [{ time: 0, price: 1 }] }) as FairValueGap;
        d.applySettings({ 'gap.extend': 'half', 'gap.border': true, 'gap.upColor': '#00ff0040' });
        const back = createDrawing('fairvaluegap', { ...d.serialize(), paneId: 'price' }) as FairValueGap;
        expect(back.gap).toMatchObject({ extend: 'half', border: true, upColor: '#00ff0040' });
    });

    it('a saved document with unknown values falls back to the defaults', () => {
        const d = createDrawing('orderblock', { paneId: 'price', anchors: [{ time: 0, price: 1 }], props: { extend: 'nope', range: 7, border: 'yes' } }) as OrderBlock;
        expect(d.block).toMatchObject({ extend: 'broken', range: 'body', border: true });
    });

    it('options that matter only in some modes say which', () => {
        const d = createDrawing('fairvaluegap', { paneId: 'price', anchors: [{ time: 0, price: 1 }] })!;
        expect(d.schema().fields.find((f) => f.path === 'gap.inverse')?.when).toEqual({ path: 'gap.extend', in: ['filled'] });
    });
});
