// Generated from each component's declaration by scripts/component-index.mjs, which the build
// and `new-component` run: do not edit.

/** Every kit component's parts and settings, by name: what `checkTheme` checks a theme's
 *  `components` against. */
export const KIT_COMPONENTS: Readonly<Record<string, { readonly parts: readonly string[]; readonly settings: readonly string[] }>> = {
    badge: {
        parts: ['root'],
        settings: ['radius'],
    },
    'bar-chart': {
        parts: ['root', 'grid', 'label', 'bar', 'marker', 'tip'],
        settings: ['tip-radius', 'tip-shadow', 'tip-z', 'tip-bg'],
    },
    button: {
        parts: ['root', 'icon'],
        settings: ['radius', 'height', 'height-xs', 'height-sm', 'height-lg', 'font-size', 'font-size-xs', 'font-size-sm'],
    },
    'callout-bubble': {
        parts: ['root', 'panel', 'title', 'text', 'actions', 'button'],
        settings: ['panel-radius', 'button-radius'],
    },
    checkbox: {
        parts: ['root', 'icon'],
        settings: ['radius'],
    },
    'color-picker': {
        parts: ['root', 'trigger', 'swatch', 'content'],
        settings: ['swatch-ring', 'circle-swatch-radius', 'content-radius'],
    },
    'data-table': {
        parts: ['root', 'table', 'head', 'sort', 'row', 'cell', 'actions', 'empty'],
        settings: ['row-height', 'head-height', 'head-z'],
    },
    'date-picker': {
        parts: ['root', 'head', 'title', 'switch', 'nav', 'week', 'grid', 'cells', 'blank', 'day', 'cell'],
        settings: ['radius', 'today-ring'],
    },
    dialog: {
        parts: ['backdrop', 'positioner', 'content', 'header', 'title', 'close', 'body', 'footer'],
        settings: ['radius'],
    },
    donut: {
        parts: ['root', 'ring', 'track', 'segment', 'figure', 'caption', 'legend', 'item', 'swatch', 'label', 'value'],
        settings: ['swatch-radius'],
    },
    drawer: {
        parts: ['backdrop', 'positioner', 'content', 'grab', 'title', 'body'],
        settings: ['radius', 'edge-radius', 'side-width', 'grab-radius'],
    },
    'dropdown-menu': {
        parts: ['content', 'item', 'icon', 'label', 'hint', 'mark', 'badge', 'star', 'switch', 'arrow', 'separator'],
        settings: ['radius', 'switch-radius'],
    },
    empty: {
        parts: ['root', 'icon', 'title', 'description'],
        settings: ['icon-radius'],
    },
    field: {
        parts: ['grid', 'row', 'span', 'label', 'cell', 'bool', 'stacked', 'stacked-head', 'inline', 'inline-item', 'toggle-label', 'section', 'sep'],
        settings: [],
    },
    'glyph-select': {
        parts: ['root', 'value', 'icon', 'content', 'item'],
        settings: ['radius', 'content-radius', 'focus-ring'],
    },
    'hover-card': {
        parts: ['root', 'heading', 'icon', 'title', 'description', 'body', 'hint'],
        settings: ['radius', 'width', 'wide-width', 'icon-radius', 'shadow'],
    },
    input: {
        parts: ['root', 'control'],
        settings: ['radius', 'focus-ring'],
    },
    'input-group': {
        parts: ['root', 'control', 'addon', 'text'],
        settings: ['radius', 'height', 'height-sm', 'focus-ring'],
    },
    kbd: {
        parts: ['root'],
        settings: ['radius', 'shadow'],
    },
    'line-chart': {
        parts: ['root', 'label', 'area', 'line', 'dot', 'tip'],
        settings: ['tip-radius', 'tip-shadow', 'tip-z', 'tip-bg', 'stroke-width'],
    },
    'number-input': {
        parts: ['root', 'input', 'steps', 'step'],
        settings: ['radius', 'step-radius', 'focus-ring'],
    },
    popover: {
        parts: ['content'],
        settings: [],
    },
    'scatter-chart': {
        parts: ['root', 'grid', 'label', 'point', 'trend', 'focus', 'tip'],
        settings: ['tip-radius', 'tip-shadow', 'tip-z', 'tip-bg'],
    },
    select: {
        parts: ['root', 'trigger', 'value', 'icon', 'sizer', 'native', 'content', 'viewport', 'item', 'rail', 'thumb'],
        settings: ['radius', 'content-radius', 'thumb-radius', 'focus-ring'],
    },
    sparkline: {
        parts: ['root', 'area', 'baseline', 'line'],
        settings: ['stroke-width'],
    },
    stat: {
        parts: ['root', 'label', 'value', 'sub'],
        settings: [],
    },
    switch: {
        parts: ['root', 'control', 'thumb'],
        settings: ['width', 'height', 'thumb-size', 'width-sm', 'height-sm', 'thumb-size-sm'],
    },
    tabs: {
        parts: ['list', 'trigger', 'icon', 'count', 'content'],
        settings: ['track-radius', 'trigger-radius', 'filled-radius', 'soft-radius', 'count-radius'],
    },
    'text-area': {
        parts: ['root', 'input'],
        settings: ['radius', 'focus-ring'],
    },
    'toggle-group': {
        parts: ['root', 'item', 'icon'],
        settings: ['radius', 'radius-sm', 'item-radius', 'item-radius-sm'],
    },
    tooltip: {
        parts: ['positioner', 'content'],
        settings: ['radius'],
    },
};
