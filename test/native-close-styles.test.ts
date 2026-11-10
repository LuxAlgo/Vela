import { describe, it, expect, vi } from 'vitest';

// The WebGL2 backend resolves colors through a 1×1 canvas read-back, which node has no
// canvas for: parse the two notations these tests use (`#rrggbb`, `rgba(r,g,b,a)`) instead.
vi.mock('../src/renderers/native/backend/gl/color', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/renderers/native/backend/gl/color')>();
    const parseColor = (css: string | null | undefined): [number, number, number, number] => {
        const s = (css ?? '').trim();
        const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
        if (hex) return [parseInt(hex[1]!, 16) / 255, parseInt(hex[2]!, 16) / 255, parseInt(hex[3]!, 16) / 255, 1];
        const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)$/i.exec(s);
        if (rgba) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, rgba[4] === undefined ? 1 : Number(rgba[4])];
        return [0, 0, 0, 1];
    };
    return { ...real, parseColor };
});

import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { WebGL2Backend } from '../src/renderers/native/backend/WebGL2Backend';
import { Batch } from '../src/renderers/native/backend/gl/Batch';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { columnIsUp, columnGeometry, lineMarkerRadius, lineMarkersVisible, snapStroke, stepVertices, closeRuns } from '../src/renderers/native/backend/close-styles';
import { COLUMNS_FILL_ALPHA, followThemeColors, mergeConfig, withAlpha } from '../src/renderers/native/core/chartConfig';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';

/**
 * The close-only price styles: line with markers, step line, and columns. The pure
 * geometry and paint rules first, then both backends painting a known series, then the
 * config document that persists the styles and the columns' colors.
 */

const THEME: VelaTheme = {
    background: '#000000',
    textColor: '#cccccc',
    gridColor: '#222222',
    borderColor: '#333333',
    upColor: '#00aa00',
    downColor: '#aa0000',
    fontFamily: 'sans-serif',
};
const UP = withAlpha(THEME.upColor, COLUMNS_FILL_ALPHA);
const DOWN = withAlpha(THEME.downColor, COLUMNS_FILL_ALPHA);
const LINE = '#123456';

/** Rise, fall, an unchanged value right after the fall, then a rise. */
const CLOSES = [10, 12, 11, 11, 13];
const bar = (time: number, close: number): OHLCV => ({ time, open: close, high: close, low: close, close });
const BARS: OHLCV[] = CLOSES.map((c, i) => bar(i * 60_000, c));

describe('close styles: paint rules', () => {
    it('a column is up when its close is at or above the previous close; the first bar is up', () => {
        expect(CLOSES.map((_, i) => columnIsUp(BARS, i))).toEqual([true, true, false, true, true]);
        // An unchanged value stays up even right after a fall; the open never decides.
        expect(columnIsUp([bar(0, 5), bar(1, 4), bar(2, 4)], 2)).toBe(true);
        expect(columnIsUp([bar(0, 5), { time: 1, open: 9, high: 9, low: 1, close: 6 }], 1)).toBe(true);
        expect(columnIsUp([{ time: 0, open: 9, high: 9, low: 1, close: 1 }], 0)).toBe(true);
    });

    it('markers are 8 px across on the default 2 px line and show only where bars have room', () => {
        const r = lineMarkerRadius(2);
        expect(r * 2).toBe(8);
        expect(lineMarkersVisible(6, r)).toBe(false); // a dense view: the plain line
        expect(lineMarkersVisible(9.9, r)).toBe(false);
        expect(lineMarkersVisible(10, r)).toBe(true); // an 8 px dot + 2 px of line between dots
        expect(lineMarkersVisible(13, r)).toBe(true);
        expect(lineMarkerRadius(4)).toBeGreaterThan(r); // a heavier line keeps a dot that reads
    });

    it('columns fill their slot less a 1 px gap, uniform across neighbours; tight zooms tile', () => {
        const spacing = 10.6;
        const slots = [0, 1, 2, 3, 4].map((i) => columnGeometry(100 + i * spacing, spacing, 1));
        for (let i = 1; i < slots.length; i += 1) {
            const prev = slots[i - 1]!;
            expect(slots[i]!.left - (prev.left + prev.width)).toBe(1);
        }
        for (const s of slots) expect([9, 10]).toContain(s.width);
        // Below the candle-body spacing the gap would eat a third of the slot: no gap.
        const a = columnGeometry(50, 2, 1);
        const b = columnGeometry(52, 2, 1);
        expect(b.left).toBe(a.left + a.width);
        // On a 2× screen the gap is two device pixels, one on each side.
        expect(columnGeometry(50, 10, 2)).toEqual({ left: 45.5, width: 9 });
    });

    it('the step line holds each close to the next bar, then steps vertically', () => {
        const pts = [
            { x: 0, y: 50 },
            { x: 10, y: 40 },
            { x: 20, y: 40 },
            { x: 30, y: 45 },
        ];
        expect(stepVertices(pts)).toEqual([
            { x: 0, y: 50 },
            { x: 10, y: 50 },
            { x: 10, y: 40 },
            { x: 20, y: 40 }, // unchanged close: no vertical step
            { x: 30, y: 40 },
            { x: 30, y: 45 },
        ]);
        // A hole in the series ends the run, as it breaks the line.
        expect(closeRuns(0, 3, (i) => (i === 1 ? null : { x: i, y: i }))).toEqual([[{ x: 0, y: 0 }], [{ x: 2, y: 2 }, { x: 3, y: 3 }]]);
    });

    it('snaps step-line strokes onto whole device pixels', () => {
        expect(snapStroke(10.3, 2, 1)).toBe(10); // 2 device px: centered on a pixel edge
        expect(snapStroke(10.3, 1, 1)).toBe(10.5); // 1 device px: on a pixel's middle
        expect(snapStroke(10.3, 2, 2)).toBe(10.5); // 4 device px: on an edge of the 2× grid
    });
});

// ── canvas2d ──

type Op =
    | { op: 'fillRect'; style: string; x: number; y: number; w: number; h: number }
    | { op: 'arc'; x: number; y: number; r: number }
    | { op: 'moveTo' | 'lineTo'; x: number; y: number }
    | { op: 'fill' | 'stroke'; style: string; lineWidth: number; lineCap: string; lineJoin: string };

function recordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
    const ops: Op[] = [];
    const st = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter' };
    const noop = (): void => undefined;
    const ctx = {
        set fillStyle(v: string) { st.fillStyle = v; },
        get fillStyle() { return st.fillStyle; },
        set strokeStyle(v: string) { st.strokeStyle = v; },
        get strokeStyle() { return st.strokeStyle; },
        set lineWidth(v: number) { st.lineWidth = v; },
        get lineWidth() { return st.lineWidth; },
        set lineCap(v: string) { st.lineCap = v; },
        get lineCap() { return st.lineCap; },
        set lineJoin(v: string) { st.lineJoin = v; },
        get lineJoin() { return st.lineJoin; },
        globalAlpha: 1,
        setTransform: noop, clearRect: noop, save: noop, restore: noop,
        beginPath: noop, closePath: noop, rect: noop, clip: noop, arcTo: noop, setLineDash: noop,
        moveTo: (x: number, y: number) => ops.push({ op: 'moveTo', x, y }),
        lineTo: (x: number, y: number) => ops.push({ op: 'lineTo', x, y }),
        arc: (x: number, y: number, r: number) => ops.push({ op: 'arc', x, y, r }),
        fill: () => ops.push({ op: 'fill', style: st.fillStyle, lineWidth: st.lineWidth, lineCap: st.lineCap, lineJoin: st.lineJoin }),
        stroke: () => ops.push({ op: 'stroke', style: st.strokeStyle, lineWidth: st.lineWidth, lineCap: st.lineCap, lineJoin: st.lineJoin }),
        fillRect: (x: number, y: number, w: number, h: number) => ops.push({ op: 'fillRect', style: st.fillStyle, x, y, w, h }),
        strokeRect: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, ops };
}

const PANE_H = 100;
/** A 300×100 price pane over 0..20 (y = 100 − 5·close); bars sit at x = 210 … 290. */
function sceneFor(style: string, spacing: number, barColor?: { time: number; color: string }): { scene: SceneGraph; coords: CoordinateSystem } {
    const scene = new SceneGraph();
    scene.bars = BARS;
    scene.priceStyle = style;
    scene.style.line.color = LINE;
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: PANE_H };
    pane.scale = { min: 0, max: 20 };
    if (barColor) {
        const model = {
            id: 'ind', title: 'I', overlay: true, paneId: 'price',
            series: [], fills: [], backgrounds: [], priceLines: [],
            barColors: [barColor],
            inputs: [], inputValues: {},
        } as unknown as IndicatorModel;
        scene.indicators.set(model.id, model);
        scene.assignIndicatorZ(model.id);
    }
    const coords = new CoordinateSystem();
    coords.setSize(300, PANE_H, 1);
    coords.setBars(BARS.map((b) => b.time));
    coords.setViewport({ barSpacing: spacing, rightOffset: 0.5 });
    return { scene, coords };
}

function paintCanvas(style: string, spacing = 20, barColor?: { time: number; color: string }): Op[] {
    const { scene, coords } = sceneFor(style, spacing, barColor);
    const backend = new Canvas2dBackend();
    const { ctx, ops } = recordingCtx();
    backend.mount({ width: 300, height: PANE_H, getContext: () => ctx } as unknown as HTMLCanvasElement);
    backend.render(scene, coords, THEME);
    return ops;
}

const yOf = (close: number): number => PANE_H - 5 * close;

describe('canvas2d: columns', () => {
    it('paint one column per bar from the pane bottom up to its close, colored against the previous close', () => {
        const cols = paintCanvas('columns').filter((o): o is Extract<Op, { op: 'fillRect' }> => o.op === 'fillRect');
        expect(cols.map((c) => c.style)).toEqual([UP, UP, DOWN, UP, UP]);
        expect(cols.map((c) => c.y)).toEqual(CLOSES.map(yOf));
        for (const c of cols) expect(c.y + c.h).toBe(PANE_H); // every column reaches the pane bottom
        // 20 px slots less a 1 px gap.
        expect(cols.map((c) => [c.x, c.w])).toEqual([[200, 19], [220, 19], [240, 19], [260, 19], [280, 19]]);
    });

    it('a barcolor() tints its column as it tints a candle body', () => {
        const cols = paintCanvas('columns', 20, { time: BARS[2]!.time, color: '#abcdef' }).filter((o) => o.op === 'fillRect') as Array<{ style: string }>;
        expect(cols.map((c) => c.style)).toEqual([UP, UP, '#abcdef', UP, UP]);
    });
});

describe('canvas2d: line with markers', () => {
    it('draws the line plus one marker per bar at its close, in the line color', () => {
        const ops = paintCanvas('linemarkers', 20);
        const arcs = ops.filter((o): o is Extract<Op, { op: 'arc' }> => o.op === 'arc');
        expect(arcs.map((a) => [a.x, Math.round(a.y * 1e6) / 1e6])).toEqual(CLOSES.map((c, i) => [210 + 20 * i, yOf(c)]));
        expect(arcs.every((a) => a.r === 4)).toBe(true);
        expect(ops.filter((o) => o.op === 'stroke').map((o) => (o as { style: string }).style)).toEqual([LINE]);
        expect(ops.filter((o) => o.op === 'fill').map((o) => (o as { style: string }).style)).toEqual([LINE]);
    });

    it('leaves the plain line when bars are too dense for the markers to read', () => {
        const ops = paintCanvas('linemarkers', 6);
        expect(ops.some((o) => o.op === 'arc')).toBe(false);
        expect(ops.filter((o) => o.op === 'stroke')).toHaveLength(1);
    });

    it('the plain line style never draws markers', () => {
        expect(paintCanvas('line', 20).some((o) => o.op === 'arc')).toBe(false);
    });
});

describe('canvas2d: step line', () => {
    it('strokes horizontal-then-vertical runs through every close, square-cornered', () => {
        const ops = paintCanvas('stepline', 20);
        const path = ops.filter((o): o is Extract<Op, { op: 'moveTo' | 'lineTo' }> => o.op === 'moveTo' || o.op === 'lineTo').map((o) => [o.x, o.y]);
        // The unchanged close (bar 3) adds no step.
        expect(path).toEqual([
            [210, 50],
            [230, 50], [230, 40],
            [250, 40], [250, 45],
            [270, 45],
            [290, 45], [290, 35],
        ]);
        const stroke = ops.find((o) => o.op === 'stroke');
        expect(stroke).toEqual({ op: 'stroke', style: LINE, lineWidth: 2, lineCap: 'square', lineJoin: 'miter' });
    });
});

// ── WebGL2 (the emitted geometry) ──

interface Box {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    rgba: number[];
}

/** The batch's quads (6 vertices each) as bounding boxes + color. */
function quads(b: Batch): Box[] {
    const v = b.view;
    const out: Box[] = [];
    for (let q = 0; q + 48 <= v.length; q += 48) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < 6; k += 1) {
            xs.push(v[q + k * 8]!);
            ys.push(v[q + k * 8 + 1]!);
        }
        out.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), rgba: [...v.subarray(q + 2, q + 6)].map((c) => Math.round(c * 1000) / 1000) });
    }
    return out;
}

function emitGl(style: string, spacing = 20): Batch {
    const { scene, coords } = sceneFor(style, spacing);
    const backend = new WebGL2Backend() as unknown as {
        emitPriceSeries(b: Batch, scene: SceneGraph, i0: number, i1: number, coords: CoordinateSystem, pane: unknown, theme: VelaTheme, barColors: ReadonlyMap<number, string>, dataW: number): void;
    };
    const b = new Batch();
    backend.emitPriceSeries(b, scene, 0, BARS.length - 1, coords, scene.panes.get('price'), THEME, new Map(), 300);
    return b;
}

describe('webgl2: the same geometry', () => {
    it('columns: one rect per bar down to the pane bottom, in the same slots and colors as canvas2d', () => {
        const rects = quads(emitGl('columns'));
        const up = [0, 0.667, 0, 0.5];
        const down = [0.667, 0, 0, 0.5];
        expect(rects.map((r) => r.rgba)).toEqual([up, up, down, up, up]);
        expect(rects.map((r) => r.minY)).toEqual(CLOSES.map(yOf));
        for (const r of rects) expect(r.maxY).toBe(PANE_H);
        expect(rects.map((r) => [r.minX, r.maxX])).toEqual([[200, 219], [220, 239], [240, 259], [260, 279], [280, 299]]);
    });

    it('line with markers: a filled dot per bar when spaced, none when dense', () => {
        // A dot is a triangle fan whose center vertices carry edge distance 0 and half-width = its radius.
        const dots = (b: Batch): number => {
            const v = b.view;
            const centers = new Set<string>();
            for (let k = 0; k < v.length; k += 8) if (v[k + 6] === 0 && v[k + 7] === lineMarkerRadius(2)) centers.add(`${v[k]},${v[k + 1]}`);
            return centers.size;
        };
        expect(dots(emitGl('linemarkers', 20))).toBe(5);
        expect(dots(emitGl('linemarkers', 6))).toBe(0);
        expect(dots(emitGl('line', 20))).toBe(0);
    });

    it('step line: axis-aligned rects that cover the steps without overlapping', () => {
        const rects = quads(emitGl('stepline'));
        // Half-width 1: the first run is capped at its start, each rect owns the corner at its end.
        expect(rects.map((r) => [r.minX, r.maxX, r.minY, r.maxY])).toEqual([
            [209, 231, 49, 51], // 210 → 230 at y 50
            [229, 231, 39, 49], // up to 40
            [231, 251, 39, 41], // 230 → 250 at y 40
            [249, 251, 41, 46], // down to 45
            [251, 271, 44, 46], // 250 → 270 at y 45
            [271, 291, 44, 46], // 270 → 290 (unchanged close)
            [289, 291, 34, 44], // up to 35, square end cap
        ]);
        // No two rects share area: a translucent line keeps one tone through its corners.
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i]!;
                const c = rects[j]!;
                const area = Math.max(0, Math.min(a.maxX, c.maxX) - Math.max(a.minX, c.minX)) * Math.max(0, Math.min(a.maxY, c.maxY) - Math.max(a.minY, c.minY));
                expect(area, `rects ${i} and ${j} overlap`).toBe(0);
            }
        }
    });
});

// ── the config document and the renderer reads ──

function unmountedRenderer(): { r: NativeRenderer; anyR: Record<string, any> } {
    const r = new NativeRenderer();
    const anyR = r as unknown as Record<string, any>;
    anyR.coords.setSize(800, 200, 1);
    anyR.scheduler ??= { invalidate: () => {} };
    anyR.animator ??= { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    return { r, anyR };
}

describe('config: the styles persist and the columns keep their own colors', () => {
    it('the renderer accepts the three styles and the config round-trips them', () => {
        for (const style of ['linemarkers', 'stepline', 'columns']) {
            const r = new NativeRenderer();
            r.applyConfig({ series: { style } });
            expect(r.getConfig().series.style).toBe(style);
            const restored = new NativeRenderer();
            restored.applyConfig(JSON.parse(JSON.stringify(r.getConfig())));
            expect(restored.readFeature('priceStyle')).toBe(style);
        }
    });

    it("columns default to the chart's up/down at half opacity and take their own colors", () => {
        const r = new NativeRenderer();
        const cfg = r.getConfig();
        expect(cfg.columns.upColor).toBe(withAlpha(cfg.candles.upColor, COLUMNS_FILL_ALPHA));
        expect(cfg.columns.downColor).toBe(withAlpha(cfg.candles.downColor, COLUMNS_FILL_ALPHA));
        r.applyConfig({ columns: { upColor: '#010203', downColor: 7 } });
        expect(r.getConfig().columns.upColor).toBe('#010203');
        expect(r.getConfig().columns.downColor).toBe(cfg.columns.downColor); // malformed: dropped
        expect(mergeConfig(cfg, { columns: { downColor: '#040506' } }).columns).toEqual({ upColor: cfg.columns.upColor, downColor: '#040506' });
    });

    it("a theme switch moves the columns' default washes to the next theme's colors", () => {
        const doc = new NativeRenderer().getConfig();
        const prev = { upColor: doc.candles.upColor, downColor: doc.candles.downColor };
        const next = { upColor: '#0000ff', downColor: '#ffff00' };
        expect(followThemeColors(doc, prev, next).columns).toEqual({ upColor: withAlpha('#0000ff', COLUMNS_FILL_ALPHA), downColor: withAlpha('#ffff00', COLUMNS_FILL_ALPHA) });
        // A color the user chose stays.
        expect(followThemeColors({ ...doc, columns: { ...doc.columns, upColor: '#abcdef' } }, prev, next).columns.upColor).toBe('#abcdef');
    });

    it('previousClose reads the close before the bar the readouts show', () => {
        const { r, anyR } = unmountedRenderer();
        r.setBars(BARS);
        expect(r.readFeature('previousClose')).toBe(11); // the latest bar's previous close
        anyR.hoverLogical = 2; // the crosshair on bar 2
        expect(r.readFeature('previousClose')).toBe(12);
        anyR.hoverLogical = 0;
        expect(r.readFeature('previousClose')).toBeNull(); // the first bar has none
    });
});
