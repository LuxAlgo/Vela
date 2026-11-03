# What to change, and where

| To change | Where | It reaches |
| --- | --- | --- |
| Chart colors: background, candles, grid, axis text | the theme's seven chart fields, or `colors` in `createTheme` | the chart's canvas, and the tokens derived from them |
| Brand color, radius scale, font | `accent`, `radius`, `font` in `createTheme` | every component |
| One token | `tokens` in `createTheme`, or CSS on `[data-vela-theme]` | every component that uses it |
| A theme made of colors only | `createTheme({ colors })`; in Vela, `registerTheme` offers it in the chart settings | the chart and every component |
| One component's sizes, radius, weight or variant colors | its settings in `components`, or CSS on its `--vela-<component>-*` variables | that component everywhere |
| One component's whole look: shape, typography, states, decorations | its `css` in `components`, by part | that component wherever the theme applies |
| Anything else about one component's look | CSS on its `data-slot`, `data-variant`, `data-size` | that component everywhere |
| A component's behavior or markup | a component of your own, built from the kit's helpers ([Writing a component](writing-a-component.md)) | your screens |

`dist/manifest.json` lists each component's parts and their slots, its settings, its
variants and the attributes its CSS styles by. The chart's own canvas (candles, grid, axis
text) is drawn from the theme object, not from CSS, so those colors change through the theme
only.
