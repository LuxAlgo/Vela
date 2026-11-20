// @vitest-environment jsdom
// Full screen: the charts take the whole shell. `setFullscreen` hides the bars and closes the
// open side panel, the `'fullscreen'` topbar slot carries the button and its chord, and Esc
// leaves only once nothing else has a use for it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { SURFACE_CLOSE_EVENT, SURFACE_OPEN_EVENT } from '../src/ui';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const WORKSPACE_TIMEOUT = 30_000;

let restoreCanvas: () => void;
beforeAll(() => {
    restoreCanvas = installCanvasStandIn();
});
afterAll(() => restoreCanvas());

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

function mount(opts: Record<string, unknown> = {}): { ws: VelaWorkspace; root: HTMLElement; changes: boolean[] } {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: false, layoutMode: 'desktop', ...opts } as never);
    disposers.push(() => ws.destroy());
    const changes: boolean[] = [];
    ws.on('fullscreen:changed', ({ on }) => changes.push(on));
    return { ws, root: host.querySelector<HTMLElement>('.vela-workspace')!, changes };
}

/** A key pressed with focus on `target`, the way the browser delivers it. */
function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
}

const escape = (target: EventTarget): KeyboardEvent => press(target, { key: 'Escape' });
const chord = (target: EventTarget): KeyboardEvent => press(target, { key: 'Enter', altKey: true });
const hasChord = (ws: VelaWorkspace): boolean => ws.keymap.bindings().some((b) => b.id === 'chart.fullscreen');

describe('setFullscreen', () => {
    it(
        'marks the shell, reports the change once, and comes back',
        () => {
            const { ws, root, changes } = mount();
            expect(ws.fullscreen).toBe(false);
            expect(root.hasAttribute('data-fullscreen')).toBe(false);

            ws.setFullscreen(true);
            ws.setFullscreen(true); // already there: nothing more to report
            expect(ws.fullscreen).toBe(true);
            expect(root.hasAttribute('data-fullscreen')).toBe(true);

            ws.setFullscreen(false);
            expect(ws.fullscreen).toBe(false);
            expect(root.hasAttribute('data-fullscreen')).toBe(false);
            expect(changes).toEqual([true, false]);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'closes the open side panel and brings it back, unless another one opened meanwhile',
        () => {
            const { ws } = mount();
            const ctx = ws.context();
            ctx.togglePanel('objects', true);
            ws.setFullscreen(true);
            expect(ctx.panels.openId()).toBeNull();
            ws.setFullscreen(false);
            expect(ctx.panels.openId()).toBe('objects');

            ws.setFullscreen(true);
            ctx.togglePanel('dataWindow', true);
            ws.setFullscreen(false);
            expect(ctx.panels.openId()).toBe('dataWindow');
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'is ignored on the mobile layout, where the one bar drives the chart',
        () => {
            const { ws, root, changes } = mount({ layoutMode: 'mobile' });
            ws.setFullscreen(true);
            expect(ws.fullscreen).toBe(false);
            expect(root.hasAttribute('data-fullscreen')).toBe(false);
            expect(changes).toEqual([]);
        },
        WORKSPACE_TIMEOUT,
    );
});

describe('ctx.fullscreen', () => {
    it(
        'reads the state and follows it whichever way it changed, until unsubscribed',
        () => {
            const { ws, root } = mount();
            const fullscreen = ws.context().fullscreen;
            const seen: boolean[] = [];
            const off = fullscreen.onDidChange((on) => seen.push(on));
            expect(fullscreen.isOn()).toBe(false);

            ws.setFullscreen(true); // the host
            expect(fullscreen.isOn()).toBe(true);
            escape(root); // the user
            expect(fullscreen.isOn()).toBe(false);
            chord(root);
            expect(seen).toEqual([true, false, true]);

            off();
            ws.setFullscreen(false);
            expect(seen).toEqual([true, false, true]);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'enters and leaves for a plugin that offers its own way in',
        () => {
            const { ws, root, changes } = mount();
            // A context built before the change still reads the truth: the control is live.
            const fullscreen = ws.context().fullscreen;
            fullscreen.set(true);
            expect(ws.fullscreen).toBe(true);
            expect(root.hasAttribute('data-fullscreen')).toBe(true);
            fullscreen.set(false);
            expect(ws.fullscreen).toBe(false);
            expect(changes).toEqual([true, false]);
        },
        WORKSPACE_TIMEOUT,
    );
});

describe("the 'fullscreen' topbar slot", () => {
    it(
        'shows a button and a chord by default, and both toggle full screen',
        () => {
            const { ws, root, changes } = mount();
            const button = root.querySelector<HTMLElement>('.vela-widget-topbar .vela-widget-fullscreen');
            expect(button).not.toBeNull();
            expect(hasChord(ws)).toBe(true);

            button!.click();
            expect(ws.fullscreen).toBe(true);
            chord(root);
            expect(ws.fullscreen).toBe(false);
            chord(root);
            expect(ws.fullscreen).toBe(true);
            expect(changes).toEqual([true, false, true]);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'says how to leave on the way in, and takes the notice down on the way out',
        () => {
            const { ws, root } = mount();
            const notice = (): string | null => {
                const el = root.querySelector<HTMLElement>('.vela-toast[data-open]');
                return el ? el.textContent : null;
            };
            chord(root);
            expect(notice()).toBe('Press Esc to exit full screen');
            escape(root);
            expect(notice()).toBeNull();

            // A notice of something else that replaced it is not full screen's to take down.
            chord(root);
            ws.toast('Saved');
            escape(root);
            expect(notice()).toBe('Saved');
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'takes the button and the chord away when the composition leaves it out, and keeps the method',
        () => {
            const { ws, root } = mount({ topbar: { right: ['panels'] } });
            expect(root.querySelector('.vela-widget-fullscreen')).toBeNull();
            expect(hasChord(ws)).toBe(false);
            chord(root);
            expect(ws.fullscreen).toBe(false);
            ws.setFullscreen(true);
            expect(ws.fullscreen).toBe(true);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'loses its chord while a plugin hides it, and gets it back',
        () => {
            const { ws } = mount();
            const topbar = ws.context().topbar;
            topbar.setVisible('fullscreen', false);
            expect(topbar.isVisible('fullscreen')).toBe(false);
            expect(hasChord(ws)).toBe(false);
            topbar.setVisible('fullscreen', true);
            expect(hasChord(ws)).toBe(true);
        },
        WORKSPACE_TIMEOUT,
    );
});

describe('Esc in full screen', () => {
    it(
        'leaves full screen from the shell or with focus nowhere, and ignores the rest of the page',
        () => {
            const { ws, root } = mount();
            const elsewhere = document.createElement('button');
            document.body.append(elsewhere);

            ws.setFullscreen(true);
            escape(elsewhere);
            expect(ws.fullscreen).toBe(true);
            escape(root);
            expect(ws.fullscreen).toBe(false);

            ws.setFullscreen(true);
            escape(document.body);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'does nothing outside full screen, or once the shell is destroyed',
        () => {
            const { ws, root, changes } = mount();
            escape(root);
            expect(changes).toEqual([]);
            ws.setFullscreen(true);
            ws.destroy();
            expect(() => escape(document.body)).not.toThrow();
            expect(changes).toEqual([true]);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'is spent on an open menu first, and leaves on the next press',
        () => {
            const { ws, root } = mount();
            const menu = document.createElement('div');
            root.append(menu);
            const announce = (type: string): boolean => menu.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { kind: 'menu', trigger: null } }));

            ws.setFullscreen(true);
            announce(SURFACE_OPEN_EVENT);
            escape(root);
            expect(ws.fullscreen).toBe(true);
            announce(SURFACE_CLOSE_EVENT);
            escape(root);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'forgets a menu that left the page without closing, and never counts a side panel',
        () => {
            const { ws, root } = mount();
            const menu = document.createElement('div');
            const panel = document.createElement('div');
            root.append(menu, panel);
            menu.dispatchEvent(new CustomEvent(SURFACE_OPEN_EVENT, { bubbles: true, detail: { kind: 'menu', trigger: null } }));
            panel.dispatchEvent(new CustomEvent(SURFACE_OPEN_EVENT, { bubbles: true, detail: { kind: 'panel', trigger: null } }));
            menu.remove();

            ws.setFullscreen(true);
            escape(root);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'is left to a field being typed in, and to a dialog holding the focus',
        () => {
            const { ws, root } = mount();
            const field = document.createElement('input');
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            const close = document.createElement('button');
            dialog.append(close);
            root.append(field, dialog);

            ws.setFullscreen(true);
            escape(field);
            escape(close);
            expect(ws.fullscreen).toBe(true);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'still leaves when the page shows the shell itself inside a dialog',
        () => {
            const modal = document.createElement('div');
            modal.setAttribute('role', 'dialog');
            document.body.append(modal);
            const ws = new VelaWorkspace(modal, { layout: false, layoutMode: 'desktop' } as never);
            disposers.push(() => ws.destroy());

            ws.setFullscreen(true);
            escape(modal.querySelector('.vela-workspace')!);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'clears a selected drawing first, and leaves on the next press',
        () => {
            const { ws, root } = mount();
            const drawing = ws.chart.drawings.add('hline', { anchors: [{ time: 1_700_000_000_000, price: 100 }] });
            expect(drawing).not.toBeNull();
            ws.chart.drawings.select(drawing!.id);

            ws.setFullscreen(true);
            escape(root);
            expect(ws.fullscreen).toBe(true);
            escape(root);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'clears the selection itself when the chart is not focused to hear the key',
        () => {
            // A menu that closes leaves the focus on the page: the chart's own Esc never runs.
            const { ws } = mount();
            const selections: number[] = [];
            ws.chart.on('drawing:selected', ({ ids }) => selections.push(ids.length));
            const drawing = ws.chart.drawings.add('hline', { anchors: [{ time: 1_700_000_000_000, price: 100 }] });
            ws.chart.drawings.select(drawing!.id);

            ws.setFullscreen(true);
            escape(document.body);
            expect(ws.fullscreen).toBe(true);
            expect(selections[selections.length - 1]).toBe(0);
            escape(document.body);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );

    it(
        'returns an armed drawing tool to the cursor first, since its toolbar is hidden',
        () => {
            const { ws, root } = mount();
            ws.chart.drawings.setTool('trendline');
            expect(ws.chart.drawings.getTool()).toBe('trendline');

            ws.setFullscreen(true);
            escape(root);
            expect(ws.fullscreen).toBe(true);
            expect(ws.chart.drawings.getTool()).toBeNull();
            escape(root);
            expect(ws.fullscreen).toBe(false);
        },
        WORKSPACE_TIMEOUT,
    );
});
