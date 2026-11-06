# Changelog

All notable changes to `@luxalgo/vela-ui`, newest first. Vela's own changes, including how it
uses the kit, are in [Vela's changelog](../../CHANGELOG.md).

## [0.2.0]

### Added

- **A slider.** `@luxalgo/vela-ui/slider` holds a value on a track, dragged or moved with the
  arrow keys, Page Up/Down and Home/End. It reports every move, and once a drag ends it
  reports the settled value through `onValueCommit`, the moment for costly work such as a
  replay's seek.
- **Collapsible sections.** `@luxalgo/vela-ui/collapsible` shows and hides its content from a
  header: a section header with a count (a panel's drawers) or a small group label (a list's
  groups). A button of the host's, such as a row's chevron, can toggle it instead.
- **List rows.** `@luxalgo/vela-ui/item` is a row of a list (a watchlist, alerts, search
  results): media, a title over a description, figures, and buttons that can stay hidden
  until the row is hovered. A clickable row works with the keyboard and screen readers like
  a button, while the buttons inside it keep their own presses; a row with actions makes its
  text the button, as a button cannot hold other buttons. `createItemGroup` stacks rows, with
  a line between them on request; a labelled group is a `group` to screen readers, or the
  `role` you give it (`listbox` for option rows).
- **Sort buttons for lists that are not tables.** `@luxalgo/vela-ui/sort-button` is a column
  header that steps through its sort directions on each press, shows the current one with an
  arrow, and says it to screen readers.
- **A month grid.** `@luxalgo/vela-ui/month-grid` lays out a month of days with a figure each,
  tinted by its tone (a trading journal's P&L by day). Weeks start on the locale's first day,
  and the arrow keys walk the days.
- **Two-line tabs.** A tab's `description` puts a second line under its label, such as a day
  strip's date under its weekday.
- **Key caps and favorite stars in buttons.** A button's `keys` and `keysEnd` show key caps
  before or after its text (`↵ Open`). The `favorite` variant is a star that takes the
  favorites color while pressed. A toggle button can now flip itself (`defaultPressed`,
  `onPressedChange`) and show another icon while pressed (`iconPressed`).
- **A callout panel without a bubble.** `calloutPart(el, part)` makes an element a part of the
  callout bubble's deployed panel (`panel`, `title`, `text`, `actions`, `button`) and gives it
  that part's look, so a panel built elsewhere, such as a chart's timeline-mark popup, matches
  the bubble's, and a theme's `callout-bubble` parts restyle both.

### Fixed

- **What is on or chosen reads in the theme's selected colors.** A dropdown's switch rows, when
  on, fill like the Switch (`selected.bg`, the knob in `selected.fg`) instead of the accent,
  as does the slider's range and thumb, and a month grid marks today in bright, bold type:
  white on a dark theme, black on a light one.
- **The kit's styles stay inside the kit.** Once a page created a kit component, the kit's
  styles also reached the page's own components that use the same part names, such as a
  shadcn/ui select, switch or button, and restyled them. A component's styles now apply only
  inside kit hosts (`ensureUIHost`), the menus, dialogs and tooltips they open, and themed
  hosts, so the page's own components keep their look. A component mounted outside any kit
  host gets none of the kit's styles: mount it in one, as the README shows.

## [0.1.0]

### Added

- **The first release of Vela's component kit as a package of its own.** Buttons, badges,
  tabs, toggle groups, dialogs, drawers, dropdown and context menus, tooltips, hover cards,
  popovers, form controls (checkbox, switch, input and input group, text area, number field,
  select, color picker, date picker, the settings field layer) and data components (data
  table, stat, sparkline, donut, bar, line and scatter charts, key caps, empty states), one
  import path each (`@luxalgo/vela-ui/<name>`), so a bundle holds only what it imports. Every
  component is `create<Name>(props)`, returning a handle with its element and `destroy()`;
  overlays and composite controls run Zag state machines for their keyboard behavior and
  accessibility. `disposeWithin(root)` releases every control in a subtree you discard.
- **One typed theme config.** `createTheme` builds a theme from a brand color, a radius
  scale, a font, any token by name, each component's settings and, when settings are not
  enough, a component's CSS by part; `applyTheme` writes it once per document as a rule in
  the `vela.theme` cascade layer. `checkTheme` lists what a theme gets wrong, a theme of
  colors alone is plain JSON checked by the shipped JSON Schema, and the dark and light
  themes also ship as plain CSS files.
- **Styles that give way to yours.** Component CSS sits in the `vela.ui` cascade layer and
  styles parts by their `data-slot`, variants by `data-variant` and `data-size`, so a page's
  own CSS overrides it without `!important`. Every scroller inside a kit host shows one
  themeable scrollbar (`scroll`, `scroll-size`).
- **A reference inside the package.** `manifest.json` (every component's import, props,
  variants, parts, settings, the tokens it reads and an example), `theme.schema.json`, the
  guides (theming, what to change and where, writing a component) and `llms.txt` for coding
  agents, all generated from the source.
- **Agent skills.** Three skills in `skills/` teach a coding agent to use the components,
  theme them and write new ones, in the Agent Skills format: `npx skills experimental_sync`
  links them into a project once the package is installed, and `npx skills add LuxAlgo/Vela`
  installs them from the repository. `llms.txt` and the `AGENTS.md` block `add` writes point
  at them.
- **A command line and a lint config.** `npx @luxalgo/vela-ui add`, `diff`, `check` and
  `list`; `@luxalgo/vela-ui/stylelint` checks CSS written with the kit's `css` tag against the
  kit's rules.

ES modules only, for the browsers with `color-mix()`: Chrome and Edge 111, Firefox 113,
Safari 16.2.
