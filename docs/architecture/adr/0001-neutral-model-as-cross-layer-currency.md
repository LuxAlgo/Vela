# 0001 — Neutral model as the cross-layer currency

**Status:** Accepted

## Context

Vela™ is built as a robust core surrounded by three independently swappable layers — data providers, scripting engines, and renderers — each reached through a single narrow **port**. For those layers to be genuinely interchangeable, the core cannot speak any layer's private dialect. If a renderer's geometry types, or a scripting engine's internal output shape, or a provider's payload format leaked across a port, the core would silently become coupled to that one backend, and "swappable" would be a fiction.

We needed one shared vocabulary that every layer reads and writes, and that hides each backend's internals from everything on the other side of the boundary.

## Decision

Define a single **neutral model** as the only thing that crosses a port. It describes charting concepts in backend-agnostic terms: bars, series, pane overlays, drawings, inputs, and incremental update patches. No backend-specific type — no renderer handle, no engine-internal structure, no provider payload — ever crosses a boundary.

Time in the neutral model is canonical **epoch milliseconds**; each renderer converts to its own time representation at its own boundary. Element identity in the model is **content-addressed and stable** across re-runs of identical source, so a live tick patches the exact existing series or drawing rather than recreating it.

Every port is defined in terms of this model: providers emit neutral bars, engines emit a neutral (unrouted) indicator model, and renderers consume neutral models and return opaque handles. The renderers themselves are swappable defaults: the native renderer is the default (WebGL2 with a canvas2d fallback), and a secondary/parity renderer adapter is available as an alternative option — both consume the same neutral model, so neither is privileged and Vela™ is not built on top of either.

## Consequences / Trade-offs

- **Layers stay swappable.** Because the model is opaque to backend specifics, any conforming implementation of a port can be dropped in without the core noticing the difference.
- **One vocabulary to learn.** Contributors to any layer share the same nouns, which keeps the mental model small.
- **The model is a real design surface.** It must be expressive enough for every layer yet stay backend-neutral; growing it is a deliberate, cross-cutting act, not a quick local change.
- **Translation cost at each boundary.** Backends convert to and from the neutral model (e.g. renderers convert milliseconds to their native time type). This is accepted as the price of decoupling.
- **Capabilities, not assumptions.** Because the core cannot inspect a backend, each layer declares honest capability flags and the core trusts them; a backend that misreports a capability produces silently wrong output, so capability honesty is itself load-bearing.

## Invariant

**Only the neutral model crosses a port. No backend-specific type ever passes a layer boundary.** Time is epoch milliseconds in the model; element ids are content-addressed and stable across identical re-runs.

---

See also: [0002 — Core owns market data](./0002-core-owns-market-data.md), [0004 — Enforce layering with an import ACL](./0004-enforce-layering-with-import-acl.md).
