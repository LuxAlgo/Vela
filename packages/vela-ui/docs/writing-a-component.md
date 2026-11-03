# Writing a component

Each component is **one file**, `src/components/<name>.ts`, published at
`@luxalgo/vela-ui/<name>`, holding its declaration, its variants, its CSS and its
`create<Name>` function. Overlays (menu, dialog, drawer, tooltip) and composite controls (tabs,
toggle group) run a [Zag.js](https://zagjs.com) state machine, which owns their keyboard
behavior and accessibility; form controls keep small vanilla state objects.

## One file per component

Start one with `npm run new-component -- gauge` at the repo root: it writes the file in the
shape below, adds its declaration to the theme, and writes its test. A component file reads
top to bottom:

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

Then add the declaration to `ComponentDefs` in `src/lib/theme.ts`
(`gauge: typeof gaugeDef;`), which types the component's settings and parts in a theme. The
build fails while one is missing. The manifest (`dist/manifest.json`), the theme's JSON
Schema and `llms.txt` are generated from the file at build time, so there is nothing else to
list.

Released components keep their class (`new Switch(…)`, `new Tooltip(trigger, …)`) and their
controller (`switchController`, `tooltipController`) next to the `create…` function; the
class is the instance the function returns. New components start from the shape above.

## The helpers (`src/lib/`)

- **`h(tag, props, ...children)`** builds an element, typed by its tag. `slot` writes the
  `data-slot`, `data` the `data-*` attributes (`true` writes an empty value, `false` and
  `null` nothing), `attrs`, `on` and `text` the rest. Class names are layout hooks, never the
  styling contract.
- **`css`** marks a template as CSS (editors highlight it, stylelint checks it) and
  **`defineStyles(id, text)`** returns the injector a component calls at creation, never at
  import: it declares the layer order once per document or shadow root, then injects the
  sheet, id-guarded.
- **`t`** reads the design tokens: `${t.radius.md}` prints `var(--vela-radius-md)`, and a
  name that does not exist fails the typecheck. A test checks that `t` and the tokens the
  theme writes match in both directions.
- **`variants(spec)`** turns `{ variant: [...], size: [...] }` into the `data-*` attributes
  the CSS keys on, and types the props through `VariantProps`.
- **`defineComponent({ name, parts, settings })`** links a name to its CSS: `slot(part)` is
  the part's `data-slot` (`name` for `root`, `name-part` otherwise), and `vars.<setting>`
  prints `var(--vela-<name>-<setting>, <default>)`.
- **`addSlot(el, part)`** adds a part to an element's slot. A shell one component owns and
  another builds on carries both, `data-slot="popover-content select-content"`, and CSS
  matches either with `[data-slot~='…']`.

## CSS rules

- Everything sits in **`@layer vela.ui`**, below unlayered CSS, so a page's own rule wins
  without `!important` or a more specific selector. Selectors start with one of the
  component's own parts (`[data-slot='gauge-needle']`), nest with `&`, and key on state
  attributes (`data-state`, `data-selected`, `aria-expanded`), never on classes.
- A root that can be `hidden` takes its `display` under `:where(:not([hidden]))`: any
  authored `display` beats the browser's `[hidden]` rule. A rule that depends on an ancestor
  (the mobile layout) reads `&:is([data-layout='mobile'] *)`, which keeps the selector's
  weight.
- Values come from `t` or the component's settings; durations from `t.dur`; directions are
  logical (`padding-inline`, `inset-inline-end`, `text-align: start`).
- `npm run lint` (at the repo root) checks every template with stylelint and the postcss-lit
  syntax, through the package's shared config (`@luxalgo/vela-ui/stylelint`, which Vela's
  chrome, Pro and a host's own components extend with their own layer): the `vela/layer`,
  `vela/slot-scope`, `vela/token-values` and `vela/no-raw-token-var` rules, no hex or named
  colors, no class or id selectors, no `!important`, no
  `box-sizing: content-box` (the kit's border-box reset is unlayered: size the full box
  instead). A template the parser cannot read fails the run instead of going unchecked.
- The build flattens the nesting (Lightning CSS) for the browsers that brought `@layer`:
  Chrome and Edge 99, Firefox 97, Safari 15.4. The tests and the playground run the nested
  source.
- Three rules stay outside the layer on purpose, each next to a comment saying why: the
  kit's border-box reset, the field rows' dimmed state, and the reset of a dragged dialog's
  offset in the mobile layout.

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

Form controls skip Zag: a small state object (getters, `set*` / `sync` that do not emit, and
the one method that does) lets a host refresh rewrite the displayed value without firing
`onChange`.

## Rules (learned the hard way)

- **Always pass a `machineId` to `spreadProps`** (the `mid` above). Two machines sharing one
  element under the default scope wipe each other's listeners.
- **Zag trigger props overwrite the element's DOM `id`.** To compose several machines on one
  trigger, share the id through the machines' `ids` prop (see the `triggerId` option on
  Tooltip and Menu).
- **Dialog-like machines expect conditional rendering**: their props carry no `hidden`;
  toggle visibility from `api.open` in your render (tooltip and menu props do carry it).
- **Never hard-code colors.** The tokens derive from the theme (`src/lib/tokens.ts`), and the
  fixed brand and meaning colors live in `src/lib/palette.ts`. A test fails on a stray hex
  literal.
- **Take icons from the registry** (`src/lib/icons.ts`) rather than inlining SVG: 16×16 at
  stroke 1.2 for UI chrome, 24×24 at stroke 1.8 for drawing tools, always `currentColor`.
- **No imports from Vela.** The kit is used without the chart; what it needs lives in
  `src/lib/`.
- Floating layers mount into the nearest `.vela-ui` host, which carries the theme; use the
  `vela-ui-layer` class on portaled positioners. Popovers call `ensureUIHost` on show, so a
  list portaled to the body still has the theme. A component built before its trigger is in
  the DOM needs an explicit `host`: the `closest()` fallback portals to the body, outside the
  theme.
- Keyboard-facing components report open and close through an `onOpenChange` option, so a
  host can scope its keyboard shortcuts while they are open.
- A component that opens and closes a surface **announces it** with `announceSurface`
  (`@luxalgo/vela-ui/surface-events`): open once the surface shows, close while it still
  shows (before a fade-out, `hidden`, or removal), so the event bubbles to the host.
- After announcing the close, run the hide or removal through `holdForExit`
  (`@luxalgo/vela-ui/surface-exit`), so hosts can animate it out by styling `data-closing`. It
  completes synchronously when no exit animation starts; keep the returned handle to
  `cancel()` it on a reopen and `finish()` it on teardown.
- The primitive's **root is one element**. Settings rows use `display: contents`, so a
  fragment of sibling nodes would fall onto the pane grid as extra tracks.
