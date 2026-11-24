import { describe, it, expect, afterAll } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { InputValue } from '../src/core/model/inputs';
import type { SeriesPoint, SeriesSpec } from '../src/core/model/series';
import { isLineLikeSeries } from '../src/core/model/series';
import type { NativeIndicatorContext, NativeIndicatorOutput } from '../src/core/native-indicators/NativeIndicator';
import { getNativeIndicator, nativeIndicatorTypes, unregisterNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import { classicSpecs, registerClassicIndicators, classicDescriptor } from '../src/core/native-indicators/classics';
import { sma, ema, rma, wma, stdev, stdError, rsi, linreg, highest, lowest, percentRank, rankCorrelation, elapsedDays, swma, cumSum, change } from '../src/core/native-indicators/classics/math';
import { gradient } from '../src/core/native-indicators/classics/shared';
import type { ClassicIndicatorSpec, ClassicPlot } from '../src/core/native-indicators/classics';
import { BULLISH, BEARISH, INFO, NEUTRAL, WARNING } from '../src/core/palette';
import { createTranslator, type MessageLike } from '../src/plugin';

/** The catalog's text as an English chart shows it. */
const english = createTranslator({ locale: 'en' });
const en = (m: MessageLike | undefined): string | undefined => (m === undefined ? undefined : english.t(m));

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

    it('stdError is the residual error of the fitted line over n − 2 degrees of freedom', () => {
        // Fit of 1, 2, 4 on x = 0, 1, 2: slope 1.5, intercept 5/6; residuals 1/6, −1/3, 1/6.
        const out = stdError([1, 2, 4], 3);
        expect(out[1]).toBeNaN();
        expect(out[2]).toBeCloseTo(Math.sqrt(1 / 6), 12);
        expect(stdError([3, 5, 7, 9], 4)[3]).toBeCloseTo(0, 12); // a perfect line leaves no error
        expect(stdError([1, 2, 4], 2)[2]).toBeNaN(); // two points always fit: nothing to measure
    });

    it('rankCorrelation runs from −1 to 1 and shares ranks between equal values', () => {
        expect(rankCorrelation([1, 2, 3, 4], 4)[3]).toBe(1);
        expect(rankCorrelation([4, 3, 2, 1], 4)[3]).toBe(-1);
        // 1, 2, 2: the two 2s share rank 1.5, so the squared rank gaps sum to 0.5 → 1 − 6·0.5/24.
        expect(rankCorrelation([1, 2, 2], 3)[2]).toBeCloseTo(0.875, 12);
        expect(rankCorrelation([5, 1, 2, 2], 3)[3]).toBeCloseTo(0.875, 12); // each bar ranks its own window
        expect(rankCorrelation([1, 2, 3], 4)[2]).toBeNaN();
    });

    it('elapsedDays measures the time since the previous bar, in days', () => {
        const day = 86_400_000;
        const at = (time: number): OHLCV => ({ time, open: 1, high: 1, low: 1, close: 1 });
        const out = elapsedDays([at(0), at(day), at(4 * day), at(4 * day + day / 24), at(4 * day + day / 24)]);
        expect(out[0]).toBeNaN();
        expect(out.slice(1, 4)).toEqual([1, 3, 1 / 24]);
        expect(out[4]).toBeNaN(); // time did not advance
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
        // Second argument of each published `indicator("…", "…")` in the LuxAlgo library;
        // the library publishes the regression as one study, so LSMA and LRS name themselves.
        const libraryShort: Record<string, string> = {
            'percent-b': '%B',
            '52-week-high-low': '52W H/L',
            'accelerator-oscillator': 'AC',
            'accumulation-distribution': 'A/D',
            'accumulative-swing-index': 'Accumulative Swing Index',
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
            'correlation-coefficient': 'CC',
            'correlation-log': 'Correlation - Log',
            'detrended-price-oscillator': 'DPO',
            'donchian-channels': 'DC',
            ema: 'EMA',
            'ease-of-movement': 'EOM',
            'elder-ray': 'Elder Ray',
            'fisher-transform': 'Fisher',
            'force-index': 'FI',
            'gator-oscillator': 'Gator Oscillator',
            'historical-volatility': 'HV',
            'ichimoku-cloud': 'Ichimoku',
            'intraday-intensity': 'Intraday Intensity',
            'keltner-channels': 'KC',
            'klinger-oscillator': 'KVO',
            'know-sure-thing': 'KST',
            lsma: 'LSMA',
            'linear-regression-slope': 'LRS',
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
            'standard-error-bands': 'SEB',
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
        // Studies the library does not publish take the catalog's own short names.
        const catalogShort: Record<string, string> = {
            'advance-decline': 'Advance/Decline',
            'average-price': 'Average Price',
            'chop-zone': 'Chop Zone',
            'ema-cross': 'EMA Cross',
            'guppy-multiple-moving-average': 'GMMA',
            'ma-cross': 'MA Cross',
            'ma-with-ema-cross': 'MA/EMA Cross',
            'majority-rule': 'Majority Rule',
            'median-price': 'Median Price',
            momentum: 'Mom',
            'moving-average-channel': 'MAC',
            'moving-average-double': 'MA Double',
            'moving-average-multiple': 'MA Multiple',
            'moving-average-triple': 'MA Triple',
            'net-volume': 'Net Volume',
            'rank-correlation-index': 'RCI',
            'standard-error': 'StdErr',
            'trend-strength-index': 'Trend Strength Index',
            'typical-price': 'Typical Price',
            'volatility-close-to-close': 'Vol Close-to-Close',
            'volatility-index': 'Vol Index',
            'volatility-ohlc': 'Vol OHLC',
            'volatility-zero-trend': 'Vol Zero Trend',
        };
        for (const spec of classicSpecs) {
            const expected = libraryShort[spec.type] ?? catalogShort[spec.type];
            expect(expected, spec.type).toBeDefined();
            expect(en(spec.shortTitle ?? spec.title), spec.type).toBe(expected);
        }
    });

    it('no two studies read the same in the legend', () => {
        const names = classicSpecs.map((s) => en(s.shortTitle ?? s.title));
        expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
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
        expect(en(smaSpec.title)).toBe('Simple Moving Average');
        expect(en(emaSpec.title)).toBe('Exponential Moving Average');
        expect(smaSpec.inputs.map((i) => i.key)).toEqual(['length', 'source', 'offset', 'color']);
        expect(emaSpec.inputs.map((i) => i.key)).toEqual(['length', 'source', 'offset', 'color']);
        const closes = bars.map((b) => b.close);
        const smaOut = smaSpec.compute(bars, classicDescriptor(smaSpec).defaultInputs()).plots[0]!;
        const emaOut = emaSpec.compute(bars, classicDescriptor(emaSpec).defaultInputs()).plots[0]!;
        expect(en(smaOut.title)).toBe('SMA');
        expect(en(emaOut.title)).toBe('EMA');
        expect(smaOut.values).toEqual(sma(closes, 20));
        expect(emaOut.values).toEqual(ema(closes, 20));
        // The offset shifts the line without changing its values.
        const shifted = smaSpec.compute(bars, { ...classicDescriptor(smaSpec).defaultInputs(), offset: 2 }).plots[0]!;
        expect(shifted.values[30]).toBe(smaOut.values[28]);
    });

    it('ships the regression as an LSMA on price and a Linear Regression Slope in its own pane', () => {
        const bars = Array.from({ length: 200 }, (_, i) => bar(100 + 10 * Math.sin(i / 20) + i * 0.1, i));
        const closes = bars.map((b) => b.close);
        const byType = new Map(classicSpecs.map((s) => [s.type, s] as const));
        expect(byType.has('linear-regression')).toBe(false);

        const lsma = byType.get('lsma')!;
        expect(en(lsma.title)).toBe('Least Squares Moving Average');
        expect(lsma.overlay).toBe(true);
        const lsmaOut = lsma.compute(bars, classicDescriptor(lsma).defaultInputs());
        expect(lsmaOut.plots).toHaveLength(1);
        expect(lsmaOut.plots[0]!.values).toEqual(linreg(closes, 25, 0));
        // The offset steps back along each bar's own fit, like the Moving Average study's LSMA type.
        const stepped = lsma.compute(bars, { ...classicDescriptor(lsma).defaultInputs(), length: 30, offset: 3 }).plots[0]!;
        expect(stepped.values).toEqual(linreg(closes, 30, 3));

        const slope = byType.get('linear-regression-slope')!;
        expect(en(slope.title)).toBe('Linear Regression Slope');
        expect(slope.overlay).toBe(false);
        const slopeOut = slope.compute(bars, classicDescriptor(slope).defaultInputs());
        const curve = linreg(closes, 100, 0);
        const prior = linreg(closes, 100, 1);
        expect(slopeOut.plots[0]!.values[150]).toBeCloseTo(curve[150]! - prior[150]!, 10);
        expect(slopeOut.plots[0]!.values[98]).toBeNaN();
        expect(slopeOut.levels?.map((l) => l.price)).toEqual([0]);
    });

    it('never leaves a study pane empty: each pane study keeps a visible plot in its own pane', () => {
        const bars = Array.from({ length: 400 }, (_, i) => bar(100 + 10 * Math.sin(i / 15) + (i % 7), i, 1000 + (i % 50) * 10));
        for (const spec of classicSpecs.filter((s) => !s.overlay)) {
            const out = spec.compute(bars, classicDescriptor(spec).defaultInputs());
            const inPane = out.plots.filter((p) => !p.overlay && p.display?.pane !== false);
            expect(inPane.length, spec.type).toBeGreaterThan(0);
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

    it('splits SuperTrend into complementary uptrend and downtrend legs', () => {
        const spec = classicSpecs.find((s) => s.type === 'supertrend')!;
        const up = Array.from({ length: 60 }, (_, i) => bar(100 + i * 2, i));
        const down = Array.from({ length: 60 }, (_, i) => bar(220 - i * 2, i + 60));
        const out = runOnce(spec, [...up, ...down]);
        expect(out.series!.map((s) => s.title)).toEqual(['Uptrend', 'Downtrend']);
        const uptrend = pointsOf(out.series![0]);
        const downtrend = pointsOf(out.series![1]);
        // Exactly one leg carries a value on any bar the stop exists on.
        expect(uptrend.some((p) => p.value != null)).toBe(true);
        expect(downtrend.some((p) => p.value != null)).toBe(true);
        expect(uptrend.every((p, i) => p.value == null || downtrend[i]!.value == null)).toBe(true);
    });

    it('anchors VWAP accumulation to the UTC day', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const day = 86400000;
        const bars: OHLCV[] = [
            { time: 0, open: 10, high: 10, low: 10, close: 10, volume: 100 },
            { time: 60000, open: 20, high: 20, low: 20, close: 20, volume: 100 },
            { time: day, open: 30, high: 30, low: 30, close: 30, volume: 100 },
        ];
        const out = runOnce(spec, bars, { anchor: 'Session', source: 'Close' });
        const points = pointsOf(out.series![0]);
        expect(points[1]!.value).toBeCloseTo(15, 10);
        expect(points[2]!.value).toBeCloseTo(30, 10); // reset at the new day
    });

    it('resets VWAP on UTC quarter and year boundaries', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const flat = (iso: string, price: number): OHLCV => ({ time: Date.parse(iso), open: price, high: price, low: price, close: price, volume: 1 });
        const bars = [flat('2024-02-10T00:00:00Z', 10), flat('2024-03-31T23:00:00Z', 20), flat('2024-04-01T00:00:00Z', 30), flat('2025-01-01T00:00:00Z', 40)];
        // These bars sit days apart, so the daily-and-above guard has to be lifted first.
        const quarter = pointsOf(runOnce(spec, bars, { anchor: 'Quarter', source: 'Close', hideDwm: false }).series![0]);
        expect(quarter.map((p) => p.value)).toEqual([10, 15, 30, 40]);
        const year = pointsOf(runOnce(spec, bars, { anchor: 'Year', source: 'Close', hideDwm: false }).series![0]);
        expect(year.map((p) => p.value)).toEqual([10, 15, 20, 40]);
    });

    it('blanks VWAP on daily and higher timeframes unless the guard is turned off', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const daily: OHLCV[] = Array.from({ length: 5 }, (_, i) => ({ time: i * 86400000, open: 10, high: 10, low: 10, close: 10, volume: 1 }));
        expect(pointsOf(runOnce(spec, daily).series![0]).every((p) => p.value == null)).toBe(true);
        expect(pointsOf(runOnce(spec, daily, { hideDwm: false }).series![0]).every((p) => p.value != null)).toBe(true);
    });

    it('draws VWAP bands per enabled pair, in standard deviations or percent, fill optional', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        // Flat bars make every source = price: vwap of (100×1, 106×2) = 104, σ = √8.
        const bars: OHLCV[] = [
            { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 },
            { time: 60000, open: 106, high: 106, low: 106, close: 106, volume: 2 },
        ];
        const out = runOnce(spec, bars, { band1: true, band1Mult: 1, band2: false, band3: true, band3Mult: 2.5 });
        expect(out.series!.map((s) => s.title)).toEqual(['VWAP', 'Upper Band #1', 'Lower Band #1', 'Upper Band #2', 'Lower Band #2']);
        const sd = Math.sqrt(8);
        expect(pointsOf(out.series![1])[1]!.value).toBeCloseTo(104 + sd, 10);
        expect(pointsOf(out.series![4])[1]!.value).toBeCloseTo(104 - 2.5 * sd, 10);

        // Percentage mode offsets by a share of the VWAP value instead of its deviation.
        const percent = runOnce(spec, bars, { bandsMode: 'Percentage', band1Mult: 2 });
        expect(pointsOf(percent.series![1])[1]!.value).toBeCloseTo(104 * 1.02, 10);

        // Upper bands lean bearish, lower bands bullish, both at 40% transparency.
        const inkOf = (s: SeriesSpec): string | undefined => (isLineLikeSeries(s) ? s.style.color : undefined);
        expect(inkOf(out.series![1]!)).toBe('#f2364599');
        expect(inkOf(out.series![2]!)).toBe('#08998199');

        // Only band 1 is on by default; each visible pair gets one fill, and the toggle kills them all.
        expect(runOnce(spec, bars).series).toHaveLength(3);
        expect(out.fills).toHaveLength(2);
        expect(runOnce(spec, bars, { fill: false }).fills).toHaveLength(0);
        expect(out.fills![0]!.color).toBe('#787b860d');
    });

    it('reads VWAP source through the shared source vocabulary', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const source = spec.inputs.find((i) => i.key === 'source')!;
        expect(source.options).toEqual(['Close', 'Open', 'High', 'Low', 'HL2', 'HLC3', 'OHLC4', 'HLCC4']);
        const bars: OHLCV[] = [{ time: 0, open: 1, high: 9, low: 3, close: 5, volume: 1 }];
        expect(pointsOf(runOnce(spec, bars, { source: 'High' }).series![0])[0]!.value).toBe(9);
        expect(pointsOf(runOnce(spec, bars, { source: 'HL2' }).series![0])[0]!.value).toBe(6);
    });

    it('declares VWAP band toggles in Settings and its inks in a trailing Style group', () => {
        const spec = classicSpecs.find((s) => s.type === 'vwap')!;
        const anchor = spec.inputs.find((i) => i.key === 'anchor')!;
        expect(anchor.options).toEqual(['Session', 'Week', 'Month', 'Quarter', 'Year']);
        for (const n of [1, 2, 3]) {
            const on = spec.inputs.find((i) => i.key === `band${n}`)!;
            const mult = spec.inputs.find((i) => i.key === `band${n}Mult`)!;
            expect(on.type).toBe('bool');
            expect(on.group).toBe('Settings');
            expect(mult.type).toBe('float');
            expect(mult.group).toBe('Settings');
        }
        const styled = spec.inputs.filter((i) => i.group === 'Style').map((i) => i.key);
        expect(styled).toEqual(['bullColor', 'bearColor', 'bandsColor', 'fill']);
        expect(spec.inputs.slice(-styled.length).map((i) => i.key)).toEqual(styled);
    });

    it('a plot whose name reads better on screen keeps the name hosts and saved styles know it by', () => {
        const bars = Array.from({ length: 80 }, (_, i) => bar(100 + Math.sin(i / 4) * 5, i, 1000));
        const named = (type: string): Array<[string, string | undefined]> =>
            runOnce(classicSpecs.find((s) => s.type === type)!, bars).series!.map((s) => [s.title, en(s.displayTitle)]);
        expect(named('average-directional-index')).toContainEqual(['-DI', '−DI']);
        expect(named('vortex-indicator')).toContainEqual(['VI-', 'VI−']);
        expect(named('chande-kroll-stop')).toEqual([
            ['Stop Short', 'Short Stop'],
            ['Stop Long', 'Long Stop'],
        ]);
        expect(named('gator-oscillator')).toEqual([
            ['Upper Histogram (Jaw - Teeth)', 'Upper Histogram (Jaw − Teeth)'],
            ['Lower Histogram (Teeth - Lips)', 'Lower Histogram (Teeth − Lips)'],
        ]);
        expect(named('52-week-high-low')).toEqual([
            ['52 Week High', '52-Week High'],
            ['52 Week Low', '52-Week Low'],
        ]);
        const vortex = runOnce(classicSpecs.find((s) => s.type === 'vortex-indicator')!, bars).series!;
        expect(vortex.map((s) => s.id)).toEqual(['vortex-indicator:line:vi+#0', 'vortex-indicator:line:vi-#1']);
    });

    it('names every pivot type and the percentage mode in the chart language, while layouts keep the English value', () => {
        const optionsShown = (type: string, key: string, i18n: ReturnType<typeof createTranslator>): Record<string, string> => {
            const input = classicDescriptor(classicSpecs.find((s) => s.type === type)!)
                .inputsSchema()
                .find((i) => i.key === key)!;
            return Object.fromEntries(input.options!.map((value) => [value, i18n.t(input.display?.options?.[value] ?? value)]));
        };
        const de = createTranslator({
            locale: 'de',
            messages: {
                'indicator.option.fibonacci': 'Fibonacci-DE',
                'indicator.option.camarilla': 'Camarilla-DE',
                'indicator.option.woodie': 'Woodie-DE',
                'indicator.option.rocPercent': 'ROC in %',
            },
        });
        expect(optionsShown('pivot-points', 'kind', de)).toEqual({
            Traditional: 'Traditional',
            Fibonacci: 'Fibonacci-DE',
            Camarilla: 'Camarilla-DE',
            Woodie: 'Woodie-DE',
        });
        expect(optionsShown('rate-of-change', 'mode', de)).toEqual({ 'ROC %': 'ROC in %', Momentum: 'Momentum' });
        expect(optionsShown('pivot-points', 'kind', english)).toEqual({
            Traditional: 'Traditional',
            Fibonacci: 'Fibonacci',
            Camarilla: 'Camarilla',
            Woodie: 'Woodie',
        });
    });

    it("writes the Fibonacci pivot ratios with the locale's decimal separator", () => {
        const kind = classicDescriptor(classicSpecs.find((s) => s.type === 'pivot-points')!)
            .inputsSchema()
            .find((i) => i.key === 'kind')!;
        expect(kind.tooltip).toContain('Fibonacci projects 38.2/61.8/100% of the prior range');
        expect(english.t(kind.display!.tooltip!)).toBe(kind.tooltip);
        expect(createTranslator({ locale: 'de' }).t(kind.display!.tooltip!)).toContain('38,2/61,8/100%');
    });
});

// Each expectation below is worked out from the study's definition, by hand or with plain
// loops written here — never read back from the catalog's own output.
describe('classic studies checked against their definitions', () => {
    const DAY = 86_400_000;
    const at = (i: number, open: number, high: number, low: number, close: number, extra: Partial<OHLCV> = {}): OHLCV => ({ time: i * DAY, open, high, low, close, ...extra });
    /** Bars whose closes (and opens, when given) are the listed values, with room above and below. */
    const closing = (closes: number[], opens?: number[]): OHLCV[] => closes.map((c, i) => at(i, opens?.[i] ?? c, Math.max(c, opens?.[i] ?? c) + 1, Math.min(c, opens?.[i] ?? c) - 1, c));
    const specOf = (type: string): ClassicIndicatorSpec => classicSpecs.find((s) => s.type === type)!;
    const outputOf = (type: string, bars: OHLCV[], inputs: Record<string, InputValue> = {}): ReturnType<ClassicIndicatorSpec['compute']> => {
        const spec = specOf(type);
        return spec.compute(bars, { ...classicDescriptor(spec).defaultInputs(), ...inputs });
    };
    const plotOf = (type: string, bars: OHLCV[], inputs: Record<string, InputValue> = {}, key?: string): ClassicPlot => {
        const plots = outputOf(type, bars, inputs).plots;
        return key ? plots.find((p) => p.key === key)! : plots[0]!;
    };
    /** Average of `v[i − len + 1 … i]`. */
    const mean = (v: readonly number[], i: number, len: number): number => {
        let s = 0;
        for (let k = i - len + 1; k <= i; k++) s += v[k]!;
        return s / len;
    };
    const wave = (n: number): OHLCV[] =>
        Array.from({ length: n }, (_, i) => {
            const close = 100 + 12 * Math.sin(i / 9) + 5 * Math.sin(i / 2.3) + i * 0.05;
            const open = close - 1.5 * Math.cos(i / 3);
            return at(i, open, Math.max(open, close) + 0.6 + (i % 4) * 0.2, Math.min(open, close) - 0.4 - (i % 3) * 0.3, close, { volume: 1000 + (i % 7) * 100 });
        });

    it('Median, Typical and Average Price draw the bar summaries they are named after', () => {
        const bars = [at(0, 10, 14, 8, 12), at(1, 12, 13, 11, 11.5)];
        expect(plotOf('median-price', bars).values).toEqual([11, 12]);
        expect(plotOf('typical-price', bars).values[0]).toBeCloseTo(34 / 3, 12);
        expect(plotOf('typical-price', bars).values[1]).toBeCloseTo(35.5 / 3, 12);
        expect(plotOf('average-price', bars).values).toEqual([11, 11.875]);
        for (const type of ['median-price', 'typical-price', 'average-price']) expect(specOf(type).overlay, type).toBe(true);
    });

    it('Momentum is the source less its value `length` bars back', () => {
        const bars = closing([1, 2, 4, 7, 11], [0, 1, 1, 2, 5]);
        expect(plotOf('momentum', bars, { length: 2 }).values).toEqual([Number.NaN, Number.NaN, 3, 5, 7]);
        expect(plotOf('momentum', bars, { length: 2, source: 'Open' }).values).toEqual([Number.NaN, Number.NaN, 1, 1, 4]);
        expect(classicDescriptor(specOf('momentum')).defaultInputs()).toMatchObject({ length: 10, source: 'Close' });
        expect(outputOf('momentum', bars).levels?.map((l) => l.price)).toEqual([0]);
    });

    it('Moving Average Channel averages the highs and the lows, each with its own length and offset', () => {
        const bars = [at(0, 9, 10, 8, 9), at(1, 10, 12, 9, 11), at(2, 12, 14, 10, 13), at(3, 13, 16, 11, 15)];
        const inputs = { upperLength: 2, lowerLength: 2 };
        expect(plotOf('moving-average-channel', bars, inputs, 'upper').values).toEqual([Number.NaN, 11, 13, 15]);
        expect(plotOf('moving-average-channel', bars, inputs, 'lower').values).toEqual([Number.NaN, 8.5, 9.5, 10.5]);
        // A positive offset moves a line to later bars, a negative one to earlier bars.
        const moved = { ...inputs, upperOffset: 1, lowerOffset: -1 };
        expect(plotOf('moving-average-channel', bars, moved, 'upper').values).toEqual([Number.NaN, Number.NaN, 11, 13]);
        expect(plotOf('moving-average-channel', bars, moved, 'lower').values).toEqual([8.5, 9.5, 10.5, Number.NaN]);
        expect(classicDescriptor(specOf('moving-average-channel')).defaultInputs()).toMatchObject({ upperLength: 20, lowerLength: 20, upperOffset: 0, lowerOffset: 0 });
        expect(outputOf('moving-average-channel', bars).bands).toHaveLength(1);
    });

    it('Net Volume signs each bar’s volume by its close against the previous close', () => {
        const bars = closing([10, 11, 11, 9, 9.5]).map((b, i) => ({ ...b, ...([100, 200, 300, 400][i] != null ? { volume: [100, 200, 300, 400][i]! } : {}) }));
        const net = plotOf('net-volume', bars);
        expect(net.values).toEqual([Number.NaN, 200, 0, -400, Number.NaN]); // unchanged close → 0; no volume → a gap
        expect(net.kind).toBe('columns');
        expect(net.colors).toEqual([null, BULLISH, BULLISH, BEARISH, null]);
    });

    it('Accelerator Oscillator is the Awesome Oscillator less its own 5-bar average', () => {
        const bars = wave(60);
        const mid = bars.map((b) => (b.high + b.low) / 2);
        const ao = mid.map((_, i) => (i < 33 ? Number.NaN : mean(mid, i, 5) - mean(mid, i, 34)));
        const ac = ao.map((x, i) => (i < 37 ? Number.NaN : x - mean(ao, i, 5)));
        const plot = plotOf('accelerator-oscillator', bars);
        expect(plot.values[36]).toBeNaN();
        for (const i of [37, 44, 59]) expect(plot.values[i], `bar ${i}`).toBeCloseTo(ac[i]!, 10);
        expect(plot.kind).toBe('columns');
        for (let i = 38; i < 60; i++) expect(plot.colors![i], `bar ${i}`).toBe(ac[i]! > ac[i - 1]! ? BULLISH : BEARISH);
    });

    it('Accumulative Swing Index sums Wilder’s swing index, whichever distance sets R', () => {
        const bars = [
            at(0, 10, 12, 9, 11),
            at(1, 11, 13, 10, 12), // the bar's own range (3) is the largest distance
            at(2, 14.5, 15, 14, 14.8), // the high's distance from the prior close (3) is
            at(3, 12, 12.5, 11, 11.5), // the low's distance from the prior close (3.8) is
            at(4, 11.5, 11.5, 11.5, 11.5), // nothing moved
        ];
        const swing = [
            (50 * (1 + 0.5 * 1 + 0.25 * 1) * (2 / 10)) / (3 + 0.25 * 1),
            (50 * (2.8 + 0.5 * 0.3 + 0.25 * 1) * (3 / 10)) / (3 - 0.5 * 2 + 0.25 * 1),
            (50 * (-3.3 + 0.5 * -0.5 + 0.25 * 0.3) * (3.8 / 10)) / (3.8 - 0.5 * 2.3 + 0.25 * 0.3),
        ];
        const asi = plotOf('accumulative-swing-index', bars).values;
        expect(asi[0]).toBeNaN();
        expect(asi[1]).toBeCloseTo(swing[0]!, 10);
        expect(asi[2]).toBeCloseTo(swing[0]! + swing[1]!, 10);
        expect(asi[3]).toBeCloseTo(swing[0]! + swing[1]! + swing[2]!, 10);
        expect(asi[4]).toBeCloseTo(asi[3]!, 10); // no range, no swing
        // The limit move divides every swing.
        expect(plotOf('accumulative-swing-index', bars, { limitMove: 100 }).values[3]).toBeCloseTo(asi[3]! / 10, 10);
    });

    it('Accumulative Swing Index is inked against its own last confirmed swing points', () => {
        // Bars with no wicks that open where the last one closed: each bar adds 7 to the line in
        // its direction, or 5 on the first bar after a turn (7.5 on the very first).
        const closes = [10, 11, 12, 13, 12, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10];
        const bars = closes.map((c, i) => {
            const open = i === 0 ? c : closes[i - 1]!;
            return at(i, open, Math.max(open, c), Math.min(open, c), c);
        });
        const plot = plotOf('accumulative-swing-index', bars, { swingLength: 2 });
        const line = [7.5, 14.5, 21.5, 16.5, 9.5, 14.5, 21.5, 28.5, 35.5, 30.5, 23.5, 16.5, 9.5, 2.5];
        line.forEach((x, k) => expect(plot.values[k + 1], `bar ${k + 1}`).toBeCloseTo(x, 10));
        // The high of 21.5 at bar 3 is confirmed at bar 5, the low of 9.5 at bar 5 at bar 7, the high of
        // 35.5 at bar 9 at bar 11. Matching a swing point is not a breakout; passing it is.
        const N = NEUTRAL;
        expect(plot.colors).toEqual([null, N, N, N, N, N, N, N, BULLISH, BULLISH, BULLISH, N, N, N, BEARISH]);
        expect(plot.color).toBe(NEUTRAL);
        // A longer swing needs more bars on each side: none of these is confirmed.
        expect(plotOf('accumulative-swing-index', bars, { swingLength: 6 }).colors!.slice(1)).toEqual(new Array(14).fill(N));
        expect(plotOf('accumulative-swing-index', bars, { swingLength: 2, bullColor: '#111111', bearColor: '#222222', color: '#333333' }).colors!.slice(7, 9)).toEqual(['#333333', '#111111']);
        expect(classicDescriptor(specOf('accumulative-swing-index')).defaultInputs()).toMatchObject({ limitMove: 10, swingLength: 10 });
    });

    it('Rank Correlation Index reads +1 on a straight climb and −1 on a straight fall, in a −1..1 pane', () => {
        const up = outputOf('rank-correlation-index', closing([1, 2, 3, 4, 5, 6]), { length: 4 });
        expect(up.plots[0]!.values.slice(3)).toEqual([1, 1, 1]);
        expect(plotOf('rank-correlation-index', closing([6, 5, 4, 3, 2, 1]), { length: 4 }).values[5]).toBe(-1);
        expect(plotOf('rank-correlation-index', closing([5, 1, 2, 2]), { length: 3 }).values[3]).toBeCloseTo(0.875, 12);
        expect(up.levels?.map((l) => l.price)).toEqual([0.8, 0, -0.8]);
        expect(classicDescriptor(specOf('rank-correlation-index')).defaultInputs()).toMatchObject({ length: 12, source: 'Close' });
    });

    it('Standard Error and its bands come from the regression line through the window', () => {
        // Windows of 3 over 1, 2, 4, 4, 7: endpoints 23/6, 13/3, 6.5; standard errors √(1/6), √(2/3), √1.5.
        const bars = closing([1, 2, 4, 4, 7]);
        const end = [23 / 6, 13 / 3, 6.5];
        const se = [Math.sqrt(1 / 6), Math.sqrt(2 / 3), Math.sqrt(1.5)];
        const error = plotOf('standard-error', bars, { length: 3 }).values;
        expect(error[1]).toBeNaN();
        se.forEach((x, k) => expect(error[k + 2], `bar ${k + 2}`).toBeCloseTo(x, 12));
        expect(classicDescriptor(specOf('standard-error')).inputsSchema().find((i) => i.key === 'length')).toMatchObject({ defval: 14, min: 3 });

        const band = (inputs: Record<string, InputValue>, key: string): readonly number[] => plotOf('standard-error-bands', bars, { length: 3, ...inputs }, key).values;
        // Unsmoothed: the line is the regression endpoint, the bands sit `mult` errors away.
        end.forEach((x, k) => expect(band({ smoothing: 1 }, 'basis')[k + 2]).toBeCloseTo(x, 12));
        expect(band({ smoothing: 1, mult: 1 }, 'upper')[3]).toBeCloseTo(end[1]! + se[1]!, 12);
        expect(band({ smoothing: 1, mult: 3 }, 'lower')[4]).toBeCloseTo(end[2]! - 3 * se[2]!, 12);
        // Smoothed: the same average runs over the line and over the error.
        expect(band({ smoothing: 2 }, 'basis')[3]).toBeCloseTo((end[0]! + end[1]!) / 2, 12);
        expect(band({ smoothing: 2, mult: 2 }, 'upper')[3]).toBeCloseTo((end[0]! + end[1]!) / 2 + 2 * ((se[0]! + se[1]!) / 2), 12);
        expect(band({ smoothing: 2, smoothingType: 'WMA' }, 'basis')[3]).toBeCloseTo((end[0]! + 2 * end[1]!) / 3, 12);
        const emaSeed = (end[0]! + end[1]!) / 2;
        expect(band({ smoothing: 2, smoothingType: 'EMA' }, 'basis')[4]).toBeCloseTo(emaSeed + (2 / 3) * (end[2]! - emaSeed), 12);
        expect(classicDescriptor(specOf('standard-error-bands')).defaultInputs()).toMatchObject({ length: 21, mult: 2, smoothing: 3, smoothingType: 'SMA', source: 'Close' });
    });

    it('Standard Error Bands draw a neutral regression line between a bearish upper and a bullish lower band, each washed toward the line', () => {
        const out = outputOf('standard-error-bands', wave(60));
        expect(out.plots.map((p) => [p.key, p.color])).toEqual([['basis', NEUTRAL], ['upper', BEARISH], ['lower', BULLISH]]);
        expect(out.plots.every((p) => p.colors === undefined)).toBe(true);
        expect(out.bands).toEqual([
            { key: 'sebUpper', from: 'upper', to: 'basis', color: `${BEARISH}1a` },
            { key: 'sebLower', from: 'basis', to: 'lower', color: `${BULLISH}1a` },
        ]);
        const custom = outputOf('standard-error-bands', wave(60), { upperColor: '#112233', lowerColor: '#445566', basisColor: '#778899' });
        expect(custom.plots.map((p) => p.color)).toEqual(['#778899', '#112233', '#445566']);
        expect(custom.bands!.map((b) => b.color)).toEqual(['#1122331a', '#4455661a']);
    });

    it('Advance/Decline divides the bars that closed above their open by those that closed below', () => {
        // up, up, down, flat, up
        const bars = [at(0, 10, 12, 9, 11), at(1, 11, 13, 10, 12), at(2, 12, 13, 10, 11), at(3, 11, 12, 10, 11), at(4, 11, 13, 10, 12)];
        expect(plotOf('advance-decline', bars, { length: 4 }).values).toEqual([Number.NaN, Number.NaN, Number.NaN, 2, 2]);
        expect(plotOf('advance-decline', bars, { length: 3 }).values[3]).toBe(1); // up, down, flat
        // No down bar in the window: the count of up bars, not a division by zero.
        expect(plotOf('advance-decline', bars, { length: 2 }).values[1]).toBe(2);
        expect(outputOf('advance-decline', bars).levels?.map((l) => l.price)).toEqual([1]);
    });

    it('Majority Rule is the percentage of bars that closed above the bar before', () => {
        const values = plotOf('majority-rule', closing([1, 2, 3, 2, 4, 4]), { length: 4 }).values;
        expect(values.slice(0, 4).every((v) => Number.isNaN(v))).toBe(true);
        expect(values.slice(4)).toEqual([75, 50]); // + + − +, then + − + unchanged
        expect(classicDescriptor(specOf('majority-rule')).defaultInputs()).toMatchObject({ length: 14 });
        expect(outputOf('majority-rule', closing([1, 2, 3])).levels?.map((l) => l.price)).toEqual([50]);
    });

    it('Trend Strength Index is how closely price has moved in step with time', () => {
        expect(plotOf('trend-strength-index', closing([1, 2, 3, 4, 5]), { length: 5 }).values[4]).toBeCloseTo(1, 12);
        expect(plotOf('trend-strength-index', closing([5, 4, 3, 2, 1]), { length: 5 }).values[4]).toBeCloseTo(-1, 12);
        expect(plotOf('trend-strength-index', closing([1, 2, 3, 2, 1]), { length: 5 }).values[4]).toBeCloseTo(0, 12);
        expect(plotOf('trend-strength-index', closing([1, 2, 3, 2, 1]), { length: 3 }).values[2]).toBeCloseTo(1, 12);
    });

    it('Chop Zone colors each bar by the angle of its 34-bar trend line', () => {
        const bars = wave(220);
        const plot = plotOf('chop-zone', bars);
        // The trend line: an EMA seeded with the average of its first 34 closes.
        const trend = new Array<number>(bars.length).fill(Number.NaN);
        trend[33] = mean(bars.map((b) => b.close), 33, 34);
        for (let i = 34; i < bars.length; i++) trend[i] = trend[i - 1]! + (2 / 35) * (bars[i]!.close - trend[i - 1]!);
        const zones = new Set<number>();
        for (let i = 34; i < bars.length; i++) {
            const highs = bars.slice(i - 29, i + 1).map((b) => b.high);
            const low = Math.min(...highs);
            const typical = (bars[i]!.high + bars[i]!.low + bars[i]!.close) / 3;
            const rise = ((trend[i]! - trend[i - 1]!) / typical) * ((25 / (Math.max(...highs) - low)) * low);
            const degrees = Math.round((Math.atan(Math.abs(rise)) * 180) / Math.PI);
            const zone = degrees >= 5 ? 4 : degrees >= 3.57 ? 3 : degrees >= 2.14 ? 2 : degrees >= 0.71 ? 1 : 0;
            zones.add(rise < 0 ? -zone : zone);
            const ink = zone === 0 ? WARNING : gradient(zone, 0, 4, WARNING, rise < 0 ? BEARISH : BULLISH);
            expect(plot.colors![i], `bar ${i}`).toBe(ink);
            expect(plot.values[i]).toBe(1);
        }
        expect(plot.values[33]).toBeNaN();
        expect(zones.size).toBeGreaterThanOrEqual(7); // the series visits most zones, both sides of flat
        expect(plot.kind).toBe('columns');
        // A market that did not move is flat, whatever the trend line says.
        const still = plotOf('chop-zone', Array.from({ length: 50 }, (_, i) => at(i, 5, 5, 5, 5)));
        expect(still.colors![49]).toBe(WARNING);
    });

    it('Historical Volatility is the annualized sample deviation of close-to-close log returns', () => {
        const closes = [100, 102, 99, 101];
        const r = [Math.log(102 / 100), Math.log(99 / 102), Math.log(101 / 99)];
        const avg = (r[0]! + r[1]! + r[2]!) / 3;
        const variance = ((r[0]! - avg) ** 2 + (r[1]! - avg) ** 2 + (r[2]! - avg) ** 2) / 2;
        expect(plotOf('historical-volatility', closing(closes), { length: 3 }).values[3]).toBeCloseTo(100 * Math.sqrt(252 * variance), 10);
    });

    it('Historical Volatility inks its first bars, before its range window has filled', () => {
        const plot = plotOf('historical-volatility', wave(160));
        const valued = plot.values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
        expect(valued.length).toBeGreaterThan(100);
        for (const i of valued) expect(plot.colors![i], `bar ${i}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(plot.colors![valued[0]!]).toBe(NEUTRAL);
    });

    it('Volatility Zero Trend averages squared returns per day elapsed, taking no mean out', () => {
        // A day, then a weekend: the second return is spread over 3 days.
        const bars = [at(0, 100, 101, 99, 100), at(1, 100, 103, 99, 102), at(4, 102, 103, 98, 99)];
        const r1 = Math.log(102 / 100);
        const r2 = Math.log(99 / 102);
        expect(plotOf('volatility-zero-trend', bars, { length: 2 }).values).toEqual([Number.NaN, Number.NaN, expect.closeTo(100 * Math.sqrt((252 * (r1 * r1 + (r2 * r2) / 3)) / 2), 10)]);
        // Hourly bars: each return covers 1/24 of a day.
        const hourly = [100, 100.5, 100.2].map((c, i) => ({ ...at(0, c, c + 1, c - 1, c), time: i * (DAY / 24) }));
        const h1 = Math.log(100.5 / 100);
        const h2 = Math.log(100.2 / 100.5);
        expect(plotOf('volatility-zero-trend', hourly, { length: 2, daysPerYear: 365 }).values[2]).toBeCloseTo(100 * Math.sqrt((365 * (h1 * h1 * 24 + h2 * h2 * 24)) / 2), 9);
    });

    it('Volatility O-H-L-C reads each bar’s range, and weighs the overnight gap in once the market closes', () => {
        const bars = [at(0, 100, 103, 99, 101), at(1, 102, 104, 100, 103), at(4, 104, 107, 103, 105)];
        const k = 2 * Math.log(2) - 1;
        const session = (b: OHLCV): number => 0.5 * Math.log(b.high / b.low) ** 2 - k * Math.log(b.close / b.open) ** 2;
        const annual = (perDay: number): number => 100 * Math.sqrt(252 * perDay);
        const open = plotOf('volatility-ohlc', bars, { length: 1 }).values;
        expect(open[0]).toBeNaN();
        expect(open[1]).toBeCloseTo(annual(session(bars[1]!)), 10);
        expect(open[2]).toBeCloseTo(annual(session(bars[2]!) / 3), 10); // three days since the bar before
        const gap = Math.log(104 / 103) ** 2;
        expect(plotOf('volatility-ohlc', bars, { length: 1, marketClosed: 0.25 }).values[2]).toBeCloseTo(annual(((0.12 * gap) / 0.25 + (0.88 * session(bars[2]!)) / 0.75) / 3), 10);
        expect(plotOf('volatility-ohlc', bars, { length: 2 }).values[2]).toBeCloseTo(annual((session(bars[1]!) + session(bars[2]!) / 3) / 2), 10);
        expect(classicDescriptor(specOf('volatility-ohlc')).defaultInputs()).toMatchObject({ length: 10, marketClosed: 0, daysPerYear: 252 });
    });

    it('Volatility Index trails the best close by a multiple of the average range, and flips when a close crosses it', () => {
        // high, low, close — true ranges 2, 2, 2, 3, (skipped), 2, …
        const bars = [
            at(0, 10, 11, 9, 10),
            at(1, 10, 12, 10, 11), // the 2-bar average range is ready after this bar: 2
            at(2, 11, 13, 11, 12), // long: best close 11 − 1 × 2
            at(3, 12, 12.5, 9.5, 9.5), // long: 12 − 2; closes below it → short from the next bar
            at(4, 9.5, 10, 9, 9.5), // unchanged close: everything holds
            at(5, 9.5, 10, 8, 8.5), // short: 9.5 + average range 2.5
            at(6, 8.5, 9, 8, 8.8), // short: best close 8.5 + (2.5 + (2 − 2.5) / 2)
        ];
        const inputs = { length: 2, mult: 1 };
        expect(plotOf('volatility-index', bars, inputs, 'long').values).toEqual([Number.NaN, Number.NaN, 9, 10, 10, Number.NaN, Number.NaN]);
        expect(plotOf('volatility-index', bars, inputs, 'short').values).toEqual([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, 12, 10.75]);
        // EMA smoothing weighs the newest range 2/3 instead of 1/2.
        const fast = plotOf('volatility-index', bars, { ...inputs, smoothing: 'EMA' }, 'short').values;
        const afterDrop = 2 + (2 / 3) * (3 - 2);
        expect(fast[5]).toBeCloseTo(9.5 + afterDrop, 12);
        expect(fast[6]).toBeCloseTo(8.5 + afterDrop + (2 / 3) * (2 - afterDrop), 12);
        expect(plotOf('volatility-index', bars, { ...inputs, mult: 2 }, 'long').values[2]).toBe(7);
        expect(classicDescriptor(specOf('volatility-index')).defaultInputs()).toMatchObject({ length: 10, mult: 3, smoothing: 'RMA' });
        expect(specOf('volatility-index').overlay).toBe(true);
    });

    it('MA Cross marks the short line on every bar where it changes sides of the long one', () => {
        const bars = closing([10, 12, 11, 9, 13, 13]);
        const inputs = { shortLength: 1, longLength: 2 };
        // short − long: none, +1, −0.5, −1, +2, 0. A touch is not a cross.
        expect(plotOf('ma-cross', bars, inputs, 'short').values).toEqual([10, 12, 11, 9, 13, 13]);
        expect(plotOf('ma-cross', bars, inputs, 'long').values).toEqual([Number.NaN, 11, 11.5, 10, 11, 13]);
        const crosses = plotOf('ma-cross', bars, inputs, 'crosses');
        expect(crosses.values).toEqual([Number.NaN, Number.NaN, 11, Number.NaN, 13, Number.NaN]);
        // A filled dot wider than the lines it sits on, so it shows where they meet, inked by the way the short line crossed.
        expect(crosses.kind).toBe('circles');
        expect(crosses.width).toBeGreaterThan(plotOf('ma-cross', bars, inputs, 'short').width!);
        expect(crosses.colors).toEqual([null, null, BEARISH, null, BULLISH, null]);
        expect(plotOf('ma-cross', bars, { ...inputs, bullColor: '#111111', bearColor: '#222222' }, 'crosses').colors).toEqual([null, null, '#222222', null, '#111111', null]);
        // The two lines wear the generic average's inks.
        expect([plotOf('ma-cross', bars, inputs, 'short').color, plotOf('ma-cross', bars, inputs, 'long').color]).toEqual([INFO, WARNING]);
        expect(plotOf('ma-cross', closing([10, 12, 11, 9, 13, 13], [9, 9, 9, 9, 9, 9]), { ...inputs, source: 'Open' }, 'crosses').values.every(Number.isNaN)).toBe(true);
        expect(classicDescriptor(specOf('ma-cross')).defaultInputs()).toMatchObject({ shortLength: 9, longLength: 26, source: 'Close' });
        expect(specOf('ma-cross').overlay).toBe(true);
    });

    it('EMA Cross and MA with EMA Cross run the same marker over their own pair of averages', () => {
        const bars = wave(120);
        const closes = bars.map((b) => b.close);
        const sideChanges = (a: number[], b: number[]): number[] => a.map((x, i) => (i > 0 && (x - b[i]!) * (a[i - 1]! - b[i - 1]!) < 0 ? x : Number.NaN));

        const short = ema(closes, 9);
        const long = ema(closes, 26);
        expect(plotOf('ema-cross', bars, {}, 'short').values).toEqual(short);
        expect(plotOf('ema-cross', bars, {}, 'long').values).toEqual(long);
        expect(plotOf('ema-cross', bars, {}, 'crosses').values).toEqual(sideChanges(short, long));
        expect(sideChanges(short, long).filter(Number.isFinite).length).toBeGreaterThan(2);

        const simple = sma(closes, 10);
        const exponential = ema(closes, 20);
        const mixed = { emaLength: 20 };
        expect(plotOf('ma-with-ema-cross', bars, mixed, 'ma').values).toEqual(simple);
        expect(plotOf('ma-with-ema-cross', bars, mixed, 'ema').values).toEqual(exponential);
        expect(plotOf('ma-with-ema-cross', bars, mixed, 'crosses').values).toEqual(sideChanges(simple, exponential));
        expect(classicDescriptor(specOf('ema-cross')).defaultInputs()).toMatchObject({ shortLength: 9, longLength: 26 });
        expect(classicDescriptor(specOf('ma-with-ema-cross')).defaultInputs()).toMatchObject({ maLength: 10, emaLength: 10 });
    });

    it('Moving Average Double, Triple and Multiple draw one line per length under one smoothing', () => {
        const bars = wave(260);
        const closes = bars.map((b) => b.close);
        const lengths: Record<string, number[]> = {
            'moving-average-double': [14, 21],
            'moving-average-triple': [14, 21, 35],
            'moving-average-multiple': [14, 21, 35, 50, 100, 200],
        };
        for (const [type, lens] of Object.entries(lengths)) {
            const simple = outputOf(type, bars).plots;
            expect(simple.map((p) => p.values), type).toEqual(lens.map((len) => sma(closes, len)));
            expect(simple.map((p) => p.title), type).toEqual(lens.map((len) => `SMA ${len}`));
            expect(outputOf(type, bars, { maType: 'EMA' }).plots.map((p) => p.values), type).toEqual(lens.map((len) => ema(closes, len)));
            expect(outputOf(type, bars, { maType: 'WMA' }).plots.map((p) => p.values), type).toEqual(lens.map((len) => wma(closes, len)));
            // The fastest line wears the generic average's first ink, the slowest its second, the rest blend between.
            const inks = simple.map((p) => p.color);
            expect(new Set(inks).size, type).toBe(lens.length);
            expect([inks[0], inks[inks.length - 1]], type).toEqual([INFO, WARNING]);
            inks.forEach((ink, i) => expect(ink, `${type} line ${i + 1}`).toBe(gradient(i, 0, lens.length - 1, INFO, WARNING)));
            expect(specOf(type).overlay, type).toBe(true);
        }
        expect(outputOf('moving-average-triple', bars).plots[1]!.color).toBe('#ad9a7b');
        // Each line follows its own length and the shared source.
        const opens = bars.map((b) => b.open);
        const edited = outputOf('moving-average-triple', bars, { length2: 5, source: 'Open' }).plots;
        expect(edited.map((p) => p.values)).toEqual([sma(opens, 14), sma(opens, 5), sma(opens, 35)]);
        expect(edited[1]!.title).toBe('SMA 5');
    });

    it('Guppy Multiple Moving Average draws six short and six long exponential averages in two inks', () => {
        const bars = wave(200);
        const closes = bars.map((b) => b.close);
        const plots = outputOf('guppy-multiple-moving-average', bars).plots;
        const lens = [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60];
        expect(plots.map((p) => p.values)).toEqual(lens.map((len) => ema(closes, len)));
        expect(plots.map((p) => p.title)).toEqual(lens.map((len) => `EMA ${len}`));
        const inks = plots.map((p) => p.color);
        expect(new Set(inks.slice(0, 6)).size).toBe(1);
        expect(new Set(inks.slice(6)).size).toBe(1);
        expect(inks[0]).not.toBe(inks[6]);
        const edited = outputOf('guppy-multiple-moving-average', bars, { investor6: 90, traderColor: '#123456' }).plots;
        expect(edited[11]!.values).toEqual(ema(closes, 90));
        expect(edited.slice(0, 6).every((p) => p.color === '#123456')).toBe(true);
    });

    it('Volatility Close-to-Close computes annualized sample standard deviation of bar-to-bar log returns', () => {
        // Explicit prices: close = [100, 110, 99, 108.9, 119.79] → log returns [ln(1.1), ln(0.9), ln(1.1), ln(1.1)]
        const prices = [100, 110, 99, 108.9, 119.79];
        const bars = prices.map((c, i) => bar(c, i));
        const out = outputOf('volatility-close-to-close', bars, { length: 3, daysPerYear: 252 });
        const vals = out.plots[0]!.values;
        // Bar 0 has no return; bars 1..2 have fewer than 3 returns → NaN.
        expect(vals[0]).toBeNaN();
        expect(vals[1]).toBeNaN();
        expect(vals[2]).toBeNaN();
        // Window at bar 3: returns [ln(1.1), ln(0.9), ln(1.1)]
        const r = [Math.log(1.1), Math.log(0.9), Math.log(1.1)];
        const mean = (r[0]! + r[1]! + r[2]!) / 3;
        const sampleVar = r.reduce((acc, x) => acc + (x - mean) ** 2, 0) / 2;
        expect(vals[3]).toBeCloseTo(100 * Math.sqrt(sampleVar * 252), 10);
        // Window at bar 4: returns [ln(0.9), ln(1.1), ln(1.1)] — identical spread, identical volatility
        expect(vals[4]).toBeCloseTo(vals[3]!, 10);
        // Does NOT divide by elapsed days (unlike Volatility Zero Trend): widening bar spacing leaves value unchanged.
        const dailyBars = prices.map((c, i) => ({ ...bar(c, i), time: i * 86_400_000 }));
        const spacedOut = outputOf('volatility-close-to-close', dailyBars, { length: 3, daysPerYear: 252 });
        expect(spacedOut.plots[0]!.values[3]).toBeCloseTo(vals[3]!, 10);
    });

    it('Ichimoku Cloud computes all five lines, shifts Lagging back and projects the cloud forward past the last bar', () => {
        const bars = wave(120);
        const spec = specOf('ichimoku-cloud');
        const desc = classicDescriptor(spec);
        const defaults = desc.defaultInputs();
        expect(spec.overlay).toBe(true);
        expect(defaults).toMatchObject({ symbol: '', conversionLength: 9, baseLength: 26, spanBLength: 52, laggingLength: 26, displacement: 26 });

        const out = spec.compute(bars, defaults);
        const byKey = new Map(out.plots.map((p) => [p.key, p] as const));
        const h = bars.map((b) => b.high);
        const l = bars.map((b) => b.low);
        const donchian = (len: number, i: number) => (highest(h, len)[i]! + lowest(l, len)[i]!) / 2;

        expect(byKey.get('conversion')!.values[60]).toBeCloseTo(donchian(9, 60), 10);
        expect(byKey.get('base')!.values[60]).toBeCloseTo(donchian(26, 60), 10);
        expect(byKey.get('spanA')!.values[60]).toBeCloseTo((donchian(9, 60) + donchian(26, 60)) / 2, 10);
        expect(byKey.get('spanB')!.values[60]).toBeCloseTo(donchian(52, 60), 10);
        expect(byKey.get('lagging')!.offset).toBe(-25);
        expect(byKey.get('spanA')!.offset).toBe(25);
        expect(byKey.get('spanB')!.offset).toBe(25);

        // Verify ClassicIndicator emits projected future timestamps for Span A/B, shifted cloud fill colors, and shifted Lagging Span.
        let emitted: NativeIndicatorOutput | null = null;
        const inst = desc.create();
        const ctx: NativeIndicatorContext = {
            id: 'ichi',
            symbol: 'BTCUSDT',
            timeframe: '1',
            live: false,
            bars: () => bars,
            data: {} as NativeIndicatorContext['data'],
            emit: (o) => { emitted = o; },
            pushData: () => {},
            setStatus: () => {},
        };
        inst.start(ctx, defaults);
        expect(emitted).not.toBeNull();
        const series = emitted!.series!;
        const laggingSeries = series.find((s) => s.title === 'Lagging Span')!;
        const spanASeries = series.find((s) => s.title === 'Leading Span A')!;
        const spanBSeries = series.find((s) => s.title === 'Leading Span B')!;
        expect(isLineLikeSeries(laggingSeries) && laggingSeries.points.length).toBe(bars.length);
        if (isLineLikeSeries(laggingSeries)) {
            // Lagging Span pulls bar 95's close back onto bar 70, and leaves the last 25 bars null.
            expect(laggingSeries.points[70]!.value).toBeCloseTo(bars[95]!.close, 10);
            expect(laggingSeries.points[bars.length - 1]!.value).toBeNull();
        }
        if (isLineLikeSeries(spanASeries) && isLineLikeSeries(spanBSeries)) {
            expect(spanASeries.points.length).toBe(bars.length + 25);
            expect(spanBSeries.points.length).toBe(bars.length + 25);
            // Leading Span A on the final projected slot equals unshifted spanA at the last chart bar.
            const stepMs = bars[1]!.time - bars[0]!.time;
            expect(spanASeries.points[bars.length + 24]!.value).toBeCloseTo(byKey.get('spanA')!.values[bars.length - 1]!, 10);
            expect(spanASeries.points[bars.length + 24]!.time).toBe(bars[bars.length - 1]!.time + 25 * stepMs);
            // Cloud fill colors shift by +25 to match Leading Span A/B points 1:1.
            const cloudFill = emitted!.fills![0]!;
            expect(cloudFill.colors!.length).toBe(bars.length + 25);
            expect(cloudFill.colors![0]).toBeNull();
            expect(cloudFill.colors![bars.length + 24]).not.toBeNull();
        }
        inst.stop();
    });

    it('Correlation Coefficient and Correlation - Log compute exact Pearson correlations over aligned external series', async () => {
        const bars = Array.from({ length: 40 }, (_, i) => bar(100 + i * 2 + Math.sin(i) * 3, i));
        // Perfectly inversely correlated price series (for CC) and identical-return series (for Correlation - Log)
        const invBars = bars.map((b) => ({ ...b, open: 500 - b.close, high: 501 - b.close, low: 499 - b.close, close: 500 - b.close }));
        const scaledBars = bars.map((b) => ({ ...b, open: b.close * 2, high: b.close * 2 + 1, low: b.close * 2 - 1, close: b.close * 2 }));

        // Empty symbol default produces all-NaN while keeping a visible plot in its own pane.
        const ccSpec = specOf('correlation-coefficient');
        const ccEmpty = ccSpec.compute(bars, classicDescriptor(ccSpec).defaultInputs());
        expect(ccEmpty.plots[0]!.values.every(Number.isNaN)).toBe(true);
        expect(classicDescriptor(ccSpec).inputsSchema().find((i) => i.key === 'symbol')?.confirm).toBe(true);

        const ccOut = ccSpec.compute(bars, { ...classicDescriptor(ccSpec).defaultInputs(), symbol: 'ETHUSDT', length: 10 }, new Map([['ETHUSDT', invBars]]));
        expect(ccOut.plots[0]!.values[39]).toBeCloseTo(-1, 10);

        const clogSpec = specOf('correlation-log');
        const clogEmpty = clogSpec.compute(bars, classicDescriptor(clogSpec).defaultInputs());
        expect(clogEmpty.plots[0]!.values.every(Number.isNaN)).toBe(true);
        expect(classicDescriptor(clogSpec).inputsSchema().find((i) => i.key === 'instrument')?.confirm).toBe(true);
        expect(classicDescriptor(clogSpec).inputsSchema().find((i) => i.key === 'instrument2')?.confirm).toBe(true);

        // Two scaled copies have identical log returns → correlation of log returns = +1.
        const clogOut = clogSpec.compute(
            bars,
            { ...classicDescriptor(clogSpec).defaultInputs(), instrument: 'BTCUSDT', instrument2: 'ETHUSDT', length: 10 },
            new Map([
                ['BTCUSDT', bars],
                ['ETHUSDT', scaledBars],
            ]),
        );
        expect(clogOut.plots[0]!.values[39]).toBeCloseTo(1, 10);

        // ClassicIndicator async lifecycle: fetches secondary symbol, subscribes live ticks, and cleans up on stop.
        const fetched: string[] = [];
        let liveTick: ((b: OHLCV) => void) | null = null;
        let unsubscribed = false;
        const emissions: NativeIndicatorOutput[] = [];
        const statuses: string[] = [];
        const inst = classicDescriptor(ccSpec).create();
        const ctx: NativeIndicatorContext = {
            id: 'cc1',
            symbol: 'BTCUSDT',
            timeframe: '1',
            live: true,
            bars: () => bars,
            data: { canonicalSymbol: (s: string) => s } as NativeIndicatorContext['data'],
            fetchSeries: async (sym) => {
                fetched.push(sym);
                return scaledBars;
            },
            subscribeSeries: (_sym, _tf, onBar) => {
                liveTick = onBar;
                return () => { unsubscribed = true; };
            },
            emit: (o) => emissions.push(o),
            pushData: () => {},
            setStatus: (s) => statuses.push(s),
        };
        inst.start(ctx, { ...classicDescriptor(ccSpec).defaultInputs(), symbol: 'ETHUSDT', length: 10 });
        expect(statuses[0]).toBe('loading');
        await new Promise((r) => setTimeout(r, 0));
        expect(fetched).toEqual(['ETHUSDT']);
        expect(statuses[statuses.length - 1]).toBe('idle');
        const lastEmission = emissions[emissions.length - 1]!;
        const lastSeries = lastEmission.series![0]!;
        expect(isLineLikeSeries(lastSeries) && lastSeries.points[39]!.value).toBeCloseTo(1, 10);
        // Correlation Coefficient renders a uniform semi-transparent area fill against zero.
        const areaFill = lastEmission.fills![0]!;
        expect(areaFill.gradient).toBeUndefined();
        expect(areaFill.colors?.[39]).toMatch(/^#[0-9a-f]{6}33$/i);

        // Pushing a live tick on the external symbol recomputes immediately.
        const prevCount = emissions.length;
        liveTick!({ ...scaledBars[39]!, close: scaledBars[39]!.close * 0.5 });
        expect(emissions.length).toBe(prevCount + 1);
        inst.stop();
        expect(unsubscribed).toBe(true);
    });
});
