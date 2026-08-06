# Settings rows — the declarative row kinds and how to add one

Chart types registered through `vela/plugin` can declare a **settings section** that the
chart-settings dialog renders as its own tab:

```ts
registerChartType({
    id: 'mytype',
    settings: {
        title: 'My Type',
        visibility: 'active',   // 'active' (default): tab shown only while the style is
                                // active; 'always': shown whenever the type is registered
        rows: [
            { kind: 'heading', label: 'Levels' },   // key-less: an in-tab group title, stores nothing
            { kind: 'toggle', key: 'highlights', label: 'Highlights', defval: true,
              colors: [{ key: 'highlightColor', label: 'Highlight color', defval: '#e0b400' }] },
            { kind: 'number', key: 'levels', label: 'Max levels', defval: 20, min: 5, max: 50, step: 1,
              when: { key: 'highlights', equals: true } },   // shown only while the toggle is on
            { kind: 'color',  key: 'buyColor', label: 'Buy color', defval: '#089981' },
            { kind: 'select', key: 'mode', label: 'Display', options: ['bid-ask', 'delta'], defval: 'bid-ask' },
            { kind: 'range',  label: 'Volume', minKey: 'minVolume', maxKey: 'maxVolume',
              defval: 0, min: 0, max: 1e9, step: 1, placeholder: 'Off' },
        ],
    },
});
```

## The data flow (one loop, no plugin wiring)

1. The dialog builds the tab from the descriptors, reading current values from the
   renderer config's `chartTypes[<id>]` bag (`defval` until first edit).
2. An edit emits a config patch `{ chartTypes: { [id]: { [key]: value } } }` — so the
   values **persist** through `getConfig()`/`applyConfig()` (templates, JSON export)
   automatically.
3. The renderer's `applyConfig` detects the per-type change, pushes the merged values on
   the type's **`<id>-settings` native-data channel** (its renderer layer receives them
   as `args.settings` on the next frame) and raises `onChartTypeSettingsChange` — which
   the core forwards to the type's data engine as `SeriesDataEngine.onSettings(values)`.

Nothing else to wire: declaring the section is enough for rendering, persistence, layer
delivery, and engine delivery.

## The row-kind contract

`SettingsRowDescriptor` (in `src/chart-types/registry.ts`) is a **discriminated union on
`kind`**. Each value variant carries its `key` (the storage key inside the type's bag), a
`label`, its `defval`, and kind-specific fields. Values are stored as-is (`boolean` /
`number` / `string`). The `heading` variant is the exception: label only, no key and no
stored value — it renders as a group title inside the tab, so a large section can be
organized without splitting into multiple tabs.

Two kinds bundle several values on one row, which keeps panes STATIC where a
conditionally revealed row would jump the layout:

- **`toggle` with `colors`** — inline color swatches on the toggle's row (each swatch a
  `{ key, label, defval }`, the label its tooltip). The swatches dim and ignore input
  while the toggle is off. Prefer this over a separate `color` row gated on the toggle
  whenever the toggle governs one or two colors.
- **`range`** — a min–max pair (`minKey`/`maxKey`, both seeded from the shared
  `defval`). With `placeholder`, an input at the default renders empty showing it, and
  clearing an input stores the default back — the placeholder names the unset state
  (`'Off'` for 0-disables bounds).
- **`select` options** may be bare strings (value = label) or `[value, label]` pairs
  when the stored id differs from the display text (`['bidAskProfile', 'Bid × Ask Profile']`).
- **Subsection `enableKey`** — while that bag boolean is false, every row except the
  matching toggle stays visible but soft-disabled (grayed / non-interactive), so the
  pane remains browseable with the feature off. Put the toggle inside a group (e.g.
  Display), not above the TOC.

### Conditions (`when`)

Every row — headings included — may carry a **`when` gate**: a `SettingsRowCondition`
(`{ key, equals }` or `{ key, anyOf: [...] }`) or a readonly array of them (AND-ed). The
row is shown only while the gate passes against the section's **current values** (stored
value, else that key's `defval`). The dialog re-evaluates gates live on every edit — no
rebuild — so dependent rows appear exactly when they matter (e.g. a manual-size input
only while `sizeMode` is `'manual'`, mode-specific colors only in that mode). The
evaluation helper is exported as `settingsRowVisible(when, bag)`.

Gated values are **still stored and delivered** — hiding a row never clears its value;
consumers decide what a hidden-but-set value means (usually: the gating toggle already
disables the feature).

### Structured sections: instances, group TOC, subsections, placement

A big section can go beyond the flat form. Instead of `rows`, declare **`instances`**:
the pane then opens with an **instance tab strip** — one tab per *present* instance, a
dashed `+` that turns on the next absent one, and an `×` on the active removable tab.
Presence is the boolean at the instance's `enableKey` (in the same per-type bag); an
instance without `enableKey` is always present and not removable (the base instance).

```ts
settings: {
    title: 'My Type',
    placement: 'after-symbol',            // rail position: right under Symbol ('end' = default)
    instances: [
        { label: 'Block 1', rows: block('') },                          // base — not removable
        { label: 'Block 2', enableKey: 'b2Enabled', rows: block('b2') },  // '+' adds, '×' removes
    ],
    subsections: [
        { title: 'Overlay', rows: overlayRows },   // indented rail entry under the tab
    ],
},
```

Inside an instance (and inside every subsection) the `heading` rows become a **group
TOC** on the left of the pane: selecting an entry shows only that group's rows. Rows
before the first heading form the *always block*, visible above every group (put an
enable toggle there). A group whose rows are all gated out by `when` — or whose heading's
own `when` fails — leaves the TOC; the TOC hides entirely when no group is live, which is
how a subsection collapses to just its enable toggle while switched off.

**`subsections`** add indented entries under the section's rail tab, each with its own
pane of rows (same TOC treatment). **`placement: 'after-symbol'`** puts the tab (and its
subsections) directly under Symbol instead of after the built-in tabs.

Everything stays **one flat per-type bag**: instance and subsection keys are ordinary
keys (use a prefix convention like `b2Size`), `+`/`×` just write the `enableKey` boolean,
and consumers keep receiving a single object — the structured form is pure dialog
presentation.

## Adding a NEW row kind

Three touch points, in order:

1. **The type** — add a variant to the `SettingsRowDescriptor` union in
   `src/chart-types/registry.ts` (keep it serializable: descriptors are data, never DOM
   or callbacks — that is what keeps them projectable by any view layer, React included).
2. **The dialog renderer** — in `src/renderers/native/chrome/SettingsDialog.ts`, extend
   the `section.rows` loop (search `emitType`) with a branch for the new `kind`, reusing
   or adding a row helper (`boolRow`, `numberRow`, `colorRow`, `selectRow`, `toggleRow`
   with swatches, …). Read the current value from the bag with a **type guard** falling
   back to `defval`; write through `this.emitType(def.id, row.key, value)`.
3. **The docs** — add the variant to the example above and to
   [contributing/plugin-sdk.md](../contributing/plugin-sdk.md).

Consumers (layers via `args.settings`, engines via `onSettings`) receive the raw stored
value — a new kind needs no changes on their side.

## Rules

- Keys are scoped per type id — no cross-type collisions, no global registry.
- Descriptors must stay pure data (serializable) — the persistence and channel layers
  `structuredClone`/spread them freely.
- `visibility: 'active'` is the default on purpose: a type's knobs appear when its style
  is on screen, mirroring how the per-style cosmetic sections behave in the Symbol tab.
