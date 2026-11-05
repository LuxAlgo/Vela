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

`up` and `down` are the candles' colors, and the `up`, `down`, `profit` and `loss` tokens
follow them. In Vela they are the candles' defaults: a chart's own `upColor` and
`downColor` options, and colors a user picks in its settings, win over them.

A theme of colors only is plain JSON that cannot break the UI: users can save their own, an
app can offer a picker, and an agent can write one. A theme file names the schema shipped in
the package, so editors and CI check it:

```json
{
    "$schema": "./node_modules/@luxalgo/vela-ui/dist/theme.schema.json",
    "colors": { "background": "#0f1117", "text": "#c9d1d9", "accent": "#7c3aed" }
}
```

## The tokens

Every token is a custom property, `--vela-<name>`; in a theme, `tokens` takes the name
without the prefix, and in a component's CSS `t` reads it (`${t.fg.muted}`).

| Group | Tokens | What they set |
| --- | --- | --- |
| Text | `fg`, `fg-muted`, `fg-faint`, `fg-bright`, `fg-on-fill` | body text, secondary text, placeholders and disabled text, emphasized text, ink on a saturated fill |
| Surfaces | `bg`, `surface`, `surface-elev`, `surface-overlay`, `surface-sunken` | the chart's background, panels, menus and popovers (opaque, above the chart), recessed fields |
| Lines | `border`, `border-strong`, `border-soft`, `border-faint`, `separator-hover-band`, `separator-hover-line` | borders, field borders, rules inside a panel, a divider under the pointer |
| States | `hover`, `hover-strong`, `active`, `focus`, `focus-soft`, `selected-bg`, `selected-fg`, `highlight` | hover and pressed washes, the focus ring, the selected chip and its ink, favorites |
| Brand and meaning | `accent`, `accent-bright`, `up`, `down`, `profit`, `loss`, `danger` | the brand color, the candles' colors, gains and losses, destructive actions |
| Depth | `shadow`, `shadow-dialog`, `backdrop` | floating surfaces, dialogs, the dim behind a dialog |
| Scrollbars | `scroll`, `scroll-size` | the thumb's color (the chart's border color by default) and the bar's width (5px) |
| Scale | `space-1`…`space-4`, `radius-sm`, `radius-md`, `radius-lg`, `font`, `font-size-sm`, `font-size-md`, `font-size-lg`, `dur-fast`, `dur-med`, `ease`, `z-tooltip`, `z-menu`, `z-dialog`, `z-popover` | spacing, corners, type, motion and stacking, the same in every theme |

The colors derive from the chart theme's seven fields, so a theme that sets only those
(or only `colors`) still sets every token.

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

`checkTheme(input)` lists what a theme gets wrong: unknown tokens, a component, setting or
part that does not exist (the kit's components, and those the page declared with
`defineComponent`), colors the theme cannot derive from (it reads `#rrggbb` and `rgb()`),
text with too little contrast on its background, ink with too little contrast on the accent,
and part CSS that is left out or reaches past the component's contract. `createTheme` warns
about each problem once. The typecheck catches the same names in TypeScript; this catches
them in a theme loaded from JSON or written in plain JavaScript, where nothing else would.

## Cascade layers

Every style the kit and Vela write sits in a cascade layer, declared once per document (or
shadow root) in this order, lowest first:

| Layer | Holds | Written by |
| --- | --- | --- |
| `vela.theme` | the tokens and the scale | `applyTheme`, or a built-in theme's CSS file |
| `vela.ui` | the kit's components | each component, when it is first created |
| `vela.chrome` | Vela's own chrome: toolbars, legends, the status line, dialog layouts | Vela |
| `vela.pro` | Vela Pro's features | Vela Pro |
| `vela.custom` | a theme's component `css` | `applyTheme` |
| no layer | your page's CSS | you |

A later layer wins over an earlier one whatever the selectors' weight, and CSS in no layer
wins over all of them, so a page overrides any of it without `!important`. Layers a page
declared before the first Vela stylesheet rank below Vela's. Write CSS that restyles
components into `vela.custom` to sit above the kit and below your page's other CSS.

A component of your own (built with the kit's helpers, or copied with `vela-ui add --source`)
puts its base styles in `vela.ui`, like the kit's, so a theme's part CSS and your restyles
reach it. In `vela.custom` its rules would tie with the theme's, and whichever stylesheet
loaded last would win, usually the component's own.

Unlayered CSS also reaches the kit when you did not mean it to: a global reset such as
`button { background: none; }` or `input { border: 0; }` now restyles the kit's buttons and
fields. Scope such rules away from Vela (`button:where(:not(.vela-ui *)) { … }`), or move them
into a layer declared before Vela's (`@layer reset;` first in your stylesheet).

## Overriding from a page's CSS

The theme layer sits below every other style, so a page's own CSS overrides any token without
`!important`. `[data-vela-theme]` reaches every themed host, chrome inside a chart included:

```css
[data-vela-theme] { --vela-accent: #7c3aed; }
```

## Scrollbars

Every scroller inside a kit host (`.vela-ui`) and its floating layers shows the same
scrollbar: thin, a rounded thumb, no track and no arrows. `scroll` colors the thumb and
`scroll-size` sets the bar's width; set them like any token:

```ts
createTheme({ tokens: { scroll: '#3b3f4a', 'scroll-size': '8px' } });
```

Chromium and Safari draw it from the `::-webkit-scrollbar` parts, Firefox from
`scrollbar-width` and `scrollbar-color`. Setting `scrollbar-width` or `scrollbar-color` on an
element switches Chromium back to its native bar, so a page that sets them on every element
(`* { scrollbar-width: thin; }`) brings the native bar back inside the chart too. Leave the
kit out of that rule, or reset it:

```css
.vela-ui, .vela-ui * { scrollbar-width: auto; scrollbar-color: auto; }
```

A scroller outside any kit host takes the same scrollbar with `overlayScrollbarCss(selector)`
(`@luxalgo/vela-ui/styles`).

## Without JavaScript

A page that uses the kit without building a theme can link a built-in theme as plain CSS; it
sets every token on the page root:

```html
<link rel="stylesheet" href="node_modules/@luxalgo/vela-ui/dist/themes/dark.css" />
```

Bundlers resolve `@luxalgo/vela-ui/themes/dark.css` and `@luxalgo/vela-ui/themes/light.css`.
