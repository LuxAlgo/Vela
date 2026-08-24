import { describe, it, expect } from 'vitest';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';

/**
 * barcolor() recolors only the candle BODY (TV semantics): the wick keeps the
 * direction (up/down) color. The border strictly follows the border-visibility
 * setting — a barcolor never forces one — and when visible with no explicit
 * border color configured it inherits the body color (so a tinted body gets a
 * matching tinted border, not a direction-colored outline). These tests drive
 * the canvas2d backend with a recording 2d context and assert which colors each
 * candle part is painted with.
 */

const THEME: VelaTheme = {
    background: '#000000',
    textColor: '#cccccc',
    gridColor: '#222222',
    borderColor: '#333333',
    upColor: '#00AA00',
    downColor: '#AA0000',
    fontFamily: 'sans-serif',
};

/** A minimal recording CanvasRenderingContext2D: paint ops + the style they used. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; ops: Array<{ op: string; style: string }> } {
    const ops: Array<{ op: string; style: string }> = [];
    const state = { fillStyle: '', strokeStyle: '' };
    const noop = (): void => undefined;
    const ctx = {
        set fillStyle(v: string) { state.fillStyle = v; },
        get fillStyle() { return state.fillStyle; },
        set strokeStyle(v: string) { state.strokeStyle = v; },
        get strokeStyle() { return state.strokeStyle; },
        globalAlpha: 1,
        lineWidth: 1,
        lineJoin: 'miter',
        lineCap: 'butt',
        setTransform: noop, clearRect: noop, save: noop, restore: noop,
        beginPath: noop, closePath: noop, rect: noop, clip: noop,
        moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, setLineDash: noop,
        fill: () => ops.push({ op: 'fill', style: state.fillStyle }),
        stroke: () => ops.push({ op: 'stroke', style: state.strokeStyle }),
        fillRect: () => ops.push({ op: 'fill', style: state.fillStyle }),
        strokeRect: () => ops.push({ op: 'stroke', style: state.strokeStyle }),
        createLinearGradient: () => ({ addColorStop: noop }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, ops };
}

interface PaintOptions {
    barColor?: string;
    bar?: { time: number; open: number; high: number; low: number; close: number };
    borderVisible?: boolean;
    borderUpColor?: string;
}

/** One-candle scene (up candle by default), optionally barcolored / bordered. */
function paint(opts: PaintOptions = {}): Array<{ op: string; style: string }> {
    const bar = opts.bar ?? { time: 0, open: 100, high: 106, low: 99, close: 105 };
    const backend = new Canvas2dBackend();
    const { ctx, ops } = recordingCtx();
    const canvas = { width: 300, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
    backend.mount(canvas);

    const scene = new SceneGraph();
    scene.bars = [bar];
    scene.showGrid = false; // isolate the candle ops
    if (opts.borderVisible !== undefined) scene.style.candle.borderVisible = opts.borderVisible;
    if (opts.borderUpColor !== undefined) scene.style.candle.borderUpColor = opts.borderUpColor;
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 100 };
    pane.scale = { min: 95, max: 110 };
    if (opts.barColor !== undefined) {
        const model = {
            id: 'ind', title: 'I', overlay: true, paneId: 'price',
            series: [], fills: [], backgrounds: [], priceLines: [],
            barColors: [{ time: bar.time, color: opts.barColor }],
            inputs: [], inputValues: {},
        } as unknown as IndicatorModel;
        scene.indicators.set(model.id, model);
        scene.assignIndicatorZ(model.id);
    }

    const coords = new CoordinateSystem();
    coords.setSize(300, 100, 1);
    coords.setBars([bar.time]);
    backend.render(scene, coords, THEME);
    return ops;
}

describe('canvas2d candles — barcolor() tints the body, the border follows its setting', () => {
    it('plain candle: body + wick in the direction color, no border (borders default off)', () => {
        const ops = paint();
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick
            { op: 'fill', style: THEME.upColor }, // body
        ]);
    });

    it('barcolored candle with borders off: tinted body, direction wick, NO border', () => {
        const ops = paint({ barColor: '#123456' });
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick — NOT the barcolor
            { op: 'fill', style: '#123456' }, // body — the barcolor
        ]);
    });

    it('barcolored down candle with borders off: tinted body, down-direction wick, NO border', () => {
        const ops = paint({ barColor: '#123456', bar: { time: 0, open: 105, high: 106, low: 99, close: 100 } });
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.downColor },
            { op: 'fill', style: '#123456' },
        ]);
    });

    it('plain candle with borders on: border falls back to the direction color', () => {
        const ops = paint({ borderVisible: true });
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick
            { op: 'fill', style: THEME.upColor }, // body
            { op: 'stroke', style: THEME.upColor }, // border
        ]);
    });

    it('barcolored candle with borders on: the unconfigured border inherits the barcolored body', () => {
        const ops = paint({ barColor: '#123456', borderVisible: true });
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick — direction color
            { op: 'fill', style: '#123456' }, // body — the barcolor
            { op: 'stroke', style: '#123456' }, // border — inherits the body (barcolor)
        ]);
    });

    it('configured border colors win over the body-inherit fallback on barcolored candles', () => {
        const ops = paint({ barColor: '#123456', borderVisible: true, borderUpColor: '#ABCDEF' });
        expect(ops[ops.length - 1]).toEqual({ op: 'stroke', style: '#ABCDEF' }); // border honors the configured color
    });
});
