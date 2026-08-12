import { describe, it, expect } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';

// ── pane separators are STRUCTURAL chrome: they must survive a chrome frame while a
// market switch has the series cleared (barCount 0), or the stacked panes read as one
// undivided plot for the whole load ──

/** A recording 2d-context stand-in — just enough surface for the empty-bars path. */
function fakeCanvas(width: number, height: number) {
    const fills: Array<[number, number, number, number]> = [];
    const ctx = {
        setTransform() {},
        clearRect() {},
        fillRect(x: number, y: number, w: number, h: number) {
            fills.push([x, y, w, h]);
        },
        font: '',
        textBaseline: '',
        fillStyle: '',
    };
    return { canvas: { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement, fills };
}

function scene(): SceneGraph {
    const s = new SceneGraph();
    s.ensurePane('price', 'price', 0, 3);
    const study = s.ensurePane('pane-x', 'study', 1, 1);
    study.bounds = { top: 300, height: 100 };
    return s;
}

describe('chrome pane separators', () => {
    it('draws each stacked pane separator even while the series is empty (loading)', () => {
        const { canvas, fills } = fakeCanvas(800, 400);
        const coords = new CoordinateSystem();
        coords.setSize(800, 400, 1); // no bars set → barCount 0, the market-switch load state
        const chrome = new ChromeRenderer();
        chrome.mount(canvas);
        chrome.render(scene(), coords, DARK_THEME);
        // The study pane's divider: full width at its top edge (top - 1, 3px thick).
        expect(fills).toContainEqual([0, 299, 800, 3]);
    });

    it('never draws a separator above the price pane', () => {
        const { canvas, fills } = fakeCanvas(800, 400);
        const coords = new CoordinateSystem();
        coords.setSize(800, 400, 1);
        const s = new SceneGraph();
        s.ensurePane('price', 'price', 0, 3); // lone price pane → no dividers at all
        const chrome = new ChromeRenderer();
        chrome.mount(canvas);
        chrome.render(s, coords, DARK_THEME);
        expect(fills.filter(([, , , h]) => h === 3)).toEqual([]);
    });
});
