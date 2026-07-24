import { describe, it, expect } from 'vitest';
import { normalizeContext } from '../src/engines/pinets/normalizeContext';
import { toScene } from '../src/engines/pinets/toScene';
import type { LineLikeSeries } from '../src/core/model/series';
import emaFixture from './fixtures/ema.json';
import macdFixture from './fixtures/macd.json';
import rsiFixture from './fixtures/rsi.json';
import extrasFixture from './fixtures/extras.json';

describe('pine/toScene (against real PineTS fixtures)', () => {
    it('EMA: single overlay line, drawing containers skipped, na→null, per-point color', () => {
        const { model } = toScene(normalizeContext(emaFixture), 'ind-1');
        expect(model.overlay).toBe(true);
        expect(model.series).toHaveLength(1); // only EMA — __labels__/__lines__/… skipped
        const ema = model.series[0] as LineLikeSeries;
        expect(ema.kind).toBe('line');
        expect(ema.title).toBe('EMA');
        expect(ema.points).toHaveLength(150);
        expect(ema.points[0]!.value).toBeNull(); // leading na
        expect(typeof ema.points[40]!.value).toBe('number');
        expect(ema.style.color.toLowerCase()).toBe('#ff9800'); // color.orange resolved
    });

    it('MACD: two lines + one histogram in a study pane', () => {
        const { model } = toScene(normalizeContext(macdFixture), 'ind-1');
        expect(model.overlay).toBe(false);
        expect(model.series.map((s) => s.kind).sort()).toEqual(['histogram', 'line', 'line']);
        expect(model.series.find((s) => s.kind === 'histogram')?.title).toBe('Hist');
    });

    it('RSI: one line + two hlines → price lines', () => {
        const { model } = toScene(normalizeContext(rsiFixture), 'ind-1');
        expect(model.series.filter((s) => s.kind === 'line')).toHaveLength(1);
        expect(model.priceLines.map((p) => p.price).sort((a, b) => a - b)).toEqual([30, 70]);
    });

    it('Extras: fill resolves plot1/plot2 → series ids; markers + background present', () => {
        const { model } = toScene(normalizeContext(extrasFixture), 'ind-1');
        const lines = model.series.filter((s) => s.kind === 'line');
        expect(lines).toHaveLength(2); // E1, E2
        expect((model.labels ?? []).length).toBeGreaterThan(0); // Buy plotshape → label
        expect(model.fills).toHaveLength(1);
        const e1 = lines.find((s) => s.title === 'E1')!;
        const e2 = lines.find((s) => s.title === 'E2')!;
        expect(model.fills[0]!.fromSeriesId).toBe(e1.id);
        expect(model.fills[0]!.toSeriesId).toBe(e2.id);
        expect(model.backgrounds.length).toBeGreaterThan(0);
    });
});
