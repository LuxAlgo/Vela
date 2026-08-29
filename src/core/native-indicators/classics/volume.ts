import type { OHLCV } from '../../model/ohlcv';
import { SERIES_LINE, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { lengthInput, colorInput } from './shared';
import { volumes, closes, sourceValues, ema, sma, stdev, sum, change, cumSum, zip, map, sub } from './math';

/**
 * Volume studies. All of them read the bars' own volume; bars without a volume
 * report become gaps (never fake zeros), which the math module's NaN handling
 * carries through every derived line.
 */

/** Close-location value × volume (the accumulation/distribution money-flow term). */
function moneyFlowVolume(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => {
        if (b.volume == null || !Number.isFinite(b.volume)) return Number.NaN;
        if (b.high === b.low) return 0;
        return ((2 * b.close - b.high - b.low) / (b.high - b.low)) * b.volume;
    });
}

const obv: ClassicIndicatorSpec = {
    type: 'on-balance-volume',
    title: 'On Balance Volume',
    shortTitle: 'OBV',
    overlay: false,
    inputs: [colorInput()],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const d = change(closes(bars));
        const signed = zip(vol, d, (v, x) => (x > 0 ? v : x < 0 ? -v : 0));
        return { plots: [{ key: 'obv', title: 'OBV', values: cumSum(signed), color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const accDist: ClassicIndicatorSpec = {
    type: 'accumulation-distribution',
    title: 'Accumulation / Distribution',
    shortTitle: 'A/D',
    overlay: false,
    inputs: [colorInput()],
    compute: (bars, inputs) => ({
        plots: [{ key: 'ad', title: 'A/D', values: cumSum(moneyFlowVolume(bars)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
    }),
};

const cmf: ClassicIndicatorSpec = {
    type: 'chaikin-money-flow',
    title: 'Chaikin Money Flow',
    shortTitle: 'CMF',
    overlay: false,
    inputs: [lengthInput(20), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const values = zip(sum(moneyFlowVolume(bars), len), sum(volumes(bars), len), (m, v) => (v === 0 ? 0 : m / v));
        return {
            plots: [{ key: 'cmf', title: 'CMF', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const chaikinOscillator: ClassicIndicatorSpec = {
    type: 'chaikin-oscillator',
    title: 'Chaikin Oscillator',
    overlay: false,
    inputs: [lengthInput(3, 'fastLength', 'Fast length'), lengthInput(10, 'slowLength', 'Slow length'), colorInput()],
    compute: (bars, inputs) => {
        const ad = cumSum(moneyFlowVolume(bars));
        const values = sub(ema(ad, num(inputs, 'fastLength', 3)), ema(ad, num(inputs, 'slowLength', 10)));
        return {
            plots: [{ key: 'co', title: 'Chaikin Osc', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const eom: ClassicIndicatorSpec = {
    type: 'ease-of-movement',
    title: 'Ease of Movement',
    shortTitle: 'EOM',
    overlay: false,
    inputs: [lengthInput(14), { key: 'divisor', title: 'Divisor', type: 'int', defval: 10000, min: 1, max: 1000000000, step: 1 }, colorInput()],
    compute: (bars, inputs) => {
        const div = num(inputs, 'divisor', 10000);
        const hl2 = sourceValues(bars, 'HL2');
        const move = change(hl2);
        const raw = bars.map((b, i) => {
            const m = move[i]!;
            if (b.volume == null || !Number.isFinite(b.volume) || b.volume === 0 || !Number.isFinite(m)) return Number.NaN;
            return (div * m * (b.high - b.low)) / b.volume;
        });
        return {
            plots: [{ key: 'eom', title: 'EOM', values: sma(raw, num(inputs, 'length', 14)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const forceIndex: ClassicIndicatorSpec = {
    type: 'force-index',
    title: 'Force Index',
    overlay: false,
    inputs: [lengthInput(13), colorInput()],
    compute: (bars, inputs) => {
        const raw = zip(change(closes(bars)), volumes(bars), (d, v) => d * v);
        return {
            plots: [{ key: 'force', title: 'Force', values: ema(raw, num(inputs, 'length', 13)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const klinger: ClassicIndicatorSpec = {
    type: 'klinger-oscillator',
    title: 'Klinger Oscillator',
    shortTitle: 'KVO',
    overlay: false,
    inputs: [lengthInput(34, 'fastLength', 'Fast length'), lengthInput(55, 'slowLength', 'Slow length'), lengthInput(13, 'signalLength', 'Signal length')],
    compute: (bars, inputs) => {
        const hlc3 = sourceValues(bars, 'HLC3');
        const trend = change(hlc3);
        const signedVolume = zip(volumes(bars), trend, (v, t) => (t >= 0 ? v : -v));
        const line = sub(ema(signedVolume, num(inputs, 'fastLength', 34)), ema(signedVolume, num(inputs, 'slowLength', 55)));
        return {
            plots: [
                { key: 'kvo', title: 'KVO', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: ema(line, num(inputs, 'signalLength', 13)), color: WARNING },
            ],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const mfi: ClassicIndicatorSpec = {
    type: 'money-flow-index',
    title: 'Money Flow Index',
    shortTitle: 'MFI',
    overlay: false,
    inputs: [lengthInput(14), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const tp = sourceValues(bars, 'HLC3');
        const rawFlow = zip(tp, volumes(bars), (p, v) => p * v);
        const d = change(tp);
        const pos = sum(zip(rawFlow, d, (f, x) => (x > 0 ? f : 0)), len);
        const neg = sum(zip(rawFlow, d, (f, x) => (x < 0 ? f : 0)), len);
        const values = zip(pos, neg, (p, n) => (n === 0 ? 100 : 100 - 100 / (1 + p / n)));
        return {
            plots: [{ key: 'mfi', title: 'MFI', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [
                { key: 'upper', price: 80, color: NEUTRAL },
                { key: 'lower', price: 20, color: NEUTRAL },
            ],
        };
    },
};

/** NVI/PVI share one cumulative walk gated on the volume comparison. */
function volumeIndex(bars: readonly OHLCV[], when: (vol: number, prevVol: number) => boolean): number[] {
    const out = new Array<number>(bars.length).fill(Number.NaN);
    let index = 1000;
    let started = false;
    for (let i = 1; i < bars.length; i++) {
        const v = bars[i]!.volume;
        const pv = bars[i - 1]!.volume;
        const pc = bars[i - 1]!.close;
        if (v == null || pv == null || !Number.isFinite(v) || !Number.isFinite(pv) || pc === 0) {
            if (started) out[i] = index;
            continue;
        }
        started = true;
        if (when(v, pv)) index += ((bars[i]!.close - pc) / pc) * index;
        out[i] = index;
    }
    return out;
}

const nvi: ClassicIndicatorSpec = {
    type: 'negative-volume-index',
    title: 'Negative Volume Index',
    shortTitle: 'NVI',
    overlay: false,
    inputs: [lengthInput(255, 'signalLength', 'Signal length'), colorInput()],
    compute: (bars, inputs) => {
        const line = volumeIndex(bars, (v, pv) => v < pv);
        return {
            plots: [
                { key: 'nvi', title: 'NVI', values: line, color: str(inputs, 'color', SERIES_LINE), width: 2 },
                { key: 'signal', title: 'Signal', values: ema(line, num(inputs, 'signalLength', 255)), color: WARNING },
            ],
        };
    },
};

const pvi: ClassicIndicatorSpec = {
    type: 'positive-volume-index',
    title: 'Positive Volume Index',
    shortTitle: 'PVI',
    overlay: false,
    inputs: [lengthInput(255, 'signalLength', 'Signal length'), colorInput()],
    compute: (bars, inputs) => {
        const line = volumeIndex(bars, (v, pv) => v > pv);
        return {
            plots: [
                { key: 'pvi', title: 'PVI', values: line, color: str(inputs, 'color', SERIES_LINE), width: 2 },
                { key: 'signal', title: 'Signal', values: ema(line, num(inputs, 'signalLength', 255)), color: WARNING },
            ],
        };
    },
};

const pvt: ClassicIndicatorSpec = {
    type: 'price-volume-trend',
    title: 'Price Volume Trend',
    shortTitle: 'PVT',
    overlay: false,
    inputs: [colorInput()],
    compute: (bars, inputs) => {
        const c = closes(bars);
        const raw = bars.map((b, i) => {
            if (i === 0 || b.volume == null || !Number.isFinite(b.volume)) return Number.NaN;
            const pc = c[i - 1]!;
            return pc === 0 ? 0 : ((c[i]! - pc) / pc) * b.volume;
        });
        return { plots: [{ key: 'pvt', title: 'PVT', values: cumSum(raw), color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const volumeOscillator: ClassicIndicatorSpec = {
    type: 'volume-oscillator',
    title: 'Volume Oscillator',
    overlay: false,
    inputs: [lengthInput(5, 'fastLength', 'Fast length'), lengthInput(10, 'slowLength', 'Slow length'), colorInput()],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const fast = ema(vol, num(inputs, 'fastLength', 5));
        const slow = ema(vol, num(inputs, 'slowLength', 10));
        const values = zip(fast, slow, (f, s) => (s === 0 ? Number.NaN : (100 * (f - s)) / s));
        return {
            plots: [{ key: 'vo', title: 'Volume Osc', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const pvo: ClassicIndicatorSpec = {
    type: 'pvo',
    title: 'Percentage Volume Oscillator',
    shortTitle: 'PVO',
    overlay: false,
    inputs: [lengthInput(12, 'fastLength', 'Fast length'), lengthInput(26, 'slowLength', 'Slow length'), lengthInput(9, 'signalLength', 'Signal length')],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const fast = ema(vol, num(inputs, 'fastLength', 12));
        const slow = ema(vol, num(inputs, 'slowLength', 26));
        const line = zip(fast, slow, (f, s) => (s === 0 ? Number.NaN : (100 * (f - s)) / s));
        const signal = ema(line, num(inputs, 'signalLength', 9));
        const hist = sub(line, signal);
        return {
            plots: [
                { key: 'hist', title: 'Histogram', values: hist, kind: 'histogram', color: BULLISH, colors: hist.map((x) => (Number.isFinite(x) ? (x >= 0 ? BULLISH : BEARISH) : null)), base: 0 },
                { key: 'pvo', title: 'PVO', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: signal, color: WARNING },
            ],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const vfi: ClassicIndicatorSpec = {
    type: 'volume-flow-indicator',
    title: 'Volume Flow Indicator',
    shortTitle: 'VFI',
    overlay: false,
    inputs: [
        lengthInput(130),
        { key: 'coef', title: 'Cutoff coefficient', type: 'float', defval: 0.2, min: 0.01, max: 10, step: 0.01 },
        { key: 'volCoef', title: 'Volume cap', type: 'float', defval: 2.5, min: 0.1, max: 50, step: 0.1 },
        lengthInput(3, 'smoothLength', 'Smoothing length'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 130);
        const coef = num(inputs, 'coef', 0.2);
        const volCoef = num(inputs, 'volCoef', 2.5);
        const typical = map(sourceValues(bars, 'HLC3'), Math.log);
        const inter = change(typical);
        const vInter = stdev(inter, 30);
        const vol = volumes(bars);
        const vAve = sma(vol, len);
        const mf = change(sourceValues(bars, 'HLC3'));
        const raw = bars.map((b, i) => {
            const cutoff = Number.isFinite(vInter[i]!) ? coef * vInter[i]! * b.close : Number.NaN;
            const v = vol[i]!;
            const ave = i > 0 ? vAve[i - 1]! : Number.NaN;
            const m = mf[i]!;
            if (!Number.isFinite(cutoff) || !Number.isFinite(v) || !Number.isFinite(ave) || !Number.isFinite(m)) return Number.NaN;
            const capped = Math.min(v, ave * volCoef);
            return m > cutoff ? capped : m < -cutoff ? -capped : 0;
        });
        const values = bars.map((_, i) => {
            const ave = i > 0 ? vAve[i - 1]! : Number.NaN;
            return Number.isFinite(ave) && ave !== 0 ? ave : Number.NaN;
        });
        const flowSum = sum(raw, len);
        const line = zip(flowSum, values, (f, a) => f / a);
        return {
            plots: [{ key: 'vfi', title: 'VFI', values: sma(line, num(inputs, 'smoothLength', 3)), color: SERIES_LINE, width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const intradayIntensity: ClassicIndicatorSpec = {
    type: 'intraday-intensity',
    title: 'Intraday Intensity',
    shortTitle: 'II%',
    overlay: false,
    inputs: [lengthInput(21), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const values = zip(sum(moneyFlowVolume(bars), len), sum(volumes(bars), len), (m, v) => (v === 0 ? 0 : (100 * m) / v));
        return {
            plots: [{ key: 'ii', title: 'II%', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

export const volumeSpecs: ClassicIndicatorSpec[] = [
    obv,
    accDist,
    cmf,
    chaikinOscillator,
    eom,
    forceIndex,
    klinger,
    mfi,
    nvi,
    pvi,
    pvt,
    volumeOscillator,
    pvo,
    vfi,
    intradayIntensity,
];
