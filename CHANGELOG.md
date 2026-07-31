# Changelog

All notable changes to Vela, newest first.

## [v0.3.0]

### Added

- **Side panels are an extension point.** The column the object tree and the data window live in
  is now a dock any plugin can join: `registerSidePanel({ id, title, icon, mount })` adds a panel
  with the same header, the same close button, and its own toggle button in the topbar beside the
  other two. The plugin fills the panel's body and never touches the rest of the interface; the
  dock keeps exactly one panel open at a time, so the chart never loses more width than one
  column. A panel can declare itself **resizable** — a handle on its inner edge, dragged within
  the bounds it sets, double-click back to its declared width — and which panel is open plus the
  widths you dragged now come back with the rest of your saved chart.

- **The chart says when it is loading.** Three small dots pulse quietly at the center of the
  plot while a market's first bars are on their way — when the chart first opens, and again
  after every symbol or timeframe change. They disappear the moment the first candles paint
  (on deep histories, the quick recent-window preview), and they never show over data. While
  they are up the chart is genuinely blank: everything drawn from the bars goes with the
  series, and script-drawn dashboards (tables), which are pinned to pane corners rather than
  to bars, hide for the load and return with the data. A chart whose symbol no venue can
  serve drops the dots rather than promising bars that aren't coming.
- **Candles appear after one small request.** The first paint no longer waits for the whole
  requested history: the newest 200 bars load first — one quick request, candles on screen —
  and the rest streams in behind the interactive chart in steps that double up to the 10k
  chunk size, with the viewport held in place as older bars extend the left edge. Doubling
  keeps the request count logarithmic, so a slow venue costs a handful of round-trips instead
  of one per fixed step. Every load works this way — the first open, and every symbol or
  timeframe switch — so the loading dots give way to candles as fast as the venue can answer
  one small request. `history:progress` now reports each step as it lands, and `ready()` (and
  `setMarket`) resolve at that first paint — `historyComplete()` still awaits the full depth.
- **Loads announce themselves to plugins.** Two new chart events bracket every bar load:
  `load:start` fires before the first fetch — before the chart is blanked — carrying the new
  market and a first-load flag, and exactly one `load:end` follows once the first candles
  paint (or with `bars: 0` when a load fails, comes back empty, or parks). Extensions, plugins
  and custom indicators use the pair to hide their own visuals during the gap and rebuild them
  when the data is back; a depth-only reload fires neither.

### Changed

- **Switching markets clears the chart first.** Changing the symbol or timeframe now blanks the
  old candles immediately and shows the loading dots until the new market's first bars arrive —
  the previous market no longer lingers under the new symbol's name while its data loads.
  A plugin chart type's data engine is silenced and its layer data blanked in the same breath:
  its per-bar payloads are keyed by bucket time, so on a same-timeframe switch the old market's
  cells would land exactly on the new market's first candles. Changing only the history depth
  keeps the chart painted, as before.
- **The topbar's panel buttons are built from the dock.** They used to be two fixed buttons wired
  to two fixed callbacks. _(Breaking, for hosts that construct `Topbar` themselves: the
  `onObjectsClick` and `onDataWindowClick` options are gone, and `setPanelActive` now takes any
  panel id — the dock supplies the buttons through `setPanelButtons`. Nothing changes for users
  of `VelaWidget` or `VelaWorkspace`.)_

### Fixed

- **Removed and added indicators are remembered reliably.** Two persistence flaws could
  misremember the indicator set across a reload. A chart restored from a saved state kept its
  boot-time indicator list as a fallback, and on charts built without an `indicators` manifest
  (or before it resolved) that fallback shadowed a deliberately emptied set — removing the last
  indicator, Volume included, brought it back on the next load, every time. And the saved
  document read indicator presence from a copy that refreshed asynchronously, so an add or
  remove followed quickly by a reload could be missed entirely. Snapshots now read presence
  from the chart synchronously (`chart.presentNativeIndicators()`, a new public read) and the
  restored-state fallback ends the moment the live set becomes the truth — an empty chart you
  emptied stays empty, and a change made a heartbeat before leaving the page survives it.

- **Symbol search understands exchanges again.** Typing an exchange's name surfaces its symbols
  (after any ticker matches), and an exchange prefix scopes the search to that venue — `binance:btc`
  and `binance btc` both list Binance's BTC… pairs, a unique shorthand like `coin btc` works too,
  and the exchange name alone (or with `:`) browses the whole venue A to Z. This search shipped in
  the picker's original design but was lost in a port.

## [v0.2.0]

### Added

- **Undo and redo in the top bar.** Next to Indicators, a hairline and two icon buttons step
  through the same undo/redo history as the keyboard shortcuts — drawings and indicator changes
  alike. Each button dims when there is nothing to undo or redo.
- **Stay in drawing mode.** A toolbar toggle under the magnet (pen with a lock) keeps the
  armed tool ready after each placement, so you can draw several of the same shape without
  re-picking the tool. Turn it off for the usual one-shot behavior; the brush family still
  stays armed either way.
- **Position sizing on the long/short tool.** The long/short position drawing now sizes from
  your account: open its gear settings to set a risk percentage and account balance, and the
  chart shows the dollar loss at the stop and the matching position size alongside the usual
  risk:reward and percentage labels. The position size is itself editable — type the size you
  want and the risk percentage adjusts to match. Drag from the entry in the profit direction —
  higher for a long, lower for a short — and the profit zone follows that way; the stop lands on
  the opposite side. A direction switch in the panel turns the whole trade around in place,
  mirroring the stop and target across the entry with the risk:reward preserved. The stop and
  target take exact values in your choice of unit — the absolute price or points from the entry —
  and switching the unit re-expresses the current value without moving the level. Every label has
  its own toggle: the direction-and-ratio header, the loss-and-size line, the target and stop
  labels, the level prices inside them, or all text at once; the profit and loss zones recolor
  from the quick-settings bar, and the label color and size are adjustable too.
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
  LuxAlgo wordmark on hover — white on dark charts, dark on light ones.
- **One visual language across the whole chart.** Colors, icons and hover states now come from a
  single set of definitions instead of being restated in each panel, so the interface reads as one
  piece. The settings dialog, drawing toolbar, drawing style popups, color pickers, pane controls
  and the legend follow the chart theme — on a light chart they are now light, where before they
  stayed dark whatever the theme. Indicator titles in the legend all read in the normal chart text
  color, native ones included, instead of a blue of their own. Every subdivided drawing tool paints
  its levels with the same convention, so the 0.618 of a retracement, a fan, an arc set and a Gann
  box match; the same holds for bullish/bearish reds and greens, which were previously two slightly
  different pairs depending on the tool. Icons across the toolbars and menus are one consistent set
  at one weight, and they take the color of the control they sit in; several were redrawn to read
  more clearly at their small size — among them the gear, the trash bin, the baseline and
  Heikin Ashi chart styles, the Fibonacci wedge, the Fibonacci speed-resistance arcs, the
  trend-based Fibonacci extension, and the long/short position tools.
  Indicators share one icon everywhere they appear — the top bar, the pickers and the
  object tree — and every icon button responds to the pointer the same way: resting in a muted
  tone and brightening to white on hover, with the same soft backing. Color swatches everywhere are
  square, inputs and dropdowns in the chart settings share the dialog's own surface, the pointer
  cursor only appears over things that actually respond to a click, and the indicator legend sits
  on a solid chart-colored backing so its labels stay readable over the candles.
- **Reorganized right-click menus.** Each part of the chart now offers what belongs to it. The
  chart body gives you reset the view, remove every drawing, remove every indicator, and the
  settings dialog — the two removals stay in place but grey out when there is nothing to remove.
  The price axis carries the whole scale: autoscale, invert, and the choice between regular,
  percent, indexed to 100 and logarithmic, plus submenus for the axis labels, the last-price
  label, the countdown to bar close and the last-price line. Every pane has its own scale menu,
  so a study pane's scale no longer follows the price one. The time axis picks the display
  timezone, and choosing one there updates the timezone shown on the bottom bar as well. Each
  menu's settings entry opens the chart settings on the tab it is about — the canvas colors and
  grid from the chart body, the scales and lines from either axis — so you land on the controls
  you were reaching for instead of the first tab.
- **The price now reads on top by default.** A new overlay indicator starts _behind_ the candles
  (and behind the indicators already there), and a new drawing starts _just under_ them, so the
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

### Fixed

- **Hiding or locking a drawing now sticks.** Both are saved along with the rest of your chart,
  can be undone, and immediately update everywhere that drawing appears. Before, a hidden or
  locked drawing came back visible and unlocked after a reload.
- **One dialog at a time.** Opening the symbol search now closes an open chart settings or
  indicator settings dialog instead of stacking on top of it. The quick timeframe entry dialog
  centers its input properly, and the faint dots that appeared under the separator lines of
  right-click menus are gone.
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
