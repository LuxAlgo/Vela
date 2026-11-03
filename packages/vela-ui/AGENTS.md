# Agent guide: @luxalgo/vela-ui

The component kit, a workspace package of the Vela repo. The repo's `AGENTS.md` governs
everything here (gate, commits, prose); this file adds the kit's authoring rules. The full
guide is [docs/writing-a-component.md](docs/writing-a-component.md).

- **One `.ts` file per component** in `src/components/`, exporting its declaration
  (`defineComponent({ name, parts, settings })`), its variants (`variants()`), and
  `create<Name>(props)` with its props and handle types. Add the declaration to
  `ComponentDefs` in `src/lib/theme.ts`; the build fails while one is missing.
- **Markup through `h()`**, slots from the declaration (`def.slot(part)`), tokens through
  `t`, settings through `def.vars`. No color literals: tokens derive from the theme, fixed
  colors live in `src/lib/palette.ts`.
- **CSS in `@layer vela.ui`**, selectors starting with one of the component's parts, state
  keyed on attributes, never classes; a root's `display` under `:where(:not([hidden]))`;
  logical directions. `npm run lint` at the repo root checks every template.
- **No imports from Vela.** The kit is used without the chart.
- **The reference is generated**: `npm run build -w @luxalgo/vela-ui` writes
  `dist/manifest.json`, `dist/theme.schema.json` and `llms.txt` from the source. Never edit
  them by hand.
- **Public names stay**: the package is published, and Vela re-exports it from
  `@luxalgo/vela/ui`. Renaming or removing an export is a breaking change.
