import { SERIES_LINE, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { lengthInput, sourceInput, colorInput } from './shared';
import { sourceValues, highs, lows, closes, atr, trueRange, ema, sma, stdev, sum, roc, highest, lowest, change, map, zip, sub } from './math';

/** Volatility studies — how much price moves, regardless of direction. */

const atrSpec: ClassicIndicatorSpec = {
    type: 'average-true-range',
    title: 'Average True Range',
    shortTitle: 'ATR',
    overlay: false,
    inputs: [lengthInput(14), colorInput()],
    compute: (bars, inputs) => ({
        plots: [{ key: 'atr', title: 'ATR', values: atr(bars, num(inputs, 'length', 14)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
    }),
};

const historicalVolatility: ClassicIndicatorSpec = {
    type: 'historical-volatility',
    title: 'Historical Volatility',
    shortTitle: 'HV',
    overlay: false,
    inputs: [
        lengthInput(10),
        { key: 'annual', title: 'Periods per year', type: 'int', defval: 365, min: 1, max: 100000, step: 1, tooltip: 'Annualization factor (365 for daily crypto bars, 252 for stock sessions)' },
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const logReturns = map(change(map(closes(bars), Math.log)), (x) => x);
        const values = map(stdev(logReturns, num(inputs, 'length', 10)), (x) => x * Math.sqrt(num(inputs, 'annual', 365)) * 100);
        return { plots: [{ key: 'hv', title: 'HV', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const chaikinVolatility: ClassicIndicatorSpec = {
    type: 'chaikin-volatility',
    title: 'Chaikin Volatility',
    overlay: false,
    inputs: [lengthInput(10, 'emaLength', 'EMA length'), lengthInput(10, 'rocLength', 'RoC length'), colorInput()],
    compute: (bars, inputs) => {
        const range = ema(sub(highs(bars), lows(bars)), num(inputs, 'emaLength', 10));
        return {
            plots: [{ key: 'cv', title: 'Chaikin Vol', values: roc(range, num(inputs, 'rocLength', 10)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL }],
        };
    },
};

const massIndex: ClassicIndicatorSpec = {
    type: 'mass-index',
    title: 'Mass Index',
    overlay: false,
    inputs: [lengthInput(25), colorInput()],
    compute: (bars, inputs) => {
        const range = sub(highs(bars), lows(bars));
        const single = ema(range, 9);
        const ratio = zip(single, ema(single, 9), (a, b) => (b === 0 ? Number.NaN : a / b));
        return {
            plots: [{ key: 'mi', title: 'Mass Index', values: sum(ratio, num(inputs, 'length', 25)), color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [{ key: 'reversal', price: 27, color: NEUTRAL, lineStyle: 'dotted' }],
        };
    },
};

const standardDeviation: ClassicIndicatorSpec = {
    type: 'standard-deviation',
    title: 'Standard Deviation',
    shortTitle: 'StdDev',
    overlay: false,
    inputs: [lengthInput(20), sourceInput(), colorInput()],
    compute: (bars, inputs) => ({
        plots: [
            {
                key: 'stdev',
                title: 'StdDev',
                values: stdev(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 20)),
                color: str(inputs, 'color', SERIES_LINE),
                width: 2,
            },
        ],
    }),
};

const ulcerIndex: ClassicIndicatorSpec = {
    type: 'ulcer-index',
    title: 'Ulcer Index',
    overlay: false,
    inputs: [lengthInput(14), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const c = closes(bars);
        const drawdown = zip(c, highest(c, len), (x, h) => (h === 0 ? 0 : (100 * (x - h)) / h));
        const values = map(sma(map(drawdown, (d) => d * d), len), Math.sqrt);
        return { plots: [{ key: 'ui', title: 'Ulcer', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const choppiness: ClassicIndicatorSpec = {
    type: 'choppiness-index',
    title: 'Choppiness Index',
    shortTitle: 'CHOP',
    overlay: false,
    inputs: [lengthInput(14), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const trSum = sum(trueRange(bars), len);
        const span = zip(highest(highs(bars), len), lowest(lows(bars), len), (h, l) => h - l);
        const values = zip(trSum, span, (t, s) => (s > 0 && t > 0 ? (100 * Math.log10(t / s)) / Math.log10(len) : Number.NaN));
        return {
            plots: [{ key: 'chop', title: 'CHOP', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [
                { key: 'upper', price: 61.8, color: NEUTRAL },
                { key: 'lower', price: 38.2, color: NEUTRAL },
            ],
        };
    },
};

export const volatilitySpecs: ClassicIndicatorSpec[] = [atrSpec, historicalVolatility, chaikinVolatility, massIndex, standardDeviation, ulcerIndex, choppiness];
