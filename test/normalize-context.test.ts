import { describe, it, expect } from 'vitest';
import { normalizeContext } from '../src/engines/pinets/normalizeContext';

describe('normalizeContext · streaming plot dedupe', () => {
    it('keeps the LAST point per timestamp (streaming re-appends the forming bar each tick)', () => {
        const raw = {
            indicator: { title: 'T', overlay: false },
            plots: {
                P: {
                    options: { style: undefined },
                    data: [
                        { time: 1, value: 10 },
                        { time: 2, value: 20 },
                        { time: 2, value: 21 },
                        { time: 2, value: 22 }, // forming bar re-executed twice more
                    ],
                },
            },
        };
        const run = normalizeContext(raw);
        const p = run.plots.find((x) => x.key === 'P')!;
        expect(p.data.map((d) => [d.time, d.value])).toEqual([
            [1, 10],
            [2, 22],
        ]);
    });

    it('is a no-op (same array reference) when there are no duplicate timestamps', () => {
        const data = [
            { time: 1, value: 1 },
            { time: 2, value: 2 },
            { time: 3, value: 3 },
        ];
        const run = normalizeContext({ indicator: { title: 'T', overlay: false }, plots: { P: { options: {}, data } } });
        expect(run.plots[0]!.data).toBe(data);
    });

    it('reads fullContext when present (streamed page context)', () => {
        const raw = {
            plots: { PAGE: { options: {}, data: [] } },
            fullContext: { indicator: { title: 'Full', overlay: true }, plots: { P: { options: {}, data: [{ time: 1, value: 5 }] } } },
        };
        const run = normalizeContext(raw);
        expect(run.meta.title).toBe('Full');
        expect(run.meta.overlay).toBe(true);
        expect(run.plots.find((p) => p.key === 'P')).toBeTruthy();
    });
});
