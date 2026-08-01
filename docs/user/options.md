# Options

The second argument to `new Vela(container, options, deps?)` configures market data, display, and behavior. Everything here is optional — `new Vela('#chart', { data: myBars })` is enough to render candles.

This vocabulary is shared by all three entry points: the [widget](./widget.md) accepts
every option below verbatim (plus its shell options), and the
[workspace](./workspace.md) accepts them all except `height` — there, each one is the
DEFAULT of every cell, overridable per cell through `cells`.

Per-indicator options (the third argument to `addIndicator`) are covered at the end.

## Market options

How the chart obtains its candles.

| Option | Type | Meaning |
|---|---|---|
| `symbol` | string | Symbol to load — the string is the WHOLE market identity. A **bare** ticker (`'BTCUSDT'`) resolves against the registered providers in **declaration order** (first one whose index lists it); an `EXCHANGE:` prefix (`'coinbase:BTC-USD'`, case-insensitive) **pins** the venue. |
| `timeframe` | string | Bar interval, e.g. `'1h'`. |
| `bars` | number | How many bars of history to load. Depths beyond one ~10k-bar chunk paint the recent window first, then backfill older bars in the background — watch `history:progress` / await `chart.historyComplete()` for the full depth. |
| `visibleRange` | `VisibleRangePreset \| {from,to}` | — | The window to frame on the **first paint** (`'1D'`, `'YTD'`, an explicit range…). The chart then loads its depth in one pass and paints that window straight away, instead of flashing a recent-bars preview and re-framing a moment later. |
| `data` | `OHLCV[]` | **Offline bars.** When set, no network fetch happens. |

> **`data` and provider fetch are mutually exclusive.** Supply `data` to run fully offline (recommended for first runs and tests), or set `symbol`/`timeframe`/`bars` to fetch.
>
> **The fetch path needs a registered provider.** No provider is bundled — register one with [`chart.data.registerProvider(...)`](./data-providers.md); registering it fires the chart's parked initial load. Each bar is `{ time, open, high, low, close, volume? }` with `time` in epoch milliseconds.
>
> With offline `data`, `timeframe` is still honored — it sets bar spacing and axis labels — while `symbol` and `bars` are ignored.

A fetching chart pairs these market options with a registered provider — the display flags ride along in the same object, and registering the provider fires the parked initial load.

```js
import { Vela } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const chart = new Vela('#chart', {
  symbol: 'BTCUSDT',        // bare = first registered provider that lists it; 'binance:BTCUSDT' pins
  timeframe: '1h',
  bars: 500,                // how many bars of history to load
  live: true,               // history + a forming candle on each tick
  theme: 'dark',
  logScale: true,           // logarithmic price scale
  currentPriceLine: true,   // dashed line + axis label at the last price
  upColor: '#26a69a',       // recolor the default cyan/white candles
  downColor: '#ef5350',
});

// registering the provider resolves the symbol and fires the fetch
chart.data.registerProvider('binance', new BinanceProvider());
```

## Display & behavior options

| Option | Type | Default | Notes |
|---|---|---|---|
| `live` | boolean | `false` | `true` adds a forming candle + live ticks on top of history. |
| `theme` | `'dark' \| 'light'` or a theme object | `dark` | Pass an object to fully customize colors/fonts. |
| `renderer` | renderer **class** | native | A renderer class to instantiate; omit for the built-in native renderer (default). The multi-renderer port (`IChartRenderer`) stays open — pass any class implementing it. |
| `defaultLanguage` | string | first registered engine* | Scripting language used when `addIndicator` doesn't name one. Falls back to the first engine registered at construction, then to `'pine'`. |
| `currentPriceLine` | boolean | `true` | Dashed line + axis label at the latest price. |
| `logScale` | boolean | `false` | Logarithmic price scale. |
| `nativeBackend` | `'auto' \| 'canvas2d' \| 'webgl2'` | `auto` | Native geometry backend. `auto` = WebGL2 if available, else canvas2d. Only applies to the native renderer. |
| `animations` | boolean or `{ zoom?, pan? }` | **on** | `true`/`false` toggles all; an object configures each. Defaults: eased zoom on, inertial pan on (short snappy glide). `{ pan: false }` = instant pan. |
| `glow` | number | `0` | Neon glow/bloom for line series (~0.6 = strong). **WebGL2 only** — ignored on canvas2d. |
| `upColor` | string | `#089981` (green) | Bullish candle color (native renderer). |
| `downColor` | string | `#f23645` (red) | Bearish candle color (native renderer). |
| `priceStyle` | `'candles' \| 'bars' \| 'line' \| 'area' \| 'baseline'` | `'candles'` | How the base price series is drawn (native renderer). |
| `drawings` | `boolean \| { toolbar?, tools?, groups? }` | **toolbar shown** | Interactive [drawing tools](./drawing-tools.md). `true`/omitted ⇒ toolbar visible; `false` ⇒ toolbar hidden (the `chart.drawings` API still works headlessly); object customizes it (see below). Capability-gated (native renderer only). |

\* `defaultLanguage` falls back to the first injected engine's language if you don't set it.

Leave `renderer` off for the built-in native backend; a custom renderer class (implementing `IChartRenderer`) can be passed to swap the whole rendering backend.

### The `drawings` option

By default the drawing toolbar is **shown** (on a renderer that supports it). Pass `false` to hide
the bar while still driving drawings from code, or an object to customize which tools appear:

| Field | Type | Effect |
|---|---|---|
| `toolbar` | boolean | Show/hide the bar (default `true`). |
| `tools` | `DrawingTypeKey[]` | Allow-list of tools; each is bucketed into its own group. |
| `groups` | `{ id, label, tools }[]` | Explicit, custom-labelled groups (unregistered/empty groups are dropped). |

```js
// hide the bar but keep the programmatic API:
new Vela('#chart', { data: bars, drawings: false });

// only a few tools:
new Vela('#chart', { data: bars, drawings: { tools: ['trendline', 'hline', 'box'] } });
```

See [Drawing tools](./drawing-tools.md) for the full catalogue and the `chart.drawings` API.


### Non-obvious defaults, called out

- **Animations are on** by default (eased zoom, snappy inertial pan).
- **The current-price line is on** by default.
- **The price scale is linear** by default (`logScale: false`).

Instead of `'dark'`/`'light'`, pass a full theme object to control every color and the font — all seven fields are required:

```js
const midnight = {
  background:  '#0b0e14',
  textColor:   '#c9d1d9',
  gridColor:   '#1c2230',
  borderColor: '#30363d',
  upColor:     '#3fb950',
  downColor:   '#f85149',
  fontFamily:  'Inter, system-ui, sans-serif',
};

new Vela('#chart', { data: bars, theme: midnight });
```

### Capability-gated options

Some options only take effect when the active backend supports them. **`glow` is WebGL2-only** — it is silently ignored on the canvas2d backend. If you force `nativeBackend: 'canvas2d'`, glow has no effect.

A native-renderer styling combo: draw price as a glowing line on the GPU backend and make panning instant while keeping the eased zoom.

```js
new Vela('#chart', {
  data: bars,
  priceStyle: 'line',                 // candles | bars | line | area | baseline
  nativeBackend: 'webgl2',            // force the GPU backend
  glow: 0.6,                          // neon bloom on line series (WebGL2 only)
  animations: { zoom: true, pan: false }, // eased zoom, no pan momentum
});
```

---

## Per-indicator options

The optional second argument to `addIndicator(source, options)`:

| Option | Type | Meaning |
|---|---|---|
| `language` | string | Which registered engine runs this script. Defaults to the chart's `defaultLanguage`. |
| `inputs` | `Record<string, InputValue>` | Input overrides, keyed by input title or key. |
| `overlay` | boolean | Force overlay vs. separate pane. Default: read from `indicator(overlay=…)`. |
| `pane` | `'price' \| 'new'` | Explicit pane placement. |
| `title` | string | Display title override. |

See [api-reference.md](./api-reference.md) for the `IndicatorHandle` you get back, and [quickstart.md](./quickstart.md) for the end-to-end flow.
