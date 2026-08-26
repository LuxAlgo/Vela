# Settings rows — the declarative row kinds and how to add one

Chart types registered through `@luxalgo/vela/plugin` can declare a **settings section** that the
chart-settings dialog renders as its own tab:

```ts
registerChartType({
    id: 'mytype',
    settings: {
        title: 'My Type',
        visibility: 'active',   // 'active' (default): tab shown only while the style is
                                // active; 'always': shown whenever the type is registered
        rows: [
            { kind: 'heading', label: 'Levels' },   // key-less: TOC group (or flat in-tab title)
            { kind: 'toggle', key: 'highlights', label: 'Highlights', defval: true,
              colors: [{ key: 'highlightColor', label: 'Highlight color', defval: '#e0b400' }] },
            { kind: 'header', label: 'Colors' },    // in-group subgroup title (not a TOC entry)
            { kind: 'number', key: 'levels', label: 'Max levels', defval: 20, min: 5, max: 50, step: 1,
              when: { key: 'highlights', equals: true } },   // shown only while the toggle is on
            { kind: 'color',  key: 'buyColor', label: 'Buy color', defval: '#089981' },
            { kind: 'select', key: 'mode', label: 'Display', options: ['bid-ask', 'delta'], defval: 'bid-ask' },
            { kind: 'range',  label: 'Volume', minKey: 'minVolume', maxKey: 'maxVolume',
              defval: 0, min: 0, max: 1e9, step: 1, placeholder: 'Off' },
            { kind: 'row',    label: 'Imbalance',                 // the COMPOSITE row: any
              toggle: { key: 'imb', defval: false },              // mix of inline controls
              controls: [
                  { kind: 'select', key: 'imbMode', label: 'Mode', options: ['ratio', 'diff'], defval: 'ratio' },
                  { kind: 'number', key: 'imbPct', label: 'Threshold (%)', defval: 300, min: 100, max: 900 },
                  { kind: 'color',  key: 'imbInk', label: 'Highlight', defval: '#e0b400' },
              ] },
        ],
        // layout: 'grouped',  // promote the headings to a group TOC beside the rows
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

## The row contract — one composite shape, sugar on top

`SettingsRowDescriptor` (in `src/chart-types/registry.ts`) is a **discriminated union on
`kind`**. Two key-less variants organize the pane without storing values:

- **`heading`** — a GROUP title. Flat sections render it inline; structured
  `instances`/`subsections` (and `layout: 'grouped'` sections) promote it to the
  group TOC beside the rows.
- **`header`** — an in-pane subgroup title (same visual as a flat heading). Inside a
  structured pane it stays in the rows column so you can cluster rows *inside* a TOC
  group (Colors / Values under Display) without adding another TOC entry.

Every value row reduces to ONE canonical shape — the **composite `row` kind**: a label,
an optional leading **`toggle`** (`{ key, defval }`, a checkbox storing a boolean; while
off, the row's controls dim and ignore input), and an ordered list of **inline
controls** in the control column:

```ts
{ kind: 'row', label: 'Imbalance', toggle: { key: 'imb', defval: false }, controls: [
    { kind: 'select', key: 'imbMode', label: 'Mode', options: ['ratio', 'diff'], defval: 'ratio' },
    { kind: 'number', key: 'imbPct', label: 'Threshold (%)', defval: 300, min: 100, max: 900 },
    { kind: 'color',  key: 'imbInk', label: 'Highlight', defval: '#e0b400' },
] }
```

`SettingsInlineControl` kinds: **`number`** (compact input; with `placeholder`, an input
at the default renders empty showing it and clearing stores the default back — the
placeholder names the unset state, `'Off'` for 0-disables bounds), **`color`** (a swatch
opening the shared picker), **`width`** (the classic drawing-bar 1–5 px weights, each
option previewed as a line at that weight, storing a px number), **`select`** (options
may be bare strings or `[value, label]` pairs when the stored id differs from the
display text), and **`hint`** (display-only dimmed text between controls — the `–` of a
min–max pair, a unit; stores nothing). Each keyed control stores under its own bag key,
its `label` is its tooltip. Any mix, any order, no per-combination SDK surface — this is
what keeps panes STATIC where a conditionally revealed row would jump the layout.

A control may carry its own `when` gate (same shape as a row's): it appears and
disappears live as other values change, and is **exempt from the toggle-off dim** — its
gate already says when it matters, and it may exist specifically for the off state
(a mode's two colors while it is on, its one alternative while off).

The remaining kinds are **sugar** over the composite (see `normalizeSettingsRow`):

- **`toggle`** — a checkbox row; optional inline `number`, `colors` (swatches), and
  `width` attachments render in that order. Prefer inline attachments over separate
  rows gated on the toggle whenever the toggle governs one or two values.
- **`number` / `color` / `select`** — one control on its own row.
- **`range`** — a min–max pair (`minKey`/`maxKey`, both seeded from the shared
  `defval`), i.e. two number controls around a `–` hint, `placeholder` as above.

Prefer the sugar for the common shapes (it reads better); reach for `row` when the
combination has no sugar — never add a new one-off attachment field for it.

Two registry helpers keep every consumer on the same contract, both exported from
`@luxalgo/vela/plugin` (an alternate settings view — React, native menus — should render from
them, not re-interpret the union):

- **`normalizeSettingsRow(row)`** — the canonical composite shape of any value row.
- **`settingsRowValueKeys(row)`** — every key a row stores (`{ key, type, defval }`):
  what the dialog seeds from and what `factoryResetConfig` restores, so no key can fall
  through a kind-specific walk.

One more soft-disable seam: **subsection `enableKey`** — while that bag boolean is
false, every row except the matching toggle stays visible but soft-disabled (grayed /
non-interactive), so the pane remains browseable with the feature off. Put the toggle
inside a group (e.g. Display), not above the TOC.

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

The **indicator inputs dialog speaks the same condition vocabulary**: an `InputSchema`
may carry a `when` (`InputCondition` / `InputWhen`, evaluated by `inputVisible(when,
bag)`), and the gear dialog re-applies it live on every edit — rows hide and return,
a group heading or tab whose inputs are all gated out leaves with them, and hidden
inputs keep their values. Inputs sharing an `inline=` row show while any member's
gate passes.

**Duplicate keys across gated rows are supported.** Several `when`-gated rows may store
under the same key(s) — the pattern for per-mode rows over one shared state (each mode
gets its own row label, e.g. "Volume gradient" / "Delta gradient", while the gradient
toggle and colors stay one stored value). The dialog re-syncs every keyed control from
the values bag on each edit, so the hidden twins never show stale state when they come
back. Keep at most one such row visible at a time (mutually exclusive gates).

### Structured sections: instances, group TOC, subsections, placement

A big section can go beyond the flat form. The lightest upgrade is **`layout:
'grouped'`** on a rows-only section: the same rows render with their `heading`s promoted
to a **group TOC** — a sticky column inside the pane, to the right of the dialog's tab
rail — instead of inline titles (no instance strip). Beyond that, instead of `rows`,
declare **`instances`**:
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
TOC** on the left of the pane: selecting an entry shows only that group's rows. `header`
rows stay in the rows column as subgroup titles within the active group. Rows before the
first heading form the *always block*, visible above every group (put an enable toggle
there). A group whose value rows are all gated out by `when` — or whose heading's own
`when` fails — leaves the TOC; the TOC hides entirely when no group is live, which is
how a subsection collapses to just its enable toggle while switched off.

**`subsections`** add indented entries under the section's rail tab, each with its own
pane of rows (same TOC treatment). **`placement: 'after-symbol'`** puts the tab (and its
subsections) directly under Symbol instead of after the built-in tabs.

Everything stays **one flat per-type bag**: instance and subsection keys are ordinary
keys (use a prefix convention like `b2Size`), `+`/`×` just write the `enableKey` boolean,
and consumers keep receiving a single object — the structured form is pure dialog
presentation.

## Adding a NEW inline control kind

Because every value row renders through the composite path, new capability usually
means a new **inline control**, not a new row kind. Four touch points, in order:

1. **The type** — add a variant to the `SettingsInlineControl` union in
   `src/chart-types/registry.ts` (keep it serializable: descriptors are data, never DOM
   or callbacks — that is what keeps them projectable by any view layer, React included).
2. **The registry helpers** — extend `settingsRowValueKeys` with the new control's
   stored key(s)/type (and `normalizeSettingsRow` only if a new sugar kind maps to it).
   Seeding and factory reset then cover it with no further wiring.
3. **The dialog renderer** — in `src/renderers/native/chrome/SettingsDialog.ts`, add a
   branch to `inlineControl` building the control's DOM: read the current value from
   the bag with a **type guard** falling back to `defval`, write through `put(key,
   value)`.
4. **The docs** — add the variant to the list above and to
   [contributing/plugin-sdk.md](../contributing/plugin-sdk.md).

A genuinely new ROW shape (a different scaffold, not a different control) is a variant
of `SettingsRowDescriptor` plus a mapping in `normalizeSettingsRow` — the render path
stays untouched.

Consumers (layers via `args.settings`, engines via `onSettings`) receive the raw stored
value — a new kind needs no changes on their side.

## The visibility policy (host-hidden settings)

Hosts can hide any dialog entry via `VelaOptions.settings.hidden` /
`renderer.setSettingsVisibility` (see [options.md](../user/options.md)). For sections
declared here the ids are **implicit** — nothing to declare, nothing to wire:

- the tab is `type:<typeId>`, a subsection `type:<typeId>.<slug(title)>`;
- a value row is addressed by its stable bag key (`type:<typeId>.<key>` — composite
  rows by their toggle key, else their first control key), a `heading`/`header` by its
  label's slug. Hiding a heading takes its whole group, a header its subgroup.

The filtering happens at the DESCRIPTOR level in the dialog
(`filterHiddenRows` in `src/renderers/native/chrome/settings-visibility.ts`), **after**
seeding: the values bag still seeds from the full row set, so `when` gates keep reading
hidden keys' defaults, and hidden values keep persisting and reaching layers/engines —
the same "hidden ≠ cleared" contract as `when` itself. Rows sharing a key under
mutually exclusive gates share an id and hide together (they are one logical setting).
`renderer.listSettingsIds()` enumerates every addressable id, so hosts never read
plugin source to build a policy.

## Rules

- Keys are scoped per type id — no cross-type collisions, no global registry.
- Descriptors must stay pure data (serializable) — the persistence and channel layers
  `structuredClone`/spread them freely.
- `visibility: 'active'` is the default on purpose: a type's knobs appear when its style
  is on screen, mirroring how the per-style cosmetic sections behave in the Symbol tab.
