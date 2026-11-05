// @vitest-environment jsdom
// Shell option defaults a plugin registers: every shell built afterwards uses one where its
// host gave no value, and the host's own value always wins.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// This jsdom build ships no `CSS` global, no ResizeObserver and no Web Animations; the
// chrome uses them decoratively.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { registerShellDefaults, shellDefaults, unregisterShellDefaults } from '../src/plugin';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

function mount(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', ...opts } as never);
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

afterEach(() => unregisterShellDefaults());

describe('shell defaults', () => {
    it("give a shell the sidebar a plugin asks for when the host says nothing about it", () => {
        const before = mount();
        registerShellDefaults({ sidebar: true });
        const after = mount();
        expect(after.root.hasAttribute('data-vela-sidebar')).toBe(true);
        expect(before.root.hasAttribute('data-vela-sidebar')).toBe(false); // built earlier: untouched
        before.ws.destroy();
        after.ws.destroy();
    });

    it("never override the host's own value, false included", () => {
        registerShellDefaults({ sidebar: true });
        const { ws, root } = mount({ sidebar: false });
        expect(root.hasAttribute('data-vela-sidebar')).toBe(false);
        ws.destroy();
    });

    it('take a composition like the option does, and the disposer removes only its own value', () => {
        const off = registerShellDefaults({ sidebar: { top: ['panels'], bottom: [] } });
        const { ws, root } = mount();
        expect(root.hasAttribute('data-vela-sidebar')).toBe(true);
        ws.destroy();
        const later = registerShellDefaults({ sidebar: true });
        off();
        expect(shellDefaults()).toEqual({ sidebar: true });
        later();
        expect(shellDefaults()).toEqual({});
    });
});
