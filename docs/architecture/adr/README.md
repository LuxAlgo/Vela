# Architecture Decision Records

This directory holds the **Architecture Decision Records (ADRs)** for Vela — the durable record of *why* the library is shaped the way it is.

An ADR captures a single architectural decision: the forces that pushed on it, the choice that was made, the trade-offs accepted, and — most importantly — the **invariant** the decision creates. Invariants are the rules the rest of the codebase relies on. When you are evaluating whether a decision still holds, read the ADR and ask: *is the invariant still true, and is it still worth its cost?*

Vela is a new, modern charting library: a robust **core** surrounded by three independently swappable **layers** — data providers, scripting engines, and renderers. Most ADRs here exist to keep those layers genuinely independent.

> These ADRs describe the architecture as it stands today; revisit them as the design evolves.

## Conventions

- **Numbering**: four-digit, zero-padded, monotonically increasing (`0001`, `0002`, …). Numbers are never reused, even if an ADR is later superseded.
- **Filename**: `NNNN-short-kebab-title.md`. The slug should read as the decision, not the problem.
- **Shape**: every ADR uses the same sections — Title, Status, Context, Decision, Consequences / Trade-offs, and Invariant.
- **Status**: one of `Proposed`, `Accepted`, `Superseded by NNNN`, or `Deprecated`. A superseded ADR stays in place; it is never deleted.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-neutral-model-as-cross-layer-currency.md) | Neutral model as the cross-layer currency | Accepted |
| [0002](./0002-core-owns-market-data.md) | Core owns market data | Accepted |
| [0003](./0003-no-default-scripting-engine.md) | No default scripting engine | Accepted |
| [0004](./0004-enforce-layering-with-import-acl.md) | Enforce layering with an import ACL | Accepted |
| [0005](./0005-core-owns-user-drawings.md) | Core owns user drawings | Accepted |
