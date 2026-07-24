import type { MarketDataFeed } from '../ports/MarketDataFeed';
import type { MarketConfig } from '../options';
import type { OHLCV } from '../model/ohlcv';
import type { Unsubscribe } from '../util/types';

/**
 * Owns the live tick subscription when `live: true`. Pulls forming-candle ticks
 * from the market-data feed (Vela owns the data) and forwards them to the
 * orchestrator's bar reconciler.
 */
export class LiveSession {
    private unsubscribe: Unsubscribe | null = null;

    constructor(
        private readonly feed: MarketDataFeed,
        private readonly market: MarketConfig,
        private readonly onBar: (bar: OHLCV) => void,
    ) {}

    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.feed.subscribe(this.market, this.onBar);
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
