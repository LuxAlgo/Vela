// @vitest-environment jsdom
// Menu `iconBadges`: row icons sit in a squared badge. A level holding icons reserves the
// badge column on every row (empty on icon-less rows) so labels align; a level without
// icons keeps its natural left edge; menus that do not opt in keep their bare icons.
import { describe, it, expect, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { Menu, type MenuItemDescriptor } from '../src/ui/components/menu';

afterEach(() => {
    document.body.replaceChildren();
});

function host(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-ui';
    document.body.append(el);
    return el;
}

/** Each row of a list as the ordered class names of its children. */
function rows(list: Element): string[][] {
    return [...list.querySelectorAll(':scope > .vela-menu-item')].map((li) => [...li.children].map((c) => c.className));
}

const MIXED: MenuItemDescriptor[] = [
    { id: 'shot', label: 'Screenshot', icon: 'camera' },
    { id: 'plain', label: 'Plain' },
    { id: 'alerts', label: 'Alerts', icon: 'bell' },
];

describe('Menu iconBadges', () => {
    it('wraps each icon in a badge and reserves an empty badge on icon-less rows', () => {
        const h = host();
        const menu = new Menu({ host: h, items: MIXED, iconBadges: true });
        const list = h.querySelector('.vela-menu')!;
        expect(list.getAttribute('data-badges')).toBe('1');
        expect(rows(list)).toEqual([
            ['vela-menu-badge', 'vela-menu-label'],
            ['vela-menu-badge', 'vela-menu-label'],
            ['vela-menu-badge', 'vela-menu-label'],
        ]);
        const badges = [...list.querySelectorAll('.vela-menu-badge')];
        expect(badges.map((b) => b.querySelector(':scope > .vela-icon svg') !== null)).toEqual([true, false, true]);
        expect(badges[1]!.childElementCount).toBe(0);
        menu.destroy();
    });

    it('keeps the natural left edge on a level with no icon', () => {
        const h = host();
        const menu = new Menu({ host: h, items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], iconBadges: true });
        const list = h.querySelector('.vela-menu')!;
        expect(list.hasAttribute('data-badges')).toBe(false);
        expect(list.querySelector('.vela-menu-badge')).toBeNull();
        expect(rows(list)).toEqual([['vela-menu-label'], ['vela-menu-label']]);
        menu.destroy();
    });

    it('leaves menus that do not opt in with bare icons', () => {
        const h = host();
        const menu = new Menu({ host: h, items: MIXED });
        const list = h.querySelector('.vela-menu')!;
        expect(list.hasAttribute('data-badges')).toBe(false);
        expect(list.querySelector('.vela-menu-badge')).toBeNull();
        // The icon-less row keeps an empty bare slot so its label lines up with the others.
        expect(rows(list)).toEqual([['vela-icon', 'vela-menu-label'], ['vela-icon', 'vela-menu-label'], ['vela-icon', 'vela-menu-label']]);
        expect(list.querySelectorAll('.vela-menu-item')[1]!.querySelector('.vela-icon')!.childElementCount).toBe(0);
        menu.destroy();
    });

    it('re-decides the column when the items change', () => {
        const h = host();
        const menu = new Menu({ host: h, items: MIXED, iconBadges: true });
        const list = h.querySelector('.vela-menu')!;
        menu.setItems([{ id: 'a', label: 'A' }]);
        expect(list.hasAttribute('data-badges')).toBe(false);
        expect(list.querySelector('.vela-menu-badge')).toBeNull();
        menu.setItems(MIXED);
        expect(list.getAttribute('data-badges')).toBe('1');
        expect(list.querySelectorAll('.vela-menu-badge')).toHaveLength(3);
        menu.destroy();
    });

    it('coexists with checkmarks: the mark column leads, the badge follows', () => {
        const h = host();
        const menu = new Menu({
            host: h,
            checkmarks: true,
            iconBadges: true,
            items: [
                { id: 'auto', label: 'Auto', checked: true },
                { id: 'log', label: 'Log', checked: false },
                { id: 'act', label: 'Action', icon: 'camera' },
            ],
        });
        const list = h.querySelector('.vela-menu')!;
        expect(rows(list)).toEqual([
            ['vela-menu-mark', 'vela-menu-badge', 'vela-menu-label'],
            ['vela-menu-mark', 'vela-menu-badge', 'vela-menu-label'],
            ['vela-menu-mark', 'vela-menu-badge', 'vela-menu-label'],
        ]);
        // The ✓ stays in the mark column, never inside the badge.
        const first = list.querySelector('.vela-menu-item')!;
        expect(first.getAttribute('data-checkmark')).toBe('1');
        expect(first.querySelector('.vela-menu-mark .vela-icon')).not.toBeNull();
        expect(first.querySelector('.vela-menu-badge')!.childElementCount).toBe(0);
        menu.destroy();
    });

    it('applies per level: a submenu inherits the mode and decides its own column', () => {
        const h = host();
        const menu = new Menu({
            host: h,
            iconBadges: true,
            items: [
                { id: 'plain', label: 'Plain' },
                { id: 'more', label: 'More', submenu: [{ id: 'shot', label: 'Screenshot', icon: 'camera' }, { id: 'x', label: 'X' }] },
            ],
        });
        const [root, sub] = [...h.querySelectorAll('.vela-menu')];
        expect(root!.hasAttribute('data-badges')).toBe(false);
        expect(sub!.getAttribute('data-badges')).toBe('1');
        expect(rows(sub!)).toEqual([
            ['vela-menu-badge', 'vela-menu-label'],
            ['vela-menu-badge', 'vela-menu-label'],
        ]);
        menu.destroy();
    });
});
