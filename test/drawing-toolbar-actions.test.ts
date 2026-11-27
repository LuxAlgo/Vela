// @vitest-environment jsdom
// A host's toolbar group kept on the bar before its first tool (`showEmpty`), and the
// actions a shell lists in a group's menu (`registerWidgetAction`, target `'drawings'`).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { registerWidgetAction, toolbarWithActions, type WidgetContext } from '../src/widget/contributions';
import { DrawingsDrawer } from '../src/widget/drawings-drawer';
import { buildToolbar, registerDrawingGroup, unregisterDrawingGroup } from '../src/core/drawings';
import { defineDrawing } from '../src/core/drawings/types/ShapeDrawing';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    for (const off of disposers.splice(0)) off();
    document.body.replaceChildren();
});

const ICON = '<svg viewBox="0 0 24 24"><path d="M4 20 20 4"/></svg>';

function group(meta: { id?: string; showEmpty?: boolean; icon?: string } = {}): string {
    const id = meta.id ?? 'acme';
    registerDrawingGroup({ id, label: 'Acme tools', ...meta });
    disposers.push(() => unregisterDrawingGroup(id));
    return id;
}

function tool(type: string, groupId: string): void {
    disposers.push(defineDrawing({ type, label: `Tool ${type}`, group: groupId, icon: ICON, shapes: () => [] }));
}

function mountWorkspace(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', layoutMode: 'desktop', ...opts } as never);
    disposers.push(() => ws.destroy());
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

/** The bar's group cells, by the name their icon button carries. */
const cells = (root: HTMLElement): string[] => [...root.querySelectorAll('.vela-dtb .vela-dtb-cell > .vela-dtb-icon')].map((b) => b.getAttribute('aria-label')!);
const cellIcon = (root: HTMLElement, label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.vela-dtb-cell > .vela-dtb-icon[aria-label="${label}"]`)!;
const cellArrow = (root: HTMLElement, label: string): HTMLButtonElement | null => cellIcon(root, label).parentElement!.querySelector<HTMLButtonElement>('.vela-dtb-arrow');
const menuRows = (): string[] => [...document.querySelectorAll('.vela-dtb-flyout .vela-dtb-item')].map((b) => b.getAttribute('aria-label')!);
const menuRow = (label: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`.vela-dtb-flyout .vela-dtb-item[aria-label="${label}"]`)!;

describe('a toolbar group kept on the bar empty', () => {
    it('is left out of the toolbar until a tool names it, unless registered with showEmpty', () => {
        const id = group();
        expect(buildToolbar(undefined).definition.groups.some((g) => g.id === id)).toBe(false);

        registerDrawingGroup({ id, label: 'Acme tools', icon: ICON, showEmpty: true });
        const listed = buildToolbar(undefined).definition.groups.find((g) => g.id === id)!;
        expect(listed).toMatchObject({ label: 'Acme tools', tools: [], icon: ICON });
        // A toolbar restricted to a tool list keeps it too; explicit groups list it themselves.
        expect(buildToolbar({ tools: ['trendline'] }).definition.groups.some((g) => g.id === id)).toBe(true);
        expect(buildToolbar({ groups: [{ id: 'mine', label: 'Mine', tools: ['trendline'] }] }).definition.groups.map((g) => g.id)).toEqual(['mine']);
        expect(buildToolbar({ groups: [{ id, label: 'Renamed', tools: [] }] }).definition.groups).toMatchObject([{ id, label: 'Renamed', tools: [] }]);
    });

    it('keeps its place when its first tool arrives', () => {
        const first = group({ id: 'acme', showEmpty: true });
        const second = group({ id: 'zeta', showEmpty: true });
        const order = (): string[] => buildToolbar(undefined).definition.groups.map((g) => g.id).filter((g) => g === first || g === second);
        expect(order()).toEqual(['acme', 'zeta']);
        tool('test.zeta', second); // the later group gets a tool first
        expect(order()).toEqual(['acme', 'zeta']);
    });

    it('never takes the place of a built-in group', () => {
        group({ id: 'text', showEmpty: true });
        const ids = buildToolbar(undefined).definition.groups.map((g) => g.id);
        expect(ids.filter((g) => g === 'text')).toHaveLength(1);
        expect(buildToolbar(undefined).definition.groups.find((g) => g.id === 'text')!.tools.length).toBeGreaterThan(0);
    });
});

describe('actions in a toolbar group menu', () => {
    it('shows an empty group once an action gives its menu a row, and runs the action from it', () => {
        const id = group({ showEmpty: true, icon: ICON });
        const { ws, root } = mountWorkspace();
        // Nothing to arm and nothing to list: no dead button.
        expect(cells(root)).not.toContain('Acme tools');

        const runs: WidgetContext[] = [];
        disposers.push(registerWidgetAction({ id: 'acme.create', target: 'drawings', group: id, label: 'Create custom', icon: 'plus', run: (ctx) => runs.push(ctx) }));
        ws.refreshActions();
        expect(cells(root)).toContain('Acme tools');
        const icon = cellIcon(root, 'Acme tools');
        expect(icon.innerHTML).toContain('M4 20 20 4'); // the group's own icon
        expect(cellArrow(root, 'Acme tools')).toBeNull(); // the icon opens the menu itself

        expect(icon.parentElement!.dataset.group).toBe(id);

        icon.click();
        expect(menuRows()).toEqual(['Create custom']);
        expect(menuRow('Create custom').dataset.action).toBe('acme.create');
        expect(document.querySelector('.vela-dtb-flyout')!.textContent).toContain('ACME TOOLS');
        menuRow('Create custom').click();
        expect(runs).toHaveLength(1);
        expect(runs[0]!.chart).toBe(ws.chart);
        expect(ws.chart.drawings.getTool()).toBeNull(); // a command, not a tool

        // The same click on the icon closes an open menu.
        icon.click();
        expect(document.querySelector('.vela-dtb-flyout .vela-dtb-item')).not.toBeNull();
        cellIcon(root, 'Acme tools').click();
        expect(cellIcon(root, 'Acme tools').parentElement!.classList.contains('vela-open')).toBe(false);
    });

    it('lists the action after the tools once the group has some, and the icon arms a tool again', () => {
        const id = group({ showEmpty: true, icon: ICON });
        disposers.push(registerWidgetAction({ id: 'acme.create', target: 'drawings', group: id, label: 'Create custom', run: () => {} }));
        const { ws, root } = mountWorkspace();
        expect(cells(root)).toContain('Acme tools');

        tool('test.acme', id);
        return Promise.resolve().then(() => {
            const icon = cellIcon(root, 'Acme tools');
            expect(icon.getAttribute('aria-haspopup')).toBeNull();
            icon.click();
            expect(ws.chart.drawings.getTool()).toBe('test.acme');
            // One tool and one action: the chevron is the way into the menu.
            cellArrow(root, 'Acme tools')!.click();
            expect(menuRows()).toEqual(['Tool test.acme', 'Create custom']);
            expect(menuRow('Tool test.acme').dataset.action).toBeUndefined();
        });
    });

    it('adds an action to a built-in group, gated by `when`', () => {
        let on = false;
        disposers.push(registerWidgetAction({ id: 'acme.text', target: 'drawings', group: 'text', label: 'More text tools', when: () => on, run: () => {} }));
        const { ws, root } = mountWorkspace();
        cellArrow(root, 'Text')!.click();
        expect(menuRows()).not.toContain('More text tools');

        on = true;
        ws.refreshActions();
        cellArrow(root, 'Text')!.click();
        expect(menuRows().slice(-1)).toEqual(['More text tools']);
    });

    it('leaves the bar alone on a refresh that changed none of its actions', () => {
        const { ws, root } = mountWorkspace();
        const before = root.querySelector('.vela-dtb .vela-dtb-cell');
        ws.refreshActions();
        expect(root.querySelector('.vela-dtb .vela-dtb-cell')).toBe(before);
    });

    it('ignores an action that names no group, or a group that is not on the bar', () => {
        const def = buildToolbar(undefined).definition;
        disposers.push(registerWidgetAction({ id: 'acme.nowhere', target: 'drawings', label: 'Nowhere', run: () => {} }));
        disposers.push(registerWidgetAction({ id: 'acme.ghost', target: 'drawings', group: 'ghost', label: 'Ghost', run: () => {} }));
        const out = toolbarWithActions(def, null, () => ({}) as WidgetContext);
        expect(out.groups.map((g) => g.id)).toEqual(def.groups.map((g) => g.id));
        expect(out.groups.every((g) => !g.actions)).toBe(true);
    });

    it('lists a group and its actions in the mobile drawings drawer', () => {
        const id = group({ showEmpty: true });
        let ran = 0;
        disposers.push(registerWidgetAction({ id: 'acme.create', target: 'drawings', group: id, label: 'Create custom', icon: 'plus', run: () => ran++ }));
        const host = document.createElement('div');
        document.body.append(host);
        const drawer = new DrawingsDrawer({
            host,
            toolbar: () => toolbarWithActions(buildToolbar({ groups: [{ id, label: 'Acme tools', tools: [] }] }).definition, null, () => ({}) as WidgetContext),
            currentTool: () => null,
            isFavorite: () => false,
            onFavorite: () => {},
            onSelect: () => {},
        });
        disposers.push(() => drawer.destroy());
        drawer.open();
        const rows = [...host.querySelectorAll<HTMLElement>('.vela-dd-row')];
        expect(rows.map((r) => r.textContent)).toEqual(['Create custom']);
        expect(rows[0]!.querySelector('.vela-dd-star')).toBeNull();
        rows[0]!.click();
        expect(ran).toBe(1);
    });
});
