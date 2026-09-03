import { describe, it, expect, afterAll } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { InputValue } from '../src/core/model/inputs';
import type { SeriesPoint, SeriesSpec } from '../src/core/model/series';
import { isLineLikeSeries } from '../src/core/model/series';
import type { NativeIndicatorContext, NativeIndicatorOutput } from '../src/core/native-indicators/NativeIndicator';
import { getNativeIndicator, nativeIndicatorTypes, unregisterNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { classicSpecs, registerClassicIndicators, classicDescriptor } from '../src/core/native-indicators/classics';
import { sma, ema, rma, wma, stdev, rsi, linreg, highest, lowest, percentRank, swma, cumSum, change } from '../src/core/native-indicators/classics/math';
import type { ClassicIndicatorSpec } from '../src/core/native-indicators/classics';

function bar(close: number, i: number, volume?: number): OHLCV {
    return { time: i * 60000, open: close, high: close + 1, low: close - 1, close, ...(volume != null ? { volume } : {}) };
}

describe('classic math primitives', () => {
    it('sma warms up over the window then averages', () => {
        const out = sma([1, 2, 3, 4, 5], 3);
        expect(out[0]).toBeNaN();
        expect(out[1]).toBeNaN();
        expect(out.slice(2)).toEqual([2, 3, 4]);
    });

    it('ema seeds with the SMA of the first window and recurses', () => {
        const out = ema([1, 2, 3, 4], 2);
        expect(out[0]).toBeNaN();
        expect(out[1]).toBeCloseTo(1.5, 10);
        expect(out[2]).toBeCloseTo(2.5, 10);
        expect(out[3]).toBeCloseTo(3.5, 10);
    });

    it('rma uses the Wilder alpha', () => {
        const out = rma([1, 2, 3, 4], 2);
        expect(out[1]).toBeCloseTo(1.5, 10);
        expect(out[2]).toBeCloseTo(2.25, 10);
        expect(out[3]).toBeCloseTo(3.125, 10);
    });

    it('wma weights the newest values heaviest', () => {
        const out = wma([1, 2, 3], 3);
        expect(out[2]).toBeCloseTo(14 / 6, 10);
    });

    it('stdev is the population deviation', () => {
        const out = stdev([2, 4], 2);
        expect(out[1]).toBeCloseTo(1, 10);
    });

    it('rsi saturates at 100 on a monotonic rise', () => {
        const out = rsi([1, 2, 3, 4, 5, 6], 3);
        expect(out[5]).toBeCloseTo(100, 6);
    });

    it('linreg reproduces a perfect line exactly', () => {
        const out = linreg([1, 2, 3, 4], 3);
        expect(out[2]).toBeCloseTo(3, 10);
        expect(out[3]).toBeCloseTo(4, 10);
    });

    it('highest/lowest track the window extremes', () => {
        expect(highest([1, 3, 2], 2).slice(1)).toEqual([3, 3]);
        expect(lowest([1, 3, 2], 2).slice(1)).toEqual([1, 2]);
    });

    it('percentRank counts trailing values at or below the current one', () => {
        const out = percentRank([1, 2, 3, 4], 3);
        expect(out[3]).toBeCloseTo(100, 10);
    });

    it('swma applies the 1-2-2-1 kernel', () => {
        const out = swma([1, 2, 3, 4]);
        expect(out[3]).toBeCloseTo(2.5, 10);
    });

    it('cumSum holds the accumulation across a NaN term', () => {
        const out = cumSum([1, Number.NaN, 2]);
        expect(out[0]).toBe(1);
        expect(out[1]).toBe(1);
        expect(out[2]).toBe(3);
    });

    it('windowed ops restart their warm-up after a mid-stream gap', () => {
        const out = sma([1, 2, Number.NaN, 3, 4], 2);
        expect(out[1]).toBeCloseTo(1.5, 10);
        expect(out[2]).toBeNaN();
        expect(out[3]).toBeNaN();
        expect(out[4]).toBeCloseTo(3.5, 10);
    });

    it('change propagates gaps', () => {
        const out = change([1, Number.NaN, 3]);
        expect(out[1]).toBeNaN();
        expect(out[2]).toBeNaN();
    });
});

describe('classic catalog registration', () => {
    afterAll(() => {
        for (const spec of classicSpecs) unregisterNativeIndicator(spec.type);
    });

    it('registers every catalog entry with a unique type', () => {
        const types = classicSpecs.map((s) => s.type);
        expect(new Set(types).size).toBe(types.length);
        registerClassicIndicators();
        const registered = nativeIndicatorTypes();
        for (const t of types) expect(registered).toContain(t);
        expect(types.length).toBeGreaterThanOrEqual(70);
    });

    it('legend short titles match the library declarations', () => {
        // Second argument of each published `indicator("…", "…")` in the LuxAlgo library.
        const libraryShort: Record<string, string> = {
            'percent-b': '%B',
            '52-week-high-low': '52W H/L',
            'accumulation-distribution': 'A/D',
            aroon: 'Aroon',
            'average-directional-index': 'ADX',
            'average-true-range': 'ATR',
            'awesome-oscillator': 'AO',
            'balance-of-power': 'BOP',
            bandwidth: 'BandWidth',
            'bollinger-bands': 'BB',
            'chaikin-money-flow': 'CMF',
            'chaikin-oscillator': 'Chaikin Osc',
            'chaikin-volatility': 'CHV',
            'chandelier-exit': 'CE',
            'chande-kroll-stop': 'CKS',
            'chande-momentum-oscillator': 'CMO',
            'choppiness-index': 'CHOP',
            'commodity-channel-index': 'CCI',
            'connors-rsi': 'CRSI',
            'coppock-curve': 'Coppock',
            'detrended-price-oscillator': 'DPO',
            'donchian-channels': 'DC',
            'ease-of-movement': 'EOM',
            'elder-ray': 'Elder Ray',
            'fisher-transform': 'Fisher',
            'force-index': 'FI',
            'gator-oscillator': 'Gator Oscillator',
            'historical-volatility': 'HV',
            'intraday-intensity': 'Intraday Intensity',
            'keltner-channels': 'KC',
            'klinger-oscillator': 'KVO',
            'know-sure-thing': 'KST',
            'linear-regression': 'LinReg',
            macd: 'MACD',
            'ma-envelope': 'MA Env',
            'mass-index': 'MI',
            'money-flow-index': 'MFI',
            'moving-average': 'MA',
            'negative-volume-index': 'Negative Volume Index',
            'on-balance-volume': 'OBV',
            'parabolic-sar': 'SAR',
            ppo: 'PPO',
            pvo: 'PVO',
            'pivot-points': 'Pivots',
            'positive-volume-index': 'Positive Volume Index',
            'price-volume-trend': 'PVT',
            'rate-of-change': 'ROC',
            rsi: 'RSI',
            'relative-vigor-index': 'RVGI',
            'relative-volatility-index': 'RVI',
            rma: 'RMA',
            'schaff-trend-cycle': 'Schaff Trend Cycle',
            'smi-ergodic': 'SMIE',
            'standard-deviation': 'StdDev',
            stochastic: 'Stoch',
            'stochastic-rsi': 'Stoch RSI',
            supertrend: 'SuperTrend',
            trix: 'TRIX',
            'true-strength-index': 'TSI',
            'ttm-squeeze': 'TTM Squeeze',
            'ulcer-index': 'Ulcer Index',
            'ultimate-oscillator': 'UO',
            vidya: 'VIDYA',
            'volume-flow-indicator': 'Volume Flow Indicator',
            'volume-oscillator': 'Vol Osc',
            'vortex-indicator': 'VI',
            vwap: 'VWAP',
            'williams-alligator': 'Alligator',
            'williams-fractal': 'Fractals',
            'williams-percent-r': '%R',
            zigzag: 'ZigZag',
            zlema: 'ZLEMA',
        };
        for (const spec of classicSpecs) {
            const expected = libraryShort[spec.type];
            expect(expected, spec.type).toBeDefined();
            expect(spec.shortTitle ?? spec.title, spec.type).toBe(expected);
        }
    });

    it('every spec declares defaults for each of its inputs', () => {
        for (const spec of classicSpecs) {
            const desc = classicDescriptor(spec);
            const defaults = desc.defaultInputs();
            for (const input of desc.inputsSchema()) {
                expect(defaults[input.key], `${spec.type}:${input.key}`).toBe(input.defval);
            }
        }
    });

    it('every compute yields bar-aligned plot arrays on synthetic bars', () => {
        const bars = Array.from({ length: 400 }, (_, i) => bar(100 + 10 * Math.sin(i / 15) + (i % 7), i, 1000 + (i % 50) * 10));
        for (const spec of classicSpecs) {
            const desc = classicDescriptor(spec);
            const out = spec.compute(bars, desc.defaultInputs());
            for (const plot of out.plots) {
                expect(plot.values.length, `${spec.type}:${plot.key}`).toBe(bars.length);
            }
        }
    });
});

describe('classic descriptor adapter', () => {
    function runOnce(spec: ClassicIndicatorSpec, bars: OHLCV[], inputs?: Record<string, InputValue>): NativeIndicatorOutput {
        const desc = classicDescriptor(spec);
        const instance = desc.create();
        let captured: NativeIndicatorOutput | undefined;
        const ctx: NativeIndicatorContext = {
            symbol: 'TEST',
            timeframe: '1m',
            live: false,
            bars: () => bars,
            data: undefined as never,
            emit: (out) => {
                captured = out;
            },
            pushData: () => {},
            setStatus: () => {},
        };
        instance.start(ctx, inputs ?? desc.defaultInputs());
        instance.stop();
        expect(captured).toBeDefined();
        return captured!;
    }

    function pointsOf(series: SeriesSpec | undefined): SeriesPoint[] {
        expect(series).toBeDefined();
        expect(isLineLikeSeries(series!)).toBe(true);
        return isLineLikeSeries(series!) ? series!.points : [];
    }

    it('converts warm-up NaNs to whitespace points and wires bands to plot ids', () => {
        const spec: ClassicIndicatorSpec = {
            type: 'test-classic',
            title: 'Test',
            overlay: false,
            inputs: [],
            compute: (bars) => ({
                plots: [
                    { key: 'a', title: 'A', values: bars.map((_, i) => (i === 0 ? Number.NaN : i)), color: '#ffffff' },
                    { key: 'b', title: 'B', values: bars.map((_, i) => i + 1), color: '#000000' },
                ],
                bands: [{ key: 'ab', from: 'a', to: 'b', color: '#12345678' }],
                levels: [{ key: 'zero', price: 0 }],
            }),
        };
        const bars = [bar(1, 0), bar(2, 1), bar(3, 2)];
        const out = runOnce(spec, bars);
        expect(out.series).toHaveLength(2);
        const a = pointsOf(out.series![0]);
        expect(a[0]!.value).toBeNull();
        expect(a[1]!.value).toBe(1);
        expect(out.fills).toHaveLength(1);
        expect(out.fills![0]!.fromSeriesId).toBe(out.series![0]!.id);
        expect(out.fills![0]!.toSeriesId).toBe(out.series![1]!.id);
        expect(out.priceLines).toHaveLength(1);
        expect(out.priceLines![0]!.price).toBe(0);
    });

    it('produces stable series ids across recomputes', () => {
        const spec = classicSpecs.find((s) => s.type === 'macd')!;
        const bars = Array.from({ length: 100 }, (_, i) => bar(100 + Math.sin(i / 5), i, 1000));
        const first = runOnce(spec, bars);
        const second = runOnce(spec, bars.concat(bar(101, 100, 1000)));
        expect(second.series!.map((s) => s.id)).toEqual(first.series!.map((s) => s.id));
    });

    it('computes a monotonic RSI and a symmetric Bollinger band', () => {
        const rsiSpec = classicSpecs.find((s) => s.type === 'rsi')!;
        const rising = Array.from({ length: 50 }, (_, i) => bar(100 + i, i));
        const rsiOut = runOnce(rsiSpec, rising);
        expect(pointsOf(rsiOut.series![0])[49]!.value).toBeCloseTo(100, 4);
        const bbSpec = classicSpecs.find((s) => s.type === 'bollinger-bands')!;
        const bbOut = runOnce(bbSpec, rising);
        const i = 49;
        const b = pointsOf(bbOut.series![0])[i]!.value!;
        const u = pointsOf(bbOut.series![1])[i]!.value!;
        const l = pointsOf(bbOut.series![2])[i]!.value!;
        expect(u - b).toBeCloseTo(b - l, 8);
        expect(u).toBeGreaterThan(l);
    });

    it('keeps volume studies honest on volume-less bars', () => {
        const cmf = classicSpecs.find((s) => s.type === 'chaikin-money-flow')!;
        const bars = Array.from({ length: 60 }, (_, i) => bar(100 + (i % 5), i)); // no volume anywhere
        const out = runOnce(cmf, bars);
        expect(pointsOf(out.series![0]).every((p) => p.value === null)).toBe(true);
    });

    it('flips the SuperTrend color with the trend', () => {
        const spec = classicSpecs.find((s) => s.type === 'supertrend')!;
        const up = Array.from({ length: 60 }, (_, i) => bar(100 + i * 2, i));
        const down = Array.from({ length: 60 }, (_, i) => bar(220 - i * 2, i + 60));
        const out = runOnce(spec, [...up, ...down]);
        const colors = new Set(pointsOf(out.series![0]).map((p) => p.color).filter((c): c is string => c != null));
        expect(colors.size).toBe(2);
    });

    it('anchors VWAP accumulation to the UTC day', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const day = 86400000;
        const bars: OHLCV[] = [
            { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 100 },
            { time: 60000, open: 20, high: 20, low: 20, close: 20, volume: 100 },
            { time: day, open: 30, high: 30, low: 30, close: 30, volume: 100 },
        ];
        const out = runOnce(spec, bars, { anchor: 'Day', source: 'Close', color: '#ffffff' });
        const points = pointsOf(out.series![0]);
        expect(points[1]!.value).toBeCloseTo(15, 10);
        expect(points[2]!.value).toBeCloseTo(30, 10); // reset at the new day
    });
});
