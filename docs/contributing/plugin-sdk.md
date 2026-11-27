# Vela™ plugin SDK

Everything importable from **`@luxalgo/vela/plugin`**. Four extension seams: **chart types**
(data + transform side), **renderer layers** (paint side), **native indicators**
(core-computed indicators with their own layers), and **drawing tools** (the interactive
tools a user places from the drawing toolbar) — plus the authoring surface for
**scripting engines**, which register per chart rather than into a registry. All
registries are id-keyed (re-registering an id replaces it) and read live — charts
constructed after registration pick the entries up. Drawing tools also reach the charts
that are already built.

## Chart types — `registerChartType`

A chart type is a new *price style*: an id that becomes valid for the style dropdown,
`renderer.set('priceStyle', id)`, and extended tickers.

```ts
import { registerChartType, type SeriesDataEngine, type SeriesDataEngineHost } from '@luxalgo/vela/plugin';

registerChartType({
    id: 'mytype',
    label: 'My Type',              // shown by the widget's style picker

    // 1) Optional BAR TRANSFORM — derive the view bars from the raw bars
    //    (this is how the built-in Heikin Ashi is implemented):
    barTransform: {
        full: (raw) => transformAll(raw),   // full recompute (history loads)
        next: (bar) => transformOne(bar),   // incremental (live ticks)
    },

    // 2) Optional TICKER MODIFIER — `"BTCUSDT;mytype"` resolves the transform for
    //    scripts running on a modified series. Defaults to `!!barTransform`.
    tickerModifier: true,

    // 3) Optional DATA ENGINE — per-chart secondary data (order flow, deltas, …):
    dataEngine: (): SeriesDataEngine => ({
        start(host: SeriesDataEngineHost) {
            // host.symbol / host.timeframe / host.live / host.bars()
            // host.data      → the chart's DataControl (providers, capabilities)
            // host.pushData(payload)        → the renderer channel named after YOUR id
            // host.pushPending(ranges)      → the `${id}-pending` loading protocol
        },
        suspend() {},   // style switched away — pause work, keep state
        resume() {},    // style switched back
        stop() {},      // chart destroyed
        onViewport?(range) {},  // debounced visible-range pokes (backfill on scroll)
        onBars?() {},           // the chart's bars changed: tick, new bar, prepended history
    }),
});
```

Lifecycle: the engine is created lazily the first time the chart enters the style
(after `chart.ready()`), suspended/resumed on style flips, stopped at destroy. A market
switch, or entering/leaving a [bar replay](../user/api-reference.md#chartreplay--the-bar-replay-control-surface),
stops it and builds a fresh one — during a replay `host.live` is `false` and `host.bars()`
ends at the replay cursor, so an engine that keys its fetches off `host.bars()` never sees
past it; `onBars` tells it when the cursor advanced.

Two more levers for full-replacement types:

- `basePainting: 'none'` suppresses the base candle painting while the style is active —
  for types whose renderer layer fully replaces the price representation (an order-flow
  grid, bricks…). Default `'candles'` keeps candles under your layer.
- `supports(facts)` says whether the type can draw a symbol, from the facts its data
  source states about it (`SymbolFacts`: `ohlc: false` for one value per bar,
  `volume: false` for no volume). Return `false` and the style menus grey the type out
  for that symbol, and a chart set to it draws a line instead, keeping your type as its
  chosen style: it comes back on the next symbol you support. It is only called once the
  facts are known (every type applies while they are not); absent, the type applies to
  every symbol. Keep it pure and cheap. A type built from volume:
  `supports: (facts) => facts.volume !== false`. The built-in candles, bars and Heikin
  Ashi follow the same rule with `facts.ohlc !== false`; `priceStyleApplies(id, facts)`
  answers it for any style id, built-in or registered, and `shownPriceStyle(id, facts,
  ids)` names the style a chart draws in its place (for a custom renderer).
- `chart.data.providerInstance(name)` returns the registered provider **instance** — the
  seam for extended provider surfaces: a provider may implement interfaces beyond the
  `DataProvider` port; your data engine retrieves the instance and narrows it with its
  own type guard.

A chart type may also declare a **settings section** (`settings: { title, rows,
visibility }`) that the chart-settings dialog renders as its own tab — values persist in
the renderer config, reach the type's renderer layer as `args.settings`, and its data
engine via `onSettings(values)`. Every value row reduces to ONE composite shape — the
`row` kind: a label, an optional leading toggle (controls dim while it is off), and an
ordered list of inline controls (`number`, `color`, `width`, `select`, `hint`) in any
mix — the classic `toggle`/`number`/`color`/`select`/`range` kinds are sugar over it
(`normalizeSettingsRow`/`settingsRowValueKeys` expose the canonical view for alternate
renderers). Rows and individual controls may carry declarative `when` conditions (shown
only while another key holds a value; a control's own `when` swaps it in and out live
and exempts it from the toggle-off dim), and a section may go structured: `layout:
'grouped'` promotes `heading` rows to a group TOC beside the rows, an `instances` tab
strip repeats blocks with add/remove via an `enableKey` boolean, `subsections` add
indented rail entries (with optional in-group `header` subgroup titles), and
`placement: 'after-symbol'` picks the rail position — all pure data, evaluated live by
the dialog. See [architecture/settings-rows.md](../architecture/settings-rows.md) for
the control kinds, conditions, the structured form, and how to add new ones.

## Renderer layers — `registerRendererLayer`

A layer owns one transparent canvas stacked into the native renderer's pile and is
repainted from the shared paint cycle. **The layer id doubles as its data channel** —
a chart type's `host.pushData` feeds the layer named like it with no extra wiring.

```ts
import { registerRendererLayer } from '@luxalgo/vela/plugin';

registerRendererLayer({
    id: 'mytype',                    // = the `setNativeData` channel it receives
    placement: 'above-data',         // or 'below-data' (behind the candles)
    repaintOnCursor: true,           // opt-in: pointer moves repaint this layer too
    create: () => ({                 // once per mounted renderer (+ once per instance of a multi-instance owner)
        mount(canvas) { /* keep the canvas reference */ },
        render({ bars, data, pending, coords, scale, bounds, theme, priceStyle, nowMs, cursor }) {
            // Always clear + repaint your own canvas. Gate on `priceStyle` if the
            // layer belongs to a chart type. Key mappings:
            //   coords.logicalToX(i) / coords.timeToX(ms)  → x
            //   coords.priceToY(price, scale, bounds)      → y
            //   coords.width / coords.dpr                  → sizing
            // `cursor` is the plot-relative pointer ({ x, y } | null) — hover
            // hit-testing input for layers that set `repaintOnCursor`.
        },
        animating?: () => false,     // return true while a pulse/fade needs frames
        modulateBase?: (args) => ({ candleBodyScale: 0.07, gridAlpha: 0 }),
        destroy?: () => {},
    }),
});
```

**Text reads left to right in every page.** The plot never mirrors, so the layer canvas
carries `dir="ltr"`: a 2D context you open on it lays text out left to right even when the
host page is right to left, and a sign stays in front of its number. Leave the context's
`direction` at its default (`'inherit'`) to keep that.

**Ownership — layers backed by a native indicator.** When a mounted native indicator's
type equals a layer's id, that indicator OWNS the layer, and the layer joins the chart's
normal object model instead of sitting outside it:

- **Stacking:** the layer canvas follows the owner's z key (`seriesOrder`, the object
  tree's drag/bring-to-front/send-to-back) against the candles' `candleZOrder` — restack
  the indicator below the candles and its layer paints behind them. Such an indicator
  mounts at the top of the stack (that is where an `above-data` canvas actually paints),
  so the recorded order is honest from the first frame. Granularity is the data canvas:
  model series composite inside ONE canvas, so an owned layer sits below or above that
  whole canvas, never between two individual plots. The gridlines are the floor: they
  paint on the backdrop canvas below every layer, so an indicator sent to the very back
  still renders on top of the grid.
- **Pane:** `args.scale`/`args.bounds` are the owner's pane — moving the indicator to
  its own pane takes the layer along. A study pane whose master content is only such
  layer natives autoscales from the visible bars (layer natives paint at bar prices), a
  collapsed host pane blanks the layer, and `modulateBase` is consulted only while the
  owner sits on the price pane.

- **Multi-instance owners:** when the owning type allows several instances
  (`multiInstance: true` on its descriptor), each instance owns a layer of its own — the
  definition's `create()` runs once per mounted renderer for the base layer AND once per
  such instance, each on its own canvas, fed by that instance's channel, stacked and
  paned by that instance. The base layer of such a type receives no data (every instance
  has its own channel) and paints nothing.

Chart-type channels (no owning indicator) keep the declared `placement` and the price
pane, exactly as before.

Two per-frame levers beyond the basic contract:

- **`repaintOnCursor`** (definition): pointer moves normally repaint only the crosshair
  overlay; a layer that hover-tests (tooltips, row highlights) sets this flag and is
  repainted — its own canvas only — whenever the cursor moves, with `args.cursor` fresh.
- **`modulateBase`** (instance): the gradual counterpart of the chart type's
  all-or-nothing `basePainting: 'none'`. Called after `render` on every mounted layer
  that implements it (not only the active price style — an overlay that needs room
  beside the candles uses the same hook). The returned `{ candleBodyScale?,
  candleBodyAlpha?, gridAlpha? }` dims/slims the base painting for that same frame
  (values clamped to [0..1]; omitted fields keep their defaults). Return null for no
  opinion. When several layers speak, each field keeps the strongest (smallest)
  request. This is how a reveal-under style — or an overlay — fades candles down as
  its own layer fades in, instead of switching them off entirely.

## Native indicators — `registerNativeIndicator`

Core-computed indicators (no script engine) with renderer-drawn layers — the built-in
volume and VPVR ride this seam. See `NativeIndicator` types in `@luxalgo/vela/plugin`.

A type is **single-instance** by default: a second `addNativeIndicator` of the same type
returns the existing handle. Set `multiInstance: true` on the descriptor when a chart may
carry several instances (a study users stack at different settings); every add then
creates a fresh instance. This holds for layer-backed types too: each instance of a
multi-instance type that paints through a registered renderer layer gets its **own layer
instance** — the layer's `create()` runs once more per instance, on its own canvas,
reading that instance's own data channel (the channel is stamped on the model as
`native.channel`; `pushData` routes there automatically) and following that instance's
pane and stacking. Nothing changes for the layer code: `args.data` is still "my payload".
Every running instance also knows its own id (`ctx.id` — the same id its handle and
`inspect()` report), so an instance can name itself to host code and tell itself apart
from its siblings. Set `catalog: false` on a descriptor whose entry point lives outside
the generic indicator picker (such as the built-in `'compare'` symbol comparison): it
stays excluded from `chart.availableNativeIndicators()` while remaining addable through
`chart.addNativeIndicator(type, { inputs })`. An emitted `NativeIndicatorOutput` can also
override the instance's `title`, `shortTitle`, `paneHint`, and `ownScale`, opt into
independent visible-bar normalization in percent/indexed mode (`percentBaseline: 'own'`),
and request a colored last-value + name chip on the price axis (`priceAxisLabel: true`).

A [bar replay](../user/api-reference.md#chartreplay--the-bar-replay-control-surface)
restarts every native when it starts and when it ends, the way a market switch does. While
it runs, `ctx.live` is `false` and `ctx.bars()` ends at the replay cursor, so a native that
opens its own live feed when `ctx.live` is set never streams the present into a past chart.
Each revealed bar reaches it through `onBars()`.

**History that arrives in stages.** A chart's history can land in parts: a deep load streams
older chunks in behind the first candles, a source still completing a cold symbol answers
with growing snapshots, and a deeper depth picked from the settings is fetched in the
background. An emitted output is index-aligned to `ctx.bars()` as it stands at the `emit`
call, and the chart keeps it on those bars when older history lands in front of them (or the
oldest bars are trimmed), so a plot never slides while it waits for its next compute. By
default an instance starts on the first candles and `onBars()` fires for every part as it
lands. Set **`waitsForHistory: true`** on the descriptor when the values depend on every
earlier bar (a moving average's seed, an oscillator's smoothing): the instance then starts
only once the history is complete — its legend row shows a loading state meanwhile, and
`ready` / `indicator:added` wait for its first output — and a history extended later holds
`onBars()` (live ticks included) until the extension completes, the previous output staying
on its bars. The built-in classic studies opt in; volume and VPVR, which paint straight from
the candles, do not.

`onBars()` also fires when a price style re-derives the candles (Heikin Ashi): `ctx.bars()`
returns the candles the chart shows, so a compute over them follows the style.

A native that is really **host-owned chrome** — trade markers from a journal, event flags,
anything whose on/off switch lives in the host's own UI — can opt out of in-chart chrome with
`legend: false` on the descriptor. Its output still computes and paints, but the chart mounts
no legend row for it (no title chip, no eye/gear/✕, not counted by the fold chip) and
`panes.list()` does not report it, so the object tree shows nothing either. The host controls
it through the `IndicatorHandle` it got from `addNativeIndicator` (`remove()`, `setVisible()`).
This is different from hiding: a hidden indicator keeps its row so the user can unhide it; a
legend-less one has no row to begin with.

A native whose visuals come entirely from a bespoke renderer layer (its `type` equals a
registered layer id) can override the axis of the pane it OWNS by emitting **`paneAxis`**
on its output: such content is not value-mapped (the layer paints in pixel bands), so a
derived price scale would label meaningless numbers. Two shapes:

- `paneAxis: 'none'` — a blank axis;
- `paneAxis: { bands: [{ frac, label }, …] }` — a **categorical axis**: each label is
  drawn in the axis column (same typography as price ticks) at `frac` of the pane's
  height (0 = top, 1 = bottom) — e.g. a table pane labels its rows at their centers.

Either way the pane draws no price ticks, no horizontal gridlines, and no crosshair
value chip. The override is emitted per compute, so it can follow the inputs (toggling a
row off relabels the axis). It only holds while overriding natives are the pane's sole
content; merging any real series into the pane brings the price axis back.

## Widget actions — `registerWidgetAction`

Contribute UI as **data descriptors** (never DOM) — the widget projects them into its
chrome; a future React view projects the same descriptors.

```ts
import { registerWidgetAction, registerIcon } from '@luxalgo/vela/plugin';

registerIcon('rocket', '<svg …>…</svg>'); // optional, inline SVG (stroke currentColor)

registerWidgetAction({
    id: 'mytool.open',
    target: 'topbar',            // or 'sidebar' | 'drawings' | 'context:body' |
                                 //  'context:price-axis' | 'context:time-axis'
    label: 'My tool',            // ALWAYS required: aria-label, tooltip, mobile row text
    icon: 'rocket',
    iconOnly: true,              // topbar only: no button text — the native 32px tool look
                                 //  on the right cluster (label becomes aria-label + a kit
                                 //  tooltip; mobile surfaces keep their text). Requires
                                 //  `icon`. The piece that makes a 'screenshot' slot
                                 //  override pixel-faithful to the button it replaces.
    order: 10,                   // sort key: within the contributed group on the topbar;
                                 //  among the built-in rows in a right-click menu (see below)
    align: 'left',               // topbar only: 'left' joins the primary chrome cluster
                                 //  (after the style/layout dropdowns, styled like them);
                                 //  'right' (default) the right-hand tools cluster
    mobile: 'menu',              // topbar only: on the mobile layout, 'bar' (a bottom-bar
                                 //  stop) or 'menu' (a three-dots row); default: 'bar'
                                 //  for align: 'left', 'menu' otherwise
    when: (ctx) => ctx.priceStyle === 'mytype',   // optional runtime gate
    run: (ctx) => {
        // ctx.chart (the CURRENT inner chart) · ctx.symbol / timeframe / priceStyle
        // ctx.setSymbol / setTimeframe / setPriceStyle / openSymbolSearch(query?)
        // ctx.togglePanel(id, open?) — open/close a docked side panel (dock stays exclusive)
        // ctx.panels — the dock as data: list() (built-ins flagged), openId(),
        //   isMaximized(id), onDidChange(cb) (see Side panels)
        // ctx.topbar — the built-in topbar items: isVisible(id), setVisible(id, visible)
        //   (see Hiding built-in topbar items)
        // ctx.sidebar — the right-edge toolbar: enabled, setBadge(id, value), refresh(),
        //   isVisible(id), setVisible(id, visible) (see The sidebar)
        // ctx.dockStrip(el, { position? }) — dock an element as a full-width strip above
        //   (default) or under the bottom bar (the charts shrink); returns the undock, which
        //   also carries cover(on) (see Layout regions)
        // ctx.dockEdge(el, 'right') — dock an element at the shell's outer right edge, full
        //   height (a rail); returns the undock
        // ctx.replay (workspace) — bar replay across every cell on one clock; drive it
        //   rather than one cell's chart.replay so every chart replays together
        // ctx.addIndicator({ name, script, id?, language? }) — add a script indicator
        //   THROUGH the shell: recorded in the unified undo/redo timeline and the
        //   indicator count. `id` is the indicator's id on the chart (omit: minted);
        //   undo/redo re-add under the same id
        // ctx.addNativeIndicator(type) — same, for native (core-computed) indicators
        // ctx.stateChanged() — persistable third-party state changed (debounced save)
        // ctx.host  — mount host for kit components (Dialog/DropdownMenu/Tooltip)
        // ctx.toast(message, kind?) — the widget's feedback pill
        // ctx.pointer (context:* only) — where the right-click landed: { price, time, paneKind, paneId }
    },
});
```

Topbar actions render as buttons in the right-hand cluster by default; `align: 'left'`
moves one into the primary chrome cluster instead — right after the style/layout
dropdowns, wearing the same height/typography as the built-in buttons there (that is
the built-in Indicators button's exact spot and look, for actions that replace it).
On the mobile chrome the split carries over: left-aligned actions get their own
icon-only stop in the bottom bar (the built-in indicators slot), while right-aligned
ones stay in the three-dots sheet. `mobile` overrides it per action: a left action with
`mobile: 'menu'` becomes a three-dots row with the primary rows (right after Layout),
and a right action with `mobile: 'bar'` gets a bottom-bar stop. The bottom bar asks `when`
again whenever the shell switches between its desktop and mobile layouts, so a gate that
reads the layout (`ctx.host.closest('[data-layout]')`) shows a phone-only stop as soon as
the shell turns mobile. Every contributed button and stop carries its action's id as
`data-action-id`. `context:*` actions become
rows of the matching right-click menu zone (see [Right-click menu
actions](#right-click-menu-actions)). Register at import time — a widget constructed later
picks them up; after late registrations call `widget.refreshActions()`.

`align`/`order` are the action's *suggestion* — the HOST has the last word: the shell's
`topbar: { left, right }` option (see [Composing the
topbar](../user/workspace.md#composing-the-topbar)) can pin an action id at an exact
position (overriding both), or omit the `'actions'` flow slot entirely, in which case
unpinned actions don't render on that side. Publish your action ids (a stable exported
constant) so hosts can compose with them.

### Hiding built-in topbar items

A plugin that hosts one of the shell's own controls elsewhere (its own alerts surface, a
rail of panel toggles) hides the built-in at runtime through `ctx.topbar`:

```ts
registerWidgetAttachment({
    id: 'mytool.alerts',
    mount: (ctx) => {
        ctx.topbar.setVisible('alerts', false);   // the bell, its mobile menu row
        return () => ctx.topbar.setVisible('alerts', true);
    },
});
```

The ids are the built-in composition ids: `'symbol'`, `'compare'`, `'timeframes'`, `'style'`,
`'layout'`, `'indicators'`, `'undo-redo'`, `'alerts'`, `'panels'`, `'screenshot'` and
`'fullscreen'`.
Runtime visibility narrows the host's `topbar` composition and follows its rule: hiding an
item removes its other entry points with it — its row in the mobile three-dots menu, its
bottom-bar stop, its keyboard chord (`mod+alt+S` for `'screenshot'`, `alt+Enter` for
`'fullscreen'`). Hiding `'panels'`
also removes the panel rows from the mobile menu, so a plugin that moves the panel toggles
elsewhere on the desktop keeps them reachable on a phone by hiding `'panels'` only on the
desktop layout. `ctx.topbar.isVisible(id)` reads the result. It never shows an item the
composition left out, and it is not saved with the layout: apply it again when you mount.

Two rules keep actions portable:

- **Everything through `ctx`, no outer references.** `when`/`run` must not close over a
  widget or chart instance — the context is rebuilt per invocation, so it always binds
  the widget that projected the action (and, in a future multi-chart shell, the
  **active** chart). Every member of the context is LIVE — `ctx.chart` resolves the
  current chart at call time, and `ctx.symbol` / `ctx.timeframe` / `ctx.priceStyle`
  (and a workspace's `ctx.cells` / `ctx.activeCellId`) are getters that follow every
  market and active-cell switch. Read them at the point of use; copying one into a
  variable at mount freezes it (an attachment once named screenshot files after the
  mount-time symbol that way).
- **Kit components get `ctx.host`.** Mounting a `Dialog`/`DropdownMenu`/`Tooltip` without an
  explicit host portals it to `<body>`, outside the theme's CSS variables (invisible
  backgrounds). Pass `host: ctx.host`.

### Right-click menu actions

The three `context:*` targets add rows to the chart's right-click menus: `context:body` (the
plot), `context:price-axis` (a pane's price scale) and `context:time-axis`. The context
handed to their `when` and `run` carries **`ctx.pointer`**, where the right-click landed,
read from the crosshair of the chart that received it (in a workspace, the cell under the
pointer, which the right-click also makes active):

- `price` — the value under the pointer on its pane: a price on the price pane, an
  indicator value on a study pane. `null` off the plot.
- `time` — the open time of the bar under the pointer; `null` off the bars.
- `paneKind` — `'price'` or `'study'`; `null` off the plot.
- `paneId` — the pane's id, as `ctx.chart.panes.list()` reports it; `null` off the plot.

In a workspace, the right-clicked cell is the active one by the time `when` runs, so
`ctx.activeCellId` names the chart and `ctx.chart` is that chart.

`ctx.pointer` is captured when the menu opens, so `run` sees the right-clicked spot even
though the mouse moved through the menu to pick the row. The axis menus get what the
crosshair reports over the axis: `price`, `paneKind` and `paneId` are `null` there, while
`time` still names the bar column under the pointer (on the time axis, the bar above the
click).
Every other context (topbar actions, attachments, panels) has no `pointer`.

```ts
import { registerWidgetAction } from '@luxalgo/vela/plugin';

registerWidgetAction({
    id: 'mytool.copy-price',
    target: 'context:body',
    label: 'Copy price',
    icon: 'clone',
    order: -100,                                   // lead the menu
    when: (ctx) => ctx.pointer?.paneKind === 'price',
    run: (ctx) => void navigator.clipboard.writeText(String(ctx.pointer!.price)),
});
```

Contributed rows sort **together** with the built-in rows by `order` (ascending, default
0). The built-in rows sit at fixed ranks, exported as `CONTEXT_MENU_BUILTIN_ORDER`:

| Menu | Built-in rows and ranks |
| --- | --- |
| `body` | Reset chart view −30 · Remove drawings −20 · Remove indicators −10 · Settings… 1000 |
| `price-axis` | Auto −80 · Invert scale −70 · Regular −60 · Percent −50 · Indexed to 100 −40 · Logarithmic −30 · Labels −20 · Levels −10 · More settings… 1000 |
| `time-axis` | Time zone −10 · More settings… 1000 |

So an action without `order` lands after the built-in actions and before the settings row,
`order: -100` leads the menu, and `order: 1001` follows the settings row. On a tie the
built-in row comes first, then the actions in registration order. Separators split the menu
into groups and never open or close it: the built-in groups (body: Reset chart view | the
two removals | Settings…; price axis: Auto and Invert | the four scale modes | Labels and
Levels | More settings…; time axis: Time zone | More settings…), and each run of
consecutive contributed rows. An `order` that falls inside a built-in group
splits it around your row. The built-in body rows carry icons; give yours an `icon` so it
reads the same (an iconless row keeps its label aligned with the others). The axis menus
carry none: a row added there shows without its `icon`, its label in line with the
checkmarked rows.

## Widget attachments — `registerWidgetAttachment`

An action is one button; an **attachment** is a unit of per-widget behavior — an overlay, a
gesture, custom key handling. It mounts once per widget with the same `WidgetContext`, and
returns a disposer the widget runs at destroy:

```ts
import { registerWidgetAttachment } from '@luxalgo/vela/plugin';

registerWidgetAttachment({
    id: 'mytool.overlay',
    mount: (ctx) => {
        const el = document.createElement('div');
        ctx.host.appendChild(el);                     // the THEMED widget root
        const onKey = (e: KeyboardEvent) => { /* … ctx.chart.drawings.setTool('trendline') … */ };
        document.addEventListener('keydown', onKey, true);
        return () => {                                // runs when the widget is destroyed
            document.removeEventListener('keydown', onKey, true);
            el.remove();
        };
    },
});
```

Attachments mount at widget construction (and on `widget.refreshActions()` for late
registrations), once per id per widget. The same portability rules as actions apply: everything
comes from `ctx`, never from module state.

## Replacing a built-in button — slot overrides

The topbar's built-in entries are named SLOTS (see [Composing the
topbar](../user/workspace.md#composing-the-topbar)). The simple-button slots —
**`'indicators'`**, **`'screenshot'`**, and **`'compare'`** — can be TAKEN OVER by a plugin: register an
action under the built-in id, and the override owns the slot's **whole surface**:

- the desktop button renders your action at the slot's position (native button gone);
- the slot's mobile counterpart (the mobile-bar Indicators stop, the more-drawer
  Screenshot button or Compare symbol row) routes to your `run(ctx)`;
- the slot's keyboard chord (`/` for indicators, `mod+alt+S` for screenshot) routes to
  your `run(ctx)` too — don't bind your own;
- the native machinery behind the slot is not constructed (the built-in indicator
  picker dialog for `'indicators'`, or the comparison picker dialog for `'compare'`).

The composite slots (`symbol`, `timeframes`, `style`, `layout`, `undo-redo`, `alerts`,
`panels`) are stateful controls the shell pushes state into — a `{label, icon, run}`
descriptor cannot stand in for them, so registering under those ids is refused with a
console warning.

Position follows the composition rules: a host-declared list places the slot wherever
it lists the id (and omitting the id hides your override with the slot — the host
keeps the last word); on a default side the override sits exactly where the native
button was, unless it declares `order` — then it flows like an ordinary action.

## Replacing the indicator menu

Replacing the built-in indicator dialog is the canonical slot override plus the two
contributions above — **no shell option needed**:

- **Your menu is an ordinary contribution**: a topbar **action registered under the id
  `'indicators'`** provides the button (and inherits `/` + the mobile stop), a widget
  **attachment** owns the per-shell dialog. Everything a menu needs is public on the
  context — the native catalog via `ctx.chart.availableNativeIndicators()`, and
  **shell-routed adds** via `ctx.addNativeIndicator(type)` and
  `ctx.addIndicator({ name, script, id?, language? })`. Prefer these over the raw
  `ctx.chart.addNativeIndicator` / `ctx.chart.addIndicator`: the context forms enter
  the shell's unified **undo/redo timeline** and the topbar indicator count, exactly
  like an add from the built-in picker — the raw chart calls bypass the shell and stay
  invisible to Ctrl+Z. `ctx.host` is the mount host for kit components.
- The `indicators` manifest still resolves and auto-adds its enabled entries — the
  override replaces the UI, not the ledger.
- The historical **`indicatorPicker: false`** shell option is deprecated (removal in
  0.7.0): to *hide* the built-in surface without replacing it, omit `'indicators'`
  from `topbar.left` — same effect (no button, no mobile stop, no `/`, no dialog).

```ts
import { registerWidgetAction, registerWidgetAttachment } from '@luxalgo/vela/plugin';
import { Dialog } from '@luxalgo/vela/ui';

// One menu per shell: the attachment owns the lifecycle, the action opens it.
const menus = new WeakMap<HTMLElement, Dialog>();

registerWidgetAttachment({
    id: 'mytool.indicator-menu',
    mount: (ctx) => {
        const dialog = new Dialog({
            title: 'Indicators',
            host: ctx.host,
            closeOnInteractOutside: true,
            content: (body) => {
                void ctx.chart.availableNativeIndicators().then((natives) => {
                    for (const n of natives.filter((n) => n.supported)) {
                        const row = body.ownerDocument.createElement('button');
                        row.textContent = n.title;
                        row.addEventListener('click', () => ctx.addNativeIndicator(n.type)); // undo/redo-recorded
                        body.appendChild(row);
                    }
                    // …plus any script rows: ctx.addIndicator({ name, script, language: 'pine' })
                });
            },
        });
        menus.set(ctx.host, dialog);
        return () => dialog.destroy();
    },
});

registerWidgetAction({
    id: 'indicators',      // the built-in SLOT — button, mobile stop and `/` are yours
    target: 'topbar',
    label: 'Indicators',
    icon: 'indicators',    // the shells' own icon id — reuse it for a familiar button
    run: (ctx) => menus.get(ctx.host)?.show(),
});
```

No host-side wiring: any page that imports your package (before constructing shells)
gets your menu in place of the built-in one. Any plugin — not just one blessed
package — can ship its menu through this same public surface. One caveat to design
for: indicators added through `ctx.addIndicator` live on the chart and in the undo
timeline, but are **not** part of the shell's persisted manifest ledger (their names
would never resolve against the host's manifest on restore) — your menu owns their
persistence if you want them back after a reload, and
[`registerStatePersistence`](#state-persistence--registerstatepersistence) is the seam
built for exactly that.

## Symbol ranking — `registerSymbolRanking`

The shells' symbol-search dialog displays the providers' AGGREGATED symbol index. A
plugin (or host) can own its display order — one hook, last registration wins:

```ts
import { registerSymbolRanking } from '@luxalgo/vela/plugin';

registerSymbolRanking(async (pool) => {
    const top = await fetchTopSymbols();               // may be async — a server-driven list
    const rank = new Map(top.map((t, i) => [t.ticker, i]));
    const head = pool.filter((s) => rank.has(s.ticker)).sort((a, b) => rank.get(a.ticker)! - rank.get(b.ticker)!);
    const rest = pool.filter((s) => !rank.has(s.ticker));
    return [...head, ...rest];                          // full display order, all sources combined
});
```

The contract:

- **The hook sees the whole pool** — every source combined, exactly what the dialog
  shows — and returns the full display order. Cross-source ordering (a top list mixing
  venues) is the point.
- **Called when the pool changes** (a provider's index lands or refreshes), never per
  keystroke — the picker caches the result. Async results land on the next repaint
  (stale-while-revalidate in between).
- **Empty query = the head of your list.** The built-in "majors first" pin stands down
  while a ranking is registered. Under a typed query, the relevance tiers still lead
  (prefix > substring > description > venue) — your order breaks ties within each
  tier. Venue browsing (`nasdaq …`) stays alphabetical.
- **Injection and hiding**: the returned list may contain descriptors absent from the
  pool (give them their `provider`, and only inject what a provider actually serves —
  selecting an unservable row parks the load) and may omit entries. Duplicates keep
  their FIRST occurrence, so injecting at the head fixes both position and data.
- A failing or rejecting hook is contained: the pool order stands, with a console
  warning.

## State persistence — `registerStatePersistence`

The shells persist one versioned **state document** (`getState()` / `applyState()`,
written to storage in `persist` mode). A plugin can put its own state INTO that document
— instead of running a parallel store that can drift from it — through the document's
`ext` bags: one at the document root, one per chart. A registered handler owns one
namespaced key and says how its entry is written and read back:

```ts
import { registerStatePersistence } from '@luxalgo/vela/plugin';

// Per-chart state (scope 'cell'): one entry per chart, following the chart through
// layout switches, the dormant pool, and shell-to-shell document moves.
// The canonical use: restoring indicators your own menu added via ctx.addIndicator.
registerStatePersistence({
    key: 'mytool.indicators',                 // namespaced, flat: 'vendor.feature'
    scope: 'cell',
    serialize(ctx) {
        // Snapshot whatever your plugin needs to re-add its indicators later — refs
        // (slugs/ids) beat full sources: the document stays light. `undefined` = no entry.
        // Storing each indicator's chart `id` lets the restore bring it back under the
        // id your document already knows (`ctx.chart.indicators()` reads the live ones).
        const mine = trackedIndicators(ctx.cellId); // your bookkeeping
        return mine.length > 0 ? mine.map((i) => ({ slug: i.slug, id: i.id })) : undefined;
    },
    restore(payload, ctx) {
        // The payload is UNTRUSTED (the codec passes `ext` through opaquely) — validate.
        if (!Array.isArray(payload)) return;
        for (const item of payload) {
            if (typeof item?.slug !== 'string') continue;
            const id = typeof item.id === 'string' && item.id ? item.id : undefined;
            void fetchSource(item.slug).then((script) =>
                // Cell-bound adds: THIS chart (not the active one), and muted — a
                // restore never pollutes the undo timeline. With `id`, the indicator
                // comes back under the recorded id (undo/redo keep it too).
                ctx.addIndicator({ name: item.slug, script, language: 'pine', id }),
            );
        }
    },
});

// Document-level state (scope 'global'): one entry per document — shared preferences.
registerStatePersistence({
    key: 'mytool.prefs',
    scope: 'global',
    serialize: () => ({ starred: [...starred] }),
    restore(payload) {
        if (payload && typeof payload === 'object' && Array.isArray((payload as { starred?: unknown }).starred)) {
            starred = new Set((payload as { starred: string[] }).starred.filter((s) => typeof s === 'string'));
        }
    },
});
```

The resulting document (what `persist` writes and `getState()` returns):

```jsonc
{
    "version": 1,
    "layout": "4",
    "charts": [
        { "id": "c1", "symbol": "BTCUSDT", /* … */ "ext": { "mytool.indicators": [{ "slug": "my-osc", "id": "mytool:my-osc:1" }] } }
    ],
    "ext": { "mytool.prefs": { "starred": ["my-osc"] } }
}
```

The contract, in five rules:

- **Register at import time**, before shells are constructed — the rule every
  contribution registry shares. Re-registering a key replaces the handler.
- **`serialize` runs on every shell snapshot** (`getState`, each debounced persist
  write). Return a JSON-serializable payload, or `undefined` for "no entry". When your
  state changes outside any shell event (no indicator add, no market switch), call
  `ctx.stateChanged()` so a save is scheduled — indicator adds/removals already
  trigger one.
- **`restore` runs when a document carrying your key is applied** — boot restore,
  host `applyState` — after the core state is in place (chart alive, engines
  registered, indicator ledger converged). Cell-scope restores run **muted**, and the
  cell context's `addIndicator`/`addNativeIndicator` are muted on their own too — so
  an **async** restore (fetch a source, then add) also stays out of the undo/redo
  timeline. It is only called for keys the document actually carries.
- **The payload is opaque to Vela™ and untrusted by you.** The codec round-trips `ext`
  entries verbatim — including keys whose plugin is not loaded this session, so a
  plugin-less reload never loses your state — and validates nothing inside them:
  your `restore` must.
- **Scope picks the bag.** `'cell'` entries live on each chart (`charts[i].ext`) and
  travel with it; `'global'` entries live at the document root (`state.ext`). Handlers
  whose restore touches chart content belong in `'cell'` scope — its context is bound
  to the right chart even when it is not the active one.

## Legend actions — `registerLegendAction`

An icon button on every indicator's **legend row**, revealed with the built-in controls
(hover/selection) between them and the ✕. The classic use: open the row's script in a
host editor.

```ts
import { registerLegendAction, registerIcon } from '@luxalgo/vela/plugin';

registerLegendAction({
    id: 'mytool.open-source',
    icon: 'code',                                  // vela/ui icon registry
    tooltip: 'Open the source',
    when: (ind) => ind.language === 'pine',        // per-indicator gate: the scripts this editor reads
    run: (ctx, ind) => myEditor.open(ind.source!), // ctx = the shell's WidgetContext
});
```

- `ind` is a `LegendIndicatorInfo`: `{ id, title, source?, language? }` — `source`
  is the script the indicator runs NOW (the same as `handle.source`, read at click time,
  so an in-place `updateCode` shows through); `language` is the language id of the
  engine running it (the same as `handle.language`: the indicator's `language` option,
  else the chart's `defaultLanguage`). Both are `undefined` for native indicators. Gate
  on `source` for an action that suits any script, and on `language` for one that only a
  single language supports: an editor for one language must not open a script that
  another engine runs.
- The descriptor resolves **per row, per click**: `when` re-evaluates as rows appear, and
  `run` receives a fresh context each time.
- Register at import time; after a late registration call `refreshActions()` (both shells
  re-project the rows already on screen).
- The seam degrades gracefully: a custom renderer without `setLegendActions` simply never
  shows contributed legend actions (same rule as the sync ghost crosshair).

## Legend callouts — `registerLegendCallout`

A small tinted **callout bubble** with a centered icon, visible right of an
indicator's legend title while the row is idle (it hides while the hover/selection
controls are out). Hover shows its tooltip; when the spec carries `content`, clicking
deploys a panel of text blocks and action buttons — below the bubble, flipping above
it near the bottom screen edge. The classic use: a live status a user can act on (a
market-session badge, a "new version available" notice with an Update button).

```ts
import { registerLegendCallout } from '@luxalgo/vela/plugin';

registerLegendCallout({
    id: 'mytool.status',
    callout: (ind) => ({
        icon: 'market-open',                          // vela/ui icon registry
        background: 'color-mix(in srgb, var(--vela-up) 20%, transparent)',
        color: 'var(--vela-up)',                      // icon ink (default: the row's text color)
        tooltip: `${ind.title}: live`,
        content: {                                    // omit → a plain, non-clickable badge
            title: 'Indicator status',
            items: [
                { type: 'text', text: 'Computing on live bars.' },
                { type: 'button', label: 'Details', primary: true, run: (ctx, i) => ctx.togglePanel('mytool.panel') },
                { type: 'button', label: 'Mute', close: false, run: (ctx, i) => mute(i.id) },
            ],
        },
    }),
});
```

- Unlike a legend action's static icon, the whole presentation is **resolved per row**
  through `callout(ind)` — return `null` to show none (the per-indicator gate), or a
  spec whose icon/tint/panel follow your own state. When that state changes, call
  `refreshActions()` and the bubbles re-dress.
- Panel content is **data, never DOM**: ordered `text` and `button` items (consecutive
  buttons share one row). A button's `run` receives a fresh `WidgetContext` plus the
  row's `LegendIndicatorInfo`; buttons close the panel after `run` unless
  `close: false`.
- The bubble itself is the kit's `CalloutBubble` (`@luxalgo/vela/ui`) — reusable in
  host chrome; the widget's own market-status badge is the same component.
- The seam degrades gracefully: a custom renderer without `setLegendCallouts` simply
  never shows contributed callouts.

## Drawing tools — `defineDrawing`

A **drawing tool** is a type in the drawing registry: an entry of the drawing toolbar that a
user arms and places, like the trend line or the Fibonacci retracement. `defineDrawing`
registers one from a single object. You describe what the tool paints as a list of shapes;
placement, handles, hit-testing, the settings panel, undo, copy and paste, and saving follow
from that description.

```ts
import { LINE_FIELDS, defineDrawing, lineValueAt, type ShapePoint } from '@luxalgo/vela/plugin';

const unregister = defineDrawing({
    type: 'acme.midline',      // the type key: namespace it
    label: 'Midline',
    group: 'lines',            // joins the built-in Lines section; omit for a group of its own
    props: { ratio: 0.5 },     // the tool's own settings and their defaults, saved with each drawing
    settings: [...LINE_FIELDS, { path: 'props.ratio', label: 'Ratio', kind: 'number', min: 0, max: 1, step: 0.05 }],
    shapes: (c) => {
        const [a, b] = c.points;   // the two points, in plot pixels
        if (!a || !b) return [];   // still being placed
        const mid: ShapePoint = [a[0] + (b[0] - a[0]) * c.props.ratio, a[1] + (b[1] - a[1]) * c.props.ratio];
        return [
            { kind: 'line', from: a, to: b },
            { kind: 'marker', at: mid, shape: 'diamond', part: 'mid', tip: `Ratio ${c.props.ratio}` },
        ];
    },
    // What an alert on the drawing compares the price with.
    valueAt: (time, d, proj) => (d.anchors.length < 2 ? null : lineValueAt(d.anchors[0]!, d.anchors[1]!, time, { proj, paneId: d.paneId })),
});
```

`defineDrawing` returns the function that unregisters the tool. The tool joins the toolbar of
every chart, the charts already on screen included. `chart.drawings.setTool('acme.midline')`
arms it and `chart.drawings.add('acme.midline', { anchors })` places one from code.

The repository's `playground/custom-drawings.ts` holds nine complete tools written against this
entry alone: a spiral, an anchored VWAP, a retracement with editable levels, a regression
channel, a zone, a position, a volume profile, a five-point pattern, and a tool made of two
built-in ones.

### The definition

| Member | What it does |
|---|---|
| `type` | The **type key**: what `setTool`, `add` and a saved drawing's `type` carry. Any string. Namespace it (`'acme.spiral'`) so it never meets a tool a later release adds. |
| `label` | The tool's name in the toolbar, the settings and the object tree. A string, or a `msg()` to follow the chart's language. |
| `icon` | Inline SVG markup for the toolbar. Default: a generic curve. |
| `group` | The toolbar group (see [Toolbar groups](#toolbar-groups)). Default `'custom'`. |
| `toolbar` | `false` keeps the tool off the default toolbar: your own interface arms it with `chart.drawings.setTool(type)`. |
| `shapes(ctx)` | **Required.** The drawing as shapes for this frame (see [Shapes](#shapes)). |
| `props` | The tool's own settings and their defaults. Each drawing saves its own copy as `props`, so keep them plain JSON. |
| `style`, `text` | The look and the text block a new drawing starts with, over the neutral default (a solid 2 px line in the accent color, no fill, no text). |
| `settings`, `levels` | The settings panel (see [Settings](#settings)). |
| `anchors`, `placement`, `place`, `placed`, `angleSnap`, `placementHint` | How the user places the tool (see [Placement](#placement)). |
| `compute(ctx, prev)` | Work on the chart's bars, kept off the paint path (see [Work on the bars](#work-on-the-bars--compute)). |
| `handles(data)` | Grips beyond one per point (see [Handles](#handles)). |
| `constrain(index, anchors, props)` | The handle of point `index` was dragged: re-impose what must hold between the points by changing `anchors` in place. |
| `translate(dt, dp, orig)` | The body was dragged by a time and a price: return the new points. Default: every point moves. |
| `timeExtent`, `priceRange(data)` | The time span the drawing covers, used to skip it when it is off screen (`'all'` for a full-width tool), and its price span. Default: the span of its points. |
| `coversSeries` | The drawing's body replaces the series under it, so a new one starts over them instead of just under the candles. |
| `autoscale`, `valueAt`, `readout`, `snapTargets`, `click` | What the drawing gives back to the chart (see [What a drawing gives back](#what-a-drawing-gives-back)). |

`defineDrawing<Props, State>` takes two type parameters when inference from `props` is not
enough: the shape of `props`, and what `compute` returns.

### Shapes

`shapes(ctx)` returns a list of shapes, painted in list order: the last one is on top. Every
coordinate is in **plot pixels**, the frame the context converts into. The function runs on
every frame, so keep it to geometry and move anything heavier to `compute`.

| `kind` | Draws | Its own members |
|---|---|---|
| `line` | A segment | `from`, `to`, `extend` (`'left'`, `'right'`, `'both'`: on to the plot's edge), `arrows` (`'start'`, `'end'`, `'both'`) |
| `path` | A polyline or a polygon | `points`, `closed`, `smooth`, `colors` (one per segment) |
| `rect` | A rectangle | `from`, `to`, `radius` |
| `ellipse` | An ellipse, a circle or an arc | `center`, `rx`, `ry` (absent: a circle), `rotation`, `from` and `to` (angles in radians, for an arc) |
| `curve` | Bézier paths | `d`: a list of `['M', x, y]`, `['L', x, y]`, `['Q', cx, cy, x, y]`, `['C', c1x, c1y, c2x, c2y, x, y]`, `['Z']` |
| `band` | The area between two series of points | `upper`, `lower`. The edges are not outlined: add a `path` for each. |
| `rows` | Horizontal histogram rows from one x (a profile) | `x`, `rows`: `{ y, h, w, fill? }` each. A negative `w` grows to the left. |
| `text` | Text | `at`, `text`, `color` (`'auto'`: readable over its plate), `size` (pixels or `'tiny'` … `'huge'`), `bold`, `italic`, `align`, `baseline`, `angle`, `upright`, `plate` (a box behind it), `maxWidth` (wraps), `halo`, `avoid` (moves clear of the drawing's other `avoid` texts) |
| `marker` | A mark of a fixed pixel size | `at`, `shape` (`circle`, `square`, `diamond`, `triangle`, `triangleDown`, `cross`, `plus`, `arrowUp`, `arrowDown`) or `glyph` (a character), `size` |
| `image` | An image centered on a point | `at`, `w`, `h`, `src`: a URL or a `data:` URI. It paints once it has loaded. An image from another origin is requested with CORS, so its server must send `Access-Control-Allow-Origin`; one that does not is never painted, and the console says so once. |
| `tag` | An axis tag: a chip on the price axis or on the time axis | `axis` (`'price'`, `'time'`), `value` (a price, or a time in epoch ms), `text` (default: the formatted value), `color` (default: the line color) |
| `drawing` | Another registered drawing, as a part of this one | `type`, `anchors` (time and price), `style`, `text`, `props` |

Members the kinds share (`text`, `image` and `drawing` take no `stroke` or `fill`; a `tag`
takes none of them):

| Member | Meaning |
|---|---|
| `stroke` | The outline. Absent: the drawing's line color, width and style. A string: that color. `{ color?, width?, dash? }`: each member you leave out falls back to the drawing's. `null`: no outline. `dash` is `'solid'`, `'dashed'`, `'dotted'` or a dash array. |
| `fill` | The interior. Absent or `null`: none. `true`: the drawing's fill color. Otherwise a color, a gradient (`{ gradient: { from, to, stops } }`) or a hatch (`{ hatch: { color, spacing?, angle?, width? } }`). |
| `opacity` | 0 to 1. |
| `part` | Names the shape as a **part** of the drawing. Hover and click report the part, and `ctx.view.part` tells the paint which one is under the pointer. |
| `front` | Paint the shape over the series even when the drawing sits under them: a label on a zone drawn behind the candles. |
| `hit` | `false` keeps the shape out of hit-testing: decoration the pointer passes through. |
| `cursor` | The CSS cursor while the pointer is over the shape. |
| `tip` | A short text shown beside the pointer while it is over the shape. |

Hit-testing reads the same list, so it follows the paint: a filled shape is hit anywhere
inside it, an outlined one on its outline, and the front-most shape under the pointer names
the part. The selection bounds, the handles and the saved document derive from the shapes, the
points and `props` in the same way.

### The context

| Member | What it holds |
|---|---|
| `anchors` | The drawing's points, in time and price. |
| `points` | The same points in plot pixels (`[x, y]`). |
| `x(time)`, `y(price)`, `point({ time, price })` | Plot pixels of a time, of a price on the drawing's pane, and of both. |
| `props`, `style`, `text` | The drawing's own settings, its look, and its text block. |
| `state`, `pending` | What `compute` last returned (`undefined` before its first result), and whether a new result is on its way. |
| `view` | `{ selected, hovered, part, placing }`: the interaction state of this frame. |
| `theme` | `{ text, background, font, up, down }`: the chart's colors and font. |
| `price(value)` | A price as text, in the chart's format. |
| `bars(from, to)` | The chart's bars in a time range: `{ time, open, high, low, close, volume? }`. |
| `width`, `height` | The plot's size in pixels. |
| `id`, `type`, `paneId`, `proj` | The drawing's identity, and the frame's `Projector` (`proj.barMs` is one chart bar in milliseconds, when known). |

While the tool is being placed, `view.placing` is true and `anchors` holds only the points
clicked so far plus the one under the cursor: return what can already be drawn.

### Work on the bars — `compute`

`compute(ctx, prev)` holds the work that depends on the points, the `props` and the chart's
bars, and not on the viewport: a fit, a profile, a running average. It runs when one of the
three changes and never on a pan or a zoom. `shapes` reads its result as `ctx.state`, and the
other hooks as `data.state`.

- `ctx` carries `anchors`, `props`, `bars(from, to)`, `timeZone` and
  `change: { anchors, props, bars }`. `change.bars` is `'none'`, `'tick'` (only the newest
  bar moved), `'append'` (bars were added after it) or `'reset'` (the series is another one:
  a symbol or timeframe change, older history loaded). On a tick or an append, extend `prev`
  instead of starting over.
- **`ctx.timeZone` is the zone the chart shows its times in**, as an IANA name
  (`'America/New_York'`, `'UTC'`). A tool that works in sessions, days or weeks measures them
  in it. `compute` runs again when the user picks another zone, with `change.bars` set to
  `'reset'`. `shapes` reads the same value as `ctx.timeZone`.
- **Return a promise to do the work elsewhere**, in a worker for example. The previous result
  stays painted and `pending` is true until the new one lands; the chart then repaints. A
  result that lands after a newer run started is ignored.
- **A run that throws or rejects keeps the previous result.** The chart logs the error once
  for the tool and runs `compute` again when the points, the `props` or the bars next change.

### When a hook fails

Your hooks run inside the chart's paint, its pointer handling and its autoscale, so the chart
contains what they do wrong. Each failure is logged once per tool and hook, not on every frame.

- **A `shapes` that throws paints nothing for that frame.** The other drawings and the rest of
  the chart are unaffected.
- **A shape the chart cannot draw is left out, and the rest of the list is painted.** That
  covers a result that is not a list, a shape without the points, list or text of its kind
  (`{ kind: 'line', from: c.points[0], to: c.points[1] }` before the second point is placed),
  an unknown `kind`, and a shape the canvas refuses, such as a gradient stop that is not a color.
- **Any other hook that throws counts as absent for that call.** `readout` reports no rows,
  `handles` adds no grips, `valueAt` answers `null`, `click` leaves the settings bar to open,
  `place` keeps the pointer's point, and `translate`, `timeExtent` and `priceRange` fall back
  to the drawing's points. The usual cause is reading `data.state` before `compute` has
  returned its first result: it is `undefined` until then.

```ts
defineDrawing<Record<string, never>, { slope: number }>({
    type: 'acme.fit',
    label: 'Fit',
    compute: (c) => {
        const [a, b] = c.anchors;
        return worker.fit(a && b ? c.bars(a.time, b.time) : []);   // a Promise<{ slope: number }>
    },
    shapes: (c) => (c.state && c.points.length === 2 ? [{ kind: 'line', from: c.points[0]!, to: c.points[1]!, extend: 'right' }] : []),
});
```

### Placement

| Member | What it sets |
|---|---|
| `anchors` | How many points the tool takes. A count (default 2); a range `{ min, max }`, which the user ends with Enter or a double-click; or one entry per point: `{ role?, free?, hint? }`. `free` names the axes the point's handle moves along once placed (`'both'`, `'x'`, `'y'`, `'none'`), and `hint` is the prompt shown before that point is clicked. |
| `placement` | `'click'` (default): one click per point. `'drag'`: press at the first point, release at the second. `'freehand'`: press and drag to capture a path; such a tool stays armed after each stroke. |
| `place(step)` | Runs for each click and for the cursor between clicks, so the preview shows what a click would commit. Return a point to constrain it. |
| `placed(data)` | Placement ended: return the `props` to keep, such as values read from the chart. |
| `angleSnap` | `true`: holding Shift locks a two-point tool to 45° steps. |
| `placementHint` | The prompt shown while the tool is armed. |

`step` holds `index` (0 for the first click), `point` (where the pointer is, after the
magnet), `anchors` (the points already placed), `props`, `bars(from, to)` and `preview`
(`true` while the pointer is only passing over). `step.set(patch)` keeps values read at this
click in the drawing's `props`, and `step.finish()` ends the placement with this point. A
preview ignores both.

```ts
// A flat range: the second point keeps the first one's price, in the preview too.
place: (s) => {
    if (s.index === 0) s.set({ firstClose: s.bars(s.point.time, s.point.time)[0]?.close ?? s.point.price });
    return s.index === 1 ? { time: s.point.time, price: s.anchors[0]!.price } : undefined;
},
```

### Handles

Every point gets a handle. `handles(data)` adds grips at other data points; each one's
`drag(point)` returns the `props` to change:

```ts
props: { target: 0 },
handles: (d) => [{ at: { time: d.anchors[0]?.time ?? 0, price: d.props.target }, drag: (pt) => ({ target: pt.price }) }],
```

Use `constrain` for a rule between the points themselves, such as keeping a stop and a target
on opposite sides of an entry.

### What a drawing gives back

| Member | What the chart does with it |
|---|---|
| `valueAt(time, data, proj)` | The drawing's price at a time, or `null` where it has none. [`chart.drawings.valueAt(id, time)`](../user/api-reference.md#chartdrawings--the-drawings-control-surface) returns it: this is what an alert on a drawing compares the price with. `proj` is the chart's `Projector`, or `null` without renderer support. Pass it to `lineValueAt(a, b, time, { proj, paneId, extend })` to read a straight line as it is painted, which matters on a logarithmic scale. |
| `readout(data)` | The values the drawing reports: rows of `{ label, value, key?, color? }`. The data window lists them, one group per drawing, and `chart.drawings.readout(id)` returns them. `key` names a value for a read-only settings row. |
| `snapTargets(data)` | Points (`{ time, price }`), levels (`{ price }`) and times (`{ time }`) offered to the magnet while **another** drawing is placed or reshaped. |
| `autoscale` | `true`: while the pane's price scale is automatic, it widens to keep the drawing's `priceRange` in view. Off by default, so an ordinary drawing never pulls the scale. |
| `click(part, data)` | A click landed on the drawing, on `part` or on its plain body (`null`). Return `props` to change and the click edits the drawing, as one undo step, in place of opening its quick-settings bar. A locked drawing is not edited. |

The chart reports the same interactions to the host: `drawing:hover` (`{ id, part }`, `id`
`null` when the pointer leaves the drawings) and `drawing:click` (`{ id, part, time, price }`),
with `chart.drawings.at(x, y)` and `chart.drawings.hovered()` to ask at any time.
`chart.drawings.addSnapSource(fn)` gives the magnet targets that come from the host instead of
from a drawing.

A script does not read drawings. To drive an indicator from one, feed the drawing's value
into an input:

```ts
const study = chart.addIndicator(source);   // a script with a "Level" input
const line = chart.drawings.add('hline', { anchors: [{ time: Date.now(), price: 64000 }] });
const push = (): void => {
    const level = line ? chart.drawings.valueAt(line.id, Date.now()) : null;
    if (level != null) study.setInputs({ Level: level });
};
chart.on('drawing:edited', ({ id }) => {
    if (id === line?.id) push();
});
push();
```

### Settings

`settings` lists the fields of the tool's settings: `{ path, label, kind, … }` each. Without
it a tool gets the line settings, and the fill color when its `style` sets one. Start from the
exported bundles: `LINE_FIELDS`, `BORDER_FIELDS`, `FILL_FIELDS`, `TEXT_FIELDS`.

| Field member | Meaning |
|---|---|
| `path` | Where the value lives on the drawing: `props.<key>`, `style.<key>`, `text.<key>`, or `results.<key>` for the readout row whose `key` is `<key>`. |
| `kind` | `color`, `number` (`min`, `max`, `step`), `select` (`options`), `lineStyle`, `boolean`, `text`, `opacity`, or `readout`: a read-only row that shows the value at its path. |
| `unit: { base }` | On a `number` stored as a **price**: the settings panel adds a unit switch (price, points, percent, ticks) beside the input. `base` is the path of the reference price, for example `'anchors.0.price'`. What the user types in any unit is saved as a price. Ticks are offered when the chart knows the symbol's price increment, and percent when the reference is not zero. |
| `section` | A title. Fields that name the same section share a titled block of their own in the panel. |
| `quick` | `true`: the control also shows on the quick-settings bar. Text fields and readouts stay in the panel. |
| `when: { path, in }` | Show the field only while another setting holds one of these values. |

With `levels: true` and a `props.levels` list of `{ ratio, color, enabled }`, the panel shows
the level editor: each level's switch, ratio and color.

```ts
props: { target: 0, mode: 'a' },
settings: [
    { path: 'props.target', label: 'Target', kind: 'number', step: 0.01, unit: { base: 'anchors.0.price' }, section: 'Levels' },
    { path: 'props.mode', label: 'Mode', kind: 'select', quick: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { path: 'results.rr', label: 'Risk / reward', kind: 'readout' },
],
readout: () => [{ key: 'rr', label: 'Risk / reward', value: '2.00' }],
```

The rest of the panel is the same as for a built-in tool: the points, the timeframes the
drawing shows on, the tool's remembered settings and its saved styles.

### Toolbar groups

A tool's `group` decides where it lands in the toolbar:

| `group` | Toolbar button and section |
|---|---|
| `'lines'`, `'channels'`, `'pitchforks'` | **Lines**, in the section of that name |
| `'fibonacci'`, `'priceaction'`, `'geometry'` | **Fibonacci**, in the Fibonacci, Price Action or Geometry section |
| `'patterns'` | **Patterns**, in the Patterns section |
| `'measure'` | **Measurements**, in the Measurements section |
| `'shapes'` | **Shapes**, in the Shapes section |
| `'annotations'` | **Text** |
| `'stamps'` | **Icons** |
| Any other id (default `'custom'`) | A toolbar group of its own, after the built-in ones |

Set `toolbar: false` on a tool that your own interface arms: it stays registered, placeable
and saved like any other, and the default toolbar leaves it out.

A group of your own is labelled with the id read as a name (`'my-tools'` becomes "My tools")
until you name it:

```ts
registerDrawingGroup({ id: 'acme', label: msg('acme.drawings.group', 'Acme tools') });
```

#### A group before its first tool, and commands in a group's menu

A group shows once a tool names it. To have its button on the bar earlier, register the
group with `showEmpty`, and give its menu something to list: a widget action with
`target: 'drawings'` and the group's id.

```ts
registerDrawingGroup({
    id: 'acme',
    label: msg('acme.drawings.group', 'Acme tools'),
    icon: '<svg viewBox="0 0 24 24" …>…</svg>', // the button's icon while the group has no tool
    showEmpty: true,
});

registerWidgetAction({
    id: 'acme.createTool',
    target: 'drawings',
    group: 'acme',                // a group of yours, or a built-in one ('text', 'measurements', …)
    label: msg('acme.drawings.create', 'Create a tool'),
    icon: 'plus',                 // an icon id, as for every widget action
    run: (ctx) => openMyToolBuilder(ctx.chart),
});
```

- **The action is a row at the end of the group's menu**, after the tools and a divider.
  It runs a command and arms nothing. `order` sorts the actions of one group, and `when`
  gates them. The mobile drawings drawer lists the same rows at the end of the group.
- **While the group has no tool, its button opens the menu.** The button shows the group's
  `icon` (a plus sign without one). Once the group has tools, the button shows and arms the
  last-used tool, like a built-in group, and the chevron beside it opens the menu.
- **A registered group keeps its place.** Groups you register sit after the built-in ones
  in registration order, with or without tools, so the button does not move when the first
  tool arrives.
- **Find them by id, not by text.** A group's cell on the bar carries `data-group` (the
  group id) and an action's row carries `data-action` (the action id), for a host that
  styles or measures them.
- **An empty group with no action stays off the bar.** A button that arms nothing and
  lists nothing would be dead. The actions come from the shell, so a bare `Vela` chart
  (no widget or workspace) never shows an empty group.
- **Call `refreshActions()`** after registering an action on a widget that is already
  built, as for every widget action. The tools themselves need no call.

A chart whose `drawings` option lists `tools` keeps the empty group: the list picks tools,
and the group has none to drop. A chart that lists `groups` shows it only when you list it
there (`{ id: 'acme', label: 'Acme tools', tools: [] }`).

A chart whose [`drawings` option](../user/options.md#the-drawings-option) lists `tools` or
`groups` still shows only what it lists. Add your type key there to show the tool on that
chart.

### Registering late, replacing, unregistering

Charts follow the drawing registry. You need no `refreshActions()` call.

- **Register at any time.** A tool registered after a chart is built joins that chart's
  toolbar. Registrations made in a row are followed once, and each chart then raises
  `drawing:types`.
- **Define a type again to replace it.** The drawings already placed are rebuilt from their
  saved records and follow the new definition, with their own `props` and style.
- **Unregister** with the function `defineDrawing` returned, or
  `unregisterDrawingType(type)`. The tool leaves the toolbars, and its drawings stay on their
  charts as placeholders (see below) until the type is registered again.
- **Take a group's registration back** with `unregisterDrawingGroup(id)`. Its tools keep
  their group, labelled with the id again, and a group kept on the bar empty (`showEmpty`)
  leaves it.
- `onDrawingTypesChange(cb)` follows the registry for a tool list of your own, and
  `isBuiltinDrawingType(type)` tells the tools Vela ships from the ones a host registered.
  `drawingTypes()` lists them all.

### Drawings of a type that is not registered

A saved document can hold a drawing whose type is not registered on the page: the plugin that
defines it is not loaded yet, or not loaded here at all. Such a drawing is **kept**:

- It shows as a **placeholder**: a dashed outline of its points (a small diamond for a single
  point), which the user can select, move and delete. Duplicate, copy and paste leave it out.
- It saves back exactly as it was loaded, `props` included, so the document round-trips.
- It becomes the real drawing as soon as its type is registered.
- `setToolDefaults` and `setToolTemplates` keep the entries of such a type. `setFavorites`
  leaves the type out and stars it once it registers.
- `chart.drawings.add(type)` returns `null` for it, and so do `createDrawing` and
  `deserializeDrawing`. `reviveDrawing(record)` never does: it returns the placeholder.

### A tool as a class

Write a class when the tool extends a family Vela already draws: a new Fibonacci tool, a new
harmonic pattern. The plugin entry exports the bases, the field bundles and the hit-test
helpers (`distToSegment`, `distToPolyline`, `pointInBox`, `pointInCircle`, `pointInPolygon`,
`handleAt`, `extendRay`). Register the class with `registerDrawingType`:

```ts
import { HarmonicPattern, registerDrawingType, type HarmonicRanges } from '@luxalgo/vela/plugin';

class AcmeHarmonic extends HarmonicPattern {
    readonly type = 'acme.harmonic';
    patternName(): string {
        return 'Acme';
    }
    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.5, max: 0.618 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.272, max: 1.618 }, ad: { min: 0.786, max: 0.886 } };
    }
}

registerDrawingType({
    type: 'acme.harmonic',
    group: 'patterns',
    label: 'Acme Harmonic',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17 7 6 12 14 17 5 21 16"/></svg>',
    defaultStyle: { lineColor: '#3b82f6', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new AcmeHarmonic(init),
});
```

`registerDrawingType` also takes `placementHint`, `coversSeries`, `staysArmed` (the tool
stays armed after each placement, as a brush does) and `toolbar` (`false` keeps the type off
the default toolbar). It returns nothing: remove the type with `unregisterDrawingType(type)`.

| Base | For | Painted by |
|---|---|---|
| `SegmentDrawing` | Multi-line tools: channels, pitchforks | Its family's painter |
| `FibRatios`, `FibLevels`, `RadialFib` | Fibonacci tools: free-form, horizontal levels, concentric rings | Its family's painter |
| `PatternDrawing`, `HarmonicPattern` | Labelled vertex patterns, and harmonics validated against Fibonacci bands | Its family's painter |
| `GlyphStamp` | One-point glyph stamps | Its family's painter |
| `ShapeDrawing` | Anything else: implement `anchorSchema()` and `shapes()` | Its `shapes()` |
| `TwoPointLine`, `CalloutBase`, `PinnedLabel`, `Drawing` | Two-point lines, pinned boxes and labels, a tool like no other | Its `shapes()`: add one |

A class that implements `shapes()` is painted from the list it returns and needs nothing
from a renderer. A class without it relies on the painter its family already has. The
built-in lines, callouts and pinned labels are each painted by their own type, so a subclass
of `TwoPointLine`, `CalloutBase` or `PinnedLabel` adds `shapes()` for its look.
[Adding a drawing tool](./adding-a-drawing-tool.md) lists what each base leaves to the leaf
and the hooks a class can override.

A custom renderer shows these tools once it paints the shape list: see
[the user-drawings port](./adding-a-renderer.md#user-drawings-interactive).

## Drawing actions — `registerDrawingAction`

A button for one **drawing**: an icon on the toolbar that floats by a selected drawing (just
before its settings wheel) and a labelled button at the start of the drawing's settings dialog
footer. It can also be a row in the drawing's menus. The classic use: put an alert, a note or
a share link on the drawing the user is looking at, where they look for it.

```ts
import { msg, registerDrawingAction } from '@luxalgo/vela/plugin';

registerDrawingAction({
    id: 'mytool.drawing-alert',
    icon: 'bell',                                       // vela/ui icon registry
    label: msg('mytool.drawing-alert', 'Add alert'),    // toolbar tooltip, dialog button and menu row text
    surfaces: ['toolbar', 'settings', 'menu'],          // default: the toolbar and the settings dialog
    when: (d) => d.type === 'hline' || d.type === 'trendline', // per-drawing gate
    run: (ctx, d) => myAlerts.open({ symbol: ctx.symbol, drawingId: d.id, level: ctx.chart.drawings.valueAt(d.id, Date.now()) }),
});
```

- `d` is the drawing's `SerializedDrawing` — the shape `chart.drawings.all()` returns: `id`,
  `type`, `anchors`, `style`, `props`. `when` sees it as the toolbar opens; `run` reads it
  again at click time, so a drag since then shows through.
- `surfaces` lists where the action shows: `'toolbar'`, `'settings'` and `'menu'` (default:
  the toolbar and the settings dialog). With `'menu'` the action is a row at the end of the
  toolbar's overflow menu, and a row at the top of the chart's right-click menu while the
  pointer is over a drawing. The right-click row needs no selection: it acts on the drawing
  under the pointer. `order` sorts the contributed group (ascending; default 0).
- For an alert, read the level to watch with
  [`chart.drawings.valueAt(id, time)`](../user/api-reference.md#chartdrawings--the-drawings-control-surface):
  it answers for the built-in lines and for any tool that defines `valueAt`.
- It acts on one drawing, so the toolbar of a **multi-selection** leaves it out.
- `run` receives a fresh `WidgetContext` per click. In a workspace, the click's own press made
  the drawing's chart the active one, so `ctx.chart` is the chart the drawing is on.
- Register at import time; after a late registration call `refreshActions()`. An open toolbar
  keeps its buttons; the next one shows the new set.
- The seam degrades gracefully: a custom renderer without `setDrawingActions` simply never
  shows contributed drawing actions.

## Side panels — `registerSidePanel`

A **side panel** is a docked column on the chart's right edge — the object tree and the data
window are the two built-in ones, and a contributed panel joins them as an equal: same header
and close button, same single-open dock, its own toggle button in the topbar's panel group.

The shell owns that chrome and hands `mount` the panel's **body** to fill; the contribution
never reaches into the widget's DOM:

```ts
import { registerSidePanel, registerIcon } from '@luxalgo/vela/plugin';

registerIcon('flow', '<svg …>…</svg>');

registerSidePanel({
    id: 'mytool.flow',           // stable: dock id, button id, and the key its width persists under
    title: 'Order flow',         // header title + button tooltip
    icon: 'flow',
    order: 30,                   // among the panel buttons (built-ins are 10 and 20; default 100)
    width: 320,                  // declared width in px (default 280)
    resizable: true,             // drag the inner edge; double-click returns to `width`
    minWidth: 240,
    maxWidth: 560,
    overlay: false,              // true floats the panel OVER the chart (with a pin to dock it)
    maximizable: false,          // true adds a Maximize/Restore button to the header
    header: 'default',           // 'none': no header row — the panel draws its own
    placement: 'chart',          // 'column': full height beside the topbar, charts and bottom bar
    mount: (ctx, body, header) => {
        const list = document.createElement('div');
        body.appendChild(list);                       // `body` is the panel's scrolling area
        header.setTitle('BTC flow');                  // optional: replace the header title…
        header.slot.appendChild(myIconButton);        // …and dock compact controls beside it
        return {
            onChart: (chart) => { /* (re)bind: mount, widget rebuild, active cell change */ },
            onOpen: () => { /* became visible — render now if you render lazily */ },
            destroy: () => { /* widget destroyed, or this id re-registered */ },
        };
    },
});
```

- **The header is shareable, not replaceable.** `header.slot` is the space between the
  title and the close button — lay out inline controls there (icon buttons, a document
  name); `header.setTitle` rewrites the title text (an empty string hides it, letting the
  slot own the row). The close button and the row itself stay the shell's, and the topbar
  toggle keeps the DECLARED `title` as its tooltip.
- **Or draw your own header.** With `header: 'none'` the shell renders no header row: the
  panel lays out its own at the top of `body` and wires its close control to
  `header.close()` (and its maximize control, if any, to `header.setMaximized`). On the
  mobile layout the panel covers the chart and the header's close is the way out, so a
  headless panel must offer one.
- **Read the dock through `ctx.panels`.** `list()` reports every docked panel in dock order,
  the built-ins included (`builtIn: true`), with its title in the shell's language;
  `openId()` names the open one (or null); `isMaximized(id)` says whether it covers the
  charts; `onDidChange(cb)` fires after a panel opens, closes, maximizes or restores, and
  after panels are added or removed, and returns the unsubscribe. `ctx.togglePanel` acts on
  the same dock.

- **Width is a per-panel choice.** Omit `resizable` for a fixed column; with it, the drag is
  clamped to `[minWidth, maxWidth]` (defaults 200/640) and the width the user settles on is
  saved with the shell's state document, under the panel id.
- **Placement is a per-panel choice too.** A panel docks by default — a column beside the
  chart, which shrinks to make room. With `overlay: true` the panel floats over the chart's
  right edge instead: the chart keeps its width and layout, and the panel covers whatever
  sits under it. Pick it for panels wide enough that a column would crush the plot (a code
  editor). A floating panel's header carries a **pin**: pressed, the panel docks as a column
  after all (the chart makes room), released, it floats again — the user's choice, saved with
  the shell's state next to the widths. Resizing and width persistence work the same way in
  both placements.
- **A panel can be maximized.** With `maximizable: true` the header carries a Maximize button
  that spreads the panel over every chart of the shell, whatever its placement, and turns
  into Restore. The contribution drives the same state from code — `header.setMaximized(on)`,
  read back through `header.maximized`. It is a moment, not a placement: it is not
  persisted, and closing the panel restores it. Pick it for panels that are sometimes the
  main work surface (an editor).
- **The dock is exclusive.** Opening a panel closes the one showing — the chart keeps its
  width, and only one column is ever docked. `onOpen` is where a lazy panel renders.
- **`onChart` is the rebind hook**, not a one-shot: it runs on mount, after a widget rebuild,
  and when a workspace re-points the panel at another active cell. A symbol or timeframe
  switch keeps the chart (it switches in place), so a panel that shows per-symbol content
  subscribes to `chart.on('market:changed', …)` in `onChart` and drops that subscription in
  the next `onChart` and in `destroy`.
- Register at import time; after a late registration call `widget.refreshActions()`. Only
  what changed is rebuilt: a panel whose descriptor is still registered as it was stays
  mounted as it is — content, state and open column included — while a re-registered
  (replaced) descriptor is rebuilt, and an open one stays open.
- A `mount` that throws is contained: the panel docks empty and the reason is logged, rather
  than taking the shell down.

## Layout regions

The shell lays out a **chart column** (the topbar, the chart row, the docked strips and the
bottom bar), and plugins can add to it in three places without reaching into its markup:

```ts
// A full-height panel beside the whole chart column, not only beside the charts.
registerSidePanel({ id: 'mytool.watch', title: 'Watchlist', icon: 'list', placement: 'column', mount });

registerWidgetAttachment({
    id: 'mytool.chrome',
    mount: (ctx) => {
        const offRail = ctx.dockEdge(myRail, 'right');                         // outer right edge, full height
        const dock = ctx.dockStrip(myDock, { position: 'below-bottombar' });   // under the bottom bar
        maximizeButton.onclick = () => dock.cover(!covered);                    // over the chart column
        return () => { offRail(); dock(); };
    },
});
```

- **`placement: 'column'`** puts a side panel at the shell's right, full height: the topbar,
  the charts, the strips and the bottom bar narrow to make room. It shares the dock with the
  other panels (still one open at a time). On the mobile layout it covers the chart area
  above the bottom bar, like any panel; maximized, it covers the chart column too.
- **`ctx.dockEdge(el, 'right')`** docks an element outside everything else on the right,
  full height — the place for a rail of toggles. Edge elements keep their own width and
  stack in docking order.
- **`ctx.dockStrip(el, { position: 'below-bottombar' })`** docks a strip under the bottom bar
  instead of above it. The undock `dockStrip` returns also carries **`cover(on)`**:
  `cover(true)` lays the strip over the whole chart column — topbar, charts, strips and
  bottom bar — at that size whatever height the strip set itself, but not over a column
  panel, an edge element or the mobile layout's bottom bar; `cover(false)` puts it back in
  its spot.

A shell that uses none of these keeps its plain column layout; the first one in use switches
the shell to a grid with these regions for the rest of its life.

### Full screen — `ctx.fullscreen`

[Full screen](../user/workspace.md#full-screen) leaves only the charts. The shell hides what
is its own: the topbar, the drawing toolbar, the bottom bar and the right edge (the sidebar,
and anything docked with `ctx.dockEdge`), and it closes the open side panel. **A docked strip
stays**, because only its owner knows whether it belongs with the charts (the controls of a
replay under way) or around them (a panel of orders). A plugin that steps aside follows
`ctx.fullscreen`:

```ts
registerWidgetAttachment({
    id: 'mytool.orders',
    mount: (ctx) => {
        const dock = ctx.dockStrip(ordersPanel, { position: 'below-bottombar' });
        const show = (): void => { ordersPanel.hidden = ctx.fullscreen.isOn(); };
        const off = ctx.fullscreen.onDidChange(show);
        show(); // the shell may already be in full screen when this mounts
        return () => { off(); dock(); };
    },
});
```

- **`isOn()`** reads the state, **`onDidChange(cb)`** follows it whichever way it changed (the
  key, the topbar button, Esc, code) and returns the unsubscribe.
- **`set(on)`** enters and leaves, for a plugin that offers its own way in. Entering is
  ignored on the mobile layout.
- Hide, rather than undock or close: what you hid then comes back exactly as it was, and
  nothing in the saved layout changes.

## The sidebar

A host can give the shell a toolbar along its right edge (`sidebar: true`, see
[the workspace guide](../user/workspace.md#the-sidebar)). It holds the side-panel toggles,
and a plugin adds its own entries as widget actions with `target: 'sidebar'`:

```ts
registerWidgetAction({
    id: 'mytool.alerts.toggle',
    target: 'sidebar',
    label: msg('mytool.alerts', 'Price alerts'),  // the button's accessible name and tooltip
    icon: 'bell',
    order: 10,                                     // within the 'actions' flow slot
    active: (ctx) => alertsOpen,                   // pressed look, read on every redraw
    run: (ctx) => {
        toggleAlerts();
        ctx.sidebar.setBadge('mytool.alerts.toggle', unread());
    },
});
```

- A press redraws the sidebar. When the state behind `active` or `when` changes on its own,
  call **`ctx.sidebar.refresh()`**.
- **`ctx.sidebar.setBadge(id, value)`** puts a small count on an entry, a sidebar action or a
  panel (`null`, `0` or `''` clear it; above 99 shows `99+`).
- **`ctx.sidebar.setVisible(id, visible)`** hides an entry, a panel toggle or a sidebar
  action, and gives it back; **`ctx.sidebar.isVisible(id)`** tells whether it shows. Like
  `ctx.topbar.setVisible`, it never adds an entry the host's composition left out, a hidden
  action leaves the mobile three-dots menu too, and it is not saved with the layout.
- **Anchor your own UI to your button.** Sidebar buttons carry the same hooks as the topbar's
  and the mobile bar's: `data-action-id` on an action's button, `data-panel-id` on a panel
  toggle. A `run` that opens a popover or a menu anchors it to
  `ctx.host.querySelector('[data-action-id="mytool.alerts.toggle"]')`.
- **`ctx.sidebar.enabled`** tells whether the shell has a sidebar; with none, `setBadge`,
  `refresh` and `setVisible` do nothing and `isVisible` is false, so a plugin can call them
  unconditionally.
- An action registered after the shell is built shows on the next `refreshActions()`, like
  topbar actions.
- On the mobile layout the sidebar is hidden and its actions are rows in the three-dots menu.
- Which entries show, and where, is the host's call (its `sidebar` composition). A plugin that
  wants its entry somewhere specific documents the id for hosts to place.

### A plugin that needs the sidebar — `registerShellDefaults`

The sidebar is a shell option, which a plugin cannot set on a host's behalf. It registers a
**default** instead, which every shell built afterwards uses where its host gave no value:

```ts
import { registerShellDefaults } from '@luxalgo/vela/plugin';

registerShellDefaults({ sidebar: true }); // or a composition: { top: [...], bottom: [...] }
```

- The host's own `sidebar` always wins, `false` included: a host can keep the sidebar off.
- Shells built before the call are untouched. The disposer it returns removes exactly the
  values it set; `unregisterShellDefaults(...keys)` drops them by key, and `shellDefaults()`
  reads them.
- It is the shell's counterpart of `registerRendererDefaults`, which gives every chart
  built afterwards a default renderer feature.

## Scripting engines — `chart.registerEngine` / `registerDefaultEngine`

Vela™ bundles no engine — you install one (`@luxalgo/vela-pinets` for Pine Script) or write
one against the port. Engines are **per-chart instances**
(`chart.registerEngine('pine', new PineEngine())`, or the widget's
`engines: { pine: () => … }` factories). Two things ship here:

**`registerDefaultEngine(language, factory)`** — the app-level default: every widget
and workspace cell built afterwards registers `factory()` on its chart automatically
(one instance per chart). A per-instance `engines` option wins for the same language
(`resolveEngines(overrides)` is the merge the shells apply), and the bare `Vela` chart
is untouched — with nothing registered, nothing changes. This is how an engine package
becomes a host's default with one call.

And the whole **authoring surface**, so an engine can be built as its own package:

- the **`ScriptingEngine` port types** (`PreparedScript`, `ExecutionRequest` /
  `ExecutionHandlers` / `ExecutionSession`, `EngineContextSnapshot`, `BarsChangeReason`, …);
- the **model vocabulary** engine output is built from (`OHLCV`, `IndicatorModel`, the
  series/scene/drawing specs, `InputSchema`);
- **`stableSeriesId`** — mint every series/drawing id with it: the core's live-tick
  value patches are keyed by those ids, so they must reproduce across re-runs;
- the **semantic palette** (`ACCENT`, `BULLISH`, …) so engine defaults mean what the
  rest of the chart means.

The full contract — prepare/execute, the session levers, the data inversion, the
backfill run policy, packaging and registration — is
[Adding an Engine](./adding-an-engine.md).

## Messages and formatting — `msg` / `registerLocale`

A plugin's text and numbers follow the chart's locale through the same message system the
core uses ([Localization](../user/localization.md)):

```ts
// In the plugin: ids are dotted and start with your own prefix; the English text is the source.
import { msg, type LocalePack } from '@luxalgo/vela/plugin';

const TITLE = msg('acme.flow.title', 'Order flow');
const TRADES = msg('acme.flow.trades', '{count, plural, one {# trade} other {# trades}}');

// Packs are plain objects the plugin exports, one per language.
export const acmeDe: LocalePack = { locale: 'de', messages: { 'acme.flow.title': 'Orderfluss' } };
```

```ts
// In the host: registering is a call, never an import side effect.
import { registerLocale } from '@luxalgo/vela/plugin';
import { acmeDe } from 'acme-vela-plugin';

registerLocale(acmeDe);
```

- **Actions, panels and attachments** read the shell's translator as `ctx.i18n`:
  `ctx.i18n.t(TITLE)`. It follows `setLocale`; re-render on the shell's `locale:changed`.
- **Renderer layers** get the chart's translator as `args.i18n` in every `render(args)`:
  `args.i18n.t(TRADES, { count })` for painted text and `args.i18n.format.compact(volume)`
  for numbers, so a layer reads like the axes beside it.
- **Typed ids:** augment the catalog so hosts can override your messages with type checking:
  `declare module '@luxalgo/vela/plugin' { interface VelaMessageCatalog { 'acme.flow.title': string } }`.
- **Identities stay English.** Translate what a user reads, never a value that is stored
  or compared: option values saved in layouts, ids, and anything a script reads.

## Widget integration

- A registered chart type appears in the **style dropdown** automatically
  (`priceStyleIds()` = built-ins ∪ registry; labels from `label`), greyed on a symbol its
  `supports` rules out.
- A registered drawing tool appears in the **drawing toolbar** automatically, in the group
  its `group` names (see [Toolbar groups](#toolbar-groups)).
- Keyboard bindings: `widget.keymap.register({ id, keys: 'mod+shift+k', label,
  category, scope?, run })` — they show up in the `?` shortcuts panel. `'mod'` is ⌘ on
  macOS, Ctrl elsewhere. Scopes: bindings fire when their scope is the top of the
  stack (`'global'` always fires); the widget pushes `'dialog'` while its dialogs are open.

## Rules of thumb

- Register at **import time**, before charts are constructed. Drawing tools are the one
  seam with no such order: a tool registered, replaced or unregistered later reaches the
  charts already on screen (see
  [Registering late, replacing, unregistering](#registering-late-replacing-unregistering)).
- Payloads pushed through channels are yours end to end — the core never inspects them.
- Never reach into renderer internals from a layer; everything you need arrives in
  `render(args)`.
