# 0003 — No default scripting engine

**Status:** Accepted — **strengthened**: no engine ships in the package at all (see *Decision*).

## Context

Vela™ can run indicator scripts, but "run a script" is not one thing — different languages need different engines, and engines are heavy, opinionated pieces (parsers, runtimes, worker transports). Bundling one engine as an always-on default would push that weight onto every chart, including charts that only ever show candles, and would quietly privilege one scripting language as *the* language.

We wanted the engine layer to be exactly as present as the application asks for, and we wanted failure modes to be loud rather than surprising.

## Decision

Vela™ ships **no default scripting engine**. A bare chart renders **candles only**. Engines are registered explicitly — one at a time via `registerEngine(language, engine)`, or in bulk through the dependency-injection entry — and are **selected per indicator by language id**.

If an indicator is added and no engine is registered for its language, the chart **throws an actionable error** rather than failing silently or guessing. Re-registering a language is **last-wins**, and the change applies to **future indicators only**, so already-running indicators are not yanked out from under a live chart.

**No engine is shipped either.** Vela™ originally bundled a Pine engine as an opt-in swappable default; it now lives in its own package, `@luxalgo/vela-pinets`. The decisive argument was licensing: the Pine runtime it executes is AGPL-3.0, and keeping it in the tree meant an Apache-2.0 library whose most-used feature dragged copyleft obligations behind it. Extracting it made the boundary structural rather than a matter of which import you happened to write. The engine layer is therefore the one layer with **no bundled default at all** — unlike the native renderer and the cache-wrapped provider feed, which remain swappable defaults that are present when chosen.

## Consequences / Trade-offs

- **Pay only for what you use.** Charts that just plot price carry no scripting runtime — and the published bundle carries none either.
- **No privileged language.** The architecture treats every engine as a peer; Pine is one addon among possible others, on exactly the same port as an engine you write yourself.
- **License containment.** A copyleft runtime cannot reach Vela™'s license by accident: the ACL bans the import outright, so the obligation is taken on only by an application that installs the addon.
- **Loud, actionable failures.** Running an indicator with no matching engine fails immediately with a clear message — easier to diagnose than silent no-ops.
- **Explicit setup required.** Applications that want scripting must register an engine; there is a deliberate one-line cost to enabling it.
- **Predictable re-registration.** Last-wins-for-future-indicators avoids surprising mutation of in-flight execution at the price of two indicators briefly running on two engine versions.

## Invariant

**No engine ships in the package. A bare chart is candles-only; engines are registered explicitly and chosen per indicator by language; an indicator with no matching engine throws. Re-registration is last-wins and affects future indicators only.**

---

See also: [0002 — Core owns market data](./0002-core-owns-market-data.md), [0004 — Enforce layering with an import ACL](./0004-enforce-layering-with-import-acl.md).
