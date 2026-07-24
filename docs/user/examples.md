# Examples

Two runnable examples ship with Vela, plus an interactive playground. **Both examples use offline OHLCV** — no network, no API key — so they run anywhere out of the box.

> These snippets import from `'vela'`, the local from-source workspace package — see [installation.md](./installation.md).

## Orientation snippet

The shape of every example is the same: create a chart over offline data, register the Pine engine, add an indicator.

```js
import { Vela, PineEngine } from 'vela';

const chart = new Vela('#chart', { data: myBars, timeframe: '1h', live: false, theme: 'dark' });
chart.registerEngine('pine', new PineEngine());

chart.addIndicator(`//@version=5
indicator("EMA", overlay=true)
plot(ta.ema(close, input.int(20, "Length")), "EMA", color.orange)`);
```

With offline `data`, `timeframe` only drives bar spacing and axis labels; there is no fetch.

## A fully-featured setup

Everything in one place — a provider-backed, live chart with a custom theme, the GPU backend, drawing tools, a scripting indicator, runtime tweaks, and events. Swap `provider`/`symbol` for `data: myBars` to run the same thing offline (minus the live feed).

**Construct** with the full option set:

```js
import { Vela, PineEngine } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

// A full custom theme — all seven fields are required.
const theme = {
  background:  '#0b0e14',
  textColor:   '#c9d1d9',
  gridColor:   '#1c2230',
  borderColor: '#30363d',
  upColor:     '#26a69a',
  downColor:   '#ef5350',
  fontFamily:  'Inter, system-ui, sans-serif',
};

const chart = new Vela('#chart', {
  // market — provider-backed (use `data: myBars` instead to run offline)
  provider: 'binance',
  symbol: 'BTCUSDT',
  timeframe: '1h',
  bars: 1000,
  live: true,
  // appearance
  theme,
  upColor: '#26a69a',           // candle colors live at the TOP level (the theme's up/down don't reach the candles)
  downColor: '#ef5350',
  priceStyle: 'candles',        // candles | bars | line | area | baseline
  currentPriceLine: true,
  logScale: false,
  glow: 0.4,                    // WebGL2 only
  // backend + motion
  nativeBackend: 'webgl2',      // auto | canvas2d | webgl2
  animations: { zoom: true, pan: false },
  // interactive layers
  drawings: { toolbar: true, tools: ['trendline', 'hline', 'ray', 'box', 'text'] },
  // scripting
  defaultLanguage: 'pine',
});
```

**Wire up** the provider, engine, an indicator, runtime tweaks, and events:

```js
// Neither a provider nor an engine is bundled; registerEngine is chainable.
chart.data.registerProvider('binance', new BinanceProvider());
chart.registerEngine('pine', new PineEngine());

await chart.data.ready(); // provider symbol index settled
await chart.ready();      // chart painted and interactive

// A Pine indicator in its own pane — the handle is usable synchronously.
const rsi = chart.addIndicator(
  `//@version=5
indicator("RSI")
plot(ta.rsi(close, input.int(14, "Length")), "RSI", color.purple)`,
  { pane: 'new', title: 'RSI (14)' }, // AddIndicatorOptions: language / inputs / overlay / pane / title
);
rsi.on('ready', () => console.log(rsi.title, '→', rsi.inputs.length, 'inputs'));
rsi.on('error', ({ error }) => console.error('RSI failed:', error.message));


// Chart-level events.
chart.on('bar', (bar) => { /* the forming bar updated or a new bar appended */ });
chart.on('indicator:error', ({ id, error }) => console.error(id, error.message));

// Runtime appearance — no rebuild, no indicator re-run.
if (chart.renderer.supports('glow')) chart.renderer.set('glow', 0.6);
chart.renderer.set({ logScale: true, gridlines: true, timezone: 'America/New_York' });

// Frame a preset range, then read the exact window back.
chart.setVisibleRangePreset('3M');
const range = chart.getVisibleRange(); // { from, to } in epoch-ms (non-null after ready)

// Programmatic drawing + JSON round-trip.
if (range && chart.drawings.supported) {
  chart.drawings.add('trendline', {
    paneId: 'price',
    anchors: [{ time: range.from, price: 30000 }, { time: range.to, price: 40000 }],
  });
  const saved = chart.drawings.toJSON(); // chart.drawings.fromJSON(saved) restores it
}

// Export a PNG snapshot; tear everything down when done.
const png = chart.renderer.screenshot(); // PNG data URL, or null if unsupported
// chart.destroy();
```

Every option above is documented in [options.md](./options.md); every method and event in [api-reference.md](./api-reference.md).

## The two examples

| Example | What it shows |
|---|---|
| **Static** | History only: candles plus several indicators (EMA, MACD, RSI, bands with fills/markers/bgcolor) over offline bars. |
| **Live** | The same setup with a forming candle and indicators recomputing on each (locally synthesized) tick. |

> **The only meaningful difference between them is the `live` flag.** The static example passes `live: false`; the live example passes `live: true` and listens on `chart.on('bar', …)` to count ticks. Same data path, same engine registration, same `addIndicator` calls.

## Adding drawings from code

The drawing toolbar is interactive by default; you can also place drawings programmatically and round-trip them through JSON:

```js
chart.drawings.add('trendline', {
    paneId: 'price',
    anchors: [
        { time: myBars[10].time, price: myBars[10].low },
        { time: myBars[40].time, price: myBars[40].high },
    ],
});

const saved = chart.drawings.toJSON(); // persist this however you like
chart.drawings.fromJSON(saved);        // …and restore it later
```

See [drawing-tools.md](./drawing-tools.md) for the full tool catalogue and toolbar UX.

## Playground

The in-repo **playground** (`npm run playground`) mounts the full Vela widget against live Binance data straight from the source — edit `playground/main.ts` to try options, providers, or your own indicator manifest. Press `?` in the widget for the shortcut list.

## Next steps

- New to the API? Start at [quickstart.md](./quickstart.md).
- Tuning behavior or appearance? See [options.md](./options.md).
- Full surface and events? See [api-reference.md](./api-reference.md).
