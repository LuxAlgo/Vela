# Drawing tools

Vela ships an interactive **drawing-tools** layer: a docked toolbar and ~66 on-chart
tools — trend lines, channels, Fibonacci, harmonic patterns, annotations, and more — that a user
draws, edits, and keeps on the chart. Drawings are anchored in **data space** (time + price), so
they stay locked to the bars across pan, zoom, timeframe changes, and reload — the same durability
a scripting engine's own drawing output gets.

The toolbar is **on by default** on the native renderer. Everything it does is also reachable from
code through the [`chart.drawings`](#driving-drawings-from-code) surface, and the whole model
persists to JSON.

> **Drawing tools vs script drawings.** This page is about the *interactive* tools a person places on
> the chart. They are distinct from the lines/boxes/labels an **indicator** emits as output —
> those are part of the neutral model and are covered under indicators.

---

## The toolbar

A flush vertical bar docked in a gutter on the **left** of the plot (the chart insets to its
right, so the bar never overlaps candles, the legend, or the axes).

- **Tool groups.** Each group is a single cell showing its **last-used** tool's icon. **Click the
  icon** to arm that tool. Multi-tool groups also show a small **arrow** on hover — click the arrow
  to open a **flyout** listing every tool in the group; pick one to arm it (and it becomes the
  group's new last-used icon). Click the arrow again to close the flyout.
- **Cursor.** The top button returns to select/idle (no tool armed).
- **Modes** (bottom of the bar) — renderer-local, mutually exclusive with each other and with any
  armed tool:
  - **Measure** — a transient ruler (click–move–click) that reports the price/%/bar delta. It is
    not saved as a drawing; it clears on the next press, pan, or zoom. **Shift+click** an empty
    spot starts a measurement right there, no toolbar trip needed (press-drag-release works too).
  - **Eraser** — click a drawing to delete it, or press-and-drag across several to wipe them.
  - **Magnet** — a 3-state snap toggle: **off → weak → strong**. *Strong* always snaps a new
    anchor to the nearest candle's time + OHLC; *weak* snaps only when a candle point is within a
    few pixels of the cursor. Holding **Ctrl/Cmd** is a momentary *strong* override.
  - **Stay in drawing mode** — an on/off toggle (pen with a lock, under the magnet). When on,
    finishing a drawing leaves the tool armed so you can keep placing the same tool without
    re-picking it; when off, most tools disarm after one placement (the brush family always stays
    armed either way). Click the cursor button or press Escape to return to select/idle.
- **Tooltips.** Hovering any control for ~2 seconds shows a small label beside it.
- **Favorites.** Every tool row in a flyout carries a **star** at its right edge (revealed on row
  hover, gold when set). Starring is a user preference, not document data: the set survives
  symbol/timeframe rebuilds, is persisted by the widget alongside the other UI state (`persist`),
  and is readable and writable from code — see below. Hosts and plugins can build their own UI on
  top of it (a favorites bar, a radial picker…).
- **Shortcut hints.** When the host binds a keyboard shortcut that arms or places a tool, the
  flyout row shows the chord beside the star (the widget binds `Alt+T` for the trend line and
  `Alt+H` / `Alt+V` for lines at the cursor out of the box). Hints are pushed as display strings
  via `chart.drawings.setToolShortcuts({ trendline: 'Alt+T', … })`, so they always match the
  host's actual bindings and platform formatting.

Arm a tool, then **click** to place its anchors (most tools, including shapes, are
click-then-move-then-click; freehand/brush is the exception and captures the drag path; the
polyline takes any number of clicks and finishes on **Enter** or double-click).

## Editing a drawing

Select a drawing (click it) to show its **handles** and a compact **quick-settings popup** floating
beside it. The popup is built from each tool's own schema, so it shows only the controls that tool
supports — line color/width/style, fill, text, and (for Fibonacci tools) a **gear** panel to
enable/recolor/label each level. The popup also locks, reorders (bring-to-front /
send-to-back), and deletes the drawing.

**Text is typed on the chart.** Placing a text annotation opens a blinking caret at the click point
next to an `Enter Text` placeholder, framed by a thin gray box that marks the text as being edited,
and the glyphs appear exactly where they will be painted as you type, at the annotation's default
**large** size. **Enter** starts a new line; a click elsewhere (or **Ctrl/Cmd+Enter**) keeps the
text, and **Escape** restores what was there before — a text annotation that was never typed into is
discarded rather than left invisible. Double-click existing text, or a callout, to reopen the same
inline editor.

Finished text keeps that frame as its selection cue: a plain text annotation shows the same thin box
when it is selected, and a fainter one while the cursor is over it — the words are the drawing, so
the frame is what tells you where it can be clicked, dragged, or restyled.

The quick-settings popup opens alongside the caret, exactly as it does for every other tool. For
annotations whose text _is_ the drawing — text, note, callout, comment, signpost — the text color and
size sit on the popup's bar, so restyling while you type is one click and the words on the chart
follow immediately; reaching for them does not end the edit. **Bold** and **italic** live under the
field behind the popup's **Text** button, next to the text they format. On shapes that merely carry a
label (a trend line, a box), all four controls stay in that panel with the label field.

Drag a handle to reshape; drag the body to move the whole drawing.

### Keyboard shortcuts

When a drawing is selected (or hovered), with focus on the chart:

| Action | Shortcut |
|---|---|
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |
| Copy / Paste / Duplicate | `Ctrl/Cmd + C` / `V` / `D` |
| Delete | `Delete` or `Backspace` |
| Nudge | Arrow keys (1px; `Shift` + arrow = 10px) |
| Cancel placement / clear selection | `Escape` |

Shortcuts stand down while a text field (e.g. a label editor) is focused, so typing is never
hijacked.

Two mouse shortcuts complement these, and need no selection first: **middle-click** a drawing to
delete it, and **Shift+click** an empty spot to start the [measure ruler](#the-toolbar) at that
exact point.
## Depth: anywhere in the stack

A new drawing starts **just under the price** — the candles read on top of it, the way they read
on top of the indicators — so it behaves like annotation on the chart's background: a zone, a
session band, a shaded area you see *through* the candles rather than across them. From there it
can take **any position in the pane's draw order**: over everything, between two indicators, or
at the very back.

- **From the object tree.** Each pane is one column, read top to bottom as front to back: its
  drawings, its indicators and (in the main pane) the price series, all together. Drag a drawing
  (or a group, which moves as one block) to any slot in that column and the chart repaints in that
  order.
- **From the context menu.** Right-click a drawing row for **Bring to front** / **Send to back** —
  they clear the whole stack, candles and indicators included; a group's row offers the same for
  all of its members at once.
- **From code.** The draw-order key is the drawing's `zIndex`, shared with the pane's series:

```js
chart.drawings.add('box', { anchors }); // a new drawing starts just under the candles
chart.drawings.bringToFront(d.id); // over the whole stack
chart.drawings.sendToBack(d.id); // behind the candles and every indicator
chart.drawings.update(d.id, { zIndex: z }); // an exact slot among the series' keys
```

A drawing under the data stays fully interactive: it still hit-tests, and its selection handles
draw on top, so you can always see and grab what you selected.

The position is part of the drawing, so it is saved with `toJSON()`, restored by `fromJSON()`, and
undoable; the widget also persists the series' own order, so a saved chart comes back stacked as
you left it. Depth needs a renderer that declares the `drawingDepth` capability (the **native
renderer** does); where it is missing, drawings all paint over the data, `zIndex` orders only the
drawings among themselves, and the tree keeps them in one block above the series.

---

## Tool catalogue

**66 tools across 9 groups.** The **Type key** is the string you pass to
`chart.drawings.setTool('…')` or [`chart.drawings.add('…')`](#driving-drawings-from-code). Eraser,
Magnet, Measure, and Stay in drawing mode are toolbar *modes*, not placeable types, so they have no key.

### Lines

| Tool | Type key | What it does |
|---|---|---|
| Trend Line | `trendline` | A segment between two points. |
| Horizontal Line | `hline` | A full-width line at one price. |
| Ray | `ray` | A line from a point, extended one way. |
| Extended Line | `extendedline` | A line through two points, extended both ways. |
| Vertical Line | `vline` | A full-height line at one time. |
| Horizontal Ray | `hray` | A horizontal line from a point, extended right. |
| Cross Line | `crossline` | A full-width + full-height cross through one point. |
| Info Line | `infoline` | A segment with a readout of its price/%/bar delta. |
| Trend Angle | `trendangle` | A ray with its angle (°) labelled off the horizontal. |

### Channels

| Tool | Type key | What it does |
|---|---|---|
| Parallel Channel | `parallelchannel` | A baseline plus a parallel line offset by a third point; optional fill. |
| Disjoint Channel | `disjointchannel` | Two independent segments forming a channel. |
| Flat Top/Bottom | `flattopbottom` | A sloped baseline with a flat (constant-price) opposite side. |

### Pitchforks

| Tool | Type key | What it does |
|---|---|---|
| Pitchfork | `pitchfork` | Andrews' median line with parallel tines from three pivots. |
| Schiff Pitchfork | `schiffpitchfork` | Pitchfork with the handle origin shifted in price only. |
| Modified Schiff Pitchfork | `modifiedschiffpitchfork` | Pitchfork with the origin at the full pivot midpoint. |
| Inside Pitchfork | `insidepitchfork` | Pitchfork median anchored inside the pivots. |

### Shapes

| Tool | Type key | What it does |
|---|---|---|
| Rectangle | `box` | An axis-aligned filled box. |
| Arrow | `arrow` | A straight arrow between two points. |
| Ellipse | `ellipse` | A data-space ellipse in a bounding box. |
| Triangle | `triangle` | A three-point filled triangle. |
| Polyline | `polyline` | A multi-point connected path (finish on Enter/double-click). |
| Brush | `freehand` | A freehand stroke captured from the drag path. |
| Circle | `circle` | A true pixel circle (round at any zoom) from center + edge. |
| Rotated Rectangle | `rotatedrect` | A box rotated to a baseline plus a width. |
| Path | `path` | A multi-point path with an end arrowhead. |
| Arc | `arc` | A half-ellipse dome over a chord. |
| Curve | `curve` | A quadratic Bézier curve with an off-curve control point. |
| Arrow Mark Up | `arrowmarkup` | A fixed-size up-arrow marker stamped at a point (green). |
| Arrow Mark Down | `arrowmarkdown` | A fixed-size down-arrow marker stamped at a point (red). |

### Annotations

| Tool | Type key | What it does |
|---|---|---|
| Text | `text` | A free text label pinned to a point. |
| Callout | `callout` | A text box with a leader pointing at a target. |
| Note | `note` | Free text on a small rounded plate. |
| Price Note | `pricenote` | A draggable box + leader that shows the pinned point's price. |
| Comment | `comment` | A rounded speech balloon pointing at a target. |
| Price Label | `pricelabel` | A pinned tag that auto-renders the price at its anchor. |
| Signpost | `signpost` | A sign plate on a pole rising from a pinned level. |

### Stamps

| Tool | Type key | What it does |
|---|---|---|
| Flag | `flagmark` | A flag glyph stamped at a point (size + glyph editable). |
| Icon | `iconstamp` | A unicode icon stamp; the glyph is chosen from a picker. |

### Fibonacci & Gann

| Tool | Type key | What it does |
|---|---|---|
| Fib Retracement | `fibretracement` | Horizontal retracement levels between two points. |
| Fib Extension | `fibextension` | Extension levels projected from two points. |
| Trend-Based Fib Extension | `fibextensiontrend` | Extension levels from a three-point move. |
| Fib Fan | `fibfan` | Fan of rays at the Fibonacci ratios. |
| Fib Time Zones | `fibtimezones` | Vertical lines at Fibonacci time intervals. |
| Fib Channel | `fibchannel` | Parallel Fibonacci levels along a sloped baseline. |
| Fib Speed Resistance Fan | `fibspeedfan` | Price + time rays subdividing a box at the ratios. |
| Trend-Based Fib Time | `trendfibtime` | Vertical Fibonacci-time lines from a three-point move. |
| Fib Circles | `fibcircles` | Concentric circles at the Fibonacci ratios. |
| Fib Speed Resistance Arcs | `fibarcs` | Concentric semicircle arcs from a pivot. |
| Fib Wedge | `fibwedge` | Fibonacci arcs between two rays from an apex. |
| Fib Spiral | `fibspiral` | A golden (φ) spiral. |
| Gann Fan | `gannfan` | A fan of Gann angles from a point. |
| Gann Box | `gannbox` | A box gridded at Gann ratios. |
| Gann Square | `gannsquare` | A Gann grid + angle fan + concentric arcs over a box. |
| Dedekind Tessellation | `dedekind` | Modular-group tiling of a user-defined time×price range (semicircles + verticals). Density via max curvature. |
| Sonic | `sonic` | Mach-1 wavefront figure: circles sized from a user-drawn diameter, piled into a perpendicular shock wall. Per-circle colors via the levels gear. |
| Supersonic | `supersonic` | Mach cone (M>1): same diameter-sized first circle, with a conical envelope. Mach number is adjustable. Per-circle colors via the levels gear. |
| Golden Sonic | `goldensonic` | Sonic Mach figure whose circle radii follow Fibonacci ratios (including under 1: 0.236…0.786, then 1, φ, φ², …). |
| Golden Supersonic | `goldensupersonic` | Supersonic Mach cone with the same Fibonacci radii (under-1 through extensions). |

### Patterns

| Tool | Type key | What it does |
|---|---|---|
| XABCD Pattern | `xabcd` | A 5-point labelled pattern with leg ratios. |
| ABCD Pattern | `abcd` | A 4-point ABCD pattern. |
| Elliott Impulse Wave (1-5) | `elliottimpulse` | A 5-wave impulse labelled 1–5. |
| Elliott Correction Wave (ABC) | `elliottcorrection` | A 3-wave correction labelled A–B–C. |
| Head & Shoulders | `headshoulders` | A labelled head-and-shoulders with a neckline. |
| Gartley | `gartley` | Harmonic pattern; legs validated against Gartley's Fib bands. |
| Bat | `bat` | Harmonic pattern validated against Bat ratios. |
| Butterfly | `butterfly` | Harmonic pattern validated against Butterfly ratios. |
| Crab | `crab` | Harmonic pattern validated against Crab ratios. |
| Shark | `shark` | Harmonic pattern validated against Shark ratios. |
| Cypher | `cypher` | Harmonic pattern validated against Cypher's (non-adjacent) ratios. |

The harmonic patterns (Gartley…Cypher) draw a **✓/✗ badge** and color each leg ratio green/red by
whether it falls in that pattern's ideal Fibonacci band.

### Forecast & Measure

| Tool | Type key | What it does |
|---|---|---|
| Date & Price Range | `datepricerange` | A box reporting the time span + price/% change it covers. |
| Long/Short Position | `position` | An entry/stop/target box: click the entry, then drag in the profit direction (up for a long, down for a short). Shows risk:reward, percentages, dollar loss, and position size from your risk % and account balance (size is editable and back-solves the risk %). The gear panel has a long/short switch (mirrors the levels across the entry), exact level values in price or points, and per-label display toggles; zone colors and label styling sit on the quick bar. |

---

## Driving drawings from code

Every chart exposes a `chart.drawings` control surface (a sibling of `chart.renderer` and
`chart.data`). It is chainable, and the model is **core-owned** — so reading/serializing/undo work
even on a renderer that can't paint drawings.

```js
import { Vela } from 'vela';

const chart = new Vela('#chart', { data: bars });
await chart.ready();

// Arm a tool so the next clicks place it:
chart.drawings.setTool('trendline');

// …or place one directly (no clicking):
const d = chart.drawings.add('trendline', {
    paneId: 'price',
    anchors: [
        { time: bars[10].time, price: bars[10].low },
        { time: bars[40].time, price: bars[40].high },
    ],
});

chart.drawings.update(d.id, { style: { lineColor: '#ff9800', lineWidth: 2 } });
chart.drawings.lock(d.id);          // make it non-interactive
chart.drawings.showToolbar(false);  // hide the toolbar (drawings still work from code)
```

See the [`chart.drawings` reference](./api-reference.md#chartdrawings-control-surface) for the full
method list and which methods are gated by renderer support.

---

## Tool and mode state from code

The armed tool, the magnet, stay-in-drawing-mode, and the measure/eraser modes are all
readable and drivable programmatically — the seam an external toolbar (e.g. a multi-chart
workspace's shared bar) builds on:

```js
chart.drawings.getTool();               // 'trendline' | … | null (select/idle)
chart.drawings.setSnapMode('strong');   // magnet: 'off' | 'weak' | 'strong'
chart.drawings.getSnapMode();
chart.drawings.setStayMode(true);       // keep the tool armed after each placement
chart.drawings.getStayMode();
chart.drawings.setMode('measure');      // 'measure' | 'eraser' | null (none)
chart.drawings.getMode();

// Follow every change, whatever its source (in-chart toolbar, keyboard, code):
chart.on('drawing:tool', ({ type }) => { /* armed tool changed; null = pointer */ });
chart.on('drawing:snap', ({ mode }) => { /* magnet mode changed */ });
chart.on('drawing:stay', ({ on }) => { /* stay-in-drawing-mode changed */ });
chart.on('drawing:mode', ({ mode }) => { /* measure/eraser entered or left */ });
```

The renderer keeps owning the mutual exclusion — arming a tool exits measure/eraser
(and vice versa), and the outcome always lands on the events, so an external UI only
ever mirrors. One-shot tools disarm themselves after placing (back to `null` on
`drawing:tool`) unless stay-in-drawing-mode is on; the brush family always stays armed.

## Favorite tools

```js
chart.drawings.favorites();                     // ['trendline', 'box'] — starred, in star order
chart.drawings.isFavorite('trendline');         // true
chart.drawings.setFavorite('ray', true);        // star / unstar one type
chart.drawings.setFavorites(['ray', 'box']);    // replace the whole set (unknown types dropped)

chart.on('drawing:favorites', ({ favorites }) => { /* the set changed (star click or code) */ });
```

The widget persists the set with its other state when `persist` is enabled, and restores it on
the next load.

## Persistence, undo & clipboard

- **Save / restore.** `chart.drawings.toJSON()` returns a versioned `DrawingsDocument`; pass it
  back to `chart.drawings.fromJSON(doc)` to restore. The restore path is lenient with untrusted
  input — malformed or unknown-type entries are dropped, never thrown. Drawings are **not**
  auto-persisted; storing the document is up to your app.
- **Undo / redo.** `chart.drawings.undo()` / `redo()` (and `canUndo()` / `canRedo()`) walk a
  snapshot history. A multi-target action (multi-drag, multi-delete, duplicate, paste) is one
  undo step.
- **Clipboard.** `copyToClipboard(ids)` + `paste()`, or `duplicate(ids)` / `clone(id)`, mint fresh
  copies (new ids) and select them — an in-memory, per-chart clipboard.

---

## Renderer support

Interactive drawing requires a renderer that declares the `userDrawings` capability — the **native
renderer** does; a minimal custom adapter may not. When unsupported,
`chart.drawings.supported` is `false`, the interactive methods warn and no-op, **but** the
core-owned methods (`add` of the model, `all`, `toJSON`/`fromJSON`, `undo`/`redo`) still work, so a
document round-trips even without an on-chart toolbar.

> **Stability:** the drawing-tools API is young and may change before a 1.0 release. The persisted
> `DrawingsDocument` is versioned and migrated forward.
