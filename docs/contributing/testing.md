# Testing

Vela™ is tested in **two tiers**. They cover different things and run in different places; both matter.

- **Tier 1 — Node unit tests** (vitest, fast): the bulk of the suite.
- **Tier 2 — browser smoke test** (playground, end-to-end): real indicators through a real renderer.

## Tier 1 — fast Node unit tests

These run under vitest in Node, with no browser. Run them once with **`npm test`**, or in watch mode with **`npm run test:watch`**. They are fast and form the bulk of the suite. They cover:

- **Pure logic** — the deterministic pieces of the core that need no renderer and no browser.
- **The three port contracts** — the behavior each layer promises across the `MarketDataFeed`, `ScriptingEngine`, and `IChartRenderer` boundaries.

### Port contracts use test doubles via dependency injection

The ports exist precisely so the core can be exercised without real backends. The tests lean on this through the **dependency-injection constructor**, substituting:

- a **fake renderer** in place of a real one,
- a **fake worker that records the messages it receives**, so the worker request/response protocol can be asserted without a real worker, and
- **injected fake feeds** that hand the core whatever bars a scenario needs.

Because the only thing crossing a port is the neutral model, a double only has to honor the contract — it never needs backend-specific behavior.

### Engine output is pinned with captured fixtures

Scripting-engine output is verified against **captured JSON fixtures**. The rule:

> **Regenerate fixtures deliberately; never hand-edit them.**

A fixture is a recorded, trusted run. Editing one by hand quietly changes what "correct" means and defeats the test. When engine behavior legitimately changes, regenerate the fixture as an intentional step and review the diff.

### The inlined worker is stubbed

The browser bundle inlines the worker (see [setup.md](./setup.md#two-artifacts-from-one-source)), which is not appropriate to load in Node. In the unit suite the inline-worker import is **stubbed**, and worker behavior is driven through the fake worker described above. This keeps the worker's port contract testable without a real worker thread.

## Tier 2 — browser smoke testing

This is the end-to-end tier: **real indicators run all the way through the playground** in a real browser with a real renderer. It is the check that the whole pipeline — feed to engine to neutral model to renderer — actually produces the right picture.

- **Today it is MANUAL.** You run it by hand in the playground (`npm run playground`) and look at the result.
- The **intended direction is an automated harness** for these runs. Treat manual smoke testing as the current state, not the end state.

The playground serves the **source directly** (vite): `npm run playground`, then exercise the change live — no build step. See [workflow.md](./workflow.md#the-playground).

## Which tier for which change

- Logic in the core, or a port contract: **Tier 1**. Add or update unit tests with the appropriate test double.
- Anything you need to *see* render — a new indicator, a renderer change, an interaction: **Tier 2**, after rebuilding the bundle.
- A change to engine output: update the relevant **fixture** (regenerate, don't edit) and smoke-test the affected indicator.

For isolating *why* a test or smoke run is wrong, see [debugging.md](./debugging.md).
