// @vitest-environment jsdom
// What trading panels add to the kit's primitives: buttons and toggle options in the market's
// colors, and tabs with an icon and a count.
import { describe, expect, it } from 'vitest';
import { createButton } from '@luxalgo/vela-ui/button';
import { createTabs } from '@luxalgo/vela-ui/tabs';
import { createToggleGroup } from '@luxalgo/vela-ui/toggle-group';

describe('market options', () => {
    it('buttons take the up and down variants', () => {
        expect(createButton({ text: 'Buy', variant: 'up' }).el.getAttribute('data-variant')).toBe('up');
        expect(createButton({ text: 'Sell', variant: 'down' }).el.getAttribute('data-variant')).toBe('down');
    });

    it('toggle options carry their tone', () => {
        const group = createToggleGroup({ items: [{ value: 'buy', label: 'Buy', tone: 'up' }, { value: 'sell', label: 'Sell', tone: 'down' }, { value: 'flat', label: 'Flat' }] });
        expect([...group.el.querySelectorAll('[data-slot="toggle-group-item"]')].map((b) => b.getAttribute('data-tone'))).toEqual(['up', 'down', null]);
    });

    it('tabs show an icon and a count, and update the count in place', () => {
        const tabs = createTabs({ items: [{ value: 'orders', label: 'Orders', icon: 'bell', count: 3 }, { value: 'history', label: 'History' }] });
        const orders = tabs.trigger('orders')!;
        expect([...orders.children].map((c) => c.getAttribute('data-slot'))).toEqual(['tabs-icon', 'tabs-count']);
        expect(orders.textContent).toBe('Orders3');
        expect(tabs.trigger('history')!.children).toHaveLength(0);
        tabs.setCount('orders', 5);
        expect(orders.querySelector('[data-slot="tabs-count"]')!.textContent).toBe('5');
        tabs.setCount('orders', null);
        expect(orders.querySelector('[data-slot="tabs-count"]')).toBeNull();
        tabs.setCount('history', 1);
        expect(tabs.trigger('history')!.textContent).toBe('History1');
    });
});
