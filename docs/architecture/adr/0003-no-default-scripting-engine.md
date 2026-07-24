# 0003 — No default scripting engine

**Status:** Accepted

## Context

Vela can run indicator scripts, but "run a script" is not one thing — different languages need different engines, and engines are heavy, opinionated pieces (parsers, runtimes, worker transports). Bundling one engine as an always-on default would push that weight onto every chart, including charts that only ever show candles, and would quietly privilege one scripting language as *the* language.

We wanted the engine layer to be exactly as present as the application asks for, and we wanted failure modes to be loud rather than surprising.

## Decision

Vela ships **no default scripting engine**. A bare chart renders **candles only**. Engines are registered explicitly — one at a time via `registerEngine(language, engine)`, or in bulk through the dependency-injection entry — and are **selected per indicator by language id**.

If an indicator is added and no engine is registered for its language, the chart **throws an actionable error** rather than failing silently or guessing. Re-registering a language is **last-wins**, and the change applies to **future indicators only**, so already-running indicators are not yanked out from under a live chart.

The bundled Pine scripting engine is offered as a **swappable default you opt into**, in both in-process and Web-Worker forms; it is not wired in automatically. This mirrors how the other layers are framed — the native renderer is the swappable default renderer, the cache-wrapped provider feed is the swappable default data feed — with each default present only when chosen.

## Consequences / Trade-offs

- **Pay only for what you use.** Charts that just plot price carry no scripting runtime.
- **No privileged language.** The architecture treats every engine as a peer; the included Pine engine is one option among possible others.
- **Loud, actionable failures.** Running an indicator with no matching engine fails immediately with a clear message — easier to diagnose than silent no-ops.
- **Explicit setup required.** Applications that want scripting must register an engine; there is a deliberate one-line cost to enabling it.
- **Predictable re-registration.** Last-wins-for-future-indicators avoids surprising mutation of in-flight execution at the price of two indicators briefly running on two engine versions.

## Invariant

**No engine is bundled as a default. A bare chart is candles-only; engines are registered explicitly and chosen per indicator by language; an indicator with no matching engine throws. Re-registration is last-wins and affects future indicators only.**

---

See also: [0002 — Core owns market data](./0002-core-owns-market-data.md), [0004 — Enforce layering with an import ACL](./0004-enforce-layering-with-import-acl.md).
