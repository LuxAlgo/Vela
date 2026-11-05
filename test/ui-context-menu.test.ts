// @vitest-environment jsdom
// The kit's ContextMenu: the dropdown menu's list opened by a right-click on its target, a
// long press on a touch screen, or the context-menu key. Its rows may depend on where it opened;
// a right-click an inner menu already answered is left to it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { createContextMenu, type ContextMenu } from '../packages/vela-ui/src/components/context-menu';
import { disposeWithin } from '../packages/vela-ui/src/lib/dispose';
import type { MenuItemDescriptor } from '../packages/vela-ui/src/components/dropdown-menu';

const ROWS: MenuItemDescriptor[] = [
    { id: 'copy', label: 'Copy' },
    { id: 'remove', label: 'Remove' },
];

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const menus: ContextMenu[] = [];
afterEach(() => {
    for (const m of menus.splice(0)) m.destroy();
    vi.useRealTimers();
    document.body.replaceChildren();
});

function setup(extra: Partial<Parameters<typeof createContextMenu>[0]> = {}): { target: HTMLElement; menu: ContextMenu; onSelect: ReturnType<typeof vi.fn> } {
    const target = document.createElement('div');
    target.className = 'vela-ui';
    document.body.append(target);
    const onSelect = vi.fn();
    const menu = createContextMenu({ target, items: ROWS, onSelect, ...extra });
    menus.push(menu);
    return { target, menu, onSelect };
}

const rightClick = (el: Element, x = 40, y = 30): MouseEvent => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
    el.dispatchEvent(e);
    return e;
};
const touch = (el: Element, type: string, x = 40, y = 30): void => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
};
/** Zag applies an open on a later tick. */
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
const rowLabels = (): string[] => [...document.querySelectorAll('[data-slot~="dropdown-menu-content"] [data-slot~="dropdown-menu-label"]')].map((el) => el.textContent ?? '');

describe('the context menu', () => {
    it('opens on a right-click, takes the click from the page, and reports the row picked', async () => {
        const { target, menu, onSelect } = setup();
        expect(document.querySelector('[data-slot~="dropdown-menu-content"]')).toBeNull();
        const e = rightClick(target);
        expect(e.defaultPrevented).toBe(true);
        await settled();
        expect(menu.open).toBe(true);
        expect(rowLabels()).toEqual(['Copy', 'Remove']);
        // A pointer highlights the row it hovers, and the click picks the highlighted row.
        const row = document.querySelector<HTMLElement>('[data-slot~="dropdown-menu-item"]')!;
        row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 50, clientY: 40 }));
        await settled();
        row.click();
        await settled();
        expect(onSelect).toHaveBeenCalledWith('copy');
    });

    it('asks a function for the rows of each opening, and opens nothing when it has none', async () => {
        const target = document.createElement('div');
        document.body.append(target);
        const row = document.createElement('span');
        row.dataset.kind = 'drawing';
        target.append(row);
        const menu = createContextMenu({
            target,
            items: (e) => ((e.target as HTMLElement).dataset.kind === 'drawing' ? [{ id: 'delete', label: 'Delete drawing' }] : null),
        });
        menus.push(menu);

        const empty = rightClick(target);
        expect(empty.defaultPrevented).toBe(false);
        await settled();
        expect(menu.open).toBe(false);

        rightClick(row);
        await settled();
        expect(menu.open).toBe(true);
        expect(rowLabels()).toEqual(['Delete drawing']);
    });

    it('leaves a right-click an inner menu answered to that menu', async () => {
        const outer = setup();
        const inner = document.createElement('div');
        outer.target.append(inner);
        const innerMenu = createContextMenu({ target: inner, items: [{ id: 'inner', label: 'Inner' }] });
        menus.push(innerMenu);
        rightClick(inner);
        await settled();
        expect(innerMenu.open).toBe(true);
        expect(outer.menu.open).toBe(false);
    });

    it('opens on a long press, not on a press that moves, and swallows the release click', async () => {
        vi.useFakeTimers();
        const { target, menu } = setup();
        const clicked = vi.fn();
        target.addEventListener('click', clicked);

        touch(target, 'pointerdown');
        touch(target, 'pointermove', 60, 30);
        await vi.advanceTimersByTimeAsync(700);
        expect(menu.open).toBe(false);

        touch(target, 'pointerdown');
        await vi.advanceTimersByTimeAsync(700);
        expect(menu.open).toBe(true);
        touch(target, 'pointerup');
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(clicked).not.toHaveBeenCalled();
    });

    it('takes no long press where it is turned off', async () => {
        vi.useFakeTimers();
        const { target, menu } = setup({ longPress: false });
        touch(target, 'pointerdown');
        await vi.advanceTimersByTimeAsync(700);
        expect(menu.open).toBe(false);
        rightClick(target);
        await vi.advanceTimersByTimeAsync(100);
        expect(menu.open).toBe(true);
    });

    it('lets go of its target when the subtree holding it is discarded', async () => {
        const { target, menu } = setup();
        const holder = document.createElement('div');
        target.replaceWith(holder);
        holder.append(target);
        disposeWithin(holder);
        const e = rightClick(target);
        expect(e.defaultPrevented).toBe(false);
        await settled();
        expect(menu.open).toBe(false);
    });
});
