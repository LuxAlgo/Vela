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

## Reference

- `dist/manifest.json` (`@luxalgo/vela-ui/manifest.json`): every component's import, props,
  variants, parts and slots, settings, the tokens it reads and an example, generated from
  the source.
- `dist/theme.schema.json` (`@luxalgo/vela-ui/theme.schema.json`): the JSON Schema of a theme
  written to a file.
- `llms.txt`: a short index of the above, for coding agents.
- [Writing a component](docs/writing-a-component.md): the one-file shape and its rules.

ES modules only. Licensed under Apache-2.0.
