# 0004 — Enforce layering with an import ACL

**Status:** Accepted

## Context

The whole value of Vela's core-plus-three-layers design rests on the core depending only on ports and the neutral model, never on a concrete backend. But that discipline is easy to erode: a single convenient `import` of a renderer library inside the core, or a scripting dependency reaching into the renderer, would re-couple layers without anyone noticing in review. Conventions and good intentions do not survive a large codebase. The boundary needed to be **mechanically enforced**.

## Decision

Make the layering rules into a checkable **import access-control list (ACL)**, enforced by ESLint, with named exception buckets:

- The **core imports almost no concrete backend** — it depends only on ports and the neutral model, with one deliberate, unenforced exception: `core/DataControl.ts` imports the concrete `MultiProviderFeed` class to expose registry-only convenience methods (see Consequences below).
- **Only the composition root** — the Vela class plus the package index — imports concrete backends and wires the swappable defaults. Dependency injection (`deps.renderer` / `deps.engines` / `deps.dataFeed`) is the sanctioned path for supplying concrete backends from outside; it does not breach the ACL, because injected backends flow through the composition root's wiring (overriding the named built-in options) rather than through any core import.
- The scripting dependency may be imported **only in the engine layer**; the bundled renderer library may be imported **only inside its own renderer folder**; a **renderer never imports the scripting dependency**.

More than one renderer adapter ships today — the native default and the secondary/parity adapter — and each is confined to its own renderer folder under the same rule. Because the allowances live in explicit, named exception buckets, **adding a backend (including another renderer) is a deliberate act of extending the ACL** — a visible, reviewable change rather than a quiet new import.

## Consequences / Trade-offs

- **The boundary is real, not aspirational, for the dependencies the ACL covers today** (`pinets`, the bundled renderer library). A forbidden import of those fails lint, so accidental cross-layer coupling there is caught before merge. One exception is unenforced: `core/DataControl.ts` imports the concrete `MultiProviderFeed` class directly (and does `instanceof` checks on it) to expose registry-only convenience methods — a deliberate gap the ACL doesn't cover, since it restricts `pinets`/renderer imports, not concrete backend classes in general.
- **One place to wire defaults.** Concrete backends are imported only at the composition root, keeping every other module backend-agnostic and testable with injected doubles.
- **Intentional extension.** Introducing a new backend forces an explicit ACL edit, which surfaces the architectural impact in review.
- **Some friction.** Contributors occasionally hit a lint error that feels strict; the rule is teaching them the boundary, and the exception buckets document exactly where each dependency is allowed to live.

## Invariant

**Layering is enforced by an ESLint import ACL for the dependencies it covers today (`pinets`, the bundled renderer library): the core otherwise imports no concrete backend, with one narrow, unenforced exception in `DataControl.ts`; only the composition root — the Vela class plus the package index — wires defaults, and dependency injection is the sanctioned external path into that wiring; backend dependencies are confined to their named layers (scripting → engine, renderer library → its own renderer folder, renderer never imports scripting). Adding a backend requires deliberately extending the ACL.**

---

See also: [0001 — Neutral model as the cross-layer currency](./0001-neutral-model-as-cross-layer-currency.md), [0002 — Core owns market data](./0002-core-owns-market-data.md).
