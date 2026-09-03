# Options

The second argument to `new Vela(container, options, deps?)` configures market data, display, and behavior. Everything here is optional — `new Vela('#chart', { data: myBars })` is enough to render candles.

This vocabulary is shared with the [workspace](./workspace.md), which accepts every
option below except `height` (plus its shell options) — there, each one is the DEFAULT
of every cell, overridable per cell through `cells`.

Per-indicator options (the third argument to `addIndicator`) are covered at the end.

## Market options

How the chart obtains its candles.

| Option | Type | Meaning |
|---|---|---|
| `symbol` | string | Symbol to load — the string is the WHOLE market identity. A **bare** ticker (`'BTCUSDT'`) resolves against the registered providers in **declaration order** (first one whose index lists it); an `EXCHANGE:` prefix (`'coinbase:BTC-USD'`, case-insensitive) **pins** the venue — a registered provider name, or a [listing prefix](./data-providers.md#listing-prefixes-nasdaqaapl) a provider's index declares (`'NASDAQ:AAPL'`, strict: a wrong venue resolves to nothing). |
| `timeframe` | string | Bar interval, e.g. `'1h'`. |
| `session` | `'regular' \| 'extended'` | Trading session to show, on markets that have one (`regular` = RTH, the default; `extended` = pre/post-market included). The flag rides every data request — providers without a session concept ignore it. Switch at runtime with `chart.setMarket({ session })` or the bottombar's RTH/ETH toggle. |
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
import { Vela } from '@luxalgo/vela';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';

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
| `settings` | `{ hidden?: string[] }` | **all visible** | Chart-settings dialog visibility policy: setting ids to hide — a whole tab, a group, or a single row (see below). |

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

### The `settings` option — hiding settings-dialog entries

By default the chart-settings dialog shows everything. `settings.hidden` lists setting
**ids** to hide; an id hides its whole subtree, and a tab with nothing left disappears
from the rail:

```js
new VelaWorkspace('#chart', {
  layout: false,
  bars: 1000,                                  // force the fetch depth…
  settings: { hidden: ['advanced'] },          // …and remove the tab that would change it
});

// or a finer cut: one group, one row
new Vela('#chart', { data: bars, settings: { hidden: ['canvas.grid', 'scales.price-scale.countdown'] } });
```

Hiding is **display-only**: hidden values keep being stored, delivered, and applied —
which is exactly what makes "force an option, hide its control" work. The policy is
instance state, not chart config: it never rides `getConfig()`/`applyConfig()` into
exported templates. It can also be set at runtime with
`chart.renderer.setSettingsVisibility({ hidden: [...] })`.

Ids are dot-separated paths: `<tab>`, `<tab>.<group>`, `<tab>.<group>.<row>`. Enumerate
every addressable id of a live chart with `chart.renderer.listSettingsIds()` (plugin
chart types and host-app sections included).

The complete catalog — every id, at every depth. Any subset works; a parent id makes
its children redundant:

```js
new VelaWorkspace('#chart', {
  settings: {
    hidden: [
      // ══ Symbol tab ════════════════════════════════════════════════
      'symbol',                              // the whole tab
      'symbol.type',                         //   the Type select (chart style)
      'symbol.style.candles',                //   Candles group (also styles Heikin Ashi)
      'symbol.style.candles.body',           //     Body toggle + up/down colors
      'symbol.style.candles.borders',        //     Borders toggle + colors
      'symbol.style.candles.wick',           //     Wick toggle + colors
      'symbol.style.candles.spacing',        //     Spacing
      'symbol.style.bars',                   //   Bars group
      'symbol.style.bars.up-color',          //     Color Up
      'symbol.style.bars.down-color',        //     Color Down
      'symbol.style.bars.spacing',           //     Spacing
      'symbol.style.line',                   //   Line group
      'symbol.style.line.color',             //     Color
      'symbol.style.line.width',             //     Width
      'symbol.style.area',                   //   Area group
      'symbol.style.area.line-color',        //     Line color
      'symbol.style.area.width',             //     Width
      'symbol.style.area.top-fill',          //     Top fill
      'symbol.style.area.bottom-fill',       //     Bottom fill
      'symbol.style.baseline',               //   Baseline group
      'symbol.style.baseline.top-line',      //     Top line
      'symbol.style.baseline.bottom-line',   //     Bottom line
      'symbol.style.baseline.fill-top',      //     Fill top area
      'symbol.style.baseline.fill-bottom',   //     Fill bottom area
      'symbol.style.baseline.base-level',    //     Base level %
      'symbol.style.baseline.width',         //     Width
      'symbol.timezone',                     //   Time zone group

      // ══ Scales and lines tab ══════════════════════════════════════
      'scales',                              // the whole tab
      'scales.price-scale',                  //   Price scale group
      'scales.price-scale.mode',             //     Regular/Percent/Indexed/Logarithmic
      'scales.price-scale.invert',           //     Invert scale
      'scales.price-scale.last-price-line',  //     Last Price Line
      'scales.price-scale.last-price-label', //     Last price label
      'scales.price-scale.countdown',        //     Countdown to bar close
      'scales.price-scale.axis-labels',      //     Axis labels
      'scales.price-scale.border-color',     //     Scale border color
      'scales.crosshair',                    //   Crosshair group
      'scales.crosshair.color',              //     Color
      'scales.crosshair.width',              //     Width
      'scales.crosshair.style',              //     Solid/Dashed/Dotted

      // ══ Canvas tab ════════════════════════════════════════════════
      'canvas',                              // the whole tab
      'canvas.background',                   //   Background & text group
      'canvas.background.color',             //     Background
      'canvas.background.text-color',        //     Text color
      'canvas.background.text-size',         //     Text size
      'canvas.background.pane-separator',    //     Pane separator color
      'canvas.grid',                         //   Grid group
      'canvas.grid.vertical',                //     Vertical lines toggle + color
      'canvas.grid.horizontal',              //     Horizontal lines toggle + color
      'canvas.theme',                        //   Theme group (Dark/Light)

      // ══ Widget & workspace tabs (shell-contributed) ═══════════════
      'status-line',                         // the whole Status line tab
      'status-line.parts',                   //   Status line group (the five rows below)
      'status-line.logo',                    //     Symbol logo
      'status-line.name',                    //     Symbol name
      'status-line.market',                  //     Market status
      'status-line.ohlc',                    //     OHLC values
      'status-line.change',                  //     Bar change values
      'status-line.indicators',              //   Indicators group (the two rows below)
      'status-line.indicator-titles',        //     Titles
      'status-line.indicator-values',        //     Values
      'advanced',                            // the whole Advanced tab
      'advanced.bars',                       //   Bars to fetch
      'trading-session',                     // the RTH/ETH group in the Symbol tab
      'trading-session.session',             //   Session select
      'trading-session.premarket-color',     //   Pre-market shading color (day-split markets)
      'trading-session.postmarket-color',    //   Post-market shading color (day-split markets)
      'trading-session.extended-color',      //   Extended-hours shading color (overnight markets)
      'watermark',                           // the Symbol watermark toggle
      'watermark.visible',                   //   (same row — the group has one row)

      // ══ Plugin chart types (registerChartType) ════════════════════
      'type:<chartTypeId>',                  // the type's settings tab (+ its subsections)
      'type:<chartTypeId>.<key>',            //   a value row, by its settings bag key
      'type:<chartTypeId>.<heading-slug>',   //   a group, by its heading label's slug
      'type:<chartTypeId>.<subsection-slug>',//   a subsection, by its title's slug
      'symbol.style.<chartTypeId>',          // a candle-drawn plugin style's Candles group
                                             //   (rows: .body, .borders, .wick, .spacing)

      // ══ Host sections (setSettingsSections) ═══════════════════════
      '<sectionId>',                         // the section's `id` field, else its title's slug
      '<sectionId>.<rowId>',                 //   a row's `id` field, else its label's slug
    ],
  },
});
```

Conditional entries hide-and-stay-hidden: `trading-session` only appears on symbols
that have sessions, `status-line` only when the shell's status line is on,
`canvas.theme` only when the host wires the theme switch — hiding them is safe either
way. Host sections contributed through `setSettingsSections` need nothing from the
contributor: the `id` fields are optional stability aids, label slugs are the
fallback.

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

The theme can also be swapped at runtime — `chart.setTheme('light')` (or a full theme
object) re-skins the chart live and emits `theme:changed` so your surrounding UI can
follow; users reach the same switch in chart settings → Canvas → Theme. The built-in
dark and light themes share the same candle colors, so switching never recolors the
series. Setting only a background color through the settings dialog (or `applyConfig`)
keeps the app theme: when that background lands in the other luminance class (a white
plot on the dark theme), the derived inks — text, grid, axis border — re-base
automatically so legends and axis labels stay readable, while any explicitly chosen
text color wins.

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
| `props` | `Record<string, InputValue>` | Declaration-property overrides (a strategy's `initial_capital`, an indicator's `precision`, …), keyed like the engine's props schema. Ignored by engines without props support. |
| `overlay` | boolean | Force overlay vs. separate pane. Default: read from `indicator(overlay=…)`. |
| `pane` | `'price' \| 'new'` | Explicit pane placement. |
| `title` | string | Display title override. |

See [api-reference.md](./api-reference.md) for the `IndicatorHandle` you get back, and [quickstart.md](./quickstart.md) for the end-to-end flow.
