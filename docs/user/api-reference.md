# API Reference

This is a hand-written, conceptual reference for the Vela™ public surface — what each piece is for and how the pieces bind. A generated type reference (from the source declarations) may be added later; for now this prose is the source of truth.

## The mental model

Vela™ is a small **core** plus three independently swappable **layers** — data providers, scripting engines, and renderers — each reached through a single narrow **port**.

The **neutral model** — bars, series, pane overlays, drawings, inputs, update patches — is the only thing that crosses a port. No backend-specific type ever leaks across. That opacity is what makes each layer swappable. What ships is the native renderer and the provider-backed, cache-wrapped data feed — both plain **swappable defaults**. No scripting engine ships at all: you install one (Pine Script: `@luxalgo/vela-pinets`) or write one against the port — see [Scripting engines](./scripting-engines.md).

> These snippets import from the npm package `@luxalgo/vela` (see [installation.md](./installation.md)).

The higher-level shell is documented on its own page: [the workspace](./workspace.md) (`@luxalgo/vela/workspace` — one chart with `layout: false`, or a multi-chart grid with one shared chrome and sync links). It exposes the state surface — `getState()` / `applyState()` / `state:changed` over one shared document format — which is also what its `persist` option writes.

---

## `class Vela(container, options?, deps?)`

The public, imperative chart and the composition root — the one place that wires concrete backends.

- **`container`** — an `HTMLElement` or a CSS selector string. A missing selector throws.
- **`options`** — display, behavior, and market options. See [options.md](./options.md).
- **`deps`** — the **swap point** for backends and browser motion observation (see below).

Constructing a chart renders candles immediately. Scripting engines are opt-in.

### Core methods

| Method | What it does |
|---|---|
| `registerEngine(language, engine)` | Register a scripting engine under a language id so `addIndicator` can run that language. **Vela™ ships none** — install an addon or write one ([Scripting engines](./scripting-engines.md)). Re-registering a language replaces it (affects future indicators only). Returns the chart for chaining. |
| `addIndicator(source, options?)` | Run an indicator script over the chart's market data and render it. Returns an **`IndicatorHandle` synchronously**; values fill in asynchronously. See [options.md](./options.md) for per-indicator options. |
| `addNativeIndicator(type, options?)` | Add a core-computed (non-scripting) **native indicator** by registered `type`. Returns an `IndicatorHandle` (same lifecycle: legend row, eye/remove, events). The layer-backed types `'volume'` (auto-added) and `'vpvr'` (the visible-range volume profile) are **single-instance** — a second call returns the existing handle; the built-in classic studies (`'sma'`, `'rsi'`, …) allow **several instances**, so each call adds one more. Plugin chart types can register more (see `multiInstance` on the descriptor). `options.inputs` seeds inputs. Native renderer only; an unregistered type returns a fail-soft handle that never mounts. |
| `runScript(source, options?)` | Execute a script and resolve its **first computed run** — the data-out door for editors, consoles and dashboards. Resolves `{ ok: true, run }` with the [`ScriptRun`](#capturing-what-a-script-computes) itself, plus `onUpdate(cb)` to follow later runs and `remove()` to take it off the chart; `{ ok: false, error }` on a compile/runtime failure, which removes the script again (no dead legend row). Never rejects. Prefer it over `runIndicator` — same injection semantics, but it hands you the data instead of a handle to go fetch from. |
| `runIndicator(source, options?)` | Execute a script and **inject it only if the run succeeds** — the seam for host editors/consoles. Resolves `{ ok: true, handle }` after the first successful evaluation, or `{ ok: false, error, context }` on a compile/runtime failure — `context` is the post-mortem execution-context snapshot when the engine had produced one, and the failed indicator is removed again (no dead legend row). Never rejects. |
| `indicators()` | Live `IndicatorHandle[]` of everything on the chart (script + native), in insertion order — the seam for host panels (object trees, indicator lists) that need per-id visibility/removal. |
| `availableNativeIndicators()` | Returns `Promise<NativeIndicatorInfo[]>` — the catalog of built-in native indicators with their live state on this chart, for building an "add indicator" picker UI (lets a host list them, gate unsupported ones, avoid duplicates). Async because support may need to probe the provider (a type may need data the symbol lacks). |
| `presentNativeIndicators()` | Returns `string[]` — the native types present on the chart **right now**, one entry per instance (a multi-instance type repeats), synchronously (the presence slice of `availableNativeIndicators()`, which stays async only for support probing). Persistence snapshots read this: an unload-time save must see an add or remove made microseconds earlier. |
| `setMarket(next)` | Switch the chart's market **in place** — `{ symbol?, timeframe?, session?, bars?, data?, visibleRange? }` — without destroying the chart. The symbol string carries the venue: bare = registered providers in declaration order, `'coinbase:BTC-USD'` pins one. Only the fields given change. A session switch reloads with the exact case-sensitive provider-facing ID while preserving the visible bar count and newest visible-bar anchor. Indicators re-execute over the new bars, native indicators restart, and panes, user drawings, renderer config and event subscriptions all **survive**. Resolves once the new market's history is painted (a deep backfill continues behind it — await `historyComplete()`); a call superseded by a newer `setMarket` resolves silently. Emits `market:changed` when the market identity changed (a depth-only `bars` reload is silent). `visibleRange` frames the first paint of the new market. Drawings are kept as-is — per-symbol drawing documents are a host policy (`chart.drawings.toJSON()/fromJSON()` keyed off `market:changed`). |
| `market` (getter) | The current market identity — the read counterpart of `setMarket`. A **snapshot** `{ symbol?, provider?, timeframe?, session?, bars?, offline }` of the *requested* market (`provider` = the symbol's own `EXCHANGE:` prefix, or undefined when bare — the venue that actually served it is `chart.data.resolve(symbol)`): it reflects an in-flight switch immediately (before the new bars land), which is what persist-on-close flows want. Listen to `market:changed` for *committed* identity changes. Mutating the returned object changes nothing. |
| `reducedMotion` (getter) | The effective runtime motion gate. It follows `prefers-reduced-motion` only when `animations` is omitted; explicit `false` keeps it true, while `true` or an animation object keeps it false. It is not saved state. |
| `ready()` | Returns a promise that resolves once the chart is painted and interactive. On a ranged feed the first paint is a small recent head (~200 bars) and the rest of the history keeps backfilling **behind** this — await `historyComplete()` for the full depth. |
| `historyComplete()` | Returns a promise that resolves once the **current load's** full requested history has loaded — immediately for small/offline charts, after the background backfill for deep ones. **Per-load**: each `setMarket` re-arms the cycle (the superseded load's promise resolves rather than hanging), so call it again after a switch for the new market's depth. Never rejects: on destroy or a failed backfill it resolves with whatever depth loaded. |
| `on(event, handler)` | Subscribe to a chart-level event. Returns an unsubscribe function. |
| `getVisibleRange()` | The current visible time range (`{ from, to }` in epoch-ms), or `null` before data loads. |
| `setVisibleRange(range)` | Set the visible time range explicitly (epoch-ms). Returns the chart for chaining. |
| `panBy(fraction)` | Pan by a fraction of the visible width — positive ⇒ toward the latest bars, negative ⇒ into history. Behaves exactly like dragging the chart: constant zoom, the same pan limits (forward stops at the newest candle plus the bounded empty space), eased on renderers that animate pans; repeated calls stack into one continuous scroll. The widget's `Ctrl/Cmd + ←/→` keys use it. Returns the chart for chaining. |
| `setVisibleRangePreset(preset)` | Frame a named date range over the loaded bars: `'1D'`, `'1W'`, `'1M'`, `'3M'`, `'6M'`, `'1Y'`, `'5Y'`, `'YTD'`, or `'ALL'`. A preset deeper than the loaded history just frames everything (it doesn't fetch more bars — the widget's range chips do that for you). Returns the chart for chaining. |
| `setTheme(theme)` | Swap the app theme at runtime — `'dark'`, `'light'`, or a full theme object (same shape as the `theme` option). Re-skins the chart surface, axes, legends and in-chart chrome live (no indicator re-run) and emits `theme:changed` with the resolved theme so surrounding host chrome can follow. Candle colors are shared across the built-in themes, so a swap never recolors the series. The same switch is available to users in chart settings → Canvas → Theme. Returns the chart for chaining. |
| `inspect()` | A renderer-agnostic snapshot of the graphic elements the core has generated (series, fills, drawings, tables, …) — a deterministic check that a feature was produced, independent of which renderer drew it. |
| `resize()` | Re-measure the container and relayout. Call after the container's size changes. |
| `destroy()` | Tear down the chart, renderer, engines, and subscriptions — no leaks. |

Because `registerEngine` returns the chart, you can wire an engine straight off construction:

```js
const chart = new Vela('#chart', { data: myBars, timeframe: '1h' })
  .registerEngine('pine', new PineEngine());
```

### Adding an indicator: sync handle, async data

`addIndicator` returns right away so you can wire up UI before any computation finishes. The script is prepared (its inputs are parsed) and then executed over the bar history; the plotted output appears when execution resolves. Listen on the handle's `ready` event (or `chart.ready()` for the whole chart) rather than assuming data is present on return. On a deep-history chart the indicator waits for the background backfill and then computes once over the full depth — its `ready` fires when that single run lands.

A minimal end-to-end setup — construct over data, register a scripting engine (here the Pine addon), add an indicator, then await the first render:

```js
import { Vela } from '@luxalgo/vela';
import { PineEngine } from '@luxalgo/vela-pinets';

const chart = new Vela('#chart', { data: myBars, timeframe: '1h', theme: 'dark' });
chart.registerEngine('pine', new PineEngine());

// addIndicator returns synchronously — wire UI now; plotted values fill in later.
const rsi = chart.addIndicator(`//@version=5
indicator("RSI")
plot(ta.rsi(close, input.int(14, "Length")), "RSI", color.purple)`);
rsi.on('ready', () => console.log(rsi.title, 'has computed'));

await chart.ready(); // resolves once the chart is painted and interactive
```

---

## `IndicatorHandle`

What `addIndicator` returns. Usable immediately.

| Member | Description |
|---|---|
| `id` | Stable, content-addressed identity for this indicator. |
| `title` | Display title (overridable via the `title` option). |
| `source` | The script source the indicator was added with; `undefined` for a native indicator. |
| `nativeType` | The registered type of a native indicator (`'volume'`, `'sma'`, …); `undefined` for a script indicator. A handle has one of `source` or `nativeType`, never both. |
| `inputs` | The inputs parsed from the script source — each with a `key`, `title`, `type`, `defval`, and optional `min`/`max`/`step`/`options`/`group`/`inline`/`tab`/`tooltip`. Populated once the script is prepared. |
| `props` | The script's declaration properties (a strategy's `initial_capital`, an indicator's `precision`, …) in the same schema shape as `inputs`. Empty when the engine exposes none. |
| `visible` | Whether the indicator is currently shown. |
| `setInput(key, value)` | Change one input by its key. Triggers a re-run (an input edit can restructure output, so this may remount the indicator). |
| `setInputs(values)` | Change several inputs at once, keyed by input key or title. |
| `setProp(key, value)` | Override one declaration property (e.g. `initial_capital`). A prop change replays the whole script. |
| `setProps(values)` | Override several declaration properties at once. |
| `setVisible(visible)` | Hide or show the indicator. Hiding suspends it — its visuals are dropped and its computation stops; showing re-runs it over the current bars. |
| `on(event, handler)` | Per-indicator events — `ready`, `error` (`{ error }`), `alert` (`{ id, message, title?, time }`). Returns an unsubscribe function. |
| `context(select?)` | `Promise` of a **read-only, serializable snapshot** of the engine's execution context — see [below](#capturing-what-a-script-computes). `null` when the engine lacks the capability or nothing ran yet. |
| `remove()` | Remove this indicator from the chart. |

The handle is usable the moment `addIndicator` returns; drive the indicator's lifecycle through its events and mutators:

```js
const macd = chart.addIndicator(macdSource);

// React to the computation outcome.
macd.on('ready', () => console.log('inputs:', macd.inputs.map((i) => i.key)));
macd.on('error', ({ error }) => console.error('MACD failed:', error.message));

// Retune inputs — each change triggers a re-run.
macd.setInput('fast', 8);
macd.setInputs({ slow: 21, signal: 5 });

// Hiding suspends it (visuals dropped, computation stopped); showing re-runs it.
macd.setVisible(false);
console.log(macd.visible); // false

macd.remove(); // drop it from the chart
```

### Capturing what a script computes

Two doors, one vocabulary. `script:run` reports **every** script the chart runs; `runScript()`
executes one and hands you its first run. Both deliver the same `ScriptRun` object, so host
code reads a manifest indicator, a console `addIndicator`, and an editor's script identically.

```js
chart.on('script:run', (run) => {
    run.title;          // 'SMA cross' — the title the script DECLARED
    run.kind;           // 'indicator' | 'strategy'
    run.cause;          // why it computed (see below)
    run.bar;            // index of the last computed bar
    run.plots.fast;     // that plot's value at that bar
    run.vars.fastLen;   // the script's own variables, by their SOURCE names

    if (run.strategy) {
        run.strategy.position; // signed contracts held
        run.strategy.equity;
        run.strategy.openPnl;
        run.strategy.netPnl;
    }
});
```

The handle is already resolved and the data already extracted — there is nothing to look up
and nothing to await.

#### Provisional vs final

`cause` is the field that decides whether a value can be trusted:

| `cause` | Fires when |
|---|---|
| `'history'` | The first computation over the loaded history. |
| `'tick'` | The forming bar changed — **values can still move**. |
| `'bar'` | A new bar opened, so the one before it is **final**. |
| `'inputs'` | An input was edited. |
| `'viewport'` | The visible range moved (viewport-aware scripts only). |
| `'market'` | The chart's market changed and the script re-executed. |

Anything that records, alerts, or exports should key off `'bar'`:

```js
chart.on('script:run', (run) => {
    if (run.cause === 'bar') persist(run);  // a bar just closed — settled
    else updateDashboard(run);              // provisional
});
```

`'tick'` runs are **throttled to ~1/s** per indicator (a live stream re-executes the open
candle several times a second, which no dashboard can use). Every other cause is emitted
unconditionally — dropping a `'bar'` run would break exactly the case above.

Two more flags round out the picture: `forming` is true while the run's last bar is still
open (always so on a live chart, never on a static one), and `complete` is false only while
an engine that computes progressively is still being fed a deep backfill.

#### What rides the run, and what you ask for

Flat and at the current bar → on the run. Historical and unbounded → an explicit call, so a
per-tick listener never ships a ledger it will not read:

```js
const trades = await run.trades();      // the strategy's round trips, closed then open
const history = await run.series('fast'); // one plot's full history
```

#### Executing a script and capturing its result

```js
const result = await chart.runScript(source);
if (!result.ok) return console.error(result.error);

result.run.strategy.netPnl;
const off = result.onUpdate((run) => console.log(run.strategy.openPnl));
result.remove();                        // take it off the chart
```

`runScript` resolves on the **first computed run**, injects the script only if it runs (a
failure removes it again — no dead legend row), and never rejects.

#### Across a grid

`@luxalgo/vela/workspace` relays the same event with the cell it came from, so one subscription covers
every cell — including cells a later layout change creates:

```js
ws.on('script:run', (run) => console.log(run.cell, run.title, run.strategy?.equity));
```

#### The lower-level snapshot

`handle.context(select?)` remains the pull counterpart — a **read-only** deep copy of the
engine's execution context (`phase`, `barIndex`, `meta`, `plots`, `variables`, `strategy`,
`trades`, `warnings`), async on both the in-process and Web-Worker engines (the context never
leaves the worker; only the snapshot crosses), and selective via `select`. `script:run` is
built on it and is what host code should normally use; reach for `context()` when you want a
snapshot at a moment of *your* choosing rather than at a run. On a `runIndicator` failure the
same snapshot is attached post-mortem (`{ ok: false, error, context }`) — the state at the
moment of the crash.

---

## Chart-level events

Subscribe with `chart.on(event, handler)`; every subscription returns an unsubscribe function.

| Event | Payload | Fires when |
|---|---|---|
| `ready` | — | The chart is painted and interactive (a deep chart's history may still be backfilling). |
| `market:changed` | `{ symbol, timeframe, session?, prev: { symbol, timeframe, session? } }` | The market switched **in place** via `setMarket` — symbol (venue prefix included), timeframe, session, or offline data changed (a depth-only reload does not fire). Fires after the new market's history is painted and every consumer restarted. `prev` lets hosts re-key per-market state. |
| `load:start` | `{ symbol, timeframe, session?, firstLoad }` | A bar load began with nothing painted: the first load (fires during construction — later subscribers see only its `load:end`), or an identity switch, including a session switch, which blanks the old series in the same breath. Fires **before** the first fetch — plugins and custom indicators hide or reset their own visuals here. A depth-only reload fires neither event. |
| `load:end` | `{ symbol, timeframe, session?, bars }` | The load ended: its first bars painted (`bars` > 0 — on deep histories the quick preview), or it ended with none (`bars` = 0 — a failed fetch, an empty market, or a parked symbol). Exactly one per `load:start`; plugins restore or rebuild their visuals here. |
| `history:progress` | `{ loaded, target }` | A deep-history backfill chunk landed — `loaded` of `target` bars are on the chart. |
| `history:complete` | `{ reason, oldestTime, barsLoaded }` | The history load finished. `reason`: `'depth'` (requested count loaded), `'genesis'` (the source has nothing older), or `'aborted'` (a fetch failed — the chart keeps what loaded). Fires exactly once, including for small/offline charts. |
| `indicator:added` | `{ id }` | An indicator was added. |
| `indicator:removed` | `{ id }` | An indicator was removed. |
| `indicator:error` | `{ id, error }` | An indicator failed. |
| `script:run` | the [`ScriptRun`](#capturing-what-a-script-computes) | A script computed — the first pass over the history, a live tick, a new bar, an input edit, a viewport move, a market switch. Carries the run itself (title, cause, the plots/variables/broker state at the computed bar), so a listener reads it instead of resolving a handle and pulling a snapshot. Forming-bar (`'tick'`) runs are throttled to ~1/s; every other cause fires unconditionally. Never fires for native indicators — they run no script. |
| `context:changed` | `{ id }` | An indicator's execution context advanced (run finished; throttled to ~1/s while streaming). Re-pull `handle.context()` if you consume it. Fires only for context-capable engines. **Prefer `script:run`**, which delivers the data rather than a signal to go fetch it. |
| `bar` | the bar (OHLCV) | A live tick — the forming bar updated or a new bar appended. |
| `viewport:changed` | `{ from, to }` (epoch-ms) | The visible time range moved (pan/zoom/fit) — fires per applied change, not debounced. The seam viewport-sync links between charts build on. |
| `theme:changed` | the resolved theme object | The app theme changed — `setTheme(...)` or the in-chart settings dialog (Canvas → Theme). Host chrome around the chart (toolbars, panels, page shells) re-skins from the payload. Plot-only cosmetic edits (a `layout.background` set through the config) do **not** fire it. |
| `alert` | engine alert | A script raised an alert. |
| `warning` | engine warning | A script raised a warning. |

---

## `chart.renderer` — the renderer control surface

A thin facade over the active renderer for reading and changing **how the chart is drawn**
at runtime, with **no indicator re-run**. Unsupported keys/methods warn and no-op, so the
chart is never left half-changed.

| Member | Description |
|---|---|
| `name` | The active renderer's identity, e.g. `'native'`. |
| `capabilities` | What the renderer can draw (drives graceful degradation). |
| `supports(feature)` | Whether a feature is available — use to show/hide a UI control. |
| `get(feature)` | Read a feature's current value (`undefined` if unsupported). |
| `set(feature, value)` / `set({ … })` | Apply one feature, or several at once (one repaint). |
| `screenshot()` | Export the chart as a PNG data URL, or `null` if unsupported. Composites the geometry and chrome layers only — the crosshair, DOM overlays (tables, legend), user drawings, and the volume-profile layer are not included. |
| `getConfig()` | Snapshot the renderer's full cosmetics as a serializable, versioned JSON document (or `null`). |
| `applyConfig(config)` | Apply a full or partial config document from `getConfig()`; malformed/unknown fields are ignored. |
| `onConfigChanged(cb)` | Subscribe to cosmetic-config changes — the in-chart settings dialog commits through `applyConfig`, so this is how host chrome mirroring a config value (a time-zone display, a saved template) learns about in-chart edits. Re-pull `get(…)`/`getConfig()` in the callback. Returns an unsubscribe fn; silent no-op unsubscribe on a renderer without a rich config. |
| `onCrosshairMove(cb)` | Subscribe to crosshair movement — `time`/`price` under the cursor, per-series values, and the hovered bar's OHLC (null fields when the cursor leaves the chart). Returns an unsubscribe fn. The public seam for host status lines and data windows. |
| `dataWindowReadout()` | The bar under the crosshair (or the latest bar when the cursor is off the plot) as a display-ready snapshot: `date`, `time`, an `ohlc` block, and one `groups` entry per indicator with a row per plot in its own color. Values are pre-formatted on their pane's scale. `null` on a renderer without the seam — see [renderer features](./renderer-features.md#data-window-readout). |
| `setExternalCrosshair(time, price?)` | Show (or clear, with `null`) a **ghost crosshair** at a data-space position driven from OUTSIDE this chart — the multi-chart crosshair-sync seam ([the workspace](./workspace.md) drives it from the linked cells' pointers). A ghost never re-emits `onCrosshairMove` (one-way by contract — no echo loops). Silent no-op on a renderer without the optional port seam; feature-detect with `supportsExternalCrosshair`. |
| `set('dialogHost', el)` | Where the renderer mounts its MODAL dialogs (chart settings, indicator settings). Multi-chart shells pass their root element so dialogs center over the whole grid instead of clipping inside one cell — the workspace does this automatically for every cell. Runtime-only; never part of the config template. |
| `supportsExternalCrosshair` (getter) | Whether the active renderer implements the optional `setExternalCrosshair` seam (the native renderer does). |
| `focus()` | Move keyboard focus back onto the chart's interactive surface — call after a host control (e.g. a shared toolbar button) stole focus, so chart/drawing shortcuts keep working. Silent no-op on a renderer without a focusable surface. |

Feature-detect, read, and change how the chart is drawn at runtime — with no indicator re-run:

```js
// Only touch a feature the active renderer actually supports.
if (chart.renderer.supports('glow')) {
    console.log('glow is', chart.renderer.get('glow'));
    chart.renderer.set('glow', 0.6);
}

// Apply several features at once (one repaint).
chart.renderer.set({ logScale: true, currentPriceLine: false });
```

See [renderer-features.md](./renderer-features.md) for the full feature catalog (common +
native-specific) and config/screenshot examples.

---

## `chart.data` — the data control surface

A facade over the provider registry for **where candles come from**. Register one or more
market-data providers; the chart routes each symbol to the right one. No provider is bundled —
registering the one that resolves the chart symbol fires the parked initial load.

| Member | Description |
|---|---|
| `registerProvider(name, provider)` | Register (or replace) a provider; chainable. Fires the parked load when it resolves the symbol. |
| `unregisterProvider(name)` | Remove a provider. |
| `providers()` | Metadata for every registered provider. |
| `resolve(symbol)` | How a symbol routes now (`{ provider, ticker }`, or `null`). Accepts a provider-name prefix or a descriptor-declared **listing prefix** (`NASDAQ:AAPL` — strict: a wrong venue resolves to `null`). |
| `displayPrefix(symbol)` | The venue label to display — the descriptor's listing prefix when declared, else the resolved provider name. `null` while unresolvable. |
| `canonicalSymbol(symbol)` | The canonical `PREFIX:TICKER` form of the symbol (`edgx:aapl` → `NASDAQ:AAPL`). `null` while unresolvable. |
| `symbols(provider?)` | Indexed symbols for autocomplete — one provider, or all. |
| `symbolInfo(symbol)` | `Promise` of per-symbol metadata (Pine `syminfo.*`), via the owning provider. |
| `capabilities(symbol)` | The full resolved per-symbol `ProviderCapabilities` (behavior flags), or `null` while nothing resolves the symbol. |
| `ready()` | Resolves when every provider's symbol index has settled. |

Register the provider that resolves the chart symbol, then wait for both the index and the initial load:

```js
import { Vela } from '@luxalgo/vela';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';

const chart = new Vela('#chart', { symbol: 'BTCUSDT', timeframe: '1h' });

// Registering the provider that resolves the symbol fires the parked initial load.
chart.data.registerProvider('binance', new BinanceProvider());
await chart.data.ready(); // provider symbol indexes settled
await chart.ready();      // chart painted and interactive

console.log(chart.data.resolve('BTCUSDT'));            // { provider: 'binance', ticker: 'BTCUSDT' }
console.log(chart.data.symbols('binance').length, 'symbols indexed');
console.log(chart.data.capabilities('BTCUSDT'));       // ProviderCapabilities | null
```

On a chart given a custom `deps.dataFeed`, these warn and no-op (that feed owns its data). See
[data-providers.md](./data-providers.md) for symbol formats, resolution, and the load lifecycle.

---

## `chart.drawings` — the drawings control surface

A chainable facade over the interactive [drawing tools](./drawing-tools.md). The drawing **model is
core-owned**, so the *interactive* methods are capability-gated (they warn + no-op when the renderer
can't paint drawings — `chart.drawings.supported` reports this), while the **model methods**
(reading, persisting, undo) always work.

| Member | Gated? | Description |
|---|---|---|
| `supported` | — | Whether the renderer can paint interactive drawings. |
| `setTool(type \| null)` | yes | Arm a tool for the next clicks; `null` returns to select/idle. |
| `getTool()` | no | The armed tool (`null` = select/idle). Follow changes on `drawing:tool`. |
| `setSnapMode(mode)` · `getSnapMode()` | yes / no | The magnet: `'off' \| 'weak' \| 'strong'`. Changes land on `drawing:snap`. |
| `setStayMode(on)` · `getStayMode()` | yes / no | Stay in drawing mode: keep the tool armed after each placement. Changes land on `drawing:stay`. |
| `setMode(mode)` · `getMode()` | yes / no | Renderer-local mode: `'measure' \| 'eraser' \| null`. Mutually exclusive with armed tools (the renderer enforces it); changes land on `drawing:mode`. |
| `showToolbar(visible?)` | yes | Show/hide the on-chart toolbar. |
| `setToolbar(option)` | yes | Reconfigure the toolbar groups/tools live. |
| `setToolShortcuts(map)` | yes | Show per-tool shortcut hints in the toolbar flyouts — `{ trendline: 'Alt+T', … }`. Values are pre-formatted display strings: the host owns the keymap and the platform formatting. The widget/workspace push their own bindings automatically. |
| `add(type, init?)` | yes | Create a drawing from code; returns the `Drawing` (or `null` if unsupported). |
| `remove(id)` | no | Delete a drawing. |
| `update(id, patch)` | no | Apply a partial serialized record (for a custom settings UI). |
| `lock(id, v?)` · `show(id, v?)` | no | Lock/unlock · show/hide a single drawing. |
| `bringToFront(id)` · `sendToBack(id)` | no | Reorder paint order. With the `drawingDepth` capability they clear the whole stack — candles and indicators included, not just the other drawings. |
| `zIndex` (on `add`'s init and `update`'s patch) | no | The draw-order key. On a `drawingDepth` renderer it shares one space with the pane's series, so a drawing can sit under the candles or between two indicators — see [depth](./drawing-tools.md#depth-anywhere-in-the-stack). Persists with the drawing either way. |
| `undo()` · `redo()` · `canUndo()` · `canRedo()` | no | Snapshot history (core-owned). |
| `clone(id)` · `duplicate(ids)` | yes | Copy in place; the copies become the selection. |
| `copyToClipboard(ids)` · `paste()` | yes | In-memory, per-chart clipboard. |
| `all()` | no | Every drawing as plain JSON, in paint order. |
| `toJSON()` / `fromJSON(doc)` | no | Snapshot / restore a versioned `DrawingsDocument` (untrusted-safe). |
| `getConfig()` / `applyConfig(doc)` | no | Aliases of `toJSON` / `fromJSON`, mirroring `chart.renderer`. |

Drawing lifecycle is also surfaced as chart events (`drawing:created` / `drawing:edited` /
`drawing:removed` / `drawing:selected` / `drawing:settings`), and the tool/mode state as
`drawing:tool` / `drawing:snap` / `drawing:stay` / `drawing:mode` — the seam an external toolbar mirrors. See
[Drawing tools](./drawing-tools.md) for the tool catalogue, toolbar UX, and keyboard shortcuts.

---

## `deps` — the swap point

The optional third constructor argument is where you replace a layer's default with your own implementation of that layer's port:

| Key | Replaces | Guide |
|---|---|---|
| `renderer` | The drawing/output layer. Injects an already-constructed renderer *instance*, bypassing the `renderer` option's display-options wiring (a different axis from built-in vs custom — `options.renderer` already accepts any custom class too). | [Adding a renderer](../contributing/adding-a-renderer.md) |
| `engines` | Scripting engines to register at construction (bulk form of `registerEngine`). | [Scripting engines](./scripting-engines.md) · [Adding an engine](../contributing/adding-an-engine.md) |
| `dataFeed` | The market-data source. Replaces the default provider registry entirely with your own `MarketDataFeed` (used bare — no registry, no auto-cache). | [Adding a data provider](../contributing/adding-a-data-provider.md) |
| `motionPreference` | A shared `MotionPreferenceSource`. The workspace injects one observer into all cells; a standalone chart creates its own when this key is absent. The source remains host-owned, and `destroy()` only removes Vela's subscription. | [Options](./options.md#display--behavior-options) |

Each backend is one narrow port — implement it, declare its honest capabilities, and inject it here. The composition root is the only place that imports concrete backends.

## Session and motion helpers

The package root exports the same pure validation and policy helpers used by the built-in
shells:

| Export | Purpose |
|---|---|
| `normalizeSession(value)` | Trims an untrusted ID, preserves its case, and returns `undefined` for a non-string or empty value. |
| `normalizeSessionDefinitions(value)` | Validates and defensively copies a catalog, dropping invalid entries and later duplicate IDs. |
| `resolveMarketSession(candidate, definitions)` | Returns an exact catalog match, the first definition as fallback, or `undefined` for an empty catalog. |
| `MarketSessionDefinition` | The `{ id, label, windows, color }` host-catalog type. |
| `resolveMotionPolicy(animations, systemReduced)` | Resolves configured animation values and the effective reduced-motion gate without reading browser globals. |
| `ResolvedMotionPolicy` | The resolved zoom, pan, live-bar, intro, and `reduced` values delivered to a renderer. |
| `MotionPreferenceSource` | The injectable `{ reduced, onChange }` preference-observer contract. |

> The three *adding-a-backend* guides are **Contributing** docs and are still being written. Until they land, no link points at them — see the Contributing section of the [docs index](../index.md).

> **Stability:** The API is still stabilizing and will evolve as the library develops; pin a source revision if you need a fixed surface.
