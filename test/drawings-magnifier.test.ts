import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    getDrawingType,
    buildToolbar,
    Magnifier,
    MAGNIFIER_TIMEFRAME_OPTIONS,
    magnifierTimeframeLabel,
    type Projector,
    type DrawingSeriesState,
} from '../src/core/drawings';
const HR = 3600_000;

/** Linear projector (x = time/HR, y = 1000 − price); `series` backs seriesInRange when given. */
function fakeProjector(series?: (timeframe: string, from: number, to: number) => DrawingSeriesState): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price) => 1000 - price,
        pxToPoint: (x, y) => ({ time: x * HR, price: 1000 - y }),
        paneIdAtY: () => 'price',
        barsBetween: (t1, t2) => Math.abs(t2 - t1) / HR,
        seriesInRange: series,
        width: 500,
        height: 1000,
    };
}

describe('drawings/Magnifier', () => {
    it('registers in the measure group as a drag-placed two-corner tool', () => {
        const meta = getDrawingType('magnifier')!;
        expect(meta.group).toBe('measure');
        expect(meta.label).toBe('Magnifier');
        expect(meta.coversSeries).toBe(true); // the opaque inset starts above the series stack
        expect(meta.placementHint).toBeTruthy(); // armed-tool prompt at the bottom of the chart
        expect(meta.defaultStyle.lineColor).toBe(''); // theme contrast ink until the user picks
        const d = createDrawing('magnifier', { paneId: 'price' })! as Magnifier;
        expect(d).toBeInstanceOf(Magnifier);
        expect(d.placementMode()).toBe('drag');
        expect(d.anchorSchema()).toMatchObject({ min: 2, max: 2 });
        // Defaults: auto timeframe; empty candle colors = follow the CHART series' own colors.
        expect(d.magnifier.timeframe).toBe('auto');
        expect(d.magnifier.upColor).toBe('');
        expect(d.magnifier.downColor).toBe('');
    });

    it('appears under the Measurements section of the toolbar', () => {
        const { definition } = buildToolbar(true);
        const measure = definition.groups.find((g) => g.id === 'measurements');
        expect(measure?.sections?.find((s) => s.label === 'Measurements')?.tools.map((t) => t.type)).toEqual([
            'position',
            'datepricerange',
            'magnifier',
        ]);
    });

    it('hit-tests anywhere inside the rectangle (opaque inset) and on its border', () => {
        const proj = fakeProjector();
        const d = createDrawing('magnifier', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 900 }, // px (0, 100)
                { time: 10 * HR, price: 800 }, // px (10, 200)
            ],
        })! as Magnifier;
        expect(d.hitTest(5, 150, proj, 3)).toBe(true); // interior
        expect(d.hitTest(0, 100, proj, 3)).toBe(true); // corner
        expect(d.hitTest(50, 150, proj, 3)).toBe(false); // outside
        expect(d.handlePoints(proj)).toEqual([
            [0, 100],
            [10, 200],
        ]);
        expect(d.bounds(proj)).toEqual({ x: 0, y: 100, w: 10, h: 100 });
        expect(d.priceRange()).toEqual({ min: 800, max: 900 });
    });

    it('reads its bars through Projector.seriesInRange with its own timeframe pick', () => {
        const calls: Array<{ timeframe: string; from: number; to: number }> = [];
        const proj = fakeProjector((timeframe, from, to) => {
            calls.push({ timeframe, from, to });
            return { state: 'loading', timeframe: '5', barMs: 5 * 60_000 };
        });
        const d = createDrawing('magnifier', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 900 },
                { time: 10 * HR, price: 800 },
            ],
        })! as Magnifier;
        d.magnifier.timeframe = '5';
        // The drawing itself only resolves geometry; the painter issues the read — emulate it.
        const from = Math.min(d.anchors[0]!.time, d.anchors[1]!.time);
        const to = Math.max(d.anchors[0]!.time, d.anchors[1]!.time);
        proj.seriesInRange!(d.magnifier.timeframe, from, to);
        expect(calls).toEqual([{ timeframe: '5', from: 0, to: 10 * HR }]);
    });

    it('round-trips its timeframe and candle colors through serialize / deserialize', () => {
        const d = createDrawing('magnifier', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 10 },
                { time: HR, price: 20 },
            ],
        })! as Magnifier;
        d.magnifier.timeframe = '15';
        d.magnifier.upColor = '#112233';
        const doc = d.serialize();
        expect(doc.props).toMatchObject({ timeframe: '15', upColor: '#112233' });
        const restored = deserializeDrawing(doc)! as Magnifier;
        expect(restored).toBeInstanceOf(Magnifier);
        expect(restored.magnifier.timeframe).toBe('15');
        expect(restored.magnifier.upColor).toBe('#112233');
        expect(restored.magnifier.downColor).toBe(''); // untouched field keeps its follow-the-chart default
    });

    it('exposes the timeframe select plus border/candle cosmetics via schema paths', () => {
        const d = createDrawing('magnifier', { paneId: 'price' })!;
        const fields = d.schema().fields;
        const tf = fields.find((f) => f.path === 'magnifier.timeframe');
        expect(tf?.kind).toBe('select');
        expect(tf?.options).toBe(MAGNIFIER_TIMEFRAME_OPTIONS);
        const paths = fields.map((f) => f.path);
        expect(paths).toContain('style.lineColor');
        expect(paths).toContain('magnifier.upColor');
        expect(paths).toContain('magnifier.downColor');
        // A settings patch through the dotted path lands on the live instance.
        d.applySettings({ 'magnifier.timeframe': '30' });
        expect((d as Magnifier).magnifier.timeframe).toBe('30');
    });

    it('labels timeframe values for display', () => {
        expect(magnifierTimeframeLabel('auto')).toBe('Auto');
        expect(magnifierTimeframeLabel('1')).toBe('1m');
        expect(magnifierTimeframeLabel('60')).toBe('1h');
        expect(magnifierTimeframeLabel('240')).toBe('4h');
        expect(magnifierTimeframeLabel('D')).toBe('1D');
        expect(magnifierTimeframeLabel('120')).toBe('2h'); // outside the option list still formats
    });
});
