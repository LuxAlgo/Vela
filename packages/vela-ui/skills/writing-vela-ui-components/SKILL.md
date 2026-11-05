---
name: writing-vela-ui-components
description: Writes new UI components with the @luxalgo/vela-ui authoring helpers (defineComponent, h, css, defineStyles, variants, t), customizes a kit component's markup or behavior by copying its source with "vela-ui add --source", and adds components to the kit itself. Use when no kit component fits, when a component must look or behave differently than its props and theme allow, when building a widget or panel for a Vela chart, or when a theme fails to restyle a hand-written component.
license: Apache-2.0
---

# Writing vela-ui components

## Choose the route

| Situation | Route |
| --- | --- |
| A kit component almost fits | Its props and the theme first (the `theming-vela-ui` skill) |
| A kit component needs other markup or behavior | `npx @luxalgo/vela-ui add <name> --source`: copies it into your project as `app-<name>`, yours to change; `npx @luxalgo/vela-ui diff app-<name>` shows upstream changes since |
| Nothing in the kit fits | A component of your own, in the shape below |
| You are working in the Vela repository | `npm run new-component -- <name>` and `packages/vela-ui/AGENTS.md` |

## The shape of a component

One file per component: its declaration, variants, CSS and `create<Name>` function.

```ts
// Gauge: a value between 0 and 100 on a track, in the loss tone above 75.
import { css, defineComponent, defineStyles, h, t, variants, type VariantProps } from '@luxalgo/vela-ui';

export const gaugeDef = defineComponent({
    name: 'gauge',
    parts: ['root', 'track', 'fill', 'label'],
    settings: { radius: t.radius.md, height: '8px' },
});

// A variant is fixed at creation; its first value is the default.
export const gaugeVariants = variants({ size: ['md', 'sm'] });

const injectStyles = defineStyles(
    'app-gauge',
    css`
        @layer vela.ui {
            [data-slot='gauge'] {
                gap: ${t.space[1]};
                color: ${t.fg};
                font-family: ${t.font};
                font-size: ${t.fontSize.md};

                &:where(:not([hidden])) { display: grid; }
                &[data-size='sm'] { font-size: ${t.fontSize.sm}; }
            }
            [data-slot='gauge-track'] {
                block-size: ${gaugeDef.vars.height};
                border-radius: ${gaugeDef.vars.radius};
                background: ${t.surface.sunken};
                overflow: hidden;
            }
            [data-slot='gauge-fill'] {
                block-size: 100%;
                background-color: ${t.profit};
                transition: inline-size ${t.dur.med} ${t.ease};

                &:is([data-level='high'] *) { background-color: ${t.loss}; }
            }
            [data-slot='gauge-label'] {
                color: ${t.fg.muted};
            }
        }
    `,
);

export interface GaugeProps extends VariantProps<typeof gaugeVariants> {
    value: number;
    label?: string;
}

export interface GaugeHandle {
    readonly el: HTMLElement;
    setValue(value: number): void;
    destroy(): void;
}

export function createGauge(props: GaugeProps): GaugeHandle {
    injectStyles(document);
    const fill = h('div', { slot: gaugeDef.slot('fill') });
    const el = h(
        'div',
        { slot: gaugeDef.slot('root'), attrs: gaugeVariants(props) },
        props.label ? h('span', { slot: gaugeDef.slot('label'), text: props.label }) : null,
        h('div', { slot: gaugeDef.slot('track') }, fill),
    );
    // A state that follows the value is a data attribute on the root, set on every update.
    const setValue = (value: number) => {
        const v = Math.max(0, Math.min(100, value));
        fill.style.inlineSize = `${v}%`;
        el.setAttribute('data-level', v > 75 ? 'high' : 'normal');
    };
    setValue(props.value);
    return { el, setValue, destroy: () => el.remove() };
}
```

## Rules

- **Base styles go in `@layer vela.ui`**, like the kit's. A theme's part CSS lives in
  `vela.custom`; in the same layer, your component's own rules would tie with it and win.
- **Selectors start with one of the component's parts** (`[data-slot='gauge-fill']`), nest
  with `&`, and key states on attributes (`data-state`, `data-tone`), never on classes.
- **Values come from the tokens (`t`) or the component's settings (`gaugeDef.vars`).** No color
  literals: a theme can then restyle everything.
- **A root that can be `hidden`** takes its `display` under `:where(:not([hidden]))`, or the
  browser's `[hidden]` rule loses to it.
- **Logical directions** (`padding-inline`, `inset-inline-end`, `text-align: start`), so the
  component mirrors in right-to-left layouts.
- **Floating content mounts in the nearest kit host.** Build menus and popovers your component
  opens with an explicit `host` when it may be built before it is in the page.
- **Release what runs.** A component that starts a state machine or page-wide listeners ties
  their teardown to its element with `ownTeardown(el, stop)`, so `disposeWithin(root)` reaches
  it even when nobody kept the handle.

## Make themes see it

1. Import the component before creating a theme that names it: `defineComponent` records it,
   and `checkTheme` then checks the theme's settings and parts for it.
2. Type it in themes by merging its declaration:

```ts
declare module '@luxalgo/vela-ui/theme' {
    interface ComponentDefs {
        gauge: typeof gaugeDef; // the key is the component's name: quote it if hyphenated ('risk-meter')
    }
}
```

A theme can then set ``components: { gauge: { height: '4px', css: { fill: css`…` } } }``, and a
wrong setting or part fails the typecheck. `createTheme` from `@luxalgo/vela` and
`@luxalgo/vela/ui` read the same declaration. To prove the typing in a test, pair a
`// @ts-expect-error` theme naming a wrong part with a valid theme that compiles, so the
expected error cannot come from the declaration failing to merge.

## Lint it

Extend the kit's stylelint config for CSS written with the `css` tag:

```js
// stylelint.config.mjs
export default { extends: ['@luxalgo/vela-ui/stylelint'], rules: { 'vela/layer': 'vela.ui' } };
```

It needs `stylelint`, `postcss-lit` and `stylelint-config-recommended` installed.

## Check your work

1. Typecheck.
2. Render it in a kit host (`ensureUIHost(el, createTheme())`, both from
   `@luxalgo/vela-ui/theme`) and inspect: every part carries its `data-slot`, variants appear
   as `data-*`.
3. `checkTheme({ components: { gauge: { radius: '2px' } } })` returns an empty list (it runs
   without a page).
4. A theme's part CSS restyles it in the browser (read `getComputedStyle`, not the source).

## Further reading

- `node_modules/@luxalgo/vela-ui/docs/writing-a-component.md`: the helpers, every CSS rule and
  the rules for components that run Zag state machines.
- `node_modules/@luxalgo/vela-ui/registry/<name>.ts`: each kit component's source as a copy
  imports it, a worked example for any pattern.
