# API Reference

This is a hand-written, conceptual reference for the Vela public surface — what each piece is for and how the pieces bind. A generated type reference (from the source declarations) may be added later; for now this prose is the source of truth.

## The mental model

Vela is a small **core** plus three independently swappable **layers** — data providers, scripting engines, and renderers — each reached through a single narrow **port**.

The **neutral model** — bars, series, pane overlays, drawings, inputs, update patches — is the only thing that crosses a port. No backend-specific type ever leaks across. That opacity is what makes each layer swappable. The bundled defaults are plain **swappable defaults**: the native renderer, the Pine scripting engine (in-process and Web-Worker forms), and the provider-backed, cache-wrapped data feed.

> Vela installs **from source**; the `'vela'` imports in these snippets refer to the local workspace package (see [installation.md](./installation.md)).

Higher-level shells are documented on their own pages: [the widget](./widget.md) (`vela/widget` — one chart, full chrome) and [the workspace](./workspace.md) (`vela/workspace` — a multi-chart grid with one shared chrome and sync links). Both expose the SAME state surface — `getState()` / `applyState()` / `state:changed` over one shared document format (the widget is the single-cell case) — which is also what their `persist` option writes.

---

## `class Vela(container, options?, deps?)`

The public, imperative chart and the composition root — the one place that wires concrete backends.

- **`container`** — an `HTMLElement` or a CSS selector string. A missing selector throws.
- **`options`** — display, behavior, and market options. See [options.md](./options.md).
- **`deps`** — the **swap point** for the three layers (see below).

Constructing a chart renders candles immediately. Scripting engines are opt-in.

### Core methods

| Method | What it does |
|---|---|
| `registerEngine(language, engine)` | Register a scripting engine under a language id so `addIndicator` can run that language. No engine is registered by default. Re-registering a language replaces it (affects future indicators only). Returns the chart for chaining. |
| `addIndicator(source, options?)` | Run an indicator script over the chart's market data and render it. Returns an **`IndicatorHandle` synchronously**; values fill in asynchronously. See [options.md](./options.md) for per-indicator options. |
| `addNativeIndicator(type, options?)` | Add a core-computed (non-scripting) **native indicator** by registered `type`. Returns an `IndicatorHandle` (same lifecycle: legend row, eye/remove, events). **Single-instance per type** — a second call returns the existing handle. The built-in types are `'volume'` (auto-added) and `'vpvr'` (the visible-range volume profile); plugin chart types can register more. `options.inputs` seeds inputs. Native renderer only; an unregistered type returns a fail-soft handle that never mounts. |
| `runIndicator(source, options?)` | Execute a script and **inject it only if the run succeeds** — the seam for host editors/consoles. Resolves `{ ok: true, handle }` after the first successful evaluation, or `{ ok: false, error, context }` on a compile/runtime failure — `context` is the post-mortem execution-context snapshot when the engine had produced one, and the failed indicator is removed again (no dead legend row). Never rejects. |
| `indicators()` | Live `IndicatorHandle[]` of everything on the chart (script + native), in insertion order — the seam for host panels (object trees, indicator lists) that need per-id visibility/removal. |
| `availableNativeIndicators()` | Returns `Promise<NativeIndicatorInfo[]>` — the catalog of built-in native indicators with their live state on this chart, for building an "add indicator" picker UI (lets a host list them, gate unsupported ones, avoid duplicates). Async because support may need to probe the provider (a type may need data the symbol lacks). |
| `setMarket(next)` | Switch the chart's market **in place** — `{ symbol?, provider?, timeframe?, bars?, data?, visibleRange? }` — without destroying the chart. Only the fields given change. Indicators re-execute over the new bars, native indicators restart, and panes, user drawings, renderer config and event subscriptions all **survive**. Resolves once the new market's history is painted (a deep backfill continues behind it — await `historyComplete()`); a call superseded by a newer `setMarket` resolves silently. Emits `market:changed` when the market identity changed (a depth-only `bars` reload is silent). `visibleRange` frames the first paint of the new market. Drawings are kept as-is — per-symbol drawing documents are a host policy (`chart.drawings.toJSON()/fromJSON()` keyed off `market:changed`). |
| `market` (getter) | The current market identity — the read counterpart of `setMarket`. A **snapshot** `{ symbol?, provider?, timeframe?, bars?, offline }` of the *requested* market: it reflects an in-flight switch immediately (before the new bars land), which is what persist-on-close flows want. Listen to `market:changed` for *committed* identity changes. Mutating the returned object changes nothing. |
| `ready()` | Returns a promise that resolves once the chart is painted and interactive. On a deep-history chart (beyond one ~10k-bar chunk) older bars keep backfilling **behind** this — await `historyComplete()` for the full depth. |
| `historyComplete()` | Returns a promise that resolves once the **current load's** full requested history has loaded — immediately for small/offline charts, after the background backfill for deep ones. **Per-load**: each `setMarket` re-arms the cycle (the superseded load's promise resolves rather than hanging), so call it again after a switch for the new market's depth. Never rejects: on destroy or a failed backfill it resolves with whatever depth loaded. |
| `on(event, handler)` | Subscribe to a chart-level event. Returns an unsubscribe function. |
| `getVisibleRange()` | The current visible time range (`{ from, to }` in epoch-ms), or `null` before data loads. |
| `setVisibleRange(range)` | Set the visible time range explicitly (epoch-ms). Returns the chart for chaining. |
| `panBy(fraction)` | Pan by a fraction of the visible width — positive ⇒ toward the latest bars, negative ⇒ into history. Behaves exactly like dragging the chart: constant zoom, the same pan limits (forward stops at the newest candle plus the bounded empty space), eased on renderers that animate pans; repeated calls stack into one continuous scroll. The widget's `Ctrl/Cmd + ←/→` keys use it. Returns the chart for chaining. |
| `setVisibleRangePreset(preset)` | Frame a named date range over the loaded bars: `'1D'`, `'1W'`, `'1M'`, `'3M'`, `'6M'`, `'1Y'`, `'5Y'`, `'YTD'`, or `'ALL'`. A preset deeper than the loaded history just frames everything (it doesn't fetch more bars — the widget's range chips do that for you). Returns the chart for chaining. |
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

A minimal end-to-end setup — construct over data, register the Pine engine, add an indicator, then await the first render:

```js
import { Vela, PineEngine } from 'vela';

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
| `inputs` | The inputs parsed from the script source — each with a `key`, `title`, `type`, `defval`, and optional `min`/`max`/`step`/`options`/`group`/`inline`/`tooltip`. Populated once the script is prepared. |
| `visible` | Whether the indicator is currently shown. |
| `setInput(key, value)` | Change one input by its key. Triggers a re-run (an input edit can restructure output, so this may remount the indicator). |
| `setInputs(values)` | Change several inputs at once, keyed by input key or title. |
| `setVisible(visible)` | Hide or show the indicator. Hiding suspends it — its visuals are dropped and its computation stops; showing re-runs it over the current bars. |
| `on(event, handler)` | Per-indicator events — `ready`, `error` (`{ error }`), `alert` (`{ id, message, title?, time }`). Returns an unsubscribe function. |
| `context(select?)` | `Promise` of a **read-only, serializable snapshot** of the engine's execution context — see [below](#reading-a-scripts-execution-context). `null` when the engine lacks the capability or nothing ran yet. |
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

### Reading a script's execution context

`handle.context(select?)` resolves a **read-only snapshot** of the engine's execution
context — the host-side window into a running script:

| Field | What it is |
|---|---|
| `phase` | `'computing'` (static run in flight), `'streaming'` (live session), `'idle'`. |
| `barIndex` | Index of the last computed bar. |
| `meta` | `{ title, overlay, precision?, shorttitle? }`. |
| `plots` | Named plot outputs — per key, index-aligned `{ time, value }` points. |
| `variables` | The script's **serializable** variables, bucket-prefixed (`params.length`, `var.acc`, …). Functions, live series, and `_private` names are dropped. |
| `result` | The script's **return value** — the designed data-out channel: a script that wants to hand structured data to host code simply returns it. |
| `warnings` | The run's warnings. |

Three guarantees: it is **read-only** (always a deep copy — mutating it never touches the
engine), **async everywhere** (same API on the in-process and Web-Worker engines; the
context itself never leaves the worker, only the snapshot crosses), and **selective** —
pass `select` to extract only some keys and keep worker transfers small.

```js
const handle = chart.addIndicator(`//@version=5
indicator("Levels")
// ... compute ...
return { support: 64200, resistance: 66800 }`);

handle.on('ready', async () => {
    const snap = await handle.context(['result', 'barIndex']);
    console.log(snap.result); // { support: 64200, resistance: 66800 }
});

// Streaming: re-pull on the throttled notification (~1/s per indicator).
chart.on('context:changed', async ({ id }) => {
    if (id !== handle.id) return;
    const { result } = await handle.context(['result']);
    // feed dashboards, alerts, external tooling…
});
```

On a `runIndicator` failure the same snapshot is attached post-mortem
(`{ ok: false, error, context }`) — the state at the moment of the crash.

---

## Chart-level events

Subscribe with `chart.on(event, handler)`; every subscription returns an unsubscribe function.

| Event | Payload | Fires when |
|---|---|---|
| `ready` | — | The chart is painted and interactive (a deep chart's history may still be backfilling). |
| `market:changed` | `{ symbol, timeframe, prev: { symbol, timeframe } }` | The market switched **in place** via `setMarket` — symbol, provider, timeframe, or offline data changed (a depth-only reload does not fire). Fires after the new market's history is painted and every consumer restarted. `prev` lets hosts re-key per-symbol state (e.g. swap user-drawing documents between symbols). |
| `history:progress` | `{ loaded, target }` | A deep-history backfill chunk landed — `loaded` of `target` bars are on the chart. |
| `history:complete` | `{ reason, oldestTime, barsLoaded }` | The history load finished. `reason`: `'depth'` (requested count loaded), `'genesis'` (the source has nothing older), or `'aborted'` (a fetch failed — the chart keeps what loaded). Fires exactly once, including for small/offline charts. |
| `indicator:added` | `{ id }` | An indicator was added. |
| `indicator:removed` | `{ id }` | An indicator was removed. |
| `indicator:error` | `{ id, error }` | An indicator failed. |
| `context:changed` | `{ id }` | An indicator's execution context advanced (run finished; throttled to ~1/s while streaming). Re-pull `handle.context()` if you consume it. Fires only for context-capable engines. |
| `bar` | the bar (OHLCV) | A live tick — the forming bar updated or a new bar appended. |
| `viewport:changed` | `{ from, to }` (epoch-ms) | The visible time range moved (pan/zoom/fit) — fires per applied change, not debounced. The seam viewport-sync links between charts build on. |
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
| `resolve(symbol)` | How a symbol routes now (`{ provider, ticker }`, or `null`). |
| `symbols(provider?)` | Indexed symbols for autocomplete — one provider, or all. |
| `symbolInfo(symbol)` | `Promise` of per-symbol metadata (Pine `syminfo.*`), via the owning provider. |
| `capabilities(symbol)` | The full resolved per-symbol `ProviderCapabilities` (behavior flags), or `null` while nothing resolves the symbol. |
| `ready()` | Resolves when every provider's symbol index has settled. |

Register the provider that resolves the chart symbol, then wait for both the index and the initial load:

```js
import { Vela } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

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
| `engines` | Scripting engines to register at construction (bulk form of `registerEngine`). | Adding an engine *(in progress)* |
| `dataFeed` | The market-data source. Replaces the default provider registry entirely with your own `MarketDataFeed` (used bare — no registry, no auto-cache). | [Adding a data provider](../contributing/adding-a-data-provider.md) |

Each layer is one narrow port — implement it, declare its honest capabilities, and inject it here. The composition root is the only place that imports concrete backends.

> The three *adding-a-backend* guides are **Contributing** docs and are still being written. Until they land, no link points at them — see the Contributing section of the [docs index](../index.md).

> **Stability:** The API is still stabilizing and will evolve as the library develops; pin a source revision if you need a fixed surface.
