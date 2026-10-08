/**
 * Price-action analysis for the zone and level tools (fair value gap, order block, liquidity):
 * where a formation sits on the candles, and when price later tests, half-fills, fills, breaks
 * or sweeps it. Pure functions over ascending OHLC bars, so a tool recomputes as bars arrive.
 * Every event is the index of the bar it happened on, or null when it has not happened yet.
 */

/** The candle fields the analysis reads. */
export interface PriceActionBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

/** How far right a zone runs: to the bar of an event, or on to the latest candle. */
export type GapExtend = 'tested' | 'half' | 'filled' | 'always';
export type BlockExtend = 'tested' | 'half' | 'broken' | 'always';
export type LiquidityExtend = 'swept' | 'broken' | 'always';

/** The bar whose open time is closest to `time` (bars ascending), or -1 with no bars. */
export function nearestBarIndex(bars: readonly PriceActionBar[], time: number): number {
    if (bars.length === 0) return -1;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid]!.time < time) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(bars[lo - 1]!.time - time) <= Math.abs(bars[lo]!.time - time)) return lo - 1;
    return lo;
}

/** A gap left by the candle at `i` (the middle of three): bullish when the next candle's low
 *  stays above the previous one's high, bearish when its high stays below the previous low. */
export function gapAt(bars: readonly PriceActionBar[], i: number): { bull: boolean; top: number; bottom: number } | null {
    const prev = bars[i - 1];
    const next = bars[i + 1];
    if (!prev || !next || !bars[i]) return null;
    if (next.low > prev.high) return { bull: true, top: next.low, bottom: prev.high };
    if (next.high < prev.low) return { bull: false, top: prev.low, bottom: next.high };
    return null;
}

/** The gap at the candle at `i`, or at the nearest candle within `reach` bars that left one. */
export function nearestGap(bars: readonly PriceActionBar[], i: number, reach = 3): { index: number; bull: boolean; top: number; bottom: number } | null {
    for (let k = 0; k <= reach; k += 1) {
        for (const j of k === 0 ? [i] : [i - k, i + k]) {
            const g = gapAt(bars, j);
            if (g) return { index: j, ...g };
        }
    }
    return null;
}

export interface GapState {
    /** The middle candle of the three. */
    index: number;
    bull: boolean;
    top: number;
    bottom: number;
    /** The gap's halfway price. */
    mid: number;
    /** Price first traded back into the gap. */
    tested: number | null;
    /** Price reached the gap's halfway line. */
    half: number | null;
    /** Price traded through the whole gap. */
    filled: number | null;
    /** After filling, a candle closed beyond the gap's far side: it now works the other way. */
    inverted: number | null;
    /** The bar the zone stops at for the chosen extension, or null to run on. */
    end: number | null;
}

/** A fair value gap around the candle at (or near) `i`, and what price has done to it since. */
export function gapState(bars: readonly PriceActionBar[], i: number, extend: GapExtend): GapState | null {
    const g = nearestGap(bars, i);
    if (!g) return null;
    const { index, bull, top, bottom } = g;
    const mid = (top + bottom) / 2;
    let tested: number | null = null;
    let half: number | null = null;
    let filled: number | null = null;
    let inverted: number | null = null;
    for (let j = index + 2; j < bars.length; j += 1) {
        const b = bars[j]!;
        const reach = bull ? b.low : b.high;
        const into = (v: number): boolean => (bull ? reach <= v : reach >= v);
        if (tested === null && into(bull ? top : bottom)) tested = j;
        if (half === null && into(mid)) half = j;
        if (filled === null && into(bull ? bottom : top)) filled = j;
        if (filled !== null && inverted === null && (bull ? b.close < bottom : b.close > top)) inverted = j;
        if (inverted !== null) break;
    }
    const end = extend === 'tested' ? tested : extend === 'half' ? half : extend === 'filled' ? filled : null;
    return { index, bull, top, bottom, mid, tested, half, filled, inverted, end };
}

export interface BlockState {
    index: number;
    /** A down-close candle marks demand (a bullish block); an up-close one supply. */
    bull: boolean;
    top: number;
    bottom: number;
    mid: number;
    /** Price came back into the block after leaving it. */
    tested: number | null;
    /** Price reached the block's halfway line. */
    half: number | null;
    /** A candle closed through the block's far side. */
    broken: number | null;
    /** After the break, price returned to the block from the other side. */
    retest: number | null;
    end: number | null;
}

/** An order block on the candle at `i` — its body, or its whole range — and what price has
 *  done to it since. Tests only count once price has first left the block. */
export function blockState(bars: readonly PriceActionBar[], i: number, range: 'body' | 'wick', extend: BlockExtend): BlockState | null {
    const c = bars[i];
    if (!c) return null;
    const bull = c.close < c.open;
    const top = range === 'body' ? Math.max(c.open, c.close) : c.high;
    const bottom = range === 'body' ? Math.min(c.open, c.close) : c.low;
    const mid = (top + bottom) / 2;
    let left = false;
    let tested: number | null = null;
    let half: number | null = null;
    let broken: number | null = null;
    let leftAfterBreak = false;
    let retest: number | null = null;
    for (let j = i + 1; j < bars.length; j += 1) {
        const b = bars[j]!;
        if (!left) {
            left = bull ? b.low > top : b.high < bottom;
            continue;
        }
        if (broken === null) {
            if (tested === null && (bull ? b.low <= top : b.high >= bottom)) tested = j;
            if (half === null && (bull ? b.low <= mid : b.high >= mid)) half = j;
            if (bull ? b.close < bottom : b.close > top) broken = j;
            continue;
        }
        if (!leftAfterBreak) {
            leftAfterBreak = bull ? b.high < bottom : b.low > top;
            continue;
        }
        if (bull ? b.high >= bottom : b.low <= top) {
            retest = j;
            break;
        }
    }
    const end = extend === 'tested' ? tested : extend === 'half' ? half : extend === 'broken' ? broken : null;
    return { index: i, bull, top, bottom, mid, tested, half, broken, retest, end };
}

export interface LiquidityState {
    index: number;
    /** Resting above a high (true) or below a low. */
    high: boolean;
    price: number;
    /** A candle traded through the level. */
    swept: number | null;
    /** A candle closed beyond the level. */
    broken: number | null;
    end: number | null;
}

/** Liquidity resting beyond the high or low of the candle at `i`, and when price took it. */
export function liquidityState(bars: readonly PriceActionBar[], i: number, side: 'high' | 'low', extend: LiquidityExtend): LiquidityState | null {
    const c = bars[i];
    if (!c) return null;
    const high = side === 'high';
    const price = high ? c.high : c.low;
    let swept: number | null = null;
    let broken: number | null = null;
    for (let j = i + 1; j < bars.length && broken === null; j += 1) {
        const b = bars[j]!;
        if (swept === null && (high ? b.high > price : b.low < price)) swept = j;
        if (high ? b.close > price : b.close < price) broken = j;
    }
    const end = extend === 'swept' ? swept : extend === 'broken' ? broken : null;
    return { index: i, high, price, swept, broken, end };
}
