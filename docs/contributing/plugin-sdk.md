# Vela™ plugin SDK

Everything importable from **`@luxalgo/vela/plugin`**. Three extension seams: **chart types**
(data + transform side), **renderer layers** (paint side), and **native indicators**
(core-computed indicators with their own layers) — plus the authoring surface for
**scripting engines**, which register per chart rather than into a registry. All
registries are id-keyed (re-registering an id replaces it) and read live — charts
constructed after registration pick the entries up.

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
    create: () => ({
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
creates a fresh instance. A type that pushes a bespoke layer payload through `pushData`
must stay single-instance — the renderer's native layer is keyed by type.

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

A `PriceLine` in `priceLines` (a native's own `hline`-like levels, or a Pine `hline()`
threaded through from a script engine) can tag itself on the price axis with
**`axisLabel`**: `true` for the line's formatted price (matching the pane's own axis
mode and the instrument's precision), or `{ text?, background? }` to override either the
text or the chip's background (each defaults to the formatted price / the line's own
`color`). Absent ⇒ no chip — only the line itself draws, unchanged. Several tagged lines
close together on one pane space themselves apart automatically, so labels never overlap.

## Widget actions — `registerWidgetAction`

Contribute UI as **data descriptors** (never DOM) — the widget projects them into its
chrome; a future React view projects the same descriptors.

```ts
import { registerWidgetAction, registerIcon } from '@luxalgo/vela/plugin';

registerIcon('rocket', '<svg …>…</svg>'); // optional, inline SVG (stroke currentColor)

registerWidgetAction({
    id: 'mytool.open',
    target: 'topbar',            // or 'context:body' | 'context:price-axis' | 'context:time-axis'
    label: 'My tool',            // ALWAYS required: aria-label, tooltip, mobile row text
    icon: 'rocket',
    iconOnly: true,              // topbar only: no button text — the native 32px tool look
                                 //  on the right cluster (label becomes aria-label + a kit
                                 //  tooltip; mobile surfaces keep their text). Requires
                                 //  `icon`. The piece that makes a 'screenshot' slot
                                 //  override pixel-faithful to the button it replaces.
    order: 10,                   // sort key within the contributed group
    align: 'left',               // topbar only: 'left' joins the primary chrome cluster
                                 //  (after the style/layout dropdowns, styled like them);
                                 //  'right' (default) the right-hand tools cluster
    when: (ctx) => ctx.priceStyle === 'mytype',   // optional runtime gate
    run: (ctx) => {
        // ctx.chart (the CURRENT inner chart) · ctx.symbol / timeframe / priceStyle
        // ctx.setSymbol / setTimeframe / setPriceStyle / openSymbolSearch(query?)
        // ctx.togglePanel(id, open?) — open/close a docked side panel (dock stays exclusive)
        // ctx.addIndicator({ name, script, language? }) — add a script indicator THROUGH
        //   the shell: recorded in the unified undo/redo timeline and the indicator count
        // ctx.addNativeIndicator(type) — same, for native (core-computed) indicators
        // ctx.stateChanged() — persistable third-party state changed (debounced save)
        // ctx.host  — mount host for kit components (Dialog/Menu/Tooltip)
        // ctx.toast(message, kind?) — the widget's feedback pill
    },
});
```

Topbar actions render as buttons in the right-hand cluster by default; `align: 'left'`
moves one into the primary chrome cluster instead — right after the style/layout
dropdowns, wearing the same height/typography as the built-in buttons there (that is
the built-in Indicators button's exact spot and look, for actions that replace it).
On the mobile chrome the split carries over: left-aligned actions get their own
icon-only stop in the bottom bar (the built-in indicators slot), while right-aligned
ones stay in the three-dots sheet. `context:*` actions are appended to the matching
right-click menu zone. Register at import time — a widget constructed later picks them
up; after late registrations call `widget.refreshActions()`.

`align`/`order` are the action's *suggestion* — the HOST has the last word: the shell's
`topbar: { left, right }` option (see [Composing the
topbar](../user/workspace.md#composing-the-topbar)) can pin an action id at an exact
position (overriding both), or omit the `'actions'` flow slot entirely, in which case
unpinned actions don't render on that side. Publish your action ids (a stable exported
constant) so hosts can compose with them.

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
- **Kit components get `ctx.host`.** Mounting a `Dialog`/`Menu`/`Tooltip` without an
  explicit host portals it to `<body>`, outside the theme's CSS variables (invisible
  backgrounds). Pass `host: ctx.host`.

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
**`'indicators'`** and **`'screenshot'`** — can be TAKEN OVER by a plugin: register an
action under the built-in id, and the override owns the slot's **whole surface**:

- the desktop button renders your action at the slot's position (native button gone);
- the slot's mobile counterpart (the mobile-bar Indicators stop, the more-drawer
  Screenshot button) routes to your `run(ctx)`;
- the slot's keyboard chord (`/` for indicators, `mod+alt+S` for screenshot) routes to
  your `run(ctx)` too — don't bind your own;
- the native machinery behind the slot is not constructed (the built-in indicator
  picker dialog, for `'indicators'`).

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
  `ctx.addIndicator({ name, script, language? })`. Prefer these over the raw
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
        const mine = trackedIndicators(ctx.cellId); // your bookkeeping
        return mine.length > 0 ? mine.map((i) => ({ slug: i.slug })) : undefined;
    },
    restore(payload, ctx) {
        // The payload is UNTRUSTED (the codec passes `ext` through opaquely) — validate.
        if (!Array.isArray(payload)) return;
        for (const item of payload) {
            if (typeof item?.slug !== 'string') continue;
            void fetchSource(item.slug).then((script) =>
                // Cell-bound adds: THIS chart (not the active one), and muted — a
                // restore never pollutes the undo timeline.
                ctx.addIndicator({ name: item.slug, script, language: 'pine' }),
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
        { "id": "c1", "symbol": "BTCUSDT", /* … */ "ext": { "mytool.indicators": [{ "slug": "my-osc" }] } }
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
    when: (ind) => ind.source !== undefined,       // per-indicator gate
    run: (ctx, ind) => myEditor.open(ind.source!), // ctx = the shell's WidgetContext
});
```

- `ind` is a {@link LegendIndicatorInfo}: `{ id, title, source? }` — `source` is the
  script the indicator was added with (also exposed as `handle.source`), and is
  `undefined` for native indicators, which is the usual `when` gate.
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
  row's {@link LegendIndicatorInfo}; buttons close the panel after `run` unless
  `close: false`.
- The bubble itself is the kit's `CalloutBubble` (`@luxalgo/vela/ui`) — reusable in
  host chrome; the widget's own market-status badge is the same component.
- The seam degrades gracefully: a custom renderer without `setLegendCallouts` simply
  never shows contributed callouts.

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
- **The dock is exclusive.** Opening a panel closes the one showing — the chart keeps its
  width, and only one column is ever docked. `onOpen` is where a lazy panel renders.
- **`onChart` is the rebind hook**, not a one-shot: the widget hands over a new chart instance
  after a symbol/timeframe rebuild, and a workspace re-points the panel at the active cell.
- Register at import time; after a late registration call `widget.refreshActions()` (an open
  contributed panel stays open across the rebuild).
- A `mount` that throws is contained: the panel docks empty and the reason is logged, rather
  than taking the shell down.

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
