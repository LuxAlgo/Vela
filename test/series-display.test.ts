// A series' per-surface `display` (pane / priceScale / legend / dataWindow) and its `visible`
// shorthand, and every surface the native renderer gates on them: the model helpers, the
// pane autoscale, the canvas2d paint, and the legend vs data-window readouts.
import { describe, it, expect } from 'vitest';
import { seriesShownOn, seriesInScale } from '../src/core/model/series';
import type { LineLikeSeries, CandleSeries, SeriesDisplay } from '../src/core/model/series';
import type { IndicatorModel } from '../src/core/model/indicator';
import { computePaneScale, overlaySeriesRange } from '../src/renderers/native/core/autoscale';
import { Canvas2dBackend } from '../src/renderers/native/backend/Canvas2dBackend';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { VelaTheme } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function line(id: string, values: number[], extra: Partial<LineLikeSeries> = {}): LineLikeSeries {
    return {
        id, title: id, paneId: 'p', kind: 'line',
        points: values.map((v, i) => ({ time: T0 + i * HOUR, value: v })),
        style: { color: '#ffffff', width: 1, lineStyle: 'solid' },
        ...extra,
    };
}

function candles(id: string, closes: number[], extra: Partial<CandleSeries> = {}): CandleSeries {
    return {
        id, title: id, paneId: 'p', kind: 'candle',
        bars: closes.map((c, i) => ({ time: T0 + i * HOUR, open: c - 1, high: c + 2, low: c - 2, close: c })),
        ...extra,
    };
}

function model(series: IndicatorModel['series'], paneId = 'p'): IndicatorModel {
    return { id: 'ind', title: 'Ind', overlay: false, paneHint: 'new', paneId, series, fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} };
}

const ONLY = (surface: keyof SeriesDisplay): SeriesDisplay => ({ pane: false, priceScale: false, legend: false, dataWindow: false, [surface]: true });

describe('seriesShownOn / seriesInScale', () => {
    it('a bare series shows everywhere and is in scale', () => {
        const s = line('a', [1]);
        for (const surface of ['pane', 'priceScale', 'legend', 'dataWindow'] as const) expect(seriesShownOn(s, surface)).toBe(true);
        expect(seriesInScale(s)).toBe(true);
    });

    it('`visible: false` alone hides every surface and takes the series out of scale', () => {
        const s = line('a', [1], { visible: false });
        for (const surface of ['pane', 'priceScale', 'legend', 'dataWindow'] as const) expect(seriesShownOn(s, surface)).toBe(false);
        expect(seriesInScale(s)).toBe(false);
    });

    it('`display` decides per surface, with absent flags shown', () => {
        const s = line('a', [1], { display: { pane: false } });
        expect(seriesShownOn(s, 'pane')).toBe(false);
        expect(seriesShownOn(s, 'priceScale')).toBe(true);
        expect(seriesShownOn(s, 'legend')).toBe(true);
        expect(seriesShownOn(s, 'dataWindow')).toBe(true);
    });

    it('`display` wins over the `visible` shorthand when both are set', () => {
        // The shorthand keeps older consumers hiding the series; the precise form is for the ones that read it.
        const s = line('a', [1], { visible: false, display: ONLY('dataWindow') });
        expect(seriesShownOn(s, 'dataWindow')).toBe(true);
        expect(seriesShownOn(s, 'pane')).toBe(false);
    });

    it('in scale ⇔ on the pane or on the price scale', () => {
        expect(seriesInScale(line('a', [1], { display: ONLY('pane') }))).toBe(true);
        expect(seriesInScale(line('a', [1], { display: ONLY('priceScale') }))).toBe(true);
        expect(seriesInScale(line('a', [1], { display: ONLY('legend') }))).toBe(false);
        expect(seriesInScale(line('a', [1], { display: ONLY('dataWindow') }))).toBe(false);
        expect(seriesInScale(line('a', [1], { display: { legend: true, dataWindow: true, pane: false, priceScale: false } }))).toBe(false);
    });
});

describe('autoscale — only series with an on-chart presence stretch the window', () => {
    const painted = line('painted', [10, 12, 11]);

    it('a legend-only or data-window-only plot far outside the painted range leaves the scale alone', () => {
        for (const display of [ONLY('legend'), ONLY('dataWindow'), { pane: false, priceScale: false }]) {
            const scale = computePaneScale([model([painted, line('far', [1000, 1000, 1000], { display })])], [], false, 0, 2);
            expect(scale.max).toBeLessThan(100);
        }
    });

    it('a price-scale-only plot (not painted) still keeps its value in view', () => {
        const scale = computePaneScale([model([painted, line('far', [1000, 1000, 1000], { display: ONLY('priceScale') })])], [], false, 0, 2);
        expect(scale.max).toBeGreaterThan(1000);
    });

    it('a pane-only plot keeps its value in view', () => {
        const scale = computePaneScale([model([painted, line('far', [1000, 1000, 1000], { display: ONLY('pane') })])], [], false, 0, 2);
        expect(scale.max).toBeGreaterThan(1000);
    });

    it('a `visible: false` fill anchor no longer stretches the scale', () => {
        const scale = computePaneScale([model([painted, line('anchor', [1000, 1000, 1000], { visible: false })])], [], false, 0, 2);
        expect(scale.max).toBeLessThan(100);
    });

    it('applies to plotcandle series and to force_overlay folding alike', () => {
        const scale = computePaneScale([model([painted, candles('c', [1000, 1000, 1000], { display: ONLY('dataWindow') })])], [], false, 0, 2);
        expect(scale.max).toBeLessThan(100);
        const m = model([line('forced', [1000, 2000, 1500], { overlay: true, display: ONLY('legend') })]);
        expect(overlaySeriesRange([m], 0, 2)).toBeNull();
    });
});

describe('canvas2d — the pane paint follows `display.pane`', () => {
    const THEME: VelaTheme = { background: '#000000', textColor: '#cccccc', gridColor: '#222222', borderColor: '#333333', upColor: '#00AA00', downColor: '#AA0000', fontFamily: 'sans-serif' };

    /** Paint one indicator series on a study pane with a recording 2d context; returns the paint ops. */
    function paintOps(series: IndicatorModel['series']): number {
        let ops = 0;
        const noop = (): void => undefined;
        const ctx = {
            fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
            setTransform: noop, clearRect: noop, save: noop, restore: noop, beginPath: noop, closePath: noop, rect: noop, clip: noop,
            moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, setLineDash: noop,
            fill: () => { ops += 1; }, stroke: () => { ops += 1; }, fillRect: () => { ops += 1; }, strokeRect: () => { ops += 1; },
            createLinearGradient: () => ({ addColorStop: noop }),
        } as unknown as CanvasRenderingContext2D;
        const backend = new Canvas2dBackend();
        backend.mount({ width: 300, height: 200, getContext: () => ctx } as unknown as HTMLCanvasElement);
        const scene = new SceneGraph();
        scene.bars = [0, 1, 2].map((i) => ({ time: T0 + i * HOUR, open: 100, high: 101, low: 99, close: 100 }));
        scene.showGrid = false;
        scene.candlesHidden = true; // isolate the indicator series' ops
        const price = scene.ensurePane('price', 'price', 0, 3);
        price.bounds = { top: 0, height: 100 };
        price.scale = { min: 95, max: 110 };
        const pane = scene.ensurePane('p', 'study', 1, 1);
        pane.bounds = { top: 100, height: 100 };
        pane.scale = { min: 0, max: 20 };
        const m = model(series);
        scene.indicators.set(m.id, m);
        scene.assignIndicatorZ(m.id);
        const coords = new CoordinateSystem();
        coords.setSize(300, 200, 1);
        coords.setBars(scene.bars.map((b) => b.time));
        backend.render(scene, coords, THEME);
        return ops;
    }

    it('paints a bare series and one shown on every surface', () => {
        expect(paintOps([line('a', [10, 12, 11])])).toBeGreaterThan(0);
        expect(paintOps([line('a', [10, 12, 11], { display: { pane: true, legend: false, dataWindow: false, priceScale: false } })])).toBeGreaterThan(0);
    });

    it('paints nothing for a data-window-only, legend-only, or `visible: false` series', () => {
        expect(paintOps([line('a', [10, 12, 11], { display: ONLY('dataWindow') })])).toBe(0);
        expect(paintOps([line('a', [10, 12, 11], { display: ONLY('legend') })])).toBe(0);
        expect(paintOps([line('a', [10, 12, 11], { visible: false })])).toBe(0);
    });

    it('an off-pane plotcandle series is not painted either', () => {
        expect(paintOps([candles('c', [10, 12, 11])])).toBeGreaterThan(0);
        expect(paintOps([candles('c', [10, 12, 11], { display: ONLY('dataWindow') })])).toBe(0);
    });
});

describe('native renderer — legend and data-window readouts follow their own surface flag', () => {
    function bars(closes: number[]): OHLCV[] {
        return closes.map((close, i) => ({ time: T0 + i * HOUR, open: close - 1, high: close + 2, low: close - 2, close }));
    }

    /** Unmounted but sized, with one study indicator mounted straight into the scene. */
    function withIndicator(series: IndicatorModel['series']): { r: NativeRenderer; anyR: any; legend: () => Array<{ value: string; color: string }> | undefined } {
        const r = new NativeRenderer();
        const anyR = r as any;
        anyR.coords.setSize(800, 200, 1);
        if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
        if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
        anyR.introPlayed = true;
        r.setBars(bars([100, 101, 105]));
        const m = model(series, 'price');
        anyR.scene.indicators.set(m.id, m);
        let captured: ReadonlyMap<string, Array<{ value: string; color: string }>> | null = null;
        anyR.inputsUI = { setPlotValues: (v: ReadonlyMap<string, Array<{ value: string; color: string }>>) => { captured = v; } };
        return {
            r, anyR,
            legend: () => { anyR.updateLegendValues(); return captured?.get('ind'); },
        };
    }

    const rows = (r: NativeRenderer): string[] => (r.getDataWindowReadout().groups.find((g) => g.name === 'Ind')?.rows ?? []).map((row) => row.label);

    it('a bare plot reports on both surfaces', () => {
        const { r, legend } = withIndicator([line('P', [1, 2, 3])]);
        expect(rows(r)).toEqual(['P']);
        expect(legend()).toHaveLength(1);
    });

    it('a data-window-only plot has a data-window row and no legend value', () => {
        const { r, legend } = withIndicator([line('Shown', [1, 2, 3]), line('DW', [4, 5, 6], { display: ONLY('dataWindow') })]);
        expect(rows(r)).toEqual(['Shown', 'DW']);
        expect(legend()).toHaveLength(1);
    });

    it('a legend-only plot has a legend value and no data-window row', () => {
        const { r, legend } = withIndicator([line('Shown', [1, 2, 3]), line('SL', [4, 5, 6], { display: ONLY('legend') })]);
        expect(rows(r)).toEqual(['Shown']);
        expect(legend()).toHaveLength(2);
    });

    it('a pane-only plot (painted, no readouts) and a `visible: false` plot report nowhere', () => {
        const { r, legend } = withIndicator([line('Pane', [1, 2, 3], { display: ONLY('pane') }), line('Hidden', [4, 5, 6], { visible: false })]);
        expect(rows(r)).toEqual([]);
        expect(legend()).toEqual([]);
    });

    it('applies to plotcandle series too', () => {
        const { r, legend } = withIndicator([candles('C', [1, 2, 3], { display: ONLY('legend') })]);
        expect(rows(r)).toEqual([]);
        expect(legend()).toHaveLength(1);
    });
});
