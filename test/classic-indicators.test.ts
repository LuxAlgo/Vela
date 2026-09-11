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
            ema: 'EMA',
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
            sma: 'SMA',
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

    it('every study allows several instances per chart (users stack a study at different settings)', () => {
        for (const spec of classicSpecs) {
            expect(classicDescriptor(spec).multiInstance, spec.type).toBe(true);
        }
    });

    it('ships dedicated Simple and Exponential Moving Average studies', () => {
        const bars = Array.from({ length: 60 }, (_, i) => bar(100 + i, i));
        const byType = new Map(classicSpecs.map((s) => [s.type, s] as const));
        const smaSpec = byType.get('sma')!;
        const emaSpec = byType.get('ema')!;
        expect(smaSpec.title).toBe('Simple Moving Average');
        expect(emaSpec.title).toBe('Exponential Moving Average');
        expect(smaSpec.inputs.map((i) => i.key)).toEqual(['length', 'source', 'offset', 'color']);
        expect(emaSpec.inputs.map((i) => i.key)).toEqual(['length', 'source', 'offset', 'color']);
        const closes = bars.map((b) => b.close);
        const smaOut = smaSpec.compute(bars, classicDescriptor(smaSpec).defaultInputs()).plots[0]!;
        const emaOut = emaSpec.compute(bars, classicDescriptor(emaSpec).defaultInputs()).plots[0]!;
        expect(smaOut.title).toBe('SMA');
        expect(emaOut.title).toBe('EMA');
        expect(smaOut.values).toEqual(sma(closes, 20));
        expect(emaOut.values).toEqual(ema(closes, 20));
        // The offset shifts the line without changing its values.
        const shifted = smaSpec.compute(bars, { ...classicDescriptor(smaSpec).defaultInputs(), offset: 2 }).plots[0]!;
        expect(shifted.values[30]).toBe(smaOut.values[28]);
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
            id: 'native-test',
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

    it('resets VWAP on UTC quarter and year boundaries', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const flat = (iso: string, price: number): OHLCV => ({ time: Date.parse(iso), open: price, high: price, low: price, close: price, volume: 1 });
        const bars = [flat('2024-02-10T00:00:00Z', 10), flat('2024-03-31T23:00:00Z', 20), flat('2024-04-01T00:00:00Z', 30), flat('2025-01-01T00:00:00Z', 40)];
        const quarter = pointsOf(runOnce(spec, bars, { anchor: 'Quarter', source: 'Close' }).series![0]);
        expect(quarter.map((p) => p.value)).toEqual([10, 15, 30, 40]);
        const year = pointsOf(runOnce(spec, bars, { anchor: 'Year', source: 'Close' }).series![0]);
        expect(year.map((p) => p.value)).toEqual([10, 15, 20, 40]);
    });

    it('draws VWAP σ bands per enabled pair, each in its own color, fills optional', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        // Flat bars make every source = price: vwap of (100×1, 106×2) = 104, σ = √8.
        const bars: OHLCV[] = [
            { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
            { time: 60000, open: 106, high: 106, low: 106, close: 106, volume: 2 },
        ];
        const out = runOnce(spec, bars, { band1: true, band1Mult: 1, band2: false, band3: true, band3Mult: 2.5, band1Color: '#ff0000', band3Color: '#00ff00', band1FillColor: '#ff000014', band3FillColor: '#00ff0014' });
        expect(out.series!.map((s) => s.title)).toEqual(['VWAP', 'Upper 1σ', 'Lower 1σ', 'Upper 2.5σ', 'Lower 2.5σ']);
        const sd = Math.sqrt(8);
        expect(pointsOf(out.series![1])[1]!.value).toBeCloseTo(104 + sd, 10);
        expect(pointsOf(out.series![4])[1]!.value).toBeCloseTo(104 - 2.5 * sd, 10);
        const inkOf = (s: SeriesSpec): string | undefined => (isLineLikeSeries(s) ? s.style.color : undefined);
        expect(inkOf(out.series![1]!)).toBe('#ff0000');
        expect(inkOf(out.series![3]!)).toBe('#00ff00');
        expect(out.fills!.map((f) => f.color)).toEqual(['#ff000014', '#00ff0014']);

        // Fills are per band: band 1 keeps its fill, band 2's is off.
        const partial = runOnce(spec, bars, { band2: true, band2Fill: false });
        expect(partial.series).toHaveLength(5);
        expect(partial.fills!.map((f) => f.fromSeriesId)).toEqual([partial.series![1]!.id]);

        // Only band 1 is on by default. Inks differ per band, and each fill defaults to its
        // band's ink at 8% alpha.
        expect(runOnce(spec, bars).series).toHaveLength(3);
        const all = runOnce(spec, bars, { band2: true, band3: true });
        const inks = [1, 3, 5].map((i) => (isLineLikeSeries(all.series![i]!) ? all.series![i]!.style.color : ''));
        expect(new Set(inks).size).toBe(3);
        expect(all.fills!.map((f) => f.color)).toEqual(inks.map((c) => `${c}14`));

        // The fill color is its own input.
        const custom = runOnce(spec, bars, { band1FillColor: '#12345680' });
        expect(custom.fills![0]!.color).toBe('#12345680');
    });

    it('reads VWAP source through the shared source vocabulary', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const source = spec.inputs.find((i) => i.key === 'source')!;
        expect(source.options).toEqual(['Close', 'Open', 'High', 'Low', 'HL2', 'HLC3', 'OHLC4', 'HLCC4']);
        const bars: OHLCV[] = [{ time: 0, open: 1, high: 9, low: 3, close: 5, volume: 1 }];
        expect(pointsOf(runOnce(spec, bars, { source: 'High' }).series![0])[0]!.value).toBe(9);
        expect(pointsOf(runOnce(spec, bars, { source: 'HL2' }).series![0])[0]!.value).toBe(6);
    });

    it('lays out VWAP bands in a Bands group and inks + fills in a trailing Style group', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const anchor = spec.inputs.find((i) => i.key === 'anchor')!;
        expect(anchor.options).toEqual(['Day', 'Week', 'Month', 'Quarter', 'Year']);
        for (const n of [1, 2, 3]) {
            const on = spec.inputs.find((i) => i.key === `band${n}`)!;
            const mult = spec.inputs.find((i) => i.key === `band${n}Mult`)!;
            expect(on.type).toBe('bool');
            expect(on.group).toBe('Bands');
            expect(mult.title).toBe(''); // the toggle carries the row's label
            expect(mult.inline).toBe(on.inline);
            expect(mult.group).toBe('Bands');
            const color = spec.inputs.find((i) => i.key === `band${n}Color`)!;
            const fill = spec.inputs.find((i) => i.key === `band${n}Fill`)!;
            expect(color.group).toBe('Style');
            expect(fill.type).toBe('bool');
            expect(fill.inline).toBe(color.inline); // fill toggle sits beside its band's swatch
            const fillColor = spec.inputs.find((i) => i.key === `band${n}FillColor`)!;
            expect(fillColor.type).toBe('color');
            expect(fillColor.title).toBe(''); // unlabeled — the Fill toggle names it
            expect(fillColor.inline).toBe(color.inline);
        }
        const styled = spec.inputs.filter((i) => i.group === 'Style').map((i) => i.key);
        expect(styled).toEqual([
            'color',
            'band1Color', 'band1Fill', 'band1FillColor',
            'band2Color', 'band2Fill', 'band2FillColor',
            'band3Color', 'band3Fill', 'band3FillColor',
        ]);
        expect(spec.inputs.slice(-styled.length).map((i) => i.key)).toEqual(styled);
    });
});
