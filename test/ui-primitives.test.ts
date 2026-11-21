// @vitest-environment jsdom
// The kit's primitives: Button and Badge (plain state handing out part attributes), Tabs and
// ToggleGroup (Zag machines behind vanilla views), driven by clicks and the keyboard.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { applyProps } from '@luxalgo/vela-ui/headless';
import { buttonVariants, createButton } from '@luxalgo/vela-ui/button';
import { createTabs } from '@luxalgo/vela-ui/tabs';
import { createToggleGroup } from '@luxalgo/vela-ui/toggle-group';
import { createBadge } from '@luxalgo/vela-ui/badge';
import { iconEl } from '../packages/vela-ui/src/lib/icons';

// Browsers run queued microtasks between animation-frame callbacks; jsdom runs a frame's
// callbacks back to back. Zag focuses in one frame callback and reads the focus in the
// next, so each callback gets its own task here, as in a browser.
beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => document.body.replaceChildren());

const ITEMS = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', disabled: true },
    { id: 'c', label: 'C' },
];
const TAB_ITEMS = ITEMS.map(({ id, ...rest }) => ({ value: id, ...rest }));
const key = (el: Element, k: string): void => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
/** Let the machines process: their events run on microtasks, their focus moves on frames. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('applyProps', () => {
    it('writes values and removes the absent ones', () => {
        const el = document.createElement('button');
        applyProps(el, { role: 'tab', 'aria-selected': 'true', tabindex: 0, disabled: true, 'data-x': true });
        expect(el.getAttribute('role')).toBe('tab');
        expect(el.getAttribute('tabindex')).toBe('0');
        expect(el.hasAttribute('disabled')).toBe(true);
        expect(el.getAttribute('data-x')).toBe('');
        applyProps(el, { disabled: false, 'data-x': undefined });
        expect(el.hasAttribute('disabled')).toBe(false);
        expect(el.hasAttribute('data-x')).toBe(false);
    });
});

describe('Button', () => {
    it('describes its slot, variant, size, toggle state and accessible name', () => {
        const b = createButton({ text: 'OK' });
        expect(b.el.type).toBe('button');
        expect(b.el.dataset).toMatchObject({ slot: 'button', variant: 'default', size: 'default' });
        expect(b.el.hasAttribute('aria-pressed')).toBe(false);
        expect(b.el.hasAttribute('aria-label')).toBe(false);
        expect(b.el.disabled).toBe(false);
        const icon = createButton({ variant: 'ghost', size: 'icon-xs', label: 'Close', pressed: false });
        expect(icon.el.dataset.size).toBe('icon-xs');
        expect(icon.el.getAttribute('aria-label')).toBe('Close');
        expect(icon.el.getAttribute('aria-pressed')).toBe('false');
        icon.setPressed(true);
        expect(icon.el.getAttribute('aria-pressed')).toBe('true');
        expect(icon.el.hasAttribute('data-pressed')).toBe(true);
        expect(icon.pressed).toBe(true);
        expect(createButton({ size: 'sm', label: 'Apply' }).el.hasAttribute('aria-label')).toBe(false);
    });

    it('renders a clickable button with icons on either side that follows its state', () => {
        const onClick = vi.fn();
        const b = createButton({ text: 'Defaults', variant: 'outline', icon: 'reset', iconEnd: 'chevron-down', onClick });
        document.body.append(b.el);
        expect(b.el.className).toBe('vela-btn');
        expect(b.el.dataset.variant).toBe('outline');
        const icons = [...b.el.querySelectorAll('[data-icon]')];
        expect(icons.map((i) => i.getAttribute('data-icon'))).toEqual(['inline-start', 'inline-end']);
        expect(icons.every((i) => i.getAttribute('data-slot') === 'button-icon')).toBe(true);
        expect(b.el.textContent).toBe('Defaults');
        b.el.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        b.setDisabled(true);
        expect(b.el.disabled).toBe(true);
        b.setText('Reset');
        expect(b.el.textContent).toBe('Reset');

        const square = createButton({ icon: 'close', size: 'icon-sm', variant: 'ghost', label: 'Close', iconEnd: 'chevron-down', text: 'ignored' });
        expect(square.el.getAttribute('aria-label')).toBe('Close');
        expect(square.el.textContent).toBe('');
        expect(square.el.querySelectorAll('[data-icon]').length).toBe(1);
    });

    it('injects its stylesheet, inside the kit layer, once, on first creation', () => {
        document.head.querySelector('#vela-ui-button')?.remove();
        createButton({ text: 'A' });
        createButton({ text: 'B' });
        const sheets = document.head.querySelectorAll('#vela-ui-button');
        expect(sheets.length).toBe(1);
        expect(sheets[0]!.textContent).toContain('@layer vela.ui');
        expect(sheets[0]!.textContent).toContain('var(--vela-button-radius, var(--vela-radius-md))');
        const layers = document.head.querySelector('#vela-layers')!;
        expect(layers.textContent).toBe('@layer vela.theme, vela.ui, vela.chrome, vela.pro, vela.custom;');
        expect(layers.compareDocumentPosition(sheets[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('resolves variants to their defaults', () => {
        expect(buttonVariants()).toEqual({ 'data-variant': 'default', 'data-size': 'default' });
        expect(buttonVariants({ size: 'sm' })).toEqual({ 'data-variant': 'default', 'data-size': 'sm' });
    });

    it('holds key caps before and after its text, never on an icon size', () => {
        const b = createButton({ text: 'Navigate', keys: ['↑', '↓'], keysEnd: ['Esc'], variant: 'ghost', size: 'xs' });
        const groups = [...b.el.querySelectorAll('[data-slot="button-keys"]')];
        expect(groups.map((g) => g.getAttribute('data-keys'))).toEqual(['inline-start', 'inline-end']);
        expect([...groups[0]!.querySelectorAll('kbd[data-slot="kbd"]')].map((k) => k.textContent)).toEqual(['↑', '↓']);
        expect(b.el.textContent).toBe('↑↓NavigateEsc');
        expect(createButton({ icon: 'close', size: 'icon-sm', label: 'Close', keys: ['Esc'] }).el.querySelector('kbd')).toBeNull();
        expect(createButton({ text: 'Plain', keys: [] }).el.querySelector('[data-slot="button-keys"]')).toBeNull();
    });

    it('a favorite star toggles itself, swapping to the filled star, when uncontrolled', () => {
        const onPressedChange = vi.fn();
        const star = createButton({ variant: 'favorite', size: 'icon-xs', label: 'Favorite', defaultPressed: false, onPressedChange });
        const icon = () => star.el.querySelector('[data-icon="inline-start"]')!.innerHTML;
        expect(icon()).toBe(iconEl('star').innerHTML);
        expect(star.el.getAttribute('aria-pressed')).toBe('false');
        star.el.click();
        expect(onPressedChange).toHaveBeenLastCalledWith(true);
        expect(star.pressed).toBe(true);
        expect(star.el.hasAttribute('data-pressed')).toBe(true);
        expect(icon()).toBe(iconEl('star-filled').innerHTML);
        star.el.click();
        expect(onPressedChange).toHaveBeenLastCalledWith(false);
        expect(icon()).toBe(iconEl('star').innerHTML);
    });

    it('a controlled toggle only asks, until setPressed moves it', () => {
        const onPressedChange = vi.fn();
        const onClick = vi.fn();
        const b = createButton({ variant: 'ghost', size: 'icon-sm', label: 'Lock', icon: 'lock', iconPressed: 'unlock', pressed: false, onPressedChange, onClick });
        b.el.click();
        expect(onPressedChange).toHaveBeenCalledWith(true);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(b.pressed).toBe(false);
        expect(b.el.getAttribute('aria-pressed')).toBe('false');
        b.setPressed(true);
        expect(b.el.querySelector('[data-icon="inline-start"]')!.innerHTML).toBe(iconEl('unlock').innerHTML);
        expect(onPressedChange).toHaveBeenCalledTimes(1);
        // A toggle named only by its callback starts unpressed.
        expect(createButton({ text: 'Bold', onPressedChange: () => {} }).el.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('Tabs (Zag tabs machine)', () => {
    it('starts on the first available tab, and follows the orientation', async () => {
        expect(createTabs({ items: [{ value: 'x', label: 'X', disabled: true }, ...TAB_ITEMS] }).value).toBe('a');
        expect(createTabs({ items: [{ value: 'h', label: 'H', hidden: true }, { value: 'v', label: 'V' }] }).value).toBe('v');
        const vertical = createTabs({ items: TAB_ITEMS, orientation: 'vertical' });
        expect(vertical.el.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('renders tabs with one tab stop, slots, and links a panel only once one is attached', () => {
        const tabs = createTabs({ items: TAB_ITEMS, defaultValue: 'c', variant: 'line', className: 'host-strip' });
        const panel = document.createElement('div');
        document.body.append(tabs.el, panel);
        expect(tabs.trigger('c')!.hasAttribute('aria-controls')).toBe(false);
        tabs.panel('c', panel);
        expect(tabs.el.className).toBe('vela-tabs host-strip');
        expect(tabs.el.getAttribute('role')).toBe('tablist');
        expect(tabs.el.dataset.slot).toBe('tabs-list');
        const c = tabs.trigger('c')!;
        expect(c.getAttribute('role')).toBe('tab');
        expect(c.dataset.slot).toBe('tabs-trigger');
        expect(c.getAttribute('aria-selected')).toBe('true');
        expect(c.hasAttribute('data-selected')).toBe(true);
        expect(c.tabIndex).toBe(0);
        expect(tabs.trigger('a')!.tabIndex).toBe(-1);
        expect(tabs.trigger('b')!.disabled).toBe(true);
        expect(c.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('role')).toBe('tabpanel');
        expect(panel.dataset.slot).toBe('tabs-content');
        expect(panel.getAttribute('aria-labelledby')).toBe(c.id);
        expect(panel.hidden).toBe(false);

        const strip = createTabs({ items: TAB_ITEMS });
        expect(strip.el.dataset.variant).toBe('default');
        expect(strip.trigger('a')!.hasAttribute('aria-controls')).toBe(false);
    });

    it('selects on click and calls onValueChange once; setValue does not', async () => {
        const onValueChange = vi.fn();
        const tabs = createTabs({ items: TAB_ITEMS, onValueChange });
        document.body.append(tabs.el);
        tabs.trigger('c')!.click();
        await settle();
        expect(onValueChange).toHaveBeenCalledWith('c');
        expect(tabs.value).toBe('c');
        tabs.trigger('b')!.click();
        await settle();
        expect(tabs.value).toBe('c'); // disabled
        tabs.setValue('a');
        expect(tabs.value).toBe('a');
        await settle();
        expect(tabs.trigger('a')!.getAttribute('aria-selected')).toBe('true');
        expect(onValueChange).toHaveBeenCalledTimes(1);
    });

    it('the arrow keys move and select (automatic), skipping disabled tabs and wrapping', async () => {
        const onValueChange = vi.fn();
        const tabs = createTabs({ items: TAB_ITEMS, defaultValue: 'c', onValueChange });
        document.body.append(tabs.el);
        tabs.trigger('c')!.focus();
        await settle();
        key(tabs.trigger('c')!, 'ArrowRight');
        await settle();
        expect(document.activeElement).toBe(tabs.trigger('a'));
        expect(tabs.value).toBe('a');
        expect(onValueChange).toHaveBeenLastCalledWith('a');
    });

    it('manual activation moves focus without selecting', async () => {
        const tabs = createTabs({ items: TAB_ITEMS, activationMode: 'manual' });
        document.body.append(tabs.el);
        tabs.trigger('a')!.focus();
        await settle();
        key(tabs.trigger('a')!, 'End');
        await settle();
        expect(document.activeElement).toBe(tabs.trigger('c'));
        expect(tabs.value).toBe('a');
    });

    it('hides a tab: skipped by the keys, and hiding the selected one selects the first available (notified)', async () => {
        const onValueChange = vi.fn();
        const tabs = createTabs({ items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], defaultValue: 'b', variant: 'line', activationMode: 'manual', onValueChange });
        document.body.append(tabs.el);
        tabs.setHidden('a', true);
        expect(tabs.trigger('a')!.hidden).toBe(true);
        tabs.trigger('c')!.focus();
        await settle();
        key(tabs.trigger('c')!, 'ArrowRight');
        await settle();
        expect(document.activeElement).toBe(tabs.trigger('b')); // wrapped past the hidden tab
        tabs.setHidden('b', true);
        expect(tabs.value).toBe('c');
        await settle();
        expect(onValueChange).toHaveBeenLastCalledWith('c');
        expect(tabs.trigger('c')!.getAttribute('aria-selected')).toBe('true');
        tabs.setHidden('a', false);
        expect(tabs.trigger('a')!.hidden).toBe(false);
        expect(tabs.value).toBe('c'); // showing a tab never moves the selection
    });

    it('reads a tab with a description on two lines, its count on the label line', () => {
        const tabs = createTabs({
            items: [
                { value: '2026-11-05', label: 'Thu', description: '5' },
                { value: '2026-11-06', label: 'Fri', description: '6', count: 3 },
                { value: 'all', label: 'All' },
            ],
            variant: 'soft',
        });
        const fri = tabs.trigger('2026-11-06')!;
        expect(fri.hasAttribute('data-description')).toBe(true);
        expect(fri.querySelector('[data-slot="tabs-label"]')!.textContent).toBe('Fri3');
        expect(fri.querySelector('[data-slot="tabs-description"]')!.textContent).toBe('6');
        expect(fri.textContent).toBe('Fri36');
        tabs.setCount('2026-11-06', 4);
        expect(fri.querySelector('[data-slot="tabs-label"] [data-slot="tabs-count"]')!.textContent).toBe('4');
        tabs.setCount('2026-11-05', 1);
        expect(tabs.trigger('2026-11-05')!.querySelector('[data-slot="tabs-label"] [data-slot="tabs-count"]')).not.toBeNull();
        // A one-line tab keeps its text and count directly in the trigger.
        const all = tabs.trigger('all')!;
        expect(all.hasAttribute('data-description')).toBe(false);
        expect(all.querySelector('[data-slot="tabs-label"]')).toBeNull();
        expect(all.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    });

    it('keeps the selection across new items, or falls back to the first available one', async () => {
        const tabs = createTabs({ items: TAB_ITEMS, defaultValue: 'c' });
        tabs.setItems([{ value: 'c', label: 'C!' }, { value: 'd', label: 'D' }]);
        expect(tabs.value).toBe('c');
        expect(tabs.trigger('c')!.textContent).toBe('C!');
        tabs.setItems([{ value: 'd', label: 'D' }]);
        expect(tabs.value).toBe('d');
        await settle();
        expect(tabs.trigger('d')!.getAttribute('aria-selected')).toBe('true');
    });
});

describe('ToggleGroup (Zag toggle-group machine)', () => {
    it('single: a radio group where one option always stays chosen', async () => {
        const onChange = vi.fn();
        const view = createToggleGroup({ items: TAB_ITEMS, defaultValue: 'a', label: 'Order type', size: 'sm', fill: true, onValueChange: onChange });
        document.body.append(view.el);
        expect(view.el.getAttribute('role')).toBe('radiogroup');
        expect(view.el.getAttribute('aria-label')).toBe('Order type');
        expect(view.el.dataset.slot).toBe('toggle-group');
        expect(view.el.dataset.size).toBe('sm');
        expect(view.el.hasAttribute('data-fill')).toBe(true);
        const [a, b, c] = [...view.el.querySelectorAll<HTMLButtonElement>('.vela-toggle-group-item')];
        expect(a!.getAttribute('role')).toBe('radio');
        expect(a!.dataset.slot).toBe('toggle-group-item');
        expect(a!.getAttribute('aria-checked')).toBe('true');
        expect(a!.dataset.state).toBe('on');
        expect(b!.disabled).toBe(true);
        c!.click();
        await settle();
        expect(onChange).toHaveBeenLastCalledWith('c');
        expect(view.values).toEqual(['c']);
        expect(c!.getAttribute('aria-checked')).toBe('true');
        c!.click();
        await settle();
        expect(view.values).toEqual(['c']); // pressing the chosen option keeps it
        view.setValue('a');
        expect(view.values).toEqual(['a']);
        await settle();
        expect(a!.getAttribute('aria-checked')).toBe('true');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('multiple: each option toggles on its own, and the arrow keys only move focus', async () => {
        const onChange = vi.fn();
        const view = createToggleGroup({ type: 'multiple', items: [{ value: 'b', label: 'Bold' }, { value: 'i', label: 'Italic' }, { value: 'u', label: 'Underline' }], defaultValue: ['i'], onValueChange: onChange });
        document.body.append(view.el);
        expect(view.el.getAttribute('role')).toBe('group');
        const [bold, italic] = [...view.el.querySelectorAll<HTMLButtonElement>('.vela-toggle-group-item')];
        expect(italic!.getAttribute('aria-pressed')).toBe('true');
        expect(italic!.hasAttribute('aria-checked')).toBe(false);
        bold!.click();
        await settle();
        expect(onChange).toHaveBeenLastCalledWith(['i', 'b']);
        italic!.click();
        await settle();
        expect(onChange).toHaveBeenLastCalledWith(['b']);
        expect(italic!.getAttribute('aria-pressed')).toBe('false');
        bold!.focus();
        await settle();
        key(bold!, 'ArrowRight');
        await settle();
        expect(document.activeElement).toBe(italic);
        expect(view.values).toEqual(['b']);
    });

    it('names icon-only options by their label', () => {
        const view = createToggleGroup({ items: [{ value: 'list', label: 'Table', icon: 'burger' }], iconOnly: true });
        const option = view.el.querySelector('.vela-toggle-group-item')!;
        expect(option.getAttribute('aria-label')).toBe('Table');
        expect(option.textContent).toBe('');
    });
});

describe('Badge', () => {
    it('carries its slot, variant and shape', () => {
        const b = createBadge({ text: 'Paper', variant: 'secondary' });
        expect(b.el.dataset.slot).toBe('badge');
        expect(b.el.dataset.variant).toBe('secondary');
        b.setVariant('down');
        expect(b.el.dataset.variant).toBe('down');
        expect(createBadge({ text: 'Live' }).el.dataset.variant).toBe('default');
        expect(createBadge({ text: '3', count: true }).el.hasAttribute('data-count')).toBe(true);
    });
});
