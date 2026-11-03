# @luxalgo/vela-ui

The component kit of Vela: buttons, tabs, toggle groups, badges, dialogs, drawers, menus,
tooltips, popovers and form controls. One file per component, Zag state machines for
behavior, CSS in cascade layers over design tokens, and one typed theme config. It works
without the chart.

```ts
import { createButton } from '@luxalgo/vela-ui/button';
import { applyTheme, createTheme } from '@luxalgo/vela-ui/theme';

const app = document.getElementById('app')!;
applyTheme(app, createTheme({ accent: '#7c3aed' }));

const save = createButton({ text: 'Save', variant: 'default' });
app.append(save.el);
```

- **One import path per component** (`@luxalgo/vela-ui/<name>`), so a bundle holds only the
  components it imports. Every component is `create<Name>(props)`, returning a handle with
  `el` and `destroy()`.
- **Styles give way to yours.** Component CSS sits in the `vela.ui` cascade layer, so a
  page's own CSS overrides it without `!important`. Every part carries a `data-slot`;
  variants and sizes are `data-variant` and `data-size`.
- **One theme config.** `createTheme` sets the brand color, radius and font, any token by
  name, each component's settings, or a component's whole look; a wrong name fails the
  typecheck. See [Theming](docs/theming.md) and [What to change, and where](docs/what-to-change.md).

## Command line

| Command | Result |
| --- | --- |
| `npx @luxalgo/vela-ui add button` | makes `@luxalgo/vela-ui` a direct dependency and prints the button's import and an example |
| `npx @luxalgo/vela-ui add button --source` | copies the button's source into the project (`src/ui` by default) as a component of your own, `app-button` (`--as` names it), which never styles the package's button |
| `npx @luxalgo/vela-ui diff app-button` | what changed upstream since the copy was made; `--accept` records the copy as up to date |
| `npx @luxalgo/vela-ui check` | one copy of the package installed, no copy behind it, the theme file valid |
| `npx @luxalgo/vela-ui list` | the components |

A `vela-ui.json` at the project's root says where copies go and which theme file to check:
`{ "aliases": { "ui": "#ui" }, "theme": "brand.theme.json" }` (`#ui` is a package.json
`imports` alias, or write a folder). Copies are recorded in `vela-ui.lock.json`, with their
upstream version kept under `.vela-ui/`: commit both. The first `add` offers to add a note to
the project's `AGENTS.md` pointing coding agents at this package's reference.

## Reference

- `dist/manifest.json` (`@luxalgo/vela-ui/manifest.json`): every component's import, props,
  variants, parts and slots, settings, the tokens it reads and an example, generated from
  the source.
- `dist/theme.schema.json` (`@luxalgo/vela-ui/theme.schema.json`): the JSON Schema of a theme
  written to a file.
- `llms.txt`: a short index of the above, for coding agents.
- [Writing a component](docs/writing-a-component.md): the one-file shape and its rules.
- `@luxalgo/vela-ui/stylelint`: the shared stylelint config for CSS written with the `css`
  tag (tokens through `t`, no raw colors, logical directions, parts not classes). Extend it
  and name your layer: `{ extends: ['@luxalgo/vela-ui/stylelint'], rules: { 'vela/layer':
  'vela.custom' } }`. It needs `stylelint`, `postcss-lit` and `stylelint-config-recommended`.

ES modules only. Licensed under Apache-2.0.
