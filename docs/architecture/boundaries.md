# Boundaries and Invariants

Vela's swappability is not a convention — it is enforced. This page lists the non-negotiable invariants that keep the core independent of any backend, the rules that govern the engine registry and capability declarations, and the mechanical enforcement that catches violations before they ship.

For the shape these rules protect see [overview.md](overview.md); for the contracts they constrain see [modules.md](modules.md).

## The core's independence

Three invariants make the core backend-agnostic:

- **No backend-specific type crosses a port.** Only the neutral model travels across a port boundary. A backend's internal types stay inside that backend. This opacity is what lets any layer be replaced.
- **The core imports almost no concrete backend.** The core depends only on the ports and the neutral model, with one deliberate, narrow exception: `DataControl` imports the concrete `MultiProviderFeed` and does an `instanceof` check on it to expose registry-only convenience methods (`registerProvider`, `symbols`, `capabilities`) when the default feed is in use. This exception is not lint-enforced. Outside of it, the core never names a renderer, an engine, or a feed implementation.
- **Only the composition root imports backends.** The Vela class and the package barrels — the main entry point and the browser bundle (which re-exports the optional renderer and the built-in providers) — are the only places that import concrete backends and wire the defaults. Everything else stays on the abstract side of the ports.

Together these mean: to understand what the core does, you never have to read a backend; to swap a backend, you never have to touch the core.

## The import ACL, mechanically enforced

These boundaries are enforced by lint, not by discipline. An **import access-control list** governs which parts of the codebase may import which dependencies:

- a scripting-language toolchain may not be imported **anywhere** — Vela ships no engine, so no part of this codebase links one (the ACL bans `pinets` outright; the Pine engines live in the separate `@luxalgo/vela-pinets` package, which is AGPL-3.0 and must not pull that license onto this Apache-2.0 one);
- a custom renderer's charting dependency belongs in **its own renderer folder** (never in core);
- the renderer must **never** import a scripting toolchain either.

The ACL uses **named exception buckets** — explicit, labeled allowances rather than blanket exemptions. Adding a backend means *deliberately extending the ACL* with a new named bucket, which makes every cross-boundary dependency a conscious, reviewable decision. A stray import that violates the boundary fails lint.

## The data layer is provider-agnostic

The built-in data providers (`src/data/providers/`) are written **from scratch** against the neutral feed port — they import no scripting or charting backend, so they are not a bundled third-party dependency that needs an ACL carve-out. The import ACL bans the Pine toolchain everywhere and confines the charting library to its own renderer folder; the data layer touches neither. Providers are simply data-layer code — sources of bars behind the feed port — so they live where data lives, and the layering holds with no special allowance.

## Engine registry rules

The engine registry is keyed by **language**, and a few rules govern it:

- **Keyed by language.** Each registration associates an engine with a language id; indicators select an engine by their language.
- **Last-wins, for future indicators only.** Re-registering a language replaces the engine for that language, but only **indicators created afterward** use the new engine. Already-running indicators keep the engine they were created with.
- **Default-language resolution chain.** When an indicator does not pin a language explicitly, the core resolves one through a defined chain rather than guessing arbitrarily.
- **No default engine.** Nothing is registered out of the box. A bare chart is candles-only, and asking for an indicator with no engine registered for its language throws an **actionable error** rather than failing silently.

## Capability honesty as an invariant

The core trusts declared capabilities. It does not feature-sniff a backend; it reads the flags the backend declares and routes accordingly:

- **engines** declare streaming, viewport-awareness, and inputs;
- **renderers** declare panes, fills, backgrounds, horizontal lines, bar coloring, markers, drawings, user drawings, tables, per-point color, and inputs UI.

This trust makes capability declarations an invariant of the contract. A backend that declares a capability it does not actually have produces **silently wrong output**, because the core takes the flag at face value. Declaring honestly is part of implementing a port — not a nicety.

This honesty matters precisely because the core *acts* on the flags. Concretely, the core takes the **live streaming path** only when all three of these hold: the chart is live, **and** the script is not viewport-dependent, **and** the engine declares the streaming capability. Fail any one and the core falls back to a static re-run — which is exactly what an engine that declares no streaming capability always gets. See [data-flow.md](data-flow.md) for the full trace of that decision.

## Optional members degrade to defined fallbacks

A port may have optional members, and a backend may omit them — but omission must land on **defined behavior**, never undefined behavior. For the feed:

- a missing ranged fetch degrades to a full load;
- missing symbol metadata degrades to a synthesized `symInfo`.

The core relies on these fallbacks being defined, so a minimal backend is always a valid backend.

## Data-handling invariants

A few rules keep the canonical data trustworthy:

- **The core owns primary data.** The core is the sole loader and streamer of the canonical bars. Engines are fed bars and never fetch primary data; secondary series go through the core-supplied `fetchSeries` gateway.
- **The forming bar is never cached as closed history.** The last, still-forming bar is volatile and must never be stored as if it were settled history.
- **Timeframes are kept separate.** There is no timeframe aggregation. A request for a timeframe returns that timeframe's bars; the core does not synthesize one timeframe from another.
- **Time is canonical epoch milliseconds.** The neutral model uses epoch ms everywhere; each renderer converts at its own boundary.

## Routing and identity are core responsibilities

The engine emits an **unrouted** model — it describes the indicator's output without deciding where it lives. **Pane routing and id stamping are core responsibilities.** The core decides overlay vs study placement, stamps the pane id, and assigns **content-addressed, stable** element ids (derived from script identity, not a transpile counter) so that live ticks patch the exact existing element in place.

These invariants are what let three layers evolve independently while the chart stays coherent. Every one of them is something the core *relies on* — which is why several are enforced by lint rather than left to convention.
