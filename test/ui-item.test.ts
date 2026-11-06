// @vitest-environment jsdom
// The kit's Item: a list row with media, a title over a description, and actions. With
// onSelect the row is a button to the mouse and the keyboard, while its own controls keep
// their presses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem, createItemGroup } from '@luxalgo/vela-ui/item';

afterEach(() => document.body.replaceChildren());

const part = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[data-slot="item-${name}"]`);
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('item', () => {
    it('lays out its media, its two lines, its meta and its actions', () => {
        const price = document.createElement('span');
        price.textContent = '64,210.5';
        const remove = document.createElement('button');
        const item = createItem({ title: 'BTCUSDT', description: 'Bitcoin / TetherUS', media: 'star', meta: [price, '+1.2%'], actions: remove, size: 'sm', variant: 'outline' });
        expect(item.el.getAttribute('data-slot')).toBe('item');
        expect(item.el.dataset).toMatchObject({ size: 'sm', variant: 'outline' });
        expect(part(item.el, 'media')!.querySelector('[data-icon] svg')).not.toBeNull();
        expect(part(item.el, 'content')!.textContent).toBe('BTCUSDTBitcoin / TetherUS');
        expect(part(item.el, 'title')!.textContent).toBe('BTCUSDT');
        expect(part(item.el, 'description')!.textContent).toBe('Bitcoin / TetherUS');
        expect(part(item.el, 'meta')!.textContent).toBe('64,210.5+1.2%');
        expect(part(item.el, 'actions')!.firstChild).toBe(remove);
        expect([...item.el.children].map((c) => c.getAttribute('data-slot'))).toEqual(['item-media', 'item-content', 'item-meta', 'item-actions']);
        expect(createItem({ title: 'Bare' }).el.children.length).toBe(1);
        // Without onSelect it is no control.
        expect(item.el.hasAttribute('role')).toBe(false);
        expect(item.el.hasAttribute('tabindex')).toBe(false);
    });

    it('is a button when it can be chosen, by a click, Enter or Space', () => {
        const onSelect = vi.fn();
        const item = createItem({ title: 'Alert on BTC', onSelect });
        document.body.append(item.el);
        expect(item.el.getAttribute('role')).toBe('button');
        expect(item.el.tabIndex).toBe(0);
        expect(item.el.hasAttribute('data-clickable')).toBe(true);
        item.el.click();
        key(item.el, 'Enter');
        key(item.el, ' ');
        key(item.el, 'a');
        expect(onSelect).toHaveBeenCalledTimes(3);
    });

    it("leaves a press on one of its controls to that control", () => {
        const onSelect = vi.fn();
        const remove = vi.fn();
        const button = document.createElement('button');
        button.addEventListener('click', remove);
        const icon = document.createElement('span');
        button.append(icon);
        const item = createItem({ title: 'ETHUSDT', onSelect, actions: button, revealActions: true });
        document.body.append(item.el);
        expect(item.el.hasAttribute('data-reveal-actions')).toBe(true);
        icon.click();
        key(button, 'Enter');
        expect(remove).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
        part(item.el, 'title')!.click();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('marks the current row, and an option row as selected', () => {
        const item = createItem({ title: 'SOLUSDT', onSelect: () => {}, selected: true });
        expect(item.el.hasAttribute('data-selected')).toBe(true);
        expect(item.el.getAttribute('aria-current')).toBe('true');
        item.setSelected(false);
        expect(item.el.hasAttribute('data-selected')).toBe(false);
        expect(item.el.hasAttribute('aria-current')).toBe(false);
        const option = createItem({ title: 'AAPL', role: 'option', onSelect: () => {} });
        expect(option.el.getAttribute('role')).toBe('option');
        expect(option.el.getAttribute('aria-selected')).toBe('false');
        option.setSelected(true);
        expect(option.el.getAttribute('aria-selected')).toBe('true');
        expect(option.el.hasAttribute('aria-current')).toBe(false);
    });

    it('takes no presses while disabled, and leaves the tab order', () => {
        const onSelect = vi.fn();
        const item = createItem({ title: 'Expired', onSelect, disabled: true });
        document.body.append(item.el);
        expect(item.el.getAttribute('aria-disabled')).toBe('true');
        expect(item.el.tabIndex).toBe(-1);
        item.el.click();
        key(item.el, 'Enter');
        expect(onSelect).not.toHaveBeenCalled();
        item.setDisabled(false);
        expect(item.el.tabIndex).toBe(0);
        item.el.click();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('rewrites its lines', () => {
        const item = createItem({ title: 'Draft' });
        item.setTitle('Final');
        item.setDescription('Saved 2 min ago');
        expect(part(item.el, 'title')!.textContent).toBe('Final');
        expect(part(item.el, 'description')!.textContent).toBe('Saved 2 min ago');
        item.setDescription(null);
        expect(part(item.el, 'description')).toBeNull();
    });

    it('stacks rows in a group, separated on request', () => {
        const a = createItem({ title: 'A' });
        const b = createItem({ title: 'B' }).el;
        const group = createItemGroup({ items: [a, b], separated: true, label: 'Watchlist' });
        expect(group.el.getAttribute('data-slot')).toBe('item-group');
        expect(group.el.hasAttribute('data-separated')).toBe(true);
        expect(group.el.getAttribute('aria-label')).toBe('Watchlist');
        expect([...group.el.children]).toEqual([a.el, b]);
        group.setItems([b]);
        expect([...group.el.children]).toEqual([b]);
    });
});
