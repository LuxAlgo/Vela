// The neutral engine-context snapshot (src/engines/pinets/contextSnapshot.ts):
// serializable extraction, live-reference stripping, and the select filter.
import { describe, it, expect } from 'vitest';
import { snapshotFromCtx } from '../src/engines/pinets/contextSnapshot';

const ctx = {
    idx: 41,
    indicator: { title: 'My Ind', overlay: true, precision: 2 },
    plots: { ema: { title: 'EMA', options: {}, data: [{ time: 1, value: 10 }, { time: 2, value: 11 }] } },
    params: { length: 14 },
    var: { acc: 3.5, _hidden: 1, fn: () => 0 },
    let: { note: 'hi' },
    result: { levels: [1, 2, 3] },
    warnings: [{ message: 'w1', bar: 5 }],
};

describe('snapshotFromCtx', () => {
    it('extracts the neutral envelope; functions and _private vars are dropped', () => {
        const s = snapshotFromCtx(ctx, 'idle');
        expect(s).toMatchObject({ language: 'pine', phase: 'idle', barIndex: 41 });
        expect(s.meta).toMatchObject({ title: 'My Ind', overlay: true, precision: 2 });
        expect(s.plots.ema).toEqual([{ time: 1, value: 10 }, { time: 2, value: 11 }]);
        expect(s.variables).toEqual({ 'params.length': 14, 'var.acc': 3.5, 'let.note': 'hi' });
        expect(s.result).toEqual({ levels: [1, 2, 3] });
        expect(s.warnings).toEqual([{ message: 'w1', method: undefined, bar: 5 }]);
    });

    it('snapshots are copies — mutating them never touches the source', () => {
        const s = snapshotFromCtx(ctx, 'streaming');
        (s.result as { levels: number[] }).levels.push(99);
        expect((ctx.result.levels as number[])).toEqual([1, 2, 3]);
    });

    it('select limits extraction to the requested keys', () => {
        const s = snapshotFromCtx(ctx, 'idle', ['result', 'barIndex']);
        expect(s.result).toEqual({ levels: [1, 2, 3] });
        expect(s.variables).toEqual({});
        expect(s.plots).toEqual({});
        expect(s.meta.title).toBe(''); // meta not selected
    });

    it('prefers fullContext when present (streamed pages)', () => {
        const s = snapshotFromCtx({ fullContext: ctx }, 'streaming');
        expect(s.barIndex).toBe(41);
        expect(s.result).toEqual({ levels: [1, 2, 3] });
    });
});
