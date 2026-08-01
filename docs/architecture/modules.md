# Modules and Composition

Vela's structure is defined by three **ports** and one **composition root**. The ports are *contracts*, not files — they describe what a layer must be able to do, independent of how (or where) it does it. This page describes each contract conceptually, the default backend that satisfies it, and how the pieces bind together.

For the big picture see [overview.md](overview.md); for how a request flows through these pieces see [data-flow.md](data-flow.md).

## The three ports as contracts

### Market-data feed

The feed is how the core gets price data. Its contract has two required capabilities and two optional ones.

**Required:**

- **Load history** — given a symbol and timeframe, return the bars. Each bar is neutral: open-time (epoch ms), open, high, low, close, and optionally volume. Bars come back sorted and deduplicated by open-time.
- **Subscribe to live ticks** — start a live stream and return an unsubscribe handle. A real provider may poll; a custom feed may use a socket. Either way it delivers bars through the same callback.

**Optional (degrade gracefully when absent):**

- **Ranged fetch** — load a bounded window `[from, to, limit]`, where omitting `to` means "up to now." This is what powers secondary series, which may be requested for an arbitrary symbol and timeframe.
- **Symbol metadata** — describe the instrument (its `symInfo`).

When the optional members are missing, the core falls back to defined behavior — a full load instead of a ranged fetch, a synthesized `symInfo` instead of real metadata — so a minimal feed is still a valid feed.

### Scripting engine

The engine is how indicator logic runs. Its contract is a small surface: a **language id**, a **capabilities** declaration, and two methods.

- **Prepare** — cheaply parse the script and return a prepared form: the inputs schema, metadata, an initial guess at whether the script reacts to the viewport, and an opaque token. Prepare touches **no market data**.
- **Execute** — run the prepared script over a snapshot of bars (plus inputs, market metadata, and a gateway for secondary series) and return an **execution session handle** synchronously. The session exposes controls — stop, update inputs, set visible range, notify of new bars — while results arrive through handlers (a neutral model on first run and every re-run, plus optional alert/warning/error/done callbacks).

An engine declares whether it can **stream** (run as a persistent live session) or only **re-run** statically on demand, plus whether it is **viewport-aware** and whether it exposes **inputs**. Selection is per-indicator, by language.

### Renderer

The renderer is how the neutral model becomes pixels. Its contract groups into a few responsibilities:

- **Mount, update, and remove indicators** — mount a whole neutral indicator model and receive back an opaque handle; apply value patches in place on ticks and viewport changes; perform a structural remount when an input edit changes the *shape* of the output; remove cleanly. Mount and patch are idempotent by id.
- **Manage panes** — the price pane always exists and is never removed; study indicators get their own panes.
- **Emit interaction events** — crosshair, click, viewport change, and input-change events, each returning an unsubscribe handle; plus get/set of the visible range. The renderer must be able to report the current visible range on demand even before the first viewport event fires — initial auto-fit may emit no event, yet `getVisibleRange` must still answer correctly.

The renderer also owns presentation chrome (legend, settings dialog, table dashboards) and resolves coordinates for drawings. Like the engine, it declares its capabilities honestly — panes, fills, markers, drawings, tables, per-point color, inputs UI — and the core routes accordingly.

## The composition root

The **composition root** is the single place that knows concrete defaults. It is the Vela class plus the package entry point, and it is the *only* code allowed to import concrete backends and wire them together. Everything else depends on ports.

This is what keeps the core clean: the core never names a backend, so the knowledge of "which renderer, which feed, which engines by default" lives in exactly one place. Swapping a default, or adding a new backend, is a deliberate change to the composition root and its import allowlist — never an incidental dependency that leaks into the core.

## The default backends (conceptually)

Each layer ships with a **swappable default** — a working implementation of its port, chosen by the composition root unless you override it.

- **Data feed** → a **provider-backed feed**, wrapped in an in-memory **caching decorator**. You get cached history and live ticks out of the box.
- **Scripting engine** → **none**. This is the one layer with no bundled default: Vela defines the port and ships no runtime, so the package carries no language toolchain and no third-party license with it. Engines arrive as separate packages — Pine Script in [`@luxalgo/vela-pinets`](../user/scripting-engines.md), which exports an in-process form and a Web-Worker form (the worker holds its persistent streaming session inside the worker: a live tick ships one bar across the message boundary and the script re-executes incrementally) — or as host code written against the port.
- **Renderer** → the **native renderer** (WebGL2 with a canvas2d fallback), the only bundled backend; the `IChartRenderer` port accepts custom classes.

## The caching decorator

The default feed is really two pieces: a provider-fetching feed and a cache that wraps it. The cache is a **feed that wraps a feed** — it satisfies the same port and is transparent to the core, which cannot tell whether it is talking to a cache or a bare provider. It keeps history in memory and serves repeat requests without re-hitting the provider. Caching is built into the default `MultiProviderFeed`; to opt out, inject your own `MarketDataFeed` via `deps.dataFeed` — a custom feed is used bare, with no registry and no cache.

The default cache is **scoped to the active symbol**: it is coarse about other symbols, and switching symbols purges what it held for the previous one. Multi-symbol or multi-chart scenarios should therefore not assume cross-symbol cache retention — treat the cache as a single-symbol working set, not a durable store.

It is a decorator, not a layer. It does not introduce a new port or a new extension point — it is one valid implementation of the feed contract that happens to delegate to another. Treat it as a property of the default feed, not as a fourth thing in the architecture.

## How the pieces bind

Three binding mechanisms, each suited to its layer:

- **Engines bind by language.** Register an engine against a language id (one at a time, or several at once). The core selects an engine per indicator by matching the indicator's language. Because selection is keyed by language, multiple engines for different languages coexist naturally.
- **Renderer and feed bind by dependency injection.** Hand the core a concrete renderer or feed and it uses that instance. An injected renderer takes precedence over the named-built-in option; an injected feed replaces the default (including opting out of caching).
- **The single orchestrator ties it together.** The core is the one orchestrator that holds the bound feed, the registered engines, and the bound renderer, and drives the loop between them. The composition root assembles those bindings; the core runs them.

For the rules that make these bindings safe — the import boundaries, the registry semantics, and the invariants — see [boundaries.md](boundaries.md).
