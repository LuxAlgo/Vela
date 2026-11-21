# @luxalgo/vela-ui

The component kit of Vela: buttons, tabs, toggle groups, badges, dialogs, drawers, menus,
tooltips, popovers, form controls, collapsible sections, list rows and data components (a
data table, sort buttons, a month grid, charts). One file per component, Zag state machines for
behavior, CSS in cascade layers over design tokens, and one typed theme config. It works
without the chart.

```ts
import { createButton } from '@luxalgo/vela-ui/button';
import { createTheme, ensureUIHost } from '@luxalgo/vela-ui/theme';

const app = document.getElementById('app')!;
ensureUIHost(app, createTheme({ accent: '#7c3aed' }));

const save = createButton({ text: 'Save', variant: 'default' });
app.append(save.el);
```

`ensureUIHost` makes the element a kit host: it carries the theme and the kit's base styles,
and menus, dialogs and tooltips opened from inside it mount there, themed. `applyTheme(app,
theme)` switches a host to another theme later.

- **One import path per component** (`@luxalgo/vela-ui/<name>`), so a bundle holds only the
  components it imports. Every component is `create<Name>(props)`, returning a handle with
  `el` and `destroy()`. When you discard a whole subtree, `disposeWithin(root)`
  (`@luxalgo/vela-ui/dispose`) releases every control in it, handles kept or not: controls
  that run a state machine must be released, not only removed, or their page-wide listeners
  stay behind. A destroyed dialog, drawer or popover releases its content itself.
- **Styles give way to yours.** Component CSS sits in the `vela.ui` cascade layer, so a
  page's own CSS overrides it without `!important`. Every part carries a `data-slot`;
  variants and sizes are `data-variant` and `data-size`. The kit's CSS applies inside kit
  hosts only, so the page's own components keep their look, even those that use the same
  part names.
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

## For coding agents

Three agent skills ship in `skills/`: [using the components](skills/using-vela-ui-components/SKILL.md),
[theming](skills/theming-vela-ui/SKILL.md) and [writing components](skills/writing-vela-ui-components/SKILL.md).
`npx skills experimental_sync` links them into a project's agent once the package is installed
(Vela's own package pulls them in too), and `npx skills add LuxAlgo/Vela` installs them from
the repository. [`llms.txt`](llms.txt) indexes them with the rest of the reference.

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
  and name your layer: `vela.ui` for components of your own, so themes restyle them like the
  kit's, and `vela.custom` for CSS that restyles components
  (`{ extends: ['@luxalgo/vela-ui/stylelint'], rules: { 'vela/layer': 'vela.ui' } }`). It
  needs `stylelint`, `postcss-lit` and `stylelint-config-recommended`.
  CSS outside the kit takes the tag and the tokens from `@luxalgo/vela-ui/css` and
  `@luxalgo/vela-ui/t`.
- `@luxalgo/vela-ui/stylelint/lint`: `lintCss({ files, baseline?, update? })` runs that config
  and fails when postcss-lit skips a template (it would pass while checking nothing). With a
  `baseline` file, CSS written before the rules keeps its known violations, counted per file
  and rule: the run fails when a count grows, and when one shrinks until `update: true`
  rewrites the file, so the baseline only tightens.

ES modules only. Licensed under Apache-2.0.
