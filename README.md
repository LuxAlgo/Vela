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
- **`vela/providers/*`** — data providers (Binance, Coinbase, Hyperliquid).

## Quick start

```ts
import { VelaWidget } from 'vela/widget';
import { BinanceProvider } from 'vela/providers/binance';

const widget = new VelaWidget('#chart', {
    provider: 'binance',
    symbol: 'BTCUSDT',
    timeframe: '60',
    live: true,
    theme: 'dark',
    providers: { binance: () => new BinanceProvider() },
    persist: true,   // restore symbol/timeframe/style/timezone from localStorage
    urlState: true,  // ?symbol=…&interval=… shareable links
});
```

Prefer full control? Use the headless core directly:

```ts
import { Vela } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const chart = new Vela('#chart', { provider: 'binance', symbol: 'BTCUSDT', timeframe: '60', live: true });
chart.data.registerProvider('binance', new BinanceProvider());
await chart.ready();
```

## Indicators

Vela runs indicator scripts through pluggable engines. The Pine engine uses
[PineTS](https://github.com/LuxAlgo/PineTS) — an **optional peer dependency licensed
under AGPL-3.0** (Vela itself is Apache-2.0; installing `pinets` applies its own license
to your bundle):

```ts
import { Vela, PineEngine } from 'vela';

chart.registerEngine('pine', new PineEngine());
chart.addIndicator(`//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`);
```

Host tooling can execute-and-inject safely (`chart.runIndicator(source)` — structured
errors, no dead legend rows) and read a running script's state — including its **return
value** — via `handle.context()` (read-only snapshots, worker-safe). See the
[API reference](docs/user/api-reference.md#reading-a-scripts-execution-context).

The widget takes an **indicator manifest** — inline JSON or a URL returning it:

```ts
new VelaWidget('#chart', {
    // …
    engines: { pine: () => new PineEngine() },
    indicators: '/indicators.json', // or an inline [{ name, script | url, language?, enabled? }]
});
```

## Keyboard

Type a **letter** → symbol search. Type a **digit** → timeframe entry (`15`, `4h`, `D`, `3M`…).
`alt+S` → screenshot. `?` → the shortcuts panel. Bindings are declarative
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

The optional `pinets` peer dependency is AGPL-3.0 (see *Indicators*).
