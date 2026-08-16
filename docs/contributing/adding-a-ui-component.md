# Adding a UI-kit component

`vela/ui` is a **headless-first** component kit: every component splits into a
framework-agnostic **controller** (behavior, no DOM) and a thin vanilla **view**
(DOM projection over the design tokens). Overlay chrome — menu, dialog, drawer,
tooltip — wraps a [Zag.js](https://zagjs.com) state machine. Form primitives
(switch, select, number-input, text-field, text-area, color-picker, popover,
field, glyph-select) use vanilla controllers so they can match existing settings
chrome without a behavior drift;
a later Zag adoption per component stays a controller-only swap.

A future React build reuses the controllers unchanged and swaps only the views —
so keep logic out of the view.

## The uniform skeleton

Every component lives in `src/ui/components/<name>/` with the same four files:

```
components/<name>/
├── controller.ts   # Zag machine mapping, or vanilla behavior (NO DOM)
├── view.ts         # vanilla DOM projection
├── styles.ts       # the component's CSS (a template-literal string over the tokens)
└── index.ts        # public re-exports
```

## 1 — controller.ts (Zag overlay)

Wrap the machine and map Vela-level options to machine props. Export an explicit
interface for the return type (TypeScript can't name Zag's inferred types portably):

```ts
import * as tooltip from '@zag-js/tooltip';
import { nextUid, normalizeProps } from '../../zag';

export interface TooltipControllerOptions { /* your option surface */ }

export interface TooltipController {
    machine: typeof tooltip.machine;
    props: Partial<tooltip.Props>;
    connect(service: tooltip.Service): tooltip.Api;
}

export function tooltipController(opts: TooltipControllerOptions = {}): TooltipController {
    return {
        machine: tooltip.machine,
        props: { id: nextUid('vela-tooltip'), /* map opts */ },
        connect: (service) => tooltip.connect(service, normalizeProps),
    };
}
```

Vanilla form primitives skip Zag: export a small state object (getters + `set*` /
`sync` that do not emit, plus the mutating method that does) so a `vela-sync`
refresh can rewrite the displayed value without firing `onChange`.

## 2 — view.ts

For overlay chrome, build your DOM, start the machine with `runMachine`, and
re-project the api's props on every notification with `spreadProps`:

```ts
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';

export class Tooltip {
    private readonly handle: HandleOf<typeof zagTooltip.machine>;

    constructor(trigger: HTMLElement, opts: TooltipOptions) {
        injectStyles(STYLE_ID, CSS, trigger.ownerDocument);
        const ctrl = tooltipController(opts);
        const mid = String(ctrl.props.id);
        this.handle = runMachine(ctrl.machine, ctrl.props, (service) => {
            const api = ctrl.connect(service);
            spreadProps(trigger, api.getTriggerProps(), mid);
            // …spread the other parts onto your elements
        });
    }

    destroy(): void {
        this.handle.stop();
    }
}
```

Form-primitive views construct DOM once, subscribe to clicks/input themselves, and
expose `setChecked` / `setValue` that call the controller's non-emitting `sync`.

## Rules (learned the hard way)

- **Always pass a `machineId` to `spreadProps`** (the `mid` above). Two machines sharing
  one element under the default scope wipe each other's listeners.
- **Zag trigger props overwrite the element's DOM `id`.** To compose several machines on
  one trigger, share the id through the machines' `ids` prop (see the kit's `triggerId`
  option on Tooltip/Menu).
- **Dialog-like machines expect conditional rendering** — their props carry no `hidden`;
  toggle visibility from `api.open` in your render (tooltip/menu props DO carry it).
- **Style through the tokens** (`--vela-*` custom properties) and inject the sheet with
  `injectStyles` (id-guarded, Shadow-DOM-friendly). Never hard-code colors: the tokens are
  derived from the theme in `src/core/tokens.ts`, and the fixed brand/meaning colors live in
  `src/core/palette.ts`. A test scans `src/` and fails on a stray hex literal.
- **Take icons from the registry** (`src/core/icons.ts`) rather than inlining SVG: 16×16 at
  stroke 1.2 for UI chrome, 24×24 at stroke 1.8 for drawing tools, always `currentColor`.
- Floating layers mount into the nearest `.vela-ui` host (token inheritance); use the
  `vela-ui-layer` class on portal-ed positioners. Kit popovers call `ensureUIHost` on show
  so a body-portaled list still has theme tokens.
- Keyboard-facing components integrate with `KeymapManager` scopes: report open/close via
  an `onOpenChange` option so hosts can push/pop the `'dialog'` scope.
- Renderer chrome that consumes the kit **imports the component folder**, not the
  `src/ui` barrel — otherwise Zag overlay machines get pulled into the native-renderer
  bundle. Hosts and plugins import from `@luxalgo/vela/ui`.

## Form primitives

`Switch`, `Select`, `NumberInput`, `TextField`, `TextArea`, `ColorField` /
`buildColorPicker`, `Popover`, the field layer (`fieldRow` / `fieldSection` /
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
  `combineColor` stay available from `@luxalgo/vela/ui` and the browser bundle.
- **Field layer** — `fieldGrid` / `fieldRow` / `fieldSection` / `buildFieldControl`
  turn a label + a control descriptor into the shared settings row. Chart settings,
  indicator inputs, and the drawing settings dialog all map their schemas through it.
  Rows use `display:contents` so a pane shares one label column (`max-content 1fr`).
- **`GlyphSelect`** / **`widthField`** — icon-rendered options in a popover. Chart
  settings' line-width field is the width preset.

The primitive's **root is one element**. Chart-settings rows use `display:contents`, so a
fragment of sibling nodes would fall onto the pane grid as extra tracks.

## 3 — export it

Re-export from `src/ui/index.ts`. If plugins should drive it with data descriptors
(menu items, actions), keep the descriptor type in the controller file — descriptors are
the currency the widget's contribution system projects.
