# 0006 — Workspace composes charts; chrome is a projection of the active cell

**Status:** Accepted

## Context

Vela was single-chart: `VelaWidget` wraps ONE core `Vela` instance in a full chrome
(topbar, pickers, drawing toolbar, object tree, bottombar, keymap). Multi-chart
layouts (2–16 cells, presets + splitters) had to arrive with a hard product
constraint: **everything outside the charts stays shared** — one topbar, one symbol
picker, one indicator picker, one drawing toolbar, one keymap — always reflecting and
acting on the **active** cell.

Two architectural routes existed. Teach the core about multiple charts (a
"multi-chart core" owning N series), or **compose** N ordinary charts under a new
shell. The pre-study showed the core, renderer, and chrome were already
multi-instance-safe, and that the real blockers were peripheral: the shared bar cache
purged every symbol but the current one; the 1 Hz countdown repainted at full tier on
every chart; the widget's `rebuild()` semantics destroyed the chart (and the user's
drawings) on every symbol switch; the drawing toolbar and its modes had no
programmatic seams.

## Decision

**`VelaWorkspace` composes ordinary, unmodified charts.** The core stays single-chart;
the new `vela/workspace` subpath owns the grid. The enabling work landed as core
capabilities that are useful stand-alone, not as workspace special cases:
`chart.setMarket()` switches a market **in place** (indicators, drawings, config, and
subscriptions survive; `market:changed` carries `prev`), the bar cache gained
multi-symbol **retention** (`BarStore.retain`), the countdown repaints at a cheap
chrome tier, and the drawing tool/modes gained port seams and events.

The load-bearing rules:

- **Cells have identities, never content.** A cell's identity is its declared name
  (the keys of `cells`), or `c<N>` for a slot no entry declared; it never derives from
  what the cell shows — symbols change, duplicates are legal. Declaration order maps
  identities onto the layout's positional slots, so every layout arranges the same
  identities; a cell dropped by a smaller layout parks its full state (market, renderer
  config, drawings document, indicator ledger) in a **pool** keyed by identity, and
  `4 → 2 → 4` restores the third and fourth exactly. `cell.chart` is a live getter: the
  instance survives every market change and dies only when its cell leaves the layout.
  *(Identities were the positional ids `c1…cN` when this decision was taken; naming them
  came later and changed only what an identity is spelled with, not the rule.)*
- **Chrome is a stateless projection of the active cell**, re-projected on exactly
  two triggers: ① `cell:active` (full rebind — the pattern the widget's rebuild
  already proved) and ② the active cell's own events (filtered by `cellId ===
  activeId`). No chrome component caches a chart reference.
- **One shared feed.** Providers register once on a single `MultiProviderFeed`
  injected into every cell (`deps.dataFeed`); the workspace declares every live
  cell's symbol to the shared cache (`retain`) so one cell's load never evicts
  another's history. Engines are per-cell (the worker engine isolates each cell).
- **One state document for BOTH shells** (`src/state/document.ts`):
  `getState()` / `applyState()` / `state:changed` and the `persist` option speak the
  same versioned, sanitized format on `VelaWidget` and `VelaWorkspace` — the widget
  is the single-cell case (`layout: '1'`, one `c1` cell). Persistence is an adapter
  over that surface (`WidgetStorage ≡ WorkspaceStorage`); the workspace default is
  in-memory, and no shell writes the URL natively.
- **Uniform renderer budget.** Beyond `maxWebglCells` (default 8) every cell uses
  canvas2d — a uniform look inside the browser's WebGL context cap, switched by
  rebuilding all cells through the pool.

## Consequences / Trade-offs

- Measured at 16 live cells (worst preset × live streams): idle holds 60 fps
  (mean frame 16.7 ms, zero long tasks over 5 s) thanks to the chrome-tier countdown;
  an offscreen-cell throttle (IntersectionObserver) was considered and **rejected for
  v1 — the measurements do not justify it**. Create/destroy cycles are clean
  (DOM/canvas counts return to baseline; the WebGL backend explicitly releases its
  context on destroy so churn cannot evict live charts' contexts).
- The workspace duplicates ~a few hundred lines of the widget's chrome glue.
  Accepted for v1. **Future work:** `VelaWidget` should delegate to a one-cell
  workspace; the unified state document already makes the two interchangeable
  (a widget document restores into a workspace slot verbatim, and back).
- Crosshair sync shipped as the port's first OPTIONAL interaction seam:
  `setExternalCrosshair?(time, price?)`, detected by presence (no capability flag).
  Followers show a dimmed data-space ghost; the contract's one rule — a ghost never
  re-emits `onCrosshairMove` — makes the flow one-way, so no echo guard exists or is
  needed. Viewport sync guarantees **right-edge alignment** across mixed timeframes
  (a finer cell clamps to its own minimum zoom).
- Per-symbol drawing documents remain a HOST policy (`toJSON`/`fromJSON` keyed off
  `market:changed`); cells keep one document across symbol switches by default.

## Invariant

The workspace composes **ordinary charts** behind **stable cell identities**; all shared
chrome is a **stateless projection of the active cell**, rebound on `cell:active` and
refreshed only by the active cell's own events. Cell content — symbol, timeframe,
style, indicators, drawings — is mutable state, never identity. Both shells expose
the same state document, and everything the shells persist round-trips through it.
