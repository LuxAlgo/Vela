// "Scale price chart only": with it on, the price pane's autoscale fits the bars alone, so an
// indicator plotted far from price no longer squashes the candles; it paints where it falls,
// off the edge of the pane. Study panes keep fitting their own plots.
import { describe, it, expect } from 'vitest';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { LineLikeSeries } from '../src/core/model/series';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

type AnyRenderer = Record<string, any>;

const MIN = 60_000;
const T0 = 1_700_000_000_000;

function line(id: string, paneId: string, value: number, n: number): LineLikeSeries {
    return {
        id,
        title: id,
        paneId,
        kind: 'line',
        points: Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, value })),
        style: { color: '#ffffff', width: 1, lineStyle: 'solid' },
    };
}

function model(id: string, paneId: string, series: LineLikeSeries[], extra: Partial<IndicatorModel> = {}): IndicatorModel {
    return {
        id,
        title: id,
        overlay: paneId === 'price',
        paneHint: paneId === 'price' ? 'price' : 'new',
        paneId,
        series,
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
        ...extra,
    };
}

/** An unmounted renderer holding 50 bars trading 100–110, an overlay indicator with a plot
 *  at 200 and a price line at 50, and a study pane plotting 0–1000. */
function setup(): { renderer: NativeRenderer; r: AnyRenderer } {
    const n = 50;
    const renderer = new NativeRenderer();
    const r = renderer as unknown as AnyRenderer;
    r.animator = { active: false }; // unmounted: there is no frame loop
    r.coords.setSize(800, 400, 1);
    r.bars = Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, open: 105, high: 110, low: 100, close: 105 }));
    r.scene.bars = r.bars;
    r.coords.setBars(r.bars.map((b: { time: number }) => b.time));
    r.scene.ensurePane('price', 'price', 0, 3);
    r.scene.ensurePane('study', 'study', 1, 1);
    const overlay = model('zones', 'price', [line('zones:far', 'price', 200, n)], {
        priceLines: [{ id: 'zones:support', price: 50, color: '#ffffff', width: 1, lineStyle: 'solid' } as IndicatorModel['priceLines'][number]],
    });
    const study = model('osc', 'study', [line('osc:lo', 'study', 0, n), line('osc:hi', 'study', 1000, n)]);
    for (const m of [overlay, study]) {
        r.scene.indicators.set(m.id, m);
        r.scene.assignIndicatorZ(m.id);
    }
    return { renderer, r };
}

function windows(r: AnyRenderer): { price: { min: number; max: number }; study: { min: number; max: number } } {
    r.computeScales();
    return { price: r.scene.panes.get('price').scaleTarget, study: r.scene.panes.get('study').scaleTarget };
}

describe('scale price chart only', () => {
    it('is off by default: an overlay indicator far from price widens the price window to fit it', () => {
        const { renderer, r } = setup();
        expect(renderer.readFeature('scalePriceOnly')).toBe(false);
        const { price } = windows(r);
        expect(price.max).toBeGreaterThanOrEqual(200);
        expect(price.min).toBeLessThanOrEqual(50);
    });

    it('turned on, the price window fits the bars and the far indicator falls outside it', () => {
        const { renderer, r } = setup();
        renderer.applyFeature('scalePriceOnly', true);
        const { price } = windows(r);
        expect(price.min).toBeLessThan(100);
        expect(price.max).toBeGreaterThan(110);
        expect(price.max).toBeLessThan(120);
        expect(price.min).toBeGreaterThan(90);
    });

    it('leaves study panes fitting their own plots', () => {
        const { renderer, r } = setup();
        renderer.applyFeature('scalePriceOnly', true);
        const { study } = windows(r);
        expect(study.min).toBeLessThanOrEqual(0);
        expect(study.max).toBeGreaterThanOrEqual(1000);
    });

    it('with the price series hidden there are no bars to fit, so the indicators keep the window', () => {
        const { renderer, r } = setup();
        renderer.applyFeature('scalePriceOnly', true);
        renderer.applyFeature('candleVisible', false);
        const { price } = windows(r);
        expect(price.max).toBeGreaterThanOrEqual(200);
    });

    it('is saved with the chart settings and restored from them', () => {
        const { renderer } = setup();
        renderer.applyFeature('scalePriceOnly', true);
        const saved = renderer.getConfig();
        expect(saved.priceScale.priceOnly).toBe(true);
        const restored = new NativeRenderer();
        restored.applyConfig(saved);
        expect(restored.readFeature('scalePriceOnly')).toBe(true);
    });
});
