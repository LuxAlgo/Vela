# Vela

A fast, extensible financial charting library with its own native canvas renderer, a
headless core, a batteries-included widget, and a plugin SDK for custom chart types and
renderer layers.

- **`vela`** — the headless chart: data model, engines, drawings, providers, native renderer.
- **`vela/widget`** — the full chart app: topbar (symbol / timeframe / style / indicators),
  status line, watermark, bottom bar (ranges, clock, timezone), object tree, keyboard-first UX.
- **`vela/ui`** — the component kit the widget is built on (design tokens + headless
  [Zag.js](https://zagjs.com) machines + vanilla views) and the `KeymapManager`.
- **`vela/plugin`** — the extension SDK: chart types, renderer layers, native indicators.
- **`vela/workspace`** — the multi-chart shell: a grid of full charts under one shared
  topbar, with named cells, sync groups and one persisted state document.
- **`vela/providers/*`** — data providers (Binance, Coinbase, Hyperliquid).

## Quick start

```ts
import { VelaWidget } from 'vela/widget';
import { BinanceProvider } from 'vela/providers/binance';

const widget = new VelaWidget('#chart', {
    symbol: 'BTCUSDT', // bare = first declared provider listing it; 'binance:BTCUSDT' pins the venue
    timeframe: '60',
    live: true,
    theme: 'dark',
    providers: { binance: () => new BinanceProvider() },
    persist: true,   // restore the full state document — market, style, timezone, renderer
                     // config, drawings and indicators — from localStorage
    urlState: true,  // ?symbol=…&interval=… shareable links
});
```

Prefer full control? Use the headless core directly:

```ts
import { Vela } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const chart = new Vela('#chart', { symbol: 'binance:BTCUSDT', timeframe: '60', live: true });
chart.data.registerProvider('binance', new BinanceProvider());
await chart.ready();
```

## Indicators

Vela runs indicator scripts through pluggable engines and **ships none** — install the
addon for the language you want, or write one against the public `ScriptingEngine` port.
Pine Script lives in [`@luxalgo/vela-pinets`](https://github.com/LuxAlgo/Vela-pinets)
(`npm i @luxalgo/vela-pinets pinets`), which is **AGPL-3.0** because the PineTS runtime it
executes is — Vela itself stays Apache-2.0 and carries no Pine code:

```ts
import { PineEngine } from '@luxalgo/vela-pinets';

chart.registerEngine('pine', new PineEngine());
chart.addIndicator(`//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`);
```

Host tooling can execute-and-inject safely (`chart.runIndicator(source)` — structured
errors, no dead legend rows) and read a running script's state — including its **return
value** — via `handle.context()` (read-only snapshots, worker-safe). See the
[API reference](docs/user/api-reference.md#reading-a-scripts-execution-context), and
[Scripting engines](docs/user/scripting-engines.md) for the addon and for writing your own.

The widget takes an **indicator manifest** — inline JSON, a URL returning it, or an async
loader (`() => Promise<manifest>`):

```ts
new VelaWidget('#chart', {
    // …
    engines: { pine: () => new PineEngine() },
    indicators: '/indicators.json', // or an inline [{ name, script | url, language?, enabled? }]
});
```

## Keyboard

Type a **letter** → symbol search. Type a **digit** → timeframe entry (`15`, `4h`, `D`, `3M`…).
`mod+alt+S` (Ctrl+Alt+S, ⌥⌘S on macOS) → screenshot. `?` → the shortcuts panel. Bindings are declarative
(`widget.keymap.register({...})`) — plugins register theirs the same way.

## Extending (plugin SDK)

```ts
import { registerChartType, registerRendererLayer } from 'vela/plugin';

// A new price style: bar transform + optional per-bar data engine + ticker modifier.
registerChartType({
    id: 'renko-like',
    label: 'Renko-like',
    barTransform: { full: (bars) => transformAll(bars), next: (bar) => transformOne(bar) },
});

// A custom canvas layer, painted every frame with the chart (its id = its data channel).
registerRendererLayer({
    id: 'renko-like',
    placement: 'above-data',
    create: () => ({ mount(canvas) {/* keep it */}, render({ bars, data, coords, scale, bounds }) {/* paint */} }),
});
```

A registered chart type automatically appears in the widget's style dropdown; a chart
type's `dataEngine` pushes to its layer's channel with zero extra wiring. See
[docs/contributing/plugin-sdk.md](docs/contributing/plugin-sdk.md).

## Documentation

Full documentation lives in [docs/](docs/index.md) — user guides ([quickstart](docs/user/quickstart.md),
[the widget](docs/user/widget.md), [options](docs/user/options.md), [API reference](docs/user/api-reference.md)),
[architecture](docs/architecture/overview.md), and [contributing](docs/contributing/setup.md) guides
including the [plugin SDK](docs/contributing/plugin-sdk.md).

## Development

```bash
npm install
npm run playground   # vite playground on http://localhost:5190
npm test             # vitest
npm run build        # tsup → dist/
```

## License

Apache-2.0 **with a mandatory attribution notice** (see [NOTICE](NOTICE)): charts render
a small Vela attribution mark by default; it may be disabled
(`chart.renderer.set('attribution', false)`) only if an equivalent visible attribution —
"Vela" linking to the project page — is shown elsewhere on the same page. This is the
same licensing model as other popular charting libraries.

No scripting engine ships with this package; the Pine Script addon
(`@luxalgo/vela-pinets`) is AGPL-3.0 and licensed separately (see *Indicators*).
