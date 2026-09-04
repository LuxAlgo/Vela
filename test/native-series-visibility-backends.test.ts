import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { WebGL2Backend } from '../src/renderers/native/backend/WebGL2Backend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';

const WIDTH = 320;
const HEIGHT = 180;
const BASE_COLOR = '#ff0000';
const OVERLAY_COLOR = '#00ff00';
const PRICE_LINE_COLOR = '#0000ff';
const VERTEX_STRIDE = 8;

const THEME: VelaTheme = {
    background: '#000000',
    textColor: '#ffffff',
    gridColor: '#222222',
    borderColor: '#333333',
    upColor: BASE_COLOR,
    downColor: '#aa0000',
    fontFamily: 'sans-serif',
};

function makeScene(hidden: boolean): { scene: SceneGraph; coords: CoordinateSystem } {
    const bars = [
        { time: 0, open: 100, high: 108, low: 98, close: 105 },
        { time: 60_000, open: 105, high: 112, low: 103, close: 110 },
        { time: 120_000, open: 110, high: 116, low: 107, close: 114 },
    ];
    const scene = new SceneGraph();
    scene.bars = bars;
    scene.candlesHidden = hidden;
    scene.showGrid = false;
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: HEIGHT };
    pane.scale = { min: 90, max: 120 };

    const overlay: IndicatorModel = {
        id: 'overlay',
        title: 'Overlay',
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [{
            id: 'overlay:line',
            title: 'Overlay line',
            paneId: 'price',
            kind: 'line',
            points: bars.map((bar, i) => ({ time: bar.time, value: 101 + i })),
            style: { color: OVERLAY_COLOR, width: 2, lineStyle: 'solid' },
        }],
        fills: [],
        backgrounds: [],
        priceLines: [{ id: 'overlay:hline', paneId: 'price', price: 106, color: PRICE_LINE_COLOR }],
        inputs: [],
        inputValues: {},
    };
    scene.indicators.set(overlay.id, overlay);
    scene.assignIndicatorZ(overlay.id);

    const coords = new CoordinateSystem();
    coords.setSize(WIDTH, HEIGHT, 1);
    coords.setBars(bars.map((bar) => bar.time));
    coords.setViewport({ barSpacing: 20, rightOffset: 2 });
    return { scene, coords };
}

interface CanvasPaint {
    color: string;
    kind: 'fill' | 'stroke';
}

function canvasPaints(hidden: boolean): CanvasPaint[] {
    const paints: CanvasPaint[] = [];
    const state = { fillStyle: '', strokeStyle: '' };
    const noop = (): void => undefined;
    const ctx = {
        set fillStyle(value: string) { state.fillStyle = value; },
        get fillStyle() { return state.fillStyle; },
        set strokeStyle(value: string) { state.strokeStyle = value; },
        get strokeStyle() { return state.strokeStyle; },
        globalAlpha: 1,
        lineWidth: 1,
        lineJoin: 'miter',
        lineCap: 'butt',
        setTransform: noop,
        clearRect: noop,
        save: noop,
        restore: noop,
        beginPath: noop,
        closePath: noop,
        rect: noop,
        clip: noop,
        moveTo: noop,
        lineTo: noop,
        arcTo: noop,
        arc: noop,
        setLineDash: noop,
        drawImage: noop,
        fill: () => paints.push({ kind: 'fill', color: state.fillStyle }),
        stroke: () => paints.push({ kind: 'stroke', color: state.strokeStyle }),
        fillRect: () => paints.push({ kind: 'fill', color: state.fillStyle }),
        strokeRect: () => paints.push({ kind: 'stroke', color: state.strokeStyle }),
        createLinearGradient: () => ({ addColorStop: noop }),
    } as unknown as CanvasRenderingContext2D;
    const canvas = { width: WIDTH, height: HEIGHT, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const backend = new Canvas2dBackend();
    backend.mount(canvas);
    const { scene, coords } = makeScene(hidden);
    backend.render(scene, coords, THEME);
    return paints;
}

interface GlCapture {
    buffers: Float32Array[];
    draws: number[];
}

function webGlPaints(hidden: boolean): GlCapture {
    const capture: GlCapture = { buffers: [], draws: [] };
    const noop = (): void => undefined;
    const gl = {
        BLEND: 1,
        SCISSOR_TEST: 2,
        COLOR_BUFFER_BIT: 4,
        SRC_ALPHA: 5,
        ONE_MINUS_SRC_ALPHA: 6,
        ONE: 7,
        ARRAY_BUFFER: 8,
        DYNAMIC_DRAW: 9,
        TRIANGLES: 10,
        isContextLost: () => false,
        viewport: noop,
        disable: noop,
        clearColor: noop,
        clear: noop,
        enable: noop,
        scissor: noop,
        blendFuncSeparate: noop,
        useProgram: noop,
        bindVertexArray: noop,
        uniform2f: noop,
        bindBuffer: noop,
        bufferData: (_target: number, data: Float32Array) => capture.buffers.push(data.slice()),
        drawArrays: (_mode: number, _first: number, count: number) => capture.draws.push(count),
        deleteTexture: noop,
    } as unknown as WebGL2RenderingContext;
    const canvas = { width: WIDTH, height: HEIGHT } as HTMLCanvasElement;
    const backend = new WebGL2Backend();
    Object.assign(backend as unknown as Record<string, unknown>, {
        canvas,
        gl,
        program: {},
        vao: {},
        vbo: {},
        uRes: {},
    });
    const { scene, coords } = makeScene(hidden);
    backend.render(scene, coords, THEME);
    return capture;
}

function glHasColor(capture: GlCapture, [r, g, b]: readonly [number, number, number]): boolean {
    return capture.buffers.some((buffer) => {
        for (let i = 0; i < buffer.length; i += VERTEX_STRIDE) {
            if (
                Math.abs(buffer[i + 2]! - r) < 1e-6
                && Math.abs(buffer[i + 3]! - g) < 1e-6
                && Math.abs(buffer[i + 4]! - b) < 1e-6
            ) return true;
        }
        return false;
    });
}

describe('native backend base-series visibility', () => {
    beforeAll(() => {
        // WebGL color normalization uses one 2D readback pixel. Keep this backend test
        // browser-free while preserving exact RGB evidence in the captured GL vertices.
        const state = { fillStyle: '#000000' };
        const probe = {
            clearRect: (): void => undefined,
            fillRect: (): void => undefined,
            set fillStyle(value: string) { state.fillStyle = value; },
            get fillStyle() { return state.fillStyle; },
            getImageData: () => {
                const hex = state.fillStyle.match(/^#([0-9a-f]{6})$/i)?.[1] ?? '000000';
                return { data: new Uint8ClampedArray([
                    Number.parseInt(hex.slice(0, 2), 16),
                    Number.parseInt(hex.slice(2, 4), 16),
                    Number.parseInt(hex.slice(4, 6), 16),
                    255,
                ]) };
            },
        };
        vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => probe }) });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('Canvas2D suppresses candle paint while preserving an indicator overlay and price line', () => {
        const visible = canvasPaints(false);
        expect(visible.some((paint) => paint.color === BASE_COLOR)).toBe(true);
        expect(visible.some((paint) => paint.color === OVERLAY_COLOR)).toBe(true);
        expect(visible.some((paint) => paint.color === PRICE_LINE_COLOR)).toBe(true);

        const hidden = canvasPaints(true);
        expect(hidden.some((paint) => paint.color === BASE_COLOR)).toBe(false);
        expect(hidden.some((paint) => paint.color === OVERLAY_COLOR)).toBe(true);
        expect(hidden.some((paint) => paint.color === PRICE_LINE_COLOR)).toBe(true);
    });

    it('WebGL2 suppresses candle vertices while preserving overlay and price-line vertices', () => {
        const visible = webGlPaints(false);
        expect(visible.draws.some((count) => count > 0)).toBe(true);
        expect(glHasColor(visible, [1, 0, 0])).toBe(true);
        expect(glHasColor(visible, [0, 1, 0])).toBe(true);
        expect(glHasColor(visible, [0, 0, 1])).toBe(true);

        const hidden = webGlPaints(true);
        expect(hidden.draws.some((count) => count > 0)).toBe(true);
        expect(glHasColor(hidden, [1, 0, 0])).toBe(false);
        expect(glHasColor(hidden, [0, 1, 0])).toBe(true);
        expect(glHasColor(hidden, [0, 0, 1])).toBe(true);
    });
});
