// Playground gallery of the UI kit's headless primitives (Button, Tabs, Segmented, Badge),
// on the theme tokens, dark and light.
import { ensureUIHost, Button, Tabs, Segmented, Badge, type ButtonVariant, type ButtonSize } from '../src/ui';
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

// Header, with the theme switch as a Segmented control.
const header = el('header');
header.append(
    el('h1', undefined, 'UI primitives'),
    new Segmented({
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
app.append(header, el('p', 'lead', 'Headless controllers (state and per-part attributes, no DOM) with vanilla views over the theme tokens. The symbol picker and drawings drawer tabs, and the indicator and drawing settings footers, now render through these.'));

// Buttons.
const buttons = section('Button', 'md secondary and primary are the dialog footer buttons; sm is the drawing settings panel size.');
const variants: ButtonVariant[] = ['secondary', 'primary', 'subtle', 'ghost'];
for (const size of ['md', 'sm', 'xs'] as ButtonSize[]) {
    row(buttons, size, ...variants.map((variant) => new Button({ text: variant[0]!.toUpperCase() + variant.slice(1), variant, size }).el));
}
row(
    buttons,
    'icons',
    new Button({ text: 'Indicators', icon: 'indicators' }).el,
    new Button({ text: 'Screenshot', icon: 'camera', variant: 'subtle', size: 'sm' }).el,
    new Button({ icon: 'kebab', iconOnly: true, label: 'More', variant: 'ghost', size: 'sm' }).el,
    new Button({ icon: 'close', iconOnly: true, label: 'Close', variant: 'ghost', size: 'xs' }).el,
);
const magnet = new Button({ text: 'Lock', icon: 'lock', variant: 'ghost', size: 'sm', pressed: false, onClick: () => magnet.setPressed(!magnet.pressed) });
row(buttons, 'states', magnet.el, new Button({ text: 'Disabled', disabled: true }).el, new Button({ text: 'Disabled', variant: 'primary', disabled: true }).el);

// Tabs.
const tabs = section('Tabs', 'filled is the symbol picker strip, soft the drawings drawer strip; underline and nav are new for panels and settings rails. Arrow keys move and select.');
const markets = [
    { id: 'all', label: 'All' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'stocks', label: 'Stocks' },
    { id: 'forex', label: 'Forex' },
    { id: 'indices', label: 'Indices' },
];
row(tabs, 'filled', new Tabs({ variant: 'filled', items: markets, className: 'demo-strip' }).el);
row(tabs, 'soft', new Tabs({ variant: 'soft', items: [{ id: 'lines', label: 'Lines' }, { id: 'fib', label: 'Fibonacci' }, { id: 'patterns', label: 'Patterns' }, { id: 'shapes', label: 'Shapes' }] }).el);
const underline = new Tabs({ variant: 'underline', items: [{ id: 'perf', label: 'Performance' }, { id: 'analysis', label: 'Trades Analysis' }, { id: 'log', label: 'Trades Log' }, { id: 'off', label: 'Disabled', disabled: true }], className: 'w-320' });
row(tabs, 'underline', underline.el);
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

// Segmented.
const segmented = section('Segmented', 'The tab island: one choice among a few options, a radio group. Arrow keys choose.');
row(segmented, 'md', new Segmented({ label: 'Order type', items: [{ id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }, { id: 'stop', label: 'Stop' }] }).el);
row(segmented, 'sm', new Segmented({ size: 'sm', label: 'Filter', items: [{ id: 'all', label: 'All' }, { id: 'gainers', label: 'Gainers' }, { id: 'losers', label: 'Losers' }] }).el);
const fillWrap = el('div', 'w-320');
fillWrap.append(new Segmented({ fill: true, label: 'Side', items: [{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }] }).el);
row(segmented, 'fill', fillWrap);
row(segmented, 'icons', new Segmented({ size: 'sm', iconOnly: true, label: 'View mode', items: [{ id: 'table', label: 'Table', icon: 'burger' }, { id: 'calendar', label: 'Calendar', icon: 'clock' }] }).el);

// Badges.
const badges = section('Badge', 'Short status labels and counts, tinted by meaning.');
row(badges, 'labels', new Badge({ text: 'Paper' }).el, new Badge({ text: 'Live', tone: 'accent' }).el, new Badge({ text: 'Long', tone: 'up' }).el, new Badge({ text: 'Short', tone: 'down' }).el);
row(badges, 'counts', new Badge({ text: '3', count: true }).el, new Badge({ text: '12', count: true, tone: 'accent' }).el, new Badge({ text: '9+', count: true, tone: 'down' }).el);
