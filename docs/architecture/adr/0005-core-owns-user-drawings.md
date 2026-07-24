# 0005 — Core owns user drawings

**Status:** Accepted

## Context

Vela has two kinds of on-chart drawings. A scripting **engine** emits lines/boxes/labels as
*output* — those are part of the neutral model and flow through the renderer port like any other
content ([0001](./0001-neutral-model-as-cross-layer-currency.md)). Separately, a **user** draws and
edits interactive tools (trend lines, channels, Fibonacci, patterns, annotations, …) with a
toolbar, selection, undo/redo, and a clipboard.

The interactive tools needed a home. Putting their model in the renderer would have been the
obvious shortcut — the renderer already owns the canvas and the pointer events — but it would tie
the tools to one renderer, lose them on a renderer swap, and make persistence and undo a
per-renderer concern. It would also blur the line the rest of the architecture relies on: the core
owns state; renderers draw it.

## Decision

The **core owns the user-drawings model** — the authoritative store, the type registry, undo/redo
history, the clipboard, per-type last-style, tool/selection state — and reaches the renderer through
a **second, dedicated port**, `IDrawingsRendererPort`, separate from the main `IChartRenderer`.

Only JSON crosses that port: flat `SerializedDrawing` records (`{id, type, createdAt, paneId, anchors, style,
text, locked, visible, zIndex, props}`) and an inert `ToolbarDefinition` (groups + tools + SVG icon
strings). No `Drawing` class instance and no renderer type ever cross. Commands flow **down**
(`setToolbar` / `showToolbar` / `syncDrawings` / `setActiveTool` / `setSelection`); a single
`onDrawingIntent` channel carries discriminated-union intents **up**. The loop is one-directional
and store-authoritative — a user gesture becomes an intent, the core mutates the store, and the
store's change re-syncs the renderer; the renderer never mutates the model itself.

A thin **second seam**, the `Projector` (data↔pixel closures the renderer supplies), keeps anchors
in **data space** (epoch-ms time + price). The renderer resolves pixels on demand each frame and
stores none, so drawings survive pan/zoom/reload/timeframe change for the same reason Pine drawings
do (`xloc=bar_time`).

Rendering is **capability-gated** (`capabilities.userDrawings` + `userDrawingsPort`; native = yes,
a minimal adapter may not), but the model is not: even with no port, the controller still serializes,
restores, and undoes.

## Consequences / Trade-offs

- **Renderer-swappable, persistence-portable.** The same drawings document round-trips regardless of
  renderer; switching renderers doesn't lose them. Persistence, undo, and clipboard are written once
  in the core, not per renderer.
- **One clear boundary.** A renderer that wants interactive drawings implements one extra port and
  supplies a `Projector`; everything else (interaction state machine, hit-testing, the toolbar DOM,
  the settings popup) lives behind it and is the renderer's own business.
- **Graceful when unsupported.** A renderer can decline drawings (capability `false`); the
  interactive API warns and no-ops, while the model still serializes/round-trips. No feature lies.
- **Two drawing concepts to keep straight.** "Drawings" now means either engine-emitted neutral-model
  output *or* user tools. They share neither code path nor ownership; docs and capability flags must
  name which one they mean.
- **Pixels are recomputed, never stored.** The data-space invariant costs a projection per drawing
  per frame, in exchange for durability across every viewport change — the right trade for a chart.

## Invariant

**The core is the sole owner of the user-drawings model (store, history, clipboard, registry,
tool/selection state). The only things that cross the `IDrawingsRendererPort` are JSON
`SerializedDrawing` records and an inert `ToolbarDefinition`; anchors are data-space only and pixels
are resolved on demand through the renderer-supplied `Projector`. Rendering is capability-gated;
the model and its persistence are not.**

---

See also: [0001 — Neutral model as the cross-layer currency](./0001-neutral-model-as-cross-layer-currency.md), [0002 — Core owns market data](./0002-core-owns-market-data.md). User guide: [Drawing tools](../../user/drawing-tools.md); contributor guides: [Adding a drawing tool](../../contributing/adding-a-drawing-tool.md), [Adding a renderer](../../contributing/adding-a-renderer.md).
