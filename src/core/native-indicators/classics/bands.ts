import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import { SERIES_LINE, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { lengthInput, sourceInput, colorInput, withAlpha } from './shared';
import { sourceValues, highs, lows, sma, ema, rma, stdev, highest, lowest, atr, zip, map, sub, shift } from './math';

/** Bands and channels — envelopes around price plus their derived oscillators. */

function bollinger(bars: readonly OHLCV[], inputs: Record<string, InputValue>): { basis: number[]; upper: number[]; lower: number[] } {
    const len = num(inputs, 'length', 20);
    const mult = num(inputs, 'mult', 2);
    const src = sourceValues(bars, str(inputs, 'source', 'Close'));
    const basis = sma(src, len);
    const dev = map(stdev(src, len), (x) => x * mult);
    return { basis, upper: zip(basis, dev, (b, d) => b + d), lower: zip(basis, dev, (b, d) => b - d) };
}

const BB_INPUTS: InputSchema[] = [lengthInput(20), sourceInput(), { key: 'mult', title: 'StdDev', type: 'float', defval: 2, min: 0.1, max: 50, step: 0.1 }];

const bollingerBands: ClassicIndicatorSpec = {
    type: 'bollinger-bands',
    title: 'Bollinger Bands',
    shortTitle: 'BB',
    overlay: true,
    inputs: [...BB_INPUTS, colorInput()],
    compute: (bars, inputs) => {
        const { basis, upper, lower } = bollinger(bars, inputs);
        const ink = str(inputs, 'color', SERIES_LINE);
        return {
            plots: [
                { key: 'basis', title: 'Basis', values: basis, color: WARNING },
                { key: 'upper', title: 'Upper', values: upper, color: ink },
                { key: 'lower', title: 'Lower', values: lower, color: ink },
            ],
            bands: [{ key: 'bb', from: 'upper', to: 'lower', color: withAlpha(ink) }],
        };
    },
};

const percentB: ClassicIndicatorSpec = {
    type: 'percent-b',
    title: 'Bollinger Bands %B',
    shortTitle: '%B',
    overlay: false,
    inputs: [...BB_INPUTS, colorInput()],
    compute: (bars, inputs) => {
        const { upper, lower } = bollinger(bars, inputs);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = src.map((x, i) => {
            const u = upper[i]!;
            const l = lower[i]!;
            return Number.isFinite(u) && Number.isFinite(l) && u !== l ? (x - l) / (u - l) : Number.NaN;
        });
        return {
            plots: [{ key: 'pb', title: '%B', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }],
            levels: [
                { key: 'upper', price: 1, color: NEUTRAL },
                { key: 'middle', price: 0.5, color: NEUTRAL, lineStyle: 'dotted' },
                { key: 'lower', price: 0, color: NEUTRAL },
            ],
        };
    },
};

const bandwidth: ClassicIndicatorSpec = {
    type: 'bandwidth',
    title: 'Bollinger Bands Width',
    shortTitle: 'BBW',
    overlay: false,
    inputs: [...BB_INPUTS, colorInput()],
    compute: (bars, inputs) => {
        const { basis, upper, lower } = bollinger(bars, inputs);
        const values = basis.map((b, i) => {
            const u = upper[i]!;
            const l = lower[i]!;
            return Number.isFinite(b) && b !== 0 && Number.isFinite(u) && Number.isFinite(l) ? ((u - l) / b) * 100 : Number.NaN;
        });
        return { plots: [{ key: 'bbw', title: 'BBW', values, color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const keltner: ClassicIndicatorSpec = {
    type: 'keltner-channels',
    title: 'Keltner Channels',
    shortTitle: 'KC',
    overlay: true,
    inputs: [
        lengthInput(20),
        { key: 'mult', title: 'Multiplier', type: 'float', defval: 2, min: 0.1, max: 50, step: 0.1 },
        { key: 'atrLength', title: 'ATR length', type: 'int', defval: 10, min: 1, max: 500, step: 1 },
        sourceInput(),
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const mult = num(inputs, 'mult', 2);
        const basis = ema(sourceValues(bars, str(inputs, 'source', 'Close')), len);
        const range = map(atr(bars, num(inputs, 'atrLength', 10)), (x) => x * mult);
        const ink = str(inputs, 'color', SERIES_LINE);
        return {
            plots: [
                { key: 'basis', title: 'Basis', values: basis, color: WARNING },
                { key: 'upper', title: 'Upper', values: zip(basis, range, (b, r) => b + r), color: ink },
                { key: 'lower', title: 'Lower', values: zip(basis, range, (b, r) => b - r), color: ink },
            ],
            bands: [{ key: 'kc', from: 'upper', to: 'lower', color: withAlpha(ink) }],
        };
    },
};

const donchian: ClassicIndicatorSpec = {
    type: 'donchian-channels',
    title: 'Donchian Channels',
    shortTitle: 'DC',
    overlay: true,
    inputs: [lengthInput(20), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const upper = highest(highs(bars), len);
        const lower = lowest(lows(bars), len);
        const ink = str(inputs, 'color', SERIES_LINE);
        return {
            plots: [
                { key: 'basis', title: 'Basis', values: zip(upper, lower, (u, l) => (u + l) / 2), color: WARNING },
                { key: 'upper', title: 'Upper', values: upper, color: ink },
                { key: 'lower', title: 'Lower', values: lower, color: ink },
            ],
            bands: [{ key: 'dc', from: 'upper', to: 'lower', color: withAlpha(ink) }],
        };
    },
};

const chandelier: ClassicIndicatorSpec = {
    type: 'chandelier-exit',
    title: 'Chandelier Exit',
    shortTitle: 'CE',
    overlay: true,
    inputs: [lengthInput(22), { key: 'mult', title: 'ATR multiplier', type: 'float', defval: 3, min: 0.1, max: 50, step: 0.1 }],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 22);
        const range = map(atr(bars, len), (x) => x * num(inputs, 'mult', 3));
        const long = zip(highest(highs(bars), len), range, (h, r) => h - r);
        const short = zip(lowest(lows(bars), len), range, (l, r) => l + r);
        return {
            plots: [
                { key: 'long', title: 'Long stop', values: long, color: BULLISH },
                { key: 'short', title: 'Short stop', values: short, color: BEARISH },
            ],
        };
    },
};

const chandeKroll: ClassicIndicatorSpec = {
    type: 'chande-kroll-stop',
    title: 'Chande Kroll Stop',
    shortTitle: 'CKS',
    overlay: true,
    inputs: [
        { key: 'p', title: 'ATR length', type: 'int', defval: 10, min: 1, max: 500, step: 1 },
        { key: 'x', title: 'ATR multiplier', type: 'float', defval: 1, min: 0.1, max: 50, step: 0.1 },
        { key: 'q', title: 'Stop length', type: 'int', defval: 9, min: 1, max: 500, step: 1 },
    ],
    compute: (bars, inputs) => {
        const p = num(inputs, 'p', 10);
        const x = num(inputs, 'x', 1);
        const q = num(inputs, 'q', 9);
        const range = map(atr(bars, p), (v) => v * x);
        const firstHigh = zip(highest(highs(bars), p), range, (h, r) => h - r);
        const firstLow = zip(lowest(lows(bars), p), range, (l, r) => l + r);
        return {
            plots: [
                { key: 'stopShort', title: 'Stop short', values: highest(firstHigh, q), color: BEARISH },
                { key: 'stopLong', title: 'Stop long', values: lowest(firstLow, q), color: BULLISH },
            ],
        };
    },
};

const supertrend: ClassicIndicatorSpec = {
    type: 'supertrend',
    title: 'SuperTrend',
    shortTitle: 'ST',
    overlay: true,
    inputs: [
        { key: 'atrLength', title: 'ATR length', type: 'int', defval: 10, min: 1, max: 500, step: 1 },
        { key: 'mult', title: 'Factor', type: 'float', defval: 3, min: 0.1, max: 50, step: 0.1 },
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'atrLength', 10);
        const mult = num(inputs, 'mult', 3);
        const range = atr(bars, len);
        const n = bars.length;
        const st = new Array<number>(n).fill(Number.NaN);
        const dir = new Array<number>(n).fill(1);
        let up = Number.NaN;
        let dn = Number.NaN;
        let trend = 1;
        for (let i = 0; i < n; i++) {
            const r = range[i]!;
            if (!Number.isFinite(r)) continue;
            const b = bars[i]!;
            const mid = (b.high + b.low) / 2;
            const basicUp = mid - mult * r;
            const basicDn = mid + mult * r;
            const prevClose = i > 0 ? bars[i - 1]!.close : b.close;
            // Bands ratchet: a rising lower band never gives ground while price holds above it.
            up = Number.isFinite(up) && prevClose > up ? Math.max(basicUp, up) : basicUp;
            dn = Number.isFinite(dn) && prevClose < dn ? Math.min(basicDn, dn) : basicDn;
            if (trend === 1 && b.close < up) trend = -1;
            else if (trend === -1 && b.close > dn) trend = 1;
            dir[i] = trend;
            st[i] = trend === 1 ? up : dn;
        }
        const colors = dir.map((d, i) => (Number.isFinite(st[i]!) ? (d === 1 ? BULLISH : BEARISH) : null));
        return { plots: [{ key: 'st', title: 'SuperTrend', values: st, color: BULLISH, width: 2, colors }] };
    },
};

const alligator: ClassicIndicatorSpec = {
    type: 'williams-alligator',
    title: 'Williams Alligator',
    shortTitle: 'Alligator',
    overlay: true,
    inputs: [
        { key: 'jawLength', title: 'Jaw length', type: 'int', defval: 13, min: 1, max: 500, step: 1 },
        { key: 'teethLength', title: 'Teeth length', type: 'int', defval: 8, min: 1, max: 500, step: 1 },
        { key: 'lipsLength', title: 'Lips length', type: 'int', defval: 5, min: 1, max: 500, step: 1 },
        { key: 'jawOffset', title: 'Jaw offset', type: 'int', defval: 8, min: 0, max: 100, step: 1 },
        { key: 'teethOffset', title: 'Teeth offset', type: 'int', defval: 5, min: 0, max: 100, step: 1 },
        { key: 'lipsOffset', title: 'Lips offset', type: 'int', defval: 3, min: 0, max: 100, step: 1 },
    ],
    compute: (bars, inputs) => {
        const hl2 = sourceValues(bars, 'HL2');
        // Offsets plot each jaw within the available bars (no future timestamps to plot onto).
        const jaw = shift(rma(hl2, num(inputs, 'jawLength', 13)), num(inputs, 'jawOffset', 8));
        const teeth = shift(rma(hl2, num(inputs, 'teethLength', 8)), num(inputs, 'teethOffset', 5));
        const lips = shift(rma(hl2, num(inputs, 'lipsLength', 5)), num(inputs, 'lipsOffset', 3));
        return {
            plots: [
                { key: 'jaw', title: 'Jaw', values: jaw, color: SERIES_LINE },
                { key: 'teeth', title: 'Teeth', values: teeth, color: BEARISH },
                { key: 'lips', title: 'Lips', values: lips, color: BULLISH },
            ],
        };
    },
};

const gator: ClassicIndicatorSpec = {
    type: 'gator-oscillator',
    title: 'Gator Oscillator',
    shortTitle: 'Gator',
    overlay: false,
    inputs: [],
    compute: (bars) => {
        const hl2 = sourceValues(bars, 'HL2');
        const jaw = shift(rma(hl2, 13), 8);
        const teeth = shift(rma(hl2, 8), 5);
        const lips = shift(rma(hl2, 5), 3);
        const upper = map(sub(jaw, teeth), Math.abs);
        const lower = map(sub(teeth, lips), (x) => -Math.abs(x));
        const colorByExpansion = (v: readonly number[]): Array<string | null> =>
            v.map((x, i) => {
                if (!Number.isFinite(x)) return null;
                const prev = i > 0 ? v[i - 1]! : Number.NaN;
                return Number.isFinite(prev) && Math.abs(x) > Math.abs(prev) ? BULLISH : BEARISH;
            });
        return {
            plots: [
                { key: 'upper', title: 'Upper', values: upper, kind: 'histogram', color: BULLISH, colors: colorByExpansion(upper), base: 0 },
                { key: 'lower', title: 'Lower', values: lower, kind: 'histogram', color: BEARISH, colors: colorByExpansion(lower), base: 0 },
            ],
        };
    },
};

export const bandSpecs: ClassicIndicatorSpec[] = [bollingerBands, percentB, bandwidth, keltner, donchian, chandelier, chandeKroll, supertrend, alligator, gator];
