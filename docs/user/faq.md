# FAQ

## I see candles but my indicator doesn't show — what's wrong?

You almost certainly haven't registered a scripting engine. **No engine is registered by default** — a bare chart is candles only. Import an engine and register it before (or any time before) you add an indicator:

```js
import { PineEngine } from 'vela';
chart.registerEngine('pine', new PineEngine());
```

Calling `addIndicator` for a language with no registered engine throws an actionable error rather than silently doing nothing. See [quickstart.md](./quickstart.md).

## Can I use Vela fully offline, with no API key?

Yes — pass your own bars via the `data` option. No network call, no key, nothing to configure:

```js
new Vela('#chart', { data: myBars, timeframe: '1h' });
```

`data` and provider fetch are mutually exclusive. With offline `data`, `timeframe` is still used for bar spacing and axis labels; `provider`/`symbol`/`bars` are ignored. This is the recommended path for first runs, demos, and tests. See [examples.md](./examples.md).

## How does live mode work?

Set `live: true`. On top of the loaded history, the chart subscribes to ticks: the forming (last) candle updates in place, and a new bar is appended when the interval rolls over. Indicators recompute as bars change, and you can observe ticks with `chart.on('bar', …)`. The forming bar is never cached as closed history. With offline `data`, the live example synthesizes ticks locally — still no network.

## How do I turn off caching?

The default feed (a multi-provider registry) caches closed bars in memory, so re-runs for the same symbol reuse bars and only re-fetch the tail. Caching is built into that feed and isn't separately toggleable. To bypass it entirely, inject your own bare `MarketDataFeed` through the deps swap point — a custom feed is used as-is, with no registry and no auto-cache:

```js
new Vela('#chart', options, { dataFeed: myCustomFeed });
```

See [Adding a data provider](../contributing/adding-a-data-provider.md) for the provider model and the feed contract, and [Data providers](./data-providers.md) for registering providers with `chart.data`.

## Which renderer and which engine should I use?

**Renderer:** the **native** renderer is the default (WebGL2 with a canvas2d fallback) and the only bundled backend; a custom `IChartRenderer` class can replace it wholesale.

**Engine:** the Pine engine comes in two forms:

- **In-process** (`PineEngine`) — runs on the main thread; supports live streaming.
- **Web-Worker** (`PineWorkerEngine`) — runs off the main thread, which **keeps the UI responsive** during heavy computation, and streams live too: it holds a persistent session inside the worker, so each tick sends one bar across and the script updates incrementally.

Register whichever form you want under the `pine` language id — the call site is identical:

```js
import { PineWorkerEngine } from 'vela';
chart.registerEngine('pine', new PineWorkerEngine());
```

If you need a live forming-candle stream from the engine, use the in-process form; if you want to keep the main thread free for a static chart, use the worker form.

## My drawings don't appear, or I can't edit them — why?

Interactive drawing needs a renderer that supports it. The **native** renderer does; the
a minimal adapter may not. Check `chart.drawings.supported` — when it's `false`, the
interactive methods warn and no-op (and the toolbar won't show), but `chart.drawings.add(...)`,
`toJSON()`/`fromJSON()`, and `undo()`/`redo()` still work, because the drawing model is core-owned.

## Do my drawings persist across reloads?

Not automatically. Snapshot them with `chart.drawings.toJSON()`, store the document yourself
(localStorage, your backend, …), and restore with `chart.drawings.fromJSON(doc)`. Anchors are in
time + price, so restored drawings land on the right bars regardless of the current zoom. See
[drawing-tools.md](./drawing-tools.md).

## How do I hide the toolbar but still script drawings?

Construct with `drawings: false` (or call `chart.drawings.showToolbar(false)`). The bar disappears,
but the whole `chart.drawings` API keeps working headlessly.

## Can I remove the in-chart Vela logo?

The bottom-left mark is Vela's **attribution notice** (see the repository's `NOTICE`
file, per Apache-2.0 §4(d)). It renders by default on every chart. You may turn it off —
`chart.renderer.set('attribution', false)` — **only if** you display an equivalent
visible attribution ("Vela" linking to the project page) elsewhere on the same page or
screen. Removing the attribution entirely is not permitted by the license.

## How stable is the API?

The API is still evolving and may change as the library develops. Expect occasional breaking changes, and pin to a known-good source revision when you need stability.
