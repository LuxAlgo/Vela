import { SERIES_LINE, BULLISH, BEARISH, NEUTRAL, WARNING, INFO } from '../../palette';
import type { ClassicIndicatorSpec, ClassicLevel } from './define';
import { num, str } from './define';
import { lengthInput, sourceInput, colorInput } from './shared';
import {
    sourceValues,
    highs,
    lows,
    closes,
    opens,
    sma,
    ema,
    rma,
    wma,
    stdev,
    highest,
    lowest,
    sum,
    change,
    roc,
    rsi,
    stoch,
    linreg,
    swma,
    percentRank,
    trueRange,
    zip,
    map,
    sub,
    shift,
} from './math';

/** Momentum oscillators — study-pane classics driven by a price source. */

function guideLevels(low: number, high: number, mid?: number): ClassicLevel[] {
    const levels: ClassicLevel[] = [
        { key: 'upper', price: high, color: NEUTRAL },
        { key: 'lower', price: low, color: NEUTRAL },
    ];
    if (mid != null) levels.splice(1, 0, { key: 'middle', price: mid, color: NEUTRAL, lineStyle: 'dotted' });
    return levels;
}

const ZERO_LEVEL: ClassicLevel[] = [{ key: 'zero', price: 0, color: NEUTRAL }];

/** Histogram colors: direction by sign, brightness by rising/falling. */
function histColors(values: readonly number[]): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 ? values[i - 1]! : Number.NaN;
        const rising = Number.isFinite(prev) ? x >= prev : true;
        if (x >= 0) return rising ? BULLISH : `${BULLISH}80`;
        return rising ? `${BEARISH}80` : BEARISH;
    });
}

const rsiSpec: ClassicIndicatorSpec = {
    type: 'rsi',
    title: 'Relative Strength Index',
    shortTitle: 'RSI',
    overlay: false,
    inputs: [lengthInput(14), sourceInput(), colorInput()],
    compute: (bars, inputs) => ({
        plots: [
            {
                key: 'rsi',
                title: 'RSI',
                values: rsi(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)),
                color: str(inputs, 'color', SERIES_LINE),
                width: 2,
            },
        ],
        levels: guideLevels(30, 70, 50),
    }),
};

const stochastic: ClassicIndicatorSpec = {
    type: 'stochastic',
    title: 'Stochastic',
    shortTitle: 'Stoch',
    overlay: false,
    inputs: [
        lengthInput(14, 'kLength', '%K length'),
        lengthInput(1, 'kSmoothing', '%K smoothing', 500),
        lengthInput(3, 'dLength', '%D smoothing', 500),
    ],
    compute: (bars, inputs) => {
        const k = sma(stoch(closes(bars), highs(bars), lows(bars), num(inputs, 'kLength', 14)), num(inputs, 'kSmoothing', 1));
        const d = sma(k, num(inputs, 'dLength', 3));
        return {
            plots: [
                { key: 'k', title: '%K', values: k, color: SERIES_LINE, width: 2 },
                { key: 'd', title: '%D', values: d, color: WARNING },
            ],
            levels: guideLevels(20, 80),
        };
    },
};

const stochasticRsi: ClassicIndicatorSpec = {
    type: 'stochastic-rsi',
    title: 'Stochastic RSI',
    shortTitle: 'Stoch RSI',
    overlay: false,
    inputs: [
        lengthInput(14, 'rsiLength', 'RSI length'),
        lengthInput(14, 'stochLength', 'Stochastic length'),
        lengthInput(3, 'kSmoothing', '%K smoothing', 500),
        lengthInput(3, 'dLength', '%D smoothing', 500),
        sourceInput(),
    ],
    compute: (bars, inputs) => {
        const r = rsi(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'rsiLength', 14));
        const k = sma(stoch(r, r, r, num(inputs, 'stochLength', 14)), num(inputs, 'kSmoothing', 3));
        const d = sma(k, num(inputs, 'dLength', 3));
        return {
            plots: [
                { key: 'k', title: '%K', values: k, color: SERIES_LINE, width: 2 },
                { key: 'd', title: '%D', values: d, color: WARNING },
            ],
            levels: guideLevels(20, 80),
        };
    },
};

const macd: ClassicIndicatorSpec = {
    type: 'macd',
    title: 'MACD',
    overlay: false,
    inputs: [
        lengthInput(12, 'fastLength', 'Fast length'),
        lengthInput(26, 'slowLength', 'Slow length'),
        lengthInput(9, 'signalLength', 'Signal smoothing', 500),
        sourceInput(),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const line = sub(ema(src, num(inputs, 'fastLength', 12)), ema(src, num(inputs, 'slowLength', 26)));
        const signal = ema(line, num(inputs, 'signalLength', 9));
        const hist = sub(line, signal);
        return {
            plots: [
                { key: 'hist', title: 'Histogram', values: hist, kind: 'histogram', color: BULLISH, colors: histColors(hist), base: 0 },
                { key: 'macd', title: 'MACD', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: signal, color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const ppo: ClassicIndicatorSpec = {
    type: 'ppo',
    title: 'Percentage Price Oscillator',
    shortTitle: 'PPO',
    overlay: false,
    inputs: [
        lengthInput(12, 'fastLength', 'Fast length'),
        lengthInput(26, 'slowLength', 'Slow length'),
        lengthInput(9, 'signalLength', 'Signal smoothing', 500),
        sourceInput(),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const fast = ema(src, num(inputs, 'fastLength', 12));
        const slow = ema(src, num(inputs, 'slowLength', 26));
        const line = zip(fast, slow, (f, s) => (s === 0 ? Number.NaN : ((f - s) / s) * 100));
        const signal = ema(line, num(inputs, 'signalLength', 9));
        const hist = sub(line, signal);
        return {
            plots: [
                { key: 'hist', title: 'Histogram', values: hist, kind: 'histogram', color: BULLISH, colors: histColors(hist), base: 0 },
                { key: 'ppo', title: 'PPO', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: signal, color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const awesome: ClassicIndicatorSpec = {
    type: 'awesome-oscillator',
    title: 'Awesome Oscillator',
    shortTitle: 'AO',
    overlay: false,
    inputs: [],
    compute: (bars) => {
        const hl2 = sourceValues(bars, 'HL2');
        const ao = sub(sma(hl2, 5), sma(hl2, 34));
        const colors = ao.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            const prev = i > 0 ? ao[i - 1]! : Number.NaN;
            return Number.isFinite(prev) && x < prev ? BEARISH : BULLISH;
        });
        return {
            plots: [{ key: 'ao', title: 'AO', values: ao, kind: 'histogram', color: BULLISH, colors, base: 0 }],
            levels: ZERO_LEVEL,
        };
    },
};

const cci: ClassicIndicatorSpec = {
    type: 'commodity-channel-index',
    title: 'Commodity Channel Index',
    shortTitle: 'CCI',
    overlay: false,
    inputs: [lengthInput(20), sourceInput('HLC3'), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const src = sourceValues(bars, str(inputs, 'source', 'HLC3'));
        const basis = sma(src, len);
        // Mean absolute deviation of the window around its own mean.
        const dev = new Array<number>(src.length).fill(Number.NaN);
        for (let i = len - 1; i < src.length; i++) {
            const mean = basis[i]!;
            if (!Number.isFinite(mean)) continue;
            let d = 0;
            for (let k = i - len + 1; k <= i; k++) d += Math.abs(src[k]! - mean);
            dev[i] = d / len;
        }
        const values = src.map((x, i) => {
            const b = basis[i]!;
            const d = dev[i]!;
            return Number.isFinite(b) && Number.isFinite(d) && d !== 0 ? (x - b) / (0.015 * d) : Number.NaN;
        });
        return {
            plots: [{ key: 'cci', title: 'CCI', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(-100, 100, 0),
        };
    },
};

const williamsR: ClassicIndicatorSpec = {
    type: 'williams-percent-r',
    title: 'Williams %R',
    shortTitle: '%R',
    overlay: false,
    inputs: [lengthInput(14), colorInput()],
    compute: (bars, inputs) => {
        const values = map(stoch(closes(bars), highs(bars), lows(bars), num(inputs, 'length', 14)), (x) => x - 100);
        return {
            plots: [{ key: 'wr', title: '%R', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(-80, -20),
        };
    },
};

const cmo: ClassicIndicatorSpec = {
    type: 'chande-momentum-oscillator',
    title: 'Chande Momentum Oscillator',
    shortTitle: 'CMO',
    overlay: false,
    inputs: [lengthInput(9), sourceInput(), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const d = change(sourceValues(bars, str(inputs, 'source', 'Close')));
        const su = sum(map(d, (x) => Math.max(x, 0)), len);
        const sd = sum(map(d, (x) => Math.max(-x, 0)), len);
        const values = zip(su, sd, (u, w) => (u + w === 0 ? 0 : (100 * (u - w)) / (u + w)));
        return {
            plots: [{ key: 'cmo', title: 'CMO', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(-50, 50, 0),
        };
    },
};

const connorsRsi: ClassicIndicatorSpec = {
    type: 'connors-rsi',
    title: 'Connors RSI',
    shortTitle: 'CRSI',
    overlay: false,
    inputs: [
        lengthInput(3, 'rsiLength', 'RSI length'),
        lengthInput(2, 'streakLength', 'Streak RSI length'),
        lengthInput(100, 'rankLength', 'Percent-rank length'),
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const c = closes(bars);
        // Signed run length of consecutive closes in one direction.
        const streak = new Array<number>(c.length).fill(0);
        for (let i = 1; i < c.length; i++) {
            const d = c[i]! - c[i - 1]!;
            streak[i] = d > 0 ? Math.max(streak[i - 1]!, 0) + 1 : d < 0 ? Math.min(streak[i - 1]!, 0) - 1 : 0;
        }
        const a = rsi(c, num(inputs, 'rsiLength', 3));
        const b = rsi(streak, num(inputs, 'streakLength', 2));
        const r = percentRank(roc(c, 1), num(inputs, 'rankLength', 100));
        const values = c.map((_, i) => {
            const x = a[i]!;
            const y = b[i]!;
            const z = r[i]!;
            return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? (x + y + z) / 3 : Number.NaN;
        });
        return {
            plots: [{ key: 'crsi', title: 'CRSI', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(20, 80, 50),
        };
    },
};

const fisher: ClassicIndicatorSpec = {
    type: 'fisher-transform',
    title: 'Fisher Transform',
    shortTitle: 'Fisher',
    overlay: false,
    inputs: [lengthInput(9)],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const hl2 = sourceValues(bars, 'HL2');
        const hi = highest(hl2, len);
        const lo = lowest(hl2, len);
        const n = bars.length;
        const out = new Array<number>(n).fill(Number.NaN);
        let value = 0;
        let fish = 0;
        for (let i = 0; i < n; i++) {
            const h = hi[i]!;
            const l = lo[i]!;
            if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
            const norm = h === l ? 0 : (hl2[i]! - l) / (h - l) - 0.5;
            value = Math.max(-0.999, Math.min(0.999, 0.66 * norm + 0.67 * value));
            fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
            out[i] = fish;
        }
        return {
            plots: [
                { key: 'fisher', title: 'Fisher', values: out, color: SERIES_LINE, width: 2 },
                { key: 'trigger', title: 'Trigger', values: shift(out, 1), color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const trix: ClassicIndicatorSpec = {
    type: 'trix',
    title: 'TRIX',
    overlay: false,
    inputs: [lengthInput(18), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 18);
        const logClose = map(closes(bars), Math.log);
        const smooth = ema(ema(ema(logClose, len), len), len);
        const values = map(change(smooth), (x) => x * 10000);
        return {
            plots: [{ key: 'trix', title: 'TRIX', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: ZERO_LEVEL,
        };
    },
};

function tsiLine(src: readonly number[], long: number, short: number): number[] {
    const mom = change(src);
    const numer = ema(ema(mom, long), short);
    const denom = ema(ema(map(mom, Math.abs), long), short);
    return zip(numer, denom, (a, b) => (b === 0 ? 0 : (100 * a) / b));
}

const tsi: ClassicIndicatorSpec = {
    type: 'true-strength-index',
    title: 'True Strength Index',
    shortTitle: 'TSI',
    overlay: false,
    inputs: [lengthInput(25, 'longLength', 'Long length'), lengthInput(13, 'shortLength', 'Short length'), lengthInput(13, 'signalLength', 'Signal length')],
    compute: (bars, inputs) => {
        const line = tsiLine(closes(bars), num(inputs, 'longLength', 25), num(inputs, 'shortLength', 13));
        return {
            plots: [
                { key: 'tsi', title: 'TSI', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: ema(line, num(inputs, 'signalLength', 13)), color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const smiErgodic: ClassicIndicatorSpec = {
    type: 'smi-ergodic',
    title: 'SMI Ergodic Oscillator',
    shortTitle: 'SMI',
    overlay: false,
    inputs: [lengthInput(5, 'shortLength', 'Short length'), lengthInput(20, 'longLength', 'Long length'), lengthInput(5, 'signalLength', 'Signal length')],
    compute: (bars, inputs) => {
        const line = tsiLine(closes(bars), num(inputs, 'longLength', 20), num(inputs, 'shortLength', 5));
        const signal = ema(line, num(inputs, 'signalLength', 5));
        const osc = sub(line, signal);
        return {
            plots: [
                { key: 'osc', title: 'Oscillator', values: osc, kind: 'histogram', color: BULLISH, colors: histColors(osc), base: 0 },
                { key: 'smi', title: 'SMI', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: signal, color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const stc: ClassicIndicatorSpec = {
    type: 'schaff-trend-cycle',
    title: 'Schaff Trend Cycle',
    shortTitle: 'STC',
    overlay: false,
    inputs: [lengthInput(10, 'cycleLength', 'Cycle length'), lengthInput(23, 'fastLength', 'Fast length'), lengthInput(50, 'slowLength', 'Slow length')],
    compute: (bars, inputs) => {
        const len = num(inputs, 'cycleLength', 10);
        const src = closes(bars);
        const macdLine = sub(ema(src, num(inputs, 'fastLength', 23)), ema(src, num(inputs, 'slowLength', 50)));
        // Double-stochastic of the MACD line, each pass half-smoothed recursively.
        const stochOf = (v: readonly number[]): number[] => {
            const lo = lowest(v, len);
            const hi = highest(v, len);
            const out = new Array<number>(v.length).fill(Number.NaN);
            let prevRaw = Number.NaN;
            let smoothed = Number.NaN;
            for (let i = 0; i < v.length; i++) {
                const x = v[i]!;
                const l = lo[i]!;
                const h = hi[i]!;
                if (!Number.isFinite(x) || !Number.isFinite(l) || !Number.isFinite(h)) continue;
                const raw = h > l ? ((x - l) / (h - l)) * 100 : Number.isFinite(prevRaw) ? prevRaw : 50;
                prevRaw = raw;
                smoothed = Number.isFinite(smoothed) ? smoothed + 0.5 * (raw - smoothed) : raw;
                out[i] = smoothed;
            }
            return out;
        };
        const values = stochOf(stochOf(macdLine));
        return {
            plots: [{ key: 'stc', title: 'STC', values, color: SERIES_LINE, width: 2 }],
            levels: guideLevels(25, 75),
        };
    },
};

const kst: ClassicIndicatorSpec = {
    type: 'know-sure-thing',
    title: 'Know Sure Thing',
    shortTitle: 'KST',
    overlay: false,
    inputs: [sourceInput(), lengthInput(9, 'signalLength', 'Signal length')],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const line = [
            sma(roc(src, 10), 10),
            sma(roc(src, 15), 10),
            sma(roc(src, 20), 10),
            sma(roc(src, 30), 15),
        ].reduce((acc, r, i) => zip(acc, r, (a, b) => a + b * (i + 1)), new Array<number>(src.length).fill(0));
        return {
            plots: [
                { key: 'kst', title: 'KST', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: sma(line, num(inputs, 'signalLength', 9)), color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const coppock: ClassicIndicatorSpec = {
    type: 'coppock-curve',
    title: 'Coppock Curve',
    overlay: false,
    inputs: [
        lengthInput(10, 'wmaLength', 'WMA length'),
        lengthInput(14, 'longRoc', 'Long RoC length'),
        lengthInput(11, 'shortRoc', 'Short RoC length'),
        sourceInput(),
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = wma(zip(roc(src, num(inputs, 'longRoc', 14)), roc(src, num(inputs, 'shortRoc', 11)), (a, b) => a + b), num(inputs, 'wmaLength', 10));
        return {
            plots: [{ key: 'coppock', title: 'Coppock', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: ZERO_LEVEL,
        };
    },
};

const dpo: ClassicIndicatorSpec = {
    type: 'detrended-price-oscillator',
    title: 'Detrended Price Oscillator',
    shortTitle: 'DPO',
    overlay: false,
    inputs: [lengthInput(21), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const barsback = Math.floor(len / 2) + 1;
        const values = sub(closes(bars), shift(sma(closes(bars), len), barsback));
        return {
            plots: [{ key: 'dpo', title: 'DPO', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: ZERO_LEVEL,
        };
    },
};

const rocSpec: ClassicIndicatorSpec = {
    type: 'rate-of-change',
    title: 'Rate of Change',
    shortTitle: 'RoC',
    overlay: false,
    inputs: [lengthInput(9), sourceInput(), colorInput()],
    compute: (bars, inputs) => ({
        plots: [
            {
                key: 'roc',
                title: 'RoC',
                values: roc(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 9)),
                color: str(inputs, 'color', SERIES_LINE),
                width: 2,
            },
        ],
        levels: ZERO_LEVEL,
    }),
};

const ultimate: ClassicIndicatorSpec = {
    type: 'ultimate-oscillator',
    title: 'Ultimate Oscillator',
    shortTitle: 'UO',
    overlay: false,
    inputs: [lengthInput(7, 'fastLength', 'Fast length'), lengthInput(14, 'middleLength', 'Middle length'), lengthInput(28, 'slowLength', 'Slow length'), colorInput()],
    compute: (bars, inputs) => {
        const n = bars.length;
        const bp = new Array<number>(n).fill(Number.NaN);
        const tr = new Array<number>(n).fill(Number.NaN);
        for (let i = 0; i < n; i++) {
            const b = bars[i]!;
            const pc = i > 0 ? bars[i - 1]!.close : b.close;
            const lo = Math.min(b.low, pc);
            const hi = Math.max(b.high, pc);
            bp[i] = b.close - lo;
            tr[i] = hi - lo;
        }
        const avg = (len: number): number[] => zip(sum(bp, len), sum(tr, len), (a, b) => (b === 0 ? Number.NaN : a / b));
        const a7 = avg(num(inputs, 'fastLength', 7));
        const a14 = avg(num(inputs, 'middleLength', 14));
        const a28 = avg(num(inputs, 'slowLength', 28));
        const values = a7.map((x, i) => {
            const y = a14[i]!;
            const z = a28[i]!;
            return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? (100 * (4 * x + 2 * y + z)) / 7 : Number.NaN;
        });
        return {
            plots: [{ key: 'uo', title: 'UO', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(30, 70, 50),
        };
    },
};

const rvgi: ClassicIndicatorSpec = {
    type: 'relative-vigor-index',
    title: 'Relative Vigor Index',
    shortTitle: 'RVGI',
    overlay: false,
    inputs: [lengthInput(10)],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const co = swma(sub(closes(bars), opens(bars)));
        const hl = swma(sub(highs(bars), lows(bars)));
        const line = zip(sum(co, len), sum(hl, len), (a, b) => (b === 0 ? 0 : a / b));
        return {
            plots: [
                { key: 'rvgi', title: 'RVGI', values: line, color: SERIES_LINE, width: 2 },
                { key: 'signal', title: 'Signal', values: swma(line), color: WARNING },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const relVolatility: ClassicIndicatorSpec = {
    type: 'relative-volatility-index',
    title: 'Relative Volatility Index',
    shortTitle: 'RVI',
    overlay: false,
    inputs: [lengthInput(10, 'stdevLength', 'StdDev length'), lengthInput(14, 'smoothLength', 'Smoothing length'), sourceInput(), colorInput()],
    compute: (bars, inputs) => {
        const smoothLen = num(inputs, 'smoothLength', 14);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const dev = stdev(src, num(inputs, 'stdevLength', 10));
        const d = change(src);
        const up = rma(zip(dev, d, (s, x) => (x > 0 ? s : 0)), smoothLen);
        const dn = rma(zip(dev, d, (s, x) => (x <= 0 ? s : 0)), smoothLen);
        const values = zip(up, dn, (u, w) => (u + w === 0 ? 50 : (100 * u) / (u + w)));
        return {
            plots: [{ key: 'rvi', title: 'RVI', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: guideLevels(20, 80, 50),
        };
    },
};

const bop: ClassicIndicatorSpec = {
    type: 'balance-of-power',
    title: 'Balance of Power',
    shortTitle: 'BOP',
    overlay: false,
    inputs: [colorInput()],
    compute: (bars, inputs) => {
        const values = bars.map((b) => (b.high === b.low ? 0 : (b.close - b.open) / (b.high - b.low)));
        return {
            plots: [{ key: 'bop', title: 'BOP', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: ZERO_LEVEL,
        };
    },
};

const elderRay: ClassicIndicatorSpec = {
    type: 'elder-ray',
    title: 'Elder Ray',
    overlay: false,
    inputs: [lengthInput(13)],
    compute: (bars, inputs) => {
        const basis = ema(closes(bars), num(inputs, 'length', 13));
        return {
            plots: [
                { key: 'bull', title: 'Bull power', values: sub(highs(bars), basis), kind: 'histogram', color: BULLISH, base: 0 },
                { key: 'bear', title: 'Bear power', values: sub(lows(bars), basis), kind: 'histogram', color: BEARISH, base: 0 },
            ],
            levels: ZERO_LEVEL,
        };
    },
};

const ttmSqueeze: ClassicIndicatorSpec = {
    type: 'ttm-squeeze',
    title: 'TTM Squeeze',
    overlay: false,
    inputs: [
        lengthInput(20),
        { key: 'bbMult', title: 'Bollinger multiplier', type: 'float', defval: 2, min: 0.1, max: 50, step: 0.1 },
        { key: 'kcMult', title: 'Keltner multiplier', type: 'float', defval: 1.5, min: 0.1, max: 50, step: 0.1 },
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const c = closes(bars);
        const basis = sma(c, len);
        const dev = map(stdev(c, len), (x) => x * num(inputs, 'bbMult', 2));
        const kcRange = map(rma(trueRange(bars), len), (x) => x * num(inputs, 'kcMult', 1.5));
        // Momentum: linear regression of price minus the midline of its Donchian/SMA anchor.
        const donchianMid = zip(highest(highs(bars), len), lowest(lows(bars), len), (h, l) => (h + l) / 2);
        const anchor = zip(donchianMid, basis, (d, b) => (d + b) / 2);
        const mom = linreg(sub(c, anchor), len);
        // Squeeze is ON while the Bollinger band sits inside the Keltner channel.
        const squeezed = c.map((_, i) => {
            const d = dev[i]!;
            const r = kcRange[i]!;
            return Number.isFinite(d) && Number.isFinite(r) ? d < r : false;
        });
        const stateColors = squeezed.map((s, i) => (Number.isFinite(mom[i]!) ? (s ? BEARISH : BULLISH) : null));
        return {
            plots: [
                { key: 'mom', title: 'Momentum', values: mom, kind: 'histogram', color: BULLISH, colors: histColors(mom), base: 0 },
                { key: 'squeeze', title: 'Squeeze', values: mom.map((x) => (Number.isFinite(x) ? 0 : Number.NaN)), kind: 'cross', color: INFO, colors: stateColors },
            ],
        };
    },
};

export const oscillatorSpecs: ClassicIndicatorSpec[] = [
    rsiSpec,
    stochastic,
    stochasticRsi,
    macd,
    ppo,
    awesome,
    cci,
    williamsR,
    cmo,
    connorsRsi,
    fisher,
    trix,
    tsi,
    smiErgodic,
    stc,
    kst,
    coppock,
    dpo,
    rocSpec,
    ultimate,
    rvgi,
    relVolatility,
    bop,
    elderRay,
    ttmSqueeze,
];
