import type { Millis } from './time';

/**
 * One price level of a bar's footprint — the volume that traded inside one price
 * bucket, split by which side was the aggressor. A level covers
 * `[price, price + levelSize)`, so `price` is its LOW edge, never a midpoint.
 */
export interface FootprintLevel {
    /** The bucket's low price edge. */
    price: number;
    /** Volume bought at this level (takers lifting the ask). */
    buy: number;
    /** Volume sold at this level (takers hitting the bid). */
    sell: number;
}

/**
 * One bar's footprint: the price levels that traded inside it, plus the totals every
 * order-flow readout is derived from. Reported per bar open time, so it lines up with
 * `OHLCV.time` and with everything else keyed on a bar.
 *
 * The level totals come from the TAPE while `OHLCV.volume` comes from the venue's own
 * candle. The two agree closely but not exactly — a venue may revise a candle, and a
 * tape window can be served short — so a reading that must tie out to the candle should
 * use the candle.
 */
export interface BarFootprint {
    /** Bar open time (epoch ms). */
    time: Millis;
    /** Price height of one level, in quote units. */
    levelSize: number;
    /** Only the levels that traded, ascending by price. */
    levels: readonly FootprintLevel[];
    /** Total buy (ask-side) volume in the bar. */
    buy: number;
    /** Total sell (bid-side) volume in the bar. */
    sell: number;
    /** `buy - sell`: the bar's delta. */
    delta: number;
    /** `buy + sell`: the bar's tape volume. */
    volume: number;
    /**
     * Highest value the bar's RUNNING delta reached, counted from 0 at the bar's first
     * print. Never below 0 on a bar whose first print was a buy, never above 0 on one
     * that only sold — it is an extreme of the path, not of the total. This is what
     * gives a cumulative-delta candle its high.
     */
    deltaHigh: number;
    /** Lowest value the bar's running delta reached (see {@link deltaHigh}). */
    deltaLow: number;
    /**
     * Price of the highest-volume level — the bar's point of control. Null on a bar with
     * no prints. A tie goes to the LOWER level, so the value is stable across rebuilds.
     */
    poc: number | null;
}

/**
 * A level flagged as IMBALANCED: one side's volume overwhelmed the other by at least the
 * configured ratio. `side` names the aggressor that dominated — `'buy'` marks buyers
 * paying up into the level, `'sell'` sellers pressing into it.
 */
export interface FootprintImbalance {
    /** The low price edge of the flagged level (matches {@link FootprintLevel.price}). */
    price: number;
    side: 'buy' | 'sell';
    /** The dominant side's volume divided by the compared side's (Infinity when that side is empty). */
    ratio: number;
}

/**
 * One bar of a cumulative-delta series, shaped like a candle so it can be read the same
 * way price is: `open` is the running total carried in from the previous bar, `close` the
 * total carried out, and `high`/`low` the extremes the total reached inside the bar.
 */
export interface CumulativeDeltaBar {
    /** Bar open time (epoch ms). */
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
}
