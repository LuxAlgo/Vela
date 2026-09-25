// Ready-made tick sources for `chart.replay.setTicks` — the lower-timeframe case: replay a
// bar through the finer bars that make it up, fetched from the chart's own provider.
import type { OHLCV } from './model/ohlcv';
import type { ReplayTick, ReplayTickSource } from './ReplayControl';
import type { DataControl } from './DataControl';
import type { MarketSnapshot } from './options';

/**
 * Ticks from the chart's own data provider at a finer `timeframe` (`'1'`, `'5'`, …): for
 * each replayed bar, the lower-timeframe bars inside its span are fetched and each becomes
 * one update ({@link barsToTicks}) — a 15m bar replayed from 1m bars takes 15 intervals. The symbol and session are read when the bar is due, so the
 * source follows a market switch. Unresolvable symbol or nothing served ⇒ the bar plays whole.
 */
export function lowerTimeframeTicks(chart: { readonly market: MarketSnapshot; readonly data: DataControl }, timeframe: string): ReplayTickSource {
    return async (bar, { end, signal }) => {
        const { symbol, session } = chart.market;
        const resolved = symbol ? chart.data.resolve(symbol) : null;
        const provider = resolved ? chart.data.providerInstance(resolved.provider) : undefined;
        if (!resolved || !provider) return [];
        const bars = await provider.getBars(resolved.ticker, timeframe, { from: bar.time, to: end - 1, ...(session ? { session } : {}) });
        if (signal.aborted) return [];
        return barsToTicks(bars.filter((b) => b.time >= bar.time && b.time < end));
    };
}

/**
 * Turn bars into the ticks a replay plays: one update per bar — the candle closes at its
 * close and stretches to its high and low, with its volume; the first bar also sets the open.
 */
export function barsToTicks(bars: readonly OHLCV[]): ReplayTick[] {
    return bars.map((b) => ({
        price: b.close,
        open: b.open,
        high: b.high,
        low: b.low,
        ...(b.volume === undefined ? {} : { volume: b.volume }),
    }));
}
