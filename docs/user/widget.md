# The widget

`vela/widget` is the batteries-included chart app: a headless `Vela` core wrapped in a
complete, keyboard-first UI. One constructor gives you the topbar (symbol search,
timeframe and chart-style dropdowns, indicator picker, object tree), an in-chart status
line and watermark, and a bottom bar with range presets, a live clock, and a timezone
picker.

```ts
import { VelaWidget } from 'vela/widget';
import { PineEngine } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const widget = new VelaWidget('#chart', {
    // Everything VelaOptions accepts (symbol, timeframe, theme, live, …) plus:
    provider: 'binance',
    symbol: 'BTCUSDT',
    timeframe: '60',
    live: true,
    theme: 'dark',
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineEngine() },
    indicators: '/indicators.json',
    persist: true,
    urlState: true,
});
```

## Options

On top of every [chart option](./options.md), the widget adds:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `providers` | `Record<string, () => DataProvider>` | — | Provider **factories**, keyed by name. Called on every chart (re)build — a symbol or timeframe change destroys and recreates the inner chart, re-registering fresh provider instances. |
| `engines` | `Record<string, () => ScriptingEngine>` | — | Scripting-engine factories, keyed by language (same rebuild semantics). |
| `indicators` | manifest \| URL string | — | The indicator manifest — inline JSON or a URL returning it (see below). |
| `timeframes` | `string[]` | `['1','5','15','60','240','D','W']` | The topbar timeframe presets. |
| `priceStyle` | string | `'candles'` | Initial chart style; changed live from the topbar dropdown. |
| `timezone` | IANA string | `'Etc/UTC'` | Initial display timezone; changed live from the bottom bar. |
| `statusline` / `watermark` / `bottombar` | boolean | `true` | Chrome toggles. |
| `persist` | boolean \| string | `false` | Bring the chart back as you left it — the widget persists its FULL state (the unified `getState()` document: market, prefs, renderer config, user drawings, indicators) and restores it at construction (`true` = key `'vela-widget'`; a string is the key). Old three-key payloads migrate transparently. |
| `storage` | `WidgetStorage` | localStorage | The persistence backend — inject a custom adapter (see below). |
| `urlState` | boolean | `false` | Mirror the persisted values (all but the watermark flag) in the URL query (`?symbol=…&interval=…&style=…&tz=…&bars=…`) — shareable links. A URL param **wins** over persisted state at load. |

## The indicator manifest

The widget takes its script library as **data** — an array (or `{ indicators: [...] }`
wrapper) of entries, inline or fetched from a URL:

```json
[
    { "name": "EMA 20", "script": "//@version=5\nindicator(\"EMA 20\", overlay=true)\nplot(ta.ema(close, 20))" },
    { "name": "My RSI", "url": "/scripts/rsi.pine", "language": "pine", "enabled": false }
]
```

- `script` is inline source; `url` fetches it (relative to the manifest URL).
- `enabled: false` entries don't auto-add — they appear in the **Indicators** picker for
  the user to toggle on. Toggles are live (add/remove on the current chart) and survive
  symbol/timeframe rebuilds.
- A broken entry is skipped with a console warning — one bad script never takes the
  chart down. A failing manifest URL throws.

## Keyboard

The widget is keyboard-first:

- Type a **letter** anywhere on the chart → the symbol search opens, seeded with it.
- Type a **digit** → the timeframe entry opens (`15`, `4h`, `D`, `3M`, … — a bare
  number is minutes, a bare letter means one unit).
- `alt+S` → download a PNG screenshot. `?` → the shortcuts panel.
- Drawing keys (undo/redo, copy/paste, delete, nudge) come from the core — see
  [Drawing tools](./drawing-tools.md).

Bindings are declarative descriptors on `widget.keymap` — `register({ id, keys: 'mod+shift+k',
label, category, scope?, run })` — and are listed automatically in the `?` panel. `'mod'`
is ⌘ on macOS and Ctrl elsewhere. Scopes stack: the widget pushes `'dialog'` while any of
its dialogs is open, muting chart-scope bindings.

## The chrome

- **Topbar** — symbol button (opens the search), timeframe dropdown, chart-style dropdown
  (built-ins ∪ [plugin chart types](../contributing/plugin-sdk.md), with their icons and
  labels), Indicators picker, Objects panel toggle, then any
  [contributed actions](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction)
  in the right-hand cluster.
- **Status line** — symbol + OHLC and change of the hovered bar (resting on the latest
  live bar), stacked above the renderer's indicator legend.
- **Object tree** — a docked panel listing every pane's indicators and the user drawings,
  with hide/show and remove actions, kept in sync with the chart's events.
- **Bottom bar** — range chips, a live clock, and the timezone picker. Each chip switches
  the timeframe, **fetches the depth its window needs**, and frames it: `1D`→1m, `7D`→5m,
  `1M`→30m, `3M`→1h, `6M`→4h, `YTD`/`1Y`→1D, `5Y`/`ALL`→1W. Changing the timeframe by hand
  leaves range mode (the chip clears and the fetch depth returns to your `bars` setting).
- **Context menus** — right-click the chart body, the price axis, or the time axis for
  zone-specific actions (copy price, reset view, screenshot, scale toggles).

## Widget state — the same surface as the workspace

The widget exposes the SAME state triplet as [the workspace](./workspace.md), speaking
the SAME document format — a widget is the single-cell case (`layout: '1'`, one `c1`
cell):

```ts
const state = widget.getState();
// → { version: 1, layout: '1', activeCellId: 'c1', timezone, favorites?,
//     cells: { c1: { symbol, provider?, timeframe, priceStyle, bars?, watermark?,
//                    rendererConfig, drawings, indicators } } }

widget.applyState(state); // untrusted-safe; applied IN PLACE (the chart survives)
widget.on('state:changed', () => {
    /* debounced (~500ms) — re-pull getState() */
});
```

One format means state moves freely between shells: a saved widget document drops into
a workspace slot as-is, and a workspace cell's state restores into a widget. Custom
flows — server snapshots, share links, templates — compose `getState`/`applyState`
directly.

## Custom persistence storage

`persist` writes through a **storage adapter** — localStorage by default. Inject any
backend by implementing `WidgetStorage` (methods may be synchronous *or* return
promises):

```ts
import { VelaWidget, type WidgetStorage } from 'vela/widget';

// Example: a REST-backed store (per-user server-side settings).
const restStorage: WidgetStorage = {
    async get(key) {
        const res = await fetch(`/api/settings/${encodeURIComponent(key)}`);
        return res.ok ? res.text() : null;
    },
    async set(key, value) {
        await fetch(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
    },
};

new VelaWidget('#chart', { persist: true, storage: restStorage, /* … */ });
```

ONE key is written: the unified state document (`getState()`, JSON-encoded) —
`persist: true` brings your chart back **as you left it**: market, prefs, renderer
config, user drawings, and indicators. Saves are debounced ~500ms and flushed on
unload/destroy. A pre-unified payload (the old three-key layout: prefs +
`<key>:config` + `<key>:drawings`) is migrated transparently — read once at boot,
rewritten unified on the first save, legacy sub-keys dropped.

Semantics to know:

- **Synchronous adapters** (localStorage-like) restore *before* the first chart build —
  no flash of defaults.
- **Asynchronous adapters** resolve after construction: the widget builds with its
  option defaults, then **late-applies** the document when it arrives (one in-place
  market switch if it changed; cosmetics re-skin live). URL params still win.
- Writes are **fire-and-forget** — the widget never blocks the UI on storage. The last
  write also fires on `beforeunload`; a remote adapter that must survive tab-close
  should use `navigator.sendBeacon` in its `set`.

## Market switches are in place

A symbol, timeframe, or fetch-depth change switches the inner chart's market **in
place** (`chart.setMarket`): the chart instance survives, so **indicators, user
drawings, renderer config, and your event subscriptions all carry over** — the chart
reloads its bars and re-executes what's running over the new market. The widget
reflects out-of-band switches too (host code calling `widget.chart.setMarket`
directly) via the chart's `market:changed` event.

The inner chart is destroyed and recreated (providers/engines re-registered from
their factories, manifest indicators re-added) only at construction. `widget.chart`
still points at the **current** inner chart — prefer reading it at the point of use
rather than caching it long-term.

## Customization

Three levels, shallow to deep:

1. **Design tokens** — all chrome is styled through `--vela-*` CSS custom properties
   (surfaces, borders, focus, radii, spacing, z-index). Override them on the container.
2. **Stable class names** — every component uses prefixed classes (`.vela-dialog`,
   `.vela-menu-item`, `.vela-sp-row`, …) your CSS can restyle.
3. **Contributed actions** — plugins and hosts add topbar buttons and context-menu items
   as data descriptors via
   [`registerWidgetAction`](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction);
   the kit's primitives (`Dialog`, `Menu`, `Tooltip`, `KeymapManager`) are exported from
   `vela/ui` for building your own panels against the headless core.
