---
name: theming-vela-ui
description: Themes and restyles Vela charts and @luxalgo/vela-ui components with createTheme - brand colors, light, dark and custom themes, design tokens, component settings, part-by-part CSS restyles, scrollbars, cascade layers and theme JSON files checked with checkTheme. Use when the user wants a chart or its menus, dialogs and controls to match a brand or design system, asks for a new theme, a color or radius change, a component restyle or a CSS override that does not stick, even if they only say "make the chart look like our app".
license: Apache-2.0
---

# Theming Vela and vela-ui

A theme is data built by `createTheme`. One theme reaches the chart's canvas (candles, grid,
axis text), Vela's chrome (toolbars, menus, dialogs) and every kit component.

## Where a change belongs

Pick the first row that can express the change; each later row is more specific and more
work to maintain.

| To change | Use |
| --- | --- |
| Background, text, candles, grid | `createTheme({ colors: { background, text, grid, border, up, down } })`; light or dark is read from the background |
| Brand color, corner roundness, font | `accent` (the same choice as `colors.accent`; the top-level one wins), `radius` (`none`, `sm`, `md`, `lg`), `font` |
| One design token | `tokens: { 'surface-elev': '#1b1c22' }` (name without `--vela-`) |
| One component's sizes, radius or colors | `components: { button: { radius: '2px' } }` (its settings) |
| A component's whole look | ``components: { button: { css: { root: css`…`, icon: css`…` } } }`` (its parts) |
| Scrollbars | tokens `scroll` (thumb color) and `scroll-size` (width) |

Token names, layers and the full rules are in `node_modules/@luxalgo/vela-ui/docs/theming.md`.
A component's settings, parts and the state attributes its CSS keys on are in
`node_modules/@luxalgo/vela-ui/dist/manifest.json` (`settings`, `parts`, `attributes`).

## Workflow

Copy this checklist and tick it off:

```
- [ ] 1. Start from colors: createTheme({ colors, accent, radius, font })
- [ ] 2. Adjust single tokens only where the derived ones miss
- [ ] 3. Use component settings before part CSS
- [ ] 4. Write part CSS with the css tag, against parts and data attributes
- [ ] 5. Run checkTheme(input) and fix every problem it names
- [ ] 6. Apply it (Vela: theme option or setTheme; elsewhere: ensureUIHost)
- [ ] 7. Check computed styles in the browser, menus and dialogs opened
```

## Applying a theme

In a Vela project, the theme functions come from `@luxalgo/vela`, and the `css` tag and the
tokens `t` from `@luxalgo/vela/ui`. In a project of components only, all of them come from
`@luxalgo/vela-ui/theme` (`css` and `t` from `@luxalgo/vela-ui`).

```ts
import { checkTheme, createTheme, registerTheme, type ThemeInput } from '@luxalgo/vela';
import { VelaWorkspace } from '@luxalgo/vela/workspace';

const input: ThemeInput = { colors: { background: '#0f1117', text: '#c9d1d9' }, accent: '#7c3aed', radius: 'md' };
const problems = checkTheme(input); // [] when every name is right; runs without a page, so in tests too
if (problems.length) console.warn(problems);
const brand = createTheme(input);

registerTheme({ id: 'brand', label: 'Brand', theme: brand }); // optional: lists it in chart settings
new VelaWorkspace('#chart', { symbol: 'BTCUSDT', theme: brand }); // or ws.setTheme(brand) later
```

On a page of components without a chart: `ensureUIHost(el, theme)` from
`@luxalgo/vela-ui/theme`. `applyTheme(el, theme)` only switches a host that already is one.

## Restyling a component by its parts

```ts
import { createTheme, css, t } from '@luxalgo/vela/ui'; // or '@luxalgo/vela-ui'

const theme = createTheme({
    components: {
        button: {
            radius: '999px',
            css: {
                root: css`
                    text-transform: uppercase;
                    &[data-variant='outline'] { border-width: 2px; }
                    &:not(:disabled):hover { box-shadow: ${t.shadow}; }
                `,
            },
        },
    },
});
```

- **Write it with the `css` tag.** CSS not written with the tag (a theme loaded from JSON) is
  dropped unless you pass `createTheme(input, { allowCss: true })`, and only do that for CSS
  you trust. A plain string still typechecks: `checkTheme` is what catches a missing tag.
- **A part's CSS overrides the component's own declarations it repeats.** A `background`
  shorthand on a fill erases the color the component sets for its state: add to it
  (`background-image`) or key the rule on the state attribute.
- **`&` is the part.** Key states on its data attributes (`data-state`, `data-selected`,
  `data-highlighted`, `data-variant`, `data-size`), never on class names, never `!important`.
- **A state can live on another part.** The switch's `data-state` sits on its root, so style
  the track from the root: ``root: css`&[data-state='checked'] [data-slot~='switch-control'] { … }` ``.
- **One level of nesting**, plus `@media`, `@supports` and `@container`. Declare `@keyframes`
  and `@font-face` in the page's stylesheet and use them by name.

## Gotchas

- **A misspelled component, setting or part does nothing.** `checkTheme(input)` names it,
  and `createTheme` warns about it once in the console. Run it on every theme you write.
- **`components.button` restyles the kit's buttons** (in dialogs, panels, your own UI). Vela's
  toolbars are its own chrome: tokens reach them, component settings do not.
- **Tokens derived from a `var()` cannot be computed.** When a color comes from the host's
  CSS variables (`accent: 'var(--primary)'`), also set the tokens derived from it, such as
  `'focus-soft'` and `'fg-on-fill'`.
- **Page CSS outside any layer beats the whole kit.** A global reset such as
  `button { background: none; }` now restyles the kit's buttons too: scope it with
  `button:where(:not(.vela-ui *))` or move it into a layer declared first (`@layer reset;`).
- **Native scrollbars inside the chart** mean the page sets `scrollbar-width` or
  `scrollbar-color` on every element; reset them for `.vela-ui, .vela-ui *`.
- **Your own components** put their base styles in `@layer vela.ui` so the theme's part CSS
  (in `vela.custom`) can restyle them; see the `writing-vela-ui-components` skill.

## Themes as JSON files

A theme of colors, tokens and settings is plain JSON. Point it at the schema so editors and
CI validate it, then load it with `createTheme(json)`:

```json
{
    "$schema": "./node_modules/@luxalgo/vela-ui/dist/theme.schema.json",
    "colors": { "background": "#fdf6e3", "text": "#586e75", "accent": "#268bd2" },
    "radius": "none"
}
```

`npx @luxalgo/vela-ui check` validates the file named by `theme` in `vela-ui.json` at the
project root.

## Check your work

1. `checkTheme(input)` returns an empty list.
2. In the browser, read the result, not the source: `getComputedStyle(el)` on a restyled
   part, with menus and dialogs opened, since they only exist while open.
