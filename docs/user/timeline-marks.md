# Timeline marks

Pin events to the chart — dividends, splits, earnings, news, releases, deployments, anything
with a moment in time. Vela™ shows each one as a small **glyph on a lane just above the time
axis**, snapped to the bar it belongs to, and opens a **popup with the details** when it is
clicked. The surface is `chart.marks`; it needs no scripting engine.

> **Marks are data, not user state.** The chart never persists them — you re-supply them when
> the market changes. What the chart *does* save is which kinds of event the user chose to hide
> (the **Events** tab of the chart settings).

---

## Quick start

```js
import { Vela } from '@luxalgo/vela';

const chart = new Vela('#chart', { symbol: 'NVDA', timeframe: 'D' });

chart.marks
    .defineGroup({ id: 'dividends', label: 'Dividends' })
    .add({
        id: 'div-2024-06-11',
        time: Date.UTC(2024, 5, 11),
        title: 'Dividend',
        group: 'dividends',
        glyph: { shape: 'circle', color: '#2962ff', letter: 'D' },
        tooltip: 'Dividend · $0.01',
        content: {
            panel: {
                items: [
                    { type: 'field', label: 'Ex-dividend date', value: "Tue 11 Jun '24" },
                    { type: 'field', label: 'Amount', value: '0.01' },
                    { type: 'field', label: 'Payment date', value: "Fri 28 Jun '24" },
                ],
            },
        },
    });
```

A blue token with a **D** appears above the time axis on the 11 June bar. Hover it for the
tooltip; click it for the popup. Open the chart settings: an **Events** tab now lists a
**Dividends** checkbox.

---

## What a mark is

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Stable identity. Adding a mark with an existing id **replaces** it in place. |
| `time` | yes | The moment the event belongs to, in epoch-ms. The glyph never sits at this exact pixel — see [Where a mark lands](#where-a-mark-lands). |
| `glyph` | yes | How the token looks: `{ shape?, color, letter? }` or `{ shape?, color, icon }` — see [Glyphs](#glyphs). |
| `title` | no | The popup's heading, whatever form the content takes. |
| `tooltip` | no | Hover text on the glyph. Without it a lone mark shows its `title`. |
| `group` | no | The kind of event (`'dividends'`, `'news'`…). Marks of one group on one bar fold together; each group gets a checkbox in settings — see [Groups](#groups-clusters-and-stacks). |
| `content` | no | What the popup shows — text, sanitized HTML, or a panel; a value or a function resolved on click. Without it a click only emits `mark:click` — see [The popup](#the-popup). |

The full type is `TimelineMark`, exported from `@luxalgo/vela`.

---

## Where a mark lands

A mark's `time` is a moment; the lane shows **bars**. The glyph centers on **the bar whose span
contains the time**:

- a time inside a bar's `[open, open + interval)` span sits on that bar;
- a time that falls in a **gap** — a weekend, a closed session — goes to the **first bar after
  it** (an event dated outside trading hours affects the next traded bar, not the previous one);
- a time **past the newest bar** projects onto the extrapolated bar grid, in the whitespace to
  the right of the last candle;
- a time before the first loaded bar has nothing to anchor to yet — the glyph appears once
  history backfills that far.

Marks re-snap whenever the bars change: switch the timeframe and three news items 15 minutes
apart become **three glyphs on a 5-minute chart and one cluster on an hourly chart**.

```js
const t = Date.UTC(2024, 5, 11, 14, 0);
chart.marks.defineGroup({ id: 'news', label: 'News' }).set(
    [0, 15, 30].map((minutes, i) => ({
        id: `news-${i + 1}`,
        time: t + minutes * 60_000,
        title: `News ${i + 1}/3`,
        group: 'news',
        glyph: { color: '#26a69a', letter: 'N' },
        content: { text: `Headline ${i + 1}` },
    })),
);
```

---

## Glyphs

A glyph is a colored token: an outline and a symbol in the mark's `color` on the chart
background. The token swells briefly when the pointer lands on it, and **fills** with its color
(white symbol) while its popup is open.

- **`shape`** — `'circle'` (default), `'square'`, `'diamond'`, or `'pin'`.
- **`color`** — any CSS color; the outline, the symbol, and the filled state all use it.
- **`letter`** — one or two characters drawn inside the token (`'D'`, `'E'`, `'!'`).
- **`icon`** — an icon id from the icon registry, drawn inside the token instead of a letter.
  Register the SVG once, from host code; a mark payload only ever carries the id, so marks can
  come straight from data without carrying markup.

```js
import { registerIcon, svg16 } from '@luxalgo/vela/ui';

registerIcon('myco.rocket', svg16('<path d="M9.5 2.5c1.8 0 3.5 1.7 4 4.5l-4 4-4-4c.5-2.8 2.2-4.5 4-4.5z"/><path d="M5.5 7 3 9.5l2 .5.5 2L8 9.5"/>'));

chart.marks.add({
    id: 'release-2-4',
    time: Date.UTC(2024, 5, 12, 9, 30),
    title: 'Release v2.4',
    group: 'releases',
    glyph: { shape: 'pin', color: '#7e57c2', icon: 'myco.rocket' },
    content: { text: 'Deployed v2.4.0 to production.' },
});
```

Several marks of one group on one bar share a single, slightly larger token that carries the
**first** mark's glyph (earliest time, then insertion order).

---

## The popup

Clicking a glyph opens a popup centered on it: the mark's `title`, then its `content`. A cluster
lists every mark it holds, one section each, in a scrollable panel. The popup closes on an
outside click or `Escape`.

`content` takes one of three forms:

**Plain text** — rendered as text, never as markup:

```js
content: { text: 'Special dividend of 0.25, declared the same session.' }
```

**HTML** — formatting kept, hazards removed. The markup goes through an allowlist: paragraphs,
emphasis, lists, tables, code, links, and images survive; scripts, styles, frames, forms, event
handlers (`onclick`…), inline `style`, and `javascript:`/`data:` URLs never reach the page. Links
open in a new tab with `rel="noopener noreferrer"`; images must have an absolute `http(s)`
source.

```js
content: {
    html: '<b>10-for-1 split</b><br>Effective <i>10 Jun 2024</i> · <a href="https://example.com/filing">Filing</a>',
}
```

**A panel** — rows of `field` (label / value), `text`, and `button`. Consecutive buttons share
one row; `primary` emphasizes a button; a button closes the popup after `run` unless `close:
false`.

```js
content: {
    panel: {
        items: [
            { type: 'field', label: 'EPS', value: '6.12 (est. 5.59)' },
            { type: 'field', label: 'Revenue', value: '26.0B (est. 24.6B)' },
            { type: 'text', text: 'Beat on both lines; guidance raised for Q2.' },
            { type: 'button', label: 'Transcript', primary: true, run: () => openTranscript('NVDA', '2024Q1') },
            { type: 'button', label: 'Dismiss', run: () => undefined },
        ],
    },
}
```

**On demand** — pass a function (sync or async) returning any of the forms above. It runs when
the popup needs the section: on click for a lone mark, and for a cluster as each section scrolls
into view — a cluster of forty marks costs one request per entry actually read. While it
resolves the section shows *Loading…*; a rejection shows a short error line.

```js
content: async () => ({ html: await fetchDividendDetails('NVDA', '2024-06-11') }),
```

---

## Groups, clusters, and stacks

`group` names the **kind** of event. It drives three things.

**Clustering.** Marks of one group that land on the same bar fold into **one cluster glyph** —
slightly larger than a single mark, carrying the first mark's glyph, and hovering as
`<Group label> · <count>`. Its popup lists every mark, earliest first.

**Stacking.** Marks of *different* groups on one bar form a **stack**: a small deck showing the
top group's token with the others peeking out behind it. Hovering the deck fans the tokens out
vertically so each can be opened; on touch, one tap fans it out and a second tap opens a token.
Defined groups stack in definition order; groups that were never defined follow, and ungrouped
marks sit last.

**Visibility.** Every group gets a checkbox on the **Events** tab of the chart settings (under
*Visible events*), labeled with the group's `label`. Define a group to name it and to choose its
default:

```js
chart.marks
    .defineGroup({ id: 'dividends', label: 'Dividends' })
    .defineGroup({ id: 'splits', label: 'Splits' })
    .defineGroup({ id: 'news', label: 'News', visible: false }); // hidden until the user opts in
```

A mark may name a group you never defined — it then shows its capitalized id (`'splits'` →
*Splits*). Ungrouped marks have no checkbox and always show.

The user's choice is **persisted with the chart's cosmetic config** (`chart.renderer.getConfig()`
→ `marks.groups`), so it survives a reload and rides workspace templates. A stored choice for a
group the host has not registered yet is kept verbatim until that group shows up. The same
switch is available from code:

```js
chart.marks.setGroupVisible('news', false);
chart.marks.isGroupVisible('news'); // false — the stored choice, else the group's declared default, else true

chart.renderer.set('marks', false); // hide the whole lane
chart.renderer.set('marks', { groups: { splits: false } }); // the settings checkbox, from code
```

---

## Reacting to clicks

Every click on a glyph emits `mark:click` with the mark's `id`, the `ids` of every mark under
the glyph (a cluster lists them all), the first mark's `time`, and the `group`. It fires
**before** the popup opens — and a mark **without `content` opens nothing**, so a host that
wants its own UI simply omits the content and listens:

```js
chart.marks.add({
    id: 'alert-42',
    time: Date.UTC(2024, 5, 13, 15, 30),
    glyph: { shape: 'diamond', color: '#e0b400', letter: '!' },
    tooltip: 'Open in the alerts panel',
});

chart.on('mark:click', ({ id, ids, time, group }) => {
    if (id === 'alert-42') alertsPanel.open(id);
});
```

A content-less token still fills briefly when clicked, so the click reads as acknowledged.

---

## Keeping marks in sync with the market

The chart keeps the marks you gave it across timeframe changes (they re-snap) but has no idea
which events belong to which symbol. Replace the set when the market changes:

```js
async function showEventsFor(symbol) {
    const events = await api.corporateEvents(symbol); // your source
    chart.marks.set(events.map(toMark));
}

await chart.ready();
showEventsFor(chart.market.symbol);
chart.on('market:changed', ({ symbol }) => showEventsFor(symbol));
```

`set` replaces everything (and closes an open popup); `add`, `remove`, and `clear` edit in place;
`all()` returns the current set in insertion order.

In a **workspace**, every cell is its own chart — seed the cells alive now and the ones a later
layout switch mints:

```js
const seed = (chart) => void chart.ready().then(() => showEventsFor(chart));
for (const cell of ws.cells()) seed(cell.chart);
ws.on('cell:created', ({ id }) => seed(ws.cell(id).chart));
```

---

## Settings ids and renderer support

The Events tab, its section, and every checkbox carry settings ids, so a host can hide them like
any other setting: `settings: { hidden: ['events'] }` removes the tab, `'events.groups.<group-id>'`
one row (the group id, kebab-cased). The tab is present only while marks name groups. See
[Options](./options.md#the-settings-option--hiding-settings-dialog-entries) for the full catalog.

Timeline marks are a **native-renderer** capability (`capabilities.timelineMarks`).
`chart.marks.supported` reports it; on a renderer without it the model still fills — `all()`
works — but nothing paints and `setGroupVisible` warns and no-ops.

---

## API summary

| Member | Description |
|---|---|
| `chart.marks.add(mark)` | Add one mark; an existing id is replaced. Chainable. |
| `chart.marks.set(marks)` | Replace the whole set. |
| `chart.marks.remove(id)` · `clear()` | Drop one mark, or all. |
| `chart.marks.all()` | Every mark, in insertion order. |
| `chart.marks.defineGroup({ id, label, visible? })` | Name a group and choose its default visibility. |
| `chart.marks.groups()` | The defined groups, in definition order. |
| `chart.marks.setGroupVisible(id, visible?)` · `isGroupVisible(id)` | The settings checkbox, from code. |
| `chart.marks.supported` | Whether the active renderer paints marks. |
| `chart.renderer.set('marks', …)` | The lane's display state: `false`/`true`, or `{ visible?, groups? }`. |
| `chart.on('mark:click', cb)` | `{ id, ids, time, group? }` on every glyph click. |

The type-level detail lives in the [API reference](./api-reference.md#chartmarks--the-timeline-marks-control-surface).
