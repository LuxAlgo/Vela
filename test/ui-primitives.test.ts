// @vitest-environment jsdom
// The headless primitives: Button, Tabs, ToggleGroup, Badge — their controllers' state and
// part attributes, and the vanilla views driven by clicks and the keyboard.
import { describe, it, expect, vi, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { applyProps, rovingMove, rovingTarget } from '../src/ui/headless';
import { Button, buttonController } from '../src/ui/components/button';
import { Tabs, tabsController } from '../src/ui/components/tabs';
import { ToggleGroup, toggleGroupController } from '../src/ui/components/toggle-group';
import { Badge } from '../src/ui/components/badge';

afterEach(() => document.body.replaceChildren());

const ITEMS = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', disabled: true },
    { id: 'c', label: 'C' },
];
const key = (el: Element, k: string): void => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('headless helpers', () => {
    it('applyProps writes values and removes the absent ones', () => {
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

    it('moves along the orientation, mirrored right to left, skipping disabled and hidden items and wrapping', () => {
        expect(rovingMove('ArrowRight', 'horizontal')).toBe('next');
        expect(rovingMove('ArrowRight', 'horizontal', 'rtl')).toBe('prev');
        expect(rovingMove('ArrowDown', 'horizontal')).toBeNull();
        expect(rovingMove('ArrowDown', 'vertical')).toBe('next');
        expect(rovingMove('End', 'vertical')).toBe('last');
        expect(rovingTarget(ITEMS, 'a', 'next')).toBe('c');
        expect(rovingTarget(ITEMS, 'c', 'next')).toBe('a');
        expect(rovingTarget(ITEMS, 'a', 'prev')).toBe('c');
        expect(rovingTarget([...ITEMS, { id: 'd', label: 'D', hidden: true }], 'c', 'next')).toBe('a');
        expect(rovingTarget(ITEMS, null, 'first')).toBe('a');
        expect(rovingTarget([{ id: 'x', disabled: true }], 'x', 'next')).toBeNull();
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

describe('Tabs', () => {
    it('selects the first available tab by default, refuses disabled ones, and notifies changes only', () => {
        const onChange = vi.fn();
        const t = tabsController({ items: [{ id: 'x', label: 'X', disabled: true }, ...ITEMS], onChange });
        expect(t.value).toBe('a');
        expect(t.select('b')).toBe(false);
        expect(t.select('a')).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        t.select('c');
        expect(onChange).toHaveBeenCalledWith('c');
        t.setValue('a');
        expect(onChange).toHaveBeenCalledTimes(1); // setValue is silent
    });

    it('gives one tab stop to the selected tab, names each part, and links panels only when asked', () => {
        const t = tabsController({ items: ITEMS, value: 'c', panels: true });
        expect(t.listProps()).toMatchObject({ role: 'tablist', 'data-slot': 'tabs-list', 'aria-orientation': 'horizontal' });
        expect(t.tabProps('c')).toMatchObject({ role: 'tab', 'data-slot': 'tabs-trigger', 'aria-selected': 'true', tabindex: 0, 'data-state': 'active' });
        expect(t.tabProps('a')).toMatchObject({ 'aria-selected': 'false', tabindex: -1, 'data-state': 'inactive' });
        expect(t.tabProps('b')).toMatchObject({ 'aria-disabled': 'true', 'data-disabled': true });
        expect(t.tabProps('c')['aria-controls']).toBe(t.panelProps('c').id);
        expect(t.panelProps('a')).toMatchObject({ role: 'tabpanel', 'data-slot': 'tabs-content', hidden: true, 'aria-labelledby': t.tabProps('a').id });
        expect(tabsController({ items: ITEMS }).tabProps('a')['aria-controls']).toBeUndefined();
    });

    it('keeps the selection across new items, or falls back to the first available one', () => {
        const t = tabsController({ items: ITEMS, value: 'c' });
        t.setItems([{ id: 'c', label: 'C!' }, { id: 'd', label: 'D' }]);
        expect(t.value).toBe('c');
        t.setItems([{ id: 'd', label: 'D' }]);
        expect(t.value).toBe('d');
    });

    it('hides a tab: skipped by the keys, unselectable, and hiding the selected one selects the first available', () => {
        const onChange = vi.fn();
        const t = tabsController({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], value: 'b', onChange });
        t.setHidden('a', true);
        expect(t.tabProps('a').hidden).toBe(true);
        expect(t.select('a')).toBe(false);
        expect(t.focusTarget('c', 'ArrowRight')).toBe('b');
        t.setHidden('b', true);
        expect(t.value).toBe('c');
        expect(onChange).toHaveBeenCalledWith('c');
        t.setHidden('a', false);
        expect(t.tabProps('a').hidden).toBe(false);
        expect(t.value).toBe('c'); // showing a tab never moves the selection
    });

    it('the view selects on click and on the arrow keys (automatic), or on Enter (manual)', () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: ITEMS, variant: 'filled', className: 'host-strip', onChange });
        document.body.append(tabs.el);
        expect(tabs.el.className).toBe('vela-tabs host-strip');
        expect(tabs.el.getAttribute('role')).toBe('tablist');
        tabs.tab('c')!.click();
        expect(onChange).toHaveBeenLastCalledWith('c');
        expect(tabs.tab('c')!.getAttribute('aria-selected')).toBe('true');

        tabs.tab('c')!.focus();
        key(tabs.tab('c')!, 'ArrowRight');
        expect(document.activeElement).toBe(tabs.tab('a'));
        expect(tabs.value).toBe('a'); // skipped the disabled tab, wrapped, and selected

        const manual = new Tabs({ items: ITEMS, activationMode: 'manual' });
        document.body.append(manual.el);
        expect(manual.el.dataset.variant).toBe('default');
        manual.tab('a')!.focus();
        key(manual.tab('a')!, 'End');
        expect(document.activeElement).toBe(manual.tab('c'));
        expect(manual.value).toBe('a'); // focus moved, the selection did not
        key(manual.tab('c')!, 'Enter');
        expect(manual.value).toBe('c');
    });

    it('the view hides a tab with the hidden attribute and repaints the new selection', () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], variant: 'line', onChange });
        tabs.setHidden('a', true);
        expect(tabs.tab('a')!.hidden).toBe(true);
        expect(tabs.tab('b')!.getAttribute('aria-selected')).toBe('true');
        expect(onChange).toHaveBeenCalledWith('b');
    });
});

describe('ToggleGroup', () => {
    it('single: a radio group with one tab stop, where the arrow keys choose and nothing deselects', () => {
        const s = toggleGroupController({ items: ITEMS, value: 'a', label: 'Order type' });
        expect(s.rootProps()).toMatchObject({ role: 'radiogroup', 'data-slot': 'toggle-group', 'aria-label': 'Order type' });
        expect(s.itemProps('a')).toMatchObject({ role: 'radio', 'data-slot': 'toggle-group-item', 'aria-checked': 'true', tabindex: 0, 'data-state': 'on' });
        expect(s.itemProps('c')).toMatchObject({ 'aria-checked': 'false', tabindex: -1, 'data-state': 'off' });
        expect(s.itemProps('a')['aria-pressed']).toBeUndefined();
        s.toggle('a');
        expect(s.values).toEqual(['a']);

        const onChange = vi.fn();
        const view = new ToggleGroup({ items: ITEMS, value: 'a', size: 'sm', fill: true, onChange });
        document.body.append(view.el);
        expect(view.el.dataset.size).toBe('sm');
        expect(view.el.hasAttribute('data-fill')).toBe(true);
        const [first, , last] = [...view.el.querySelectorAll<HTMLButtonElement>('.vela-toggle-group-item')];
        first!.focus();
        key(first!, 'ArrowLeft');
        expect(document.activeElement).toBe(last);
        expect(onChange).toHaveBeenCalledWith('c');
    });

    it('multiple: each option toggles on its own, and the arrow keys only move focus', () => {
        const onChange = vi.fn();
        const view = new ToggleGroup({ type: 'multiple', items: [{ id: 'b', label: 'Bold' }, { id: 'i', label: 'Italic' }, { id: 'u', label: 'Underline' }], value: ['i'], onChange });
        document.body.append(view.el);
        expect(view.el.getAttribute('role')).toBe('group');
        const [bold, italic, underline] = [...view.el.querySelectorAll<HTMLButtonElement>('.vela-toggle-group-item')];
        expect(italic!.getAttribute('aria-pressed')).toBe('true');
        expect(italic!.hasAttribute('aria-checked')).toBe(false);
        expect(italic!.tabIndex).toBe(0); // the tab stop sits on the first option that is on
        bold!.click();
        expect(onChange).toHaveBeenLastCalledWith(['i', 'b']);
        italic!.click();
        expect(onChange).toHaveBeenLastCalledWith(['b']);
        bold!.focus();
        key(bold!, 'ArrowRight');
        expect(document.activeElement).toBe(italic);
        expect(view.values).toEqual(['b']);
        expect(underline!.getAttribute('aria-pressed')).toBe('false');
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
