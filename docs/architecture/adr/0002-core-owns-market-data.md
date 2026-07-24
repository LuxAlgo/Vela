# 0002 — Core owns market data

**Status:** Accepted

## Context

A chart, its indicators, and its renderer all need to agree on *which bars exist*. If a scripting engine fetched its own primary data, or a renderer assembled its own history, the chart could show one timeline while an indicator computed over another — drift that is invisible until results disagree. We also wanted live ticks to flow to one place and fan out consistently, and secondary data (additional symbols or timeframes a script requests) to be served without each engine reinventing fetching and caching.

## Decision

The **core owns the canonical bar array** and is the **sole loader and streamer of primary market data**. The core asks the data feed to load history, stores the canonical bars, and drives both the renderer and any engines from that single source of truth.

Engines never fetch primary data — they are **fed** a bar snapshot. When a script needs **secondary** series (a different symbol or timeframe), it goes through a core-supplied, cache-backed `fetchSeries` gateway. Timeframes are kept separate; the gateway does no timeframe aggregation. The **forming (last) bar is never cached as closed history**, so streaming never poisons the cache with an unfinished bar.

Caching is built into the default `MultiProviderFeed`; to opt out, inject your own `MarketDataFeed` via `deps.dataFeed` — a custom feed is used bare, with no registry and no cache.

## Consequences / Trade-offs

- **One timeline, no drift.** Renderer and engines compute against the same canonical bars, so what you see and what an indicator measures cannot diverge.
- **Engines stay simple.** A scripting engine only consumes bars and asks the gateway for extra series; it owns no fetching, no caching, no streaming policy.
- **Centralized streaming.** Live ticks arrive at the core and patch downstream consistently; the forming-bar rule keeps history clean.
- **Secondary data has guarantees but also limits.** No aggregation means a script asking for a timeframe gets that timeframe as-is, not a downsample of another.
- **The caching decorator has known limits.** Because the cache can serve history without ever re-loading, symbol and timeframe are read from each call rather than assumed, and cross-symbol eviction is coarse for now; these mechanics are tracked in the data-layer guide rather than fixed by this decision.

## Invariant

**The core is the single owner and sole loader/streamer of the canonical primary bar array. Engines are fed bars and never fetch primary data; secondary series flow only through the core's cache-backed `fetchSeries` gateway. The forming bar is never cached as closed history.**

---

See also: [0001 — Neutral model as the cross-layer currency](./0001-neutral-model-as-cross-layer-currency.md), [0003 — No default scripting engine](./0003-no-default-scripting-engine.md).
