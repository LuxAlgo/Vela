import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { computePaneScale } from '../src/renderers/native/core/autoscale';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET, type DrawingSet } from '../src/renderers/shared/DrawingSceneRenderer';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { SeriesPoint } from '../src/core/model/series';
import type { DrawingLine } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

/**
 * The anchor-offset seam: models computed over a SUFFIX of the chart bars carry an
 * `anchorTime`, and the native renderer derives ONE index offset per model so every
 * index-aligned read (series arrays, `bar_index` drawings, autoscale) lands on the
 * right chart bars. Absent anchor ⇒ offset 0 ⇒ byte-identical to today (regression).
 */

const T0 = 1_700_000_000_000;
const STEP = 60_000;

function bars(n: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) out.push({ time: T0 + i * STEP, open: 100, high: 100 + i, low: 100 - i, close: 100, volume: 1 });
    return out;
}

/** A model whose single line series holds `values` starting at the model's bar 0. */
function lineModel(id: string, values: number[]): IndicatorModel {
    const points: SeriesPoint[] = values.map((v, i) => ({ time: T0 + i * STEP, value: v }));
    return {
        id,
        title: id,
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [{ id: `${id}:line`, title: id, paneId: 'price', kind: 'line', points, style: { color: '#f00', width: 1, lineStyle: 'solid' } }],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

describe('SceneGraph anchor offsets', () => {
    it('stores only nonzero offsets, reads 0 by default, and forgets on removal', () => {
        const scene = new SceneGraph();
        expect(scene.offsetOf('a')).toBe(0);
        scene.setAnchorOffset('a', 7);
        expect(scene.offsetOf('a')).toBe(7);
        scene.setAnchorOffset('a', 0); // whole-chart again — not stored
        expect(scene.offsetOf('a')).toBe(0);
        scene.setAnchorOffset('b', 3);
        scene.forgetAnchorOffset('b');
        expect(scene.offsetOf('b')).toBe(0);
    });
});

describe('autoscale with an anchored model', () => {
    it('scans the values that actually sit under the visible window (offset applied)', () => {
        // Chart of 10 bars; the model ran over the LAST 4 (anchor index 6) with values 1000..1003.
        const chart = bars(10);
        const m = lineModel('m', [1000, 1001, 1002, 1003]);
        // Visible window = chart bars 6..9 → all four model values.
        const scale = computePaneScale([m], chart, false, 6, 9, null, false, () => 6);
        expect(scale.min).toBeLessThanOrEqual(1000);
        expect(scale.max).toBeGreaterThanOrEqual(1003);
        // Visible window = chart bars 0..5 (BEFORE the model's anchor) → no model values at all.
        const empty = computePaneScale([m], chart, false, 0, 5, null, false, () => 6);
        expect(empty).toEqual({ min: 0, max: 1 }); // the "nothing visible" fallback
    });

    it('defaults to offset 0 — the unanchored regression path is untouched', () => {
        const chart = bars(4);
        const m = lineModel('m', [10, 20, 30, 40]);
        const scale = computePaneScale([m], chart, false, 1, 2);
        expect(scale.min).toBeLessThanOrEqual(20);
        expect(scale.max).toBeGreaterThanOrEqual(30);
        expect(scale.min).toBeGreaterThan(10 - 10); // bars 0/3 (10, 40) excluded from the window
    });
});

describe('bar_index drawings with an anchored model', () => {
    const theme = { textColor: '#fff' } as VelaTheme;
    const line = (x1: number, x2: number): DrawingLine => ({
        id: 'ln',
        paneId: 'price',
        xloc: 'bar_index',
        extend: 'none',
        x1,
        y1: 5,
        x2,
        y2: 6,
        color: '#0f0',
        width: 1,
        style: 'solid',
        invisible: false,
        arrowLeft: false,
        arrowRight: false,
    });
    const setOf = (ln: DrawingLine): DrawingSet => ({ ...EMPTY_DRAWING_SET, lines: [ln] });

    it("shifts a model's bar_index coordinates by its offset (visibility follows chart indices)", () => {
        const r = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme });
        // The model's bar_index 0..2 — anchored at chart bar 50 → occupies chart bars 50..52.
        r.setSet(setOf(line(0, 2)), 50);
        expect(r.priceRange(50, 52)).not.toBeNull(); // visible where it actually sits
        expect(r.priceRange(0, 2)).toBeNull(); // NOT at the raw (unshifted) indices
    });

    it('offset 0 (or omitted) keeps raw bar_index semantics — regression', () => {
        const r = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme });
        r.setSet(setOf(line(0, 2)));
        expect(r.priceRange(0, 2)).not.toBeNull();
        expect(r.priceRange(50, 52)).toBeNull();
    });
});
