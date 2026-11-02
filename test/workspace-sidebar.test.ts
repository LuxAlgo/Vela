// @vitest-environment jsdom
// The shell's right-edge toolbar (`sidebar` option): its composition, the side-panel toggles
// it takes over from the topbar, the actions plugins register on it, badges, and the mobile
// layout's menu rows standing in for it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { registerSidePanel, registerWidgetAction } from '../src/widget/contributions';
import { composeSidebar, type SidebarSource } from '../src/widget/sidebar-composition';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    for (const off of disposers.splice(0)) off();
    document.body.replaceChildren();
});

function mountWorkspace(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', layoutMode: 'desktop', ...opts } as never);
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

/** The sidebar's entries, section by section, `|` between groups. */
function entries(root: HTMLElement): { top: string[]; bottom: string[] } {
    const read = (section: string): string[] => {
        const out: string[] = [];
        for (const child of root.querySelectorAll(`.vela-sidebar [data-section="${section}"] > *`)) {
            if (child.classList.contains('vela-sidebar-sep')) out.push('|');
            else out.push(...[...child.querySelectorAll<HTMLElement>('.vela-sidebar-btn')].map((b) => b.dataset.id!));
        }
        return out;
    };
    return { top: read('top'), bottom: read('bottom') };
}

const button = (root: HTMLElement, id: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.vela-sidebar-btn[data-id="${id}"]`)!;

describe('composeSidebar', () => {
    const src: SidebarSource[] = [
        { id: 'dataWindow', kind: 'panel', order: 0 },
        { id: 'objects', kind: 'panel', order: 1 },
        { id: 'watch', kind: 'panel', order: 2 },
        { id: 'book', kind: 'panel', order: 3 },
        { id: 'act.b', kind: 'action', order: 1 },
        { id: 'act.a', kind: 'action', order: 0 },
    ];
    const ids = (groups: SidebarSource[][]): string[][] => groups.map((g) => g.map((s) => s.id));

    it('by default puts the contributed panels on top and the inspection panels and actions at the bottom', () => {
        const layout = composeSidebar(src);
        expect(ids(layout.top)).toEqual([['watch', 'book']]);
        expect(ids(layout.bottom)).toEqual([['objects', 'dataWindow'], ['act.a', 'act.b']]);
    });

    it('places listed ids once, lets the slots take the rest in order, and skips unknown ids and empty groups', () => {
        const layout = composeSidebar(src, { top: ['book', 'panels', 'book', '|', 'nope', '|'], bottom: ['act.b', 'actions'] });
        expect(ids(layout.top)).toEqual([['book', 'dataWindow', 'objects', 'watch']]);
        expect(ids(layout.bottom)).toEqual([['act.b', 'act.a']]);
    });

    it('keeps an undeclared section at its default', () => {
        const layout = composeSidebar(src, { top: ['actions'] });
        expect(ids(layout.top)).toEqual([['act.a', 'act.b']]);
        expect(ids(layout.bottom)).toEqual([['objects', 'dataWindow']]);
    });
});

describe('the sidebar option', () => {
    it('is off by default: no sidebar, and the shell keeps its plain layout', () => {
        const { ws, root } = mountWorkspace();
        expect(root.querySelector('.vela-sidebar')).toBeNull();
        expect(root.hasAttribute('data-vela-sidebar')).toBe(false);
        expect(root.hasAttribute('data-vela-regions')).toBe(false);
        expect(ws.context().sidebar.enabled).toBe(false);
        ws.context().sidebar.setBadge('objects', 3); // a no-op, not an error
        ws.destroy();
    });

    it('docks at the right edge and hosts the panel toggles, in step with the dock', () => {
        disposers.push(registerSidePanel({ id: 'probe.watch', title: 'Watchlist', icon: 'eye', mount: (_c, body) => void (body.textContent = 'watch') }));
        const { ws, root } = mountWorkspace({ sidebar: true });
        const bar = root.querySelector<HTMLElement>('.vela-sidebar')!;
        expect(bar.parentElement!.classList.contains('vela-ws-edge')).toBe(true);
        expect(bar.getAttribute('aria-label')).toBe('Sidebar');
        expect(root.hasAttribute('data-vela-sidebar')).toBe(true);
        expect(ws.context().sidebar.enabled).toBe(true);
        expect(entries(root)).toEqual({ top: ['probe.watch'], bottom: ['objects', 'dataWindow'] });

        button(root, 'probe.watch').click();
        expect(ws.context().panels.openId()).toBe('probe.watch');
        expect(button(root, 'probe.watch').dataset.active).toBe('1');
        expect(button(root, 'probe.watch').getAttribute('aria-pressed')).toBe('true');
        button(root, 'objects').click();
        expect(ws.context().panels.openId()).toBe('objects');
        expect(button(root, 'probe.watch').dataset.active).toBe('');
        expect(button(root, 'objects').dataset.active).toBe('1');
        // The topbar's toggles still follow the dock (its group is hidden by CSS on desktop).
        expect(root.querySelector<HTMLElement>('.vela-widget-panel-objects')!.dataset.active).toBe('1');
        ws.destroy();
    });

    it('lists the sidebar actions, runs them, and redraws their pressed look and badges on request', () => {
        let on = false;
        let runs = 0;
        disposers.push(
            registerWidgetAction({
                id: 'probe.alerts',
                target: 'sidebar',
                label: 'Alerts',
                icon: 'bell',
                active: () => on,
                run: () => {
                    runs += 1;
                    on = !on;
                },
            }),
        );
        const { ws, root } = mountWorkspace({ sidebar: true });
        expect(entries(root).bottom).toEqual(['objects', 'dataWindow', '|', 'probe.alerts']);
        const ctx = ws.context();

        button(root, 'probe.alerts').click();
        expect(runs).toBe(1);
        expect(button(root, 'probe.alerts').dataset.active).toBe('1'); // a press redraws
        on = false;
        ctx.sidebar.refresh();
        expect(button(root, 'probe.alerts').dataset.active).toBe('');

        ctx.sidebar.setBadge('probe.alerts', 3);
        expect(button(root, 'probe.alerts').querySelector('.vela-sidebar-badge')!.textContent).toBe('3');
        ctx.sidebar.setBadge('probe.alerts', 120);
        expect(button(root, 'probe.alerts').querySelector('.vela-sidebar-badge')!.textContent).toBe('99+');
        ctx.sidebar.setBadge('probe.alerts', 0);
        expect(button(root, 'probe.alerts').querySelector('.vela-sidebar-badge')).toBeNull();
        ws.destroy();
    });

    it('shows an action registered after construction once the shell refreshes its actions', () => {
        const { ws, root } = mountWorkspace({ sidebar: true });
        expect(root.querySelector('.vela-sidebar-btn[data-id="probe.late"]')).toBeNull();
        disposers.push(registerWidgetAction({ id: 'probe.late', target: 'sidebar', label: 'Late', icon: 'star', run: () => {} }));
        ws.refreshActions();
        expect(button(root, 'probe.late')).not.toBeNull();
        ws.destroy();
    });

    it('follows the host composition', () => {
        disposers.push(registerSidePanel({ id: 'probe.watch', title: 'Watchlist', icon: 'eye', mount: () => {} }));
        disposers.push(registerWidgetAction({ id: 'probe.alerts', target: 'sidebar', label: 'Alerts', icon: 'bell', run: () => {} }));
        const { ws, root } = mountWorkspace({ sidebar: { top: ['probe.alerts', '|', 'probe.watch'], bottom: ['objects'] } });
        expect(entries(root)).toEqual({ top: ['probe.alerts', '|', 'probe.watch'], bottom: ['objects'] });
        ws.destroy();
    });

    it('marks its buttons with the action and panel ids plugins anchor to', () => {
        disposers.push(registerWidgetAction({ id: 'probe.alerts', target: 'sidebar', label: 'Alerts', icon: 'bell', run: () => {} }));
        const { ws, root } = mountWorkspace({ sidebar: true });
        expect(root.querySelector('.vela-sidebar [data-action-id="probe.alerts"]')).toBe(button(root, 'probe.alerts'));
        expect(root.querySelector('.vela-sidebar [data-panel-id="objects"]')).toBe(button(root, 'objects'));
        expect(button(root, 'objects').hasAttribute('data-action-id')).toBe(false);
        ws.destroy();
    });

    it('hides and gives back entries at runtime, never adding what the composition left out', () => {
        disposers.push(registerWidgetAction({ id: 'probe.alerts', target: 'sidebar', label: 'Alerts', icon: 'bell', run: () => {} }));
        const { ws, root } = mountWorkspace({ sidebar: { top: [], bottom: ['objects', '|', 'actions'] } });
        const sidebar = ws.context().sidebar;
        expect(sidebar.isVisible('objects')).toBe(true);
        expect(sidebar.isVisible('dataWindow')).toBe(false); // left out by the composition
        sidebar.setVisible('dataWindow', true);
        expect(sidebar.isVisible('dataWindow')).toBe(false);

        sidebar.setVisible('probe.alerts', false);
        sidebar.setVisible('objects', false);
        expect(entries(root).bottom).toEqual([]);
        expect(sidebar.isVisible('probe.alerts')).toBe(false);
        sidebar.setVisible('objects', true);
        sidebar.setVisible('probe.alerts', true);
        expect(entries(root).bottom).toEqual(['objects', '|', 'probe.alerts']);
        ws.destroy();
    });

    it('takes a hidden action out of the three-dots menu too', () => {
        disposers.push(registerWidgetAction({ id: 'probe.alerts', target: 'sidebar', label: 'Price alerts', icon: 'bell', run: () => {} }));
        const { ws, root } = mountWorkspace({ sidebar: true, layoutMode: 'mobile' });
        ws.context().sidebar.setVisible('probe.alerts', false);
        root.querySelector<HTMLElement>('.vela-mb-more')!.click();
        const rows = [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((e) => e.textContent ?? '');
        expect(rows).not.toContain('Price alerts');
        ws.destroy();
    });

    it('hands its actions to the three-dots menu on the mobile layout', () => {
        disposers.push(registerWidgetAction({ id: 'probe.alerts', target: 'sidebar', label: 'Price alerts', icon: 'bell', run: () => {} }));
        const { ws, root } = mountWorkspace({ sidebar: true, layoutMode: 'mobile' });
        root.querySelector<HTMLElement>('.vela-mb-more')!.click();
        const rows = [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((e) => e.textContent ?? '');
        expect(rows).toContain('Price alerts');
        expect(rows).toContain('Object tree');
        ws.destroy();
    });
});
