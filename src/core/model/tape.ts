import type { Millis } from './time';

/**
 * Which side INITIATED an execution — the aggressor, never the resting order. `'buy'`
 * means a taker lifted the ask; `'sell'` means a taker hit the bid. Every order-flow
 * measure Vela derives (footprint clusters, delta, cumulative delta) is a signed sum
 * over this one field, so a venue that publishes only the MAKER side must invert it
 * before emitting — a provider that gets this backwards inverts every reading built
 * on top of it.
 */
export type TradeSide = 'buy' | 'sell';

/**
 * One execution off the tape — the atom every order-flow view is built from. Providers
 * emit these through `getTrades` / `subscribeTrades`; the aggregation layer folds them
 * into per-bar price clusters.
 *
 * A venue that publishes AGGREGATED prints (one row per taker order, filled across
 * several resting makers) may emit those rows as they are: the aggregation preserves
 * price, side and volume, which is everything the clusters and the delta read.
 */
export interface Trade {
    /** Execution time, epoch ms. */
    time: Millis;
    price: number;
    /**
     * Quantity in the BASE asset — the same unit as `OHLCV.volume`, so a bar's total
     * and its cluster totals are comparable (they will not match to the last decimal:
     * a bar's volume comes from the venue's own candle, the clusters from the tape).
     */
    size: number;
    side: TradeSide;
    /**
     * The venue's trade id, where it offers one that is monotonic per symbol. It is
     * what lets the history walk and the live stream de-duplicate at their seam — both
     * deliver the trades around the moment a subscription opens. Absent ⇒ consumers
     * fall back to matching on time + price + size, which is weaker: two genuinely
     * identical prints in the same millisecond collapse into one.
     */
    id?: string;
}
