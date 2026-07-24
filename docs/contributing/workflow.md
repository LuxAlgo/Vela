# Contributor Workflow

This page describes how to make a change in Vela and how to know it is finished. Start from [setup.md](./setup.md) if you have not built the project yet.

## The quality gate is the definition of done

A change is complete when **four checks are green together**, each catching a distinct, non-overlapping class of problem:

| Gate | Command | Catches | In one phrase |
| --- | --- | --- | --- |
| **typecheck** | `npm run typecheck` | Type errors across the source | *Do the types line up?* |
| **lint** | `npm run lint` | Architecture-boundary violations + style | *Does it respect the layering?* |
| **test** | `npm test` | Behavior regressions | *Does it still do the right thing?* |
| **build** | `npm run build` | Packaging / emit problems | *Does it actually bundle?* |

Run all four before considering a change done. A change that passes three and fails the fourth is not finished.

### typecheck and build are different jobs

These two are easy to conflate, but they have separate responsibilities:

- **typecheck** runs the type checker with **no emit**. Its only job is to validate types. It never produces output.
- **build** **owns emit**. It is the only step that produces the two artifacts (see [setup.md](./setup.md#two-artifacts-from-one-source)).

So a green typecheck does not imply a working build, and a successful build does not substitute for typecheck. Run both.

### lint enforces the architecture

Lint is not just formatting here. The import rules are part of the architecture:

- The **core** depends only on the ports and the neutral model. It imports **no concrete backend**.
- Only the **composition root** (the `Vela` class plus the package entry point) imports concrete backends and wires the defaults.
- The scripting backend may be imported only in the engine layer; the renderer dependency only in its own renderer folder; the renderer never imports the scripting backend.

These rules are enforced by lint as an import ACL with named exception buckets. **Adding a new backend means deliberately extending that ACL** — that friction is intentional, so a boundary is never crossed by accident.

## The playground

`npm run playground` serves `playground/` with vite on `http://localhost:5190` — a bare page that
mounts the **Vela widget** straight from `src/` (no build step; changes hot-reload on save).
The page registers the Binance provider (public API, no key, no server) and the in-process
Pine engine with a starter indicator manifest. Use `window.widget` from the browser console
to poke at the live instance.

## Where to make a change, by layer

Vela is a **core** plus three swappable **layers**, each reached through a single narrow **port**: **data providers** (`MarketDataFeed`), **scripting engines** (`ScriptingEngine`), and **renderers** (`IChartRenderer`). The only thing that crosses a port is the **neutral model**; no backend-specific type ever does. For how the core and the three layers fit together, see the [architecture overview](../architecture/overview.md).

The shape of almost every change is the same: **implement a port, then register or inject the implementation.** Only the composition root wires the defaults.

- **Add a renderer** — implement `IChartRenderer` and declare honest capabilities, then pass the class as the `renderer` option (built-in or your own), or inject an already-constructed instance via `deps.renderer`. The composition root is the only place that imports a concrete renderer.
- **Add a scripting engine** — implement `ScriptingEngine` (a language id, capabilities, and prepare/execute), then register it (`registerEngine(language, engine)`) or pass a set via `deps.engines`. The engine is selected per indicator by language. There is **no default engine**: a bare chart shows candles, and running an indicator with no matching engine throws an actionable error. Re-registering a language is last-wins, and only affects future indicators.
- **Add a data source** — the common path is a `DataProvider` (just `getBars`, plus optional `listSymbols`/`getSymbolInfo`/`subscribe`), registered with `chart.data.registerProvider(name, provider)`; the default `MultiProviderFeed` routes symbols to it and caches closed bars. For full control, implement the whole `MarketDataFeed` port (`load`/`subscribe` required; `loadRange`/`symbolInfo` optional) and inject it via `deps.dataFeed` — used bare, with no registry or auto-cache.

In every case, **only the composition root wires the defaults** — your new implementation arrives through registration or dependency injection, never by the core reaching out to a concrete backend.

For the detailed contract of each layer, see the layer guides (adding a renderer, adding an engine, adding a data provider). For how to verify a change, see [testing.md](./testing.md) and [debugging.md](./debugging.md).
