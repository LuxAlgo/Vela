# Renderer features

`chart.renderer` is the control surface for the active renderer — read and change **how
the chart is drawn** at runtime, with **no indicator re-run**.

```js
chart.renderer.set('logScale', true); // one feature
chart.renderer.set({ upColor: '#fff', glow: 0.6 }); // several at once → one repaint
chart.renderer.get('logScale'); // read the current value
chart.renderer.supports('glow'); // is it available on this renderer?
chart.renderer.name; // 'native'
chart.renderer.capabilities; // what the renderer can draw
```

A key the active renderer **doesn't support emits a console warning and is ignored** — the
chart is never touched. Use `supports()` to check first (e.g. to hide a UI control on a
renderer that lacks the feature).

These are the **same keys** you can pass at construction (as [options](./options.md));
setting them through `chart.renderer.set` applies them **live** instead of rebuilding the
chart — so toggling them never re-executes your indicators.

## Common features

Available on every renderer:

| Feature | Type | Default | Notes |
|---|---|---|---|
| `logScale` | boolean | `false` | Logarithmic price scale on the price pane. |
| `currentPriceLine` | boolean | `true` | The dashed line at the latest price. The axis label is a separate feature — see `priceLabel` (native renderer). |
| `upColor` | color string | `#089981` | Bullish candle body/wick color. |
| `downColor` | color string | `#f23645` | Bearish candle body/wick color. |

## Native renderer

`name === 'native'`. Supports every common feature, plus its own. They group into
**appearance**, **interaction**, **axes & scale**, and **in-chart UI**.

### Appearance

| Feature | Type | Default | Notes |
|---|---|---|---|
| `glow` | number (0 – ~0.7) | `0` | Neon glow/bloom on line series. **WebGL2 only** — the canvas2d backend stores the value but draws no glow. |
| `priceStyle` | `'candles' \| 'bars' \| 'line' \| 'area' \| 'baseline'` | `'candles'` | How the base price series is drawn. (Heikin Ashi is not yet available.) |
| `priceBaseline` | number \| `null` | `null` | Reference price for `priceStyle: 'baseline'`. `null` derives it from the config's `baseline.baselineLevel` (a percent of the visible pane range). |
| `baselinePrice` | number (read-only) | — | The RESOLVED baseline reference price the paint splits on: `priceBaseline` when set, else the level% of the price pane's current range. For host chrome that colors by baseline position (e.g. a status line's value ink). Writes are ignored. |
| `candleZOrder` | number | `0` | Draw-order key of the price candles relative to overlay indicators. Indicators default to z ≥ 1, so candles sit behind all overlays by default. |
| `seriesOrder` | `{ id, to: 'front' \| 'back' }` or `{ id, z }` | — | Reorder one indicator's series layer — move it to front/back, or set an explicit z key. |
| `highlights` | `HighlightArea[]` | `[]` | Shaded vertical time bands (session highlighting, e.g. weekends or pre/regular/post), drawn behind grid + data. Malformed entries are dropped; bands are sorted by start time. |
| `tradeMarkers` | `{ visible?, labels?, qty?, colors? }` | everything on | Strategy trade markers (the order-fill arrows a strategy indicator emits via `IndicatorModel.trades`). Partial merge: `visible` hides the units, `labels` the order-id line, `qty` the signed-quantity line; `colors` overrides `{ long, short, exit }` (defaults `#2962ff` / `#f23645` / `#d500f9`). Malformed fields are dropped. |

### Interaction

| Feature | Type | Default | Notes |
|---|---|---|---|
| `animZoom` | boolean | `true` | Eased wheel-zoom; takes effect on the next interaction. |
| `animPan` | boolean | `true` | Inertial pan glide; takes effect on the next interaction. |
| `intro` | `'settle' \| 'grow' \| false` | `'settle'` | Reveal animation on first paint. Setting it replays the intro (handy for comparing styles from the console). |
| `zoomAnchor` | `'right' \| 'cursor'` | `'right'` | Wheel-zoom anchor: pin the right edge / latest bar, or the bar under the cursor. Affects the next wheel-zoom. Holding `Shift` (or a horizontal/trackpad swipe) makes the wheel **pan through history** instead of zooming. |
| `axisDrag` | boolean | `true` | Drag the right price-axis strip to rescale vertically and the bottom time-axis strip to zoom horizontally; double-clicking an axis strip resets it. |
| `paneResize` | boolean | `true` | Drag the separator between panes to resize them; double-clicking a separator restores the two adjacent panes to an even split. |
| `keyboard` | boolean | `true` | Keyboard navigation/accessibility: focusable chart with arrow-key crosshair stepping (`Shift`+Arrow pans), `Alt`+`Shift`+`→` scrolls back to the latest bars at the current zoom, `+`/`-` zoom, Home/End jump, `0` **reset (fit content)**, Escape clear, plus ARIA labels and a live region. `Ctrl`/`Cmd` chords are left untouched for the host's own shortcuts (the widget's pan/zoom glides, the browser's `Ctrl`+`0`, …). When the latest bar is scrolled off-screen, a proximity-revealed `»` button in the bottom-right corner does the same. |
| `historyChords` | boolean | `true` | The drawings layer answers `Ctrl`/`Cmd`+`Z` / `Y` itself (drawing undo/redo). A host that owns a **unified** history — drawings plus its own app actions in one timeline, like the widget — sets it to `false` so the chords bubble up to the host's keymap instead of being consumed in-chart. Copy/paste/duplicate/delete/nudge keys are unaffected. |

> **Double-click behavior changed.** Double-clicking the **chart data area** no longer fits the
> content to the view. Instead it maximizes the double-clicked pane so it fills the chart and every
> other pane is fully hidden: double-clicking the **price pane** hides all study panes, and
> double-clicking a **study pane** hides the price pane (and any other studies). A second
> double-click on the maximized pane restores the previous layout. Double-click on an **axis strip**
> (reset that axis) and on a **pane separator** (even split) is unchanged. To **fit content** the
> way the old data-area double-click did, press the **`0`** key.

### Axes & scale

| Feature | Type | Default | Notes |
|---|---|---|---|
| `scaleMode` | `'price' \| 'percent'` | `'price'` | Price-axis display: absolute price, or percent change vs the first visible bar. Gridlines, axis labels, and the crosshair chip all follow it. |
| `timezone` | IANA zone string | `'UTC'` | Time zone for the time-axis ticks and crosshair / data-window stamps, e.g. `'America/New_York'`. |
| `gridlines` | boolean | `true` | Master toggle for the background gridlines (per-axis visibility/colors live in the rich config). |
| `axisLabels` | boolean | `true` | Draw the price/time axis tick labels. |
| `priceLabel` | boolean | `true` | The last-price axis tag. Independent of `currentPriceLine` — either can show without the other. |
| `countdown` | boolean | `true` | The bar-close countdown tag next to the price axis. |
| `autoScale` | boolean | `true` | Whether the price pane auto-scales to fit visible data. Setting it to `false` freezes the current window (unlocking vertical price pan/drag); setting it to `true` drops the freeze and resumes autoscale. |

### In-chart UI

| Feature | Type | Default | Notes |
|---|---|---|---|
| `attribution` | The in-chart attribution mark (bottom-left logomark linking to the Vela project). **On by default.** Disabling it is allowed only when an equivalent visible attribution is displayed elsewhere on the page — see the repository's `NOTICE` file. |
| `settings` | boolean | `false` | An in-chart gear button + dialog to edit a curated slice of the rich config (colors, fonts, scale, timezone) with export/import. |

> **Pane controls.** Hovering a pane reveals a small button cluster in its top-right corner: move
> the pane up/down, collapse/expand it, and maximize/restore it. Each indicator's legend row also
> carries a **Move to** control for moving or merging it into another pane — merging gives the
> moved indicator its **own price-scale column** to the
> right of the pane's scale, autoscaled independently. This is a **native-renderer** capability
> (`capabilities.paneManagement`); on a renderer that lacks it the pane operations warn and no-op.

> **The drawing toolbar** is also in-chart UI, but it lives on its own facade — `chart.drawings`,
> not `chart.renderer` — and is **shown by default**. It adds its own keyboard shortcuts
> (undo/redo, copy/paste/duplicate, delete, nudge) on top of the navigation keys above.

## Screenshot export

`chart.renderer.screenshot()` returns a **PNG data URL** of the current chart (or `null`
on a renderer that doesn't support it, with a warning). It composites the canvas layers in the
order you see them: the series geometry — with any drawings stacked among the series already
inside it — then the chrome layer that carries script-drawn shapes, then the drawings that sit
over everything. The crosshair, the DOM overlays (tables, legend, data window) and the
volume-profile layer are **not** included.

```js
const url = chart.renderer.screenshot();
if (url) { const a = document.createElement('a'); a.href = url; a.download = 'chart.png'; a.click(); }
```

## Data-window readout

`chart.renderer.dataWindowReadout()` returns the bar under the crosshair — or the latest bar
when the cursor is off the plot — as a **ready-to-display** snapshot: the timestamp split into
`date` and `time`, the `ohlc` block (with `vol` when the bar carries volume, and `up` telling
you which way to tint it), and one `groups` entry per indicator holding a row per plot with its
own color. Every number is already formatted on the scale of the pane it belongs to, so a panel
built on it does no formatting of its own.

Pair it with `onCrosshairMove` to keep your own readout in step; it returns `null` on a renderer
that doesn't provide one. This is what the [widget's data window](./widget.md#the-chrome) is
built from.

```js
chart.renderer.onCrosshairMove(() => {
    const readout = chart.renderer.dataWindowReadout();
    if (!readout) return;
    console.log(readout.date, readout.time, readout.ohlc?.c);
    for (const group of readout.groups) console.log(group.name, group.rows);
});
```

## Rich config (templates / persistence)

`chart.renderer.getConfig()` returns the renderer's full cosmetics as a **serializable,
versioned JSON document** — every inherited value is resolved to a concrete one, so an
exported template stands on its own. Feed it back with `applyConfig()` to restore saved
settings or load a template. Untrusted/partial JSON is validated and merged, so malformed
fields are dropped and a partial patch changes only what it names. No indicator re-run.

```js
const template = chart.renderer.getConfig(); // snapshot
localStorage.setItem('chartConfig', JSON.stringify(template));

chart.renderer.applyConfig(JSON.parse(localStorage.getItem('chartConfig'))); // restore
chart.renderer.applyConfig({ candles: { upColor: '#26a69a' } }); // partial patch
```

The covered cosmetics include layout (background, text, font), grid colors/visibility,
crosshair (color/width/style/opacity/label), price scale (mode, log, border, labels,
current-price line), time-scale timezone, candle border/wick, and per-style colors for
bars / line / area / baseline.

## Custom renderers

The native renderer is the only bundled backend, but the multi-renderer port stays:
a custom `IChartRenderer` class passed as `options.renderer` declares its own
`features` list, and every `chart.renderer` call degrades gracefully (unsupported
keys warn and no-op). See [adding a renderer](../contributing/adding-a-renderer.md).
