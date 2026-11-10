# Adding a Data Provider

This page is for engineers adding a new **market-data source** to Vela™. There are two extension points, from simplest to most powerful:

1. **A `DataProvider`** — implement one method, register it with `chart.data.registerProvider(name, provider)`, and the chart's provider registry routes symbols to it. This is what you want almost always.
2. **A `MarketDataFeed`** — replace the *entire* data layer (registry, caching, routing) with your own, injected via `deps.dataFeed`. Advanced; only when you need full control.

It is conceptual. The exact type names live in source; the shape and the reasoning below are the stable parts.

## Part 1 — A `DataProvider`

A provider is a **pure input adapter for one venue** (an exchange, a broker, an API). It does not own the candles, never talks to the renderer or engines, and is stateless from the chart's point of view. Its whole job is to answer "give me bars for this ticker/timeframe," plus optional metadata.

The crucial thing to internalize: **a provider does not own the candles.** The core does — it holds the single canonical bar array and shares it with every engine and the renderer. A provider is a faucet, not a reservoir.

### The contract

One method is **required**; the rest are **progressive** — present them when you want the capability, omit them and the registry degrades gracefully.

#### Required

- **`getBars(ticker, timeframe, range)`** — return bars for the requested window. `ticker` is what the user typed minus any `provider:` prefix (any `.ext` suffix is **kept** — you own its meaning). `range` is `{ from?, to?, limit?, session? }` (epoch ms; `to` omitted = now). The newest bar is treated as the forming candle. `session` (`'regular'` | `'extended'`) names the trading session the chart shows on markets that have one — honor it if your source can filter (regular vs extended bars are cached as separate series), ignore it otherwise. The same flag reaches `subscribe` as `opts.session` (4th argument).

#### Optional

- **`listSymbols()`** — enumerate the symbols you serve, as `{ ticker, description?, type?, prefix? }[]`. This builds the **eager index** at registration that lets a **bare** symbol (no `provider:` prefix) resolve to you, and powers autocomplete. Without it, your provider is reachable **only** by an explicit `name:SYMBOL` prefix. Declare `prefix` when the symbol's **listing venue** is its identity (`NASDAQ` for AAPL, `NYSE` for IBM — a property of the symbol, not of your provider): it is what `NASDAQ:AAPL` strings resolve against and what every label displays. Leave it out where the provider *is* the identity (crypto, fx). **Grouped listings** (futures roots): emit one **group row** per root — `group` repeated in `ticker` (`{ ticker: 'ES', group: 'ES', … }`) — then its members carrying the same `group` with their own tickers, in deliberate order, one marked `default: true`. The picker folds members under the group row (a chevron unfolds them) and a group pick — clicked, or typed as `ES` / `CME:ES` — loads the `default` member (none or several marked ⇒ the **first listed**). The group row itself is listed, never loadable. Declare `market` when sibling markets of one source differ in session shape (futures product classes): consumers resolving per-market vocabulary key on it.
- **`getSymbolInfo(ticker)`** — facts about one symbol. Engines receive the whole record (Pine `syminfo.*`), and the chart reads a few typed keys from it, each optional (absent means the usual behavior):
  - `timezone` — the market's IANA zone (`'America/New_York'`; default `'Etc/UTC'`). The session hours are written in it, and the exchange display time zone follows it.
  - `session` — the regular hours as `HHMM-HHMM` (`'0930-1600'`), or `'24x7'` for a continuous market. `session_extended` gives the whole extended tape (`'0400-2000'`, or `'1700-1600'` for a trading day that runs from evening to evening). These drive the regular/extended toggle, the session shading and, with `getCalendar`, the market-status badge.
  - `timeframes` — `{ finest, default?, list? }`: the finest timeframe you serve for this symbol (every coarser one too, unless `list` gives the exhaustive set), and the source's own frequency, the natural timeframe to show the symbol in. Write timeframes in the uppercase canonical form: `'1D'` (or `'D'`), `'W'`, `'1M'` (or `'M'`), `'3M'`, `'12M'`, bare minutes like `'60'`. Never lowercase: `'1m'` is one minute, not one month. It overrides `info().supportedTimeframes` for this symbol.
  - `volume` — `false` when your source has no volume for this symbol (a macro-economic series, for example). The chart then adds no volume indicator on its own; one the user adds or saved stays.

  Absent ⇒ the engine synthesizes a fallback and the chart assumes the usual behavior.
- **`resolveSymbolIcon(descriptor)`** — the icon URL for one of your symbols; the provider owns the knowledge of where its asset class's icons live (the bundled crypto providers predefine the Ledger crypto-icon CDN). Called lazily per RENDERED row — cheap and synchronous. Return `undefined` for "no icon" (the shells show a colored-initials badge; a URL that 404s degrades the same way). Serve CORS-clean images (`Access-Control-Allow-Origin`) or drawing them taints the canvas and breaks the PNG export.
- **`getCalendar(ticker, range)`** — the RESOLVED market calendar over `[from, to)`: ascending epoch-ms `[start, end)` pairs of open market time, **holidays and DST already applied by your source**. `range.session` selects the window set (`'regular'` default, `'extended'` = the full tape). This is the single market-time truth: the widget's market-status badge (open / pre / post / closed / holiday) and session-anchored consumers read these windows and never recompute a holiday themselves. Absent ⇒ no calendar (the right answer for continuous markets — crypto, most fx): the badge stays "Market Open" and consumers fall back to their own anchoring.
- **`subscribe(ticker, timeframe, onBar)`** — open a true live candle stream and return an unsubscribe fn. Absent ⇒ the feed **polls `getBars`** for live ticks instead.
- **`info()`** — provider metadata (display name, supported timeframes, capabilities). `supportedTimeframes` uses the same uppercase canonical form as `timeframes` above, which overrides it per symbol. Absent ⇒ the registry synthesizes one from the methods you implement.
- **`configure(config)`** — apply runtime config (e.g. API keys).

A provider that implements only `getBars` is complete and correct — reachable via an explicit `name:SYMBOL` prefix. Add `listSymbols` to make bare symbols resolve to it.

### Bar shape and rules

Every bar you return — from `getBars` or a live `onBar` — follows the same neutral shape and rules:

- **Shape:** `{ time, open, high, low, close, volume? }`. `volume` is optional.
- **`time` is the bar OPEN time, in epoch milliseconds.** Not the close time, not seconds.
- **Sorted and de-duplicated by open-time**, ascending, no two bars sharing an open-time. Normalize before returning if your source can repeat or reorder.
- **The newest bar is the forming, in-progress candle.** Its high/low/close move as ticks arrive; it's never cached as closed history. Signal "the bar closed" simply by emitting the next, larger open-time — there is no separate close event.

### Failures: transient or permanent

A `getBars` that throws an ordinary error is read as a **transient** failure: the feed logs a warning and treats the call as an empty answer, and the live poll keeps trying. Retry network blips inside the provider before giving up.

Some series are **never** served at some timeframes: a monthly economic series has no hourly bars, however often the chart asks. Say so with a `DataUnavailableError` instead of returning an empty list:

```ts
import { DataUnavailableError } from '@luxalgo/vela';

async getBars(ticker, timeframe, range) {
  if (isFinerThanSeries(ticker, timeframe)) {
    throw new DataUnavailableError({ reason: 'timeframe', symbol: ticker, timeframe, finest: '1D', default: '1D' });
  }
  // …
}
```

- `reason` is `'timeframe'` today; the type stays open to further reasons.
- `finest` is the finest timeframe you serve the symbol at, `default` the one you suggest showing it at. Both are hints in your own timeframe notation (`'1D'`, `'W'`, `'1M'`, `'3M'`, or bare minutes).
- The default message is built from the fields (`GDP is not served at 60; its finest timeframe is 1D`), because scripting engines show errors by their message. The feed fills in `symbol` and `timeframe` when you leave them out.

What the refusal does depends on who asked:

- **The chart's own series** — the initial load, a market switch, the history backfill or a gap heal. The chart ends its loading state, stops live updates for that market (no poll starts), and fires `data:unavailable` with `{ symbol, timeframe, reason, finest?, default? }`. The core never changes the timeframe the host set: falling back is the host's call. [The workspace](../user/workspace.md#a-timeframe-the-source-never-serves) makes it: it switches to `default`, else `finest`, tells the user, and keeps the user's timeframe for the next symbol.
- **A secondary series** — a script's `request.security`, read through the engine's `fetchSeries`. The promise rejects with the error, so the engine can report it. The chart's own load, events and timeframe stay untouched.

Neither path caches the refusal: the next request reaches the provider again. Detect the error with `isDataUnavailableError(e)`, which reads the `name` and the fields. Never use `instanceof`: a provider may bundle its own copy of Vela, whose class is a different one.

### Registering it

```js
import { Vela } from '@luxalgo/vela';

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

  // optional — facts about the symbol + real syminfo; absence ⇒ engine synthesizes
  async getSymbolInfo(ticker) {
    return { ticker, timezone: 'America/New_York', session: '0930-1600' /* + engine fields */ };
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

Its bar methods report a permanent refusal the same way a provider does: reject with a `DataUnavailableError`, and the chart reacts as described in [Failures: transient or permanent](#failures-transient-or-permanent). Any other rejection from `load` fails the load.

A feed injected this way is used as-is: `chart.data.registerProvider(...)` becomes a no-op + warning (there's no registry to register into), and you own any caching. Use this only when the provider model doesn't fit; for a normal data source, Part 1 is the path.

## Checklist

- `getBars` implemented; reads ticker/timeframe from arguments, returns open-time-in-ms bars, sorted + de-duplicated.
- Newest bar treated as the forming candle; roll forward by emitting a larger open-time (no separate close event).
- Ranged `getBars` tolerates an overlapping `from` and honors "`to` omitted = now"; no timeframe aggregation across requests unless your venue needs it internally.
- A timeframe the venue never serves for a symbol throws a `DataUnavailableError` with `finest` (and `default` when you have one), not an empty list.
- (Optional) `listSymbols` so bare symbols resolve to you; `getSymbolInfo` for real syminfo and the symbol's facts (time zone, sessions, timeframes, volume); `subscribe` for a true candle stream (else polling is used); `getCalendar` for resolved market-time windows on venues with trading sessions.
- Registered via `chart.data.registerProvider(name, provider)`.

## See also

- [Data providers](../user/data-providers.md) — the user-facing `chart.data` surface + symbol resolution.
- [Architecture overview](../architecture/overview.md) — the core and its three layers.
- [Data flow](../architecture/data-flow.md) — how loaded bars reach engines and the renderer.
- [Adding a scripting engine](./adding-an-engine.md) — the consumer of the bars you provide.
