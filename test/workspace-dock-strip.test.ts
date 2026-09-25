// @vitest-environment jsdom
// `ctx.dockStrip(el)`: a contributed element joins the shell's layout as a full-width strip
// between the charts and the bottom bar, stacks in docking order, and leaves on undock.
import { describe, it, expect, beforeAll } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

function mountWorkspace(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', ...opts } as never);
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')! };
}

/** The root's direct children, named by their first class. */
function layout(root: HTMLElement): string[] {
    return [...root.children].map((c) => c.classList[0] ?? c.tagName);
}

describe('docking a strip under the charts', () => {
    it('sits between the chart row and the bottom bar, in docking order', () => {
        const { ws, root } = mountWorkspace();
        const a = document.createElement('div');
        const b = document.createElement('div');
        ws.context().dockStrip(a);
        ws.context().dockStrip(b);

        const order = layout(root);
        expect(order.indexOf('vela-ws-main')).toBeLessThan(order.indexOf('vela-ws-strips'));
        expect(order.indexOf('vela-ws-strips')).toBeLessThan(order.indexOf('vela-widget-bottombar'));
        expect([...root.querySelector('.vela-ws-strips')!.children]).toEqual([a, b]);
        ws.destroy();
    });

    it('the undock removes only that strip, and is a no-op once the element moved elsewhere', () => {
        const { ws, root } = mountWorkspace();
        const strips = root.querySelector('.vela-ws-strips')!;
        const a = document.createElement('div');
        const b = document.createElement('div');
        const undockA = ws.context().dockStrip(a);
        const undockB = ws.context().dockStrip(b);

        undockA();
        expect([...strips.children]).toEqual([b]);

        const elsewhere = document.createElement('section');
        elsewhere.append(b); // the owner took it back into its own chrome
        undockB();
        expect(b.parentElement).toBe(elsewhere);
        expect(strips.children).toHaveLength(0);
        ws.destroy();
    });

    it('still docks above where the bottom bar would be when the shell has none', () => {
        const { ws, root } = mountWorkspace({ bottombar: false });
        const a = document.createElement('div');
        ws.context().dockStrip(a);
        const order = layout(root);
        expect(order.indexOf('vela-ws-main')).toBeLessThan(order.indexOf('vela-ws-strips'));
        expect(a.parentElement?.className).toBe('vela-ws-strips');
        ws.destroy();
    });
});
