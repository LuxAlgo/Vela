# Adding a UI-kit component

The component kit behind the widget's chrome and the renderer's dialogs is its own package,
`@luxalgo/vela-ui` (`packages/vela-ui` in this repo), which `@luxalgo/vela/ui` re-exports.
Each component is **one file**, `packages/vela-ui/src/components/<name>.ts`, published at
`@luxalgo/vela-ui/<name>`, holding its declaration, its variants, its CSS and its
`create<Name>` function.

How to write one (the file's shape, the helpers, the CSS rules, Zag machines, and the rules
learned the hard way) is the package's own guide:
[packages/vela-ui/docs/writing-a-component.md](../../packages/vela-ui/docs/writing-a-component.md).
How a theme reaches a component is [packages/vela-ui/docs/theming.md](../../packages/vela-ui/docs/theming.md).
This page covers what is Vela's: where each component is used, and how Vela exports it.

## Using the kit inside Vela

- Renderer chrome that consumes the kit **imports the component's subpath**
  (`@luxalgo/vela-ui/<name>`), not the `src/ui` barrel, otherwise Zag overlay machines get
  pulled into the native-renderer bundle. Hosts and plugins import from `@luxalgo/vela/ui`.
- Keyboard-facing components report open and close through `onOpenChange`; Vela's chrome
  pushes and pops the `KeymapManager`'s `'dialog'` scope from it.
- Hosts animate a closing surface by styling `data-closing` (see
  [Animating closes](../user/workspace.md#animating-closes)).

## Form primitives

`Checkbox`, `Select`, `NumberInput`, `Input`, `TextArea`, `ColorField` /
`buildColorPicker`, `Popover`, `DatePicker`, the field layer (`fieldRow` / `fieldSection` /
`buildFieldControl`), and `GlyphSelect` / `widthField` are public
(`@luxalgo/vela/ui`). They are the shared controls behind the indicator dialog,
chart settings, and the drawing settings dialog. The drawing toolbar's compact
icon chrome (glyph dropdowns, color underline) stays purpose-built. Overlays
(`Dialog`, `DropdownMenu`, `Tooltip`) and the behavior of the checkbox, the number field, the
select's list and the color picker's opacity run on Zag machines.

- **`Popover`** — portal + placement (any `side` of the trigger, flipping to the opposite
  one near the edge; `align`, `sideOffset`, `alignOffset`; optional `matchWidth`) + a
  `collisionBoundary` (viewport, an element, or a rect getter) + capture-phase
  outside-dismiss + a process-wide single-open registry (`closeOpenPopovers`).
- **`Checkbox`** (formerly `Switch`, kept as a deprecated alias) — square check box.
  `size: 'md'` is 20px with `--vela-fg-bright` on-fill (settings dialogs); `size: 'sm'` is
  18px with `--vela-selected-bg` (compact chrome). A native checkbox underneath, so forms
  and assistive tech see a checkbox. `setChecked` does not emit.
- **`Select`** — trigger + portaled themed list (not the OS popup) with a hand-rolled
  overlay scrollbar. `md` is 34px/14px and fills its parent unless `fill: false`
  (the shared 100px settings column: a long current label ellipsizes, the open list
  still sizes to its longest item). `sm` is 28px/13px and hugs the widest option
  (max-width 200px). `setValue` does not emit.
- **`NumberInput`** — `commit: 'blur'` clamps and shows hover steppers (press-repeat
  400ms then 60ms); `commit: 'live'` emits per keystroke. Chart settings uses live
  commit with steppers on, at the same 34×100px field as the indicator dialog.
  `sync` / `setValue` do not emit.
- **`Input`** (formerly `TextField`, kept as a deprecated alias) — blur/Enter commit; `fill: false` is the same 100px column with
  ellipsized overflow. `setValue` does not emit.
- **`TextArea`** — blur commit, optional `autoGrow` / `maxLines`. Used by indicator
  `text_area` inputs and the drawing bar's label editor.
- **`ColorField`** / **`buildColorPicker`** — `circle` chip (settings dialogs: square
  swatch inset from a matching field border) or compact `square` trigger. `splitColor` /
  `combineColor` stay available from `@luxalgo/vela/ui` and the browser bundle. The
  opacity slider's `commit` option decides when a drag reaches `onChange`: `'live'`
  (default) on every move, for consumers that merely repaint (drawing styles, chart
  settings); `'release'` once on pointerup, for consumers that recompute (indicator
  inputs re-run the script over its whole history). The knob and readout follow the
  pointer either way.
- **Field layer** — `fieldGrid` / `fieldRow` / `fieldSection` / `buildFieldControl`
  turn a label + a control descriptor into the shared settings row. Chart settings,
  indicator inputs, and the drawing settings dialog all map their schemas through it.
  Rows use `display:contents` so a pane shares one label column (`max-content 1fr`).
- **`GlyphSelect`** / **`widthField`** — icon-rendered options in a popover. Chart
  settings' line-width field is the width preset.
- **`DatePicker`** — a month calendar whose header month and year open a twelve-month
  grid and a decade; `onPick` receives a local `YYYY-MM-DD`, `setValue` does not emit.
  Content only: the host (a `Popover`, a panel) owns the surface. The indicator dialog's
  `input.time` calendar is this component.
- **`CalloutBubble`** — a tinted icon circle whose optional click deploys a Popover
  panel of declarative text/button items (below, flipping above near the screen
  edge). The legend's contributed callouts (`registerLegendCallout`) and the
  statusline's market badge are both this component; tooltips stay the caller's.

The primitive's **root is one element**. Chart-settings rows use `display:contents`, so a
fragment of sibling nodes would fall onto the pane grid as extra tracks.

## Primitives

`Button`, `Tabs`, `ToggleGroup` and `Badge` are the kit's layout primitives.

Behavior:

- **`Tabs` and `ToggleGroup` run Zag machines** (`@zag-js/tabs`, `@zag-js/toggle-group`),
  which own roving focus, the keyboard and the ARIA; a React view runs the same machines
  through Zag's React adapter. Zag applies events on a microtask, so the components mirror
  the value for synchronous reads and keep `setValue` silent by swallowing the machine's
  report of a host write.
- **`Button` and `Badge` have no behavior to run**: their files build the element and
  write its attributes.

Every part carries a `data-slot` naming it (`button`, `button-icon`, `tabs-list`,
`tabs-trigger`, `tabs-content`, `toggle-group`, `toggle-group-item`, `badge`, `checkbox`,
`input-control`, `tooltip-content`, …), next to Zag's own `data-scope` / `data-part`
and state attributes (`data-selected`, `data-state`).

Variant, size, part and prop names follow shadcn's (`data-slot="tabs-trigger"`,
`variant: 'outline'`, `size: 'icon-sm'`, `defaultValue`, `onValueChange`), so a host built
on shadcn reads them without a glossary. Released components keep their option names
(`value`, `onChange`).

- **`createButton`** — `variant`: `default` (filled with the selection color: OK, Apply),
  `outline` (bordered: the dialogs' Cancel), `secondary` (a sunken fill), `ghost` (no
  border or fill until hovered), `destructive` (tinted with `--vela-danger`), `link`.
  `size`: `xs` 26px, `sm` 30px (panels), `default` 34px (dialog footers), `lg` 40px
  (touch); `icon-xs`, `icon-sm`, `icon`, `icon-lg` are the same heights, square, showing
  only `icon` (`label` names them). `icon` sits before the text and `iconEnd` after it
  (`data-icon="inline-start"` / `"inline-end"`); `pressed` makes a toggle (`aria-pressed`);
  a button that opens a menu keeps its hover look while `aria-expanded="true"`.
- **`createTabs`** — WAI-ARIA tabs over `items: { value, label }[]`: one tab stop on the
  selected tab, arrow keys along the `orientation` (mirrored for `dir: 'rtl'`), Home and
  End, disabled and hidden tabs skipped. `activationMode: 'automatic'` selects as focus
  moves; `'manual'` waits for Enter or Space. `panel(value, el)` makes `el` a tab's panel
  (linked, and hidden while another tab is selected); a strip that filters one view
  attaches none. `setHidden(value, true)` takes a tab out of the strip, and hiding the
  selected one selects the first available (notified); `trigger(value)` returns a tab's
  element. Variants: `default` (a tinted track, the island), `line` (the indicator
  dialog's underlined strip), `filled` (the symbol picker's strip), `soft` (the drawings
  drawer's strip), `nav` (a vertical settings rail). Only an inactive tab reacts to hover.
  `className` adds the host's layout of the strip.
- **`createToggleGroup`** — a few options (`items: { value, label, icon? }[]`) side by side
  on a tinted track. `type: 'single'` (default) is a radio group where one option is
  always chosen (a segmented control); `type: 'multiple'` toggles each option on its own
  (`aria-pressed`). The arrow keys move focus; Space and Enter press. `size` `default`
  32px or `sm` 28px, `fill` to share the parent's width, `iconOnly` with each label as its
  option's accessible name.
- **`createBadge`** — a short status label or a round `count`: `default`, `secondary`,
  `outline`, `destructive`, and the market colors `up` and `down`.

`setValue` / `setPressed` / `setItems` never notify; a user's click or key does, once, and
only when the value changed.

**Still candidates.** These surfaces style their own controls and could move onto the
primitives next: the settings dialog's rail (`nav` tabs) and its action buttons
(`secondary` buttons); the icon buttons of the pane controls, the cell controls, the object
tree and the legend rows (`ghost`, `icon-xs`); the bottom bar's session button and range
chips, and the timeframe drawer's chips (a single `ToggleGroup`); the drawing settings
panel's chips; the callout bubble's buttons.

## Menu rows

`DropdownMenu` (formerly `Menu`, kept as a deprecated alias) projects `MenuItemDescriptor` rows. Two opt-in options change how a row reads:

- **`checkmarks`** — a checked row shows a leading ✓ instead of the selected-row
  background wash. Pointer-anchored action menus (the chart's right-click menu) use it.
- **`iconBadges`** — a row's `icon` sits in a 24px rounded badge with a faint fill and a
  soft border; the glyph brightens on a hovered row and the badge inverts (a bright tile
  under a surface-colored glyph) on the selected one. The chart-style dropdown and the
  right-click menu use it. A level where some rows carry an icon reserves the badge
  column on all its rows so labels align; a level without icons keeps its natural left
  edge. With both options, the ✓ column leads and the badge follows.

Submenus inherit both options.

## Export it

The package publishes every file of `packages/vela-ui/src/components/` at its own subpath (one build entry each). Vela re-exports the kit from `src/ui/index.ts`: add the component's public names there, the `create…` function, its props and handle types, and anything a host needs (a descriptor type, a pure helper). The barrel lists names one by one, so a component file's other exports (its declaration, its CSS, internal helpers) stay internal. If plugins should drive it with data descriptors (menu items, actions), keep the descriptor type in the component file — descriptors are the currency the widget's contribution system projects.
