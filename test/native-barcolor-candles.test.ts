import { describe, it, expect } from 'vitest';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';

/**
 * barcolor() recolors only the candle BODY (TV semantics): the wick and a forced
 * border keep the direction (up/down) color so the tint stays readable. These
 * tests drive the canvas2d backend with a recording 2d context and assert which
 * colors each candle part is painted with.
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

/** One-candle scene (up candle by default), optionally barcolored. */
function paint(barColor?: string, bar = { time: 0, open: 100, high: 106, low: 99, close: 105 }): Array<{ op: string; style: string }> {
    const backend = new Canvas2dBackend();
    const { ctx, ops } = recordingCtx();
    const canvas = { width: 300, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
    backend.mount(canvas);

    const scene = new SceneGraph();
    scene.bars = [bar];
    scene.showGrid = false; // isolate the candle ops
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 100 };
    pane.scale = { min: 95, max: 110 };
    if (barColor !== undefined) {
        const model = {
            id: 'ind', title: 'I', overlay: true, paneId: 'price',
            series: [], fills: [], backgrounds: [], priceLines: [],
            barColors: [{ time: bar.time, color: barColor }],
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

describe('canvas2d candles — barcolor() body tint keeps direction wick + border', () => {
    it('plain candle: body + wick in the direction color, no border (borders default off)', () => {
        const ops = paint();
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick
            { op: 'fill', style: THEME.upColor }, // body
        ]);
    });

    it('barcolored candle: tinted body, wick AND forced border stay the direction color', () => {
        const ops = paint('#123456');
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.upColor }, // wick — NOT the barcolor
            { op: 'fill', style: '#123456' }, // body — the barcolor
            { op: 'stroke', style: THEME.upColor }, // border — forced by the barcolor
        ]);
    });

    it('barcolored down candle keeps the down direction color for wick + border', () => {
        const ops = paint('#123456', { time: 0, open: 105, high: 106, low: 99, close: 100 });
        expect(ops).toEqual([
            { op: 'stroke', style: THEME.downColor },
            { op: 'fill', style: '#123456' },
            { op: 'stroke', style: THEME.downColor },
        ]);
    });

    it('configured border colors win over the direction fallback on barcolored candles', () => {
        const backend = new Canvas2dBackend();
        const { ctx, ops } = recordingCtx();
        const canvas = { width: 300, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
        backend.mount(canvas);
        const scene = new SceneGraph();
        scene.bars = [{ time: 0, open: 100, high: 106, low: 99, close: 105 }];
        scene.showGrid = false;
        scene.style.candle.borderUpColor = '#ABCDEF';
        const pane = scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 100 };
        pane.scale = { min: 95, max: 110 };
        const model = {
            id: 'ind', title: 'I', overlay: true, paneId: 'price',
            series: [], fills: [], backgrounds: [], priceLines: [],
            barColors: [{ time: 0, color: '#123456' }],
            inputs: [], inputValues: {},
        } as unknown as IndicatorModel;
        scene.indicators.set(model.id, model);
        scene.assignIndicatorZ(model.id);
        const coords = new CoordinateSystem();
        coords.setSize(300, 100, 1);
        coords.setBars([0]);
        backend.render(scene, coords, THEME);
        expect(ops[ops.length - 1]).toEqual({ op: 'stroke', style: '#ABCDEF' }); // border honors the configured color
    });
});
