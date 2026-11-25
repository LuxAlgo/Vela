// @vitest-environment jsdom
// A closing surface carries `data-closing` and stays on screen, inert, until the CSS animations
// that attribute started have finished (capped), so a host animates closes in CSS alone. With
// no exit animation the close completes synchronously, exactly as before. jsdom has no Web
// Animations API: `getAnimations` is mocked to report what a stylesheet would have started.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { holdForExit, SURFACE_EXIT_CAP_MS } from '../src/ui/surface-exit';
import { Popover } from '../src/ui/components/popover/view';
import { Menu } from '../src/ui/components/menu/view';
import { Dialog } from '../src/ui/components/dialog/view';
import { SidePanel } from '../src/widget/side-panel';
import { PanelDock } from '../src/widget/panel-dock';
import type { WidgetContext } from '../src/widget/contributions';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

interface FakeAnimation {
    anim: Animation;
    resolve(): void;
    reject(): void;
}

function fakeAnimation(endTime = 300): FakeAnimation {
    let resolve!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((res, rej) => {
        resolve = () => res();
        reject = () => rej(new DOMException('cancelled', 'AbortError'));
    });
    finished.catch(() => {});
    const anim = { effect: { getComputedTiming: () => ({ endTime }) }, finished } as unknown as Animation;
    return { anim, resolve, reject };
}

type GetAnimations = (this: Element, opts?: GetAnimationsOptions) => Animation[];

/** Make `el` report `always` at every read, plus `onClosing` once it carries `data-closing`. */
function animates(el: HTMLElement, onClosing: Animation[], always: Animation[] = []): void {
    el.getAnimations = (() => [...always, ...(el.hasAttribute('data-closing') ? onClosing : [])]) as GetAnimations;
}

/** Let promise reactions run. */
const ticks = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

function surface(): HTMLElement {
    const el = document.createElement('div');
    document.body.append(el);
    return el;
}

afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
});

describe('holdForExit', () => {
    it('completes synchronously when the attribute starts no animation', () => {
        const el = surface();
        animates(el, []);
        const done = vi.fn();
        expect(holdForExit(el, done)).toBeNull();
        expect(done).toHaveBeenCalledTimes(1);
        expect(el.hasAttribute('data-closing')).toBe(false);
        expect(el.inert).toBeFalsy();
    });

    it('completes synchronously when the DOM cannot report animations', () => {
        const el = surface();
        const done = vi.fn();
        expect(holdForExit(el, done)).toBeNull();
        expect(done).toHaveBeenCalledTimes(1);
        expect(el.hasAttribute('data-closing')).toBe(false);
    });

    it('holds the surface, marked and inert, until the exit animation finishes', async () => {
        const el = surface();
        const exit = fakeAnimation();
        animates(el, [exit.anim]);
        const done = vi.fn();
        expect(holdForExit(el, done)).not.toBeNull();
        expect(done).not.toHaveBeenCalled();
        expect(el.hasAttribute('data-closing')).toBe(true);
        expect(el.inert).toBe(true);
        exit.resolve();
        await ticks();
        expect(done).toHaveBeenCalledTimes(1);
        expect(el.hasAttribute('data-closing')).toBe(false);
        expect(el.inert).toBeFalsy();
    });

    it('waits for every animation the attribute started, on any of the held elements', async () => {
        const panel = surface();
        const scrim = surface();
        const a = fakeAnimation();
        const b = fakeAnimation();
        animates(panel, [a.anim]);
        animates(scrim, [b.anim]);
        const done = vi.fn();
        holdForExit([panel, scrim], done);
        expect(scrim.hasAttribute('data-closing')).toBe(true);
        a.resolve();
        await ticks();
        expect(done).not.toHaveBeenCalled();
        b.resolve();
        await ticks();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('ignores animations already running and infinite ones', () => {
        const el = surface();
        const running = fakeAnimation();
        const spinner = fakeAnimation(Number.POSITIVE_INFINITY);
        animates(el, [spinner.anim], [running.anim]);
        const done = vi.fn();
        expect(holdForExit(el, done)).toBeNull();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('treats a cancelled animation as finished', async () => {
        const el = surface();
        const exit = fakeAnimation();
        animates(el, [exit.anim]);
        const done = vi.fn();
        holdForExit(el, done);
        exit.reject();
        await ticks();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('completes after the cap when the animation never finishes', () => {
        vi.useFakeTimers();
        const el = surface();
        animates(el, [fakeAnimation(60_000).anim]);
        const done = vi.fn();
        holdForExit(el, done);
        vi.advanceTimersByTime(SURFACE_EXIT_CAP_MS - 1);
        expect(done).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(done).toHaveBeenCalledTimes(1);
        expect(el.hasAttribute('data-closing')).toBe(false);
    });

    it('cancel unmarks and restores the surface without completing the close', async () => {
        vi.useFakeTimers();
        const el = surface();
        const exit = fakeAnimation();
        animates(el, [exit.anim]);
        const done = vi.fn();
        holdForExit(el, done)!.cancel();
        expect(el.hasAttribute('data-closing')).toBe(false);
        expect(el.inert).toBeFalsy();
        exit.resolve();
        await ticks();
        vi.advanceTimersByTime(SURFACE_EXIT_CAP_MS);
        expect(done).not.toHaveBeenCalled();
    });

    it('finish completes at once, and only once', async () => {
        const el = surface();
        const exit = fakeAnimation();
        animates(el, [exit.anim]);
        const done = vi.fn();
        const handle = holdForExit(el, done)!;
        handle.finish();
        expect(done).toHaveBeenCalledTimes(1);
        handle.finish();
        handle.cancel();
        exit.resolve();
        await ticks();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('restores the previous inert state and keeps extra elements inert, unmarked', async () => {
        const el = surface();
        const positioner = surface();
        const exit = fakeAnimation();
        animates(el, [exit.anim]);
        el.inert = false;
        holdForExit(el, () => {}, { inert: [positioner] });
        expect(positioner.inert).toBe(true);
        expect(positioner.hasAttribute('data-closing')).toBe(false);
        exit.resolve();
        await ticks();
        expect(positioner.inert).toBeFalsy();
        expect(el.inert).toBe(false);
    });

    it('reads the animations before the surface turns inert', () => {
        const el = surface();
        const inertAtRead: unknown[] = [];
        const exit = fakeAnimation();
        el.getAnimations = (() => {
            inertAtRead.push(el.inert);
            return el.hasAttribute('data-closing') ? [exit.anim] : [];
        }) as GetAnimations;
        holdForExit(el, () => {});
        expect(inertAtRead).toHaveLength(2);
        expect(inertAtRead.every((v) => v !== true)).toBe(true);
        expect(el.inert).toBe(true);
    });
});

/** Every element reports `exit` once it carries `data-closing` — a host exit stylesheet. */
describe('surfaces with exit CSS', () => {
    let exit: FakeAnimation;
    beforeEach(() => {
        exit = fakeAnimation();
        const anim = exit.anim;
        (Element.prototype as unknown as { getAnimations: GetAnimations }).getAnimations = function (this: Element) {
            return this.hasAttribute('data-closing') ? [anim] : [];
        };
    });
    afterEach(() => {
        delete (Element.prototype as unknown as { getAnimations?: GetAnimations }).getAnimations;
    });

    const settled = () => new Promise<void>((r) => setTimeout(r, 50));

    function host(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'vela-ui';
        document.body.append(el);
        return el;
    }

    function button(parent: HTMLElement): HTMLButtonElement {
        const b = document.createElement('button');
        parent.append(b);
        return b;
    }

    it('side panel: reports closed at once, stays on screen until its exit ends', async () => {
        const panel = new SidePanel(host(), 'Objects', 'vela-test');
        const told: boolean[] = [];
        panel.onOpenChange = (open) => told.push(open);
        panel.toggle(true);
        panel.toggle(false);
        expect(panel.open).toBe(false);
        expect(told).toEqual([true, false]);
        expect(panel.el.hidden).toBe(false);
        expect(panel.el.hasAttribute('data-closing')).toBe(true);
        expect(panel.el.inert).toBe(true);
        exit.resolve();
        await ticks();
        expect(panel.el.hidden).toBe(true);
        expect(panel.el.hasAttribute('data-closing')).toBe(false);
    });

    it('side panel: a reopen during the exit cancels it', async () => {
        const panel = new SidePanel(host(), 'Objects', 'vela-test');
        panel.toggle(true);
        panel.toggle(false);
        panel.toggle(); // a bare toggle reads the logical state: it reopens
        expect(panel.open).toBe(true);
        expect(panel.el.hasAttribute('data-closing')).toBe(false);
        expect(panel.el.inert).toBeFalsy();
        exit.resolve();
        await ticks();
        expect(panel.el.hidden).toBe(false);
    });

    it('side panel: an instant close skips the exit, and cuts short one already running', () => {
        const a = new SidePanel(host(), 'A', 'vela-a');
        a.toggle(true);
        a.toggle(false, true);
        expect(a.el.hidden).toBe(true);
        expect(a.el.hasAttribute('data-closing')).toBe(false);
        a.toggle(true);
        a.toggle(false);
        expect(a.el.hidden).toBe(false);
        a.toggle(false, true);
        expect(a.el.hidden).toBe(true);
        expect(a.el.hasAttribute('data-closing')).toBe(false);
    });

    it('panel dock: the panel handing the dock to another leaves at once', () => {
        const dock = new PanelDock(host(), {
            chrome: { setPanelButtons: () => {}, setPanelActive: () => {} },
            context: () => ({}) as WidgetContext,
        });
        const a = new SidePanel(host(), 'A', 'vela-a');
        const b = new SidePanel(host(), 'B', 'vela-b');
        dock.addBuiltIn({ id: 'a', title: 'A', icon: 'list', order: 1, panel: a });
        dock.addBuiltIn({ id: 'b', title: 'B', icon: 'list', order: 2, panel: b });
        dock.toggle('a', true);
        dock.toggle('b', true);
        expect(a.open).toBe(false);
        expect(a.el.hidden).toBe(true);
        expect(a.el.hasAttribute('data-closing')).toBe(false);
        expect(b.el.hidden).toBe(false);
    });

    it('popover: leaves the DOM once its exit ends; a show() during it keeps the one shell', async () => {
        const h = host();
        const trigger = button(h);
        const pop = new Popover({ trigger, host: h, content: document.createElement('div') });
        pop.show();
        pop.hide();
        expect(pop.el.isConnected).toBe(true);
        expect(pop.el.hasAttribute('data-closing')).toBe(true);
        pop.show();
        expect(pop.el.hasAttribute('data-closing')).toBe(false);
        expect(h.querySelectorAll('.vela-popover')).toHaveLength(1);
        exit.resolve();
        await ticks();
        expect(pop.el.isConnected).toBe(true);
        expect(pop.open).toBe(true);
        pop.hide();
        pop.destroy(); // a teardown mid-exit finishes it at once
        expect(pop.el.isConnected).toBe(false);
    });

    it('popover: a fresh popover from the same trigger replaces the one leaving', () => {
        const h = host();
        const trigger = button(h);
        const first = new Popover({ trigger, host: h });
        first.show();
        first.hide();
        expect(first.el.isConnected).toBe(true);
        const second = new Popover({ trigger, host: h });
        second.show();
        expect(first.el.isConnected).toBe(false);
        expect(second.el.isConnected).toBe(true);
    });

    it('menu: the closed list stays shown until its exit ends', async () => {
        const h = host();
        const menu = new Menu({ host: h, trigger: button(h), items: [{ id: 'a', label: 'A' }] });
        menu.open();
        await settled();
        const list = h.querySelector<HTMLElement>('.vela-menu')!;
        menu.close();
        await settled();
        expect(list.hidden).toBe(false);
        expect(list.dataset.state).toBe('closed');
        expect(list.hasAttribute('data-closing')).toBe(true);
        exit.resolve();
        await ticks();
        expect(list.hidden).toBe(true);
        expect(list.hasAttribute('data-closing')).toBe(false);
        menu.destroy();
    });

    it('dialog: an owner that destroys it as it reports closing still lets it animate out', async () => {
        const h = host();
        const dialog: Dialog = new Dialog({ host: h, onOpenChange: (open) => { if (!open) dialog.destroy(); } });
        dialog.show();
        await settled();
        dialog.hide();
        await settled();
        expect(dialog.panel.isConnected).toBe(true);
        expect(dialog.panel.hasAttribute('data-closing')).toBe(true);
        expect(dialog.backdrop.hasAttribute('data-closing')).toBe(true);
        expect(dialog.positioner.inert).toBe(true);
        exit.resolve();
        await ticks();
        expect(dialog.panel.isConnected).toBe(false);
        expect(dialog.backdrop.isConnected).toBe(false);
    });

    it('dialog: a teardown while open leaves at once', async () => {
        const dialog = new Dialog({ host: host() });
        dialog.show();
        await settled();
        dialog.destroy();
        expect(dialog.panel.isConnected).toBe(false);
        expect(dialog.backdrop.isConnected).toBe(false);
    });
});
