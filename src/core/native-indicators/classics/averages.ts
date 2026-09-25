import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import { INFO, WARNING, BULLISH, BEARISH, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { SETTINGS, STYLE, boolInput, channelStyleInputs, colorInput, directionalChannel, floatInput, gradient, intInput, lengthInput, optionInput, sourceInput, transp, widthInput } from './shared';
import {
    sourceValues,
    volumes,
    sma,
    ema,
    rma,
    wma,
    vwma,
    hma,
    alma,
    dema,
    tema,
    kama,
    mcginley,
    hamming,
    linreg,
    cmo,
    stdev,
    atr,
    map,
    zip,
    shift,
} from './math';

/** Moving-average family — overlays that smooth a price source. */

/** Every smoothing the catalog's generic average offers, in the reference's order. */
export const MA_TYPES = ['SMA', 'EMA', 'WMA', 'RMA (SMMA)', 'HMA', 'ALMA', 'VWMA', 'DEMA', 'TEMA', 'KAMA', 'LSMA', 'McGinley', 'Hamming'] as const;

/** The subset an envelope basis offers. */
const ENVELOPE_MA_TYPES = ['SMA', 'EMA', 'WMA', 'RMA (SMMA)', 'HMA', 'VWMA'] as const;

interface MaOptions {
    almaOffset?: number;
    almaSigma?: number;
    lsmaOffset?: number;
}

/** Resolve one of {@link MA_TYPES} to its values. `'RMA'` is accepted for stored settings written before the rename. */
export function movingAverageOf(kind: string, src: readonly number[], bars: readonly OHLCV[], len: number, opts: MaOptions = {}): number[] {
    switch (kind) {
        case 'EMA': return ema(src, len);
        case 'WMA': return wma(src, len);
        case 'RMA':
        case 'RMA (SMMA)': return rma(src, len);
        case 'HMA': return hma(src, len);
        case 'ALMA': return alma(src, len, opts.almaOffset ?? 0.85, opts.almaSigma ?? 6);
        case 'VWMA': return vwma(src, volumes(bars), len);
        case 'DEMA': return dema(src, len);
        case 'TEMA': return tema(src, len);
        case 'KAMA': return kama(src, len);
        case 'LSMA': return linreg(src, len, opts.lsmaOffset ?? 0);
        case 'McGinley': return mcginley(src, len);
        case 'Hamming': return hamming(src, len);
        default: return sma(src, len);
    }
}

/** Per-bar ink from the line's own slope: rising bullish, falling bearish, flat neutral. */
function slopeColors(values: readonly number[], bull: string, bear: string, flat: string): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 ? values[i - 1]! : Number.NaN;
        if (!Number.isFinite(prev)) return flat;
        return x > prev ? bull : x < prev ? bear : flat;
    });
}

/** The bullish/bearish/neutral trio every slope-colored average shares. */
function directionInputs(): InputSchema[] {
    return [
        boolInput('trendColor', 'Slope Trend Coloring', true, STYLE, 'Colors the line by its slope — bullish while it rises, bearish while it falls. Disable to draw it in the neutral color.'),
        colorInput(BULLISH, 'Bullish', 'bullColor'),
        colorInput(BEARISH, 'Bearish', 'bearColor'),
        colorInput(NEUTRAL, 'Neutral', 'neutralColor'),
        widthInput(),
    ];
}

function slopeColoredPlot(key: string, title: string, values: number[], inputs: Record<string, InputValue>): ClassicPlot {
    const neutral = str(inputs, 'neutralColor', NEUTRAL);
    const colored = bool(inputs, 'trendColor', true);
    return {
        key,
        title,
        values,
        color: neutral,
        width: num(inputs, 'lineWidth', 2),
        ...(colored ? { colors: slopeColors(values, str(inputs, 'bullColor', BULLISH), str(inputs, 'bearColor', BEARISH), neutral) } : {}),
    };
}

const offsetInput: InputSchema = { key: 'offset', title: 'Offset', type: 'int', defval: 0, min: -500, max: 500, step: 1, group: SETTINGS, tooltip: 'Bars the plotted line is displaced by. Positive values push it to the right.' };

/** A single-kind average: the same inputs as the generic study minus the type picker. */
function fixedAverage(type: string, title: string, shortTitle: 'SMA' | 'EMA', smooth: (src: number[], len: number) => number[]): ClassicIndicatorSpec {
    return {
        type,
        title,
        shortTitle,
        overlay: true,
        inputs: [lengthInput(20, 'length', 'Length', 5000, `Number of bars used in the ${shortTitle} calculation.`), sourceInput('Close', 'source', 'Source', `Price series the ${shortTitle} is calculated on.`), offsetInput, colorInput()],
        compute: (bars, inputs) => {
            const len = num(inputs, 'length', 20);
            let values = smooth(sourceValues(bars, str(inputs, 'source', 'Close')), len);
            const offset = Math.trunc(num(inputs, 'offset', 0));
            if (offset !== 0) values = shift(values, offset);
            return { plots: [{ key: shortTitle.toLowerCase(), title: shortTitle, values, color: str(inputs, 'color', INFO), width: 2 }] };
        },
    };
}

const simpleMa = fixedAverage('sma', 'Simple Moving Average', 'SMA', sma);
const exponentialMa = fixedAverage('ema', 'Exponential Moving Average', 'EMA', ema);

const movingAverage: ClassicIndicatorSpec = {
    type: 'moving-average',
    title: 'Moving Average',
    shortTitle: 'MA',
    overlay: true,
    inputs: [
        optionInput('maType', 'MA 1 Type', 'SMA', MA_TYPES, 'Moving average calculation used for MA 1.'),
        lengthInput(20, 'length', 'MA 1 Length', 5000, 'Number of bars used in the MA 1 calculation.'),
        sourceInput('Close', 'source', 'MA 1 Source', 'Price series MA 1 is calculated on.'),
        boolInput('showMa2', 'Show MA 2', false, SETTINGS, 'Displays the optional second moving average.'),
        optionInput('ma2Type', 'MA 2 Type', 'SMA', MA_TYPES, 'Moving average calculation used for MA 2.'),
        lengthInput(50, 'ma2Length', 'MA 2 Length', 5000, 'Number of bars used in the MA 2 calculation.'),
        sourceInput('Close', 'ma2Source', 'MA 2 Source', 'Price series MA 2 is calculated on.'),
        floatInput('almaOffset', 'ALMA Offset', 0.85, 0, 1, 0.05, 'ALMA type only. Values near 1 make the average more responsive, values near 0 make it smoother.'),
        floatInput('almaSigma', 'ALMA Sigma', 6, 0.1, 100, 0.5, 'ALMA type only. Larger values widen the Gaussian window for a smoother average.'),
        intInput('lsmaOffset', 'LSMA Offset', 0, 0, 500, 'LSMA type only. Bar offset applied to the linear regression value.'),
        offsetInput,
        colorInput(INFO, 'MA 1', 'color', 'MA 1 line color.'),
        colorInput(WARNING, 'MA 2', 'ma2Color', 'MA 2 line color.'),
    ],
    compute: (bars, inputs) => {
        const opts: MaOptions = {
            almaOffset: num(inputs, 'almaOffset', 0.85),
            almaSigma: num(inputs, 'almaSigma', 6),
            lsmaOffset: Math.trunc(num(inputs, 'lsmaOffset', 0)),
        };
        const offset = Math.trunc(num(inputs, 'offset', 0));
        const displace = (v: number[]): number[] => (offset === 0 ? v : shift(v, offset));
        const kind = str(inputs, 'maType', 'SMA');
        const ma1 = displace(movingAverageOf(kind, sourceValues(bars, str(inputs, 'source', 'Close')), bars, num(inputs, 'length', 20), opts));
        const plots: ClassicPlot[] = [{ key: 'ma', title: kind, values: ma1, color: str(inputs, 'color', INFO), width: 2 }];
        if (bool(inputs, 'showMa2', false)) {
            const kind2 = str(inputs, 'ma2Type', 'SMA');
            const ma2 = displace(movingAverageOf(kind2, sourceValues(bars, str(inputs, 'ma2Source', 'Close')), bars, num(inputs, 'ma2Length', 50), opts));
            plots.push({ key: 'ma2', title: `${kind2} 2`, values: ma2, color: str(inputs, 'ma2Color', WARNING), width: 2 });
        }
        return { plots };
    },
};

const smoothedMa: ClassicIndicatorSpec = {
    type: 'rma',
    title: 'Smoothed Moving Average',
    shortTitle: 'RMA',
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', 'Source', "Price series the average smooths. Wilder computed his 1978 indicators on the close, but the recursion accepts any source."),
        lengthInput(14, 'length', 'RMA Length', 5000, "Number of bars N in Wilder's smoothing: the line keeps (N − 1)/N of its previous value and blends in 1/N of the new price. That alpha is smaller than an EMA's, so an N-period RMA responds like a (2N − 1)-period EMA."),
        ...directionInputs(),
    ],
    compute: (bars, inputs) => ({
        plots: [slopeColoredPlot('rma', 'RMA', rma(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)), inputs)],
    }),
};

const zlema: ClassicIndicatorSpec = {
    type: 'zlema',
    title: 'Zero-Lag Exponential Moving Average',
    shortTitle: 'ZLEMA',
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', 'Source', 'Price series the average de-lags and then smooths.'),
        lengthInput(21, 'length', 'ZLEMA Length', 5000, 'EMA length N. It sets both the smoothing (alpha = 2 / (N + 1)) and the correction: an EMA of length N lags by about (N − 1)/2 bars, and the de-lagging step is sized to cancel exactly that.'),
        ...directionInputs(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const lag = Math.round((len - 1) / 2);
        const delagged = zip(src, shift(src, lag), (a, b) => 2 * a - b);
        return { plots: [slopeColoredPlot('zlema', 'ZLEMA', ema(delagged, len), inputs)] };
    },
};

const MOMENTUM_SCALER = 'Momentum (|CMO|)';
const VOLATILITY_SCALER = 'Volatility (StDev Ratio)';
const REGIME = 'Trend Regime';

const vidya: ClassicIndicatorSpec = {
    type: 'vidya',
    title: 'Variable Index Dynamic Average',
    shortTitle: 'VIDYA',
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', 'Source', 'Price series the average smooths. VIDYA is classically computed on the close.'),
        lengthInput(12, 'length', 'VIDYA Length', 5000, 'EMA-equivalent length N of the base smoothing constant, alpha = 2 / (N + 1). The adaptive scaler rescales this base speed bar by bar.'),
        optionInput('scaler', 'Adaptive Scaler', MOMENTUM_SCALER, [MOMENTUM_SCALER, VOLATILITY_SCALER], "Bar-by-bar measure that rescales the smoothing constant. Momentum divides the absolute Chande Momentum Oscillator by 100; Volatility is Chande's original short-term over reference standard deviation."),
        intInput('scalerLength', 'Scaler Lookback', 9, 1, 5000, 'Lookback of the adaptive scaler — the CMO period in momentum mode, or the short-term standard deviation window in volatility mode.'),
        intInput('refLength', 'Reference StDev Length', 30, 2, 5000, 'Volatility mode only — window of the reference standard deviation the short-term reading is divided by.'),
        { ...floatInput('flatThreshold', 'Flat Threshold', 0.05, 0, 10, 0.01, 'One-bar change of VIDYA, as a fraction of ATR, below which the line reads as flat.'), group: REGIME },
        { ...intInput('atrLength', 'ATR Normalization Length', 14, 1, 5000, "ATR window used to normalize VIDYA's one-bar slope, so the flat threshold behaves consistently across symbols and timeframes."), group: REGIME },
        boolInput('trendColor', 'Trend Regime Coloring', true, STYLE, 'Colors VIDYA by its regime read — bullish while sloping up beyond the flat threshold, bearish while sloping down, flat inside congestion.'),
        boolInput('adaptiveGradient', 'Adaptive Gradient', true, STYLE, 'Blends the trend color toward the flat color according to the adaptive scaler, so the line pales as momentum dies.'),
        colorInput(BULLISH, 'Bullish', 'bullColor'),
        colorInput(BEARISH, 'Bearish', 'bearColor'),
        colorInput(NEUTRAL, 'Flat', 'flatColor'),
        colorInput(NEUTRAL, 'Neutral', 'neutralColor'),
        widthInput(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 12);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const scalerLen = num(inputs, 'scalerLength', 9);
        const momentum = map(cmo(src, scalerLen), (x) => Math.abs(x) / 100);
        const shortDev = stdev(src, scalerLen);
        const refDev = stdev(src, num(inputs, 'refLength', 30));
        const volatility = zip(shortDev, refDev, (s, r) => (r > 0 ? s / r : 0));
        const scale = str(inputs, 'scaler', MOMENTUM_SCALER) === VOLATILITY_SCALER ? volatility : momentum;
        const alphaBase = 2 / (len + 1);
        const out = new Array<number>(src.length).fill(Number.NaN);
        let prev = Number.NaN;
        for (let i = 0; i < src.length; i++) {
            const x = src[i]!;
            if (!Number.isFinite(x)) continue;
            const k = scale[i]!;
            if (!Number.isFinite(prev) || !Number.isFinite(k)) prev = x;
            else {
                const alpha = Math.min(alphaBase * k, 1);
                prev = alpha * x + (1 - alpha) * prev;
            }
            out[i] = prev;
        }
        const neutral = str(inputs, 'neutralColor', NEUTRAL);
        if (!bool(inputs, 'trendColor', true)) {
            return { plots: [{ key: 'vidya', title: 'VIDYA', values: out, color: neutral, width: num(inputs, 'lineWidth', 2) }] };
        }
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const flat = str(inputs, 'flatColor', NEUTRAL);
        const threshold = num(inputs, 'flatThreshold', 0.05);
        const range = atr(bars, num(inputs, 'atrLength', 14));
        const fade = bool(inputs, 'adaptiveGradient', true);
        const colors = out.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            const r = range[i]!;
            const slope = i > 0 && Number.isFinite(out[i - 1]!) ? x - out[i - 1]! : 0;
            const normalized = Number.isFinite(r) && r !== 0 ? slope / r : 0;
            const ink = normalized > threshold ? bull : normalized < -threshold ? bear : null;
            if (ink == null) return flat;
            return fade ? gradient(Math.min(scale[i] ?? 0, 1), 0, 1, flat, ink) : ink;
        });
        return { plots: [{ key: 'vidya', title: 'VIDYA', values: out, color: flat, width: num(inputs, 'lineWidth', 2), colors }] };
    },
};

const maEnvelope: ClassicIndicatorSpec = {
    type: 'ma-envelope',
    title: 'Moving Average Envelope',
    shortTitle: 'MA Env',
    overlay: true,
    inputs: [
        optionInput('maType', 'MA Type', 'SMA', ENVELOPE_MA_TYPES, 'Moving average type used as the envelope basis.'),
        { ...lengthInput(20, 'length', 'Length', 5000, 'Number of bars in the basis moving average.'), min: 2 },
        sourceInput('Close', 'source', 'Source', 'Price series the basis moving average is calculated on.'),
        floatInput('percent', 'Percent', 2.5, 0, 50, 0.1, 'Envelope offset as a percentage of the basis. Upper = basis × (1 + percent / 100), lower = basis × (1 − percent / 100).'),
        ...channelStyleInputs(),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const basis = movingAverageOf(str(inputs, 'maType', 'SMA'), src, bars, num(inputs, 'length', 20));
        const k = num(inputs, 'percent', 2.5) / 100;
        const ink = { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'basisColor', NEUTRAL) };
        return directionalChannel(bars, basis, map(basis, (x) => x * (1 + k)), map(basis, (x) => x * (1 - k)), ink, 'envelope');
    },
};

const LINREG_CURVE = 'Curve';
const LINREG_SLOPE = 'Slope';

const linearRegression: ClassicIndicatorSpec = {
    type: 'linear-regression',
    title: 'Linear Regression Curve',
    shortTitle: 'LinReg',
    // Slope lives in its own pane; Curve force-overlays itself onto the price candles.
    overlay: false,
    inputs: [
        optionInput('mode', 'Mode', LINREG_CURVE, [LINREG_CURVE, LINREG_SLOPE], 'Curve plots the regression value on the price chart; Slope plots the per-bar slope of the fit in the pane.'),
        { ...lengthInput(100, 'length', 'Length', 5000, 'Number of bars used to fit the linear regression.'), min: 2 },
        sourceInput('Close', 'source', 'Source', 'Price series the regression is fitted to.'),
        colorInput(BULLISH, 'Rising', 'bullColor', 'Color of the regression curve and slope line while the fit slopes upward.'),
        colorInput(BEARISH, 'Falling', 'bearColor', 'Color of the regression curve and slope line while the fit slopes downward.'),
        colorInput(NEUTRAL, 'Regression Line', 'lineColor', 'Color of the regression curve and slope line while the fit is flat.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 100);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const curve = linreg(src, len, 0);
        const slope = zip(curve, linreg(src, len, 1), (a, b) => a - b);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const flat = str(inputs, 'lineColor', NEUTRAL);
        const colors = slope.map((s) => (Number.isFinite(s) ? (s > 0 ? bull : s < 0 ? bear : flat) : null));
        if (str(inputs, 'mode', LINREG_CURVE) === LINREG_SLOPE) {
            return {
                plots: [{ key: 'slope', title: 'Slope', values: slope, color: flat, width: 2, colors }],
                levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed' }],
            };
        }
        return { plots: [{ key: 'curve', title: 'Curve', values: curve, color: flat, width: 2, colors, overlay: true }] };
    },
};

export const averageSpecs: ClassicIndicatorSpec[] = [simpleMa, exponentialMa, movingAverage, smoothedMa, zlema, vidya, maEnvelope, linearRegression];
