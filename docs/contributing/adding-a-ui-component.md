# Adding a UI-kit component

`vela/ui` is a **headless-first** component kit: every component splits into a
framework-agnostic **controller** (a [Zag.js](https://zagjs.com) state machine — behavior,
keyboard, ARIA, positioning) and a thin vanilla **view** (DOM projection over the design
tokens). A future React build reuses the controllers unchanged and swaps only the views —
so keep logic out of the view.

## The uniform skeleton

Every component lives in `src/ui/components/<name>/` with the same four files:

```
components/<name>/
├── controller.ts   # the Zag machine + Vela's option mapping (NO DOM)
├── view.ts         # vanilla DOM projection (subscribes to the machine)
├── styles.ts       # the component's CSS (a template-literal string over the tokens)
└── index.ts        # public re-exports
```

## 1 — controller.ts

Wrap the machine and map Vela-level options to machine props. Export an explicit
interface for the return type (TypeScript can't name Zag's inferred types portably):

```ts
import * as popover from '@zag-js/popover';
import { nextUid, normalizeProps } from '../../zag';

export interface PopoverControllerOptions { /* your option surface */ }

export interface PopoverController {
    machine: typeof popover.machine;
    props: Partial<popover.Props>;
    connect(service: popover.Service): popover.Api;
}

export function popoverController(opts: PopoverControllerOptions = {}): PopoverController {
    return {
        machine: popover.machine,
        props: { id: nextUid('vela-popover'), /* map opts */ },
        connect: (service) => popover.connect(service, normalizeProps),
    };
}
```

## 2 — view.ts

Build your DOM, start the machine with `runMachine`, and re-project the api's props on
every notification with `spreadProps`:

```ts
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';

export class Popover {
    private readonly handle: HandleOf<typeof zagPopover.machine>;

    constructor(trigger: HTMLElement, opts: PopoverOptions) {
        injectStyles(STYLE_ID, CSS, trigger.ownerDocument);
        const ctrl = popoverController(opts);
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

## Rules (learned the hard way)

- **Always pass a `machineId` to `spreadProps`** (the `mid` above). Two machines sharing
  one element under the default scope wipe each other's listeners.
- **Zag trigger props overwrite the element's DOM `id`.** To compose several machines on
  one trigger, share the id through the machines' `ids` prop (see the kit's `triggerId`
  option on Tooltip/Menu).
- **Dialog-like machines expect conditional rendering** — their props carry no `hidden`;
  toggle visibility from `api.open` in your render (tooltip/menu props DO carry it).
- **Style through the tokens** (`--vela-*` custom properties) and inject the sheet with
  `injectStyles` (id-guarded, Shadow-DOM-friendly). Never hard-code colors.
- Floating layers mount into the nearest `.vela-ui` host (token inheritance); use the
  `vela-ui-layer` class on portal-ed positioners.
- Keyboard-facing components integrate with `KeymapManager` scopes: report open/close via
  an `onOpenChange` option so hosts can push/pop the `'dialog'` scope.

## 3 — export it

Re-export from `src/ui/index.ts`. If plugins should drive it with data descriptors
(menu items, actions), keep the descriptor type in the controller file — descriptors are
the currency the widget's contribution system projects.
