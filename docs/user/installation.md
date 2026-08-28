# Installation

Vela™ is published on npm as [`@luxalgo/vela`](https://www.npmjs.com/package/@luxalgo/vela).

## Install from npm

```bash
npm install @luxalgo/vela
```

The package ships ESM, CJS, and type declarations. Import the headless chart from the
root entry, and the other layers from their subpaths:

```js
import { Vela } from '@luxalgo/vela';
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
```

| Entry | What it exports |
|---|---|
| `@luxalgo/vela` | The headless chart core, native renderer, drawings, ports, plugin SDK re-exports. |
| `@luxalgo/vela/workspace` | The full chart app (one chart or a multi-chart grid). |
| `@luxalgo/vela/ui` | The component kit and `KeymapManager`. |
| `@luxalgo/vela/plugin` | The extension SDK (chart types, renderer layers, widget contributions). |
| `@luxalgo/vela/providers/binance` · `/coinbase` · `/hyperliquid` | Ready-made data providers. |

## Browser bundle (script tag)

For script-tag usage without a bundler, the package ships self-contained browser builds:

- `dist/vela.global.js` is the readable development build.
- `dist/vela.global.min.js` is the minified build to reference in production.

Either file attaches the library's public API, including the bundled providers, to
`window.Vela`. Scripting-engine addons (e.g. `vela-pinets.global.js`) load after it and
resolve `@luxalgo/vela` to that same global, so the library is never loaded twice.

## What you install vs. what you supply

Vela™ is built around swappable **layers**. The core is small; you opt into the parts you need.

| Piece | Status | Notes |
|---|---|---|
| **Core + native renderer** | Included, default | Renders candles out of the box. |
| **Scripting engine** | **Not shipped** | Install an addon (Pine Script: `@luxalgo/vela-pinets` + its `pinets` peer) or write one against the port. See [Scripting engines](./scripting-engines.md). Candles work without any. |
| **Provider data feed** | Included | Used when you fetch bars instead of supplying them. |

- **Candles work with zero extra setup.** The native renderer is the default: WebGL2
  with a canvas2d fallback.
- **Indicators are opt-in.** They require a scripting engine (a separate package you
  install) **and** that engine registered on the chart. See
  [Scripting engines](./scripting-engines.md) and [quickstart.md](./quickstart.md).

## Recommended first run

For your first run, use **offline data**: pass an array of bars via the `data` option.
No network, no API key, fully reproducible. See [quickstart.md](./quickstart.md), then
[examples.md](./examples.md) for runnable offline static and live examples.
