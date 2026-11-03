# Adding a UI-kit component

`@luxalgo/vela/ui` is the component kit behind the widget's chrome and the renderer's
dialogs. Each component is **one file**, `src/ui/components/<name>.ts`, holding its
declaration, its variants, its CSS and its `create<Name>` function. Overlays (menu, dialog,
drawer, tooltip) and composite controls (tabs, toggle group) run a
[Zag.js](https://zagjs.com) state machine, which owns their keyboard behavior and
accessibility; form controls keep small vanilla state objects.

## One file per component

A component file reads top to bottom:

```ts
// Gauge: … what it is and how it behaves, for the reader of the file.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

// Its name, its parts (each part's data-slot) and its settings (custom properties a theme
// or a host's CSS can set, with their defaults).
export const gaugeDef = defineComponent({ name: 'gauge', parts: ['root', 'needle'], settings: { radius: t.radius.lg } });

// Its variants: the names type the props, the first value is the default.
export const gaugeVariants = variants({ size: ['md', 'sm'] });

export interface GaugeProps extends VariantProps<typeof gaugeVariants> {
    value: number;
}

export interface GaugeHandle {
    readonly el: HTMLElement;
    setValue(value: number): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-gauge',
    css`
        @layer vela.ui {
            [data-slot='gauge'] {
                border-radius: ${gaugeDef.vars.radius};
                background: ${t.surface.sunken};

                &[data-size='sm'] { … }
                & > [data-slot='gauge-needle'] { color: ${t.accent}; }
            }
        }
    `,
);

class GaugeImpl implements GaugeHandle { … }   // methods shared across instances

export function createGauge(props: GaugeProps): GaugeHandle {
    return new GaugeImpl(props);
}
```

Released components keep their class (`new Switch(…)`, `new Tooltip(trigger, …)`) and
their controller (`switchController`, `tooltipController`) next to the `create…`
function; the class is the instance the function returns. New components start from the
shape above.

## The helpers (`src/ui/lib/`)

- **`h(tag, props, ...children)`** builds an element, typed by its tag. `slot` writes the
  `data-slot`, `data` the `data-*` attributes (`true` writes an empty value, `false` and
  `null` nothing), `attrs`, `on` and `text` the rest. Class names are layout hooks, never
  the styling contract.
- **`css`** marks a template as CSS (editors highlight it, stylelint checks it) and
  **`defineStyles(id, text)`** returns the injector a component calls at creation, never
  at import: it declares the layer order once per document or shadow root, then injects
  the sheet, id-guarded.
- **`t`** reads the design tokens: `${t.radius.md}` prints `var(--vela-radius-md)`, and a
  name that does not exist fails the typecheck. A test checks that `t` and the tokens the
  theme writes match in both directions.
- **`variants(spec)`** turns `{ variant: [...], size: [...] }` into the `data-*` attributes
  the CSS keys on, and types the props through `VariantProps`.
- **`defineComponent({ name, parts, settings })`** links a name to its CSS: `slot(part)`
  is the part's `data-slot` (`name` for `root`, `name-part` otherwise), and `vars.<setting>`
  prints `var(--vela-<name>-<setting>, <default>)`.
- **`addSlot(el, part)`** adds a part to an element's slot. A shell one component owns and
  another builds on carries both, `data-slot="popover-content select-content"`, and CSS
  matches either with `[data-slot~='…']`.

## CSS rules

- Everything sits in **`@layer vela.ui`**, below unlayered CSS, so a page's own rule wins
  without `!important` or a more specific selector. Selectors start with one of the
  component's own parts (`[data-slot='gauge-needle']`), nest with `&`, and key on state
  attributes (`data-state`, `data-selected`, `aria-expanded`), never on classes.
- A root that can be `hidden` takes its `display` under `:where(:not([hidden]))`; a rule
  that depends on an ancestor (the mobile layout) reads `&:is([data-layout='mobile'] *)`,
  which keeps the selector's weight.
- Values come from `t` or the component's settings; durations from `t.dur`; directions are
  logical (`padding-inline`, `inset-inline-end`, `text-align: start`).
- `npm run lint` checks every template with stylelint and the postcss-lit syntax: the
  `vela/layer`, `vela/slot-scope`, `vela/token-values` and `vela/no-raw-token-var` rules
  (`scripts/stylelint-plugin-vela.mjs`), no hex or named colors, no class or id
  selectors, no `!important`, no `box-sizing: content-box` (the kit's border-box reset is
  unlayered, as the chrome relies on it: size the full box instead). A template the parser
  cannot read fails the run instead of going unchecked.
- The build flattens the nesting (`scripts/flatten-css.mjs`, with Lightning CSS) for the
  browsers that brought `@layer`: Chrome and Edge 99, Firefox 97, Safari 15.4. The
  playground and the tests run the nested source.
- Three rules stay outside the layer on purpose, each next to a comment saying why: the
  kit's border-box reset, the field rows' dimmed state, and the reset of a dragged
  dialog's offset in the mobile layout.

## Zag machines

Wrap the machine in a controller function that maps the component's options to machine
props, with an explicit return interface (TypeScript cannot name Zag's inferred types
portably), then start it with `runMachine` and re-project the api's props on every
notification with `spreadProps`:

```ts
export function tooltipController(opts: TooltipControllerOptions = {}): TooltipController {
    return {
        machine: tooltip.machine,
        props: { id: nextUid('vela-tooltip'), /* map opts */ },
        connect: (service) => tooltip.connect(service, normalizeProps),
    };
}

// in the component class:
this.handle = runMachine(ctrl.machine, ctrl.props, (service) => {
    const api = ctrl.connect(service);
    spreadProps(trigger, api.getTriggerProps(), mid);
    // …spread the other parts onto their elements
});
```

Form controls skip Zag: a small state object (getters, `set*` / `sync` that do not emit,
and the one method that does) lets a `vela-sync` refresh rewrite the displayed value
without firing `onChange`.

## Rules (learned the hard way)

- **Always pass a `machineId` to `spreadProps`** (the `mid` above). Two machines sharing
  one element under the default scope wipe each other's listeners.
- **Zag trigger props overwrite the element's DOM `id`.** To compose several machines on
  one trigger, share the id through the machines' `ids` prop (see the kit's `triggerId`
  option on Tooltip/Menu).
- **Dialog-like machines expect conditional rendering** — their props carry no `hidden`;
  toggle visibility from `api.open` in your render (tooltip/menu props DO carry it).
- **Never hard-code colors**: the tokens are derived from the theme in
  `src/core/tokens.ts`, and the fixed brand/meaning colors live in `src/core/palette.ts`. A
  test scans `src/` and fails on a stray hex literal.
- **Take icons from the registry** (`src/core/icons.ts`) rather than inlining SVG: 16×16 at
  stroke 1.2 for UI chrome, 24×24 at stroke 1.8 for drawing tools, always `currentColor`.
- Floating layers mount into the nearest `.vela-ui` host (token inheritance); use the
  `vela-ui-layer` class on portal-ed positioners. Kit popovers call `ensureUIHost` on show
  so a body-portaled list still has theme tokens.
- Keyboard-facing components integrate with `KeymapManager` scopes: report open/close via
  an `onOpenChange` option so hosts can push/pop the `'dialog'` scope.
- A component that opens and closes a surface **announces it** with `announceSurface`
  (`src/ui/surface-events.ts`): open once the surface shows, close while it still shows —
  before a fade-out, `hidden`, or removal — so the event bubbles to the host. Hosts follow
  the chrome through these events instead of watching the DOM.
- After announcing the close, run the hide or removal through `holdForExit`
  (`src/ui/surface-exit.ts`) so hosts can animate it out by styling `data-closing` (see
  [Animating closes](../user/workspace.md#animating-closes)). It completes synchronously
  when no exit animation starts; keep the returned handle to `cancel()` it on a reopen and
  `finish()` it on teardown.
- Renderer chrome that consumes the kit **imports the component file**
  (`src/ui/components/<name>`), not the `src/ui` barrel — otherwise Zag overlay machines
  get pulled into the native-renderer bundle. Hosts and plugins import from
  `@luxalgo/vela/ui`.

## Form primitives

`Switch`, `Select`, `NumberInput`, `TextField`, `TextArea`, `ColorField` /
`buildColorPicker`, `Popover`, `DatePicker`, the field layer (`fieldRow` / `fieldSection` /
`buildFieldControl`), and `GlyphSelect` / `widthField` are public
(`@luxalgo/vela/ui`). They are the shared controls behind the indicator dialog,
chart settings, and the drawing settings dialog. The drawing toolbar's compact
icon chrome (glyph dropdowns, color underline) stays purpose-built. Overlay
chrome (`Dialog`, `Menu`) is Zag-driven; form primitives stay vanilla.

- **`Popover`** — portal + placement (below, flip above, `align` start/end, optional
  `matchWidth`) + clamp boundary (viewport, an element, or a rect getter) + capture-phase
  outside-dismiss + a process-wide single-open registry (`closeOpenPopovers`).
- **`Switch`** — square check-toggle. `size: 'md'` is 20px with `--vela-fg-bright` on-fill
  (settings dialogs); `size: 'sm'` is 18px with `--vela-selected-bg` (compact chrome).
  `role="switch"`. `setChecked` does not emit.
- **`Select`** — trigger + portaled themed list (not the OS popup) with a hand-rolled
  overlay scrollbar. `md` is 34px/14px and fills its parent unless `fill: false`
  (the shared 100px settings column: a long current label ellipsizes, the open list
  still sizes to its longest item). `sm` is 28px/13px and hugs the widest option
  (max-width 200px). `setValue` does not emit.
- **`NumberInput`** — `commit: 'blur'` clamps and shows hover steppers (press-repeat
  400ms then 60ms); `commit: 'live'` emits per keystroke. Chart settings uses live
  commit with steppers on, at the same 34×100px field as the indicator dialog.
  `sync` / `setValue` do not emit.
- **`TextField`** — blur/Enter commit; `fill: false` is the same 100px column with
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
`tabs-trigger`, `tabs-content`, `toggle-group`, `toggle-group-item`, `badge`, `switch`,
`text-field-input`, `tooltip-content`, …), next to Zag's own `data-scope` / `data-part`
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

`Menu` projects `MenuItemDescriptor` rows. Two opt-in options change how a row reads:

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

Add the component's public names to `src/ui/index.ts`: the `create…` function, its props and handle types, and anything a host needs (a descriptor type, a pure helper). The barrel lists names one by one, so a component file's other exports (its declaration, its CSS, internal helpers) stay internal. If plugins should drive it with data descriptors (menu items, actions), keep the descriptor type in the component file — descriptors are the currency the widget's contribution system projects.
