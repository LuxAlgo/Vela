import { describe, it, expect } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import { heikinAshiFull, heikinAshiNext } from '../src/core/price-styles/heikin-ashi';
import { barTransformFor, parseExtendedTicker } from '../src/core/price-styles/BarTransform';
import { registerBuiltinChartTypes } from '../src/chart-types/builtins';

registerBuiltinChartTypes(); // the mapping is registry-driven (normally seeded by the Vela constructor)

function bar(i: number, open: number, high: number, low: number, close: number, volume?: number): OHLCV {
    return { time: 1_700_000_000_000 + i * 60_000, open, high, low, close, ...(volume != null ? { volume } : {}) };
}

const RAW = [
    bar(0, 100, 104, 98, 102, 500),
    bar(1, 102, 108, 101, 107, 700),
    bar(2, 107, 109, 103, 104, 300),
    bar(3, 104, 105, 99, 100),
];

describe('heikin ashi transform', () => {
    it('applies the recursion: close = OHLC mean, open = prior HA midpoint (seeded (O+C)/2)', () => {
        const ha = heikinAshiFull(RAW);
        expect(ha[0]!.close).toBeCloseTo((100 + 104 + 98 + 102) / 4, 10);
        expect(ha[0]!.open).toBeCloseTo((100 + 102) / 2, 10); // seed
        expect(ha[1]!.open).toBeCloseTo((ha[0]!.open + ha[0]!.close) / 2, 10);
        expect(ha[2]!.open).toBeCloseTo((ha[1]!.open + ha[1]!.close) / 2, 10);
    });

    it('high/low envelope the real extremes AND the HA body; time + volume carry through', () => {
        const ha = heikinAshiFull(RAW);
        for (let i = 0; i < RAW.length; i += 1) {
            const r = RAW[i]!;
            const h = ha[i]!;
            expect(h.high).toBeCloseTo(Math.max(r.high, h.open, h.close), 10);
            expect(h.low).toBeCloseTo(Math.min(r.low, h.open, h.close), 10);
            expect(h.high).toBeGreaterThanOrEqual(Math.max(h.open, h.close));
            expect(h.low).toBeLessThanOrEqual(Math.min(h.open, h.close));
            expect(h.time).toBe(r.time);
            expect(h.volume).toBe(r.volume);
        }
    });

    it('incremental derivation matches the full recompute (append + forming-bar replace)', () => {
        const ha = heikinAshiFull(RAW);
        // Append: next(raw[i], ha[i-1]) === full()[i]
        for (let i = 0; i < RAW.length; i += 1) {
            expect(heikinAshiNext(RAW[i]!, ha[i - 1])).toEqual(ha[i]);
        }
        // Forming-bar replace: a corrected last raw bar re-derives against the SAME previous HA bar.
        const corrected = { ...RAW[3]!, high: 111, close: 110 };
        const replaced = heikinAshiNext(corrected, ha[2]);
        expect(replaced).toEqual(heikinAshiFull([...RAW.slice(0, 3), corrected])[3]);
    });

    it('barTransformFor: heikinashi only, as a stable singleton', () => {
        const t = barTransformFor('heikinashi');
        expect(t).not.toBeNull();
        expect(barTransformFor('heikinashi')).toBe(t); // identity-comparable
        for (const s of ['candles', 'bars', 'line', 'area', 'baseline', 'footprint', 'standard', undefined]) {
            expect(barTransformFor(s)).toBeNull();
        }
    });

    it('parseExtendedTicker: plain, modifier, and standard forms', () => {
        expect(parseExtendedTicker('BINANCE:BTCUSDT')).toEqual({ symbol: 'BINANCE:BTCUSDT', modifier: null, transform: null });
        const ha = parseExtendedTicker('BINANCE:BTCUSDT;heikinashi');
        expect(ha.symbol).toBe('BINANCE:BTCUSDT');
        expect(ha.modifier).toBe('heikinashi');
        expect(ha.transform).toBe(barTransformFor('heikinashi'));
        // Explicit standard: a modifier that resolves to a RAW transform (the opt-out marker).
        expect(parseExtendedTicker('TEST;standard')).toEqual({ symbol: 'TEST', modifier: 'standard', transform: null });
        // Degenerate separators stay plain symbols.
        expect(parseExtendedTicker(';heikinashi').modifier).toBeNull();
        expect(parseExtendedTicker('TEST;').modifier).toBeNull();
        // Unknown suffixes are NOT modifiers — the symbol stays whole (mirrors the engine parser).
        expect(parseExtendedTicker('TEST;xyz')).toEqual({ symbol: 'TEST;xyz', modifier: null, transform: null });
    });
});
