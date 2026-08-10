# Changelog

All notable changes to Vela, newest first.

## [v0.5.1]

### Changed

- **Mobile chrome polish.** The timeframe sheet labels its date-range chips and
  timeframe grid with matching white section headers (no divider between them), and
  highlights the active chip in white. In the drawings sheet the search field and
  group tabs stay pinned while the tool list scrolls. The in-chart status line drops
  the O/H/L/C block on mobile and stacks the bar change under an aligned
  logo / symbol / timeframe / market-status row. The scroll-to-latest control is
  smaller and only appears when the latest bars are off-screen. Time zone moved out
  of the three-dots sheet onto a long-press of the time axis; a long-press on the
  price scale opens a price-scale sheet. The LuxAlgo attribution mark keeps its
  desktop size and is only slightly smaller on mobile; the faded symbol watermark
  caps at a quieter size.

### Added

- **A mobile chrome for the widget.** In a narrow container — or on a touch-first
  device, or forced with the new `layoutMode` shell option (`'auto' | 'mobile' |
  'desktop'`) — the widget swaps its desktop bars for one touch-sized bottom bar:
  symbol search, timeframe, indicators, drawings, a three-dots drawer, and chart
  settings. The timeframe entry opens a bottom sheet with the date-range presets and
  the timeframe grid; the drawings entry opens a searchable, tabbed tool sheet with
  favorite stars — swipe sideways across the tool list to move between the group
  tabs — and an armed tool shows a floating pill over the chart with the
  magnet, stay-in-drawing-mode and eraser controls; the three-dots sheet carries
  undo/redo, screenshot, chart type, the side panels (which open full-screen on
  mobile), alerts, and any contributed actions. A long-press on the time axis opens
  the time-zone sheet; a long-press on the price scale opens scale settings. Symbol
  search, the indicator picker, chart settings and indicator settings all present
  full-screen; in chart settings the section list sits behind a burger button, a
  section's groups become scrollable tabs, and multi-instance strips (like a
  footprint's) scroll sideways. The chart itself gains the touch gestures the chrome
  assumes: one-finger pan with inertia, two-finger pinch zoom, a long-press that
  inspects with the crosshair without moving the view, and a double-tap that mirrors
  the desktop double-click — on the price or time axis it resets that scale's view,
  and inside the plot it maximizes/restores the tapped pane. The button that jumps
  back to the most recent bar appears when those bars are off-screen. Desktop
  behavior is unchanged, and the mode follows the container live — resizing across
  the breakpoint swaps the chrome in place.
- **The workspace shares the mobile chrome.** `VelaWorkspace` honors the same
  `layoutMode` option and auto-detection: on mobile the shared topbar, desktop
  bottombar and the docked drawing-toolbar column give way to the same touch-first
  bottom bar, sheets and full-screen pickers, all acting on the active cell. The
  three-dots sheet additionally carries the multi-chart **Layout** picker — the same
  tap-to-apply grid canvas as the desktop topbar's layout dropdown, its non-grid
  preset rows, and the symbol/interval/crosshair sync switches. The grid-wide
  attribution mark also picks up the smaller mobile lockup the widget uses.
  Multi-cell grids keep each cell's status line on ONE row — segments that don't fit
  the cell hide instead of wrapping (bar change first, then the venue/timeframe, then
  the market badge; the logo + ticker always stay). On mobile the indicator legend is
  **collapsed by default** behind its count chip, and in a multi-cell grid the chip
  routes to the **object tree** instead of unfolding in place — whose indicator action
  menu gains an **"Indicator settings"** entry (the legend gear's twin).
- **Plugin SDK: two per-indicator chrome seams on the renderer port.**
  `IChartRenderer.setLegendOverviewAction?(action)` lets a host shell replace the
  indicator legend's fold toggle with its own overview entry point (the workspace
  routes it to the object tree on mobile grids), and
  `IChartRenderer.openIndicatorSettings?(indicatorId)` opens one indicator's settings
  dialog programmatically — the legend gear's twin, surfaced on `chart.renderer` as
  `setLegendOverviewAction` / `openIndicatorSettings` (+ `supportsIndicatorSettings`).
  Both are additive and optional: a renderer without them keeps today's behavior.
- **`vela/ui` gains a `Drawer`.** A bottom sheet with a grab handle and a dimmed
  backdrop — the primitive the mobile chrome's sheets are built on, exported for
  building your own. Pulling down dismisses from anywhere on the sheet, not just the
  handle (a scrolled list keeps native scrolling until it is back at the top), an
  `onSwipe` option turns decidedly horizontal swipes into a callback (the drawings
  sheet pages its tabs with it), and opening never pops the on-screen keyboard — the
  sheet itself takes the initial focus, never a search field.

- **Drawings sync across a workspace grid.** A new `drawings` sync kind
  (`ws.sync.set('drawings', true)`, also a toggle on the shared drawing toolbar) links
  drawings across same-group cells: a newly created drawing is copied onto the others
  (anchors are time+price, so it lands at the same spot whatever each cell shows), and
  the set stays linked — moving, restyling or deleting any member follows on its peers.
  Placement mirrors **live**: while anchors are still being clicked, linked charts show
  the in-progress shape as a reduced-opacity ghost. Link membership is session-scoped
  and survives a toggle-off (re-enabling resumes edit/delete for drawings paired
  earlier; drawings created while off stay independent), and a reload leaves every
  drawing unpaired again. The on/off setting persists like the other sync kinds.
- **Plugin SDK: a draft seam on the drawings port.** `DrawingIntent` gains an optional
  `draft` arm (placement progress, `null` at the end) surfaced as the `drawing:draft`
  chart event, and `IDrawingsRendererPort` gains an optional `setExternalGhost(doc)` —
  the drawings twin of `setExternalCrosshair`. Both are additive: a renderer that
  implements neither keeps today's behavior (sync at completion, no remote preview).

### Fixed

- **Screenshots capture the whole chart.** The PNG export now includes everything the
  screen shows: the volume columns, the visible-range volume profile, plugin-drawn
  layers, the status line, the indicator legends (with their values), and the faded
  symbol watermark — previously only the candles, axes and drawings made it into the
  image. Only the crosshair stays out.

## [v0.5.0]

### Added

- **Indicator legends show their plot values.** Each indicator's legend row now
  displays the current value of every plot to the right of its title, colored like
  the plot itself. The values follow the crosshair — hover a bar and they read that
  bar; move off the chart and they rest on the latest bar, ticking with live data.
  Hovering the legend row itself sets the values aside while its controls (eye, gear,
  ✕…) are out, so the row never crowds. Right-clicking a legend row opens a small
  menu whose "Indicator values" entry shows or hides that indicator's values, and
  chart settings → Status line → Indicators gains a "Values" toggle that shows or
  hides them for every indicator at once. The chart-wide choice persists with the
  rest of the chart state.

- **Duplicate-keyed settings rows stay in sync.** Several `when`-gated chart-type
  settings rows may now store under the same bag key(s) — the pattern for per-mode
  rows over one shared state (each mode gets its own row label while the stored
  toggle and colors stay one value). The settings dialog re-syncs every keyed
  control (checkbox, color swatch, select) from the values bag on each edit, so a
  hidden twin row never shows stale state when its gate brings it back.

- **Inline line-width dropdown and number input on settings toggle rows.** A chart
  type's settings toggle row may now carry `width: { key, label, defval }` next to
  its `colors` swatches — a compact dropdown offering the drawing bar's classic
  1–5 px weights, each option previewed as a line at that weight — and
  `number: { key, label, defval, min?, max?, step? }`, a compact number input ahead
  of the swatches. Both dim with the swatches while the toggle is off and store
  plain numbers in the type's bag — the declarative replacement for separate
  `number` rows gated on the toggle. A swatch may carry its own `when` gate (same
  shape as a row's), letting one toggle row swap its swatch set live as another value
  changes — a mode's two colors while it is on, its one alternative while off; a
  self-gated swatch stays interactive through the toggle-off dim. And a structured
  section with a single always-present instance no longer renders its one-tab strip —
  sections that go structured purely for the group TOC keep a clean pane top.

- **Chart settings open on the active style's tab.** When the active price style is a
  chart type with its own settings tab (visibility `'active'`), opening the settings
  dialog now lands on that tab instead of Symbol — the pane a user opening settings
  under that style is usually after. An explicit `showSection` still wins.

- **Candle settings for plugin chart types that draw candles.** A registered chart type
  that keeps the candle series under its own layer (an order-flow style, for example) now
  gets a Candles group in chart settings → Symbol while it is active: body, border, and
  wick toggles with their up/down colors, plus the bar spacing. These cosmetics belong to
  that chart type alone — changing them restyles its candles without touching the Candles
  or Heikin Ashi styles, and any value left untouched keeps following the shared candle
  settings. They persist and export with the rest of the chart config.

- **Plugin layers can fade the chart under them and follow the pointer.** A renderer
  layer registered through the plugin SDK gains three quieter levers. It can now dim or
  slim the base painting gradually — its `modulateBase` hook returns per-frame candle
  body width/opacity and grid opacity, the smooth counterpart of the all-or-nothing
  `basePainting: 'none'` — so a style that reveals under the candles as you zoom in can
  fade them down instead of switching them off. A layer that reacts to hovering
  (tooltips, row highlights) can declare `repaintOnCursor` and is repainted whenever the
  pointer moves, receiving the pointer position with its paint arguments. And a chart
  type's settings tab can now include `heading` rows — group titles that organize a
  large tab into named sections.

- **Settings tabs that show only what matters — and scale past one flat list.**
  Chart-type settings stay pure data but gain structure. A row may carry a `when`
  condition (`{ key, equals }` / `{ key, anyOf }`, or an AND-ed array) and is shown only
  while the gate passes against the tab's current values — the dialog re-evaluates live
  on every edit, so mode-specific colors or a manual-size input appear exactly when they
  apply. A section may declare `instances` instead of flat rows: the pane opens with a
  tab strip — one tab per present instance, a dashed `+` that turns the next one on, an
  `×` on the active removable tab — with presence stored as a plain boolean
  (`enableKey`) in the same per-type bag. Inside an instance (and inside the new
  `subsections`, indented entries under the section's rail tab), `heading` rows become a
  group TOC on the left of the pane that shows one group at a time. And
  `placement: 'after-symbol'` puts a type's tab directly under Symbol. Two row forms
  keep panes static where a conditional reveal would jump the layout: a toggle row may
  carry inline color swatches (`colors` — edited on the toggle's own row, dimmed while
  it is off), and a `range` row edits a min–max pair on one line (with an optional
  `placeholder` naming the unset state, so a cleared input reads "Off" instead of a
  magic 0). Select options may be `[value, label]` pairs so camelCase ids show as
  human text. A subsection's `enableKey` soft-disables its other rows (visible but
  grayed) while off, instead of hiding them. Hidden rows keep their stored values;
  persistence and delivery are unchanged — consumers still receive one flat settings
  object.

- **A light theme that actually works — switchable live.** `theme: 'light'` now skins the
  whole product coherently: white surfaces with dark, readable text across the toolbar,
  menus, dialogs, legends, axes, and pane separators. The theme can be swapped at runtime —
  `chart.setTheme('light')`, `widget.setTheme(...)`, or `workspace.setTheme(...)` (which
  re-skins the shared chrome and every cell together) — and users reach the same switch in
  chart settings → Canvas → Theme. A `theme:changed` event carries the resolved theme so
  the page around the chart can follow. Candle colors are shared between the built-in
  themes, so switching never recolors the series. Setting just a white background on the
  dark theme (settings → Canvas → Background) now re-bases the derived inks — text, grid,
  axis border — so legends and axis labels stay readable, while an explicitly chosen text
  color always wins. New text annotations (notes, callouts, price tags) pick a
  maximum-contrast text color for the active theme at creation and keep it; existing
  drawings are never recolored.

- **Capturing what a script computes, in one subscription: `script:run`.** Reading a running
  script used to mean assembling it yourself — an event told you _that_ something happened
  and handed you an id, so you looked the indicator up, awaited a snapshot, and then decoded
  it: variable names arrived scope-mangled by the transpiler, values arrived as per-bar
  buffers you had to index, nothing said whether the script was a strategy, and the title on
  the handle was a placeholder the declared name never replaced. The chart now reports the
  run itself. One subscription gives the declared title, whether it is an indicator or a
  strategy, each plot's value at the computed bar, the script's own variables under the names
  written in the source, and — for a strategy — its broker state: position, average entry
  price, equity, open and net P&L, win/loss counts, drawdown and run-up. Nothing to resolve,
  nothing to await. `chart.runScript(source)` is the same thing for code you execute
  yourself: it resolves the first run, follows later ones through `onUpdate`, and removes the
  script with `remove()` — injecting it only if it ran, exactly like `runIndicator`. A
  workspace relays every cell's runs as one event tagged with the cell, so a grid needs a
  single listener even as layouts create and destroy cells.
- **Runs say what caused them, so a recorder can tell provisional from final.** A live
  script re-computes constantly, and until now every re-computation looked alike — which
  made "write this to a database" or "raise this alert" quietly unsafe, because the value
  could still move. Each run now carries its cause: the first pass over the history, a tick
  refining the bar that is still open, a **new bar** (which makes the one before it final),
  an input edit, a viewport move, or a market switch. Ticks are throttled to about one a
  second, since a stream re-runs the open candle far faster than any dashboard can use;
  every other cause is reported unconditionally, so the moment a bar closes is never
  dropped. Two flags complete the picture: whether the run's last bar is still open, and
  whether it saw the full history (false only while a progressive engine is still being fed
  a deep backfill).
- **The parts that can grow without bound stay off the event.** A strategy's trade ledger and
  a plot's full history are a call away — `await run.trades()`, `await run.series('fast')` —
  so a listener firing every second never carries thousands of rows it will not read. And a
  chart with no listener does no work at all: the execution-context read that fills a run
  happens only when someone is subscribed.
- **The drawing toolbar collapses out of the way.** A chevron at the bottom of the docked
  toolbar folds it into a slim strip, giving the chart the full width; the strip keeps just
  that chevron, and one click brings the whole toolbar back. The plot re-flows to the new
  width in both directions.
- **The bottom-bar clock opens the time-zone menu.** The time and the zone label are now one
  button: clicking the clock itself brings up the same zone picker as clicking the zone name
  next to it.
- **The indicator legend folds away.** With two or more indicators on the chart, a
  bordered chevron sits under the price-pane legend rows; clicking it folds every
  pane's indicator titles — study panes included — into a compact "˅ N" chip (and
  back), so a busy legend stops covering the plots. The toggle disappears when a
  single indicator is left.
- **Hosts can follow in-chart settings edits.** `chart.renderer.onConfigChanged(cb)` fires
  whenever the cosmetic config changes — the settings dialog commits through it — so host
  chrome that mirrors a config value (a time-zone display, a saved template) can re-read it
  instead of drifting. And a host that owns its own undo shortcuts can turn off the new
  `historyChords` render feature, so the drawings layer lets Ctrl+Z/Y bubble up instead of
  consuming them itself.
- **Hold Shift to draw lines at exact angles.** While placing a trend line, ray, extended
  line, info line, trend angle, or arrow — or dragging one of its endpoints later — holding
  Shift rounds the line to the nearest 45° step as drawn on screen: horizontal, vertical, or
  a perfect diagonal. The magnet is set aside while Shift is held, so the locked angle is
  kept exactly rather than being pulled off-axis by a nearby candle.

### Changed

- **Visible Range Volume Profile is named in full.** The built-in volume profile of
  the visible range now appears in the indicator picker as "Visible Range Volume
  Profile", with the short legend label "VRVP" (it was previously titled "VPVR"
  everywhere). Native indicators may also declare an optional `shortTitle` so the
  legend stays compact while the picker and settings dialog keep the full name.
- **An indicator that is fetching shows quiet load dots in its legend.** While an
  indicator's data is in flight, its legend row now ends with three small pulsing
  dots — the same load affordance the chart itself shows while bars load — at the
  row's right end. The old circular spinner to the left of the title is gone.
- **Scripting engines report a strategy's state in neutral terms.** An engine that simulates
  order execution now describes it with the same vocabulary whatever language it runs, so one
  dashboard reads them all. Engines are also expected to report a script's variables under
  the names written in the source: a transpiler's internal scoping scheme is its own business
  and no longer reaches the page. _(Breaking for engine authors: the execution-context
  snapshot gained `strategy` and `trades`, and its `variables` must no longer be
  bucket-prefixed or mangled. Engines that report neither still work — a run then carries the
  title, cause and plots the model already supplies.)_
- **The script return value is gone from the execution-context snapshot.** It was documented
  as the way a script hands structured data to host code, and it never worked: the bundled
  Pine runtime rejects a `return` of an object or a tuple outright, and the field came back
  as one null per bar. Anything a script wants to expose goes through its variables, its
  plots, or — for a strategy — its broker state, all of which now arrive named and usable.
  _(Breaking: `EngineContextSnapshot.result` and the `'result'` selector were removed. Nothing
  could have been reading a meaningful value from them.)_
- **One time-zone catalog, everywhere.** The bottom bar and the chart-settings dialog now
  offer the same list of zones — every UTC offset from UTC-12 to UTC+14, half- and
  quarter-hour offsets included, each shown with its live (DST-aware) offset and a city
  label. Picking a zone in the settings dialog updates the bottom bar and vice versa — in a
  workspace it updates every cell, since the display zone is workspace-global; the dialog
  used to carry its own short list of raw zone identifiers, and a choice made there never
  reached the rest of the interface.
- **Drawing-toolbar tooltips appear when you'd expect them.** Hovering a toolbar icon now
  shows its tooltip after a short pause instead of a two-second wait, and a tool group's
  tooltip names the exact tool its icon will arm (the group's last-used one), not just the
  group.

### Fixed

- **Chart-type data engines now receive stored settings on (re)creation.** A type's
  data engine used to hear about its settings only through live dialog edits — a
  persisted config restore or a market switch (which recreates engines) left the
  fresh engine fetching on schema defaults until the user touched the dialog. The
  orchestrator now remembers the last-seen per-type values and replays them into
  every newly created engine just before `start()` (a pre-start `onSettings` is
  pure configuration by contract).
- **The fixed-range volume profile emphasizes its value area.** The default fills were
  inverted — the value area rendered more transparent than the tails around it. The value
  area is now the opaque region and the outside rows recede. Its POC line also stops
  defaulting to the accent blue: until you pick a color for it, the POC draws in the
  active theme's contrast ink — white on a dark chart, black on a light one — and follows
  a theme switch immediately. A POC color you picked yourself, and profiles already
  saved, are left untouched.
- **Tooltips in the indicator settings dialog no longer hide behind it.** The ⓘ input
  hints and the dialog's own control tips opened underneath the dialog card, where they
  were unreadable; they now stack above it like every other tooltip.
- **Opening the Indicators dialog closes an open indicator-settings dialog.** The two
  dialogs used to stack — the topbar picker never counted as a click outside the
  in-chart dialog. It now dismisses it on open, the same way the symbol search already
  did, in the widget and in every workspace cell.
- **Undo steps back exactly one action when drawings and indicators mix.** With a drawing
  and an indicator change both in the history, one Ctrl+Z over the chart used to revert
  both at once — the drawing layer and the app history each answered the shortcut. A single
  press now undoes a single action, whatever its kind. The same holds in a workspace, where
  a cell's drawing edits now enter that cell's own undo timeline alongside its indicator
  changes instead of living in a parallel history.
- **Removing an indicator from the legend can be undone.** Removals made outside the
  indicator picker — the legend ✕, the object tree, `handle.remove()` — never entered the
  undo history, so Ctrl+Z skipped straight past them. They now land in the same timeline as
  every other edit, and undo brings the indicator back — in the widget and in every
  workspace cell alike.
- **The indicator legend follows the chart background.** Changing the background color in
  chart settings repaints the legend rows with it; they used to keep the color they were
  created with and float as stale chips over the new background.
- **The price and time scales follow the chart background.** Changing the background color
  in chart settings now repaints the axis scales with it, so the plot and its scales read
  as one surface; they used to stay on the app theme's color and frame a recolored chart
  with the old one.
- **The status line's readout follows the chart style.** Bar-shaped styles (candles,
  bars, Heikin Ashi) read out all four O/H/L/C values; a one-line style (line, area,
  baseline) plots a single series, so its readout is just that value — plus the change,
  always. And the whole readout shares one ink that follows the ACTIVE style instead of
  fixed theme tokens (the OHLC and the change even used two DIFFERENT palettes): the
  configured candle-body colors, bar-tick colors, the plot color for line/area — and
  for baseline, the top/bottom line colors picked by the bar's POSITION against the
  live baseline price, the way the paint itself splits (a bar that closed down can sit
  in the green region; its values are green there). Everything re-tints when a settings
  edit recolors the style or the style switches, in the widget and in every workspace
  cell. Hosts building similar chrome can read the new read-only `baselinePrice` render
  feature — the resolved reference price the baseline paint splits on.
- **The attribution mark stays on real plot area.** It anchors to the bottom-left of the
  lowest visible, non-collapsed pane — the same rule the scroll-to-realtime button already
  followed — so collapsing the bottom study pane (or maximizing another) lifts the mark
  into the lowest open pane instead of leaving it on a collapsed strip's legend.
- **The chrome shows the bare ticker, never `venue:TICKER`.** The topbar symbol button, the
  in-chart status line, the watermark and the object tree used to echo the raw symbol
  string, so a venue-pinned pick (the symbol picker composes `binance:BTCUSDT`) leaked the
  routing prefix into every label. They now display the ticker alone — the venue already
  shows where it belongs: the status line's meta segment and the picker's venue badges.
- **The status line lines up with the indicator legend.** Its left offset was hardcoded to
  clear the widget's docked drawing toolbar, so in a workspace cell (no per-cell toolbar) it
  floated 44px right of the legend, and a collapsed toolbar left it hanging mid-air. The
  renderer now publishes its toolbar gutter as `--vela-toolbar-gutter` on the mount
  container and the status line anchors to it, keeping the two in one column in every
  shell and toolbar state.
- **Workspace dividers stay between charts.** In a mixed layout — say three charts stacked
  on the left beside two taller ones on the right — the divider between two stacked charts
  used to run the full width of the grid, so hovering or dragging over a neighboring chart
  could grab the divider instead of the chart under the pointer. A divider now covers only
  the stretch where two charts actually meet. Its hover highlight also matches the pane
  dividers inside a chart — the same soft band with a solid center line, in the theme's
  text color — instead of the old blue accent strip.
- **The symbol watermark stays inside its own chart.** The faded "SYMBOL · TF" mark was
  sized against the browser window, so in a multi-chart workspace a small cell could get
  type far wider than itself, spilling the text across its neighbors. The mark now measures
  itself against its own chart and shrinks to fit — a lone full-size chart keeps the large
  type, a dense grid gets proportionally smaller marks, and dragging a divider refits them
  live. The mark also fits and centers on the plot itself rather than the full chart, so in
  a narrow cell the text no longer runs under the price scale's numbers.
- **Resizing no longer makes charts flash or shake.** Two resize bugs, most visible in a
  workspace: dragging a divider across a chart mid-animation (a live tick easing in, a zoom
  glide) could blank it for a frame on every move, because the resized canvases waited for
  the next animation frame to repaint — they now repaint immediately. And a resize or layout
  change could leave a chart trembling rapidly (and burning a full animation loop in the
  background) until it was clicked: the zoom limits move with the chart's width, and an
  in-flight zoom or scroll animation whose destination fell outside the new limits kept
  chasing it forever. The animation now settles on the nearest reachable point and stops.

## [v0.4.6]

### Changed

- **History loads in one request up to 5 000 bars, in 10 000-bar chunks beyond.** The load
  used to start with a 200-bar head and widen by doubling (200 → 400 → 800 → …), which at
  the shells' default depth meant FOUR serialized round trips before the full history was
  there. That shape bought a faster first candle — but nothing downstream can use it: an
  indicator's first run is held until the whole depth lands (Pine is causal, so running it
  per chunk would repaint a different curve at every step). A round trip costs far more
  than the extra rows, so the ordinary case is now a single request, and the progressive
  path is reserved for genuinely deep history, where its chunks are flat 10 000-bar steps
  rather than a ramp. A rangeless feed keeps its preview-then-full shape past the same
  threshold, and a requested initial window still loads in one framed pass.

### Fixed

- **The chart-settings dialog closes when you click its ✕.** The header's drag handler
  skipped itself for the close button by comparing `e.target` to the button — but the
  button holds an SVG icon, so a press anywhere on the ✕ targets the icon's `<path>`
  instead. The header therefore took pointer capture and swallowed the click: the button
  only ever worked on the few pixels of padding around the glyph. It now tests ancestry
  (`closest`), like the other two draggable dialog headers already did.
- **Changing the bar count no longer rebuilds the chart.** `setMarket({ bars })` on the
  same market went through the full reload pipeline: it handed the renderer a fresh
  200-bar head, then doubled its way back up (200 → 400 → 800 → …), so the array was
  wholly replaced ~6 times and momentarily held FEWER bars than before the change. Every
  replacement was a "fresh series", which re-frames the view — the user's zoom was thrown
  away on any depth change, in both directions. A depth-only change is now an EXTENSION:
  growing re-enters the same backfill loop the initial load uses (older bars prepend, the
  viewport is preserved), shrinking trims the array in place from the oldest end, and
  neither restarts the indicator sessions. A feed with no ranged fetch, or an offline
  `data` series, still reloads — there is nothing to extend from.
- **An indicator no longer paints shifted while the bar array changes under it.** Anchor
  offsets were stored only when positive, so a model whose `anchorTime` was OLDER than the
  chart's first bar — exactly what a shorter series produces — was pinned at index 0 and
  drawn with its first value on the chart's first bar, i.e. the whole plot shifted left,
  for as long as the load took. Offsets are signed now: such a model skips the values that
  fall off the left edge instead. The renderer's logical interaction anchors (zoom glide,
  hover) learned the same symmetry — they followed a prepend but not a front trim.
- **A value patch can clear an indicator's anchor.** `anchorTime` was omitted rather than
  stated when a run spanned the whole chart, and an omitted key cannot undo a previous
  anchor — the model kept the offset of an earlier, narrower run. Patches now always carry
  the anchor, `null` included.
- **A workspace with named cells reported an empty grid.** `ws.cells()` came back empty
  for any workspace that declared its cells (`cells: { btc: …, eth: … }`): it looked the
  layout's positional slots up among the cells' own names, which only match when no name
  was declared. Everything else already spoke names — `ws.cell('btc')`, the active cell,
  the saved document — so the grid was consistent everywhere except this one list, and
  what read it inherited the blank. A plugin asking its widget context which charts the
  grid holds got nothing; a plugin registered _after_ the workspace was built never got
  its legend buttons onto the cells already on screen; and opening the symbol search left
  the other cells' in-chart dialogs open. Cells are now listed the way the rest of the
  workspace identifies them, in slot order, still leaving out the ones a smaller layout
  has parked.
- **Documentation that did not match the code.** The README advertised a screenshot
  shortcut that never existed (`alt+S`; the binding has always been `mod+alt+S`), left
  `vela/workspace` out of the entry-point list, described `persist` as restoring four
  cosmetic keys when it restores the whole state document — drawings and indicators
  included, listed two of the three `indicators` manifest forms (the async loader was
  missing), and still passed the removed `provider` option in both quick-start snippets.
  In the SDK, `WidgetContext.chart` claimed the shell rebuilds its chart on every
  symbol/timeframe change; those switches are applied in place.

### Added

- **Renderer feature defaults for plugins: `registerRendererDefaults`.** A renderer
  feature is per-chart state, set on an instance that does not exist yet when a plugin's
  enabler runs — so a plugin could contribute a chart type, an engine or a panel, but not
  "every chart should start with this feature set". This registry is the missing half,
  shaped like the other contribution registries and the renderer-side counterpart of
  `registerDefaultEngine`, except it reaches EVERY chart: the widget's, each workspace
  cell's, and a bare `new Vela()`. Values apply once the renderer mounts, before the first
  paint; they are defaults, not locks (an explicit `renderer.set(...)` or a restored
  config still wins), and charts already built are untouched. The disposer removes
  precisely what it set.

## [v0.4.5]

### Added

- **Strategy trades paint on the chart: `IndicatorModel.trades`.** An engine (or a native
  indicator) can now emit the ORDER EXECUTIONS of a strategy — `TradeExecution { time,
price, side, kind, label?, qty?, tradeId? }` — and the native renderer paints each one
  as a marker unit on the price pane: a fixed-size direction arrow hugging the fill bar
  (buys point up from below the low, sells down from above the high; exit fills carry a
  cap between arrow and bar), the order id and the signed quantity stacked OUTWARD from
  the bar (the quantity is always the outermost line), and a small tick at the exact fill
  price on the bar's trade-side edge. Fills on the same bar stack outward in execution
  order. The price pane's autoscale reserves the stacks' pixel headroom, so markers under
  the lows never clip at the pane edge. Executions ride the normal model/patch path:
  hiding the indicator hides its markers, removing it removes them, and `chart.inspect()`
  counts them (`trades` per indicator + in the totals).
- **The `tradeMarkers` renderer feature.** `chart.renderer.set('tradeMarkers', { visible?,
labels?, qty?, colors? })` — hide the units, the order-id line, or the quantity line, and
  override the palette (`colors: { long, short, exit }`, defaults `#2962ff` / `#f23645` /
  `#d500f9`; the text stays the theme's neutral text color). Partial merge, malformed
  fields dropped; persisted in the rich config (`trades` section) so templates carry it.
- **A `trades` renderer capability** (optional, like `drawingDepth`). The native renderer
  declares it; a custom renderer without it simply never paints the channel.

## [v0.4.0]

### Removed

- **BREAKING — the Pine Script engine has left this package.** `PineEngine`,
  `PineWorkerEngine` and `PineWorkerOptions` are gone from the root export, and with them
  the `pinets` peer/dev dependency and the build-time worker-inlining plumbing. Pine now
  lives in the **`@luxalgo/vela-pinets`** addon, which implements the same public
  `ScriptingEngine` port with identical semantics:

  ```diff
  - import { Vela, PineWorkerEngine } from '@luxalgo/vela';
  + import { Vela } from '@luxalgo/vela';
  + import { PineWorkerEngine } from '@luxalgo/vela-pinets'; // npm i @luxalgo/vela-pinets pinets
  ```

  Registration is unchanged (`chart.registerEngine('pine', …)`, the shells' `engines`
  option, `registerDefaultEngine`), so a one-line import swap is the whole migration.
  Script-tag users load `vela-pinets.global.js` **after** `vela.global.js`.

  The reason is licensing: the Pine runtime is AGPL-3.0, and shipping it here meant an
  Apache-2.0 library whose most-used feature dragged copyleft obligations behind it. The
  ACL now bans the import outright, so the obligation is taken on only by an application
  that installs the addon. Side effects: `vela.global.js` drops from ~3.5 MB to ~1.0 MB
  (~515 KB minified), and the engine layer becomes the one layer with no bundled default
  at all. See [Scripting engines](docs/user/scripting-engines.md).

### Added

- **Legend rows accept contributed actions: `registerLegendAction`.** An icon button on
  every indicator's legend row (revealed with the built-in controls, before the ✕),
  gated per indicator (`when(ind)`) and run with the shell's context — the seam a host
  editor uses to put "open this script" on each row. Ships with its two supporting
  pieces: **`handle.source`** (the script an indicator was added with — `undefined` for
  natives, the natural `when` gate) and an optional renderer seam
  (`setLegendActions?` on the port, wired by both shells through
  `chart.renderer.setLegendActions`; a custom renderer without it simply never shows
  the buttons). Late registrations appear after `refreshActions()`.
- **Contributed side panels can dock controls in their header.** `mount` now receives a
  third argument — `{ slot, setTitle }`: the slot is the space between the title and the
  close button (icon buttons, a document name), and `setTitle` rewrites the title text
  (empty hides it, the slot owning the row; the topbar toggle keeps the DECLARED title as
  its tooltip). Backward compatible — a two-argument `mount` ignores it.
- **`ctx.togglePanel(id, open?)`** on the plugin `WidgetContext` (both shells): open or
  close a docked side panel programmatically — the seam a plugin uses to open ITS OWN
  contributed panel (a code editor revealing itself on a host action, a panel opened from
  a topbar button). Same semantics as the topbar toggles: the dock stays exclusive, a bare
  call flips, unknown ids are ignored.
- **The symbol string is the whole market identity.** A bare ticker resolves against the
  registered providers in DECLARATION order (first whose index lists it); an `EXCHANGE:`
  prefix — case-insensitive, regional variants included (`BINANCE.US:BTCUSDT`) — pins the
  venue. One grammar everywhere the string travels: the options, `setMarket`, the symbol
  picker (it now composes the prefix from the row you picked — the workspace picker used
  to drop the venue entirely), `urlState` links (they finally carry the venue), and the
  persisted documents (older saves that stored `provider` beside a bare symbol weld back
  together transparently on restore).
- **Workspace cells are NAMED, not numbered.** A `cells` key is a free-form durable
  identity (`btc`, `main`, …) — persistence, `sync` groups and `ws.cell(name)` speak it —
  and DECLARATION ORDER fills the layout's slots. Any entry is optional (an undeclared
  slot boots on the top-level defaults with an auto name); entries beyond the layout wait
  dormant and appear when a larger layout reveals them; purely-numeric names are rejected
  with a warning (JS object keys would silently reorder them).
- **The `indicators` manifest can be an async loader.** `indicators: async () => manifest`
  — for filesystem reads, authenticated APIs, bundler dynamic imports — alongside the
  existing inline and URL forms; a rejecting loader behaves like a failing manifest URL.

- **One options vocabulary for both shells.** `VelaWidgetOptions` and
  `VelaWorkspaceOptions` now share the same base: every chart option (`VelaOptions`) plus
  the shell surface (`VelaShellOptions` — providers, engines, indicators, timeframes,
  timezone, chrome toggles, persistence), the widget adding only `urlState`, the
  workspace adding the grid (`layout`, `cells`, `sync`, `drawingToolbar`,
  `maxWebglCells`) and dropping only `height`. A chart option means the same thing
  everywhere: on the widget it configures the chart, on the workspace it is every
  cell's DEFAULT and `cells` overrides it per cell with the same words — which hands
  the workspace options it never had (`upColor`/`downColor`, `glow`, `animations`,
  `logScale`, `currentPriceLine`, `drawings` — toolbar excepted, the shared bar keeps
  that job — `defaultLanguage`, `renderer`, plus `data` and `visibleRange` top-level
  and per cell). An explicit `nativeBackend` now wins over the `maxWebglCells` budget
  policy. The storage contract is one type for both shells, `VelaStorage`
  (`WidgetStorage` / `WorkspaceStorage` stay as deprecated aliases).

- **An app can make an engine its default with one call.** `registerDefaultEngine(language,
factory)` on `vela/plugin`: every widget and workspace cell built afterwards registers
  `factory()` on its chart automatically (one instance per chart — engines hold per-chart
  state). A per-instance `engines` option still wins for its language, and the bare `Vela`
  chart never reads the registry — with nothing registered, nothing changes anywhere, and
  Vela still bundles no engine.

- **A scripting engine can now be built as a separate package.** `vela/plugin` gained the
  engine-authoring surface: the `ScriptingEngine` port types (completed with
  `EngineContextSnapshot`, `ContextSelect` and `BarsChangeReason`, now also on the root
  entry), the model vocabulary engine output is built from, the `stableSeriesId` identity
  contract — series ids, renderer reconciliation and persisted per-series settings stay
  identical whichever package an engine ships in — and the semantic palette. All additive;
  nothing moves or changes shape. The engine guide (`docs/contributing/adding-an-engine.md`)
  now documents the whole contract to match: the identity rule, the `historyState` /
  `notifyBars(reason)` backfill run policy, the `symbolInfo` / `chartStyle` request
  subtleties, the widget's `engines` factories and their `defaultLanguage` caveat, and
  how to package an engine standalone.

### Changed

- **BREAKING: the `provider` option is gone** — from the chart, the widget, the workspace
  and `setMarket`. Put the venue in the symbol: `provider: 'coinbase', symbol: 'BTC-USD'`
  becomes `symbol: 'coinbase:BTC-USD'`. `chart.market.provider` now reports the symbol's
  own prefix (undefined when bare); the venue that actually served it is
  `chart.data.resolve(symbol)`.
- **BREAKING (workspace): `cells` keys no longer address layout slots.** `cells: { c3: … }`
  used to target the THIRD slot; keys are names now and declaration order assigns slots —
  configs that declared entries in slot order (as every example did) render identically.
- **BREAKING (workspace): `defaults` is gone.** Its keys move to the top level, same
  words: `defaults: { symbol: 'BTCUSDT', timeframe: '60' }` becomes
  `symbol: 'BTCUSDT', timeframe: '60'`.
- **BREAKING (workspace): `persist` now defaults to localStorage**, like the widget —
  `persist: true` survives reloads out of the box. Session-only persistence is the
  opt-in now: pass `storage: memoryStorageAdapter()`.

### Fixed

- **The legend's tooltips are themed, not native.** The row controls (eye, gear,
  move-to-pane, ✕, contributed actions), the settings dialog's ✕ and its ⓘ input hints
  used the browser's `title` bubble — foreign next to the kit tooltips everywhere else.
  They now share one chrome tooltip (`renderers/shared/chrome-tooltip.ts`): same tokens,
  radius and shadow as the kit, self-themed so it works on a BARE chart (no `.vela-ui`
  host), with `aria-label`s kept for accessibility. The drawing toolbar's hand-rolled
  dwell tooltip was folded into the same helper (keeping its deliberate 2 s delay and
  beside-the-tool placement).
- **Typing inside an embedded editor no longer triggers chart shortcuts.** Both shells
  route any bare printable key to the symbol search (letters) or the timeframe entry
  (digits), and the guard that exempts text entry recognised only form controls and
  `contenteditable`. An element that merely declares `role="textbox"` — which is how
  editors built on the **EditContext API** (Monaco among them) expose their input — fell
  through it, so every letter typed into a docked code editor opened the symbol search
  instead. The guard now accepts that third spelling, and the widget, the workspace and
  the keymap share ONE definition of it (`isEditableTarget`) rather than the three
  near-copies they had drifted into.

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
