import { describe, it, expect } from 'vitest';
import { toScene } from '../src/engines/pinets/toScene';
import type { PineRun, PinePlot } from '../src/engines/pinets/PineRun';
import type { LineLikeSeries, CandleSeries } from '../src/core/model/series';

/** A line plot with per-bar points (value + per-point options). */
function linePlot(key: string, points: Array<{ v: number | null; color?: string }>, options: Record<string, unknown> = {}): PinePlot {
    return {
        key,
        title: key,
        style: undefined,
        options,
        data: points.map((p, i) => ({ time: i * 3600000, value: p.v, options: p.color ? { color: p.color } : {} })),
    };
}

function run(plots: PinePlot[], overlay = false): PineRun {
    return { meta: { title: 'T', overlay }, plots };
}

describe('toScene · fill styling', () => {
    const anchors = (): PinePlot[] => [linePlot('A', [{ v: 1 }, { v: 2 }, { v: 3 }]), linePlot('B', [{ v: 0 }, { v: 0 }, { v: 0 }])];

    function fill(opts: Record<string, unknown>, ptOptions: Array<Record<string, unknown>>): PinePlot {
        return {
            key: 'Fill 1',
            title: 'Fill 1',
            style: 'fill',
            options: { style: 'fill', ...opts },
            plot1: 'A',
            plot2: 'B',
            data: ptOptions.map((o, i) => ({ time: i * 3600000, value: true, options: o })),
        };
    }

    it('flat fill → single color, no per-bar arrays', () => {
        const f = fill({}, [{ color: '#11223344' }, { color: '#11223344' }, { color: '#11223344' }]);
        const { model } = toScene(run([...anchors(), f]), 'ind');
        expect(model.fills).toHaveLength(1);
        expect(model.fills[0]!.color?.toLowerCase()).toBe('#11223344');
        expect(model.fills[0]!.colors).toBeUndefined();
        expect(model.fills[0]!.gradient).toBeUndefined();
    });

    it('conditional fill (color varies per bar) → colors[]', () => {
        const f = fill({}, [{ color: '#00ff00aa' }, { color: '#ff0000aa' }, { color: '#00ff00aa' }]);
        const { model } = toScene(run([...anchors(), f]), 'ind');
        expect(model.fills[0]!.colors).toEqual(['#00ff00aa', '#ff0000aa', '#00ff00aa']);
        expect(model.fills[0]!.color).toBeUndefined();
    });

    it('gradient fill (gradient:true + top/bottom) → gradient[] stops, raw colors incl. alpha 00', () => {
        const f = fill({ gradient: true }, [
            { top_value: 5, bottom_value: 0, top_color: '#f2364500', bottom_color: '#f236457f' },
            { top_value: 3, bottom_value: 0, top_color: '#f2364500', bottom_color: '#f236457f' },
            { top_value: 1, bottom_value: 0, top_color: '#f2364500', bottom_color: '#f236457f' },
        ]);
        const { model } = toScene(run([...anchors(), f]), 'ind');
        const g = model.fills[0]!.gradient!;
        expect(g).toHaveLength(3);
        expect(g[0]).toEqual({ topValue: 5, bottomValue: 0, topColor: '#f2364500', bottomColor: '#f236457f' });
        expect(model.fills[0]!.colors).toBeUndefined();
    });
});

describe('toScene · barcolor / plotcandle', () => {
    it('barcolor plot → model.barColors (na bars skipped)', () => {
        const bc: PinePlot = {
            key: 'Trend',
            style: 'barcolor',
            options: { style: 'barcolor' },
            data: [
                { time: 0, value: true, options: { color: '#00ff00ff' } },
                { time: 3600000, value: null, options: {} },
                { time: 7200000, value: true, options: { color: '#ff0000ff' } },
            ],
        };
        const { model } = toScene(run([bc]), 'ind');
        expect(model.barColors).toEqual([
            { time: 0, color: '#00ff00ff' },
            { time: 7200000, color: '#ff0000ff' },
        ]);
    });

    it('plotcandle with per-bar color/wick/border → candle series barColors', () => {
        const candle: PinePlot = {
            key: 'plot',
            style: 'candle',
            options: { style: 'candle' },
            data: [
                { time: 0, value: [10, 12, 9, 11], options: { color: '#089981ff', wickcolor: '#089981ff', bordercolor: '#089981ff' } },
                { time: 3600000, value: [11, 11.5, 8, 9], options: { color: '#f23645ff', wickcolor: '#aaaaaaff', bordercolor: '#000000ff' } },
            ],
        };
        const { model } = toScene(run([candle], true), 'ind');
        const c = model.series.find((s) => s.kind === 'candle') as CandleSeries;
        expect(c.barColors).toEqual([
            { color: '#089981ff', wickColor: '#089981ff', borderColor: '#089981ff' },
            { color: '#f23645ff', wickColor: '#aaaaaaff', borderColor: '#000000ff' },
        ]);
    });
});

describe('toScene · linestyle / display', () => {
    it('plot linestyle "linestyle_dashed" → series.style.lineStyle dashed', () => {
        const p = linePlot('Zero', [{ v: 0 }, { v: 0 }], { color: '#888888', linestyle: 'linestyle_dashed' });
        const { model } = toScene(run([p]), 'ind');
        expect((model.series[0] as LineLikeSeries).style.lineStyle).toBe('dashed');
    });

    it('hline linestyle "dashed" → priceLine.lineStyle dashed', () => {
        const h: PinePlot = {
            key: 'OB',
            title: 'OB',
            style: 'hline',
            options: { style: 'hline', color: '#888888', linestyle: 'dashed' },
            data: [{ time: 0, value: 70, options: {} }],
        };
        const { model } = toScene(run([h]), 'ind');
        expect(model.priceLines[0]!.lineStyle).toBe('dashed');
    });

    it('display.data_window → series kept but hidden (anchor only)', () => {
        const p = linePlot('Helper', [{ v: 1 }, { v: 2 }], { color: '#888888', display: 'data_window' });
        const { model } = toScene(run([p]), 'ind');
        expect(model.series).toHaveLength(1);
        expect(model.series[0]!.visible).toBe(false);
    });
});
