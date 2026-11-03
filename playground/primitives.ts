// Playground gallery of the UI kit's headless primitives (Button, Tabs, ToggleGroup,
// Badge), on the theme tokens, dark and light.
import { ensureUIHost, Button, Tabs, ToggleGroup, Badge, type ButtonVariant, type ButtonSize, type BadgeVariant } from '../src/ui';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';

const app = document.getElementById('app')!;
ensureUIHost(app, DARK_THEME);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
};
const section = (title: string, note: string): HTMLElement => {
    const s = el('section');
    s.append(el('h2', undefined, title), el('p', 'note', note));
    app.appendChild(s);
    return s;
};
const row = (parent: HTMLElement, label: string, ...children: HTMLElement[]): void => {
    const r = el('div', 'row');
    r.append(el('span', 'label', label), ...children);
    parent.appendChild(r);
};
const title = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

// Header, with the theme switch as a single-choice ToggleGroup.
const header = el('header');
header.append(
    el('h1', undefined, 'UI primitives'),
    new ToggleGroup({
        size: 'sm',
        label: 'Theme',
        items: [
            { id: 'dark', label: 'Dark' },
            { id: 'light', label: 'Light' },
        ],
        value: 'dark',
        onChange: (id) => ensureUIHost(app, id === 'light' ? LIGHT_THEME : DARK_THEME),
    }).el,
);
app.append(header, el('p', 'lead', 'Headless controllers (state and per-part attributes, no DOM) with vanilla views over the theme tokens; variant and size names follow shadcn. The symbol picker and drawings drawer tabs, the indicator settings tabs, and the indicator and drawing settings footers render through these.'));

// Buttons.
const buttons = section('Button', 'outline and default at the default size are the dialog footer buttons; sm is the drawing settings panel size.');
const variants: ButtonVariant[] = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'];
for (const size of ['lg', 'default', 'sm', 'xs'] as ButtonSize[]) {
    row(buttons, size, ...variants.map((variant) => new Button({ text: title(variant), variant, size }).el));
}
row(
    buttons,
    'icons',
    new Button({ text: 'Indicators', icon: 'indicators', variant: 'outline' }).el,
    new Button({ text: 'Defaults', iconEnd: 'chevron-down', variant: 'outline', size: 'sm' }).el,
    new Button({ text: 'Screenshot', icon: 'camera', variant: 'secondary', size: 'sm' }).el,
    new Button({ text: 'Remove', icon: 'trash', variant: 'destructive', size: 'sm' }).el,
);
row(
    buttons,
    'icon sizes',
    ...(['icon-lg', 'icon', 'icon-sm', 'icon-xs'] as ButtonSize[]).map((size) => new Button({ icon: 'kebab', size, variant: 'ghost', label: `More (${size})` }).el),
    new Button({ icon: 'close', size: 'icon-sm', variant: 'outline', label: 'Close' }).el,
);
const lock = new Button({ text: 'Lock', icon: 'lock', variant: 'ghost', size: 'sm', pressed: false, onClick: () => lock.setPressed(!lock.pressed) });
row(buttons, 'states', lock.el, new Button({ text: 'Disabled', variant: 'outline', disabled: true }).el, new Button({ text: 'Disabled', disabled: true }).el);

// Tabs.
const tabs = section('Tabs', 'default is the island; line is the indicator settings strip, filled the symbol picker strip, soft the drawings drawer strip, nav a settings rail. Arrow keys move and select.');
const markets = [
    { id: 'all', label: 'All' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'stocks', label: 'Stocks' },
    { id: 'forex', label: 'Forex' },
    { id: 'indices', label: 'Indices' },
];
row(tabs, 'default', new Tabs({ items: [{ id: 'perf', label: 'Performance' }, { id: 'analysis', label: 'Trades Analysis' }, { id: 'log', label: 'Trades Log' }] }).el);
row(tabs, 'line', new Tabs({ variant: 'line', items: [{ id: 'inputs', label: 'Inputs' }, { id: 'style', label: 'Style' }, { id: 'visibility', label: 'Visibility' }, { id: 'off', label: 'Disabled', disabled: true }], className: 'w-320' }).el);
row(tabs, 'filled', new Tabs({ variant: 'filled', items: markets }).el);
row(tabs, 'soft', new Tabs({ variant: 'soft', items: [{ id: 'lines', label: 'Lines' }, { id: 'fib', label: 'Fibonacci' }, { id: 'patterns', label: 'Patterns' }, { id: 'shapes', label: 'Shapes' }] }).el);
const navItems = [
    { id: 'symbol', label: 'Symbol' },
    { id: 'status', label: 'Status line' },
    { id: 'scales', label: 'Scales and lines' },
    { id: 'canvas', label: 'Canvas' },
];
const panel = el('div', 'panel', 'Symbol');
const nav = new Tabs({
    variant: 'nav',
    orientation: 'vertical',
    panels: true,
    items: navItems,
    onChange: (id) => {
        panel.textContent = navItems.find((i) => i.id === id)!.label;
    },
});
const navDemo = el('div', 'nav-demo');
navDemo.append(nav.el, panel);
row(tabs, 'nav (vertical)', navDemo);

// ToggleGroup.
const groups = section('ToggleGroup', 'single: one choice among a few options (a segmented control), arrow keys choose. multiple: each option toggles on its own.');
row(groups, 'single', new ToggleGroup({ label: 'Order type', items: [{ id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }, { id: 'stop', label: 'Stop' }] }).el);
row(groups, 'single sm', new ToggleGroup({ size: 'sm', label: 'Filter', items: [{ id: 'all', label: 'All' }, { id: 'gainers', label: 'Gainers' }, { id: 'losers', label: 'Losers' }] }).el);
const fillWrap = el('div', 'w-320');
fillWrap.append(new ToggleGroup({ fill: true, label: 'Side', items: [{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }] }).el);
row(groups, 'fill', fillWrap);
row(groups, 'icons', new ToggleGroup({ size: 'sm', iconOnly: true, label: 'View mode', items: [{ id: 'table', label: 'Table', icon: 'burger' }, { id: 'time', label: 'Timeline', icon: 'clock' }] }).el);
row(groups, 'multiple', new ToggleGroup({ type: 'multiple', size: 'sm', label: 'Sessions', value: ['regular'], items: [{ id: 'pre', label: 'Pre-market' }, { id: 'regular', label: 'Regular' }, { id: 'post', label: 'After hours' }] }).el);

// Badges.
const badges = section('Badge', 'Short status labels and counts.');
const badgeVariants: BadgeVariant[] = ['default', 'secondary', 'outline', 'destructive', 'up', 'down'];
row(badges, 'labels', ...badgeVariants.map((variant) => new Badge({ text: title(variant), variant }).el));
row(badges, 'counts', new Badge({ text: '3', count: true, variant: 'secondary' }).el, new Badge({ text: '12', count: true }).el, new Badge({ text: '9+', count: true, variant: 'destructive' }).el);
