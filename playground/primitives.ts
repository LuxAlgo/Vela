// Playground gallery of the UI kit: every component, on the theme tokens, dark and light.
// `window.gallery.open(name)` opens an overlay for the browser probes.
import {
    ensureUIHost,
    createButton,
    createTabs,
    createToggleGroup,
    createBadge,
    Checkbox,
    Input,
    TextArea,
    NumberInput,
    Select,
    colorField,
    widthField,
    DatePicker,
    CalloutBubble,
    fieldGrid,
    fieldSection,
    fieldRow,
    fieldSeparator,
    buildFieldControl,
    Dialog,
    Drawer,
    DropdownMenu,
    createContextMenu,
    Popover,
    Tooltip,
    type ButtonVariant,
    type ButtonSize,
    type BadgeVariant,
    type MenuItemDescriptor,
} from '../src/ui';
import { createSwitch } from '../packages/vela-ui/src/components/switch';
import { createInputGroup } from '../packages/vela-ui/src/components/input-group';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';
import { shadcnTheme } from './shadcn-look';
import { themeEditor } from './theme-editor';
import { dataGallery } from './gallery-data';
import { collapsibleGallery, itemGallery, monthGallery, sliderGallery, sortGallery } from './gallery-lists';

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
    createToggleGroup({
        size: 'sm',
        label: 'Theme',
        items: [
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'shadcn', label: 'shadcn look' },
        ],
        defaultValue: 'dark',
        onValueChange: (id) => {
            app.classList.toggle('shadcn', id === 'shadcn');
            ensureUIHost(app, id === 'shadcn' ? shadcnTheme : id === 'light' ? LIGHT_THEME : DARK_THEME);
        },
    }).el,
);
app.append(header, el('p', 'lead', 'One file per component: typed variants, Zag machines for behavior, and CSS in the kit layer over the theme tokens; variant and size names follow shadcn. The symbol picker and drawings drawer tabs, the indicator settings tabs, and the indicator and drawing settings footers render through these.'));

// Buttons.
const buttons = section('Button', 'outline and default at the default size are the dialog footer buttons; sm is the drawing settings panel size.');
const variants: ButtonVariant[] = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'];
for (const size of ['lg', 'default', 'sm', 'xs'] as ButtonSize[]) {
    row(buttons, size, ...variants.map((variant) => createButton({ text: title(variant), variant, size }).el));
}
row(
    buttons,
    'icons',
    createButton({ text: 'Indicators', icon: 'indicators', variant: 'outline' }).el,
    createButton({ text: 'Defaults', iconEnd: 'chevron-down', variant: 'outline', size: 'sm' }).el,
    createButton({ text: 'Screenshot', icon: 'camera', variant: 'secondary', size: 'sm' }).el,
    createButton({ text: 'Remove', icon: 'trash', variant: 'destructive', size: 'sm' }).el,
);
row(
    buttons,
    'icon sizes',
    ...(['icon-lg', 'icon', 'icon-sm', 'icon-xs'] as ButtonSize[]).map((size) => createButton({ icon: 'kebab', size, variant: 'ghost', label: `More (${size})` }).el),
    createButton({ icon: 'close', size: 'icon-sm', variant: 'outline', label: 'Close' }).el,
);
const lock = createButton({ text: 'Lock', icon: 'lock', variant: 'ghost', size: 'sm', pressed: false, onClick: () => lock.setPressed(!lock.pressed) });
row(buttons, 'states', lock.el, createButton({ text: 'Disabled', variant: 'outline', disabled: true }).el, createButton({ text: 'Disabled', disabled: true }).el);
row(
    buttons,
    'key caps',
    createButton({ text: 'Navigate', keys: ['↑', '↓'], variant: 'ghost', size: 'xs' }).el,
    createButton({ text: 'Open', keys: ['↵'], variant: 'ghost', size: 'xs' }).el,
    createButton({ text: 'Markets', keys: ['Tab'], variant: 'ghost', size: 'xs' }).el,
    createButton({ text: 'Close', keys: ['Esc'], variant: 'ghost', size: 'xs' }).el,
    createButton({ text: 'Search', keysEnd: ['Ctrl', 'K'], variant: 'outline', size: 'sm' }).el,
);
row(
    buttons,
    'favorite',
    createButton({ variant: 'favorite', size: 'icon-xs', label: 'Add to favorites', defaultPressed: false }).el,
    createButton({ variant: 'favorite', size: 'icon-xs', label: 'Remove from favorites', defaultPressed: true }).el,
    createButton({ variant: 'favorite', size: 'icon-sm', label: 'Favorite', defaultPressed: true }).el,
    createButton({ variant: 'favorite', size: 'sm', text: 'Favorite', defaultPressed: false }).el,
    createButton({ variant: 'ghost', size: 'icon-sm', icon: 'pin', iconPressed: 'pin-filled', label: 'Pin', defaultPressed: false }).el,
);

// Tabs.
const tabs = section('Tabs', 'default is the island; line is the indicator settings strip, filled the symbol picker strip, soft the drawings drawer strip, nav a settings rail. Arrow keys move and select.');
const markets = [
    { value: 'all', label: 'All' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'stocks', label: 'Stocks' },
    { value: 'forex', label: 'Forex' },
    { value: 'indices', label: 'Indices' },
];
row(tabs, 'default', createTabs({ items: [{ value: 'perf', label: 'Performance' }, { value: 'analysis', label: 'Trades Analysis' }, { value: 'log', label: 'Trades Log' }] }).el);
row(tabs, 'line', createTabs({ variant: 'line', items: [{ value: 'inputs', label: 'Inputs' }, { value: 'style', label: 'Style' }, { value: 'visibility', label: 'Visibility' }, { value: 'off', label: 'Disabled', disabled: true }], className: 'w-320' }).el);
row(tabs, 'filled', createTabs({ variant: 'filled', items: markets }).el);
row(tabs, 'soft', createTabs({ variant: 'soft', items: [{ value: 'lines', label: 'Lines' }, { value: 'fib', label: 'Fibonacci' }, { value: 'patterns', label: 'Patterns' }, { value: 'shapes', label: 'Shapes' }] }).el);
const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ value: `2026-11-0${i + 2}`, label, description: String(i + 2) }));
row(tabs, 'two lines', createTabs({ variant: 'soft', items: week, defaultValue: '2026-11-06' }).el, createTabs({ items: week.slice(0, 5), defaultValue: '2026-11-03' }).el);
const navItems = [
    { value: 'symbol', label: 'Symbol' },
    { value: 'status', label: 'Status line' },
    { value: 'scales', label: 'Scales and lines' },
    { value: 'canvas', label: 'Canvas' },
];
const panel = el('div', 'panel', 'Symbol');
const nav = createTabs({
    variant: 'nav',
    orientation: 'vertical',
    items: navItems,
    onValueChange: (value) => {
        panel.textContent = navItems.find((i) => i.value === value)!.label;
    },
});
const navDemo = el('div', 'nav-demo');
navDemo.append(nav.el, panel);
row(tabs, 'nav (vertical)', navDemo);

// ToggleGroup.
const groups = section('ToggleGroup', 'single: one choice among a few options (a segmented control), arrow keys choose. multiple: each option toggles on its own.');
row(groups, 'single', createToggleGroup({ label: 'Order type', items: [{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }, { value: 'stop', label: 'Stop' }] }).el);
row(groups, 'single sm', createToggleGroup({ size: 'sm', label: 'Filter', items: [{ value: 'all', label: 'All' }, { value: 'gainers', label: 'Gainers' }, { value: 'losers', label: 'Losers' }] }).el);
const fillWrap = el('div', 'w-320');
fillWrap.append(createToggleGroup({ fill: true, label: 'Side', items: [{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }] }).el);
row(groups, 'fill', fillWrap);
row(groups, 'icons', createToggleGroup({ size: 'sm', iconOnly: true, label: 'View mode', items: [{ value: 'table', label: 'Table', icon: 'burger' }, { value: 'time', label: 'Timeline', icon: 'clock' }] }).el);
row(groups, 'multiple', createToggleGroup({ type: 'multiple', size: 'sm', label: 'Sessions', defaultValue: ['regular'], items: [{ value: 'pre', label: 'Pre-market' }, { value: 'regular', label: 'Regular' }, { value: 'post', label: 'After hours' }] }).el);

// Badges.
const badges = section('Badge', 'Short status labels and counts.');
const badgeVariants: BadgeVariant[] = ['default', 'secondary', 'outline', 'destructive', 'up', 'down'];
row(badges, 'labels', ...badgeVariants.map((variant) => createBadge({ text: title(variant), variant }).el));
row(badges, 'counts', createBadge({ text: '3', count: true, variant: 'secondary' }).el, createBadge({ text: '12', count: true }).el, createBadge({ text: '9+', count: true, variant: 'destructive' }).el);

// Form controls.
const noop = (): void => {};
const forms = section('Form controls', 'The settings dialogs build their rows from these.');
row(forms, 'checkbox', new Checkbox({ checked: true }).el, new Checkbox({ checked: false }).el, new Checkbox({ checked: true, size: 'sm' }).el, new Checkbox({ checked: true, tone: 'selected' }).el, new Checkbox({ checked: true, disabled: true }).el);
row(forms, 'input', new Input({ value: 'BTCUSDT', size: 'md' }).el, new Input({ value: 'Compact', size: 'sm' }).el, new Input({ value: 'Disabled', disabled: true }).el);
row(
    forms,
    'switch',
    createSwitch({ defaultChecked: true, label: 'On' }).el,
    createSwitch({ label: 'Off' }).el,
    createSwitch({ defaultChecked: true, size: 'sm', label: 'Small' }).el,
    createSwitch({ defaultChecked: true, variant: 'destructive', label: 'Kill switch' }).el,
    createSwitch({ disabled: true, label: 'Disabled' }).el,
);
row(
    forms,
    'input group',
    createInputGroup({ type: 'search', placeholder: 'Search symbol or name', label: 'Search', addons: [{ icon: 'search' }] }).el,
    createInputGroup({ value: '2.5', label: 'Amount', addons: [{ align: 'inline-end', text: 'USD' }] }).el,
    createInputGroup({ size: 'sm', placeholder: 'Filter', label: 'Filter', addons: [{ icon: 'search' }, { align: 'inline-end', button: { label: 'Clear', icon: 'close', onClick: noop } }] }).el,
);
row(forms, 'text area', new TextArea({ value: 'A note on the chart,\nover two lines.', rows: 3 }).el);
row(forms, 'number', new NumberInput({ value: 14, min: 1, max: 100, steppers: true, size: 'md' }).el, new NumberInput({ value: 2.5, step: 0.5, size: 'sm' }).el, new NumberInput({ value: 7, disabled: true }).el);
const options = [
    { value: 'close', label: 'Close' },
    { value: 'open', label: 'Open' },
    { value: 'hl2', label: '(H + L) / 2' },
];
const select = new Select({ options, value: 'close', size: 'md', onValueChange: noop });
row(forms, 'select', select.el, new Select({ options, value: 'open', size: 'sm' }).el, new Select({ options, value: 'hl2', disabled: true }).el);
let color = '#2962ff';
let width = 2;
const color1 = colorField(DARK_THEME, () => color, (v) => (color = v), { shape: 'circle' });
const width1 = widthField(DARK_THEME, () => width, (v) => (width = v));
row(forms, 'color, width', color1, colorField(DARK_THEME, () => '#26a69a80', noop), width1);

// Field rows.
const fields = section('Field rows', 'The grid the indicator and chart settings lay their inputs out on.');
const grid = fieldGrid({ variant: 'inputs' });
grid.append(
    fieldSection('Inputs', { variant: 'inputs', first: true }),
    fieldRow({ label: 'Length', control: buildFieldControl({ kind: 'number', value: 20, onChange: noop }).el }),
    fieldRow({ label: 'Source', control: buildFieldControl({ kind: 'select', options, value: 'close', onChange: noop }).el }),
    fieldRow({ label: 'Show labels', toggle: { checked: true, onChange: noop } }),
    fieldSeparator(),
    fieldSection('Style', { variant: 'inputs' }),
    fieldRow({ label: 'Line', control: buildFieldControl({ kind: 'color', theme: DARK_THEME, get: () => '#f23645', onChange: noop }).el }),
    fieldRow({ label: 'Note', control: buildFieldControl({ kind: 'text', value: 'Session high', onChange: noop }).el }),
);
const gridWrap = el('div', 'w-320');
gridWrap.append(grid);
fields.append(gridWrap);

// Date picker and callout bubble.
const misc = section('Date picker, callout', 'The time input calendar, and the bubble the legend and statusline deploy.');
const callout = new CalloutBubble({ icon: 'clock', background: '#f7525f', color: '#ffffff', label: 'Market closed', host: app, panel: { title: 'Market closed', items: [{ type: 'text', text: 'Trading resumes at the next session open.' }, { type: 'button', label: 'Got it', primary: true, close: true, run: noop }] } });
row(misc, 'date picker', new DatePicker({ value: '2026-11-03', today: new Date('2026-11-03T12:00:00Z') }).el);
row(misc, 'callout', callout.el);

// Overlays.
const overlays = section('Overlays', 'Dialog, drawer, menus, popover and tooltip, each opened from its button.');
const trigger = (text: string): HTMLButtonElement => createButton({ text, variant: 'outline', size: 'sm' }).el;
const dialogBtn = trigger('Dialog');
const drawerBtn = trigger('Drawer');
const menuBtn = trigger('Menu');
const actionsBtn = trigger('Action menu');
const popoverBtn = trigger('Popover');
const tooltipBtn = trigger('Tooltip');
row(overlays, 'open', dialogBtn, drawerBtn, menuBtn, actionsBtn, popoverBtn, tooltipBtn);
const dialog = new Dialog({
    title: 'Dialog',
    host: app,
    content: (body) => body.append(el('p', 'note', 'A dialog body, with the footer buttons below.')),
    footer: (f) => f.append(createButton({ text: 'Cancel', variant: 'outline' }).el, createButton({ text: 'OK' }).el),
});
const drawer = new Drawer({ title: 'Drawer', host: app, content: (body) => body.append(el('p', 'note', 'A bottom sheet on phones.')) });
const items: MenuItemDescriptor[] = [
    { id: 'candles', label: 'Candles', icon: 'search', checked: true },
    { id: 'bars', label: 'Bars', icon: 'clock' },
    { id: 'line', label: 'Line', icon: 'style-line', hint: 'Alt+L' },
    { id: 'more', label: 'More', separatorBefore: true, submenu: [{ id: 'area', label: 'Area' }, { id: 'baseline', label: 'Baseline' }] },
    { id: 'off', label: 'Disabled', disabled: true },
];
const menu = new DropdownMenu({ trigger: menuBtn, host: app, items });
const actionItems: MenuItemDescriptor[] = [{ id: 'lock', label: 'Lock', icon: 'lock', checked: true, toggle: true }, { id: 'copy', label: 'Copy', icon: 'camera', hint: 'Ctrl+C' }, { id: 'remove', label: 'Remove', icon: 'trash', separatorBefore: true }];
const actions = new DropdownMenu({ trigger: actionsBtn, host: app, checkmarks: true, iconBadges: true, items: actionItems });
const popoverBody = el('div', 'note', 'Popover content.');
const popover = new Popover({ trigger: popoverBtn, host: app, content: popoverBody });
new Tooltip(tooltipBtn, { content: 'Tooltip text', openDelay: 0, host: app });
dialogBtn.addEventListener('click', () => dialog.show());
drawerBtn.addEventListener('click', () => drawer.show());
popoverBtn.addEventListener('click', () => popover.toggle());
// Every floating part takes the same placement props: the side, the alignment along it, the offsets.
const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const btn = trigger(`Popover ${side}`);
    const pop = new Popover({ trigger: btn, host: app, side, align: 'center', sideOffset: 8, content: el('div', 'note', `Opens on the ${side}.`) });
    btn.addEventListener('click', () => pop.toggle());
    return btn;
});
const menuRightBtn = trigger('Menu right');
new DropdownMenu({ trigger: menuRightBtn, host: app, items, side: 'right', align: 'start', sideOffset: 6 });
const tipLeftBtn = trigger('Tooltip left');
new Tooltip(tipLeftBtn, { content: 'On the left', openDelay: 0, host: app, side: 'left' });
row(overlays, 'sides', ...sides, menuRightBtn, tipLeftBtn);
// A context menu opens where it is asked for: a right-click, a long press, the context-menu key.
const contextArea = el('div', 'note', 'Right-click here, or long-press on a touch screen');
contextArea.tabIndex = 0;
contextArea.style.cssText = 'padding: 18px 24px; border: 1px dashed var(--vela-border-strong); border-radius: var(--vela-radius-md);';
createContextMenu({ target: contextArea, host: app, iconBadges: true, items: actionItems });
row(overlays, 'context', contextArea);

// Lists and sections.
const sliders = section('Slider', 'The replay scrubber: a drag previews, the release commits. The arrow keys, Page Up/Down and Home/End move it.');
sliderGallery((label, ...children) => row(sliders, label, ...children));
const collapsibles = section('Collapsible', "default is a panel's drawer, label a list's group header; a row's own chevron can drive one too.");
collapsibleGallery((label, ...children) => row(collapsibles, label, ...children));
const itemSection = section('Item', 'List rows: media, a title over a description, the meta, the actions. A clickable row is a button to the keyboard; its actions can wait for the hover.');
itemGallery((label, ...children) => row(itemSection, label, ...children));
const sorts = section('Sort button', "Column headers over a list that isn't a table: a press steps through the first direction, the other, and unsorted.");
sortGallery((label, ...children) => row(sorts, label, ...children));
const months = section('Month grid', "A journal's P&L by day. A press opens a day; the arrow keys walk the days, Home and End the week's ends.");
monthGallery((label, ...children) => row(months, label, ...children));

// Data components.
const dataSection = section('Data', 'Stats, keycaps, an empty state, a table, a sparkline, a donut, the charts and a hover card.');
dataGallery((label, ...children) => row(dataSection, label, ...children), app);

// The theme editor: re-themes the gallery live and writes the createTheme call.
const editor = section('Theme editor', 'A brand color, a radius scale and a font re-theme every component above; copy the call into a project.');
editor.append(themeEditor((theme) => ensureUIHost(app, theme)));

(window as unknown as { gallery: unknown }).gallery = {
    open(name: string): void {
        if (name === 'dialog') dialog.show();
        else if (name === 'drawer') drawer.show();
        else if (name === 'menu') menu.open();
        else if (name === 'actions') actions.open();
        else if (name === 'popover') popover.show();
        else if (name === 'select') select.toggle();
        else if (name === 'color') color1.click();
        else if (name === 'width') width1.click();
        else if (name === 'callout') callout.el.click();
    },
};
