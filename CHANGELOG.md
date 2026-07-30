# Changelog

All notable changes to Vela, newest first.

## [v0.2.0]

### Added

- **Multi-chart workspaces.** The new `VelaWorkspace` puts several full charts on one screen:
  pick a grid from the layout menu in the top bar — single, two side by side, two stacked,
  four, or eight — and resize the cells by dragging the dividers between them (double-click a
  divider for an even split). Every cell is a complete chart with its own symbol, timeframe,
  chart type, indicators, and drawings; several cells can even show the same symbol. Plugins
  can register extra grid presets, and they appear in the layout menu automatically.
- **One interface for every chart.** A workspace shows a single top bar, symbol search,
  indicator picker, drawing toolbar, object tree, and bottom bar — all reflecting and acting
  on the **active** chart, outlined in blue. Click any cell to make it active and the whole
  interface follows; keyboard shortcuts, undo/redo, and the timeframe keys route to it too.
  Alerts from every chart collect in one list, each tagged with the chart it came from, and
  selecting one jumps to that chart. Dialogs such as chart settings open centered over the
  whole workspace, and each chart's settings include its own status-line, watermark, and
  data-depth sections. One discreet logo mark for the whole grid instead of one per chart.
- **Charts switch markets in place.** Changing a chart's symbol, timeframe, or history depth —
  in a workspace or in the single-chart widget — no longer rebuilds it. Indicators re-compute
  over the new bars, and your drawings, settings, and event subscriptions simply carry over.
  Switching feels instant, with no flash and nothing lost.
- **Linked charts.** Link every chart — or named groups of charts — so they move together:
  **viewport** links keep panning and zooming in step (mixed timeframes stay aligned on the
  latest bars), **symbol** and **timeframe** links retarget the linked charts when one of them
  changes, and **crosshair** linking projects the moment under your pointer onto every linked
  chart as a subtle ghost line with its time tag — snapped to each chart's own bars, so
  hovering 14:00 on an hourly chart lights that same day on a daily one. Crosshair sync is one
  switch in the layout menu.
- **Your workspace comes back as you left it.** Turn on persistence and the entire workspace
  survives a reload: the layout and divider positions, the active chart, the links between
  charts, the timezone, favorite drawing tools, and — per chart — the symbol, timeframe, chart
  type, history depth, watermark, indicators, drawings, and appearance settings. Storage is
  pluggable: keep the built-in browser storage, stay in-memory, or plug your own backend (for
  example a per-user server store) through a two-method adapter.
- **Read and restore everything from code.** One call returns the whole workspace — or the
  whole widget — as a single document; its counterpart restores it, and a change event tells
  you when to save. Server-side snapshots, shareable links, and layout templates are all built
  from these two calls. The widget speaks the exact same format as the workspace (it is simply
  the one-chart case), so a saved widget chart can be dropped into a workspace slot as-is.
- **Shortcuts from the first keystroke.** A new `autofocus` option on the widget and the
  workspace focuses the chart as soon as it mounts, so keyboard shortcuts work the moment
  the chart appears — no initial click needed. It stays off by default, so a chart embedded
  next to other page content never steals the keyboard focus.
- **Quicker mouse control of the view and drawings.** Hold `Shift` and scroll to glide through
  chart history instead of zooming, `Shift`-click an empty spot to start measuring from that
  exact point, and middle-click a drawing to delete it — no toolbar round-trip needed. The
  drawing toolbar's menus now show each tool's keyboard shortcut beside it, with the favorite
  star at the far edge of the row, and the `?` shortcuts panel lists the mouse gestures too.
- **A reorganized object tree.** The panel now mirrors how the chart is actually built: every
  item sits under the pane it belongs to, and in the main chart the price series takes its own
  place in the stack among the overlay indicators, in the order they draw. Drawings are listed
  under their tool's name with that tool's icon, an indicator drawing against its own scale is
  marked as such, and a locked drawing keeps its padlock in view instead of hiding it until you
  hover. Right-click any row for the actions there is no room for on it: show or hide, lock,
  duplicate, bring to front or send to back, remove, and — for an indicator — move it into
  another pane or out into a new one of its own. Each pane's header carries its own controls to
  reorder, collapse, or maximize it. Rows can also be dragged: drop an indicator on another pane
  to move it there, on the band between two panes to open a fresh one, or anywhere in the main
  chart's stack to choose what draws in front — the price series included. Drawings drag the same
  way, restacking within their pane or landing in another one to move there. A label follows the
  pointer and the panel shows where the drop will land before you release.
- **Drawings can be grouped and handled as one.** Click a drawing in the object tree to select
  it, holding Ctrl (or Cmd) to add more — the chart highlights everything you pick — and a bar at
  the top of the panel offers to bundle the selection into a group or duplicate all of it at once.
  A group gets a row of its own that folds shut over its members, and its eye, padlock and remove
  act on every drawing inside it. Rename it to whatever the bundle means to you. A group drags
  anywhere a single drawing can go — another place in the stack, or another pane — carrying its
  members and their order with it, and dropping a loose drawing onto a group adds it to the
  bundle. Right-clicking gives you the rest: adding a drawing to a group or taking it out again,
  hiding or locking a whole group, ungrouping it, or deleting it with everything in it. Groups
  last as long as the chart stays open and are not part of what persistence saves.
- **Drawings can sit anywhere in the chart's stack.** A drawing no longer has to sit on top of
  the price: it can go under the candles, between two indicators, or behind everything, so it
  reads as background — a zone or a band you see the data through instead of across. Each pane in
  the object tree is now one column, top to bottom as front to back — its drawings, its
  indicators and the price series together — and you drag a drawing (or a whole group, which
  moves as one block) to any slot in it; **Bring to front** and **Send to back** on a drawing's
  menu now clear the entire stack, candles and indicators included. A drawing under the data
  stays fully yours to work with — click it, move it, reshape it as before, and its handles still
  draw on top so you can see what you have hold of. The whole stacking order is saved with your
  chart, comes back on reload, and drawing moves can be undone.
- **A data window beside the chart.** The data-window button in the top bar opens a panel docked
  to the right, the object tree's sibling: the date and time of the bar under your pointer, its
  open, high, low, close and volume tinted with the bar's direction, then one section per
  indicator showing each plot's value in the plot's own color. It follows the crosshair as you
  move across the chart and falls back to the latest bar when the pointer leaves, so it always
  shows something useful. The two panels share the dock — opening one closes the other — and in a
  workspace the readout follows the active chart as you switch cells.

### Changed

- **Chrome polish on the widget and workspace.** The top bar sits tighter, timeframe / chart
  style / Indicators read in bright white, the Indicators count badge is gone, the camera sits
  to the right of the object tree, and chart settings move to a gear on the bottom bar next to
  the session switch. The in-chart attribution mark uses the LuxAlgo symbol and expands the
  LuxAlgo wordmark on hover.
- **The price now reads on top by default.** A new overlay indicator starts *behind* the candles
  (and behind the indicators already there), and a new drawing starts *just under* them, so the
  price stays the top of the pile until you restack things yourself — drag rows in the object
  tree, or use Bring to front / Send to back. _(Breaking: overlays and drawings used to paint
  over the candles by default; raise them in the object tree to get the old look back.)_
- **The widget now persists the full chart, not just preferences.** Where persistence used to
  restore the symbol, timeframe, style, and a few settings as defaults, it now brings the whole
  chart back — drawings, indicators, and appearance included. Previously saved preferences are
  migrated automatically the first time the new version runs.
- **Removing an indicator sticks.** Removing the built-in Volume — or any indicator — now
  holds across symbol and timeframe switches and across reloads, whichever way you removed it
  (the indicators dialog, the legend, or the object tree). Before, auto-added indicators could
  quietly return on the next switch or reload.
- **The data window is a docked panel, not a floating box.** It used to hover over the top-right
  corner of the chart and was switched on with the `dataWindow` option; it is now the side panel
  described above, opened from the top bar, and it never covers the candles. _(Breaking: the
  `dataWindow` option is gone. If you drove it from code, or built your own readout beside it,
  call `chart.renderer.dataWindowReadout()` — it hands back the same values, ready to display.)_

### Fixed

- **Hiding or locking a drawing now sticks.** Both are saved along with the rest of your chart,
  can be undone, and immediately update everywhere that drawing appears. Before, a hidden or
  locked drawing came back visible and unlocked after a reload.

### Fixed

- **Keyboard zoom and pan no longer wedge the chart.** Zooming or panning with `Ctrl` + arrow
  keys toward the edge of the chart (or past the zoom limits) could leave the view stuck: the
  animation silently kept running forever and overrode every later scroll-wheel or drag
  gesture, so the chart stopped responding to the mouse. The glide now settles cleanly and
  the mouse always stays in control. `Ctrl` + `←`/`→` also now pans exactly like dragging the
  chart — same limits, same feel: holding the key scrolls continuously and, toward the most
  recent bar, comes to rest on the newest candle plus the usual bit of empty space. And with
  the chart focused, a held `Ctrl` + arrow no longer also moves the crosshair bar — the two
  used to fight over the view, which read as a stuttering bounce while panning.

## [v0.1.0]

### Added

- **A modern charting library, built to be extended.** Vela is a small, robust core surrounded
  by three independently replaceable layers: market-data providers, scripting engines, and
  renderers. Swap any one of them — a different data source, a different indicator language, a
  different drawing backend — without touching the rest of your app.
- **A native GPU renderer.** Charts draw on the GPU (WebGL2) with an automatic canvas fallback:
  candlesticks, bars, line, area, baseline, and Heikin Ashi chart types, multiple panes with
  draggable dividers, smooth eased zooming and inertial panning, an optional neon glow,
  configurable candle colors, log and percent scales, a live countdown to bar close, and light
  or dark themes throughout.
- **Pine Script indicators.** Run Pine indicators through the bundled engine — in the page or
  on a background thread so heavy scripts never freeze the interface. Live ticks update
  indicators incrementally, multi-timeframe and multi-symbol requests fetch real data, and
  hosts can inspect a running script's values from code.
- **Market data out of the box.** Built-in providers for Binance, Coinbase, and Hyperliquid —
  no API keys — with live streaming and a polling fallback. Register several providers at once:
  symbols route to the right venue automatically, or explicitly with an `EXCHANGE:SYMBOL`
  prefix. Deep history paints the recent window immediately and backfills the rest in the
  background with progress events; already-loaded bars are cached and reused. Offline data
  works with no provider at all.
- **Interactive drawing tools.** Sixty-six tools across nine groups — lines, channels and
  pitchforks, shapes, annotations, icon stamps, the full Fibonacci and Gann set, patterns with
  validated harmonics, and forecast and measure tools — with a docked toolbar, magnet snapping,
  an eraser, a measure ruler, favorites, undo/redo, copy/paste, and keyboard shortcuts.
  Drawings anchor to time and price, so they stay locked to the bars across pan, zoom,
  timeframe changes, and reload, and they serialize to JSON for persistence.
- **Built-in indicators.** A per-bar Volume indicator on every chart (removable, restylable)
  and a visible-range volume profile (VPVR) drawn against the right edge — both computed
  natively, no scripting engine required.
- **A complete chart app in one line.** The widget wraps the chart in a ready-made interface:
  a top bar with symbol search, timeframe and chart-type menus and an indicator picker, an
  in-chart status line with live OHLC, a bottom bar with date-range presets, a clock and a
  timezone picker, an object tree, context menus, alert toasts, screenshot export, a keyboard-
  first workflow with a built-in shortcuts panel, and preference persistence with optional
  shareable URL state.
- **A plugin SDK.** Extend Vela from outside the library: register new chart types (with their
  own data engines and settings sections), renderer layers, native indicators, top-bar actions,
  widget attachments, and icons. Plugin chart types appear in the pickers and settings dialogs
  like the built-ins.
