# Theming

A theme is data: the chart's colors and font, every design token, and the settings of each
component. `createTheme` builds one from a few choices; `applyTheme` writes it once per
document (or shadow root) as a rule in the `vela.theme` cascade layer, keyed by the host's
`data-vela-theme` attribute.

```ts
import { applyTheme, createTheme } from '@luxalgo/vela-ui/theme';

const theme = createTheme({
    base: 'dark',              // 'dark' (default), 'light', or a chart theme's seven fields
    accent: '#7c3aed',         // brand color; the ink on it is derived
    radius: 'sm',              // none | sm | md | lg: scales every radius token
    font: 'Inter, sans-serif',
    tokens: { 'surface-elev': '#1b1c22' },     // any token, by name
    components: { button: { radius: '2px' } }, // a component's own settings
});

applyTheme(document.getElementById('app')!, theme);
```

In Vela, pass the theme as the chart's `theme` option or to `setTheme`, and offer it in the
chart settings with `registerTheme({ id, label, theme })`.

## Themes from colors alone

`colors` builds a whole theme from a few colors: grid and border derive from the background
and the text, and light or dark is read from the background.

```ts
const paper = createTheme({ colors: { background: '#fdf6e3', accent: '#268bd2' } });
```

A theme of colors only is plain JSON that cannot break the UI: users can save their own, an
app can offer a picker, and an agent can write one. A theme file names the schema shipped in
the package, so editors and CI check it:

```json
{
    "$schema": "./node_modules/@luxalgo/vela-ui/dist/theme.schema.json",
    "colors": { "background": "#0f1117", "text": "#c9d1d9", "accent": "#7c3aed" }
}
```

## Component settings

Each component declares a few settings with defaults that point at shared tokens (the
button's `radius` defaults to `radius-md`), so a theme that sets nothing looks exactly as
before. Each is written as `--vela-<component>-<setting>`, so a host can also set one in
its own CSS. The `components` field is typed from the declarations: a component or a setting
that does not exist fails the typecheck. `dist/manifest.json` lists every component's
settings.

## Restyling a component completely

When settings are not enough, a component's `css` restyles its parts: shape, typography,
borders, shadows, every variant and state. It is keyed by the parts the component declares:

```ts
import { createTheme, css, t } from '@luxalgo/vela-ui';

const theme = createTheme({
    components: {
        button: {
            radius: '999px',
            css: {
                root: css`
                    text-transform: uppercase;
                    box-shadow: ${t.shadow};
                    &[data-variant='outline'] { border-width: 2px; }
                    &:hover:not(:disabled) { transform: translateY(-1px); }
                `,
                icon: css`order: 1;`,
            },
        },
    },
});
```

- **The name and the part pick the element.** `components.button.css.icon` becomes a rule on
  `[data-slot~='button-icon']`; `&` is that part, so its variants and states follow it.
- **Scoped to the theme.** Each part's rule sits under the theme's `data-vela-theme`, so two
  charts with two themes on one page each keep their own. Floating layers mount inside their
  themed host, so a select's list or a dialog's content is reached the same way.
- **In the last layer.** It goes into `@layer vela.custom`, after every layer of the kit, so
  it wins without `!important`; a page's unlayered CSS still beats it.
- **Flattened at run time**, one level: `&` rules, rules without `&` (descendants), and
  `@media`, `@supports` or `@container` around either. `@keyframes` and `@font-face` belong
  in the page's stylesheet; the part uses them by name.
- **Written against the public contract**: the parts, `data-variant`, `data-size`, and the
  state attributes (`data-state`, `data-selected`, `data-disabled`). Class names are not part
  of it; `checkTheme` flags them, and `!important`. The shared stylelint config
  (`@luxalgo/vela-ui/stylelint`) checks CSS written with the `css` tag in a project too.
- **Off for themes loaded from data.** CSS that was not written with the `css` tag (a saved
  JSON, a shared file, a generated theme) is left out unless the host passes
  `createTheme(input, { allowCss: true })`. CSS from someone else can restyle the page to
  mislead and can load remote images that leak what the page shows. Colors and settings carry
  no such risk.

CSS changes how a component looks, not its markup or behavior.

## Checking a theme

`checkTheme(input)` lists what a theme gets wrong: unknown tokens, colors the theme cannot
derive from (it reads `#rrggbb` and `rgb()`), text with too little contrast on its
background, ink with too little contrast on the accent, and part CSS that is left out or
reaches past the component's contract. `createTheme` warns about each problem once.

## Overriding from a page's CSS

The theme layer sits below every other style, so a page's own CSS overrides any token without
`!important`. `[data-vela-theme]` reaches every themed host, chrome inside a chart included:

```css
[data-vela-theme] { --vela-accent: #7c3aed; }
```

## Without JavaScript

A page that uses the kit without building a theme can link a built-in theme as plain CSS; it
sets every token on the page root:

```html
<link rel="stylesheet" href="node_modules/@luxalgo/vela-ui/dist/themes/dark.css" />
```

Bundlers resolve `@luxalgo/vela-ui/themes/dark.css` and `@luxalgo/vela-ui/themes/light.css`.
