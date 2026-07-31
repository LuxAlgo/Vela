# Vela plugin SDK

Everything importable from **`vela/plugin`**. Three extension seams: **chart types**
(data + transform side), **renderer layers** (paint side), and **native indicators**
(core-computed indicators with their own layers). All registries are id-keyed
(re-registering an id replaces it) and read live — charts constructed after
registration pick the entries up.

## Chart types — `registerChartType`

A chart type is a new *price style*: an id that becomes valid for the style dropdown,
`renderer.set('priceStyle', id)`, and extended tickers.

```ts
import { registerChartType, type SeriesDataEngine, type SeriesDataEngineHost } from 'vela/plugin';

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
    }),
});
```

Lifecycle: the engine is created lazily the first time the chart enters the style
(after `chart.ready()`), suspended/resumed on style flips, stopped at destroy.

Two more levers for full-replacement types:

- `basePainting: 'none'` suppresses the base candle painting while the style is active —
  for types whose renderer layer fully replaces the price representation (an order-flow
  grid, bricks…). Default `'candles'` keeps candles under your layer.
- `chart.data.providerInstance(name)` returns the registered provider **instance** — the
  seam for extended provider surfaces: a provider may implement interfaces beyond the
  `DataProvider` port; your data engine retrieves the instance and narrows it with its
  own type guard.

A chart type may also declare a **settings section** (`settings: { title, rows,
visibility }`) that the chart-settings dialog renders as its own tab — values persist in
the renderer config, reach the type's renderer layer as `args.settings`, and its data
engine via `onSettings(values)`. See
[architecture/settings-rows.md](../architecture/settings-rows.md) for the row kinds and
how to add new ones.

## Renderer layers — `registerRendererLayer`

A layer owns one transparent canvas stacked into the native renderer's pile and is
repainted from the shared paint cycle. **The layer id doubles as its data channel** —
a chart type's `host.pushData` feeds the layer named like it with no extra wiring.

```ts
import { registerRendererLayer } from 'vela/plugin';

registerRendererLayer({
    id: 'mytype',                    // = the `setNativeData` channel it receives
    placement: 'above-data',         // or 'below-data' (behind the candles)
    create: () => ({
        mount(canvas) { /* keep the canvas reference */ },
        render({ bars, data, pending, coords, scale, bounds, theme, priceStyle, nowMs }) {
            // Always clear + repaint your own canvas. Gate on `priceStyle` if the
            // layer belongs to a chart type. Key mappings:
            //   coords.logicalToX(i) / coords.timeToX(ms)  → x
            //   coords.priceToY(price, scale, bounds)      → y
            //   coords.width / coords.dpr                  → sizing
        },
        animating?: () => false,     // return true while a pulse/fade needs frames
        destroy?: () => {},
    }),
});
```

## Native indicators — `registerNativeIndicator`

Core-computed indicators (no script engine) with renderer-drawn layers — the built-in
volume and VPVR ride this seam. See `NativeIndicator` types in `vela/plugin`.

## Widget actions — `registerWidgetAction`

Contribute UI as **data descriptors** (never DOM) — the widget projects them into its
chrome; a future React view projects the same descriptors.

```ts
import { registerWidgetAction, registerIcon } from 'vela/plugin';

registerIcon('rocket', '<svg …>…</svg>'); // optional, inline SVG (stroke currentColor)

registerWidgetAction({
    id: 'mytool.open',
    target: 'topbar',            // or 'context:body' | 'context:price-axis' | 'context:time-axis'
    label: 'My tool',
    icon: 'rocket',
    order: 10,                   // sort key within the contributed group
    when: (ctx) => ctx.priceStyle === 'mytype',   // optional runtime gate
    run: (ctx) => {
        // ctx.chart (the CURRENT inner chart) · ctx.symbol / timeframe / priceStyle
        // ctx.setSymbol / setTimeframe / setPriceStyle / openSymbolSearch(query?)
        // ctx.host  — mount host for kit components (Dialog/Menu/Tooltip)
        // ctx.toast(message, kind?) — the widget's feedback pill
    },
});
```

Topbar actions render as buttons in the right-hand cluster; `context:*` actions are
appended to the matching right-click menu zone. Register at import time — a widget
constructed later picks them up; after late registrations call `widget.refreshActions()`.

Two rules keep actions portable:

- **Everything through `ctx`, no outer references.** `when`/`run` must not close over a
  widget or chart instance — the context is rebuilt per invocation, so it always binds
  the widget that projected the action (and, in a future multi-chart shell, the
  **active** chart). `ctx.chart` is live at call time; don't cache it across calls.
- **Kit components get `ctx.host`.** Mounting a `Dialog`/`Menu`/`Tooltip` without an
  explicit host portals it to `<body>`, outside the theme's CSS variables (invisible
  backgrounds). Pass `host: ctx.host`.

## Widget attachments — `registerWidgetAttachment`

An action is one button; an **attachment** is a unit of per-widget behavior — an overlay, a
gesture, custom key handling. It mounts once per widget with the same `WidgetContext`, and
returns a disposer the widget runs at destroy:

```ts
import { registerWidgetAttachment } from 'vela/plugin';

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

## Side panels — `registerSidePanel`

A **side panel** is a docked column on the chart's right edge — the object tree and the data
window are the two built-in ones, and a contributed panel joins them as an equal: same header
and close button, same single-open dock, its own toggle button in the topbar's panel group.

The shell owns that chrome and hands `mount` the panel's **body** to fill; the contribution
never reaches into the widget's DOM:

```ts
import { registerSidePanel, registerIcon } from 'vela/plugin';

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
    mount: (ctx, body) => {
        const list = document.createElement('div');
        body.appendChild(list);                       // `body` is the panel's scrolling area
        return {
            onChart: (chart) => { /* (re)bind: mount, widget rebuild, active cell change */ },
            onOpen: () => { /* became visible — render now if you render lazily */ },
            destroy: () => { /* widget destroyed, or this id re-registered */ },
        };
    },
});
```

- **Width is a per-panel choice.** Omit `resizable` for a fixed column; with it, the drag is
  clamped to `[minWidth, maxWidth]` (defaults 200/640) and the width the user settles on is
  saved with the shell's state document, under the panel id.
- **The dock is exclusive.** Opening a panel closes the one showing — the chart keeps its
  width, and only one column is ever docked. `onOpen` is where a lazy panel renders.
- **`onChart` is the rebind hook**, not a one-shot: the widget hands over a new chart instance
  after a symbol/timeframe rebuild, and a workspace re-points the panel at the active cell.
- Register at import time; after a late registration call `widget.refreshActions()` (an open
  contributed panel stays open across the rebuild).
- A `mount` that throws is contained: the panel docks empty and the reason is logged, rather
  than taking the shell down.

## Widget integration

- A registered chart type appears in the **style dropdown** automatically
  (`priceStyleIds()` = built-ins ∪ registry; labels from `label`).
- Keyboard bindings: `widget.keymap.register({ id, keys: 'mod+shift+k', label,
  category, scope?, run })` — they show up in the `?` shortcuts panel. `'mod'` is ⌘ on
  macOS, Ctrl elsewhere. Scopes: bindings fire when their scope is the top of the
  stack (`'global'` always fires); the widget pushes `'dialog'` while its dialogs are open.

## Rules of thumb

- Register at **import time**, before charts are constructed.
- Payloads pushed through channels are yours end to end — the core never inspects them.
- Never reach into renderer internals from a layer; everything you need arrives in
  `render(args)`.
