---
name: using-vela-data-providers
description: Feeds Vela charts (@luxalgo/vela) with market data - registering the bundled Binance, Coinbase and Hyperliquid providers, routing symbols (bare, PROVIDER:SYMBOL, listing prefixes like NASDAQ:AAPL), and writing a DataProvider for any other source (a broker, an exchange, your own API or database) with history, live candles, symbol search and icons. Use when a Vela chart needs data from a venue, when connecting an API to the chart, or when a chart stays empty, shows the wrong venue or never updates live.
license: Apache-2.0
---

# Using and adding Vela data providers

A **provider** answers "bars for this ticker and timeframe" for one venue. Vela owns the bars:
it caches them, routes each symbol to a provider, and streams them to indicators and the
renderer. Pick the source:

| You have | Use |
| --- | --- |
| Bars already in memory | `data: bars` on the chart: no provider at all |
| Crypto on Binance, Coinbase or Hyperliquid | a bundled provider (public APIs, no key) |
| Any other API, broker or database | a `DataProvider` of your own (below) |
| A backend that must own caching and routing too | a `MarketDataFeed` through `deps.dataFeed` (rare; see the guide) |

## Registering providers

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';

new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'BTCUSDT',
    providers: {                                   // one instance, shared by every cell
        binance: () => new BinanceProvider(),      // BTCUSDT (spot), BTCUSDT.P (perpetual)
        hyperliquid: () => new HyperliquidProvider(), // BTC, ETH (perps), PURR/USDC (spot), hyperliquid:xyz:TSLA (HIP-3)
    },
});
```

On the bare chart: `chart.data.registerProvider('binance', new BinanceProvider())`. A
symbol-backed chart fetches nothing until a provider that serves its symbol is registered.

## How a symbol routes

| Symbol | Goes to |
| --- | --- |
| `BTCUSDT` | the first registered provider whose symbol list contains it |
| `BINANCE:BTCUSDT` | the provider registered as `binance` (case-insensitive) |
| `NASDAQ:AAPL` | the provider whose symbol list declares that listing prefix for `AAPL` |
| `BTCUSDT.P` | like `BTCUSDT`; the provider owns the meaning of `.P` |

Registration order is priority. A symbol no provider serves keeps the chart waiting (it may
still be about to register one) and fires the `data:unresolved` event.

## Writing a provider

Only `getBars` is required. Each optional method adds a capability; without it the chart
degrades gracefully.

```ts
import type { DataProvider, OHLCV, SymbolDescriptor } from '@luxalgo/vela';

const API = 'https://api.example.com';
// Vela's timeframes (minutes, D/W/M) and their aliases, to this API's intervals.
const INTERVAL: Record<string, string> = {
    '1': '1m', '1m': '1m', '15': '15m', '15m': '15m', '60': '1h', '1h': '1h',
    '240': '4h', '4h': '4h', D: '1d', '1d': '1d', W: '1w', '1w': '1w',
};

export const exampleProvider: DataProvider = {
    // Required. Read ticker and timeframe from the arguments on every call, never from state.
    async getBars(ticker, timeframe, range) {
        const interval = INTERVAL[timeframe];
        if (!interval) return []; // a timeframe this API cannot serve
        const url = `${API}/candles?symbol=${encodeURIComponent(ticker)}&interval=${interval}` +
            `&to=${range.to ?? Date.now()}&limit=${range.limit ?? 1000}${range.from ? `&from=${range.from}` : ''}`;
        const rows: Array<[number, number, number, number, number, number]> = await (await fetch(url)).json();
        const bars: OHLCV[] = rows.map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v }));
        bars.sort((a, b) => a.time - b.time);
        return bars.filter((b, i) => i === 0 || b.time !== bars[i - 1]!.time);
    },

    // Lets a bare symbol (no "example:" prefix) resolve here, and feeds the symbol search.
    async listSymbols(): Promise<SymbolDescriptor[]> {
        const list: Array<{ id: string; name: string }> = await (await fetch(`${API}/symbols`)).json();
        return list.map((s) => ({ ticker: s.id, description: s.name, type: 'stock', prefix: 'NASDAQ' }));
    },

    // A true live stream; without it the chart polls getBars.
    subscribe(ticker, timeframe, onBar) {
        const interval = INTERVAL[timeframe];
        if (!interval) return () => {};    // nothing to stream (rule 8: poll a timeframe you aggregate)
        const ws = new WebSocket(`wss://stream.example.com/${ticker}@${interval}`);
        ws.onmessage = (e) => {
            const k = JSON.parse(String(e.data));
            onBar({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v });
        };
        return () => ws.close();
    },

    resolveSymbolIcon: (s) => `https://icons.example.com/${s.ticker.toLowerCase()}.svg`,
};

// workspace: providers: { example: () => exampleProvider }
// bare chart: chart.data.registerProvider('example', exampleProvider)
```

## Rules for bars

1. **`time` is the bar's OPEN time in epoch milliseconds.** Not the close, not seconds. A
   source that stamps close times: subtract the bar's length (a daily bar opens at 00:00 UTC of
   its trading day).
2. **Ascending and de-duplicated by `time`.** Normalize before returning.
3. **The newest bar is the forming candle.** It changes as ticks arrive; a bar closes when you
   emit the next, later `time`. There is no close event. Its close time lies in the future, so
   page a close-stamped API from beyond now or you drop it.
4. **Answer the window asked for.** `range` is `{ from?, to?, limit?, session? }` in open
   times; `to` absent means now. The cache asks again with a `from` that overlaps bars it holds:
   return the window as is. You write no cache of your own.
5. **Deep history comes in chunks.** The chart pages backward with `getBars({ to, limit })`;
   an empty answer ends the history, which is right for a source with a start date. A thrown
   error is logged and read as an empty answer too, so retry transient failures inside the
   provider before giving up.
6. **A timeframe you never serve for a symbol is a refusal, not an empty answer.** A monthly
   economic series has no hourly bars: throw
   `new DataUnavailableError({ reason: 'timeframe', finest: '1D', default: '1D' })` (from
   `@luxalgo/vela`). The chart then stops loading and polling that market and fires
   `data:unavailable` with your `finest` and `default` as hints. A script's `request.security`
   gets the error. Detect it with `isDataUnavailableError(e)`, never `instanceof`.
7. **Timeframes: a bare number is minutes** (`'1'`, `'60'`, `'240'`), and **`'D'`, `'W'`, `'M'`
   are a day, a week and a MONTH**. Aliases reach you too: `'15m'` and `'1h'` (minutes, hours),
   `'1d'`, `'1w'`. Normalize to one form, then map to your API's codes: never pass Vela's string
   through, since an API's `M` often means minutes. Aggregate a timeframe the source lacks
   inside the provider, in `getBars` and in `subscribe`.
8. **`subscribe` covers every timeframe once you implement it**: the chart then never polls for
   you. For a timeframe you cannot stream (one you aggregate), poll your own
   `getBars(ticker, timeframe, { limit: 2 })` every few seconds inside `subscribe`, as the
   bundled providers do, and seed a forming aggregate from REST.
9. **Icons must be CORS-clean** (`Access-Control-Allow-Origin`), or the chart's PNG export
   breaks.

Other optional methods: `getSymbolInfo(ticker)` returns `{ ticker, ...fields }`, handed to the
scripting engine as is, so name the fields as its language does (for Pine Script®, the
`syminfo.*` names: `description`, `type`, `currency`, `timezone`, `mintick`…); `getCalendar(ticker, range)` for
market sessions and holidays (leave it out for 24/7 markets, or when the source has no
calendar), `info()` for a display name and the timeframes served, `configure(config)` for keys.
`listSymbols` is what makes a bare or prefixed symbol resolve: retry it on failure, or symbols
stay unresolved.

## Check your work

1. `chart.data.resolve('YOUR:SYMBOL')` names your provider, and `chart.data.symbols('your')`
   lists your symbols.
2. `await chart.ready()` resolves and candles paint; scroll far left and confirm older history
   loads (`await chart.historyComplete()`).
3. With `live: true`, the last candle moves and a new one starts when the interval rolls over.
4. Unit-test `getBars` against a recorded response: sorted, de-duplicated, times in
   milliseconds, the forming bar last.

## Further reading

- `node_modules/@luxalgo/vela/docs/user/data-providers.md`: `chart.data`, the load lifecycle,
  listing prefixes, grouped futures, the bundled providers' coverage.
- `node_modules/@luxalgo/vela/docs/contributing/adding-a-data-provider.md`: every method of the
  contract, and the custom `MarketDataFeed`.
