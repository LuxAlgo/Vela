// @vitest-environment jsdom
// The headless primitives: Button, Tabs, Segmented, Badge — their controllers' state and
// part attributes, and the vanilla views driven by clicks and the keyboard.
import { describe, it, expect, vi, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { applyProps, rovingMove, rovingTarget } from '../src/ui/headless';
import { Button, buttonController } from '../src/ui/components/button';
import { Tabs, tabsController } from '../src/ui/components/tabs';
import { Segmented, segmentedController } from '../src/ui/components/segmented';
import { Badge } from '../src/ui/components/badge';

afterEach(() => document.body.replaceChildren());

const ITEMS = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', disabled: true },
    { id: 'c', label: 'C' },
];

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

    it('moves along the orientation, mirrored right to left, skipping disabled items and wrapping', () => {
        expect(rovingMove('ArrowRight', 'horizontal')).toBe('next');
        expect(rovingMove('ArrowRight', 'horizontal', 'rtl')).toBe('prev');
        expect(rovingMove('ArrowDown', 'horizontal')).toBeNull();
        expect(rovingMove('ArrowDown', 'vertical')).toBe('next');
        expect(rovingMove('End', 'vertical')).toBe('last');
        expect(rovingTarget(ITEMS, 'a', 'next')).toBe('c');
        expect(rovingTarget(ITEMS, 'c', 'next')).toBe('a');
        expect(rovingTarget(ITEMS, 'a', 'prev')).toBe('c');
        expect(rovingTarget(ITEMS, null, 'first')).toBe('a');
        expect(rovingTarget([{ id: 'x', disabled: true }], 'x', 'next')).toBeNull();
    });
});

describe('Button', () => {
    it('describes its variant, size, toggle state and accessible name', () => {
        const plain = buttonController();
        expect(plain.rootProps()).toMatchObject({ type: 'button', 'data-variant': 'secondary', 'data-size': 'md', 'aria-pressed': undefined, 'aria-label': undefined, disabled: false });
        const icon = buttonController({ variant: 'ghost', size: 'xs', iconOnly: true, label: 'Close', pressed: false });
        expect(icon.rootProps()).toMatchObject({ 'data-icon-only': true, 'aria-label': 'Close', 'aria-pressed': 'false' });
        icon.setPressed(true);
        expect(icon.rootProps()).toMatchObject({ 'aria-pressed': 'true', 'data-pressed': true });
    });

    it('renders a clickable button that follows its state', () => {
        const onClick = vi.fn();
        const b = new Button({ text: 'Apply', variant: 'primary', icon: 'check', onClick });
        document.body.append(b.el);
        expect(b.el.className).toBe('vela-btn');
        expect(b.el.dataset.variant).toBe('primary');
        expect(b.el.dataset.hasIcon).toBe('');
        expect(b.el.textContent).toBe('Apply');
        b.el.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        b.setDisabled(true);
        expect(b.el.disabled).toBe(true);
        b.setText('Save');
        expect(b.el.textContent).toBe('Save');
    });
});

describe('Tabs', () => {
    it('selects the first enabled tab by default, refuses disabled ones, and notifies changes only', () => {
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

    it('gives one tab stop to the selected tab, and links panels only when asked', () => {
        const t = tabsController({ items: ITEMS, value: 'c', panels: true });
        expect(t.listProps()).toMatchObject({ role: 'tablist', 'aria-orientation': 'horizontal' });
        expect(t.tabProps('c')).toMatchObject({ role: 'tab', 'aria-selected': 'true', tabindex: 0, 'data-state': 'active' });
        expect(t.tabProps('a')).toMatchObject({ 'aria-selected': 'false', tabindex: -1, 'data-state': 'inactive' });
        expect(t.tabProps('b')).toMatchObject({ 'aria-disabled': 'true', 'data-disabled': true });
        expect(t.tabProps('c')['aria-controls']).toBe(t.panelProps('c').id);
        expect(t.panelProps('a')).toMatchObject({ role: 'tabpanel', hidden: true, 'aria-labelledby': t.tabProps('a').id });
        expect(tabsController({ items: ITEMS }).tabProps('a')['aria-controls']).toBeUndefined();
    });

    it('keeps the selection across new items, or falls back to the first enabled one', () => {
        const t = tabsController({ items: ITEMS, value: 'c' });
        t.setItems([{ id: 'c', label: 'C!' }, { id: 'd', label: 'D' }]);
        expect(t.value).toBe('c');
        t.setItems([{ id: 'd', label: 'D' }]);
        expect(t.value).toBe('d');
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
        tabs.tab('c')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs.tab('a'));
        expect(tabs.value).toBe('a'); // skipped the disabled tab, wrapped, and selected

        const manual = new Tabs({ items: ITEMS, activation: 'manual' });
        document.body.append(manual.el);
        manual.tab('a')!.focus();
        manual.tab('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(document.activeElement).toBe(manual.tab('c'));
        expect(manual.value).toBe('a'); // focus moved, the selection did not
        manual.tab('c')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(manual.value).toBe('c');
    });
});

describe('Segmented', () => {
    it('is a radio group with one tab stop, and the arrow keys choose', () => {
        const s = segmentedController({ items: ITEMS, value: 'a', label: 'Order type' });
        expect(s.rootProps()).toMatchObject({ role: 'radiogroup', 'aria-label': 'Order type' });
        expect(s.itemProps('a')).toMatchObject({ role: 'radio', 'aria-checked': 'true', tabindex: 0, 'data-state': 'on' });
        expect(s.itemProps('c')).toMatchObject({ 'aria-checked': 'false', tabindex: -1, 'data-state': 'off' });
        expect(s.focusTarget('a', 'ArrowRight')).toBe('c');

        const onChange = vi.fn();
        const view = new Segmented({ items: ITEMS, value: 'a', size: 'sm', fill: true, onChange });
        document.body.append(view.el);
        expect(view.el.dataset.size).toBe('sm');
        expect(view.el.hasAttribute('data-fill')).toBe(true);
        const [first, , last] = [...view.el.querySelectorAll<HTMLButtonElement>('.vela-segment')];
        first!.focus();
        first!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(document.activeElement).toBe(last);
        expect(onChange).toHaveBeenCalledWith('c');
    });

    it('names icon-only options by their label', () => {
        const view = new Segmented({ items: [{ id: 'list', label: 'Table', icon: 'list' }], iconOnly: true });
        const option = view.el.querySelector('.vela-segment')!;
        expect(option.getAttribute('aria-label')).toBe('Table');
        expect(option.textContent).toBe('');
    });
});

describe('Badge', () => {
    it('carries its tone and shape', () => {
        const b = new Badge({ text: 'Paper', tone: 'accent' });
        expect(b.el.dataset.tone).toBe('accent');
        b.setTone('down');
        expect(b.el.dataset.tone).toBe('down');
        expect(new Badge({ text: '3', count: true }).el.hasAttribute('data-count')).toBe(true);
    });
});
