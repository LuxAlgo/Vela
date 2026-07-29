# Changelog

All notable changes to Vela, newest first.

## [v0.2.0]

### Added

- **Stay in drawing mode.** A toolbar toggle under the magnet (pen with a lock) keeps the
  armed tool ready after each placement, so you can draw several of the same shape without
  re-picking the tool. Turn it off for the usual one-shot behavior; the brush family still
  stays armed either way.
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
- **A data window beside the chart.** The data-window button in the top bar opens a panel docked
  to the right, the object tree's sibling: the date and time of the bar under your pointer, its
  open, high, low, close and volume tinted with the bar's direction, then one section per
  indicator showing each plot's value in the plot's own color. It follows the crosshair as you
  move across the chart and falls back to the latest bar when the pointer leaves, so it always
  shows something useful. The two panels share the dock — opening one closes the other — and in a
  workspace the readout follows the active chart as you switch cells.

### Changed

- **The widget now persists the full chart, not just preferences.** Where persistence used to
  restore the symbol, timeframe, style, and a few settings as defaults, it now brings the whole
  chart back — drawings, indicators, and appearance included. Previously saved preferences are
  migrated automatically the first time the new version runs.
- **Removing an indicator sticks.** Removing the built-in Volume — or any indicator — now
  holds across symbol and timeframe switches and across reloads, whichever way you removed it
  (the indicators dialog, the legend, or the object tree). Before, auto-added indicators could
  quietly return on the next switch or reload.
- **Text is typed straight onto the chart.** Placing a text annotation now drops a blinking caret
  where you clicked, next to an "Enter Text" placeholder, and the words appear on the chart as you
  type them — no settings field in between, and a thin gray frame around the words while you are
  editing them. Text annotations start out large, so they read at a glance without reaching for the
  size control. Enter starts a new line; clicking away (or Ctrl/Cmd+Enter) keeps the text and
  Escape puts back what was there; a text annotation you never typed into is
  dropped instead of left blank on the chart. Double-clicking existing text — or a callout — opens
  the same on-chart editor. Finished text keeps that frame as its selection cue: firm when the
  annotation is selected, fainter under the cursor, so you can see where the words can be grabbed.
  The quick-settings bar opens alongside the caret, as it does for every other tool, and now carries
  the text color and size on the bar itself, with bold and italic under the text field where the
  words are — restyle while you type and the chart follows, without the edit being interrupted.
  Previously a text annotation arrived pre-filled with the word "Text", had to be edited through the
  settings popup, and its formatting was two clicks deep.
- **The data window is a docked panel, not a floating box.** It used to hover over the top-right
  corner of the chart and was switched on with the `dataWindow` option; it is now the side panel
  described above, opened from the top bar, and it never covers the candles. _(Breaking: the
  `dataWindow` option is gone. If you drove it from code, or built your own readout beside it,
  call `chart.renderer.dataWindowReadout()` — it hands back the same values, ready to display.)_

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
