# Adding a Drawing Tool

This guide is for an engineer adding a new **interactive drawing tool** (a trend line, a Fibonacci
variant, a pattern, an annotation, …) to Vela™'s core drawings model. These are the tools a user
places with the toolbar — distinct from the lines/boxes a scripting **engine** emits as output. For
the user-facing catalogue see [Drawing tools](../user/drawing-tools.md); for *why* this model lives
in the core, see [ADR 0005](../architecture/adr/0005-core-owns-user-drawings.md).

The key fact: a drawing type is a **renderer-agnostic, data-driven** class. You describe its
anchors, geometry, and settings as pure functions of *(anchors, projector)*; interaction,
persistence, undo, the settings popup, and the toolbar entry then all work
**automatically**. Most tools are tiny because shared base classes absorb the geometry — a full
harmonic pattern leaf is around a dozen lines.

---

## The five-step seam

Adding a type touches a small, fixed set of extension points. No base class, port, facade, or
painter *signature* changes.

1. **Add the key.** Add your tool's string literal to the `DrawingTypeKey` union (in
   `core/drawings/Drawing.ts`). This is the only union edit; everything else keys off it. The key
   is the public identifier — what `chart.drawings.setTool('…')` / `add('…')` take.

2. **Write the class** in `core/drawings/types/`. Extend `Drawing` directly, or — preferably — a
   [shared base](#pick-a-base) when one fits. The class declares `readonly type = '<key>'` and
   implements only the abstract methods the chosen base leaves open (from `Drawing` directly that's
   `anchorSchema`, `hitTest`, `hitHandle`, `handlePoints`, `bounds`, `priceRange`, `schema`; from a
   base, usually just two to four).

3. **Register it.** Call `registerDrawingType({ type, group, label, icon, defaultStyle, create })`
   in `core/drawings/registry.ts`. This single call drives **both** the factory (deserialize /
   `add`) **and** the toolbar entry — there is no separate toolbar wiring. `group` buckets the tool
   in the toolbar (the existing groups are lines, channels, pitchforks, shapes, annotations, stamps,
   fibonacci, patterns, measure; a brand-new group also needs a label + position entry in
   `toolbar.ts`). `icon` is an inline SVG string; `defaultStyle` seeds the tool's first style.

4. **Export the class** from `core/drawings/index.ts` (the barrel the renderer imports from).

5. **Paint it — only if its look is new.** If the tool renders like a family the painter already
   handles (it extends `SegmentDrawing`, `FibRatios`, `PatternDrawing`, …) the
   `instanceof` dispatch already paints it — no renderer edit. Only a genuinely novel visual needs a
   new branch (or a `case` for a leaf shape) in the native `DrawingPainter`. This is the **only**
   renderer-side change, and often there is none. A new `CalloutBase` subtype is the exception: each
   existing subtype is individually hardcoded in `DrawingPainter`, so a new one needs its own
   `instanceof` branch there.

That's the whole seam: **key → class → register → export → (maybe) paint.**

---

## Pick a base

Reach for the closest shared base — it supplies the geometry, hit-testing, schema, and persistence,
so the leaf only describes what's unique.

| Base | Use for | The leaf supplies |
|---|---|---|
| `Drawing` | a one-off shape unlike anything else | all the geometry methods + `schema()` |
| `SegmentDrawing` | multi-line tools (channels, pitchforks) | `geometry(proj)` → segments (+ optional fill); the same geometry feeds the painter |
| `FibRatios` | Fibonacci tools | `defaultLevels()` + `entryLines(proj)`; gets the editable per-level gear panel free |
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
  invariants.
- **The settings popup.** `schema()` (dot-paths + control kinds, assembled from the reusable
  `LINE_FIELDS` / `FILL_FIELDS` / `TEXT_FIELDS` bundles) is rendered generically — no per-type UI.
- **Persistence, undo, clipboard.** The type serializes to plain JSON automatically; any per-instance
  extras go in `props` via `writeProps()` / `readProps()` so the base stays closed. Undo, copy/paste,
  and `toJSON`/`fromJSON` then work unchanged.
- **Culling.** `timeExtent()` gates off-screen culling. `priceRange()` reports the drawing's
  visible span (kept for a future per-drawing autoscale opt-in); user drawings do not expand
  the pane's scale today.
- **The toolbar.** The registry entry's `group` places it; nothing else.

Keep the class **renderer-agnostic** — it must not import anything from `renderers/` (the import ACL
enforces this; see [ADR 0004](../architecture/adr/0004-enforce-layering-with-import-acl.md)). All
geometry is expressed against the `Projector` the renderer passes in; the class stores **data-space**
anchors (time + price) and never pixels.

---

## Worked shape: a thin harmonic leaf

A new harmonic pattern is the extreme case of "the base does the work" — it sets a name and its four
ideal Fibonacci bands, and `HarmonicPattern` handles the five XABCD vertices, the leg-ratio
computation, validity, and the painter badge:

```ts
import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

export class Gartley extends HarmonicPattern {
    readonly type = 'gartley' as const;
    patternName(): string {
        return 'Gartley';
    }
    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.55, max: 0.68 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.13, max: 1.618 }, ad: { min: 0.74, max: 0.83 } };
    }
}
```

Register it (`{ type: 'gartley', group: 'patterns', label: 'Gartley', icon, defaultStyle, create }`),
export it, and it appears in the Patterns group, places with five clicks, validates its legs, and
persists — with no painter edit, because `HarmonicPattern` already paints via the pattern branch.

---

See also: [Adding a Renderer](./adding-a-renderer.md) (how a renderer implements the drawings port) ·
[Drawing tools](../user/drawing-tools.md) (the user-facing catalogue) ·
[ADR 0005 — Core owns user drawings](../architecture/adr/0005-core-owns-user-drawings.md).
