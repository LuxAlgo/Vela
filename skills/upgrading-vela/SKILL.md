---
name: upgrading-vela
description: Upgrades a project from Vela 0.9 to 0.10 (@luxalgo/vela, with its UI kit now the separate @luxalgo/vela-ui package) - finds and fixes the breaking changes, moves deprecated names (Menu, Switch, TextField, the Button, Badge, Tabs and ToggleGroup classes, applyThemeTokens, gap, boundary, placement) to their replacements, and verifies the result. Use when bumping @luxalgo/vela, when a Vela upgrade breaks the build, the styling or a plugin, or when deprecation warnings mention Vela's UI kit.
license: Apache-2.0
---

# Upgrading Vela from 0.9 to 0.10

0.10 moves the UI kit into `@luxalgo/vela-ui`, which Vela installs for you. Code using
`@luxalgo/vela/ui` keeps working: renamed components answer to their old names until 0.11. A
chart built from options alone needs no change.

Copy this checklist and work through it in order:

```
- [ ] 1. Bump the packages
- [ ] 2. Fix the breaking changes that apply
- [ ] 3. Move deprecated names to their replacements
- [ ] 4. Verify in the browser
```

## 1. Bump the packages

Upgrade `@luxalgo/vela` to `^0.10.0`. If the project uses `@luxalgo/vela-pinets`, upgrade it to a
version whose peer range includes `^0.10.0`; npm refuses the install otherwise.

## 2. Fix the breaking changes

Search the project for each pattern (ripgrep shown); fix only those that match.

| Search | Change |
| --- | --- |
| `require\(['"]@luxalgo/vela` | CommonJS `require` of Vela needs Node 20.19 or 22.12+. Upgrade Node or import Vela as an ES module. |
| `tabsController\|toggleGroupController` | Removed. Build the control with `createTabs` or `createToggleGroup`, which own the state machine. |
| `TabItem\|ToggleGroupItem` | Items are keyed by `value`, not `id`, in objects typed with these types or passed to `createTabs` and `createToggleGroup`. |
| `style\.getPropertyValue\(['"]--vela-` | Theme tokens are no longer inline styles. Read them with `getComputedStyle(el).getPropertyValue('--vela-…')`. |
| `valueAsNumber` near a Vela number field | The field is a text input now. Read its `value` or `onChange`. |
| `new Switch\(` then `.el.disabled` or `.el.click` | The checkbox (`Switch` in 0.9) is a `<label>` around a native checkbox. Use the `disabled` option and `checked`; a click on `el` still toggles. |

One change has no search pattern: Vela's styles now sit in cascade layers, so the page's CSS
outside any layer wins over the kit. A global reset such as `button { background: none; }` now
reaches Vela's buttons. Scope those resets with `button:where(:not(.vela-ui *))`, or move them
into a layer declared first (`@layer reset;`).

## 3. Move deprecated names

The old names work in 0.10 and are marked `@deprecated`, so the editor flags them. Replace:

| 0.9 | 0.10 |
| --- | --- |
| `Menu`, `createMenu`, `menuController` | `DropdownMenu`, `createDropdownMenu`, `dropdownMenuController` |
| `Switch`, `createSwitch`, `switchController` (the square check box) | `Checkbox`, `createCheckbox`, `checkboxController` |
| `TextField`, `createTextField`, `textFieldController` | `Input`, `createInput`, `inputController` |
| `new Button(opts)`, `buttonController` | `createButton(opts)` |
| `new Badge(opts)`, `badgeController` | `createBadge(opts)` |
| `new Tabs({ items: [{ id }], value, onChange, tabClassName })`, `tab(id)`, `attachPanel(id, el)` | `createTabs({ items: [{ value }], defaultValue, onValueChange, triggerClassName })`, `trigger(value)`, `panel(value, el)` |
| `new ToggleGroup({ items: [{ id }], value, onChange })` | `createToggleGroup({ items: [{ value }], defaultValue, onValueChange })` |
| `gap`, `boundary` (popover, select list, callout bubble) | `sideOffset`, `collisionBoundary` |
| `placement` (menu, tooltip) | `side` and `align` |
| `onChange` (checkbox, select) | `onCheckedChange`, `onValueChange` |
| `applyThemeTokens(el, theme)` | `applyTheme(el, theme)` |

In 0.11, `Switch` names the sliding switch (`@luxalgo/vela-ui/switch`): move off the old
`Switch` now so that rename cannot silently change a checkbox into a switch.

## 4. Verify

1. Typecheck, then search for the deprecated names above: none should remain.
2. Run the app and open what the UI kit draws: the chart's menus, the settings dialog, any
   dialogs, tooltips and form controls of your own. Each should look as before (the defaults
   did not change), and menus should open inside the chart, themed.
3. If you theme or restyle the kit, run `checkTheme` on your themes: it now also names unknown
   components, settings and parts.

## Further reading

`node_modules/@luxalgo/vela/docs/user/upgrading.md` has the same changes with more context,
and `node_modules/@luxalgo/vela/CHANGELOG.md` every change of the release.
