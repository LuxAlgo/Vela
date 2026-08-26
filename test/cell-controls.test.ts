// The per-cell view cluster (src/widget/cell-controls.ts): the proximity reveal (pure),
// the button set and its maximize gating, and the actions' routing. Node env — the DOM
// is a MINIMAL stub (element tree, listeners, inline style); real rendering and the
// workspace's maximize presentation are proven in the browser.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CellControls, nearBottomCenter, plotCenterX, CELL_CONTROLS_PROXIMITY_PX, CLUSTER_LEFT_CSS, type CellControlsDeps } from '../src/widget/cell-controls';
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
            for (const fn of [...(el.listeners.get(t) ?? [])]) fn({ stopPropagation: () => {}, preventDefault: () => {}, ...event });
        },
    };
    (el as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
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
        multiCell: () => true,
        isMaximized: () => false,
        toggleMaximize: () => {},
        dragTargetAt: () => null,
        previewDrop: () => {},
        dropOn: () => {},
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
        // 800×600 cell, no gutters: the cluster centers at (400, 600 − 34 − 12) = (400, 554).
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

    it('centers on the plot, not the full cell, when a scale gutter is reserved', () => {
        // 800px cell, 64px price axis: plot center at (800 − 64) / 2 = 368.
        const scale = 64;
        const cx = plotCenterX(800, 0, scale);
        expect(cx).toBe(368);
        expect(nearBottomCenter(cx, 554, 800, 600, CELL_CONTROLS_PROXIMITY_PX, { scale })).toBe(true);
        expect(nearBottomCenter(cx + CELL_CONTROLS_PROXIMITY_PX, 554, 800, 600, CELL_CONTROLS_PROXIMITY_PX, { scale })).toBe(true);
        // The old full-cell right edge (400 + 120 = 520) is now outside the radius.
        expect(nearBottomCenter(520, 554, 800, 600, CELL_CONTROLS_PROXIMITY_PX, { scale })).toBe(false);
        expect(nearBottomCenter(520, 554, 800, 600)).toBe(true); // without a gutter, the old spot still holds
    });

    it('shifts right by half the toolbar gutter (drawings dock on the left)', () => {
        expect(plotCenterX(800, 44, 64)).toBe(390); // (800 + 44 − 64) / 2
    });
});

describe('CellControls — button set and gating', () => {
    it('pins left to the plot center (scale gutter), not the full cell', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps());
        expect(cluster(host).style.left).toBe(CLUSTER_LEFT_CSS);
        expect(cluster(host).style.left).toContain('--vela-scale-gutter');
        expect(cluster(host).style.transform).toBe('translateX(-50%)');
    });

    it('builds drag / zoom out / zoom in / maximize / reset on a multi-cell grid', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps());
        expect(titles(host)).toEqual(['Drag to move chart', 'Zoom out', 'Zoom in', 'Maximize chart', 'Reset chart']);
    });

    it('drops the drag handle and maximize on single-cell grids (nowhere to go)', () => {
        const host = makeHost();
        new CellControls(host as never, makeDeps({ multiCell: () => false }));
        expect(titles(host)).toEqual(['Zoom out', 'Zoom in', 'Reset chart']);
    });

    it('refresh() flips maximize to restore for the maximized cell and hides its drag handle', () => {
        const host = makeHost();
        let maximized = false;
        const controls = new CellControls(host as never, makeDeps({ isMaximized: () => maximized }));
        expect(cluster(host).children[3]!.className).toBe('vela-cc-btn'); // resting state — no chip
        maximized = true;
        controls.refresh();
        // No drag handle while this chart covers the grid — there is nowhere to move it.
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

    it('setSuspended(true) hides the cluster and blocks reveals (mobile mode)', () => {
        const host = makeHost();
        const controls = new CellControls(host as never, makeDeps());
        host.fire('pointermove', { clientX: 400, clientY: 554 });
        expect(cluster(host).style.display).toBe('flex');
        controls.setSuspended(true); // mode flip hides a revealed cluster immediately
        expect(cluster(host).style.display).toBe('none');
        host.fire('pointermove', { clientX: 400, clientY: 554 });
        expect(cluster(host).style.display).toBe('none'); // no reveal while suspended
        controls.setSuspended(false);
        host.fire('pointermove', { clientX: 400, clientY: 554 });
        expect(cluster(host).style.display).toBe('flex'); // back to desktop behavior
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
        cluster(host).children[3]!.fire('click');
        expect(toggleMaximize).toHaveBeenCalledTimes(1);
        cluster(host).children[4]!.fire('click');
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('the drag handle previews the hovered cell and commits the drop on release', () => {
        const host = makeHost();
        let over: string | null = null;
        const previewDrop = vi.fn();
        const dropOn = vi.fn();
        new CellControls(host as never, makeDeps({ dragTargetAt: () => over, previewDrop, dropOn }));
        const grip = cluster(host).children[0]!;
        expect(grip.title).toBe('Drag to move chart');
        grip.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1 });
        over = 'eth';
        grip.fire('pointermove', { clientX: 500, clientY: 100 });
        expect(previewDrop).toHaveBeenLastCalledWith('eth');
        grip.fire('pointerup');
        expect(previewDrop).toHaveBeenLastCalledWith(null); // highlight cleared before the commit
        expect(dropOn).toHaveBeenCalledWith('eth');
        expect(dropOn).toHaveBeenCalledTimes(1);
    });

    it('releasing over nothing (or a cancel) commits no move', () => {
        const host = makeHost();
        const dropOn = vi.fn();
        const previewDrop = vi.fn();
        new CellControls(host as never, makeDeps({ dragTargetAt: () => null, previewDrop, dropOn }));
        const grip = cluster(host).children[0]!;
        grip.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1 });
        grip.fire('pointermove', { clientX: 10, clientY: 10 });
        grip.fire('pointerup');
        grip.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 2 });
        grip.fire('pointercancel');
        expect(dropOn).not.toHaveBeenCalled();
        expect(previewDrop).toHaveBeenLastCalledWith(null);
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
        cluster(host).children[2]!.fire('click'); // zoom in
        const last = applied[applied.length - 1]!;
        expect(last.to).toBe(1_000_000); // right edge anchored
        expect(last.from).toBeCloseTo(200_000, -3); // span × 0.8
    });
});
