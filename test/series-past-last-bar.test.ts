// A value series may carry points past the chart's last bar (a plot shifted forward): they
// paint on the bar slots after it, keep the autoscale covering them, and stay out of the
// "value at the last bar" a script run reports.
import { describe, it, expect } from 'vitest';
import type { LineLikeSeries } from '../src/core/model/series';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { VelaTheme } from '../src/core/options';
import { computePaneScale, overlaySeriesRange } from '../src/renderers/native/core/autoscale';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { EngineOrchestrator } from '../src/core/engine/EngineOrchestrator';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;
const THEME: VelaTheme = { background: '#000000', textColor: '#cccccc', gridColor: '#222222', borderColor: '#333333', upColor: '#00AA00', downColor: '#AA0000', fontFamily: 'sans-serif' };

function line(id: string, values: Array<number | null>, extra: Partial<LineLikeSeries> = {}): LineLikeSeries {
    return {
        id, title: id, paneId: 'p', kind: 'line',
        points: values.map((v, i) => ({ time: T0 + i * HOUR, value: v })),
        style: { color: '#ffffff', width: 1, lineStyle: 'solid' },
        ...extra,
    };
}

function model(series: IndicatorModel['series'], extra: Partial<IndicatorModel> = {}): IndicatorModel {
    return { id: 'ind', title: 'Ind', overlay: false, paneHint: 'new', paneId: 'p', series, fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {}, ...extra };
}

/** Paint one study-pane model over three bars (default right whitespace in view); returns the x of every segment end. */
function paintedXs(m: IndicatorModel): { xs: number[]; lastBarX: number } {
    const xs: number[] = [];
    const noop = (): void => undefined;
    const ctx = {
        fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
        setTransform: noop, clearRect: noop, save: noop, restore: noop, beginPath: noop, closePath: noop, rect: noop, clip: noop,
        moveTo: noop, lineTo: (x: number) => { xs.push(x); }, arcTo: noop, arc: noop, setLineDash: noop,
        fill: noop, stroke: noop, fillRect: noop, strokeRect: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
    } as unknown as CanvasRenderingContext2D;
    const backend = new Canvas2dBackend();
    backend.mount({ width: 300, height: 200, getContext: () => ctx } as unknown as HTMLCanvasElement);
    const scene = new SceneGraph();
    scene.bars = [0, 1, 2].map((i) => ({ time: T0 + i * HOUR, open: 100, high: 101, low: 99, close: 100 }));
    scene.showGrid = false;
    scene.candlesHidden = true;
    const price = scene.ensurePane('price', 'price', 0, 3);
    price.bounds = { top: 0, height: 100 };
    price.scale = { min: 95, max: 110 };
    const pane = scene.ensurePane('p', 'study', 1, 1);
    pane.bounds = { top: 100, height: 100 };
    pane.scale = { min: 0, max: 20 };
    scene.indicators.set(m.id, m);
    scene.assignIndicatorZ(m.id);
    const coords = new CoordinateSystem();
    coords.setSize(300, 200, 1);
    coords.setBars(scene.bars.map((b) => b.time));
    expect(coords.visibleLogicalRange().to).toBeGreaterThan(4); // the default right whitespace shows two future slots
    backend.render(scene, coords, THEME);
    return { xs, lastBarX: coords.logicalToX(2) };
}

describe('canvas2d — series points past the last bar', () => {
    it('a line continues onto the bar slots after the last bar', () => {
        const { xs, lastBarX } = paintedXs(model([line('a', [10, 11, 12, 13, 14])]));
        expect(Math.max(...xs)).toBeGreaterThan(lastBarX);
    });

    it('a series ending on the last bar paints nothing past it', () => {
        const { xs, lastBarX } = paintedXs(model([line('a', [10, 11, 12])]));
        expect(xs.length).toBeGreaterThan(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(lastBarX);
    });

    it('a fill between two forward-shifted series continues with them', () => {
        const m = model([line('a', [10, 11, 12, 13, 14]), line('b', [5, 6, 7, 8, 9])], {
            fills: [{ id: 'f', paneId: 'p', fromSeriesId: 'a', toSeriesId: 'b', color: '#ff000040' }],
        });
        const { xs, lastBarX } = paintedXs(m);
        expect(xs.filter((x) => x > lastBarX).length).toBeGreaterThan(2); // both lines and the fill quad
    });
});

describe('autoscale — points past the last bar', () => {
    it('a visible projected value keeps the window covering it; candles stop at the last bar', () => {
        const bars = [0, 1, 2].map((i) => ({ time: T0 + i * HOUR, open: 10, high: 11, low: 9, close: 10 }));
        const m = model([line('a', [10, 11, 12, 13, 500])]);
        expect(computePaneScale([m], bars, true, 0, 2).max).toBeLessThan(100);
        expect(computePaneScale([m], bars, true, 0, 4).max).toBeGreaterThan(500);
    });

    it('force_overlay series fold their projected values in too', () => {
        const m = model([line('a', [10, 11, 12, 13, 500], { overlay: true })]);
        expect(overlaySeriesRange([m], 0, 4)?.max).toBe(500);
    });

    it('the renderer scales the price pane over the visible right whitespace', () => {
        const r = new NativeRenderer();
        const anyR = r as any;
        anyR.coords.setSize(800, 200, 1);
        if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
        if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
        anyR.introPlayed = true;
        r.setBars([0, 1, 2].map((i) => ({ time: T0 + i * HOUR, open: 10, high: 11, low: 9, close: 10 })));
        const price = anyR.scene.ensurePane('price', 'price', 0, 3);
        price.bounds = { top: 0, height: 200 };
        const m = model([line('a', [10, 11, 12, 13, 500], { paneId: 'price' })], { paneId: 'price', overlay: true });
        anyR.scene.indicators.set(m.id, m);
        expect(anyR.coords.visibleLogicalRange().to).toBeGreaterThan(4);
        anyR.computeScales();
        expect(price.scaleTarget.max).toBeGreaterThan(500);
    });
});

describe('script run — the value at the last bar', () => {
    const plotsAtLastBar = (m: IndicatorModel, lastBarTime: number | undefined): Record<string, number | null> =>
        (EngineOrchestrator as unknown as { plotsAtLastBar: (m: IndicatorModel, t: number | undefined) => Record<string, number | null> }).plotsAtLastBar(m, lastBarTime);

    it('skips points past the last bar', () => {
        expect(plotsAtLastBar(model([line('a', [10, 11, 12, 13, 14])]), T0 + 2 * HOUR)).toEqual({ a: 12 });
    });

    it('reads the final point of a series that ends on the last bar', () => {
        expect(plotsAtLastBar(model([line('a', [10, 11, 12])]), T0 + 2 * HOUR)).toEqual({ a: 12 });
    });
});
