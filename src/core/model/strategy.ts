import type { Millis } from './time';

/**
 * A strategy's broker state at ONE bar — the flat summary a host reads while a script
 * runs. Distinct from {@link TradeExecution}, which is a single order FILL the renderer
 * paints: this is the account, not the drawing.
 *
 * Neutral by design: an engine translates its own vocabulary into these names, so host
 * code reads the same fields whatever language the strategy was written in.
 */
export interface StrategyState {
    /** Signed contracts held (positive = long, negative = short, 0 = flat). */
    position: number;
    /** Average entry price of the open position (0 when flat). */
    avgPrice: number;
    /** Account value: capital + realized + unrealized. */
    equity: number;
    /** Unrealized P&L of the open position. */
    openPnl: number;
    /** Realized P&L, gross profit minus gross loss. */
    netPnl: number;
    grossProfit: number;
    grossLoss: number;
    /** Closed-trade outcome counts. */
    wins: number;
    losses: number;
    even: number;
    /** Largest peak-to-trough equity drop / trough-to-peak rise, in account currency. */
    maxDrawdown: number;
    maxRunup: number;
    initialCapital: number;
}

/**
 * One ROUND TRIP of a strategy: an entry, and the exit that closed it when there is one.
 * Coarser than {@link TradeExecution} (a fill) on purpose — this is what a host tabulates,
 * exports, or reconciles against a broker.
 */
export interface StrategyTrade {
    /** Stable within a run; shared with the fills' `tradeId`. */
    id: string;
    side: 'long' | 'short';
    /** Contracts (magnitude — `side` carries the direction). */
    qty: number;
    entry: StrategyFill;
    /** Absent while the trade is still open. */
    exit?: StrategyFill;
    /** Still open at the last computed bar. */
    open: boolean;
}

/** One side of a {@link StrategyTrade}. */
export interface StrategyFill {
    /** The order id the script used (Pine's `strategy.entry("Long", …)`). */
    id: string;
    time: Millis;
    price: number;
    comment?: string;
}
