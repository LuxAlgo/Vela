# The workspace (multi-chart)

`vela/workspace` is the multi-chart shell: a grid of full Vela charts behind **one
shared data feed**, wrapped in **one shared chrome** — topbar (symbol / timeframe /
style / **layout** dropdowns, indicator picker, alerts), one drawing toolbar, object
tree, data window, bottom bar, one keyboard map — that always **reflects and acts on the
ACTIVE cell**. Cells are switched in place (`setMarket` under the hood), so indicators,
drawings, and your subscriptions survive every symbol/timeframe change.

```ts
import { VelaWorkspace } from 'vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets'; // Vela ships no engine — see ./scripting-engines.md
import { BinanceProvider } from 'vela/providers/binance';

const ws = new VelaWorkspace('#app', {
    layout: '4', // '1' | '2h' | '2v' | '4' | '8' | picker ids ('g3x2') | a registerLayout() id
    //           // `false` = SINGLE-CHART mode: one cell, no layout picker or sync
    //           // switches anywhere, `setLayout` no-ops, no `cells` entry needed
    // Chart options at the TOP LEVEL are every cell's DEFAULT — the same words the
    // widget (and the bare chart) use. `cells` overrides them per cell; a cell's NAME
    // is its durable identity, DECLARATION ORDER fills the layout's slots:
    symbol: 'BTCUSDT',
    timeframe: '60',
    cells: {
        btc: { symbol: 'BTCUSDT', timeframe: '60' }, // 1st declared → 1st slot
        eth: { symbol: 'ETHUSDT', timeframe: '15' }, // slots 3–4: no entry → pure defaults
    },
    providers: { binance: () => new BinanceProvider() }, // registered ONCE, shared by every cell
    engines: { pine: () => new PineWorkerEngine() }, // instantiated per cell (a worker each)
    live: true,
    theme: 'dark',
    sync: { viewport: true }, // optional links — see below
    persist: true, // state persistence (localStorage by default — see State & persistence)
});
```

**One options vocabulary.** `VelaWorkspaceOptions` = the widget's chart options (all of
`VelaOptions` except `height` — the grid sizes its cells) + the shared shell surface
(`providers`, `engines`, `indicators`, `timeframes`, `timezone`, chrome toggles,
`persist`/`storage`) + the grid's own options (`layout`, `cells`, `sync`,
`drawingToolbar`, `maxWebglCells`, `alertCap`). A chart option means the same thing
everywhere: on the widget it configures *the* chart, here it is the *default* of each
cell — `upColor`, `glow`, `logScale`, `animations`, `defaultLanguage`, even `renderer`
all apply to every cell. An explicit `nativeBackend` (other than `'auto'`) wins over
the `maxWebglCells` budget policy.

The `drawings` option applies here too, mapped onto the SHARED drawing surface:
`false` removes it entirely — no toolbar, no mobile drawings entry, no tool pill (the
programmatic `chart.drawings` API stays) — and `{ tools }` / `{ groups }` pick what
the shared toolbar offers. Only its `toolbar` sub-key changes meaning: one shared bar
serves the grid, so per-cell in-chart bars never render (`drawingToolbar: false` hides
the shared bar itself).

Alerts from every cell aggregate in the topbar bell, newest first, each entry naming
its source as `SYMBOL timeframe Indicator`; `alertCap` bounds how many are kept
(default 50). `ws.toast(message, kind?, durationMs?)` shows a host notice on the same
surface.

## Single chart (`layout: false`)

`layout: false` pins the workspace to **one chart**: the layout picker and the sync
switches disappear (desktop and mobile), `setLayout` is a no-op, and no `cells` entry
is needed — the top-level chart options seed the single chart. Everything else on this
page applies unchanged; the state document is simply the single-cell case
(`layout: '1'`, one `charts` entry).

```ts
const chart = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'BTCUSDT',
    timeframe: '60',
    providers: { binance: () => new BinanceProvider() },
    persist: true,
});
```

> **Migrating from `VelaWidget`.** The old single-chart class is deprecated and now
> wraps exactly this. Replace `new VelaWidget(el, opts)` with
> `new VelaWorkspace(el, { ...opts, layout: false })`; pass `persist: 'vela-widget'`
> to keep reading the state the widget stored. The widget-only `urlState` option is
> gone — encode `getState()` into your own URL scheme if you need shareable links.

## Cells and the active cell

A cell's **identity** is its declared name (`btc`, `eth`, … — the keys of `cells`), or
`c<N>` for a slot no entry declared. It is durable and never content: the symbol,
timeframe, style, indicators and drawings are mutable state *of that identity*. The
layout's own `c1`…`cN` are slot POSITIONS, and declaration order is what maps an identity
onto one. Identity is also what survives a layout change, so `4 → 2h → 4` restores the
third and fourth cells exactly (market, renderer config, drawings, indicators) from the
workspace pool.

```ts
ws.active;               // the ChartCell the shared chrome reflects/acts on
ws.chart;                // shortcut ≡ ws.active.chart (the widget.chart habit)
ws.cell('eth');          // a specific cell BY IDENTITY — the durable handle to hold
ws.cells();              // every live cell, in slot order
ws.setActiveCell('sol');
ws.setLayout('8');       // cells diff BY IDENTITY; identities past the new size pool their state
// Shrinking never pools the ACTIVE chart: if its slot would leave the layout, it
// moves into the last surviving slot instead (the other cells keep their order).
ws.setTheme('light');    // re-skins the shared chrome + EVERY cell live (also reachable from any cell's chart settings → Canvas → Theme)
ws.on('cell:active' | 'layout:changed' | 'cell:created' | 'cell:destroyed' | 'state:changed', cb);
```

**Rule of thumb:** hold the cell (or its identity), read `cell.chart` at the point of
use. The chart instance survives market changes and only dies when its cell leaves the
layout (`cell:destroyed`). Host code that tracks cells should **follow
`cell:created`/`cell:destroyed`** rather than snapshot `ws.cells()` once: a later
`setLayout` (or a restored document) mints cells that a one-time snapshot never sees.

Layouts live in a registry (`registerLayout` from `vela/workspace`), and the topbar's
**layout dropdown** composes them on a 4×4 grid canvas: hover previews the full
*columns × rows* rectangle from the top-left (the table-insert idiom); a click
applies it immediately. Rectangles matching a classic preset (`1`, `2h`, `2v`, `4`,
`8`) reuse it; anything else gets a self-describing dynamic id (`g3x2` = 3 rows ×
2 columns) that resolves without registration (persisted picks restore across boots).
Plugin layouts the canvas cannot express (bespoke `areas`) list as labeled rows under
the canvas, so `registerLayout` contributions keep appearing automatically. In code,
the same composition is `layoutForGrid(rows, cols)` (exported from `vela/workspace`),
handed to `ws.setLayout(...)`.

Splitters between cells resize the grid tracks (double-click a divider for an even
split).

## Sync links

Per kind — `viewport`, `symbol`, `timeframe`, `crosshair`, `drawings` — link every cell
(`true`) or named groups keyed by cell IDENTITY (`{ btc: 'a', eth: 'a', sol: 'b' }`:
only same-group cells follow each other). Cross-timeframe viewport groups align on the
**right edge** (a finer-timeframe cell clamps the window to its own minimum zoom).

`crosshair` mirrors the pointer's TIME onto same-group cells as a **ghost crosshair**
(a dimmed vertical line snapped to each follower's own bar, with its time chip);
leaving the origin clears every ghost. The ghost needs the renderer's optional
`setExternalCrosshair` seam — the native renderer has it; a custom renderer without it
simply never shows one (enabling warns only when NO cell could).

`drawings` copies each **newly created** drawing onto its same-group cells — the
anchors are time+price, so the copy lands at the same spot whatever each follower
shows — and keeps the set **linked**: moving/restyling/deleting any member follows on
its peers (while the link stays on). Placement itself mirrors **live**: while you are
still clicking anchors, the followers show the in-progress shape as a reduced-opacity
ghost (the same seam as crosshair ghosts — a custom renderer without it simply syncs
at completion). Link membership is session-scoped and survives a toggle-off: turning
the link off freezes create/edit/delete propagation (and clears placement ghosts) but
keeps the in-memory pairs, so re-enabling resumes edit/delete for drawings that were
linked earlier in the session. Drawings created while the link was off stay
independent — re-enabling never copies or pairs them. A reload (or `applyState`)
drops the pairs, so previously synced drawings are independent again.

**Symbol**, **Interval** (timeframe) and **Crosshair** are also switches in the
topbar's layout dropdown (its SYNC section), and **Drawings** is a toggle on the
shared drawing toolbar (the pen-with-panes icon under stay-in-drawing-mode). A
switch reflects the simple all-cells form (`true`/off); flipping one overrides a
host-set group record with plain on/off — group records stay an API-only shape.

```ts
ws.sync.set('viewport', true); // aligns followers to the active cell, then follows pans
ws.sync.set('symbol', { btc: 'watch', eth: 'watch' });
ws.sync.set('crosshair', true); // hover any cell → ghost time-line on all the others
ws.sync.set('drawings', true); // draw on any cell → the same drawing on all the others
ws.sync.get('viewport'); // true
ws.sync.state(); // { viewport: true, symbol: {...}, crosshair: true, drawings: true }
```

## Watching what the cells compute

Every cell runs its own engine session, so a script's runs are per-cell. The workspace
relays them as one event, tagged with the cell identity — **one subscription covers the
whole grid**, cells created by a later layout change included:

```ts
ws.on('script:run', (run) => {
    run.cell;              // 'btc' — which cell computed
    run.title;             // the script's declared title
    if (run.cause === 'bar') persist(run.cell, run.strategy);
});
```

The payload is the chart-level [`ScriptRun`](./api-reference.md#capturing-what-a-script-computes)
plus `cell`; everything there — `cause`, `forming`, `plots`, `vars`, `strategy`, `trades()` —
applies unchanged.

## State & persistence

The state SURFACE is the product; persistence is an adapter on top of it.

### Reading and restoring the whole workspace

```ts
const state = ws.getState();
// → { version: 1, layout, trackSizes?, activeCellId?, sync?, timezone?, favorites?,
//     timeframeFavorites?, charts: […], ext? }
// One ORDERED `charts` entry per cell, live AND dormant — array position i restores
// into slot i, `id` is the cell's durable name: { id: 'btc', symbol, provider?, timeframe,
//   priceStyle, bars?, watermark?, indicatorTitles?, rendererConfig (renderer.getConfig() document),
//   drawings (drawings.toJSON() document), indicators: { manifest: string[], natives: string[] },
//   ext? (third-party per-chart state, by namespaced key) }
// `ext` bags (document root and per chart) carry PLUGIN state — written and restored by
// handlers plugins register (registerStatePersistence, see the plugin SDK); entries pass
// through opaquely, so a document never loses them when the plugin isn't loaded.

ws.applyState(state); // untrusted-safe: malformed fields dropped; same-shape documents
//                    // apply IN PLACE (charts, handles and subscriptions survive),
//                    // structural changes rebuild the grid
ws.on('state:changed', () => {
    /* debounced (~500ms) — re-pull getState() */
});
```

`getState()` is the SDK's one call to read the **config and current content of every
chart**; `applyState()` is its inverse. Custom flows — server-side snapshots, share
links, layout templates — compose these two directly and need none of the plumbing
below. There is deliberately **no built-in URL persistence**: a host wanting shareable
links encodes `getState()` into its own URL scheme and calls `applyState()` at boot.

One format for every shape: the [single-chart mode](#single-chart-layout-false) speaks
the same triplet (`getState`/`applyState`/`state:changed`) and writes the same document
with one `c1` cell — a saved single chart drops into a grid slot as-is, and a cell's
state restores into a single-chart shell.

### The `persist` option and the storage interface

```ts
new VelaWorkspace('#app', { persist: true }); // key 'vela-workspace'
new VelaWorkspace('#app', { persist: 'my-key', storage: myAdapter });
```

`persist` writes the state document through a **storage adapter** and restores it as
defaults at construction (synchronous adapters restore before the first paint; async
ones late-apply when they resolve). Writes are debounced ~500ms and flushed on
`beforeunload` and `destroy()`.

**The default adapter is localStorage** — the same default as the widget, so
`persist: true` survives reloads out of the box. An in-memory, session-lived adapter
stays available for state that must NOT outlive the page
(`import { memoryStorageAdapter } from 'vela/workspace'`). Any backend fits through
this interface (one contract for both shells):

```ts
/** Both methods may be synchronous (localStorage-like) or return promises (REST/IndexedDB). */
interface VelaStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}
```

Example — a REST-backed store (per-user server-side workspaces):

```ts
import { VelaWorkspace, type VelaStorage } from 'vela/workspace';

const restStorage: VelaStorage = {
    async get(key) {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(key)}`);
        return res.ok ? res.text() : null;
    },
    async set(key, value) {
        await fetch(`/api/workspaces/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
    },
};

new VelaWorkspace('#app', { persist: 'main', storage: restStorage /* … */ });
```

Notes: writes are fire-and-forget (the UI never blocks on storage); a remote adapter
that must survive tab-close should use `navigator.sendBeacon` in its `set`. A saved
state referencing a plugin layout id restores only if that layout is registered
(`registerLayout`) before `applyState` runs; the layout picker's dynamic ids (`g3x2`)
are self-describing and always resolve.

## Options (summary)

**Chart options** (every key of [the chart's options](./options.md) except `height`) sit
at the top level and are each cell's **default** — `symbol` (bare = first declared
provider; an `EXCHANGE:` prefix pins a venue), `timeframe`, `bars`, `priceStyle`,
`data`, `visibleRange`, `theme`, `live`, `volume`, `upColor`, `downColor`, `glow`,
`animations`, `logScale`, `currentPriceLine`, `drawings` (toolbar excepted),
`defaultLanguage`, `renderer`, `nativeBackend` (explicit value wins over the
`maxWebglCells` policy). `cells` overrides the market/view seeds per cell:
`{ symbol, timeframe, bars, priceStyle, data, visibleRange }`.

**Cell names are identities, not positions.** A `cells` key is free-form (`btc`, `main`,
…): it names the cell durably — persistence, `sync` groups and `ws.cell(name)` all speak
it — while DECLARATION ORDER decides which layout slot each one fills (first declared →
first slot). Any entry is optional (an undeclared slot boots on the defaults, with an
auto name); extra entries beyond the layout wait dormant and appear when a larger layout
reveals them. Purely-numeric names are rejected with a warning (JS object keys would
silently reorder them).

**Shell options** (shared with the widget, same semantics):

| Option | Default | What it does |
| --- | --- | --- |
| `providers` | — | Factories; the workspace instantiates ONCE onto the single shared feed. |
| `engines` | — | Factories; one instance per cell (merged over `registerDefaultEngine`). |
| `indicators` | — | Shared manifest; `enabled` entries auto-add to fresh cells. |
| `timeframes` | presets | Topbar timeframe presets. |
| `timezone` | `'Etc/UTC'` | Display timezone (every cell). |
| `statusline` / `watermark` / `bottombar` | `true` | Chrome toggles. |
| `indicatorPicker` | `true` | The built-in indicator dialog's entry points (topbar button, mobile-bar item, `/`). `false` removes them for hosts shipping their own indicator UI — see [Replacing the indicator menu](../contributing/plugin-sdk.md#replacing-the-indicator-menu). |
| `layoutMode` | `'auto'` | Chrome size class — see [Mobile](#mobile). |
| `autofocus` | `false` | Focus the active chart on mount (off: an embedded workspace should not steal the page's focus). |
| `persist` / `storage` | off / localStorage | State persistence (see above). |

**Workspace options** (the grid's own):

| Option | Default | What it does |
| --- | --- | --- |
| `layout` | `'4'` | Initial grid — preset id, picker id (`g3x2`), `registerLayout()` id, or inline definition. `false` = [single-chart mode](#single-chart-layout-false). |
| `cells` | — | Per-cell overrides, keyed by FREE-FORM name = the cell's durable identity; declaration order fills the layout's slots (see above). |
| `sync` | off | Initial sync links (see above). |
| `drawingToolbar` | `true` | The one shared drawing toolbar (acts on the active cell). |
| `maxWebglCells` | `8` | Above this many cells, every cell uses canvas2d (uniform look inside the browser's WebGL budget; `glow` unavailable there). |
| `alertCap` | `50` | Alerts the topbar bell keeps (oldest drop beyond it). |

Contributed actions/attachments (`vela/plugin`) work unchanged — `ctx.chart` resolves
to the ACTIVE cell's chart; grid-aware plugins additionally get `ctx.cells`,
`ctx.activeCellId`, and `ctx.setActiveCell(id)`.

## The indicator manifest

The shell takes its script library as **data** — an array (or `{ indicators: [...] }`
wrapper) of entries, inline or fetched from a URL, shared by every cell:

```json
[
    { "name": "EMA 20", "script": "//@version=5\nindicator(\"EMA 20\", overlay=true)\nplot(ta.ema(close, 20))" },
    { "name": "My RSI", "url": "/scripts/rsi.pine", "language": "pine", "enabled": false }
]
```

- `script` is inline source; `url` fetches it (relative to the manifest URL).
- `enabled: false` entries don't auto-add — they appear in the **Indicators** picker for
  the user to toggle on. Toggles are live and per cell, and survive market switches.
- A broken entry is skipped with a console warning — one bad script never takes the
  chart down. A failing manifest URL throws.

## Keyboard

The shell is keyboard-first (bindings act on the **active cell**):

- Type a **letter** anywhere on a chart → the symbol search opens, seeded with it.
- Type a **digit** → the timeframe entry opens (`15`, `4h`, `D`, `3M`, … — a bare
  number is minutes, a bare letter means one unit).
- `alt+S` → download a PNG screenshot. `?` → the shortcuts panel.
- `mod+↑/↓` glide-zoom, `mod+←/→` glide-pan with the exact feel and limits of a drag
  (toward now it rests on the newest candle plus the usual empty space). `alt+T` arms
  the trend line tool; `alt+H` / `alt+V` drop a horizontal / vertical line at the
  cursor — the drawing toolbar's menus show these chords beside the tools.
- Mouse: `Shift`+scroll pans through history instead of zooming, `Shift`+click starts
  the measure ruler at the cursor, and middle-click deletes the drawing under it.
- Drawing keys (undo/redo, copy/paste, delete, nudge) come from the core — see
  [Drawing tools](./drawing-tools.md).

Bindings are declarative descriptors on `ws.keymap` — `register({ id, keys:
'mod+shift+k', label, category, scope?, run })` — and are listed automatically in the
`?` panel. `'mod'` is ⌘ on macOS and Ctrl elsewhere. Scopes stack: the shell pushes
`'dialog'` while any of its dialogs is open, muting chart-scope bindings.

Shortcuts fire while keyboard focus is **inside the shell** (any click on a chart puts
it there). For a page where the chart is the main content, set `autofocus: true` so
they work from the very first keystroke, before any click.

## The chrome

- **Topbar** — symbol button (opens the search), timeframe dropdown (hover a row to
  star a favorite: starred timeframes sit as duration-sorted chips, the current one
  highlighted in place; an unstarred current sits next to the caret, and the caret
  opens the full list — or the combined label+caret when nothing is starred),
  chart-style dropdown (built-ins ∪ [plugin chart types](../contributing/plugin-sdk.md),
  with their icons and labels), the layout dropdown (multi-chart grids only),
  Indicators picker, undo/redo (same history as Ctrl+Z / Ctrl+Y), alerts bell,
  data-window and object-tree panel toggles, then any
  [contributed actions](../contributing/plugin-sdk.md#widget-actions--registerwidgetaction)
  in the right-hand cluster.
- **Status line** — symbol + OHLC and change of the hovered bar (resting on the latest
  live bar), stacked above the renderer's indicator legend. In multi-cell grids it
  stays on one row — segments that don't fit the cell hide instead of wrapping (bar
  change first, then venue/timeframe, then the market badge; the logo + ticker always
  stay).
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
  the active chart's timeframe, **fetches the depth its window needs**, and frames it:
  `1D`→1m, `7D`→5m, `1M`→30m, `3M`→1h, `6M`→4h, `YTD`/`1Y`→1D, `5Y`/`ALL`→1W. Changing
  the timeframe by hand leaves range mode (the chip clears and the fetch depth returns
  to the chart's own `bars` setting).
- **Context menus** — right-click the chart body for reset view, removing all drawings or all
  indicators, and the settings dialog; the price axis for that pane's own scale (autoscale,
  invert, regular/percent/indexed/logarithmic, and the label and level toggles); the time axis
  for the display timezone. Every pane's price scale has its own menu, so a study pane's scale
  is independent of the main one. Each menu's settings entry opens the settings dialog on the
  tab that belongs to it — Canvas from the chart body, Scales and lines from either axis.

## Mobile

In a container narrower than ~640px (or up to ~920px with a coarse pointer — a
tablet), the shell switches to its **mobile chrome**; `layoutMode: 'mobile'` or
`'desktop'` pins the choice. The mode is container-driven and live: resizing across
the breakpoint swaps the chrome in place, closing whatever was open in the other
presentation. Sheets and full-screen pickers act on the **active cell**.

What changes on mobile:

- **One bottom bar replaces both desktop bars**, left to right: the symbol button
  (full-screen symbol search), the timeframe button (a bottom sheet with the date-range
  presets on top and the timeframe grid below), indicators (the full-screen picker),
  drawings (a bottom sheet with a search bar, the tool groups as scrollable tabs, and
  favorite stars), a three-dots sheet (undo/redo, screenshot, chart type, the side
  panels, time zone, alerts, contributed topbar actions and — multi-chart grids only —
  a **Layout** entry with the same tap-to-apply grid canvas as the desktop dropdown,
  the sync switches below it), and chart settings.
- **The docked drawing toolbar hides.** Picking a tool from the drawings sheet arms it
  and shows a floating pill over the chart — the armed tool's icon, the magnet cycle,
  stay-in-drawing-mode, the eraser, and ✕ to disarm. Favorites keep working (stars in
  the sheet), so a radial-wheel-style picker built on them keeps its data.
- **Dialogs go full-screen** — symbol search, the indicator picker, indicator settings,
  and chart settings, where the section rail sits behind a burger button, a section's
  group list becomes scrollable tabs at the top, and instance strips scroll sideways.
- **Side panels** (data window, object tree, contributed) open over the chart instead
  of docking a column beside it.
- **The indicator legend starts collapsed** behind its count chip — tapping it opens
  the **object tree**, whose per-indicator action menu carries an "Indicator settings"
  entry, so everything the legend rows offered stays one tap away.
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
shell's own bounds, not the viewport, are what count.

## Theming

The `theme` option (`'dark'`, `'light'`, or a full theme object) skins the whole shell —
charts, topbar, menus, panels. Swap it at runtime with `ws.setTheme(...)`: every chart
re-skins live and the chrome follows, no rebuild. Users reach the same switch in chart
settings → Canvas → Theme. The built-in themes share the same candle colors, so
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
