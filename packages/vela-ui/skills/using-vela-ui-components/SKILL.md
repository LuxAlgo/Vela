---
name: using-vela-ui-components
description: Builds interface pieces with @luxalgo/vela-ui, the component kit behind Vela charts - buttons, tabs, toggle groups, badges, dialogs, drawers, dropdown and context menus, tooltips, hover cards, popovers, toasts, collapsible sections, cards, list rows, form controls (checkbox, switch, slider, input, select, number input, date and color pickers) and data components (data table, sort buttons, month grid, figure, sparkline, bar, line and scatter charts, treemap). Use when adding or wiring these components on a page or next to a Vela chart, when a menu, dialog or tooltip from the kit renders unstyled or in the wrong place, or when the user wants UI that matches their Vela chart, even if they do not name the kit.
license: Apache-2.0
---

# Using vela-ui components

## Make a kit host first

Components take their theme and base styles from the nearest kit host, and floating parts
(menus, popovers, select lists, tooltips, dialogs) mount into it. On a page of your own:

```ts
import { createTheme, ensureUIHost } from '@luxalgo/vela-ui/theme';

const app = document.getElementById('app')!;
ensureUIHost(app, createTheme()); // dark by default; the theming-vela-ui skill covers the rest
```

Next to a Vela chart, the chart's root already is a kit host: mount inside it, or pass a
plugin's `ctx.host` as `host`. Use `ensureUIHost`, not `applyTheme`, to set a host up:
`applyTheme` only themes an element, so a menu opened from it mounts unthemed in `<body>`.

## One shape for every component

`create<Name>(props)` from `@luxalgo/vela-ui/<name>` returns a handle with `el` and
`destroy()`. Append `el` where it belongs.

```ts
import { createButton } from '@luxalgo/vela-ui/button';

const save = createButton({ text: 'Save', variant: 'default', size: 'sm', onClick: () => submit() });
app.append(save.el);
```

To find a component, its props, parts and an example, search
`node_modules/@luxalgo/vela-ui/dist/manifest.json` for `"name": "<name>"`, or run
`npx @luxalgo/vela-ui list`. Pick by need:

| Need | Component |
| --- | --- |
| An action | `button` (variants `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`, `up`, `down`, `favorite`; `keys` for key caps) |
| Switch between views | `tabs` (a `description` puts a second line under a label); a few exclusive options on one track: `toggle-group` |
| A status or a count | `badge`, `figure`, `kbd` |
| A list of actions from a button or a right-click | `dropdown-menu`, `context-menu` |
| A label or a card on hover | `tooltip`, `hover-card` |
| A modal or a sheet | `dialog`, `drawer` |
| Floating content of your own | `popover` |
| A notice that leaves on its own (saved, failed, an alert fired) | `toast`: raise it with `toast()` / `toast.success(…)` from anywhere, shown by one `createToaster()` |
| A section that folds | `collapsible` |
| A panel or tile of figures, a chart with its title | `card` (`inset` for tiles inside a card; `onSelect` makes it clickable) |
| Rows of a list (a watchlist, alerts, results) | `item`, stacked by `createItemGroup` |
| A form | `input`, `input-group`, `text-area`, `number-input`, `select`, `checkbox`, `switch`, `slider`, `date-picker`, `color-picker` |
| Data | `data-table`, `sort-button` (sorts a list that is not a table), `month-grid` (a figure per day), `sparkline`, `line-chart`, `bar-chart`, `scatter-chart`, `donut`, `treemap` (weighted tiles tinted by a value, in groups that can zoom), `empty` |

## Rules that prevent the common bugs

1. **Pass `host` to a floating component built before its trigger is in the page** (a select
   takes it as `list: { host }`). Without it, the component looks for a host from the trigger,
   finds none, and mounts in `<body>`, unthemed. When unsure whether the trigger is in the page
   yet (inside a panel's `mount`, say), pass it.
2. **Start a value with `defaultValue`, `defaultChecked`, `defaultOpen` or `defaultPressed`,
   listen with the matching `on…Change`, and change it from code with `setValue`,
   `setChecked`, `setOpen` or `setPressed`.** The setters never call the listeners, so a host
   can refresh a control without loops. A select's options are fixed: build a new one to
   change them. A slider also reports `onValueCommit` once a drag ends: run costly work there.
3. **Every floating part takes the same placement props:** `side`, `align`, `sideOffset`,
   `alignOffset`, `avoidCollisions`, `collisionPadding`, `collisionBoundary`.
4. **Release what you discard.** Controls that run a state machine keep page-wide listeners
   until released: call `disposeWithin(root)` (`@luxalgo/vela-ui/dispose`) before dropping a
   subtree, or `destroy()` on the handles. A destroyed dialog, drawer or popover releases its
   content.
5. **Menus take rows as data:** `items: [{ id, label, icon?, hint?, checked?, toggle?, disabled?,
   separatorBefore?, submenu? }]` and `onSelect(id)`. `checkmarks: true` shows checked rows
   with a leading check; `iconBadges: true` puts icons in tiles.
6. **Icons are ids from the registry** (`icon: 'kebab'`). Add your own with
   `registerIcon(id, svg)` from `@luxalgo/vela-ui/icons`, drawn with `currentColor`.
7. **Restyle through the theme or the parts' `data-slot` attributes, never class names.**
   Class names are layout hooks, not the styling contract. Your own elements beside the kit
   read the same tokens as CSS variables: `color: var(--vela-fg-muted)`,
   `background: var(--vela-surface-elev)` (names in `docs/theming.md`).
8. **An inline or authored `display` defeats the `hidden` attribute.** Toggle visibility of
   your own elements one way only: `hidden`, or `style.display`, not both.
9. **Two components called Switch.** `@luxalgo/vela-ui/switch` is the sliding switch. In
   `@luxalgo/vela/ui` 0.10, `Switch` is the deprecated name of `Checkbox`.

## Example: an order form

```ts
import { createButton } from '@luxalgo/vela-ui/button';
import { createDropdownMenu } from '@luxalgo/vela-ui/dropdown-menu';
import { createInput } from '@luxalgo/vela-ui/input';
import { createSelect } from '@luxalgo/vela-ui/select';
import { createToggleGroup } from '@luxalgo/vela-ui/toggle-group';
import { createTooltip } from '@luxalgo/vela-ui/tooltip';

const side = createToggleGroup({
    items: [{ value: 'buy', label: 'Buy', tone: 'up' }, { value: 'sell', label: 'Sell', tone: 'down' }],
    defaultValue: 'buy',
    fill: true,
    onValueChange: (value) => (order.side = value),
});
const type = createSelect({
    options: [{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }],
    defaultValue: 'limit',
    fill: true,
    onValueChange: (value) => (order.type = value),
});
const size = createInput({ placeholder: 'Size', onChange: (text) => (order.size = Number(text)) });
const submit = createButton({ text: 'Place order', variant: 'default', onClick: () => place(order) });
const more = createButton({ icon: 'kebab', size: 'icon-sm', variant: 'ghost', label: 'More' });
createDropdownMenu({
    trigger: more.el,
    host: app,
    items: [{ id: 'reset', label: 'Reset form' }, { id: 'help', label: 'Order types…', separatorBefore: true }],
    onSelect: (id) => (id === 'reset' ? reset() : openHelp()),
});
createTooltip({ trigger: submit.el, content: 'Sends the order to the paper account' });

app.append(side.el, type.el, size.el, submit.el, more.el);
```

## Check your work

1. Typecheck: props are typed, so a wrong prop or variant fails there.
2. In the browser, open each floating part and confirm it sits inside the themed host:
   `el.closest('[data-vela-theme]')` is not null and its background is not transparent.
3. `npx @luxalgo/vela-ui check` finds a second installed copy of the kit, which would load
   every component twice.

## Further reading

- `node_modules/@luxalgo/vela-ui/dist/manifest.json`: every component's import, props, parts,
  settings, variants and an example.
- `node_modules/@luxalgo/vela-ui/docs/what-to-change.md`: which file or setting a change
  belongs in.
- The `theming-vela-ui` skill restyles components; `writing-vela-ui-components` builds new
  ones.
