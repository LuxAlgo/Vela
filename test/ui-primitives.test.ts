// @vitest-environment jsdom
// The kit's primitives: Button and Badge (plain controllers handing out part attributes),
// Tabs and ToggleGroup (Zag machines behind vanilla views), driven by clicks and the keyboard.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { applyProps } from '../src/ui/headless';
import { Button, buttonController } from '../src/ui/components/button';
import { Tabs, tabsController } from '../src/ui/components/tabs';
import { ToggleGroup } from '../src/ui/components/toggle-group';
import { Badge } from '../src/ui/components/badge';

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
        expect(buttonController().rootProps()).toMatchObject({ type: 'button', 'data-slot': 'button', 'data-variant': 'default', 'data-size': 'default', 'aria-pressed': undefined, 'aria-label': undefined, disabled: false });
        const icon = buttonController({ variant: 'ghost', size: 'icon-xs', label: 'Close', pressed: false });
        expect(icon.iconOnly).toBe(true);
        expect(icon.rootProps()).toMatchObject({ 'data-size': 'icon-xs', 'aria-label': 'Close', 'aria-pressed': 'false' });
        icon.setPressed(true);
        expect(icon.rootProps()).toMatchObject({ 'aria-pressed': 'true', 'data-pressed': true });
        expect(buttonController({ size: 'sm', label: 'Apply' }).rootProps()['aria-label']).toBeUndefined();
    });

    it('renders a clickable button with icons on either side that follows its state', () => {
        const onClick = vi.fn();
        const b = new Button({ text: 'Defaults', variant: 'outline', icon: 'reset', iconEnd: 'chevron-down', onClick });
        document.body.append(b.el);
        expect(b.el.className).toBe('vela-btn');
        expect(b.el.dataset.variant).toBe('outline');
        expect([...b.el.querySelectorAll('[data-icon]')].map((i) => i.getAttribute('data-icon'))).toEqual(['inline-start', 'inline-end']);
        expect(b.el.textContent).toBe('Defaults');
        b.el.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        b.setDisabled(true);
        expect(b.el.disabled).toBe(true);
        b.setText('Reset');
        expect(b.el.textContent).toBe('Reset');

        const square = new Button({ icon: 'close', size: 'icon-sm', variant: 'ghost', label: 'Close', iconEnd: 'chevron-down', text: 'ignored' });
        expect(square.el.getAttribute('aria-label')).toBe('Close');
        expect(square.el.textContent).toBe('');
        expect(square.el.querySelectorAll('[data-icon]').length).toBe(1);
    });
});

describe('Tabs (Zag tabs machine)', () => {
    it('maps the options onto the machine: first available tab, orientation, activation mode', () => {
        const ctrl = tabsController({ items: [{ id: 'x', label: 'X', disabled: true }, ...ITEMS], orientation: 'vertical', activationMode: 'manual' });
        expect(ctrl.props).toMatchObject({ defaultValue: 'a', orientation: 'vertical', activationMode: 'manual', loopFocus: true });
        expect(tabsController({ items: [{ id: 'h', label: 'H', hidden: true }, { id: 'v', label: 'V' }] }).props.defaultValue).toBe('v');
    });

    it('renders tabs with one tab stop, slots, and panels linked only when asked', () => {
        const tabs = new Tabs({ items: ITEMS, value: 'c', variant: 'line', panels: true, className: 'host-strip' });
        const panel = document.createElement('div');
        document.body.append(tabs.el, panel);
        tabs.attachPanel('c', panel);
        expect(tabs.el.className).toBe('vela-tabs host-strip');
        expect(tabs.el.getAttribute('role')).toBe('tablist');
        expect(tabs.el.dataset.slot).toBe('tabs-list');
        const c = tabs.tab('c')!;
        expect(c.getAttribute('role')).toBe('tab');
        expect(c.dataset.slot).toBe('tabs-trigger');
        expect(c.getAttribute('aria-selected')).toBe('true');
        expect(c.hasAttribute('data-selected')).toBe(true);
        expect(c.tabIndex).toBe(0);
        expect(tabs.tab('a')!.tabIndex).toBe(-1);
        expect(tabs.tab('b')!.disabled).toBe(true);
        expect(c.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('role')).toBe('tabpanel');
        expect(panel.dataset.slot).toBe('tabs-content');
        expect(panel.getAttribute('aria-labelledby')).toBe(c.id);
        expect(panel.hidden).toBe(false);

        const strip = new Tabs({ items: ITEMS });
        expect(strip.el.dataset.variant).toBe('default');
        expect(strip.tab('a')!.hasAttribute('aria-controls')).toBe(false);
    });

    it('selects on click and notifies the change once; setValue is silent', async () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: ITEMS, onChange });
        document.body.append(tabs.el);
        tabs.tab('c')!.click();
        await settle();
        expect(onChange).toHaveBeenCalledWith('c');
        expect(tabs.value).toBe('c');
        tabs.tab('b')!.click();
        await settle();
        expect(tabs.value).toBe('c'); // disabled
        tabs.setValue('a');
        expect(tabs.value).toBe('a');
        await settle();
        expect(tabs.tab('a')!.getAttribute('aria-selected')).toBe('true');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('the arrow keys move and select (automatic), skipping disabled tabs and wrapping', async () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: ITEMS, value: 'c', onChange });
        document.body.append(tabs.el);
        tabs.tab('c')!.focus();
        await settle();
        key(tabs.tab('c')!, 'ArrowRight');
        await settle();
        expect(document.activeElement).toBe(tabs.tab('a'));
        expect(tabs.value).toBe('a');
        expect(onChange).toHaveBeenLastCalledWith('a');
    });

    it('manual activation moves focus without selecting', async () => {
        const tabs = new Tabs({ items: ITEMS, activationMode: 'manual' });
        document.body.append(tabs.el);
        tabs.tab('a')!.focus();
        await settle();
        key(tabs.tab('a')!, 'End');
        await settle();
        expect(document.activeElement).toBe(tabs.tab('c'));
        expect(tabs.value).toBe('a');
    });

    it('hides a tab: skipped by the keys, and hiding the selected one selects the first available (notified)', async () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], value: 'b', variant: 'line', activationMode: 'manual', onChange });
        document.body.append(tabs.el);
        tabs.setHidden('a', true);
        expect(tabs.tab('a')!.hidden).toBe(true);
        tabs.tab('c')!.focus();
        await settle();
        key(tabs.tab('c')!, 'ArrowRight');
        await settle();
        expect(document.activeElement).toBe(tabs.tab('b')); // wrapped past the hidden tab
        tabs.setHidden('b', true);
        expect(tabs.value).toBe('c');
        await settle();
        expect(onChange).toHaveBeenLastCalledWith('c');
        expect(tabs.tab('c')!.getAttribute('aria-selected')).toBe('true');
        tabs.setHidden('a', false);
        expect(tabs.tab('a')!.hidden).toBe(false);
        expect(tabs.value).toBe('c'); // showing a tab never moves the selection
    });

    it('keeps the selection across new items, or falls back to the first available one', async () => {
        const tabs = new Tabs({ items: ITEMS, value: 'c' });
        tabs.setItems([{ id: 'c', label: 'C!' }, { id: 'd', label: 'D' }]);
        expect(tabs.value).toBe('c');
        expect(tabs.tab('c')!.textContent).toBe('C!');
        tabs.setItems([{ id: 'd', label: 'D' }]);
        expect(tabs.value).toBe('d');
        await settle();
        expect(tabs.tab('d')!.getAttribute('aria-selected')).toBe('true');
    });
});

describe('ToggleGroup (Zag toggle-group machine)', () => {
    it('single: a radio group where one option always stays chosen', async () => {
        const onChange = vi.fn();
        const view = new ToggleGroup({ items: ITEMS, value: 'a', label: 'Order type', size: 'sm', fill: true, onChange });
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
        const view = new ToggleGroup({ type: 'multiple', items: [{ id: 'b', label: 'Bold' }, { id: 'i', label: 'Italic' }, { id: 'u', label: 'Underline' }], value: ['i'], onChange });
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
        const view = new ToggleGroup({ items: [{ id: 'list', label: 'Table', icon: 'burger' }], iconOnly: true });
        const option = view.el.querySelector('.vela-toggle-group-item')!;
        expect(option.getAttribute('aria-label')).toBe('Table');
        expect(option.textContent).toBe('');
    });
});

describe('Badge', () => {
    it('carries its slot, variant and shape', () => {
        const b = new Badge({ text: 'Paper', variant: 'secondary' });
        expect(b.el.dataset.slot).toBe('badge');
        expect(b.el.dataset.variant).toBe('secondary');
        b.setVariant('down');
        expect(b.el.dataset.variant).toBe('down');
        expect(new Badge({ text: 'Live' }).el.dataset.variant).toBe('default');
        expect(new Badge({ text: '3', count: true }).el.hasAttribute('data-count')).toBe(true);
    });
});
