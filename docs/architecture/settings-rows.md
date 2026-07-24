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
            { kind: 'toggle', key: 'imbalances', label: 'Imbalances', defval: true },
            { kind: 'number', key: 'levels', label: 'Max levels', defval: 20, min: 5, max: 50, step: 1 },
            { kind: 'color',  key: 'buyColor', label: 'Buy color', defval: '#089981' },
            { kind: 'select', key: 'mode', label: 'Display', options: ['bid-ask', 'delta'], defval: 'bid-ask' },
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
`kind`**. Each variant carries its `key` (the storage key inside the type's bag), a
`label`, its `defval`, and kind-specific fields. Values are stored as-is (`boolean` /
`number` / `string`).

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
