# Upgrading

## From 0.9 to 0.10

0.10 moves Vela's UI kit into a package of its own, `@luxalgo/vela-ui`, which Vela installs
as a dependency. `@luxalgo/vela/ui` keeps exporting the kit, so code written against it keeps
working: components renamed in this release answer to their old names until 0.11. A chart
built from options alone (`new Vela(…)`, `VelaWorkspace`) needs no change. The changes below
need action only if you use what they name.

### Breaking changes

- **`require('@luxalgo/vela')` needs Node 20.19 or 22.12 and later.** The kit ships as ES
  modules only, and Vela's CommonJS build loads it with `require()`. Import Vela as an ES
  module, or upgrade Node. Bundlers and ES module imports are not affected.
- **`tabsController` and `toggleGroupController` are gone**, with their `TabsController` and
  `ToggleGroupController` types. They handed out a state machine to wire up yourself; build
  the control with `createTabs` or `createToggleGroup` instead, which own it.
- **Tab and toggle items are keyed by `value`.** `TabItem` and `ToggleGroupItem` name their key
  `value` (it was `id`), matching every other control. The deprecated `Tabs` and `ToggleGroup`
  classes still accept items with `id`; code that annotates items with these types renames
  the field.
- **Theme tokens are a stylesheet rule, not inline styles.** Read a token with
  `getComputedStyle(el).getPropertyValue('--vela-accent')`; `el.style` no longer holds it.
  Your own CSS now overrides any token without `!important`.
- **The checkbox (`Switch` in 0.9) is a `<label>` around a native checkbox.** Its `el` is the
  label, no longer a `<button>`: set `disabled` through the options, read the state from
  `checked`. A click on `el` still toggles it.
- **The number field is a text input** (`inputmode="decimal"`, with the spinbutton role)
  rather than `type="number"`. Read the value from the control (`value`, `onChange`), not
  from the element's `valueAsNumber`.
- **Vela's styles sit in cascade layers.** The kit's components and Vela's chrome now give way
  to your page's CSS. That includes global resets: an unlayered `button { background: none; }`
  now reaches Vela's buttons. See
  [Cascade layers](../../packages/vela-ui/docs/theming.md#cascade-layers) for how to scope them.
- **Scripting engine.** `@luxalgo/vela-pinets` declares the Vela versions it supports; use a
  release whose peer range includes `^0.10.0`.

### Deprecated, removed in 0.11

Each old name below still works in 0.10 and is marked `@deprecated` in the types, so your
editor shows the replacement.

| 0.9 | 0.10 |
| --- | --- |
| `Menu`, `createMenu`, `menuController` | `DropdownMenu`, `createDropdownMenu`, `dropdownMenuController` |
| `Switch`, `createSwitch`, `switchController` (the square check box) | `Checkbox`, `createCheckbox`, `checkboxController`; in 0.11, `Switch` names the sliding switch (`@luxalgo/vela-ui/switch`) |
| `TextField`, `createTextField`, `textFieldController` | `Input`, `createInput`, `inputController` |
| `new Button(opts)`, `buttonController` | `createButton(opts)` |
| `new Badge(opts)`, `badgeController` | `createBadge(opts)` |
| `new Tabs({ items: [{ id, label }], value, onChange, tabClassName })`, `tab(id)`, `attachPanel(id, el)` | `createTabs({ items: [{ value, label }], defaultValue, onValueChange, triggerClassName })`, `trigger(value)`, `panel(value, el)` |
| `new ToggleGroup({ items: [{ id, label }], value, onChange })` | `createToggleGroup({ items: [{ value, label }], defaultValue, onValueChange })` |
| `gap` and `boundary` on the popover, the select's list and the callout bubble | `sideOffset` and `collisionBoundary` |
| `placement` on the menu and the tooltip | `side` and `align` |
| `onChange` on the checkbox and the select | `onCheckedChange`, `onValueChange` |
| `applyThemeTokens(el, theme)` | `applyTheme(el, theme)` |

### What looks different

Nothing here needs a change; it is what you will notice.

- Scrollbars inside the chart are thin, with a rounded thumb in the chart's border color.
  The `scroll` and `scroll-size` tokens set them (see
  [Scrollbars](../../packages/vela-ui/docs/theming.md#scrollbars)).
- The sidebar's icons are the drawing toolbar's size, 18px.
- Submenus open beside the menu they came from, never over it.
- A menu taller than its chart scrolls inside itself instead of running past the chart.
- Rows a plugin adds to an axis menu show without their icon, in line with the menu's
  checkmarked rows.

### Using the kit without the chart

The components work on any page: import each one from its own path, so a bundle holds only
what it uses, make their container a kit host, and theme it with `createTheme`. See the kit's
[README](../../packages/vela-ui/README.md) and [Theming](../../packages/vela-ui/docs/theming.md).

```ts
import { createButton } from '@luxalgo/vela-ui/button';
import { createTheme, ensureUIHost } from '@luxalgo/vela-ui/theme';

ensureUIHost(document.getElementById('app')!, createTheme({ accent: '#0ea5e9' }));
```
