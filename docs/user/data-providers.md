# Data providers

`chart.data` is the control surface for **where candles come from** — the sibling of [`chart.renderer`](./renderer-features.md). You register one or more market-data **providers**, and the chart routes each symbol to the right one.

No provider is bundled. A symbol-backed chart fetches nothing until you register a provider — registering the one that resolves the chart symbol is what **fires the initial load**.

```js
import { Vela, PineEngine } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const chart = new Vela('#chart', { symbol: 'BTCUSDT', timeframe: '1h' })
  .registerEngine('pine', new PineEngine());

chart.data.registerProvider('binance', new BinanceProvider());

await chart.ready(); // resolves after the provider registers + the first history chunk loads
```

> Offline `data` needs no provider — `new Vela('#chart', { data: myBars })` paints immediately. Providers are only for the **fetch** path.

## Symbol formats

A symbol can name its provider with a prefix, or stay bare:

| Form | Example | Routes to |
|---|---|---|
| `SYMBOL` | `BTCUSDT` | the first registered provider that serves it (see resolution) |
| `PROVIDER:SYMBOL` | `BINANCE:BTCUSDT` | the named provider (case-insensitive) |
| `SYMBOL.EXT` | `BTCUSDT.P` | resolved like `SYMBOL`; the `.EXT` is passed through to the provider |
| `PROVIDER:SYMBOL.EXT` | `BINANCE:BTCUSDT.P` | the named provider, ticker `BTCUSDT.P` |

The `.EXT` suffix is **opaque to Vela** — the provider owns its meaning (Binance reads `.P` as a perpetual future). Vela only uses it for the cache key and display.

## How a bare symbol resolves

When you don't name a provider, Vela picks one:

1. An explicit `PROVIDER:` prefix always wins, immediately.
2. A bare symbol routes to the **first provider, in registration order, whose index contains it.** Each provider is indexed (via its symbol list) when it registers.

This means a symbol can be served by several providers, and the order you register them sets the priority. A provider that does **not** serve the symbol is skipped — never fetched against.

With **multiple** providers and a bare symbol, the chart waits until the *supporting* provider is registered and indexed, then loads — regardless of registration order:

```js
chart.data
  .registerProvider('binance', new BinanceProvider()) // crypto; no AAPL
  .registerProvider('fmp', new FmpProvider());          // has AAPL
// new Vela('#chart', { symbol: 'AAPL' }) → renders via FMP once it's indexed
```

If no registered provider serves the symbol, the chart stays parked (it doesn't error — you may still be about to register one) and logs a console warning each time a provider finishes indexing without a match.

## The load lifecycle

Because registration is explicit and the symbol index builds asynchronously, the first fetch is **deferred until a provider can resolve the chart symbol**:

- Construction with a `symbol` **parks** the load (nothing is fetched yet).
- `registerProvider(...)` is synchronous and chainable; it kicks the index build and, as soon as the symbol resolves, **fires the parked load**.
- `await chart.ready()` resolves after that first load. `chart.addIndicator(...)` already awaits readiness internally, so you can call it before — or after — registering the provider; it queues until data lands.
- An explicit `PROVIDER:SYMBOL` resolves the moment that provider registers (it doesn't wait for the full symbol index to build).
- **Deep history loads in chunks.** A `bars` count beyond one ~10k-bar chunk paints the recent window first (that's what `ready()` awaits), then backfills older bars **backward in bounded ranged requests** — each a quick `getBars({ to, limit })` the provider answers from its own pagination. Watch `history:progress`, or `await chart.historyComplete()` for the full depth; indicators compute once, over the complete history, when it lands. A chunk that returns nothing older ends the backfill (`history:complete` with `reason: 'genesis'`) — exactly right for sources with bounded history.
- **Multi-chart retention.** The closed-bar cache keeps ONE symbol by default (each load purges the rest — right for a single chart). Multi-chart hosts declare the set of live symbols with `BarStore.retain(symbols)` so one chart's load never evicts another's history; [the workspace](./workspace.md) does this automatically for its cells (duplicates share the same cached series and live stream).

## `chart.data` reference

| Member | Returns | Notes |
|---|---|---|
| `registerProvider(name, provider)` | `this` | Register (or replace) a provider; fires the parked load when it resolves the symbol. |
| `unregisterProvider(name)` | `this` | Remove a provider. |
| `providers()` | `ProviderInfo[]` | Metadata for every registered provider. |
| `resolve(symbol)` | `{ provider, ticker } \| null` | How a symbol routes right now (null if nothing serves it). |
| `symbols(provider?)` | `SymbolDescriptor[]` | Indexed symbols (for autocomplete) — for one provider, or all. |
| `symbolInfo(symbol)` | `Promise<SymbolInfo \| undefined>` | Per-symbol metadata (Pine `syminfo.*`), via the owning provider. |
| `capabilities(symbol)` | `ProviderCapabilities \| null` | The full resolved per-symbol capability record (behavior flags). Null while nothing resolves the symbol yet. |
| `ready()` | `Promise<void>` | Resolves when every provider's symbol index has settled. |

Registering or replacing a provider on a chart that was given a **custom feed** (`deps.dataFeed`) is a no-op + console warning — that feed manages its own data.

## The bundled Binance provider

`vela/providers/binance` is a from-scratch Binance provider (no third-party SDK). It serves spot and USDT-margined perpetual futures (`SYMBOL.P`), paginates past Binance's 1000-candle cap, falls back from `api.binance.com` to `api.binance.us`, and aggregates timeframes Binance doesn't serve natively (e.g. `45`, `180`). No API key. Live ticks stream from a native **kline WebSocket** (spot `stream.binance.com`, perpetuals `fstream.binance.com`), with an automatic **poll fallback** if the socket can't deliver — e.g. where Binance futures streams are geo-restricted — and for aggregated timeframes that have no native stream.

```js
import { BinanceProvider } from 'vela/providers/binance';
chart.data.registerProvider('binance', new BinanceProvider());
// BTCUSDT, ETHUSDT, … (spot) and BTCUSDT.P, ETHUSDT.P, … (perpetuals)
```

## The bundled Coinbase provider

`vela/providers/coinbase` is a from-scratch Coinbase Exchange provider (no third-party SDK, no API key). It serves spot products (`BTC-USD`, `ETH-EUR`, …), paginates past the 300-candle cap, aggregates timeframes Coinbase doesn't serve natively, and folds weekly/monthly from daily. Live candles are built from the `ticker` WebSocket stream (Coinbase has no native kline stream) with a periodic REST re-seed, plus the standard poll fallback.

```js
import { CoinbaseProvider } from 'vela/providers/coinbase';
chart.data.registerProvider('coinbase', new CoinbaseProvider());
// BTC-USD, ETH-USD, ETH-BTC, …
```

## The bundled Hyperliquid provider

`vela/providers/hyperliquid` is a from-scratch [Hyperliquid](https://hyperliquid.xyz) provider (no third-party SDK, no API key). It serves USD-margined perpetuals — **bare coins** like `BTC`, `ETH` (not `BTCUSDT`) — and spot pairs (`PURR/USDC`), and aggregates timeframes Hyperliquid doesn't serve natively (e.g. `45`, `180`, `360`). **Live ticks come from a real WebSocket candle stream**, with the same automatic poll fallback as Binance if a stream can't deliver.

```js
import { HyperliquidProvider } from 'vela/providers/hyperliquid';
chart.data.registerProvider('hyperliquid', new HyperliquidProvider());
// new Vela('#chart', { symbol: 'BTC', timeframe: '1h' })  → perps
// or 'HYPERLIQUID:ETH', 'PURR/USDC', …
```

> **History is recent-only.** Hyperliquid serves just the most recent ~5000 candles per interval — roughly 3.5 days of `1m`, ~17 days of `5m`, ~7 months of `1h`, and daily back to listing. There is no deeper backfill, so it's a live / recent-history venue rather than a deep-history source. Requesting more bars than exist simply returns what's available.

Because Hyperliquid coins are bare, a bare `BTC` won't collide with Binance's `BTCUSDT`; register both and each symbol routes to the venue that indexes it (or name one explicitly with a `BINANCE:` / `HYPERLIQUID:` prefix).

## Bringing your own provider

Implement the `DataProvider` interface and register it under any name — see [Adding a data provider](../contributing/adding-a-data-provider.md). The only required method is `getBars`; everything else (`listSymbols`, `getSymbolInfo`, `info`, `subscribe`) is a progressive enhancement.

## See also

- [Adding a data provider](../contributing/adding-a-data-provider.md) — implement your own.
- [Options](./options.md) — `symbol` / `timeframe` / `bars` / `provider` and the rest.
- [Renderer features](./renderer-features.md) — the `chart.renderer` sibling surface.
