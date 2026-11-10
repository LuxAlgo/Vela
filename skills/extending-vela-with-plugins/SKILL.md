---
name: extending-vela-with-plugins
description: Extends Vela charts through the public plugin SDK (@luxalgo/vela/plugin) - topbar buttons and right-click menu rows (registerWidgetAction), overlays and per-chart behavior (registerWidgetAttachment), docked side panels (registerSidePanel), custom chart types, renderer layers, native indicators, legend actions, saved state and shell defaults. Use when adding a feature, button, menu entry, panel, overlay or chart style to a Vela chart or VelaWorkspace, or packaging such features as a plugin, instead of forking Vela or reaching into its DOM.
license: Apache-2.0
---

# Extending Vela with plugins

Everything below comes from `@luxalgo/vela/plugin`. A plugin contributes **descriptors** (data)
and Vela projects them into its chrome; it never edits Vela's DOM.

## Pick the hook

| To add | Hook |
| --- | --- |
| A topbar button, or a row in the chart, price-axis or time-axis right-click menu | `registerWidgetAction` (`target: 'topbar'`, `'context:body'`, `'context:price-axis'`, `'context:time-axis'`) |
| An overlay, a gesture, key handling: behavior mounted once per chart app | `registerWidgetAttachment` |
| A docked panel on the right, with its own toggle button | `registerSidePanel` |
| A full-width strip or a rail at the edge | `ctx.dockStrip(el)`, `ctx.dockEdge(el, 'right')` from an action or attachment |
| A new chart style (in the style menu) | `registerChartType` (`supports(facts)` greys it on a symbol it cannot draw) |
| Drawing on the chart canvas | `registerRendererLayer` |
| A computed study without a script | `registerNativeIndicator` |
| Buttons or badges on legend rows | `registerLegendAction`, `registerLegendCallout` |
| State saved with the chart's document | `registerStatePersistence` |
| A default for every shell (the sidebar on) | `registerShellDefaults` |
| A scripting language for every chart | `registerDefaultEngine` |

## Example: a menu row and a panel that follows the symbol

```ts
import { msg, registerIcon, registerSidePanel, registerWidgetAction } from '@luxalgo/vela/plugin';

// Icons are ids; an unknown id draws nothing, so register yours (16×16, currentColor).
registerIcon('acme-journal', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2"/></svg>');

const notes: Array<{ symbol: string; price: number }> = [];
let refresh = () => {};

registerWidgetAction({
    id: 'acme.note-price',                 // namespace ids: 'vendor.feature'
    target: 'context:body',
    label: msg('acme.note-price', 'Note this price'),
    icon: 'acme-journal',
    order: -100,                           // lead the menu (built-in rows sit at -30…1000)
    when: (ctx) => ctx.pointer?.paneKind === 'price' && ctx.pointer.price !== null,
    run: (ctx) => {
        notes.push({ symbol: ctx.symbol, price: ctx.pointer!.price! });
        refresh();
        ctx.togglePanel('acme.journal', true);
    },
});

// The panel gets its own toggle button in the topbar's panel group: no extra action needed.
registerSidePanel({
    id: 'acme.journal',
    title: msg('acme.journal', 'Journal'),
    icon: 'acme-journal',
    mount: (ctx, body) => {
        const list = document.createElement('ul');
        body.append(list);
        const render = () => list.replaceChildren(...notes.filter((n) => n.symbol === ctx.symbol).map((n) => Object.assign(document.createElement('li'), { textContent: String(n.price) })));
        refresh = render;
        let offMarket = () => {};
        return {
            // Runs on mount, after a rebuild and on an active-cell change, NOT on a symbol switch:
            // a switch keeps the chart, so follow it through the chart's event.
            onChart: (chart) => {
                offMarket();
                offMarket = chart.on('market:changed', render);
                render();
            },
            destroy: () => {
                offMarket();
                list.remove();
            },
        };
    },
});
```

## Rules

1. **Register at import time, before charts are built.** A chart built later picks the
   contributions up; after a late registration or an unregistration, call the shell's
   `refreshActions()`.
2. **Read everything from the context you are handed, at the moment you need it.** `ctx.chart`,
   `ctx.symbol` and `ctx.timeframe` are live getters: never keep the chart in a variable of your
   own, since a rebuild or a grid's active cell change replaces it. A symbol or timeframe switch
   keeps the chart: follow it with `chart.on('market:changed', …)`.
3. **Mount kit components on `ctx.host`.** Pass `host: ctx.host` to dialogs, menus and tooltips
   (a select takes it as `list: { host }`); without it they mount outside the chart, unthemed.
4. **Return a disposer** from every `mount`, and keep the disposers `register…` functions return
   if your plugin can be turned off (`registerIcon` has none; an icon stays registered).
5. **Menu rows take the menu's look.** The body menu shows icons; the axis menus are lists of
   checkmarked settings, so a row added there shows without its `icon`.
6. **Use the public API only.** If a feature seems to need Vela internals, look for the seam in
   `docs/contributing/plugin-sdk.md`; layers get everything they draw from `render(args)`.
7. **Text the user reads** goes through `msg('acme.area.key', 'English text')`, both arguments
   string literals, so the shell's language applies. Descriptor labels take the `msg` as is;
   text you render yourself goes through `ctx.i18n.t(message)`, and numbers and dates through
   `ctx.i18n.format`. Register translations with `registerLocale`.

## Check your work

1. Typecheck: descriptors are typed.
2. Build a chart after the registrations and exercise each contribution in the browser: the
   button or row appears (it carries `data-action-id` with your id), the panel opens from its
   button, and the overlay follows a symbol switch.
3. Destroy the chart and confirm your `destroy` and disposers ran (no leftover elements or
   timers).

## Further reading

- `node_modules/@luxalgo/vela/docs/contributing/plugin-sdk.md`: every hook with its full
  descriptor, the right-click menu ranks, layout regions, the sidebar and keyboard bindings.
- `node_modules/@luxalgo/vela/docs/user/workspace.md`: composing the topbar and the sidebar
  from the host.
- The `using-vela-ui-components` skill (shipped with `@luxalgo/vela-ui`) for the components a
  panel or overlay is built from.
