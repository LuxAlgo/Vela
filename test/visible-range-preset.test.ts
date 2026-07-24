import { describe, it, expect } from 'vitest';
import { presetToRange } from '../src/core/visible-range';
import type { OHLCV } from '../src/core/model/ohlcv';

const DAY = 86_400_000;

/** Bars one day apart, ending at `last`, `n` of them. */
function bars(n: number, last: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = n - 1; i >= 0; i -= 1) {
        const time = last - i * DAY;
        out.push({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });
    }
    return out;
}

describe('presetToRange', () => {
    const last = Date.UTC(2024, 5, 15); // 2024-06-15
    const data = bars(400, last); // ~400 days back to 2023-05-12

    it('returns null with no bars', () => {
        expect(presetToRange('1M', [])).toBeNull();
    });

    it('frames the last bar as `to` for a span preset', () => {
        const r = presetToRange('1W', data)!;
        expect(r.to).toBe(last);
        expect(r.from).toBe(last - 7 * DAY);
    });

    it('maps each span preset to the right window before the last bar', () => {
        expect(presetToRange('1D', data)!.from).toBe(last - DAY);
        expect(presetToRange('1M', data)!.from).toBe(last - 30 * DAY);
        expect(presetToRange('3M', data)!.from).toBe(last - 90 * DAY);
        expect(presetToRange('6M', data)!.from).toBe(last - 180 * DAY);
        expect(presetToRange('1Y', data)!.from).toBe(last - 365 * DAY);
    });

    it('clamps `from` to the first loaded bar when the preset is deeper than history', () => {
        const shallow = bars(10, last); // only 10 days loaded
        const r = presetToRange('1Y', shallow)!;
        expect(r.from).toBe(shallow[0]!.time); // clamped, not last - 365d
        expect(r.to).toBe(last);
    });

    it('YTD starts at Jan 1 (UTC) of the last bar year', () => {
        const r = presetToRange('YTD', data)!;
        expect(r.from).toBe(Date.UTC(2024, 0, 1));
        expect(r.to).toBe(last);
    });

    it('ALL spans the first to the last bar', () => {
        const r = presetToRange('ALL', data)!;
        expect(r.from).toBe(data[0]!.time);
        expect(r.to).toBe(last);
    });
});
