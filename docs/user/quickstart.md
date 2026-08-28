# Quickstart

Vela™ is a modern, layer-based charting library. This page gets a candlestick chart on screen, then adds a scripting engine and an indicator.

The fastest path uses **offline data** — an array of bars you already have. No network call, no API key, nothing to configure.

## At a glance

- **Step 1 alone renders candles.** Engines are opt-in.
- **Step 2** registers an engine so scripts can run.
- **Step 3** adds an indicator from source.

> Install the package first: `npm install @luxalgo/vela` (see [installation.md](./installation.md)).

---

## Step 1 — Create a chart

Give Vela™ a container (an element or a CSS selector) and some options. Pass your own bars via `data` to stay fully offline.

```js
import { Vela } from '@luxalgo/vela';

const chart = new Vela('#chart', {
  data: myBars,      // OHLCV[] you already have — no provider, no network
  timeframe: '1h',
  theme: 'dark',
});
```

Each bar is `{ time, open, high, low, close, volume? }`, where `time` is the bar's open time in **epoch milliseconds**.

With offline `data`, `timeframe` is still used — for bar spacing and axis labels — while `symbol`/`bars` are ignored (those drive the fetch path you are opting out of).

That is the whole first step. Candles paint immediately — **no engine required**. A chart with no scripting engine is a perfectly valid candlestick chart.

> Want bars fetched for you instead of supplying them? Set a `symbol`/`timeframe` and register a data provider with [`chart.data.registerProvider(...)`](./data-providers.md) — registering it fires the fetch. `data` and provider fetch are mutually exclusive. See also [options.md](./options.md) (market options).

## Step 2 — Register a scripting engine

Indicators run on a **scripting engine**, and **Vela™ ships none**. Install the one you need and register it under its language id. Pine Script lives in the `@luxalgo/vela-pinets` addon:

```bash
npm install @luxalgo/vela-pinets pinets
```

```js
import { PineEngine } from '@luxalgo/vela-pinets';

chart.registerEngine('pine', new PineEngine());
```

`registerEngine` returns the chart, so you can chain it from construction:

```js
const chart = new Vela('#chart', { data: myBars, timeframe: '1h' })
  .registerEngine('pine', new PineEngine());
```

This is deliberate: the bare chart stays lightweight, you only pull in an engine when you actually script — and Vela™'s own license stays clean of whatever a runtime brings with it. Calling `addIndicator` with no engine for that language throws an actionable error.

> The addon also exports `PineWorkerEngine`, the same Pine semantics off the main thread. See [Scripting engines](./scripting-engines.md) for both, the licensing note, and how to write an engine of your own.

## Step 3 — Add an indicator from source

Pass the script source. The engine is selected by language — `addIndicator({ language })`, or the chart's `defaultLanguage` when the call names none (seeded from the first engine passed at construction, `'pine'` otherwise).

```js
const ema = chart.addIndicator(`//@version=5
indicator("EMA", overlay=true)
plot(ta.ema(close, input.int(20, "Length")), "EMA", color.orange)`);
```

**`addIndicator` returns a handle synchronously, but the data fills in asynchronously.** The handle is usable right away — you can read its `id` and `title`, change inputs, or remove it — but the plotted values appear once execution resolves. Listen for that:

```js
ema.on('ready', () => console.log('EMA rendered'));
ema.on('error', ({ error }) => console.error(error));
```

You can also await the whole chart's first paint:

```js
await chart.ready();
```

> Deep-history charts (a `bars` count beyond ~10k) become interactive after their first chunk and keep backfilling older bars in the background — `await chart.historyComplete()` when you need the full depth (see the `history:progress` / `history:complete` events in the [API reference](./api-reference.md)).

---

## Full example

```js
import { Vela } from '@luxalgo/vela';
import { PineEngine } from '@luxalgo/vela-pinets';

const chart = new Vela('#chart', { data: myBars, timeframe: '1h', theme: 'dark' });
chart.registerEngine('pine', new PineEngine());

const rsi = chart.addIndicator(`//@version=5
indicator("RSI")
plot(ta.rsi(close, input.int(14, "Length")), "RSI", color.purple)`);

rsi.on('ready', () => console.log('RSI ready'));
```

## Where to go next

- **Live mode** (a forming candle + indicators recomputing on each tick): [options.md](./options.md) and [faq.md](./faq.md).
- **Runnable examples** (a static and a live one, both offline): [examples.md](./examples.md).
- **Full surface**: [api-reference.md](./api-reference.md).
- **Stuck?** [faq.md](./faq.md).
