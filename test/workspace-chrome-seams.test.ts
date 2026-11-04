// @vitest-environment jsdom
// What a plugin reads and drives of the shell's chrome through its context: the built-in
// topbar items (`ctx.topbar`) and the side-panel dock (`ctx.panels`).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { registerSidePanel } from '../src/widget/contributions';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => document.body.replaceChildren());

function mountWorkspace(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', ...opts } as never);
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

/** The labels of the mobile three-dots menu's rows, opened from the bottom bar. */
function drawerRows(root: HTMLElement): string[] {
    root.querySelector<HTMLElement>('.vela-mb-more')!.click();
    return [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((e) => e.textContent ?? '');
}

function screenshotChord(ws: VelaWorkspace): boolean {
    const keymap = (ws as unknown as { keymap: { bindings(): Array<{ id: string }> } }).keymap;
    return keymap.bindings().some((b) => b.id === 'chart.screenshot');
}

describe('ctx.topbar', () => {
    it('hides a built-in item with its other entry points, and gives it back', () => {
        const { ws, root } = mountWorkspace();
        const topbar = ws.context().topbar;
        const bell = root.querySelector<HTMLElement>('.vela-widget-alerts')!;
        expect(topbar.isVisible('alerts')).toBe(true);
        expect(drawerRows(root)).toContain('Alerts');

        topbar.setVisible('alerts', false);
        expect(topbar.isVisible('alerts')).toBe(false);
        expect(bell.dataset.topbarHidden).toBe('1');
        expect(drawerRows(root)).not.toContain('Alerts');

        topbar.setVisible('alerts', true);
        expect(bell.dataset.topbarHidden).toBeUndefined();
        expect(drawerRows(root)).toContain('Alerts');
        ws.destroy();
    });

    it('takes the screenshot chord away with the button, and brings it back', () => {
        const { ws } = mountWorkspace();
        const topbar = ws.context().topbar;
        expect(screenshotChord(ws)).toBe(true);
        topbar.setVisible('screenshot', false);
        expect(screenshotChord(ws)).toBe(false);
        topbar.setVisible('screenshot', true);
        expect(screenshotChord(ws)).toBe(true);
        ws.destroy();
    });

    it('never shows what the composition left out, and ignores the flow slot and unknown ids', () => {
        const { ws, root } = mountWorkspace({ topbar: { right: ['panels'] } });
        const topbar = ws.context().topbar;
        expect(topbar.isVisible('alerts')).toBe(false);
        topbar.setVisible('alerts', true);
        expect(topbar.isVisible('alerts')).toBe(false);
        expect(root.querySelector('.vela-widget-alerts')).toBeNull();
        topbar.setVisible('actions' as never, false);
        topbar.setVisible('nope' as never, false);
        expect(root.querySelectorAll('[data-topbar-hidden]')).toHaveLength(0);
        ws.destroy();
    });
});

describe('ctx.panels', () => {
    it('lists the dock, built-ins first, and follows a panel opening and closing', () => {
        const off = registerSidePanel({ id: 'test.notes', title: 'Notes', icon: 'pen', mount: () => {} });
        const { ws } = mountWorkspace();
        const panels = ws.context().panels;
        const list = panels.list();
        expect(list.filter((p) => p.builtIn).map((p) => p.id)).toEqual(['dataWindow', 'objects']);
        expect(list.find((p) => p.id === 'test.notes')).toEqual({ id: 'test.notes', title: 'Notes', icon: 'pen', builtIn: false });

        const seen: Array<string | null> = [];
        const stop = panels.onDidChange(() => seen.push(panels.openId()));
        ws.context().togglePanel('test.notes', true);
        expect(panels.openId()).toBe('test.notes');
        ws.context().togglePanel('test.notes', false);
        expect(panels.openId()).toBeNull();
        expect(seen).toContain('test.notes');
        expect(seen[seen.length - 1]).toBeNull();
        stop();
        ws.destroy();
        off();
    });
});
