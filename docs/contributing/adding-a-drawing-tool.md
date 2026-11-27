# Adding a Drawing Tool

An **interactive drawing tool** is a tool a user places from the drawing toolbar: a trend line, a
Fibonacci variant, a pattern, an annotation. It is distinct from the lines and boxes a scripting
**engine** emits as output. There are two ways to add one to Vela™:

- **From outside Vela, with `defineDrawing`.** An app or a plugin registers the tool through the
  public plugin entry, with no fork and no change to this repository. This is the common case:
  see [Drawing tools — `defineDrawing`](./plugin-sdk.md#drawing-tools--definedrawing) in the plugin
  SDK.
- **In Vela's own source.** A tool that ships with the library is a class in the core drawings
  model. This page is for contributors taking that route.

For the user-facing catalogue see [Drawing tools](../user/drawing-tools.md); for *why* this model
lives in the core, see [ADR 0005](../architecture/adr/0005-core-owns-user-drawings.md).

The key fact holds for both routes: a drawing type is **renderer-agnostic and data-driven**. You
describe its anchors, geometry and settings as pure functions of *(anchors, projector)*;
interaction, persistence, undo, the settings popup and the toolbar entry then work without more
code. Most built-in tools are small because shared base classes absorb the geometry: a full
harmonic pattern leaf is around a dozen lines.

---

## The in-repo steps

Adding a built-in type touches a small set of extension points. No base class, port, facade or
painter *signature* changes.

1. **Add the key** to the `BuiltinDrawingType` union in `core/drawings/Drawing.ts`: the list of
   the tools Vela ships. `DrawingTypeKey` is that union plus any string a host registers, so the
   union is what gives `chart.drawings.setTool('…')` and `add('…')` their completions; it no
   longer limits which keys exist.

2. **Write the class** in `core/drawings/types/`. Extend the closest [shared base](#pick-a-base).
   The class declares `readonly type = '<key>' as const` and implements only the abstract methods
   the chosen base leaves open. From `Drawing` directly that is `anchorSchema`, `hitTest`,
   `hitHandle`, `handlePoints`, `bounds`, `priceRange` and `schema`; from a base, usually two to
   four.

3. **Register it.** Call `registerDrawingType({ type, group, label, icon, defaultStyle, create })`
   in `core/drawings/registry.ts`, **above the last lines of the file**: everything registered
   before them counts as built-in (`isBuiltinDrawingType`). The call feeds the factory that
   `add` and a loaded document use. `label` is a `msg('drawing.<key>.label', 'English')`
   (run `npm run i18n:extract` afterwards), `icon` is an inline SVG string, `defaultStyle` seeds
   the tool's first style, and `group` is the registry group: `lines`, `channels`, `pitchforks`,
   `shapes`, `annotations`, `stamps`, `fibonacci`, `geometry`, `patterns`, `measure` or
   `priceaction`.

4. **Export the class** from `core/drawings/index.ts`, the barrel the renderer imports from.

5. **Place it in the toolbar.** The Lines, Channels and Pitchforks sections list every tool of
   their registry group, so a tool in one of those groups needs nothing more. Every other
   section of the default toolbar is a fixed list in `core/drawings/toolbar.ts`
   (`FIBONACCI_TYPES`, `SHAPE_TYPES`, `MEASUREMENT_TYPES`, …): add the key to the list of the
   section the tool belongs to, or the default toolbar leaves it out. A brand-new section or
   toolbar button is an entry in `TOOLBAR_LAYOUT` in the same file.

6. **Paint it, only if its look is new.** Three cases:
   - The class extends a family the painter already handles by class (`SegmentDrawing`,
     `FibRatios`, `PatternDrawing`, `GlyphStamp`, …): the `instanceof` dispatch paints it. No
     renderer edit.
   - The class implements `shapes()` (it extends `ShapeDrawing`, or adds the method to another
     base): the painter draws the list it returns. No renderer edit either.
   - Anything else needs a branch in the native `DrawingPainter`. The built-in lines, callouts
     and pinned labels are each painted by their own type, so a new `TwoPointLine`,
     `CalloutBase` or `PinnedLabel` subtype needs its own branch, or `shapes()`.

That is the whole seam: **key → class → register → export → toolbar → (maybe) paint.** Then add
tests next to `test/drawings-*.test.ts`, and a row for the tool in the catalogue of
[Drawing tools](../user/drawing-tools.md), whose tool count goes up by one.

---

## Pick a base

Reach for the closest shared base. It supplies the geometry, hit-testing, schema and persistence,
so the leaf only describes what is unique. The plugin entry exports the same bases to tools
written outside Vela.

| Base | Use for | The leaf supplies |
|---|---|---|
| `Drawing` | a one-off shape unlike anything else | all the geometry methods + `schema()` |
| `ShapeDrawing` | a tool described by the shapes it paints | `anchorSchema()` + `shapes(ctx)`; optionally `defaultProps()`, `compute()`, `handles()`. Hit-testing, hover parts, handles and bounds derive from the shape list, and no painter branch is needed |
| `TwoPointLine` | two-anchor straight lines (extended line, info line, trend angle) | `type`, plus `hitTest` when the line runs past its anchors; painted by type |
| `SegmentDrawing` | multi-line tools (channels, pitchforks) | `geometry(proj)` → segments (+ optional fill); the same geometry feeds the painter |
| `FibRatios` | Fibonacci tools | `defaultLevels()` + `entryLines(proj)`; gets the editable per-level gear panel free |
| `FibLevels` (a `FibRatios`) | horizontal level tools between two anchors (retracement, extension) | `defaultLevels()`; optionally `levelPrice()` to change which anchor ratio 0 sits on. Level lines, fill bands, ratio and price text, and extend left/right are free |
| `RadialFib` (a `FibRatios`) | concentric-ring fibs (circles/arcs/wedge) | `radial(proj)` → center + radii/angles |
| `PatternDrawing` | fixed-vertex labelled patterns (XABCD, Elliott, H&S) | `vertexLabels()`; toggles for leg ratios / fill / neckline |
| `HarmonicPattern` (a `PatternDrawing`) | named harmonics (Gartley…Cypher) | `patternName()` + `ranges()` (four Fibonacci bands) — validation + badge are free |
| `CalloutBase` | 2-anchor pinned-box annotations (callout, comment, signpost) | `type` + optional `defaultLabel()`; differs only in the painter |
| `PinnedLabel` | single-anchor price-pinned labels (text, note, price label) | `type` + `schema()` + optional `labelText()` |
| `GlyphStamp` | single-anchor fixed-pixel unicode glyph stamps | `type` + `defaultGlyph()` |

---

## What you get for free

Because a drawing is described declaratively, the rest of the system reads those descriptions
rather than asking the type for behavior:

- **Interaction.** `placementMode()` (`'click'` | `'drag'` | `'freehand'`) tells the one interaction
  state machine how to place the tool — click-to-place, press-drag-release, or freehand capture —
  with no per-type interaction code. `anchorSchema()` drives how many anchors and which axis each is
  free on; `constrainHandleDrag` / `translateBody` / `onPlaced` re-impose any cross-anchor
  invariants. Handle `i` moves anchor `i` by default; a type with more handles than anchors
  overrides `dragHandle` to say which anchor coordinates each extra handle edits (the
  Rectangle's edge midpoints move one side each).
- **The settings popup.** `schema()` (dot-paths + control kinds, assembled from the reusable
  `LINE_FIELDS` / `FILL_FIELDS` / `TEXT_FIELDS` bundles) is rendered generically — no per-type UI.
- **Persistence, undo, clipboard.** The type serializes to plain JSON automatically; any per-instance
  extras go in `props` via `writeProps()` / `readProps()` so the base stays closed. Undo, copy/paste,
  and `toJSON`/`fromJSON` then work unchanged.
- **Culling and scale.** `timeExtent()` gates off-screen culling, and `priceRange()` reports the
  drawing's price span. A drawing does not move the pane's price scale unless its type opts in:
  with `autoscales()` returning `true`, the scale widens to keep that span in view.
- **The toolbar.** The registry entry and, for a fixed section, its list in `toolbar.ts`.

Keep the class **renderer-agnostic** — it must not import anything from `renderers/` (the import ACL
enforces this; see [ADR 0004](../architecture/adr/0004-enforce-layering-with-import-acl.md)). All
geometry is expressed against the `Projector` the renderer passes in; the class stores **data-space**
anchors (time + price) and never pixels.

---

## Optional hooks

The base class answers each of these with a default. Override one when the tool needs it.
`defineDrawing` maps its definition members onto the same hooks.

| Hook | Override it to |
|---|---|
| `placeAnchor(index, point, proj, preview)` | Map the point of a placement step to the anchor the drawing stores: constrain it, or read the chart at it. It runs for each click and, with `preview`, for the cursor between clicks, so the ghost shows what a click would commit. |
| `placementFinished()` | End the placement before `anchorSchema().max` points are in. Checked after every committed point. |
| `stepHint(index)` | Give each placement step its own prompt. `null` keeps the type's `placementHint`. |
| `angleSnaps()` | Let Shift lock a two-point drawing to 45° steps. |
| `shapes(ctx)` | Describe the drawing as a list of shapes: the paint seam a renderer draws as it is. |
| `shapeData(proj?)` | Supply the data `shapes()` and the other hooks read (`ShapeDrawing` adds the result of `compute` to it). |
| `hitInfo(px, py, proj, tol)` | Name the part under a pixel, with its cursor and its tip. `null` for a type without parts. |
| `onClick(part)` | Act on a click. Return `true` when the click changed the drawing: the chart saves the change in place of opening the settings bar. |
| `valueAt(time, proj?)` | Report the drawing's price at a time: what `chart.drawings.valueAt()` returns and an alert compares the price with. With `proj`, read a straight line as it is painted (`lineValueAt`). |
| `readout()` | Report values for the data window and `chart.drawings.readout()`. |
| `snapTargets()` | Offer points and levels to the magnet while another drawing is placed or reshaped. |
| `autoscales()` | Return `true` to make the pane's price scale keep the drawing in view. |
| `mount(host)` | Take over what the previous instance of the drawing held. The renderer rebuilds its instances on every sync and hands each new one the instance it replaces (`host.prev`), plus `host.invalidate()` to ask for a repaint when an asynchronous result lands. |

---

## Worked shape: a thin harmonic leaf

A new harmonic pattern is the extreme case of "the base does the work" — it sets a name and its four
ideal Fibonacci bands, and `HarmonicPattern` handles the five XABCD vertices, the leg-ratio
computation, validity, and the painter badge:

```ts
import { msg } from '../../i18n/message';
import type { MessageLike } from '../../i18n/types';
import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

export class Gartley extends HarmonicPattern {
    readonly type = 'gartley' as const;
    patternName(): MessageLike {
        return msg('drawing.gartley.patternName', 'Gartley');
    }
    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.55, max: 0.68 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.13, max: 1.618 }, ad: { min: 0.74, max: 0.83 } };
    }
}
```

Add `'gartley'` to `BuiltinDrawingType`, register it
(`{ type: 'gartley', group: 'patterns', label: msg('drawing.gartley.label', 'Gartley'), icon, defaultStyle, create }`),
export it, and list it in `HARMONIC_TYPES`. It then appears in the Patterns button's Harmonics
section, places with five clicks, validates its legs, and persists — with no painter edit,
because `HarmonicPattern` already paints via the pattern branch.

The same leaf written **outside** Vela imports `HarmonicPattern` from `@luxalgo/vela/plugin`,
keeps a namespaced key, and skips the union and the toolbar list: see
[A tool as a class](./plugin-sdk.md#a-tool-as-a-class).

---

See also: [Plugin SDK — drawing tools](./plugin-sdk.md#drawing-tools--definedrawing) (a tool
defined from outside Vela) · [Adding a Renderer](./adding-a-renderer.md) (how a renderer
implements the drawings port) · [Drawing tools](../user/drawing-tools.md) (the user-facing
catalogue) · [ADR 0005 — Core owns user drawings](../architecture/adr/0005-core-owns-user-drawings.md).
