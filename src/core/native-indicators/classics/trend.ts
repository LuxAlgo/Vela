import { SERIES_LINE, BULLISH, BEARISH, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num } from './define';
import { lengthInput } from './shared';
import { highs, lows, barsSinceHighest, barsSinceLowest, trueRange, rma, sum, map, zip } from './math';

/** Directional/trend-strength studies. */

const aroon: ClassicIndicatorSpec = {
    type: 'aroon',
    title: 'Aroon',
    overlay: false,
    inputs: [lengthInput(14)],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const up = map(barsSinceHighest(highs(bars), len + 1), (x) => (100 * (len - x)) / len);
        const down = map(barsSinceLowest(lows(bars), len + 1), (x) => (100 * (len - x)) / len);
        return {
            plots: [
                { key: 'up', title: 'Aroon up', values: up, color: BULLISH, width: 2 },
                { key: 'down', title: 'Aroon down', values: down, color: BEARISH, width: 2 },
            ],
            levels: [
                { key: 'upper', price: 100, color: NEUTRAL, lineStyle: 'dotted' },
                { key: 'lower', price: 0, color: NEUTRAL, lineStyle: 'dotted' },
            ],
        };
    },
};

const adx: ClassicIndicatorSpec = {
    type: 'average-directional-index',
    title: 'Average Directional Index',
    shortTitle: 'ADX',
    overlay: false,
    inputs: [lengthInput(14, 'diLength', 'DI length'), lengthInput(14, 'adxLength', 'ADX smoothing')],
    compute: (bars, inputs) => {
        const diLen = num(inputs, 'diLength', 14);
        const adxLen = num(inputs, 'adxLength', 14);
        const n = bars.length;
        const plusDm = new Array<number>(n).fill(Number.NaN);
        const minusDm = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            const up = bars[i]!.high - bars[i - 1]!.high;
            const dn = bars[i - 1]!.low - bars[i]!.low;
            plusDm[i] = up > dn && up > 0 ? up : 0;
            minusDm[i] = dn > up && dn > 0 ? dn : 0;
        }
        const atrLine = rma(trueRange(bars), diLen);
        const plusDi = zip(rma(plusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const minusDi = zip(rma(minusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const dx = zip(plusDi, minusDi, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
        return {
            plots: [
                { key: 'adx', title: 'ADX', values: rma(dx, adxLen), color: SERIES_LINE, width: 2 },
                { key: 'plusDi', title: '+DI', values: plusDi, color: BULLISH },
                { key: 'minusDi', title: '-DI', values: minusDi, color: BEARISH },
            ],
            levels: [{ key: 'threshold', price: 25, color: NEUTRAL, lineStyle: 'dotted' }],
        };
    },
};

const vortex: ClassicIndicatorSpec = {
    type: 'vortex-indicator',
    title: 'Vortex Indicator',
    shortTitle: 'VI',
    overlay: false,
    inputs: [lengthInput(14)],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const n = bars.length;
        const vmPlus = new Array<number>(n).fill(Number.NaN);
        const vmMinus = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            vmPlus[i] = Math.abs(bars[i]!.high - bars[i - 1]!.low);
            vmMinus[i] = Math.abs(bars[i]!.low - bars[i - 1]!.high);
        }
        const trSum = sum(trueRange(bars), len);
        return {
            plots: [
                { key: 'viPlus', title: 'VI+', values: zip(sum(vmPlus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: BULLISH, width: 2 },
                { key: 'viMinus', title: 'VI-', values: zip(sum(vmMinus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: BEARISH, width: 2 },
            ],
            levels: [{ key: 'one', price: 1, color: NEUTRAL, lineStyle: 'dotted' }],
        };
    },
};

export const trendSpecs: ClassicIndicatorSpec[] = [aroon, adx, vortex];
