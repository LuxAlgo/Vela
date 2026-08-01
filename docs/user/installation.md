# Installation

Vela is built and used **from source** as a local workspace package. Build it in its own package folder inside the repo, then consume the built output from your app.

## Install from source

Vela lives in its own package folder inside the repo. Build it there, then consume the built output from your app (or develop against it in-repo).

```bash
# from the Vela package folder in the LuxAlgo repo
npm install
npm run build
```

The build produces the library artifact (ESM + CJS + type declarations). Point your app at that package via your monorepo's normal local-dependency mechanism (workspace link or a `file:` reference).

Once it is linked, import from the package's local name — that is the specifier used throughout these docs:

```js
import { Vela } from 'vela';
```

This is the local workspace package, not an npm download — the `'vela'` specifier resolves to the from-source build you just linked.

## What you install vs. what you supply

Vela is built around swappable **layers**. The core is small; you opt into the parts you need.

| Piece | Status | Notes |
|---|---|---|
| **Core + native renderer** | Included, default | Renders candles out of the box. |
| **Scripting engine** | **Not shipped** | Install an addon (Pine Script: `@luxalgo/vela-pinets` + its `pinets` peer) or write one against the port — see [Scripting engines](./scripting-engines.md). Candles work without any. |
| **Provider data feed** | Included | Used when you fetch bars instead of supplying them. |

- **Candles work with zero extra setup.** The native renderer is the default — WebGL2 with a canvas2d fallback.
- **Indicators are opt-in.** They require a scripting engine — a separate package you install — **and** that engine registered on the chart. See [Scripting engines](./scripting-engines.md) and [quickstart.md](./quickstart.md).

## Two build artifacts

Vela can be built two ways depending on how you consume it:

- **Library build** — ESM + CJS + types, with backends kept external. Use this when bundling Vela into your own app and managing dependencies yourself.
- **Self-contained browser bundle** — a single file that inlines its dependencies (including the scripting engine and its worker) and attaches `Vela` to `window`. Use this to drop Vela into a page or for quick browser testing.

The in-repo playground consumes the **browser bundle**, so rebuild that bundle before browser-testing changes.

## Recommended first run

For your first run, use **offline data** — pass an array of bars via the `data` option. No network, no API key, fully reproducible. See [quickstart.md](./quickstart.md), then [examples.md](./examples.md) for runnable offline static and live examples.

> **Renderer packaging:** the native renderer is built in — the default needs nothing extra. The self-contained browser bundles inline everything, including the worker engine: `vela.global.js` is the readable development build, `vela.global.min.js` the minified one to reference in production.
