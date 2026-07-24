# Adding a Data Provider

This page is for engineers adding a new **market-data source** to Vela. There are two extension points, from simplest to most powerful:

1. **A `DataProvider`** — implement one method, register it with `chart.data.registerProvider(name, provider)`, and the chart's provider registry routes symbols to it. This is what you want almost always.
2. **A `MarketDataFeed`** — replace the *entire* data layer (registry, caching, routing) with your own, injected via `deps.dataFeed`. Advanced; only when you need full control.

It is conceptual. The exact type names live in source; the shape and the reasoning below are the stable parts.

## Part 1 — A `DataProvider`

A provider is a **pure input adapter for one venue** (an exchange, a broker, an API). It does not own the candles, never talks to the renderer or engines, and is stateless from the chart's point of view. Its whole job is to answer "give me bars for this ticker/timeframe," plus optional metadata.

The crucial thing to internalize: **a provider does not own the candles.** The core does — it holds the single canonical bar array and shares it with every engine and the renderer. A provider is a faucet, not a reservoir.

### The contract

One method is **required**; the rest are **progressive** — present them when you want the capability, omit them and the registry degrades gracefully.

#### Required

- **`getBars(ticker, timeframe, range)`** — return bars for the requested window. `ticker` is what the user typed minus any `provider:` prefix (any `.ext` suffix is **kept** — you own its meaning). `range` is `{ from?, to?, limit? }` (epoch ms; `to` omitted = now). The newest bar is treated as the forming candle.

#### Optional

- **`listSymbols()`** — enumerate the symbols you serve, as `{ ticker, description?, type? }[]`. This builds the **eager index** at registration that lets a **bare** symbol (no `provider:` prefix) resolve to you, and powers autocomplete. Without it, your provider is reachable **only** by an explicit `name:SYMBOL` prefix.
- **`getSymbolInfo(ticker)`** — per-symbol metadata an engine may read (Pine `syminfo.*`). Absent ⇒ the engine synthesizes a fallback.
- **`subscribe(ticker, timeframe, onBar)`** — open a true live candle stream and return an unsubscribe fn. Absent ⇒ the feed **polls `getBars`** for live ticks instead.
- **`info()`** — provider metadata (display name, supported timeframes, capabilities). Absent ⇒ the registry synthesizes one from the methods you implement.
- **`configure(config)`** — apply runtime config (e.g. API keys).

A provider that implements only `getBars` is complete and correct — reachable via an explicit `name:SYMBOL` prefix. Add `listSymbols` to make bare symbols resolve to it.

### Bar shape and rules

Every bar you return — from `getBars` or a live `onBar` — follows the same neutral shape and rules:

- **Shape:** `{ time, open, high, low, close, volume? }`. `volume` is optional.
- **`time` is the bar OPEN time, in epoch milliseconds.** Not the close time, not seconds.
- **Sorted and de-duplicated by open-time**, ascending, no two bars sharing an open-time. Normalize before returning if your source can repeat or reorder.
- **The newest bar is the forming, in-progress candle.** Its high/low/close move as ticks arrive; it's never cached as closed history. Signal "the bar closed" simply by emitting the next, larger open-time — there is no separate close event.

### Registering it

```js
import { Vela } from 'vela';

const chart = new Vela('#chart', { symbol: 'BTCUSDT', timeframe: '1h' });
chart.data.registerProvider('binance', new MyBinanceProvider());
await chart.ready();
```

Registration is what **fires the chart's parked initial load** — until a provider that resolves the chart symbol is registered, a symbol-backed chart fetches nothing. See [Data providers](../user/data-providers.md) for the user-facing lifecycle and symbol-resolution rules.

### A minimal worked shape

```ts
const myProvider = {
  // required — read ticker/timeframe per call (never stash them)
  async getBars(ticker, timeframe, range) {
    const bars = await fetchBars(ticker, timeframe, range); // your API
    return normalize(bars); // sorted + deduped by open-time, time in epoch ms
  },

  // optional — lets BARE symbols resolve to this provider + powers autocomplete
  async listSymbols() {
    return (await fetchSymbols()).map((s) => ({ ticker: s.id, description: s.name }));
  },

  // optional — real syminfo; absence ⇒ engine synthesizes
  async getSymbolInfo(ticker) {
    return { ticker /* + provider-specific fields */ };
  },
};

chart.data.registerProvider('myvenue', myProvider);
```

If you never add `listSymbols`/`getSymbolInfo`/`subscribe`, nothing breaks — the provider is reachable by `MYVENUE:SYMBOL`, syminfo is synthesized, and live ticks come from polling `getBars`.

### Caching is automatic

The default feed caches **closed** bars in a shared in-memory store, keyed on the **resolved** `(provider, ticker, timeframe)` — so `BTCUSDT` and `BINANCE:BTCUSDT` share one entry. On a re-run it re-fetches only the uncached **tail** (newly-closed + forming bars) by calling your `getBars` with a bounded `range` whose `from` may **overlap** bars already held. Return the requested window as-is (sorted, de-duplicated); never error on an overlapping `from`. You implement no caching yourself.

### The source-of-truth pitfall

**Read the ticker and timeframe from the call arguments, never from stashed instance state.** The cache can serve history without ever calling your `getBars` for the primary load, then later call it for just the tail — a captured "current symbol" may be stale or never set.

## Part 2 — A custom `MarketDataFeed` (advanced)

The provider registry is itself a `MarketDataFeed` — the one small port the core talks to (`load` / `subscribe`, plus optional `loadRange` / `symbolInfo`). To bypass the registry, caching, and routing entirely — sourcing candles from a single fixed backend, a database, or deterministic test fixtures — implement that port and inject it:

```ts
const chart = new Vela(container, options, {
  dataFeed: myFeed, // used BARE — no registry, no auto-cache wrapping
});
```

A feed injected this way is used as-is: `chart.data.registerProvider(...)` becomes a no-op + warning (there's no registry to register into), and you own any caching. Use this only when the provider model doesn't fit; for a normal data source, Part 1 is the path.

## Checklist

- `getBars` implemented; reads ticker/timeframe from arguments, returns open-time-in-ms bars, sorted + de-duplicated.
- Newest bar treated as the forming candle; roll forward by emitting a larger open-time (no separate close event).
- Ranged `getBars` tolerates an overlapping `from` and honors "`to` omitted = now"; no timeframe aggregation across requests unless your venue needs it internally.
- (Optional) `listSymbols` so bare symbols resolve to you; `getSymbolInfo` for real syminfo; `subscribe` for a true candle stream (else polling is used).
- Registered via `chart.data.registerProvider(name, provider)`.

## See also

- [Data providers](../user/data-providers.md) — the user-facing `chart.data` surface + symbol resolution.
- [Architecture overview](../architecture/overview.md) — the core and its three layers.
- [Data flow](../architecture/data-flow.md) — how loaded bars reach engines and the renderer.
- [Adding a scripting engine](./adding-an-engine.md) — the consumer of the bars you provide.
