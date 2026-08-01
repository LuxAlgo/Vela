import type { Millis } from './time';

/**
 * One order execution of a strategy indicator — the unit painted on the chart as a
 * trade marker (direction arrow + optional label/quantity text + a tick at the exact
 * fill price). Executions anchor to their FILL bar and always render on the PRICE
 * pane, whatever pane the indicator's plots landed on: a fill price only means
 * something on the price scale.
 */
export interface TradeExecution {
    /** Fill bar (bar open time, epoch ms) — the bar the marker unit anchors to. */
    time: Millis;
    /** Exact fill price — anchors the price tick on the bar's edge. */
    price: number;
    /** A buy paints an up arrow below the bar; a sell a down arrow above it. */
    side: 'buy' | 'sell';
    /**
     * Entries paint a plain arrow in the position side's entry color; exits paint a
     * capped arrow (a bar between tip and price bar) in the shared exit color.
     */
    kind: 'entry' | 'exit';
    /** Text line next to the arrow — the order id, or its comment when one was given. */
    label?: string;
    /** Filled quantity (magnitude); painted signed (`+` for buys, `-` for sells). */
    qty?: number;
    /** Shared by the executions of one round-trip (an entry and its exits). */
    tradeId?: string;
}
