# The widget

`vela/widget` is the batteries-included chart app: a headless `Vela` core wrapped in a
complete, keyboard-first UI. One constructor gives you the topbar (symbol search,
timeframe and chart-style dropdowns, indicator picker, object tree), an in-chart status
line and a symbol watermark on the price pane, and a bottom bar with range presets, a live clock, and a timezone
picker.

```ts
import { VelaWidget } from 'vela/widget';
import { PineEngine } from '@luxalgo/vela-pinets'; // Vela ships no engine — see ./scripting-engines.md
import { BinanceProvider } from 'vela/providers/binance';

const widget = new VelaWidget('#chart', {
    // Everything VelaOptions accepts (symbol, timeframe, theme, live, …) plus:
    symbol: 'BTCUSDT', // bare = first declared provider; 'coinbase:BTC-USD' pins a venue
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

On top of every [chart option](./options.md), the widget adds the **shell options** —
the surface it shares, name for name and meaning for meaning, with
[the workspace](./workspace.md) (`VelaShellOptions`) — plus one extra of its own,
`urlState`:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `providers` | `Record<string, () => DataProvider>` | — | Provider **factories**, keyed by name. Called on every chart (re)build — a symbol or timeframe change destroys and recreates the inner chart, re-registering fresh provider instances. |
| `engines` | `Record<string, () => ScriptingEngine>` | — | Scripting-engine factories, keyed by language (same rebuild semantics). Merged OVER any app-level defaults registered with `registerDefaultEngine` (`vela/plugin`) — the instance option wins per language. |
| `indicators` | manifest \| URL string | — | The indicator manifest — inline JSON or a URL returning it (see below). |
| `timeframes` | `string[]` | `['1','5','15','60','240','D','W']` | The topbar timeframe presets. |
| `timezone` | IANA string | `'Etc/UTC'` | Initial display timezone; changed live from the bottom bar. |
| `statusline` / `watermark` / `bottombar` | boolean | `true` | Chrome toggles (`bottombar` governs the mobile bottom bar too). |
| `indicatorPicker` | boolean | `true` | The built-in indicator dialog's entry points — the topbar *Indicators* button, the mobile-bar item, and the `/` shortcut. `false` removes them, for hosts that ship their own indicator UI (see [Replacing the indicator menu](../contributing/plugin-sdk.md#replacing-the-indicator-menu)). The `indicators` manifest still resolves and auto-adds. |
| `layoutMode` | `'auto'` \| `'mobile'` \| `'desktop'` | `'auto'` | The chrome size class. `'auto'` follows the **container** width (plus a coarse-pointer heuristic for tablets) and re-evaluates live; the explicit values pin it. See [Mobile](#mobile). |
| `autofocus` | boolean | `false` | Focus the chart on mount so keyboard shortcuts work from the first keystroke. Off by default: an embedded chart should not steal the page's focus. |
| `persist` | boolean \| string | `false` | Bring the chart back as you left it — the widget persists its FULL state (the unified `getState()` document: market, prefs, renderer config, user drawings, indicators) and restores it at construction (`true` = key `'vela-widget'`; a string is the key). Old three-key payloads migrate transparently. |
| `storage` | `VelaStorage` | localStorage | The persistence backend — inject a custom adapter (see below); one contract for both shells. |
| `urlState` | boolean | `false` | Mirror the persisted values (all but the watermark and indicator-titles flags) in the URL query (`?symbol=…&interval=…&style=…&tz=…&bars=…`) — shareable links. A URL param **wins** over persisted state at load. |

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
- `mod+↑/↓` glide-zoom, `mod+←/→` glide-pan with the exact feel and limits of a drag
  (toward now it rests on the newest candle plus the usual empty space). `alt+T` arms the
  trend line tool; `alt+H` /
  `alt+V` drop a horizontal / vertical line at the cursor — the drawing toolbar's menus show
  these chords beside the tools.
- Mouse: `Shift`+scroll pans through history instead of zooming, `Shift`+click starts the
  measure ruler at the cursor, and middle-click deletes the drawing under it.
- Drawing keys (undo/redo, copy/paste, delete, nudge) come from the core — see
  [Drawing tools](./drawing-tools.md).

Bindings are declarative descriptors on `widget.keymap` — `register({ id, keys: 'mod+shift+k',
label, category, scope?, run })` — and are listed automatically in the `?` panel. `'mod'`
is ⌘ on macOS and Ctrl elsewhere. Scopes stack: the widget pushes `'dialog'` while any of
its dialogs is open, muting chart-scope bindings.

Shortcuts fire while keyboard focus is **inside the widget** (any click on the chart puts
it there). For a page where the chart is the main content, set `autofocus: true` so they
work from the very first keystroke, before any click.

## The chrome

- **Topbar** — symbol button (opens the search), timeframe dropdown (hover a row to
  star a favorite: starred timeframes sit as duration-sorted chips, the current one
  highlighted in place; an unstarred current sits next to the caret, and the caret
  opens the full list — or the combined label+caret when nothing is starred), chart-style dropdown
  (built-ins ∪ [plugin chart types](../contributing/plugin-sdk.md), with their icons and
  labels), Indicators picker, undo/redo (same history as Ctrl+Z / Ctrl+Y), data-window and
  object-tree panel toggles, then any
  [contributed actions](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction)
  in the right-hand cluster.
- **Status line** — symbol + OHLC and change of the hovered bar (resting on the latest
  live bar), stacked above the renderer's indicator legend.
- **Object tree** — a docked panel grouping every item under the pane it belongs to. Each pane is
  one column read top to bottom as front to back: its drawings, its indicators and, in the main
  pane, the price series, all in draw order — new indicators and new drawings both start under
  the price, so the candles stay readable. Rows carry hide/show, lock and remove; right-clicking one opens the rest
  (duplicate, restack, and moving an indicator to another pane or a new one), and each pane's
  header carries its reorder/collapse/maximize controls. Rows are also draggable — onto a pane to
  move an item there, onto the band between two panes to open a new one, or to any slot in a
  pane's column to set draw order, a drawing under the candles or between two indicators included
  — with a ghost label and a drop hint while the drag is live. Drawings can be multi-selected
  (Ctrl/Cmd-click) and bundled into a named group that hides, locks, deletes and drags as one
  block; groups live for as long as the chart and are not persisted. Kept in sync with the
  chart's events.
- **Data window** — the other docked panel: the date and time of the bar under the crosshair,
  its OHLCV tinted with the bar's direction, then one section per indicator showing each plot's
  value in its own color. It follows the crosshair and falls back to the latest bar when the
  pointer leaves the chart. The two panels share the dock, so opening one closes the other.
- **The dock** — the column both panels live in, and the one plugins extend
  ([`registerSidePanel`](../contributing/plugin-sdk.md#side-panels--registersidepanel)): every
  panel gets a toggle in the topbar's panel group, one panel shows at a time, and a panel that
  declares itself resizable has a drag handle on its inner edge (double-click returns it to its
  declared width). Which panel is open and the widths you dragged are part of the saved state.
- **Bottom bar** — range chips, a live clock, and the timezone picker. Each chip switches
  the timeframe, **fetches the depth its window needs**, and frames it: `1D`→1m, `7D`→5m,
  `1M`→30m, `3M`→1h, `6M`→4h, `YTD`/`1Y`→1D, `5Y`/`ALL`→1W. Changing the timeframe by hand
  leaves range mode (the chip clears and the fetch depth returns to your `bars` setting).
- **Context menus** — right-click the chart body for reset view, removing all drawings or all
  indicators, and the settings dialog; the price axis for that pane's own scale (autoscale,
  invert, regular/percent/indexed/logarithmic, and the label and level toggles); the time axis
  for the display timezone. Every pane's price scale has its own menu, so a study pane's scale
  is independent of the main one. Each menu's settings entry opens the settings dialog on the
  tab that belongs to it — Canvas from the chart body, Scales and lines from either axis.

## Mobile

In a container narrower than ~640px (or up to ~920px with a coarse pointer — a
tablet), the widget switches to its **mobile chrome**; `layoutMode: 'mobile'` or
`'desktop'` pins the choice. The mode is container-driven and live: resizing across
the breakpoint swaps the chrome in place, closing whatever was open in the other
presentation.

What changes on mobile:

- **One bottom bar replaces both desktop bars**, left to right: the symbol button
  (full-screen symbol search), the timeframe button (a bottom sheet with the date-range
  presets on top and the timeframe grid below), indicators (the full-screen picker),
  drawings (a bottom sheet with a search bar, the tool groups as scrollable tabs, and
  favorite stars), a three-dots sheet (undo/redo, screenshot, chart type, the side
  panels, time zone, alerts, and contributed topbar actions), and chart settings.
- **The docked drawing toolbar hides.** Picking a tool from the drawings sheet arms it
  and shows a floating pill over the chart — the armed tool's icon, the magnet cycle,
  stay-in-drawing-mode, the eraser, and ✕ to disarm. Favorites keep working (stars in
  the sheet), so a radial-wheel-style picker built on them keeps its data.
- **Dialogs go full-screen** — symbol search, the indicator picker, indicator settings,
  and chart settings, where the section rail sits behind a burger button, a section's
  group list becomes scrollable tabs at the top, and instance strips scroll sideways.
- **Side panels** (data window, object tree, contributed) open over the chart instead
  of docking a column beside it.
- **The indicator legend starts collapsed** behind its count chip (tap to unfold) — a
  phone-width plot has no room for the rows. The object tree's per-indicator action
  menu carries an "Indicator settings" entry, so settings stay reachable without the
  legend gear.
- **Touch gestures**: one-finger pan (with the usual fling), two-finger pinch zoom
  anchored between the fingers, and a **long-press** that inspects with the crosshair —
  the view stays put while the finger drives the readout; lifting clears it. A
  **double-tap** mirrors the desktop double-click: on the price axis it resets that
  pane's scale to auto, on the time axis it fits the view to content, and inside the
  plot it maximizes the tapped pane (price or indicator) — a second double-tap
  restores the split. The price/time axis strips still drag-rescale, and the button
  that jumps back to the most recent bar stays visible whenever the chart has data.

Embedders need nothing special: the mode also reaches the renderer's own chrome, and a
chart in a phone-sized *container on a desktop page* gets the same treatment — the
widget's own bounds, not the viewport, are what count.

## Widget state — the same surface as the workspace

The widget exposes the SAME state triplet as [the workspace](./workspace.md), speaking
the SAME document format — a widget is the single-chart case (`layout: '1'`, one
`charts` entry):

```ts
const state = widget.getState();
// → { version: 1, layout: '1', activeCellId: 'c1', timezone, favorites?,
//     timeframeFavorites?, panels?: { open?, widths? },
//     charts: [{ id: 'c1', symbol, provider?, timeframe, priceStyle, bars?, watermark?,
//                indicatorTitles?, rendererConfig, drawings, indicators }] }

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
backend by implementing `VelaStorage` (one contract for both shells; methods may be
synchronous *or* return promises):

```ts
import { VelaWidget, type VelaStorage } from 'vela/widget';

// Example: a REST-backed store (per-user server-side settings).
const restStorage: VelaStorage = {
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

The default adapter is available as `localStorageAdapter(storageKey?)`: give it a name
to PIN the physical localStorage entry (every read/write lands there, whatever the
`persist` key is — one shell instance per pinned adapter); omit it to use the shell's
own key.

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

## Theming

The `theme` option (`'dark'`, `'light'`, or a full theme object) skins the whole widget —
chart, topbar, menus, panels. Swap it at runtime with `widget.setTheme(...)`: the chart
re-skins live and the widget chrome follows, no rebuild. Users reach the same switch in
chart settings → Canvas → Theme. The built-in themes share the same candle colors, so
switching never recolors the series.

## Customization

Three levels, shallow to deep:

1. **Design tokens** — all chrome is styled through `--vela-*` CSS custom properties
   (surfaces, borders, focus, radii, spacing, z-index). Override them on the container.
2. **Stable class names** — every component uses prefixed classes (`.vela-dialog`,
   `.vela-menu-item`, `.vela-sp-row`, …) your CSS can restyle.
3. **Contributed actions** — plugins and hosts add topbar buttons and context-menu items
   as data descriptors via
   [`registerWidgetAction`](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction);
   the kit's primitives (`Dialog`, `Drawer`, `Menu`, `Tooltip`, `Popover`, `Switch`,
   `Select`, `NumberInput`, `TextField`, `ColorField` / `buildColorPicker`,
   `KeymapManager`) are exported from `vela/ui` for building your own panels against
   the headless core. Form controls share `md` (settings dialogs: 34px fields, hover
   steppers, chip colors) and a compact `sm` size so a host panel can match either
   surface.
