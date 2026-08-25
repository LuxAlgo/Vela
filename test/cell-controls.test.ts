// The per-cell view cluster (src/widget/cell-controls.ts): the proximity reveal (pure),
// the button set and its maximize gating, and the actions' routing. Node env — the DOM
// is a MINIMAL stub (element tree, listeners, inline style); real rendering and the
// workspace's maximize presentation are proven in the browser.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CellControls, nearBottomCenter, CELL_CONTROLS_PROXIMITY_PX, type CellControlsDeps } from '../src/widget/cell-controls';
import type { Vela } from '../src/Vela';

interface StubEl {
    tagName: string;
    className: string;
    title: string;
    type: string;
    innerHTML: string;
    textContent: string;
    style: Record<string, string>;
    children: StubEl[];
    parent: StubEl | null;
    ownerDocument: unknown;
    listeners: Map<string, Array<(e: unknown) => void>>;
    appendChild(node: StubEl): StubEl;
    setAttribute(name: string, value: string): void;
    addEventListener(type: string, fn: (e: unknown) => void): void;
    removeEventListener(type: string, fn: (e: unknown) => void): void;
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    remove(): void;
    fire(type: string, event?: Record<string, unknown>): void;
}

function makeEl(doc: unknown, tagName: string): StubEl {
    let text = '';
    const el: StubEl = {
        tagName,
        className: '',
        title: '',
        type: '',
        innerHTML: '',
        get textContent() {
            return text;
        },
        // The component clears the cluster via `textContent = ''` — mirror the DOM's
        // child-dropping semantics, which is what refresh() relies on.
        set textContent(v: string) {
            text = v;
            el.children.length = 0;
        },
        style: {},
        children: [],
        parent: null,
        ownerDocument: doc,
        listeners: new Map(),
        appendChild(node) {
            node.parent = el;
            el.children.push(node);
            return node;
        },
        setAttribute() {},
        addEventListener(t, fn) {
            const list = el.listeners.get(t) ?? [];
            list.push(fn);
            el.listeners.set(t, list);
        },
        removeEventListener(t, fn) {
            const list = el.listeners.get(t) ?? [];
            el.listeners.set(t, list.filter((f) => f !== fn));
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        remove() {
            if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
            el.parent = null;
        },
        fire(t, event = {}) {
            for (const fn of el.listeners.get(t) ?? []) fn({ stopPropagation: () => {}, ...event });
        },
    };
    return el;
}

function makeHost(): StubEl {
    const doc = { createElement: (tag: string) => makeEl(doc, tag) };
    return makeEl(doc, 'div');
}

function makeDeps(over: Partial<CellControlsDeps> = {}): CellControlsDeps {
    return {
        chart: () => null,
        reset: () => {},
        canMaximize: () => true,
        isMaximized: () => false,
        toggleMaximize: () => {},
        ...over,
    };
}

const cluster = (host: StubEl): StubEl => host.children[0]!;
const titles = (host: StubEl): string[] => cluster(host).children.map((b) => b.title);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('nearBottomCenter (pure)', () => {
    it('is true at the cluster spot and within the proximity radius', () => {
        // 800×600 cell: the cluster centers at (400, 600 − 34 − 12) = (400, 554).
        expect(nearBottomCenter(400, 554, 800, 600)).toBe(true);
        expect(nearBottomCenter(400 + CELL_CONTROLS_PROXIMITY_PX, 554, 800, 600)).toBe(true); // radius inclusive
        expect(nearBottomCenter(400, 554 - CELL_CONTROLS_PROXIMITY_PX, 800, 600)).toBe(true);
    });

    it('is false away from the bottom-center', () => {
        expect(nearBottomCenter(400, 300, 800, 600)).toBe(false); // middle of the plot
        expect(nearBottomCenter(20, 580, 800, 600)).toBe(false); // bottom-LEFT corner
        expect(nearBottomCenter(780, 580, 800, 600)).toBe(false); // bottom-RIGHT (scroll button's home)
        expect(nearBottomCenter(400, 20, 800, 600)).toBe(false); // top-center
    });

    it('scales with the cell size — the spot follows the cell, not the viewport', () => {
        expect(nearBottomCenter(200, 254, 400, 300)).toBe(true); // half-size cell, its own bottom-center
        expect(nearBottomCenter(400, 554, 400, 300)).toBe(false); // the big cell's spot is outside a small cell
    });
});

describe('CellControls — button set and gating', () => {
    it('builds zoom out / zoom in / maximize / reset when maximize applies', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps());
        expect(titles(host)).toEqual(['Zoom out', 'Zoom in', 'Maximize chart', 'Reset chart']);
    });

    it('drops the maximize button on single-cell grids (no space to trade)', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps({ canMaximize: () => false }));
        expect(titles(host)).toEqual(['Zoom out', 'Zoom in', 'Reset chart']);
    });

    it('refresh() flips maximize to restore for the maximized cell', () => {
        const host = makeHost();
        let maximized = false;
        const controls = new CellControls(host as never, makeDeps({ isMaximized: () => maximized }));
        expect(cluster(host).children[2]!.className).toBe('vela-cc-btn'); // resting state — no chip
        maximized = true;
        controls.refresh();
        expect(titles(host)).toEqual(['Zoom out', 'Zoom in', 'Restore layout', 'Reset chart']);
        // The maximized state reads as the inverse "selected" chip (the collapsed-pane idiom).
        expect(cluster(host).children[2]!.className).toBe('vela-cc-btn vela-cc-on');
    });
});

describe('CellControls — proximity reveal', () => {
    it('starts hidden, shows near the bottom-center, hides when the pointer leaves', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps());
        expect(cluster(host).style.display).toBe('none');
        host.fire('pointermove', { clientX: 400, clientY: 554 });
        expect(cluster(host).style.display).toBe('flex');
        host.fire('pointermove', { clientX: 400, clientY: 100 });
        expect(cluster(host).style.display).toBe('none');
        host.fire('pointermove', { clientX: 400, clientY: 554 });
        host.fire('pointerleave');
        expect(cluster(host).style.display).toBe('none');
    });

    it('destroy() unhooks the host listeners and removes the cluster', () => {
        const host = makeHost();
        const controls = new CellControls(host as never, makeDeps());
        controls.destroy();
        expect(host.children).toHaveLength(0);
        expect(host.listeners.get('pointermove') ?? []).toHaveLength(0);
        expect(host.listeners.get('pointerleave') ?? []).toHaveLength(0);
    });
});

describe('CellControls — actions', () => {
    it('routes maximize and reset to the deps', () => {
        const host = makeHost();
        const reset = vi.fn();
        const toggleMaximize = vi.fn();
        new CellControls(host as never, makeDeps({ reset, toggleMaximize }));
        cluster(host).children[2]!.fire('click');
        expect(toggleMaximize).toHaveBeenCalledTimes(1);
        cluster(host).children[3]!.fire('click');
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('zoom in glides THIS cell toward a right-anchored narrower range', () => {
        // Synchronous rAF: the glide converges geometrically, so driving the frames
        // inline terminates on the snap step (see followStep).
        vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
            cb();
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
        const host = makeHost();
        const applied: Array<{ from: number; to: number }> = [];
        const chart = {
            getVisibleRange: () => ({ from: 0, to: 1_000_000 }),
            setVisibleRange: (r: { from: number; to: number }) => applied.push(r),
        } as unknown as Vela;
        new CellControls(host as never, makeDeps({ chart: () => chart }));
        cluster(host).children[1]!.fire('click'); // zoom in
        const last = applied[applied.length - 1]!;
        expect(last.to).toBe(1_000_000); // right edge anchored
        expect(last.from).toBeCloseTo(200_000, -3); // span × 0.8
    });
});
