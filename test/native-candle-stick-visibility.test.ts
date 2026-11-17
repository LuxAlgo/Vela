import { describe, it, expect, vi } from 'vitest';

// The WebGL2 backend resolves colors through a 1×1 canvas read-back, which node has no
// canvas for: parse the one notation these tests use (`#rrggbb`) instead.
vi.mock('../src/renderers/native/backend/gl/color', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/renderers/native/backend/gl/color')>();
    const parseColor = (css: string | null | undefined): [number, number, number, number] => {
        const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((css ?? '').trim());
        return hex ? [parseInt(hex[1]!, 16) / 255, parseInt(hex[2]!, 16) / 255, parseInt(hex[3]!, 16) / 255, 1] : [0, 0, 0, 1];
    };
    return { ...real, parseColor };
});

import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { WebGL2Backend } from '../src/renderers/native/backend/WebGL2Backend';
import { Batch } from '../src/renderers/native/backend/gl/Batch';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { CandleStyle } from '../src/renderers/native/core/chartConfig';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';

/**
 * Below the body threshold a candle is one stick. The stick stands for the whole
 * candle, so it follows the parts left visible: the high-low range while the wick
 * shows, the open-close body when only the body or its border does, and nothing once
 * every part is hidden. These tests drive both backends over the same scene and
 * compare what each paints, tier by tier.
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
const UP = THEME.upColor;
const DOWN = THEME.downColor;
const WICK_UP = '#111111';
const WICK_DOWN = '#222222';
const BORDER_UP = '#333333';
const BORDER_DOWN = '#444444';

const PANE_H = 100;
/** The price pane spans 0..20 over 100 px. */
const yOf = (price: number): number => PANE_H - 5 * price;
const bar = (time: number, open: number, high: number, low: number, close: number): OHLCV => ({ time, open, high, low, close });

/** One painted mark, reduced to what the two backends share: its vertical extent and color. */
interface Mark {
    top: number;
    bottom: number;
    color: string;
}

/** Extents rounded past float noise: canvas2d works in doubles, the WebGL2 batch in float32. */
const mark = (top: number, bottom: number, color: string): Mark => ({ top: Math.round(top * 1e4) / 1e4, bottom: Math.round(bottom * 1e4) / 1e4, color });

interface SceneOptions {
    candle?: Partial<CandleStyle>;
    barColor?: { time: number; color: string };
}

function sceneFor(bars: OHLCV[], spacing: number, opts: SceneOptions = {}): { scene: SceneGraph; coords: CoordinateSystem } {
    const scene = new SceneGraph();
    scene.bars = bars;
    Object.assign(scene.style.candle, { wickUpColor: WICK_UP, wickDownColor: WICK_DOWN, borderUpColor: BORDER_UP, borderDownColor: BORDER_DOWN }, opts.candle);
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: PANE_H };
    pane.scale = { min: 0, max: 20 };
    if (opts.barColor) {
        const model = {
            id: 'ind', title: 'I', overlay: true, paneId: 'price',
            series: [], fills: [], backgrounds: [], priceLines: [],
            barColors: [opts.barColor],
            inputs: [], inputValues: {},
        } as unknown as IndicatorModel;
        scene.indicators.set(model.id, model);
        scene.assignIndicatorZ(model.id);
    }
    const coords = new CoordinateSystem();
    coords.setSize(300, PANE_H, 1);
    coords.setBars(bars.map((b) => b.time));
    coords.setViewport({ barSpacing: spacing, rightOffset: 0.5 });
    return { scene, coords };
}

/** Every stroke and filled rect the canvas2d backend paints, in paint order. */
function paintCanvas(bars: OHLCV[], spacing: number, opts?: SceneOptions): Mark[] {
    const { scene, coords } = sceneFor(bars, spacing, opts);
    const marks: Mark[] = [];
    const st = { fillStyle: '', strokeStyle: '' };
    let path: number[] = [];
    const noop = (): void => undefined;
    const ctx = {
        set fillStyle(v: string) { st.fillStyle = v; },
        get fillStyle() { return st.fillStyle; },
        set strokeStyle(v: string) { st.strokeStyle = v; },
        get strokeStyle() { return st.strokeStyle; },
        globalAlpha: 1,
        lineWidth: 1,
        lineJoin: 'miter',
        lineCap: 'butt',
        setTransform: noop, clearRect: noop, save: noop, restore: noop,
        closePath: noop, rect: noop, clip: noop, arcTo: noop, arc: noop, setLineDash: noop, fill: noop,
        beginPath: () => { path = []; },
        moveTo: (_x: number, y: number) => path.push(y),
        lineTo: (_x: number, y: number) => path.push(y),
        stroke: () => { if (path.length > 0) marks.push(mark(Math.min(...path), Math.max(...path), st.strokeStyle)); },
        fillRect: (_x: number, y: number, _w: number, h: number) => marks.push(mark(y, y + h, st.fillStyle)),
        strokeRect: (_x: number, y: number, _w: number, h: number) => marks.push(mark(y, y + h, st.strokeStyle)),
        createLinearGradient: () => ({ addColorStop: noop }),
    } as unknown as CanvasRenderingContext2D;
    const backend = new Canvas2dBackend();
    backend.mount({ width: 300, height: PANE_H, getContext: () => ctx } as unknown as HTMLCanvasElement);
    backend.render(scene, coords, THEME);
    return marks;
}

/** Every quad the WebGL2 backend emits for the price series, in emit order. */
function paintGl(bars: OHLCV[], spacing: number, opts?: SceneOptions): Mark[] {
    const { scene, coords } = sceneFor(bars, spacing, opts);
    const backend = new WebGL2Backend() as unknown as {
        emitPriceSeries(b: Batch, scene: SceneGraph, i0: number, i1: number, coords: CoordinateSystem, pane: unknown, theme: VelaTheme, barColors: ReadonlyMap<number, string>, dataW: number): void;
    };
    const b = new Batch();
    const barColors = new Map<number, string>(opts?.barColor ? [[opts.barColor.time, opts.barColor.color]] : []);
    backend.emitPriceSeries(b, scene, 0, bars.length - 1, coords, scene.panes.get('price'), THEME, barColors, 300);
    const v = b.view;
    const hex = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');
    const marks: Mark[] = [];
    for (let q = 0; q + 48 <= v.length; q += 48) {
        const ys = [0, 1, 2, 3, 4, 5].map((k) => v[q + k * 8 + 1]!);
        marks.push(mark(Math.min(...ys), Math.max(...ys), `#${hex(v[q + 2]!)}${hex(v[q + 3]!)}${hex(v[q + 4]!)}`));
    }
    return marks;
}

const BACKENDS = [
    ['canvas2d', paintCanvas],
    ['webgl2', paintGl],
] as const;

/** An up bar, a down bar, and a doji (open = close) with a real high-low range. */
const UP_BAR = bar(0, 10, 14, 8, 12);
const DOWN_BAR = bar(60_000, 12, 13, 6, 9);
const DOJI = bar(120_000, 10, 12, 9, 10);
const THREE = [UP_BAR, DOWN_BAR, DOJI];

const WICK_TIER = 2; // px per bar: a stick per bar, no body
const AGGREGATE_TIER = 0.5; // px per bar: bars share pixel columns
const FULL_TIER = 20;

const WICK_OFF: Partial<CandleStyle> = { wickVisible: false };
const HOLLOW_NO_WICK: Partial<CandleStyle> = { bodyVisible: false, borderVisible: true, wickVisible: false };
const ALL_OFF: Partial<CandleStyle> = { bodyVisible: false, borderVisible: false, wickVisible: false };

describe.each(BACKENDS)('%s: a candle too thin for a body paints as a stick', (_name, paint) => {
    it('with the wick visible, the stick spans high to low in the wick color', () => {
        expect(paint(THREE, WICK_TIER)).toEqual([
            { top: yOf(14), bottom: yOf(8), color: WICK_UP },
            { top: yOf(13), bottom: yOf(6), color: WICK_DOWN },
            { top: yOf(12), bottom: yOf(9), color: WICK_UP },
        ]);
    });

    it('with the wick hidden, the stick spans the body in the body color', () => {
        // The reported bug: nothing painted here, so zooming out emptied the chart.
        expect(paint(THREE, WICK_TIER, { candle: WICK_OFF })).toEqual([
            { top: yOf(12), bottom: yOf(10), color: UP },
            { top: yOf(12), bottom: yOf(9), color: DOWN },
            { top: yOf(10), bottom: yOf(10) + 1, color: UP }, // a doji keeps one device pixel
        ]);
    });

    it('a barcolor() tints the body stick as it tints the body', () => {
        const marks = paint(THREE, WICK_TIER, { candle: WICK_OFF, barColor: { time: DOWN_BAR.time, color: '#abcdef' } });
        expect(marks.map((m) => m.color)).toEqual([UP, '#abcdef', UP]);
    });

    it('with only the border visible, the stick spans the body in the border color', () => {
        expect(paint(THREE, WICK_TIER, { candle: HOLLOW_NO_WICK })).toEqual([
            { top: yOf(12), bottom: yOf(10), color: BORDER_UP },
            { top: yOf(12), bottom: yOf(9), color: BORDER_DOWN },
            { top: yOf(10), bottom: yOf(10) + 1, color: BORDER_UP },
        ]);
    });

    it('with every part hidden, nothing paints', () => {
        expect(paint(THREE, WICK_TIER, { candle: ALL_OFF })).toEqual([]);
    });
});

describe.each(BACKENDS)('%s: candles sharing a pixel column paint as one stick', (_name, paint) => {
    // At 0.5 px per bar the four bars land in three columns: [0], [1, 2], [3].
    const FOUR = [bar(0, 10, 14, 8, 12), bar(60_000, 10, 15, 9, 11), bar(120_000, 11, 13, 7, 13), bar(180_000, 12, 13, 6, 9)];

    it('with the wick visible, each column spans its bars from high to low in the wick color', () => {
        expect(paint(FOUR, AGGREGATE_TIER)).toEqual([
            { top: yOf(14), bottom: yOf(8), color: WICK_UP },
            { top: yOf(15), bottom: yOf(7), color: WICK_UP },
            { top: yOf(13), bottom: yOf(6), color: WICK_DOWN },
        ]);
    });

    it('with the wick hidden, each column spans its bars\u2019 bodies in the body color', () => {
        // Neither the hidden wick's range nor its color may come back at this zoom.
        expect(paint(FOUR, AGGREGATE_TIER, { candle: WICK_OFF })).toEqual([
            { top: yOf(12), bottom: yOf(10), color: UP },
            { top: yOf(13), bottom: yOf(10), color: UP },
            { top: yOf(12), bottom: yOf(9), color: DOWN },
        ]);
    });

    it('with only the border visible, each column spans its bars\u2019 bodies in the border color', () => {
        expect(paint(FOUR, AGGREGATE_TIER, { candle: HOLLOW_NO_WICK }).map((m) => m.color)).toEqual([BORDER_UP, BORDER_UP, BORDER_DOWN]);
    });

    it('a lone doji keeps one device pixel', () => {
        expect(paint([DOJI], AGGREGATE_TIER, { candle: WICK_OFF })).toEqual([{ top: yOf(10), bottom: yOf(10) + 1, color: UP }]);
    });

    it('with every part hidden, nothing paints', () => {
        expect(paint(FOUR, AGGREGATE_TIER, { candle: ALL_OFF })).toEqual([]);
    });
});

describe.each(BACKENDS)('%s: zooming out never loses a candle that has a visible part', (_name, paint) => {
    // Either side of both tier thresholds (3 px and 1 px per bar), then the zoom-out floor.
    const SPACINGS = [FULL_TIER, 3.02, 2.98, WICK_TIER, 1.02, 0.98, AGGREGATE_TIER];

    it.each([
        ['the wick hidden', WICK_OFF],
        ['only the border visible', HOLLOW_NO_WICK],
        ['only the wick visible', { bodyVisible: false, borderVisible: false } satisfies Partial<CandleStyle>],
    ])('with %s, every zoom paints the candles', (_label, candle) => {
        for (const spacing of SPACINGS) {
            expect(paint(THREE, spacing, { candle }).length, `${spacing} px per bar`).toBeGreaterThan(0);
        }
    });

    it('with every part hidden, no zoom paints them', () => {
        for (const spacing of SPACINGS) {
            expect(paint(THREE, spacing, { candle: ALL_OFF }), `${spacing} px per bar`).toEqual([]);
        }
    });

    it('wide candles keep their parts: hiding the wick leaves the bodies alone', () => {
        expect(paint(THREE, FULL_TIER, { candle: WICK_OFF })).toEqual([
            { top: yOf(12), bottom: yOf(10), color: UP },
            { top: yOf(12), bottom: yOf(9), color: DOWN },
            { top: yOf(10), bottom: yOf(10) + 1, color: UP },
        ]);
    });
});

describe('both backends paint the same sticks', () => {
    it.each([
        ['wick visible', {}],
        ['wick hidden', WICK_OFF],
        ['only the border visible', HOLLOW_NO_WICK],
        ['every part hidden', ALL_OFF],
    ])('%s', (_label, candle) => {
        for (const spacing of [WICK_TIER, AGGREGATE_TIER]) {
            expect(paintGl(THREE, spacing, { candle }), `${spacing} px per bar`).toEqual(paintCanvas(THREE, spacing, { candle }));
        }
    });
});
