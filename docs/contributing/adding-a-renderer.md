# Adding a Renderer

This guide is for an engineer building a new **renderer** for Vela. It is conceptual: it explains what a renderer is responsible for, the contract it implements, and how it binds into a running chart. It does not walk source files — those move. For the native renderer's internal machinery, see the optional [deep dive](#deep-dive-native-renderer-internals-optional) at the end.

The renderer is the **output layer** of Vela's core-plus-three-layers design, reached through the `IChartRenderer` port. The core hands it a backend-neutral scene; the renderer turns that scene into pixels and pointer interaction, and feeds user interaction back to the core. For how the core, the three layers, and the neutral model fit together, see the [architecture overview](../architecture/overview.md).

See also: [Adding an Engine](./adding-an-engine.md) · [Adding a Data Provider](./adding-a-data-provider.md).

---

## What a renderer IS

A renderer is the stage that:

- **Paints** the neutral scene (price bars, panes, indicator series, drawings, tables) onto a surface.
- **Captures** pointer and viewport interaction (crosshair, click, scroll/zoom) and forwards it to the core as events.
- **Owns presentation chrome**: the per-indicator legend, the settings dialog, and table dashboards.
- **Resolves coordinates and time** at its own boundary — translating the model's canonical epoch **milliseconds** and prices into screen space for drawings.

### The one invariant

**No backend-specific type ever crosses the port.** Everything the core sends is part of the neutral model (bars, panes, indicator models, scene patches, inputs, visible ranges). Everything the renderer sends back is a neutral event. The renderer may use any drawing technology it likes internally — WebGL, canvas2d, SVG, a third-party chart widget — but none of that leaks across the boundary. That opacity is exactly what makes the renderer swappable.

---

## The five responsibility groups

The port groups into five concerns. Implement all five and you have a conforming renderer.

### 1. Lifecycle

Mount into a host element with a theme, react to theme changes and resizes, and destroy cleanly.

- **Mount** attaches your surface to the container and adopts the supplied theme.
- **Set theme** re-skins in place.
- **Resize** re-measures against the container.
- **Destroy** must leave **nothing** behind — no DOM nodes, no observers, no event listeners, no floating overlays. A renderer that leaks on destroy will accumulate state across chart re-creation. Treat "destroy is exact" as a hard requirement.

### 2. Price bars

Two entry points feed the candlestick/OHLCV series:

- **Bulk replace** swaps the entire bar array. **By default it re-frames the view** (a fresh series, auto-fit). A **preserve-view** path keeps the current viewport instead — used when extending the same series in place. The core may load deep history in two phases: a quick recent-window preview first, then the full depth behind it. Bulk replace with preserve-view is how that second phase lands without the candles jumping. (See the [data flow](../architecture/data-flow.md) doc for the two-phase load.)
- **Single-bar update** appends a new bar **or** replaces the forming (last) bar, decided by **timestamp**. This is the live-tick path.

### 3. Panes

The scene is organized into stacked panes.

- The **price pane always exists and is never removed.** It is the home of the candles and of overlay indicators.
- **Study indicators get their own panes** below the price pane.
- Ensure-pane is idempotent: asking for a pane that already exists is a no-op. Remove-pane tears down a study pane (but never the price pane).

### 4. Indicator mount + patch

An indicator arrives as a whole neutral **model** (its series, fills, markers, drawings, tables, legend, inputs schema). You:

- **Mount the model** and return an **opaque handle**. The core holds the handle; it never inspects your internals.
- Thereafter **value-patch** through that handle on each recompute that changes only values — live ticks, and viewport-aware recomputes — applying a scene patch that updates values without rebuilding structure. The core decides *when* a recompute occurs (a plain viewport change only re-runs viewport-aware indicators; a live tick only re-runs where the chart is live and the engine streams). Your job is simply to apply whatever the core sends as a patch vs. a structural remount. (The [data flow](../architecture/data-flow.md) doc covers which event triggers which recompute.)
- **Structurally remount** when inputs are edited, because an input edit can restructure the output (different number of plots, new drawings, changed pane routing).
- Be **idempotent by indicator id**: mounting the same id twice must not double up. Removing through the handle disposes everything that indicator owns.

> **Subtlety — value-patch vs structural remount.** A live tick or a viewport-aware recompute changes *values*, so it is a patch through the existing handle: cheap, no flicker. An *input edit* may change the very shape of the output, so the core remounts the indicator structurally. Honor that distinction — do not rebuild on every tick, and do not try to patch your way through a structural change. From the renderer's side the only thing you must get right is *which* of the two the core asked for; the core owns the decision of when a recompute fires at all.

There is also a path to **reflect a programmatic input change** in your settings UI, so the displayed control stays in sync when inputs are set from outside the chrome. (This belongs with the optional **Inputs UI** tier — see the [conformance ladder](#a-conformance-ladder); a Tier 1 renderer without a settings dialog has nothing to sync.)

### 5. Interaction + capabilities

**Events** — the renderer raises these to the core, and **each subscription returns an unsubscribe** function:

- **Crosshair move** — time, price, and the value of each series at the crosshair (keyed by stable series id) for the legend.
- **Click** — time and price at the pointer.
- **Viewport change** — the new visible range.
- **Input change** — the user edited an input in your settings dialog (indicator id, key, new value).

**Viewport control:**

- **Get visible range** returns the current range — or null if there genuinely is no range yet.
- **Set visible range** moves the viewport programmatically.

**Capabilities** — a published, **honest** descriptor of what you support (see below).

> **Subtlety — `getVisibleRange` must answer correctly even before any viewport event has fired.** Some renderers auto-fit on first paint and emit no viewport event for it. The core may ask for the range before any change event arrives, so compute the real current range on demand rather than only caching it from the last event.

---

## Capabilities are a forward-declaration contract

The core **trusts your declared capability flags** and routes scene content accordingly. Read each flag as: **"true = the core may send me this."**

The descriptor covers these fields. Some are tri-state (for example `native` / `primitive` / `unsupported`) so you can declare *how* you support a feature, not just whether:

| Field | Tri-state? | Tier |
| --- | --- | --- |
| Panes | no | Tier 1 |
| Background color | yes (`native` / `primitive` / `unsupported`) | Tier 1 |
| Bar color | yes (`native` / `approximated` / `unsupported`) | Tier 1 |
| Per-point color | no | Tier 1 |
| Markers | no | Tier 1 |
| Horizontal lines | yes (`native` / `primitive` / `unsupported`) | Tier 1 |
| Fills | yes (`native` / `primitive` / `unsupported`) | Tier 1 |
| Drawings | no | optional — **Drawings** tier |
| User drawings (interactive) | `userDrawings` flag + a second port | optional — **User-drawings** tier |
| User-drawing depth (a drawing can paint anywhere in the series stack) | `drawingDepth` flag | optional — inside the **User-drawings** tier |
| Tables | no | optional — **Tables** tier |
| Trade markers (`trades` flag) | no | optional — inside the **Drawings** tier family: paints `IndicatorModel.trades` (order-fill arrows + labels + fill-price ticks on the price pane) and honors the `tradeMarkers` feature; absent/false ⇒ the channel is carried but never painted |
| Inputs UI (you provide the in-chart settings dialog) | no | optional — **Inputs UI** tier |
| Contributed legend actions (`setLegendActions?`) | no | optional — inside the **Inputs UI** tier: the shells wire `registerLegendAction` through it; without it those buttons simply never show |
| Legend overview override (`setLegendOverviewAction?`) | no | optional — inside the **Inputs UI** tier: a multi-chart shell replaces the legend's fold toggle with its own indicator-overview entry point; without it the inline fold stays |
| Per-indicator settings opener (`openIndicatorSettings?`) | no | optional — inside the **Inputs UI** tier: host chrome (the object tree's action menu) opens one indicator's settings dialog programmatically; without it that menu entry never shows |

The optional-tier rows line up one-to-one with the optional tiers in the [conformance ladder](#a-conformance-ladder): a flag stays off until its tier lands.

Two rules:

1. **Declare honestly.** A renderer that claims a capability it does not implement produces silent, wrong output — the core will send content you then drop or mangle. If you cannot render something yet, declare it unsupported and the core will not send it (or will warn/degrade).
2. **Render blank until implemented.** Capabilities are a forward-declaration *contract*: flip a flag to true only once that path actually paints. It is completely valid to ship a renderer that declares several features off and renders blank for them — the conformance ladder below is built on exactly this.

---

## User drawings (interactive)

This is a separate concern from the **Drawings** tier above. That tier paints the lines/boxes/labels
a scripting **engine emits** as part of the neutral scene. The **user-drawings** tier is the
interactive toolbar a *person* draws with — trend lines, Fibonacci, patterns, annotations — with
selection, undo/redo, and persistence. It is entirely **optional**: a renderer can ship without it
(a minimal adapter may), and the chart's `chart.drawings` model still serializes and
round-trips regardless, because the model is **core-owned** (see
[ADR 0005](../architecture/adr/0005-core-owns-user-drawings.md)).

To support it, declare the `userDrawings` capability and expose a **second port**,
`IDrawingsRendererPort` (distinct from the main renderer port). The contract is small and, like the
rest of the system, **JSON-only**:

- **Commands down** — the core calls `setToolbar` (an inert toolbar definition: groups + tools + SVG
  icon strings), `showToolbar`, `syncDrawings` (an array of flat `SerializedDrawing` records),
  `setActiveTool`, and `setSelection`. You **rehydrate** each `SerializedDrawing` into something you
  can paint and hit-test, and discard it on the next sync — you hold no authoritative model state.
- **One channel up** — a single `onDrawingIntent` callback through which you report every user
  gesture as a discriminated-union intent (arm a tool, create, edit, edit-many, delete, select,
  reorder, undo/redo, copy/paste/duplicate). The core applies it to the store and syncs back down.
  The loop is one-directional; you never mutate the model yourself.
- **The `Projector` seam** — you supply data↔pixel closures (time/price ↔ x/y). The model's anchors
  are **data-space only** (epoch-ms + price); you resolve pixels on demand each frame and store
  none, so drawings survive pan/zoom/reload. This mirrors the coordinate/time resolution you already
  do for engine drawings.

Everything else — the interaction state machine, hit-testing, the toolbar DOM, the per-drawing
settings popup, the magnet/eraser/measure modes — lives **behind your port**, on your side, and is
yours to build however suits your surface. Nothing about it crosses into the core.

### Depth — the optional `drawingDepth` flag

With this flag, a drawing's `zIndex` shares **one draw-order space with the pane's series**: the
candles and each indicator carry z keys of their own, and a drawing whose key falls inside that
range is meant to paint there — under the candles, between two indicators. Honouring it means
compositing drawings **into** your series pass rather than on a layer above it: the native renderer
prepaints each occupied gap onto its own canvas and composites it mid-pass (a `drawImage` on the
canvas2d backend, a textured quad on the WebGL2 one). It is gated by its own capability and is
independent of the rest of the tier: leave the flag off and paint every record in front, ordered
among themselves by `zIndex`, and the widget stops offering depth slots. The key still round-trips
through persistence either way, because it lives in the core model.

Declaring it comes with two seams and two usability rules. The seams: implement the port's
`stackRange(paneId)` query (the stack extremes a new drawing and the reorder commands have to
beat), and expect z keys to arrive as arbitrary numbers. The rules: paint **selection handles in
front** regardless of the drawing's depth (handles buried under the candles leave the user unable
to see what they grabbed), and keep **hit-testing depth-agnostic**, since a drawing under the data
is still meant to be clickable and draggable.

---

## What the renderer owns

Beyond painting, the renderer owns **presentation chrome** and **coordinate/time resolution**:

- The per-indicator **legend**.
- The **settings dialog** for editing inputs (and the input-change events it raises).
- **Table dashboards** drawn as an overlay.
- The **coordinate and time resolution** for drawings — converting the model's canonical epoch-millisecond timestamps and prices into screen positions.

### Reuse the shared, backend-neutral building blocks

Do not reimplement the cross-cutting pieces. Vela ships **backend-neutral building blocks** you assemble into your renderer:

- The **inputs / settings UI**.
- The **table overlay**.
- The **drawing-geometry helpers** (the math that turns drawing models into shapes, independent of how you stroke them).

These carry no backend types, so any renderer can use them. Your renderer supplies the surface and the coordinate boundary; the shared blocks supply the rest.

> **Subtlety — `force_overlay` and cross-pane drawings.** A study indicator (which lives in its own pane) can mark a drawing to render on the **price pane** instead. Your drawing layer must be able to place a study's drawing on a pane other than the study's own. Plan the coordinate resolution so a drawing can target any pane, not just its owner's.

---

## Selection and binding

There are two ways a renderer reaches a chart:

1. **By class on the `renderer` option.** Pass a renderer **class**; the composition root instantiates it with the resolved display options. Omit it for the built-in native renderer (the default). The composition root imports only the native renderer — any other renderer class is imported by *you* and handed in.
2. **Dependency override.** Injecting a pre-built renderer instance through `deps.renderer` supplies *any* port implementation, and it **wins** over the option — use it when you need to construct the renderer with your own configuration.

The **recommended third-party path is implement-the-port + pass the class**: build a class that satisfies the renderer port (constructor `(opts?: RendererDisplayOptions)`), then hand it to `renderer` (or inject an instance via `deps.renderer`). You never patch the core; you hand it your implementation.

The default is the **native renderer** (WebGL2 with a canvas2d fallback), built in and zero-install. Vela is not built on top of it: it is simply an implementation of the `IChartRenderer` port, and your renderer is its peer.

---

## A conformance ladder

You do not have to implement everything at once. Capabilities let you ship a small renderer and grow it. Climb in this order.

**Tier 1 — minimum viable renderer (required):**

The responsibilities below are all required at this tier. For the **fastest path to pixels**, build them roughly in this order:

1. **Lifecycle** (mount / theme / resize / clean destroy) **plus bulk-replace price bars** — this alone puts candles on screen.
2. **The price pane** (always present) and a **single indicator mount** with value-patch — now you have plots.
3. **The rest of the price-bar path** (preserve-view + single-bar update) and **structural remount**, idempotent by id.
4. **Interaction last** — crosshair / click / viewport events (each with unsubscribe) and get/set visible range.
5. **An honest capabilities descriptor** — most feature flags may be **off** at this tier.

That alone gives you candles, panes, and basic indicator plots — a usable chart.

**Optional tiers (add in any order, flipping the matching capability flag as each lands):**

- **Drawings** — engine-emitted line/box/label/polyline/linefill via your drawing layer (reuse the geometry helpers). Flips the `Drawings` flag.
- **Tables** — engine-emitted table dashboards via the table overlay. Flips the `Tables` flag.
- **Inputs UI** — the in-chart settings dialog, the input-change events it raises, and the programmatic-input-sync path from group 4 (reuse the shared inputs UI). Flips the `Inputs UI` flag.
- **External crosshair** — the optional `setExternalCrosshair(time, price?)` method: draw a dimmed **ghost crosshair** at a data-space position pushed from outside (multi-chart sync). Detected by presence (no capability flag); the one contract rule: a ghost must **never** re-emit `onCrosshairMove` — that one-way flow is what keeps the sync loop-free.
- **Data-window readout** — the optional `getDataWindowReadout()` method: hand back the bar under the crosshair (the latest bar when the cursor is off the plot) with its values already formatted on the scale of the pane each one belongs to, grouped per indicator. Detected by presence (no capability flag); host panels such as the widget's data window read it through `chart.renderer.dataWindowReadout()` and simply show nothing without it.
- **Loading affordance** — the optional `setLoading(loading)` method: the core raises it while a market load is in flight with **no bars painted yet** (the first load, and every symbol/timeframe switch — the core blanks the old series first), and drops it with the first series it hands over, or when a load fails or parks. Show something subtle (the native renderer pulses three small dots at the plot center), and hide content that does **not** ride the bar series — corner-anchored tables stay painted through an emptied chart unless you hide them, while bar-mapped content vanishes with the series on its own. Plugins get the same window as the `load:start` / `load:end` chart events. Without the method the chart is simply blank while loading. Detected by presence (no capability flag).
- **Animations / polish** — transitions and presentation refinements.

The key idea: a flag stays **false and renders blank** until its tier is real, and the core simply won't send that content meanwhile.

---

## Deep dive: native renderer internals (optional)

> This section is **not** on the main path. You do not need any of it to write a conforming renderer. It exists only to satisfy curiosity about how the default native renderer is built internally.

The native renderer composes a chrome layer (legend, crosshair readout, settings dialog), a drawing scene built on the shared drawing-geometry helpers, and a WebGL2 paint path with a canvas2d fallback. It converts the model's canonical epoch-millisecond timestamps to its own time axis at its boundary, and it auto-fits on first paint (which is why it computes the visible range on demand rather than waiting for a viewport event). None of these choices are part of the port — a different renderer may organize its internals however it likes, so long as the five responsibility groups and the one invariant hold.
