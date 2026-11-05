---
name: using-vela-drawing-tools
description: Works with the interactive drawing tools of Vela charts (@luxalgo/vela) - trend lines, horizontal lines, boxes, Fibonacci and Gann tools, pitchforks, patterns, annotations, positions and price-action zones - configuring the drawing toolbar, placing and editing drawings from code with chart.drawings, saving and restoring them, following drawing events, and adding a new drawing tool to Vela itself. Use when a Vela chart needs drawings shown, hidden, limited, created programmatically or persisted, when building a custom drawing toolbar, or when a new drawing tool is requested.
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
`drawingToolbar: false` hides that bar. Type keys are lowercase and fixed: lines (`trendline`,
`ray`, `hline`, `vline`, `extendedline`), shapes (`box` is the rectangle, `ellipse`, `triangle`,
`polyline`), annotations (`text`, `note`, `callout`, `pricelabel`), Fibonacci (`fibretracement`,
`fibextension`), measure (`datepricerange`, and `position`, one tool for long and short
positions), patterns (`xabcd`, `headshoulders`), price action (`fairvaluegap`, `orderblock`,
`liquidity`). The full catalogue is in `docs/user/drawing-tools.md`.

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
always work. A lock stops the user's gestures only: `remove` from code deletes a locked
drawing. Drawings carry no owner field: to replace "the ones my code drew", keep their ids.

## Saving and restoring

```ts
localStorage.setItem('drawings', JSON.stringify(chart.drawings.toJSON()));
chart.drawings.fromJSON(JSON.parse(localStorage.getItem('drawings') ?? 'null')); // untrusted input is safe
```

`fromJSON` replaces every drawing and keeps their ids; a missing or invalid document restores
an empty chart. It clears the undo history and fires no `drawing:*` event.

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
`drawing:selected`. Show your shortcuts in Vela's flyouts with `d.setToolShortcuts({ trendline: 'Alt+T' })`.

## Adding a new drawing tool

A new tool is added to **Vela's source**, in the Vela repository. `registerDrawingType` is
exported, but it takes only the existing type keys (a closed union), the base classes a tool
extends are internal, and the native painter draws only the families it knows: a host
application cannot add a working tool through the public API. Instead:

- marks users do not edit (signals, zones computed from data): draw them from an indicator
  (lines, boxes and labels in a native indicator's output; the `adding-vela-indicators` skill);
- a house style for a zone users place: the `box` tool with a fill and text, offered through
  `d.setToolDefaults(...)` or a saved style (`d.setToolTemplates(...)`);
- a genuinely new tool: contribute it to the Vela repository, in five steps.

The five steps, all under `src/core/drawings/`:

1. **Key**: add the type's string to the `DrawingTypeKey` union in `Drawing.ts`.
2. **Class** in `types/`: extend the closest base, so the leaf only states what is unique:

   | Base | For | The leaf supplies |
   | --- | --- | --- |
   | `SegmentDrawing` | multi-line tools (channels, pitchforks) | `geometry(proj)`: segments and an optional fill |
   | `FibRatios` | Fibonacci tools | `defaultLevels()`, `entryLines(proj)` |
   | `PatternDrawing` / `HarmonicPattern` | labelled vertex patterns | `vertexLabels()` / `patternName()` and `ranges()` |
   | `CalloutBase`, `PinnedLabel`, `GlyphStamp` | annotations and stamps | the type, a default label or glyph |
   | `Drawing` | a shape like no other | every geometry method and `schema()` |

3. **Register** in `registry.ts`: `registerDrawingType({ type, group, label, icon, defaultStyle, create })`.
   One call makes both the factory and the toolbar entry; `group` picks the toolbar group.
4. **Export** the class from `index.ts`.
5. **Paint** only a new look: a type extending an existing family is painted already; a new
   visual needs a branch in `src/renderers/native/drawings/DrawingPainter.ts`.

Keep the class free of renderer imports and pixels: anchors are time and price, geometry is
computed through the `Projector` it is given. Interaction (`placementMode()`), the settings
panel (`schema()`), persistence, undo and copy-paste then work without more code. Add tests next
to `test/drawings-*.test.ts`, a row to the catalogue in `docs/user/drawing-tools.md`, and run
`npm run i18n:extract` for a label written with `msg()`.

## Check your work

1. `chart.drawings.all()` holds the drawing with the anchors you gave, and
   `chart.inspect()` lists it among the generated drawings.
2. Restore round trip: `fromJSON(toJSON())` on a fresh chart gives the same `all()`.
3. In the browser, the drawing paints where its anchors are, its handles drag, and its settings
   panel opens on double-click.

## Further reading

- `node_modules/@luxalgo/vela/docs/user/drawing-tools.md`: every tool, toolbar behavior,
  keyboard shortcuts, depth in the stack.
- `node_modules/@luxalgo/vela/docs/user/api-reference.md` (section `chart.drawings`): every
  method and event.
- `node_modules/@luxalgo/vela/docs/contributing/adding-a-drawing-tool.md`: the seam in detail.
