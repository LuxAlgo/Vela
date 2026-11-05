---
name: building-vela-charts
description: Builds financial charts with Vela (@luxalgo/vela) - a full chart app or a multi-chart grid with VelaWorkspace, or the bare Vela chart - fed by offline bars or a data provider (Binance, Coinbase, Hyperliquid or your own), with Pine Script indicators through @luxalgo/vela-pinets, themes, drawings and saved state. Use when adding a candlestick or trading chart to a web app, wiring market data or indicators into Vela, or debugging a Vela chart that stays empty, shows no indicator or loses its state, even if the user only asks for "a trading chart" or "a price chart".
license: Apache-2.0
---

# Building Vela charts

Install `@luxalgo/vela` (its UI kit, `@luxalgo/vela-ui`, comes with it). Vela runs in the
browser: in a server-rendered app, create the chart in client-only code.

## Pick the entry point

| Need | Use |
| --- | --- |
| A chart app: topbar, symbol search, timeframes, indicators, drawings, settings | `VelaWorkspace` from `@luxalgo/vela/workspace` with `layout: false` |
| Several synchronized charts under one chrome | `VelaWorkspace` with `layout: '2h'`, `'4'`, … |
| Only the chart surface, your own UI around it | `Vela` from `@luxalgo/vela` |

Default to `VelaWorkspace`: it is the batteries-included app, and the same options configure
a bare chart.

## A complete chart app

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';

const ws = new VelaWorkspace('#chart', {
    layout: false,                                       // one chart
    symbol: 'BTCUSDT',
    timeframe: '60',                                     // minutes; '4h', '1d', 'D', 'W', 'M' also parse
    live: true,                                          // stream the forming bar
    providers: { binance: () => new BinanceProvider() }, // public API, no key
    theme: 'dark',                                       // or 'light', or a createTheme(...) result
    persist: true,                                       // save layout, indicators, drawings
});
await ws.chart.ready();
```

The container needs a size: give `#chart` a height (the workspace fills it).

## The bare chart, offline

```ts
import { Vela } from '@luxalgo/vela';

// time: the bar's open time in epoch milliseconds
const bars = [{ time: 1730419200000, open: 100, high: 104, low: 99, close: 103, volume: 1200 } /* … */];
const chart = new Vela('#chart', { data: bars, timeframe: '1h', theme: 'dark', height: 480 });
await chart.ready();
```

`data` and provider fetching are exclusive: with `data`, `symbol` is ignored. To fetch instead,
set `symbol` and register a provider: `chart.data.registerProvider('binance', new BinanceProvider())`.

## Indicators

Built-in studies need nothing: `chart.addNativeIndicator('rsi')`, or the Indicators menu in
the workspace. Scripts need an engine, and **Vela ships none**. For Pine Script install
`@luxalgo/vela-pinets` and `pinets`, then:

```ts
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

// workspace: one engine per chart, off the main thread
new VelaWorkspace('#chart', { /* … */ engines: { pine: () => new PineWorkerEngine() } });

// bare chart
chart.registerEngine('pine', new PineWorkerEngine());
const ema = chart.addIndicator(`//@version=5
indicator("EMA", overlay=true)
plot(ta.ema(close, 20))`);
ema.on('ready', () => console.log('computed'));
```

`addIndicator` returns its handle at once; values arrive later (`ready`). Use
`runScript(source)` when you need the computed values and a clean failure instead.

## Rules that prevent the common bugs

1. **An empty chart** usually means no provider serves the symbol (the load waits, the
   `data:unresolved` event fires), or the container has no height.
2. **A script that never shows** means no engine is registered for its language.
3. **Read state through the chart, not from your copies.** `chart.market` is the current
   market; switch it in place with `chart.setMarket({ symbol, timeframe })` (indicators and
   drawings survive), and listen to `market:changed`.
4. **Do not remove the bottom-left Vela mark** unless the page shows an equivalent visible
   attribution ("Vela" linking to the project): the license requires one.
   `chart.renderer.set('attribution', false)` turns it off.
5. **Tear down** with `ws.destroy()` or `chart.destroy()`; call `chart.resize()` after the
   container changes size without a window resize.
6. **Themes**: `createTheme`, `checkTheme` and `registerTheme` come from `@luxalgo/vela`, the
   `css` tag for part restyles from `@luxalgo/vela/ui`; the `theming-vela-ui` skill (shipped
   with `@luxalgo/vela-ui`) covers restyling in depth.

## Check your work

1. `await ws.chart.ready()` (or `chart.ready()`) resolves, and candles are visible.
2. `chart.inspect()` lists the series and drawings the chart generated, a check that does not
   depend on pixels.
3. For indicators, the handle's `ready` event fires and its legend row appears.

## Further reading

The docs ship with the package, matching the installed version:

- `node_modules/@luxalgo/vela/docs/user/workspace.md`: layouts, cells, sync, persistence,
  composing the topbar and the sidebar.
- `node_modules/@luxalgo/vela/docs/user/options.md`: every option.
- `node_modules/@luxalgo/vela/docs/user/api-reference.md`: the chart's methods, events and
  control surfaces (`renderer`, `panes`, `data`, `drawings`, `marks`, `replay`).
- `node_modules/@luxalgo/vela/docs/user/data-providers.md` and
  `docs/contributing/adding-a-data-provider.md`: symbols, venues and writing a provider.
- The `extending-vela-with-plugins` skill adds buttons, menus, panels and chart types.
