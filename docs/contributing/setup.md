# Local Setup

This page gets you from a fresh clone to a working Vela build. You install and build it **from source**.

## Prerequisites

- **Node.js and npm.** There is no pinned Node version in this repo (no `.nvmrc`, no `engines` range), so a current Node.js LTS and its bundled npm is the safe choice. If a pin is added later, treat that as the source of truth.
- **No scripting-engine dependency.** Vela ships no engine and has none installed here: engines are separate packages behind the `ScriptingEngine` port (Pine Script: `@luxalgo/vela-pinets`). The playground carries its own tiny demo engine (`playground/demo-engine.ts`) so the indicator path is exercisable with zero extra installs.

> **Standing rule:** Do **not** edit a sibling package (the engine addon, or any other) from within Vela work without explicit permission. Concurrent edits across packages cause conflicts. If a change seems to require touching a sibling, stop and ask first. See [workflow.md](./workflow.md) for where changes belong by layer.

## Clone and install

1. Clone the repository.
2. Install Vela's dependencies with `npm install`. Everything resolves normally from the npm registry — no sibling checkout or extra build step is required.

That is the whole bootstrap. Everything else is a thin npm script.

## The toolchain

Vela keeps a deliberately thin set of npm scripts. Each maps to one well-known tool, so there is little bespoke build machinery to learn.

| Task | Command | What it does |
| --- | --- | --- |
| **build** | `npm run build` | Bundles the library and the browser bundle (tsup). |
| **dev** / watch | `npm run dev` | Rebuilds on change (tsup `--watch`) for tight iteration. |
| **typecheck** | `npm run typecheck` | Type-checks the source with no emit (tsc `--noEmit`). |
| **lint** | `npm run lint` | Lints the source (eslint). This also enforces the architecture boundaries. |
| **test** | `npm test` | Runs the fast Node unit suite once (vitest). |
| **test:watch** | `npm run test:watch` | Re-runs the unit suite on change (vitest). |
| **playground** | `npm run playground` | Serves `playground/` (vite, `http://localhost:5190`, no build step, HMR). The index links two pages mounting straight from `src/`: `/widget.html` (the single-chart widget) and `/workspace.html` (the multi-chart workspace). The Binance provider talks to the public API directly, so no server is needed. |

> One npm quirk worth internalizing: **`test` runs as `npm test`**, while everything else needs the `run` keyword (`npm run build`, `npm run lint`, and so on).

The four scripts that define "done" — **typecheck, lint, test, build** — are covered in [workflow.md](./workflow.md). Testing tiers are in [testing.md](./testing.md). Hands-on debugging is in [debugging.md](./debugging.md).

## Two artifacts from one source

A single source tree produces **two different build artifacts**, and knowing which is which prevents a lot of confusion:

- **The library build** is what application code consumes. It ships ESM, CJS, and type definitions, and **externalizes the backends** (the scripting engine and the renderer dependency are left as external imports rather than inlined). Externalized does **not** mean the consumer must hand-wire those backends: the renderer dependency remains a **required runtime dependency** that the consumer's package manager resolves normally, and the default backends still wire themselves automatically through the composition root. You only supply your own backend when you deliberately want to replace a default (see [workflow.md](./workflow.md#where-to-make-a-change-by-layer)).
- **The self-contained browser bundle** is a single IIFE that **bundles everything** — the renderer dependency, the scripting engine, and the **inlined worker** — and exposes the library as a global (`window.Vela`).

The **playground serves `src/` directly** (vite): changes appear on save with no build step. The browser bundle exists for CDN-style consumers of the library, not for development.
