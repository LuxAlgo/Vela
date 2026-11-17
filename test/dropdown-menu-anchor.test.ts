// @vitest-environment jsdom
// Where an open dropdown menu sits once the page moves under it. The list keeps its place
// inside its host: a page that scrolls the host carries the list along, whether it opened from
// its trigger or at a point, and a trigger that shifts inside the host leaves it still
// (starring a timeframe adds a chip and moves the caret). jsdom lays nothing out, so each test
// gives the host and the trigger their boxes and reads the offset written on the positioner;
// with no offset parent in jsdom, that offset is in viewport coordinates.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
        return [];
    }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;

import { DropdownMenu, type DropdownMenuOptions, type MenuItemDescriptor } from '@luxalgo/vela-ui/dropdown-menu';

const ROWS: MenuItemDescriptor[] = [
    { id: '1m', label: '1m' },
    { id: '1h', label: '1h' },
];

/** The space Zag leaves between an anchor and its list. */
const GUTTER = 8;

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

function place(el: HTMLElement, box: Box): void {
    el.getBoundingClientRect = () => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, toJSON: () => box }) as DOMRect;
}

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
    // The viewport the list is kept inside: without a size, every placement overflows.
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1280 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 2000 });
});

const menus: DropdownMenu[] = [];
afterEach(() => {
    for (const m of menus.splice(0)) m.destroy();
    document.body.replaceChildren();
});

/** Zag applies an open, and places the list, on a later tick. */
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

interface Rig {
    host: HTMLElement;
    trigger: HTMLButtonElement;
    menu: DropdownMenu;
    /** Scroll the page: the host and everything in it move by `dy` on screen. */
    scrollPage(dy: number): Promise<void>;
    /** Move the trigger alone, inside a host that stays where it is. */
    shiftTrigger(dx: number): Promise<void>;
    /** Where the list sits. */
    offset(): { x: number; y: number };
    positioner: HTMLElement;
    list: HTMLElement;
}

function rig(withTrigger: boolean, placement: Pick<DropdownMenuOptions, 'side' | 'align' | 'sideOffset'> = {}): Rig {
    const hostBox: Box = { x: 100, y: 200, width: 800, height: 600 };
    const triggerBox: Box = { x: 140, y: 210, width: 40, height: 30 };
    const host = document.createElement('div');
    host.className = 'vela-ui';
    const trigger = document.createElement('button');
    host.append(trigger);
    document.body.append(host);
    place(host, hostBox);
    place(trigger, triggerBox);
    const menu = new DropdownMenu({ host, items: ROWS, ...placement, ...(withTrigger ? { trigger } : {}) });
    menus.push(menu);
    const positioner = host.querySelector<HTMLElement>('.vela-ui-layer')!;
    const list = positioner.querySelector<HTMLElement>('.vela-menu')!;
    // Any scroll re-places an open list; the boxes say what moved.
    const replaced = async (): Promise<void> => {
        window.dispatchEvent(new Event('scroll'));
        await settled();
    };
    return {
        host,
        trigger,
        menu,
        scrollPage: (dy) => {
            hostBox.y -= dy;
            triggerBox.y -= dy;
            return replaced();
        },
        shiftTrigger: (dx) => {
            triggerBox.x += dx;
            return replaced();
        },
        offset: () => ({ x: parseFloat(positioner.style.getPropertyValue('--x')), y: parseFloat(positioner.style.getPropertyValue('--y')) }),
        positioner,
        list,
    };
}

describe('an open dropdown menu, when the page moves under it', () => {
    it('opens under its trigger', async () => {
        const r = rig(true);
        r.menu.open();
        await settled();
        expect(r.menu.api.open).toBe(true);
        expect(r.offset()).toEqual({ x: 140, y: 210 + 30 + GUTTER });
    });

    it('follows its host when the page scrolls, staying under its trigger', async () => {
        const r = rig(true);
        r.menu.open();
        await settled();
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 140, y: 60 + 30 + GUTTER });
        await r.scrollPage(-150);
        expect(r.offset()).toEqual({ x: 140, y: 210 + 30 + GUTTER });
    });

    it('keeps its place when its trigger moves inside the host', async () => {
        const r = rig(true);
        r.menu.open();
        await settled();
        await r.shiftTrigger(36);
        expect(r.offset()).toEqual({ x: 140, y: 210 + 30 + GUTTER });
        // And still follows the page from there.
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 140, y: 60 + 30 + GUTTER });
    });

    it('takes its trigger\'s new place the next time it opens', async () => {
        const r = rig(true);
        r.menu.open();
        await settled();
        await r.shiftTrigger(36);
        r.menu.close();
        await settled();
        r.menu.open();
        await settled();
        expect(r.offset()).toEqual({ x: 176, y: 210 + 30 + GUTTER });
    });

    it('follows its host when the page scrolls, opened at a point', async () => {
        const r = rig(false);
        r.menu.openAt(300, 400);
        await settled();
        expect(r.menu.api.open).toBe(true);
        expect(r.offset()).toEqual({ x: 300, y: 400 + GUTTER });
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 300, y: 250 + GUTTER });
    });

    it('moves to the next point when asked again while open, and follows the page from there', async () => {
        const r = rig(false);
        r.menu.openAt(300, 400);
        await settled();
        r.menu.openAt(500, 320);
        await settled();
        expect(r.offset()).toEqual({ x: 500, y: 320 + GUTTER });
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 500, y: 170 + GUTTER });
    });

    it('opens at the point it is given, though it has a trigger', async () => {
        const r = rig(true);
        r.menu.openAt(300, 400);
        await settled();
        expect(r.offset()).toEqual({ x: 300, y: 400 + GUTTER });
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 300, y: 250 + GUTTER });
        // The point is this opening's alone: the next one is the trigger's.
        r.menu.close();
        await settled();
        r.menu.open();
        await settled();
        expect(r.offset()).toEqual({ x: 140, y: 60 + 30 + GUTTER });
    });

    it('opens against a rectangle, on the side and with the alignment and offset it was given', async () => {
        // A button the menu does not own as its trigger: its box is handed over as it stands.
        const start = rig(false);
        place(start.trigger, { x: 300, y: 400, width: 60, height: 24 });
        start.menu.openAt(start.trigger.getBoundingClientRect());
        await settled();
        expect(start.menu.api.open).toBe(true);
        expect(start.offset()).toEqual({ x: 300, y: 400 + 24 + GUTTER });

        // jsdom gives the list no width, so an end-aligned list starts at the box's far edge.
        const end = rig(false, { align: 'end', sideOffset: 4 });
        end.menu.openAt({ x: 300, y: 400, width: 60, height: 24 });
        await settled();
        expect(end.offset()).toEqual({ x: 360, y: 400 + 24 + 4 });

        const above = rig(false, { side: 'top', sideOffset: 4 });
        above.menu.openAt({ x: 300, y: 400, width: 60, height: 24 });
        await settled();
        expect(above.offset()).toEqual({ x: 300, y: 400 - 4 });
    });

    it('follows its host when the page scrolls, opened against a rectangle', async () => {
        const r = rig(false, { sideOffset: 4 });
        r.menu.openAt({ x: 300, y: 400, width: 60, height: 24 });
        await settled();
        await r.scrollPage(150);
        expect(r.offset()).toEqual({ x: 300, y: 250 + 24 + 4 });
    });

    it('opens on the other side of a rectangle that has no room on its own', async () => {
        const r = rig(false, { sideOffset: 4 });
        // A list 300px tall, against a box 100px from the bottom of the 2000px viewport.
        Object.defineProperty(r.positioner, 'offsetHeight', { configurable: true, value: 300 });
        r.menu.openAt({ x: 300, y: 1876, width: 60, height: 24 });
        await settled();
        // Above the box, its bottom edge the offset away from the box's top: clear of the button.
        expect(r.offset()).toEqual({ x: 300, y: 1876 - 4 - 300 });
        expect(r.list.dataset.placement).toBe('top-start');
    });

    it('opens at the point when a row\'s selection reopens it', async () => {
        const host = document.createElement('div');
        host.className = 'vela-ui';
        document.body.append(host);
        place(host, { x: 100, y: 200, width: 800, height: 600 });
        const menu: DropdownMenu = new DropdownMenu({ host, items: ROWS, onSelect: () => menu.openAt(500, 320) });
        menus.push(menu);
        const positioner = host.querySelector<HTMLElement>('.vela-ui-layer')!;
        menu.openAt(300, 400);
        await settled();
        const row = host.querySelector<HTMLElement>('[data-slot~="dropdown-menu-item"]')!;
        row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 310, clientY: 420 }));
        await settled();
        row.click();
        await settled();
        expect(menu.api.open).toBe(true);
        expect(parseFloat(positioner.style.getPropertyValue('--x'))).toBe(500);
        expect(parseFloat(positioner.style.getPropertyValue('--y'))).toBe(320 + GUTTER);
    });
});
