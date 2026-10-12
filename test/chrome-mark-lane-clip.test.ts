// The timeline-mark lane paints inside the plot's data area: a mark whose bar sits at the
// right plot edge (panned into history, or a narrow chart) is cut at the price scale like the
// candles beside it, never drawn over the scale's labels.
import { describe, it, expect } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import { MARK_GLYPH_PX } from '../src/renderers/native/chrome/marks/layout';

const W = 300; // data width — the price scale starts here
const H = 400; // data height — the time-axis line
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;
const N = 60;

interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** A 2d context that tracks the active clip region (rect clips, save/restore) and records every arc with the clip it was drawn under. */
function clipRecorder() {
    let clip: Rect | null = null;
    let path: Rect | null = null;
    const stack: Array<Rect | null> = [];
    const arcs: Array<{ x: number; y: number; r: number; clip: Rect | null }> = [];
    const noop = (): void => {};
    const ctx = {
        font: '',
        textBaseline: '',
        textAlign: '',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        setTransform: noop,
        clearRect: noop,
        fillRect: noop,
        setLineDash: noop,
        translate: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        fill: noop,
        closePath: noop,
        quadraticCurveTo: noop,
        fillText: noop,
        drawImage: noop,
        measureText: (t: string) => ({ width: t.length * 6 }),
        save() {
            stack.push(clip);
        },
        restore() {
            clip = stack.pop() ?? null;
        },
        beginPath() {
            path = null;
        },
        rect(x: number, y: number, w: number, h: number) {
            path = { x0: x, y0: y, x1: x + w, y1: y + h };
        },
        clip() {
            if (!path) return;
            clip = clip ? { x0: Math.max(clip.x0, path.x0), y0: Math.max(clip.y0, path.y0), x1: Math.min(clip.x1, path.x1), y1: Math.min(clip.y1, path.y1) } : path;
        },
        arc(x: number, y: number, r: number) {
            arcs.push({ x, y, r, clip });
        },
    };
    const canvas = { width: W + 64, height: H + 22, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { canvas, arcs };
}

function paint(markBar: number) {
    const times = Array.from({ length: N }, (_, i) => T0 + i * HOUR);
    const coords = new CoordinateSystem();
    coords.setSize(W, H, 1);
    coords.setBars(times);
    coords.setViewport({ barSpacing: 10, rightOffset: 0 }); // the newest bar's center sits on the plot's right edge
    const s = new SceneGraph();
    const price = s.ensurePane('price', 'price', 0, 3);
    price.bounds = { top: 0, height: H };
    price.scale = { min: 100, max: 200 };
    s.bars = times.map((time) => ({ time, open: 150, high: 160, low: 140, close: 155, volume: 1 }));
    s.showPriceLabel = false; // the price chip resolves colors through a real canvas
    s.showCountdown = false;
    s.timelineMarks = [{ id: 'edge', time: times[markBar]!, glyph: { color: '#ff00ff', letter: 'E' } }];
    const { canvas, arcs } = clipRecorder();
    const chrome = new ChromeRenderer();
    chrome.mount(canvas);
    chrome.render(s, coords, DARK_THEME);
    return { arcs, x: coords.logicalToX(markBar) };
}

describe('timeline-mark lane clipping', () => {
    it('a glyph on the bar at the right plot edge is cut at the price scale', () => {
        const { arcs, x } = paint(N - 1);
        expect(x).toBe(W);
        const glyph = arcs.find((a) => a.x === x && a.r === MARK_GLYPH_PX / 2);
        expect(glyph).toBeDefined(); // the mark still paints — half of it shows
        expect(glyph!.clip).not.toBeNull();
        expect(glyph!.clip!.x1).toBeLessThanOrEqual(W);
    });

    it('the clip keeps the whole lane height — a glyph inside the plot is never cut vertically', () => {
        const { arcs, x } = paint(N - 10);
        const glyph = arcs.find((a) => a.x === x && a.r === MARK_GLYPH_PX / 2)!;
        expect(glyph.clip!.y0).toBeLessThanOrEqual(glyph.y - glyph.r);
        expect(glyph.clip!.y1).toBeGreaterThanOrEqual(glyph.y + glyph.r);
        expect(glyph.clip!.x0).toBeLessThanOrEqual(x - glyph.r);
        expect(glyph.clip!.x1).toBeGreaterThanOrEqual(x + glyph.r);
    });
});
