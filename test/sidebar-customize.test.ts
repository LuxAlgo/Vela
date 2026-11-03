// @vitest-environment jsdom
// The sidebar's right-click menu: the user hides and gives back its entries, and the choice
// is saved with the layout. A host can turn the menu off with `customizable: false`. The kit
// Menu is replaced by a recorder (Zag's pointer handling is proven in the browser).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MenuItemDescriptor } from '@luxalgo/vela-ui/menu';

const menus = vi.hoisted(() => [] as Array<{ items: readonly MenuItemDescriptor[]; select: (id: string) => void; opened: number }>);

vi.mock('@luxalgo/vela-ui/menu', () => ({
    Menu: class {
        constructor(opts: { items?: readonly MenuItemDescriptor[]; onSelect?: (id: string) => void }) {
            const rec = { items: opts.items ?? [], select: (id: string) => opts.onSelect?.(id), opened: 0 };
            menus.push(rec);
            // Every other menu the shell builds only needs its calls to land somewhere.
            return new Proxy(this, {
                get: (target, key) => {
                    if (key === 'setItems') return (items: readonly MenuItemDescriptor[]) => void (rec.items = items);
                    if (key === 'openAt' || key === 'open') return () => void (rec.opened += 1);
                    return key in target ? (target as Record<PropertyKey, unknown>)[key] : () => undefined;
                },
            });
        }
    },
}));

// This jsdom build ships no `CSS` global, no ResizeObserver and no Web Animations; the
// chrome uses them decoratively.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const settle = () => new Promise((r) => setTimeout(r, 0));

function mount(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', sidebar: true, ...opts } as never);
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

const entries = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.vela-sidebar-btn')].map((b) => b.dataset.id!);
/** The sidebar's menu: the one the right-click opened (the shell builds other menus). */
let sidebarMenu: (typeof menus)[number] | null = null;
const rightClick = (root: HTMLElement): MouseEvent => {
    const before = menus.length;
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    root.querySelector('.vela-sidebar')!.dispatchEvent(e);
    sidebarMenu = menus.slice(before).find((m) => m.opened > 0) ?? null;
    return e;
};
const menuItems = (): MenuItemDescriptor[] => [...(sidebarMenu?.items ?? [])];
const pick = async (label: string): Promise<void> => {
    const item = menuItems().find((i) => i.label === label);
    if (!item) throw new Error(`no menu item "${label}": ${menuItems().map((i) => i.label).join(', ')}`);
    sidebarMenu!.select(item.id);
    await settle();
};

describe("the sidebar's right-click menu", () => {
    it('lists every entry, ticked while it shows, and hides the one the user unticks', async () => {
        const { ws, root } = mount();
        await settle();
        expect(entries(root)).toEqual(expect.arrayContaining(['objects', 'dataWindow']));
        expect(rightClick(root).defaultPrevented).toBe(true);
        expect(menuItems().map((i) => [i.label, i.checked])).toEqual(expect.arrayContaining([['Object tree', true], ['Data window', true]]));
        await pick('Object tree');
        expect(entries(root)).not.toContain('objects');
        expect(ws.getState().sidebarHidden).toEqual(['objects']);
        ws.destroy();
    });

    it('gives everything back with Show all', async () => {
        const { ws, root } = mount();
        await settle();
        rightClick(root);
        await pick('Data window');
        rightClick(root);
        await pick('Show all');
        expect(entries(root)).toEqual(expect.arrayContaining(['objects', 'dataWindow']));
        expect(ws.getState().sidebarHidden).toBeUndefined();
        ws.destroy();
    });

    it("restores the user's choice from a saved layout", async () => {
        const first = mount();
        await settle();
        rightClick(first.root);
        await pick('Object tree');
        const saved = first.ws.getState();
        first.ws.destroy();
        const second = mount();
        second.ws.applyState(saved);
        await settle();
        expect(entries(second.root)).not.toContain('objects');
        expect(entries(second.root)).toContain('dataWindow');
        second.ws.destroy();
    });

    it('stays out of the way when the host turns it off', async () => {
        const { ws, root } = mount({ sidebar: { customizable: false } });
        await settle();
        expect(rightClick(root).defaultPrevented).toBe(false);
        expect(menuItems()).toHaveLength(0);
        ws.destroy();
    });
});
