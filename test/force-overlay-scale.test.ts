import { describe, it, expect } from 'vitest';
import { computePaneScale, overlaySeriesRange } from '../src/renderers/native/core/autoscale';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { SeriesPoint } from '../src/core/model/series';

/**
 * force_overlay series live on the PRICE pane's scale: their own pane's autoscale
 * skips them, and overlaySeriesRange hands their visible range to the price pane.
 */

function points(values: number[]): SeriesPoint[] {
    return values.map((v, i) => ({ time: 1_700_000_000_000 + i * 60_000, value: v }));
}

function studyModel(): IndicatorModel {
    return {
        id: 'st', title: 'Study', overlay: false, paneHint: 'new', paneId: 'pane-st',
        series: [
            { id: 'st:own', title: 'own', paneId: 'pane-st', kind: 'line', points: points([10, 20, 15]), style: { color: '#fff', width: 1, lineStyle: 'solid' } },
            { id: 'st:forced', title: 'forced', paneId: 'price', kind: 'line', points: points([1000, 2000, 1500]), overlay: true, style: { color: '#0f0', width: 1, lineStyle: 'solid' } },
        ],
        fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
    };
}

describe('autoscale — force_overlay series routing', () => {
    it('computePaneScale skips overlay series (the study window fits its own plots only)', () => {
        const scale = computePaneScale([studyModel()], [], false, 0, 2);
        // The forced series' 1000..2000 values must NOT stretch the study window.
        expect(scale.max).toBeLessThan(1000);
        expect(scale.min).toBeLessThanOrEqual(10);
    });

    it('overlaySeriesRange returns exactly the overlay series range (for the price pane fold)', () => {
        expect(overlaySeriesRange([studyModel()], 0, 2)).toEqual({ min: 1000, max: 2000 });
    });

    it('overlaySeriesRange is null when nothing is flagged', () => {
        const m = studyModel();
        for (const s of m.series) s.overlay = undefined;
        expect(overlaySeriesRange([m], 0, 2)).toBeNull();
    });

    it('overlaySeriesRange honors the visible window and per-model anchor offset', () => {
        // Anchor offset 1: the model's index 0 is the chart's bar 1.
        expect(overlaySeriesRange([studyModel()], 1, 1, () => 1)).toEqual({ min: 1000, max: 1000 });
    });
});
