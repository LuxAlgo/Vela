// @vitest-environment jsdom
// Every surface of the chart's chrome announces itself: `vela:surface-open` on its own element
// once it shows, `vela:surface-close` while it still shows (before it hides or leaves the DOM), both
// bubbling to the host — so a host follows menus and panels without watching the DOM.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Menu } from '../src/ui/components/menu/view';
import { Popover, eventDismissedPopover } from '../src/ui/components/popover/view';
import { Dialog } from '../src/ui/components/dialog/view';
import { Drawer } from '../src/ui/components/drawer/view';
import { SidePanel } from '../src/widget/side-panel';
import { LayoutPicker } from '../src/widget/layout-picker';
import { SURFACE_OPEN_EVENT, SURFACE_CLOSE_EVENT, type SurfaceEventDetail } from '../src/ui';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

/** Zag machines open and close on their own tick; wait for it. */
const settled = () => new Promise<void>((r) => setTimeout(r, 50));

interface Heard {
    type: string;
    kind: string;
    target: HTMLElement;
    trigger: HTMLElement | null;
    /** Whether the surface was attached and visible when the event fired. */
    showing: boolean;
}

/** Shown = attached, and neither it nor an ancestor is `hidden` / `display: none`. */
function showing(el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (n.hidden || n.style.display === 'none') return false;
    }
    return true;
}

/** A themed host the surfaces portal into, recording what bubbles up to it. */
function hostWithEar(): { host: HTMLElement; heard: Heard[] } {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.append(host);
    const heard: Heard[] = [];
    const ear = (e: Event): void => {
        const { kind, trigger } = (e as CustomEvent<SurfaceEventDetail>).detail;
        const target = e.target as HTMLElement;
        heard.push({ type: e.type, kind, target, trigger, showing: showing(target) });
    };
    host.addEventListener(SURFACE_OPEN_EVENT, ear);
    host.addEventListener(SURFACE_CLOSE_EVENT, ear);
    return { host, heard };
}

function button(host: HTMLElement): HTMLButtonElement {
    const b = document.createElement('button');
    host.append(b);
    return b;
}

describe('surface open/close events', () => {
    it('names the event pair', () => {
        expect([SURFACE_OPEN_EVENT, SURFACE_CLOSE_EVENT]).toEqual(['vela:surface-open', 'vela:surface-close']);
    });

    it('menu: opens and closes on its list, with its trigger', async () => {
        const { host, heard } = hostWithEar();
        const trigger = button(host);
        const menu = new Menu({ host, trigger, items: [{ id: 'a', label: 'A' }] });
        menu.open();
        await settled();
        menu.close();
        await settled();
        expect(heard.map((h) => [h.type, h.kind, h.target.className, h.trigger === trigger, h.showing])).toEqual([
            ['vela:surface-open', 'menu', 'vela-menu', true, true],
            ['vela:surface-close', 'menu', 'vela-menu', true, true],
        ]);
        menu.destroy();
    });

    it('menu: a teardown while open still announces the close', async () => {
        const { host, heard } = hostWithEar();
        const menu = new Menu({ host, items: [{ id: 'a', label: 'A' }] });
        menu.openAt(10, 10);
        await settled();
        menu.destroy();
        expect(heard.map((h) => [h.type, h.trigger])).toEqual([
            ['vela:surface-open', null],
            ['vela:surface-close', null],
        ]);
    });

    it('popover: open once placed, close before it leaves the DOM', () => {
        const { host, heard } = hostWithEar();
        const trigger = button(host);
        const pop = new Popover({ trigger, host, content: document.createElement('div') });
        pop.show();
        pop.show(); // already open: re-places, announces nothing
        pop.hide();
        pop.hide();
        expect(heard.map((h) => [h.type, h.kind, h.target === pop.el, h.trigger === trigger, h.showing])).toEqual([
            ['vela:surface-open', 'popover', true, true, true],
            ['vela:surface-close', 'popover', true, true, true],
        ]);
        expect(pop.el.isConnected).toBe(false);
    });

    it('popover: a fading close announces as the fade starts', () => {
        const { host, heard } = hostWithEar();
        const pop = new Popover({ trigger: button(host), host, fadeMs: 120 });
        pop.show();
        pop.hide();
        expect(heard.map((h) => h.type)).toEqual(['vela:surface-open', 'vela:surface-close']);
        expect(pop.el.isConnected).toBe(true); // still fading out
    });

    /** Press outside every surface once the deferred outside-dismiss could have attached, and
     *  report whether a popover handler still claimed the press (and Escape) as its dismissal. */
    async function strayDismissHandlers(host: HTMLElement): Promise<{ outside: boolean; escape: boolean }> {
        await settled();
        const elsewhere = button(host);
        let outside = false;
        const read = (e: Event): void => {
            outside = eventDismissedPopover(e);
        };
        document.addEventListener('pointerdown', read);
        elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        document.removeEventListener('pointerdown', read);
        const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.dispatchEvent(esc);
        return { outside, escape: esc.defaultPrevented };
    }

    it('popover: a listener that hides it on open leaves no dismiss handlers behind', async () => {
        const { host } = hostWithEar();
        const pop = new Popover({ trigger: button(host), host });
        host.addEventListener(SURFACE_OPEN_EVENT, () => pop.hide(), { once: true });
        pop.show();
        expect(pop.open).toBe(false);
        expect(await strayDismissHandlers(host)).toEqual({ outside: false, escape: false });
    });

    it('popover: a show() then hide() in the same tick leaves no outside-dismiss behind', async () => {
        const { host } = hostWithEar();
        const pop = new Popover({ trigger: button(host), host });
        pop.show();
        pop.hide();
        expect(await strayDismissHandlers(host)).toEqual({ outside: false, escape: false });
    });

    it('popover: a reopen in the same tick keeps exactly the live outside-dismiss', async () => {
        const { host } = hostWithEar();
        const pop = new Popover({ trigger: button(host), host });
        pop.show();
        pop.hide();
        pop.show();
        await settled();
        button(host).dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(pop.open).toBe(false); // the second show's handler attached and dismissed it
        expect(await strayDismissHandlers(host)).toEqual({ outside: false, escape: false });
    });

    it('side panel: a listener that closes it on open leaves the host told it is closed', () => {
        const { host } = hostWithEar();
        const panel = new SidePanel(host, 'Objects', 'vela-test');
        const told: boolean[] = [];
        panel.onOpenChange = (open) => told.push(open);
        host.addEventListener(SURFACE_OPEN_EVENT, () => panel.toggle(false), { once: true });
        panel.toggle(true);
        expect(panel.open).toBe(false);
        expect(told).toEqual([true, false]);
    });

    it.each([
        ['menu', (host: HTMLElement, told: (open: boolean) => void) => new Menu({ host, items: [{ id: 'a', label: 'A' }], onOpenChange: told })],
        ['dialog', (host: HTMLElement, told: (open: boolean) => void) => new Dialog({ host, onOpenChange: told })],
        ['drawer', (host: HTMLElement, told: (open: boolean) => void) => new Drawer({ host, onOpenChange: told })],
    ] as const)('%s: a listener that closes it on open leaves the host told it is closed', async (_, make) => {
        const { host } = hostWithEar();
        const told: boolean[] = [];
        const view = make(host, (open) => told.push(open));
        const close = (): void => ('close' in view ? view.close() : view.hide());
        host.addEventListener(SURFACE_OPEN_EVENT, close, { once: true });
        if ('open' in view && typeof view.open === 'function') view.open();
        else (view as Dialog | Drawer).show();
        await settled();
        expect(told).toEqual([true, false]);
        view.destroy();
    });

    it('layout picker: a listener that closes it on open leaves the host told it is closed', () => {
        const { host } = hostWithEar();
        const told: boolean[] = [];
        const picker = new LayoutPicker({
            trigger: button(host),
            host,
            shape: () => ({ rows: 1, cols: 1 }),
            presets: () => [],
            onSelectGrid: () => {},
            onSelectPreset: () => {},
            syncs: () => [],
            onToggleSync: () => {},
            onOpenChange: (open) => told.push(open),
        });
        host.addEventListener(SURFACE_OPEN_EVENT, () => picker.close(), { once: true });
        picker.open();
        expect(told).toEqual([true, false]);
        picker.destroy();
    });

    it('popover and side panel: a listener that closes again on close does not re-enter', () => {
        const { host, heard } = hostWithEar();
        const pop = new Popover({ trigger: button(host), host });
        const panel = new SidePanel(host, 'Objects', 'vela-test');
        host.addEventListener(SURFACE_CLOSE_EVENT, () => {
            pop.hide();
            panel.toggle(false);
        });
        pop.show();
        pop.hide();
        panel.toggle(true);
        panel.toggle(false);
        expect(heard.map((h) => [h.type, h.kind])).toEqual([
            ['vela:surface-open', 'popover'],
            ['vela:surface-close', 'popover'],
            ['vela:surface-open', 'panel'],
            ['vela:surface-close', 'panel'],
        ]);
        expect(panel.open).toBe(false);
    });

    describe.each([
        ['dialog', (host: HTMLElement) => new Dialog({ host })],
        ['drawer', (host: HTMLElement) => new Drawer({ host })],
    ] as const)('%s', (kind, make) => {
        it('opens and closes on its panel, with the control that opened it', async () => {
            const { host, heard } = hostWithEar();
            const opener = button(host);
            opener.focus();
            const view = make(host);
            view.show();
            await settled();
            view.hide();
            await settled();
            expect(heard.map((h) => [h.type, h.kind, h.target.classList.contains(`vela-${kind}`), h.trigger === opener, h.showing])).toEqual([
                ['vela:surface-open', kind, true, true, true],
                ['vela:surface-close', kind, true, true, true],
            ]);
            view.destroy();
            expect(heard).toHaveLength(2);
        });

        it('a teardown while open announces the close once', async () => {
            const { host, heard } = hostWithEar();
            const view = make(host);
            view.show();
            await settled();
            view.destroy();
            await settled();
            expect(heard.map((h) => h.type)).toEqual(['vela:surface-open', 'vela:surface-close']);
            expect(heard[0]!.trigger).toBeNull(); // focus sat on <body>: no opener to name
        });
    });

    it('side panel: opens and closes on its element, and on teardown while open', () => {
        const { host, heard } = hostWithEar();
        const panel = new SidePanel(host, 'Objects', 'vela-test');
        panel.toggle(true);
        panel.toggle(true); // no change, no event
        panel.toggle(false);
        panel.toggle(true);
        panel.destroy();
        expect(heard.map((h) => [h.type, h.kind, h.target === panel.el, h.showing])).toEqual([
            ['vela:surface-open', 'panel', true, true],
            ['vela:surface-close', 'panel', true, true],
            ['vela:surface-open', 'panel', true, true],
            ['vela:surface-close', 'panel', true, true],
        ]);
    });

    it('layout picker: opens and closes on its card, with its trigger', () => {
        const { host, heard } = hostWithEar();
        const trigger = button(host);
        const picker = new LayoutPicker({
            trigger,
            host,
            shape: () => ({ rows: 1, cols: 1 }),
            presets: () => [],
            onSelectGrid: () => {},
            onSelectPreset: () => {},
            syncs: () => [],
            onToggleSync: () => {},
        });
        picker.open();
        picker.close();
        expect(heard.map((h) => [h.type, h.kind, h.target.className, h.trigger === trigger, h.showing])).toEqual([
            ['vela:surface-open', 'popover', 'vela-lp', true, true],
            ['vela:surface-close', 'popover', 'vela-lp', true, true],
        ]);
        picker.destroy();
        expect(heard).toHaveLength(2);
    });
});
