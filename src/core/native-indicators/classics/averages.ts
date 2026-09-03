import { SERIES_LINE } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { lengthInput, sourceInput, colorInput, withAlpha } from './shared';
import { sourceValues, volumes, sma, ema, rma, wma, vwma, linreg, change, map, zip, shift } from './math';

/** Moving-average family — overlays that smooth a price source. */

const MA_KINDS = ['SMA', 'EMA', 'WMA', 'RMA', 'VWMA'] as const;

const movingAverage: ClassicIndicatorSpec = {
    type: 'moving-average',
    title: 'Moving Average',
    shortTitle: 'MA',
    overlay: true,
    inputs: [
        { key: 'maType', title: 'Type', type: 'string', defval: 'SMA', options: MA_KINDS },
        lengthInput(20),
        sourceInput(),
        { key: 'offset', title: 'Offset', type: 'int', defval: 0, min: -500, max: 500, step: 1 },
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const kind = str(inputs, 'maType', 'SMA');
        let values: number[];
        switch (kind) {
            case 'EMA': values = ema(src, len); break;
            case 'WMA': values = wma(src, len); break;
            case 'RMA': values = rma(src, len); break;
            case 'VWMA': values = vwma(src, volumes(bars), len); break;
            default: values = sma(src, len);
        }
        const offset = Math.trunc(num(inputs, 'offset', 0));
        if (offset !== 0) values = shift(values, offset);
        return { plots: [{ key: 'ma', title: kind, values, color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const smoothedMa: ClassicIndicatorSpec = {
    type: 'rma',
    title: 'Smoothed Moving Average',
    shortTitle: 'RMA',
    overlay: true,
    inputs: [lengthInput(14), sourceInput(), colorInput()],
    compute: (bars, inputs) => ({
        plots: [
            {
                key: 'rma',
                title: 'RMA',
                values: rma(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)),
                color: str(inputs, 'color', SERIES_LINE),
                width: 2,
            },
        ],
    }),
};

const zlema: ClassicIndicatorSpec = {
    type: 'zlema',
    title: 'Zero-Lag Exponential Moving Average',
    shortTitle: 'ZLEMA',
    overlay: true,
    inputs: [lengthInput(14), sourceInput(), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        // De-lagged input: src + (src - src[lag]) with lag = (len - 1) / 2.
        const lag = Math.floor((len - 1) / 2);
        const lagged = shift(src, lag);
        const delagged = zip(src, lagged, (a, b) => 2 * a - b);
        return { plots: [{ key: 'zlema', title: 'ZLEMA', values: ema(delagged, len), color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const vidya: ClassicIndicatorSpec = {
    type: 'vidya',
    title: 'Variable Index Dynamic Average',
    shortTitle: 'VIDYA',
    overlay: true,
    inputs: [lengthInput(14), { key: 'cmoLength', title: 'Momentum length', type: 'int', defval: 9, min: 1, max: 500, step: 1 }, sourceInput(), colorInput()],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const cmoLen = num(inputs, 'cmoLength', 9);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        // Chande momentum drives the smoothing weight: strong trends track price,
        // quiet stretches flatten.
        const d = change(src);
        const su = new Array<number>(src.length).fill(Number.NaN);
        const sd = new Array<number>(src.length).fill(Number.NaN);
        for (let i = cmoLen; i < src.length; i++) {
            let u = 0;
            let w = 0;
            let ok = true;
            for (let k = i - cmoLen + 1; k <= i; k++) {
                const x = d[k]!;
                if (!Number.isFinite(x)) {
                    ok = false;
                    break;
                }
                if (x > 0) u += x;
                else w -= x;
            }
            if (ok) {
                su[i] = u;
                sd[i] = w;
            }
        }
        const alpha = 2 / (len + 1);
        const out = new Array<number>(src.length).fill(Number.NaN);
        let prev = Number.NaN;
        for (let i = 0; i < src.length; i++) {
            const x = src[i]!;
            const u = su[i]!;
            const w = sd[i]!;
            if (!Number.isFinite(x) || !Number.isFinite(u) || !Number.isFinite(w)) continue;
            const total = u + w;
            const k = total === 0 ? 0 : Math.abs((u - w) / total);
            prev = Number.isFinite(prev) ? alpha * k * x + (1 - alpha * k) * prev : x;
            out[i] = prev;
        }
        return { plots: [{ key: 'vidya', title: 'VIDYA', values: out, color: str(inputs, 'color', SERIES_LINE), width: 2 }] };
    },
};

const maEnvelope: ClassicIndicatorSpec = {
    type: 'ma-envelope',
    title: 'Moving Average Envelope',
    shortTitle: 'MA Env',
    overlay: true,
    inputs: [
        { key: 'maType', title: 'Type', type: 'string', defval: 'SMA', options: ['SMA', 'EMA'] },
        lengthInput(20),
        sourceInput(),
        { key: 'percent', title: 'Percent', type: 'float', defval: 2.5, min: 0.01, max: 50, step: 0.1 },
        colorInput(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const basis = str(inputs, 'maType', 'SMA') === 'EMA' ? ema(src, len) : sma(src, len);
        const k = num(inputs, 'percent', 2.5) / 100;
        const ink = str(inputs, 'color', SERIES_LINE);
        return {
            plots: [
                { key: 'basis', title: 'Basis', values: basis, color: ink, width: 2 },
                { key: 'upper', title: 'Upper', values: map(basis, (x) => x * (1 + k)), color: ink },
                { key: 'lower', title: 'Lower', values: map(basis, (x) => x * (1 - k)), color: ink },
            ],
            bands: [{ key: 'envelope', from: 'upper', to: 'lower', color: withAlpha(ink) }],
        };
    },
};

const linearRegression: ClassicIndicatorSpec = {
    type: 'linear-regression',
    title: 'Linear Regression Curve',
    shortTitle: 'LinReg',
    overlay: true,
    inputs: [lengthInput(14), sourceInput(), colorInput()],
    compute: (bars, inputs) => ({
        plots: [
            {
                key: 'linreg',
                title: 'LinReg',
                values: linreg(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)),
                color: str(inputs, 'color', SERIES_LINE),
                width: 2,
            },
        ],
    }),
};

export const averageSpecs: ClassicIndicatorSpec[] = [movingAverage, smoothedMa, zlema, vidya, maEnvelope, linearRegression];
