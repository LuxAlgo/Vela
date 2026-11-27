---
name: using-vela-drawing-tools
description: Works with the interactive drawing tools of Vela charts (@luxalgo/vela) - trend lines, horizontal lines, boxes, Fibonacci and Gann tools, pitchforks, patterns, annotations, positions and price-action zones - configuring the drawing toolbar, placing and editing drawings from code with chart.drawings, saving and restoring them, following drawing events, reading a drawing's value for an alert, and adding custom drawing tools from an app or plugin with defineDrawing (@luxalgo/vela/plugin). Use when a Vela chart needs drawings shown, hidden, limited, created programmatically or persisted, when building a custom drawing toolbar, or when a new or custom drawing tool is requested.
license: Apache-2.0
---

# Using Vela drawing tools

Drawings are a model the chart owns: each one is plain JSON (`type`, time-and-price `anchors`,
`style`), so it saves, restores, undoes and syncs without the renderer. Users place them from
the drawing toolbar; code uses `chart.drawings` (in a workspace, `ws.chart.drawings` for the
active cell).

## The toolbar

```ts
new Vela('#chart', { data: bars, drawings: false });                              // no toolbar, API still works
new Vela('#chart', { data: bars, drawings: { tools: ['trendline', 'hline', 'box', 'fibretracement'] } });
new Vela('#chart', { data: bars, drawings: { groups: [{ id: 'mine', label: 'Mine', tools: ['trendline', 'ray'] }] } });
```

`groups` replaces the whole toolbar (and wins over `tools` when both are given). In a
`VelaWorkspace` the same `drawings` option drives the one shared toolbar, and
`drawingToolbar: false` hides that bar. A **type key** names a tool. The built-in keys are
lowercase: lines (`trendline`, `ray`, `hline`, `vline`, `extendedline`), shapes (`box` is the
rectangle, `ellipse`, `triangle`, `polyline`), annotations (`text`, `note`, `callout`,
`pricelabel`), Fibonacci (`fibretracement`, `fibextension`), measure (`datepricerange`, and
`position`, one tool for long and short positions), patterns (`xabcd`, `headshoulders`), price
action (`fairvaluegap`, `orderblock`, `liquidity`). The full catalogue is in
`docs/user/drawing-tools.md`. A tool your app registers has a key of its own (`'acme.range'`,
see below), and that key works wherever a built-in one does, `tools` and `groups` included.

## Drawings from code

```ts
const d = chart.drawings;

// Place one: anchors are { time (epoch ms), price }. Returns the drawing, or null.
const line = d.add('trendline', {
    anchors: [{ time: bars[10]!.time, price: bars[10]!.low }, { time: bars[60]!.time, price: bars[60]!.low }],
    style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'dashed', extendRight: true },
});
d.add('hline', {
    anchors: [{ time: bars.at(-1)!.time, price: 64000 }],
    text: { value: 'Resistance', size: 'normal', hAlign: 'right', vAlign: 'top' },
});

d.setTool('fibretracement');   // the user's next clicks place one; setTool(null) disarms
if (line) d.lock(line.id);
d.undo();

const off = chart.on('drawing:created', ({ id }) => console.log('drew', id));
```

Interactive methods (`add`, `setTool`, `select`, the toolbar) need a renderer that paints
drawings: check `chart.drawings.supported`. Reading, `fromJSON`, `update`, `remove` and undo
always work. `add` returns `null` for a type key that is not registered. A lock stops the
user's gestures only: `remove` from code deletes a locked drawing. Drawings carry no owner
field: to replace "the ones my code drew", keep their ids.

## What a drawing gives back

```ts
if (line) {
    const level = d.valueAt(line.id, Date.now()); // the line's price at a time, or null
    d.readout(line.id);                           // the values a tool reports: [{ label, value }]
}
d.at(240, 120);                                   // { id, part } under a plot pixel, or null
const offSnap = d.addSnapSource(({ price }) => [{ price: Math.round(price / 100) * 100 }]); // more magnet targets
chart.on('drawing:click', ({ id, part, time, price }) => console.log(id, part, time, price));
chart.on('drawing:hover', ({ id, part }) => console.log(id, part)); // id is null off the drawings
```

`valueAt` is what an alert on a drawing compares the price with. The trend line, ray, extended
line, horizontal line and horizontal ray report their level; every other built-in tool returns
`null`, and a custom tool returns what its definition says. `part` is the named part of a
custom tool under the pointer, `null` otherwise.

## Saving and restoring

```ts
localStorage.setItem('drawings', JSON.stringify(chart.drawings.toJSON()));
chart.drawings.fromJSON(JSON.parse(localStorage.getItem('drawings') ?? 'null')); // untrusted input is safe
```

`fromJSON` replaces every drawing and keeps their ids; a missing or invalid document restores
an empty chart. It clears the undo history and fires one `drawing:replaced`, with no
`drawing:created` per drawing. A drawing whose type is not registered on the page is kept as a
placeholder (a dashed outline the user can select, move and delete), `toJSON` saves it back
unchanged, and it becomes the real drawing once its type is registered.

- A `VelaWorkspace` with `persist: true` saves drawings, tool settings and saved styles for you.
- **Drawings belong to the chart, not the symbol.** They stay through a symbol switch. To keep a
  set per symbol, track the symbol yourself (`chart.market` already names the next one while it
  loads) and swap on `market:changed`, which also fires on a timeframe-only switch:

  ```ts
  let symbol = chart.market.symbol ?? '';
  const key = (s: string) => `drawings:${s}`;
  chart.on('market:changed', ({ symbol: next }) => {
      if (next === symbol) return;                               // a timeframe switch
      localStorage.setItem(key(symbol), JSON.stringify(chart.drawings.toJSON()));
      symbol = next;
      chart.drawings.fromJSON(JSON.parse(localStorage.getItem(key(symbol)) ?? 'null'));
  });
  ```
- A drawing's `showOn` (timeframe bands) limits the timeframes it shows on:
  `d.update(id, { showOn: [...] })`.

## A toolbar of your own

Hide Vela's bar (`drawings: { toolbar: false }`), call `setTool(type)` from your buttons, and
mirror the state from the events: `drawing:tool` (armed tool), `drawing:snap` (magnet),
`drawing:stay` (stay in drawing mode), `drawing:mode` (measure or eraser),
`drawing:selected`, `drawing:favorites`, and `drawing:types` (a tool was registered, replaced
or unregistered: rebuild your tool list from `drawingTypes()`, exported by
`@luxalgo/vela/plugin`). Show your shortcuts in Vela's flyouts with
`d.setToolShortcuts({ trendline: 'Alt+T' })`.

## Adding a drawing tool of your own

Register it with `defineDrawing` from `@luxalgo/vela/plugin`: no fork of Vela. You describe
what the tool paints as a list of shapes. Hit-testing, hover parts, handles, selection
bounds, saving and undo derive from that list, and the tool joins the toolbar like a built-in
one.

```ts
import { BORDER_FIELDS, FILL_FIELDS, defineDrawing, registerDrawingGroup, type DrawingShape } from '@luxalgo/vela/plugin';

registerDrawingGroup({ id: 'acme', label: 'Acme tools' }); // optional: names the toolbar group

interface Range {
    high: number;
    low: number;
}

// <props, result of compute>. Returns the function that unregisters the tool.
const unregister = defineDrawing<{ midline: boolean }, Range | null>({
    type: 'acme.range', // the type key: namespace it
    label: 'High-Low Range',
    group: 'acme', // or a built-in group: 'lines', 'shapes', 'fibonacci', 'measure'…
    anchors: [
        { role: 'from', free: 'x', hint: 'Click the first bar' },
        { role: 'to', free: 'x', hint: 'Click the last bar' },
    ],
    style: { lineColor: '#3b82f6', lineWidth: 1, fillColor: '#3b82f622' },
    props: { midline: true }, // the tool's own settings, saved with each drawing
    settings: [
        ...BORDER_FIELDS,
        ...FILL_FIELDS,
        { path: 'props.midline', label: 'Midline', kind: 'boolean', quick: true },
        { path: 'results.size', label: 'Range', kind: 'readout' },
    ],
    // Runs when the points, the props or the chart's bars change, never on a pan or a zoom.
    compute: (c) => {
        const [a, b] = c.anchors;
        if (!a || !b) return null;
        const bars = c.bars(Math.min(a.time, b.time), Math.max(a.time, b.time));
        return bars.length ? { high: Math.max(...bars.map((x) => x.high)), low: Math.min(...bars.map((x) => x.low)) } : null;
    },
    // Runs every frame: the drawing as shapes, in plot pixels. `c.state` is what compute returned.
    shapes: (c) => {
        const [a, b] = c.anchors;
        const r = c.state;
        if (!a || !b || !r) return [];
        const x0 = c.x(a.time);
        const x1 = c.x(b.time);
        const mid = (r.high + r.low) / 2;
        const out: DrawingShape[] = [
            { kind: 'rect', from: [x0, c.y(r.high)], to: [x1, c.y(r.low)], fill: true },
            { kind: 'tag', axis: 'price', value: r.high },
            { kind: 'tag', axis: 'price', value: r.low },
        ];
        if (c.props.midline) out.push({ kind: 'line', from: [x0, c.y(mid)], to: [x1, c.y(mid)], stroke: { dash: 'dashed' }, part: 'mid', tip: `Mid ${c.price(mid)}` });
        return out;
    },
    priceRange: (d) => (d.state ? { min: d.state.low, max: d.state.high } : null),
    valueAt: (_time, d) => (d.state ? (d.state.high + d.state.low) / 2 : null),
    readout: (d) => (d.state ? [{ key: 'size', label: 'Range', value: (d.state.high - d.state.low).toFixed(2) }] : []),
    snapTargets: (d) => (d.state ? [{ price: d.state.high }, { price: d.state.low }] : []),
});

// The tool is in the toolbar. From code it works like a built-in one:
chart.drawings.setTool('acme.range');
const range = chart.drawings.add('acme.range', { anchors: [{ time: bars[10]!.time, price: 0 }, { time: bars[60]!.time, price: 0 }] });
if (range) console.log(chart.drawings.valueAt(range.id, bars[30]!.time), chart.drawings.readout(range.id));
```

### The shape kinds

| `kind` | Draws | Main members |
| --- | --- | --- |
| `line` | a segment | `from`, `to`, `extend` (to the plot's edge), `arrows` |
| `path` | a polyline or polygon | `points`, `closed`, `smooth`, `colors` |
| `rect` | a rectangle | `from`, `to`, `radius` |
| `ellipse` | an ellipse, circle or arc | `center`, `rx`, `ry`, `from` / `to` (angles) |
| `curve` | Bézier paths | `d`: `['M', x, y]`, `['L', …]`, `['Q', …]`, `['C', …]`, `['Z']` |
| `band` | the area between two point series | `upper`, `lower` |
| `rows` | histogram rows from one x | `x`, `rows: [{ y, h, w, fill? }]` |
| `text` | text | `at`, `text`, `color`, `size`, `align`, `baseline`, `plate`, `avoid` |
| `marker` | a mark of fixed pixel size | `at`, `shape` or `glyph`, `size` |
| `image` | an image centered on a point | `at`, `w`, `h`, `src` (a URL or `data:` URI; another origin must send CORS headers) |
| `tag` | a chip on the price or time axis | `axis`, `value`, `text`, `color` |
| `drawing` | another registered drawing, as a part | `type`, `anchors`, `style`, `props` |

Every kind but `tag` also takes `part` (a name hover and click report), `front` (paint over
the series), `hit: false` (the pointer passes through), `cursor`, `tip` and `opacity`. The
geometric kinds (`line` to `marker`, except `text`) take `stroke` and `fill`. Left out, the
outline is the drawing's own line and there is no fill. `stroke: null` removes the outline,
`fill: true` is the drawing's fill color, and both take a color; `fill` also takes a gradient
or a hatch.

### The definition members you reach for

- `anchors`: a count (default 2), `{ min, max }` (the user ends with Enter or a double-click),
  or one `{ role, free, hint }` per point. `placement`: `'click'`, `'drag'` or `'freehand'`.
- `place(step)`: runs for each click and for the cursor preview. Return a point to constrain
  it, `step.set(props)` to keep what a click read, `step.finish()` to end early.
- `props` and `settings`: fields with paths `props.<key>`, `style.<key>`, `text.<key>`, and
  `results.<key>` with `kind: 'readout'` for a read-only row. `unit: { base: 'anchors.0.price' }`
  on a number stored as a price adds a price / points / percent / ticks switch; `section`
  titles a block; `quick: true` also puts the control on the quick-settings bar;
  `levels: true` with a `props.levels` list of `{ ratio, color, enabled }` gives the level
  editor.
- `compute(ctx, prev)`: `ctx.change.bars` is `'none'`, `'tick'`, `'append'` or `'reset'`.
  `ctx.timeZone` is the chart's time zone (an IANA name), for session and calendar tools. Return
  a promise to work in a worker: the previous result stays painted until the new one lands.
- `handles(data)`: extra grips, each `{ at: { time, price }, drag: (pt) => propsToChange }`.
- `valueAt`, `readout`, `snapTargets`, `autoscale: true` (the pane's price scale keeps the
  drawing in view; off by default), `click(part, data)` (return props to change).
- A hook that throws is logged once and counts as absent for that call, and a shape the chart
  cannot draw is left out of the list: guard `data.state`, which is `undefined` until
  `compute` returns its first result.
- `registerDrawingGroup({ id, label, icon?, showEmpty? })` names a toolbar group of your own.
  With `showEmpty: true` the group is on the bar before its first tool, as soon as its menu
  has a row: `registerWidgetAction({ id, target: 'drawings', group: id, label, icon, run })`
  adds a command at the end of a group's menu (a built-in group's too), for example
  "Create a tool". Call `widget.refreshActions()` when you register it after the widget is built.
  `unregisterDrawingGroup(id)` takes the registration back. A `group` that is a
  built-in one (`'lines'`, `'channels'`, `'pitchforks'`, `'shapes'`, `'annotations'`,
  `'stamps'`, `'fibonacci'`, `'priceaction'`, `'geometry'`, `'patterns'`, `'measure'`) puts
  the tool with the built-in tools of that kind.

### Gotchas

- **Shapes are in plot pixels.** Convert with `c.x(time)`, `c.y(price)`, `c.point(p)` or read
  `c.points`. Keep `props` and anchors in time and price, never pixels.
- **`shapes` runs every frame, and during placement with fewer points than declared.** Return
  `[]` or a partial drawing when a point is missing, and move heavy work to `compute`.
- **Namespace the type key** (`'acme.range'`), and keep `props` plain JSON: they are saved
  with each drawing.
- **Register before or after the charts are built.** Toolbars follow the registry, and each
  chart raises `drawing:types`. Defining a type again replaces it, and placed drawings follow.
- **A chart limited with `drawings: { tools }` or `{ groups }` shows only the keys it lists.**
  Add yours.
- **Drawings of a type that is not registered are kept**, as placeholders that save back
  unchanged. Load documents freely before a plugin registers its tools.
- **`c.bars()` is empty without a renderer that paints drawings**, so a computed tool has no
  value there.
- Labels read by users go through `msg('acme.range.label', 'High-Low Range')` to follow the
  chart's language.

### A class instead of a definition

Write a class when the tool extends a family Vela already draws: `HarmonicPattern` (supply
`patternName()` and `ranges()`), `PatternDrawing`, `FibRatios`, `FibLevels`, `RadialFib`,
`SegmentDrawing` and `GlyphStamp` are exported from `@luxalgo/vela/plugin` and are painted by
their family's painter. Register the class with
`registerDrawingType({ type, group, label, icon, defaultStyle, create: (init) => new MyTool(init) })`.
For anything else, `defineDrawing` (or a `ShapeDrawing` subclass) is the shorter path.

### When a tool is not the answer

- Marks users do not edit (signals, zones computed from data): draw them from an indicator
  (lines, boxes and labels in a native indicator's output; the `adding-vela-indicators` skill).
- A house style for a zone users place: the `box` tool with a fill and text, offered through
  `d.setToolDefaults(...)` or a saved style (`d.setToolTemplates(...)`).
- A tool that should ship with Vela itself: contribute it to the Vela repository, following
  `docs/contributing/adding-a-drawing-tool.md`.

## Check your work

1. `chart.drawings.all()` holds the drawing with the anchors you gave, and
   `chart.inspect()` lists it among the generated drawings.
2. Restore round trip: `fromJSON(toJSON())` on a fresh chart gives the same `all()`.
3. In the browser, the drawing paints where its anchors are, its handles drag, and its settings
   panel opens on double-click.
4. For a tool of your own: typecheck the definition, find it in the toolbar, place it with
   real clicks, reload a saved document on a page that does not register it (the placeholder
   shows) and on one that does (the drawing is back with its `props`).

## Further reading

- `node_modules/@luxalgo/vela/docs/user/drawing-tools.md`: every tool, toolbar behavior,
  keyboard shortcuts, depth in the stack, custom tools.
- `node_modules/@luxalgo/vela/docs/user/api-reference.md` (section `chart.drawings`): every
  method and event.
- `node_modules/@luxalgo/vela/docs/contributing/plugin-sdk.md` (section "Drawing tools"): the
  full reference for `defineDrawing`: every definition member, shape and settings field.
- `node_modules/@luxalgo/vela/docs/contributing/adding-a-drawing-tool.md`: adding a tool to
  Vela's own source, the base classes and their hooks.
- The Vela repository's `playground/custom-drawings.ts`: nine complete tools (a spiral, an
  anchored VWAP, a retracement, a regression channel, a zone, a position, a volume profile, a
  pattern, a tool made of two built-in ones).
