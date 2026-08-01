// The side-panel column: the width policy (pure), the contribution registry, the dock's
// single-open rule + persistable state, and the resize gesture. The suite runs in the node
// env like the rest, so the DOM is a MINIMAL stub — enough for the panel/dock logic (element
// tree, listeners, dataset, inline style); real painting is proven in the browser.
import { describe, it, expect, vi } from 'vitest';
import { SidePanel, clampPanelWidth, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_MAX_WIDTH } from '../src/widget/side-panel';
import { PanelDock } from '../src/widget/panel-dock';
import { registerSidePanel, sidePanels, unregisterSidePanel, type SidePanelButton, type WidgetContext } from '../src/widget/contributions';
import { sanitizeState } from '../src/state/document';

interface StubEl {
    tagName: string;
    className: string;
    hidden: boolean;
    dataset: Record<string, string>;
    children: StubEl[];
    style: { setProperty(name: string, value: string): void; props: Record<string, string> };
    ownerDocument: unknown;
    listeners: Map<string, Array<(e: unknown) => void>>;
    append(...nodes: StubEl[]): void;
    appendChild(node: StubEl): StubEl;
    setAttribute(name: string, value: string): void;
    addEventListener(type: string, fn: (e: unknown) => void): void;
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
    remove(): void;
    fire(type: string, event?: Record<string, unknown>): void;
    innerHTML: string;
    textContent: string;
    title: string;
}

function stubDoc(): { doc: unknown; root: StubEl } {
    const doc = {
        createElement(tagName: string): StubEl {
            const props: Record<string, string> = {};
            const el: StubEl = {
                tagName,
                className: '',
                hidden: false,
                dataset: {},
                children: [],
                innerHTML: '',
                textContent: '',
                title: '',
                style: { props, setProperty: (n, v) => void (props[n] = v) },
                ownerDocument: doc,
                listeners: new Map(),
                append: (...nodes) => void el.children.push(...nodes),
                appendChild: (node) => (el.children.push(node), node),
                setAttribute: () => {},
                addEventListener: (type, fn) => void el.listeners.set(type, [...(el.listeners.get(type) ?? []), fn]),
                setPointerCapture: () => {},
                releasePointerCapture: () => {},
                remove: () => {},
                fire: (type, event = {}) => {
                    for (const fn of el.listeners.get(type) ?? []) fn({ button: 0, pointerId: 1, preventDefault: () => {}, ...event });
                },
            };
            return el;
        },
    };
    return { doc, root: doc.createElement('div') };
}

/** The panel's element tree, by class — the stub keeps no query API. */
function find(el: StubEl, className: string): StubEl | undefined {
    if (el.className.includes(className)) return el;
    for (const child of el.children) {
        const hit = find(child, className);
        if (hit) return hit;
    }
    return undefined;
}

const ctx = {} as WidgetContext;

describe('clampPanelWidth', () => {
    it('clamps to the bounds and rounds to whole pixels', () => {
        expect(clampPanelWidth(320.4, 200, 640)).toBe(320);
        expect(clampPanelWidth(50, 200, 640)).toBe(200);
        expect(clampPanelWidth(5000, 200, 640)).toBe(640);
    });

    it('falls back to the defaults on unusable input', () => {
        expect(clampPanelWidth(Number.NaN)).toBe(DEFAULT_PANEL_MIN_WIDTH);
        expect(clampPanelWidth(10_000)).toBe(DEFAULT_PANEL_MAX_WIDTH);
        // A max below the min would otherwise produce an empty range.
        expect(clampPanelWidth(400, 300, 100)).toBe(300);
    });
});

describe('SidePanel width', () => {
    it('a fixed panel keeps its declared width and takes any programmatic size', () => {
        const { doc, root } = stubDoc();
        const panel = new SidePanel(root as never, 'Fixed', 'x-fixed');
        expect(panel.width).toBe(280);
        expect(find(panel.el as never, 'vela-panel-resizer')).toBeUndefined();
        panel.setWidth(900); // no resize bounds on a fixed panel
        expect(panel.width).toBe(900);
        expect((panel.el as unknown as StubEl).style.props['--vela-panel-w']).toBe('900px');
        expect(doc).toBeTruthy();
    });

    it('a resizable panel drags from its inner edge, clamped, and reports the settled width once', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sized', 'x-sized', { width: 300, resizable: true, minWidth: 240, maxWidth: 500 });
        const seen: number[] = [];
        panel.onWidthChange = (px) => seen.push(px);
        const handle = find(panel.el as never, 'vela-panel-resizer');
        expect(handle).toBeDefined();

        handle!.fire('pointerdown', { clientX: 1000 });
        handle!.fire('pointermove', { clientX: 940 }); // dragging AWAY from the right edge widens
        expect(panel.width).toBe(360);
        handle!.fire('pointermove', { clientX: 200 }); // past the max
        expect(panel.width).toBe(500);
        handle!.fire('pointerup', { clientX: 200 });
        expect(seen).toEqual([500]); // the settled width only, never the intermediate frames

        handle!.fire('dblclick');
        expect(panel.width).toBe(300); // back to the declared width
        expect(seen).toEqual([500, 300]);
    });

    it('setWidth is silent — restoring a persisted width is not a user change', () => {
        const { root } = stubDoc();
        const panel = new SidePanel(root as never, 'Sized', 'x-sized', { resizable: true });
        const onWidthChange = vi.fn();
        panel.onWidthChange = onWidthChange;
        panel.setWidth(420);
        expect(panel.width).toBe(420);
        expect(onWidthChange).not.toHaveBeenCalled();
    });
});

describe('registerSidePanel', () => {
    it('sorts by order, replaces by id, and unregisters through the disposer', () => {
        const mount = (): void => {};
        const offB = registerSidePanel({ id: 'b', title: 'B', icon: 'i', order: 5, mount });
        const offA = registerSidePanel({ id: 'a', title: 'A', icon: 'i', order: 1, mount });
        const offC = registerSidePanel({ id: 'c', title: 'C', icon: 'i', mount }); // default order, last
        expect(sidePanels().map((p) => p.id)).toEqual(['a', 'b', 'c']);

        registerSidePanel({ id: 'a', title: 'A2', icon: 'i', order: 9, mount });
        expect(sidePanels().map((p) => p.id)).toEqual(['b', 'a', 'c']);
        expect(sidePanels().find((p) => p.id === 'a')?.title).toBe('A2');

        offA(); // a stale disposer must not drop the descriptor that replaced it
        expect(sidePanels().map((p) => p.id)).toEqual(['b', 'a', 'c']);
        unregisterSidePanel('a');
        offB();
        offC();
        expect(sidePanels()).toEqual([]);
    });
});

describe('PanelDock', () => {
    function dock(): {
        dock: PanelDock;
        panels: Record<'a' | 'b', SidePanel>;
        buttons: () => SidePanelButton[];
        active: Map<string, boolean>;
        changed: () => number;
    } {
        const { root } = stubDoc();
        let buttons: SidePanelButton[] = [];
        const active = new Map<string, boolean>();
        let changes = 0;
        const d = new PanelDock(root as never, {
            chrome: {
                setPanelButtons: (list) => void (buttons = [...list]),
                setPanelActive: (id, open) => void active.set(id, open),
            },
            context: () => ctx,
            changed: () => void (changes += 1),
        });
        const a = new SidePanel(root as never, 'A', 'x-a');
        const b = new SidePanel(root as never, 'B', 'x-b', { resizable: true });
        d.addBuiltIn({ id: 'a', title: 'A', icon: 'ia', order: 10, panel: a });
        d.addBuiltIn({ id: 'b', title: 'B', icon: 'ib', order: 20, panel: b });
        return { dock: d, panels: { a, b }, buttons: () => buttons, active, changed: () => changes };
    }

    it('projects one button per panel, in dock order', () => {
        const { buttons } = dock();
        expect(buttons()).toEqual([
            { id: 'a', title: 'A', icon: 'ia' },
            { id: 'b', title: 'B', icon: 'ib' },
        ]);
    });

    it('is exclusive: opening one closes the other, and both pressed states are pushed', () => {
        const { dock: d, panels, active } = dock();
        d.toggle('a');
        expect(panels.a.open).toBe(true);
        expect(active.get('a')).toBe(true);
        d.toggle('b');
        expect(panels.b.open).toBe(true);
        expect(panels.a.open).toBe(false);
        expect(active.get('a')).toBe(false);
        expect(d.openId).toBe('b');
        d.toggle('b', false);
        expect(d.openId).toBeNull();
    });

    it('unknown ids are ignored', () => {
        const { dock: d } = dock();
        expect(() => d.toggle('nope')).not.toThrow();
        expect(d.openId).toBeNull();
    });

    it('persists the open panel and the widths the user dragged — nothing else', () => {
        const { dock: d, panels, changed } = dock();
        expect(d.getState()).toBeNull(); // closed, untouched widths: nothing to save
        d.toggle('a');
        expect(d.getState()).toEqual({ open: 'a' });
        panels.b.setWidth(360); // programmatic: not a user width
        expect(d.getState()).toEqual({ open: 'a' });
        panels.b.onWidthChange?.(360); // what the drag reports
        expect(d.getState()).toEqual({ open: 'a', widths: { b: 360 } });
        expect(changed()).toBeGreaterThan(0);
    });

    it('restores a document: widths apply, the named panel opens, the others close', () => {
        const { dock: d, panels } = dock();
        d.toggle('a');
        d.applyState({ open: 'b', widths: { b: 400 } });
        expect(panels.a.open).toBe(false);
        expect(panels.b.open).toBe(true);
        expect(panels.b.width).toBe(400);
        d.applyState(undefined); // a document with no panels field leaves the dock alone
        expect(panels.b.open).toBe(true);
    });

    it('a restored panel that registers later opens (and its width applies) when it docks', () => {
        const { dock: d, panels } = dock();
        d.applyState({ open: 'late', widths: { late: 420 } });
        expect(d.openId).toBeNull(); // nothing to open yet
        const off = registerSidePanel({ id: 'late', title: 'Late', icon: 'il', resizable: true, mount: () => {} });
        d.refresh();
        expect(d.openId).toBe('late');
        expect(d.getState()).toEqual({ open: 'late', widths: { late: 420 } });
        off();
        d.refresh();

        // …but a column the user picked in the meantime keeps the dock.
        const off2 = registerSidePanel({ id: 'late2', title: 'Late 2', icon: 'il', mount: () => {} });
        d.applyState({ open: 'late2' });
        d.toggle('a');
        d.refresh();
        expect(d.openId).toBe('a');
        expect(panels.a.open).toBe(true);
        off2();
        d.refresh();
    });

    it('mounts contributed panels with their body, rebinds them, and keeps them open across a refresh', () => {
        const { dock: d, buttons } = dock();
        const onChart = vi.fn();
        const mount = vi.fn((_ctx: WidgetContext, body: HTMLElement) => {
            body.appendChild(body.ownerDocument.createElement('div'));
            return { onChart };
        });
        const off = registerSidePanel({ id: 'x', title: 'X', icon: 'ix', width: 320, resizable: true, mount });
        d.refresh();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b', 'x']); // default order lands last
        expect(mount).toHaveBeenCalledTimes(1);

        const chart = {} as never;
        d.onChart(chart);
        expect(onChart).toHaveBeenCalledWith(chart);

        d.toggle('x');
        d.refresh(); // a late registration elsewhere must not close the open panel
        expect(d.openId).toBe('x');
        expect(mount).toHaveBeenCalledTimes(2); // rebuilt from the descriptor

        off();
        d.refresh();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b']);
        expect(d.openId).toBeNull();
    });

    it('hands mount the header surface: a slot next to the title, and setTitle', () => {
        const { root } = stubDoc();
        const d = new PanelDock(root as never, { chrome: { setPanelButtons: () => {}, setPanelActive: () => {} }, context: () => ctx });
        let slotChildren = -1;
        const off = registerSidePanel({
            id: 'h',
            title: 'Declared',
            icon: 'ih',
            mount: (_ctx, _body, header) => {
                header.slot.appendChild((header.slot.ownerDocument as Document).createElement('button'));
                header.setTitle('My script');
                slotChildren = (header.slot as unknown as StubEl).children.length;
            },
        });
        d.refresh();
        const panel = find(root, 'vela-panel-h')!;
        expect(find(panel, 'vela-panel-title')!.textContent).toBe('My script'); // setTitle replaced the declared title
        expect(slotChildren).toBe(1); // the control landed in the slot
        // The slot sits between the title and the close button in the header row.
        const header = find(panel, 'vela-panel-header')!;
        expect(header.children.map((c) => c.className)).toEqual(['vela-panel-title', 'vela-panel-header-slot', 'vela-panel-close']);
        off();
        d.refresh();
    });

    it('a contribution that throws on mount is contained', () => {
        const { dock: d, buttons } = dock();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const off = registerSidePanel({
            id: 'boom',
            title: 'Boom',
            icon: 'ib',
            mount: () => {
                throw new Error('nope');
            },
        });
        expect(() => d.refresh()).not.toThrow();
        expect(buttons().map((b) => b.id)).toEqual(['a', 'b', 'boom']); // docked, just empty
        expect(warn).toHaveBeenCalled();
        off();
        d.refresh();
        warn.mockRestore();
    });
});

describe('sanitizeState — panels', () => {
    const base = { version: 1, layout: '1', charts: [] };

    it('keeps a usable dock state', () => {
        const st = sanitizeState({ ...base, panels: { open: 'objects', widths: { objects: 320 } } });
        expect(st?.panels).toEqual({ open: 'objects', widths: { objects: 320 } });
    });

    it('drops malformed fields rather than throwing', () => {
        expect(sanitizeState({ ...base, panels: { open: 42, widths: { a: 'wide', b: -5, c: 0, d: 260 } } })?.panels).toEqual({ widths: { d: 260 } });
        expect(sanitizeState({ ...base, panels: 'nope' })?.panels).toBeUndefined();
        expect(sanitizeState({ ...base, panels: { open: '', widths: {} } })?.panels).toBeUndefined();
    });

    it('a document written before the dock has no panels field', () => {
        expect(sanitizeState(base)?.panels).toBeUndefined();
    });
});
