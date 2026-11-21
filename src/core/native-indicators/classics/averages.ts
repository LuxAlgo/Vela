import { msg } from '../../i18n/message';
import type { OHLCV } from '../../model/ohlcv';
import type { InputValue } from '../../model/inputs';
import { INFO, WARNING, BULLISH, BEARISH, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec, ClassicInput, ClassicPlot } from './define';
import type { MessageLike } from '../../i18n/types';
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
function directionInputs(): ClassicInput[] {
    return [
        boolInput('trendColor', msg('indicator.slope.trendColor', 'Slope Trend Coloring'), true, STYLE, msg('indicator.slope.trendColor.tooltip', 'Colors the line by its slope — bullish while it rises, bearish while it falls. Disable to draw it in the neutral color.')),
        colorInput(BULLISH, msg('indicator.common.bullColor', 'Bullish'), 'bullColor'),
        colorInput(BEARISH, msg('indicator.common.bearColor', 'Bearish'), 'bearColor'),
        colorInput(NEUTRAL, msg('indicator.common.neutralColor', 'Neutral'), 'neutralColor'),
        widthInput(),
    ];
}

function slopeColoredPlot(key: string, title: MessageLike, values: number[], inputs: Record<string, InputValue>): ClassicPlot {
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

const offsetInput: ClassicInput = { key: 'offset', title: msg('indicator.common.offset', 'Offset'), type: 'int', defval: 0, min: -500, max: 500, step: 1, group: SETTINGS, tooltip: msg('indicator.common.offset.tooltip', 'Bars the plotted line is displaced by. Positive values push it to the right.') };

/** The text of a single-kind average: its names and the tooltips of its length and source. */
interface FixedAverageText {
    title: MessageLike;
    shortTitle: MessageLike;
    lengthTooltip: MessageLike;
    sourceTooltip: MessageLike;
}

/** A single-kind average: the same inputs as the generic study minus the type picker. */
function fixedAverage(type: string, text: FixedAverageText, shortTitle: 'SMA' | 'EMA', smooth: (src: number[], len: number) => number[]): ClassicIndicatorSpec {
    return {
        type,
        title: text.title,
        shortTitle: text.shortTitle,
        overlay: true,
        inputs: [lengthInput(20, 'length', msg('indicator.common.length', 'Length'), 5000, text.lengthTooltip), sourceInput('Close', 'source', msg('indicator.common.source', 'Source'), text.sourceTooltip), offsetInput, colorInput()],
        compute: (bars, inputs) => {
            const len = num(inputs, 'length', 20);
            let values = smooth(sourceValues(bars, str(inputs, 'source', 'Close')), len);
            const offset = Math.trunc(num(inputs, 'offset', 0));
            if (offset !== 0) values = shift(values, offset);
            return { plots: [{ key: shortTitle.toLowerCase(), title: text.shortTitle, values, color: str(inputs, 'color', INFO), width: 2 }] };
        },
    };
}

const simpleMa = fixedAverage(
    'sma',
    {
        title: msg('indicator.sma.title', 'Simple Moving Average'),
        shortTitle: msg('indicator.sma.shortTitle', 'SMA'),
        lengthTooltip: msg('indicator.sma.length.tooltip', 'Number of bars used in the SMA calculation.'),
        sourceTooltip: msg('indicator.sma.source.tooltip', 'Price series the SMA is calculated on.'),
    },
    'SMA',
    sma,
);
const exponentialMa = fixedAverage(
    'ema',
    {
        title: msg('indicator.ema.title', 'Exponential Moving Average'),
        shortTitle: msg('indicator.ema.shortTitle', 'EMA'),
        lengthTooltip: msg('indicator.ema.length.tooltip', 'Number of bars used in the EMA calculation.'),
        sourceTooltip: msg('indicator.ema.source.tooltip', 'Price series the EMA is calculated on.'),
    },
    'EMA',
    ema,
);

const movingAverage: ClassicIndicatorSpec = {
    type: 'moving-average',
    title: msg('indicator.movingAverage.title', 'Moving Average'),
    shortTitle: msg('indicator.movingAverage.shortTitle', 'MA'),
    overlay: true,
    inputs: [
        optionInput('maType', msg('indicator.movingAverage.maType', 'MA 1 Type'), 'SMA', MA_TYPES, msg('indicator.movingAverage.maType.tooltip', 'Moving average calculation used for MA 1.')),
        lengthInput(20, 'length', msg('indicator.movingAverage.length', 'MA 1 Length'), 5000, msg('indicator.movingAverage.length.tooltip', 'Number of bars used in the MA 1 calculation.')),
        sourceInput('Close', 'source', msg('indicator.movingAverage.source', 'MA 1 Source'), msg('indicator.movingAverage.source.tooltip', 'Price series MA 1 is calculated on.')),
        boolInput('showMa2', msg('indicator.movingAverage.showMa2', 'Show MA 2'), false, SETTINGS, msg('indicator.movingAverage.showMa2.tooltip', 'Displays the optional second moving average.')),
        optionInput('ma2Type', msg('indicator.movingAverage.ma2Type', 'MA 2 Type'), 'SMA', MA_TYPES, msg('indicator.movingAverage.ma2Type.tooltip', 'Moving average calculation used for MA 2.')),
        lengthInput(50, 'ma2Length', msg('indicator.movingAverage.ma2Length', 'MA 2 Length'), 5000, msg('indicator.movingAverage.ma2Length.tooltip', 'Number of bars used in the MA 2 calculation.')),
        sourceInput('Close', 'ma2Source', msg('indicator.movingAverage.ma2Source', 'MA 2 Source'), msg('indicator.movingAverage.ma2Source.tooltip', 'Price series MA 2 is calculated on.')),
        floatInput('almaOffset', msg('indicator.movingAverage.almaOffset', 'ALMA Offset'), 0.85, 0, 1, 0.05, msg('indicator.movingAverage.almaOffset.tooltip', 'ALMA type only. Values near 1 make the average more responsive, values near 0 make it smoother.')),
        floatInput('almaSigma', msg('indicator.movingAverage.almaSigma', 'ALMA Sigma'), 6, 0.1, 100, 0.5, msg('indicator.movingAverage.almaSigma.tooltip', 'ALMA type only. Larger values widen the Gaussian window for a smoother average.')),
        intInput('lsmaOffset', msg('indicator.movingAverage.lsmaOffset', 'LSMA Offset'), 0, 0, 500, msg('indicator.movingAverage.lsmaOffset.tooltip', 'LSMA type only. Bar offset applied to the linear regression value.')),
        offsetInput,
        colorInput(INFO, msg('indicator.movingAverage.color', 'MA 1'), 'color', msg('indicator.movingAverage.color.tooltip', 'MA 1 line color.')),
        colorInput(WARNING, msg('indicator.movingAverage.ma2Color', 'MA 2'), 'ma2Color', msg('indicator.movingAverage.ma2Color.tooltip', 'MA 2 line color.')),
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
    title: msg('indicator.rma.title', 'Smoothed Moving Average'),
    shortTitle: msg('indicator.rma.shortTitle', 'RMA'),
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.rma.source', 'Source'), msg('indicator.rma.source.tooltip', 'Price series the average smooths. Wilder computed his 1978 indicators on the close, but the recursion accepts any source.')),
        lengthInput(14, 'length', msg('indicator.rma.length', 'RMA Length'), 5000, msg('indicator.rma.length.tooltip', "Number of bars N in Wilder's smoothing: the line keeps (N − 1)/N of its previous value and blends in 1/N of the new price. That alpha is smaller than an EMA's, so an N-period RMA responds like a (2N − 1)-period EMA.")),
        ...directionInputs(),
    ],
    compute: (bars, inputs) => ({
        plots: [slopeColoredPlot('rma', msg('indicator.rma.plot.rma', 'RMA'), rma(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)), inputs)],
    }),
};

const zlema: ClassicIndicatorSpec = {
    type: 'zlema',
    title: msg('indicator.zlema.title', 'Zero-Lag Exponential Moving Average'),
    shortTitle: msg('indicator.zlema.shortTitle', 'ZLEMA'),
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.zlema.source', 'Source'), msg('indicator.zlema.source.tooltip', 'Price series the average de-lags and then smooths.')),
        lengthInput(21, 'length', msg('indicator.zlema.length', 'ZLEMA Length'), 5000, msg('indicator.zlema.length.tooltip', 'EMA length N. It sets both the smoothing (alpha = 2 / (N + 1)) and the correction: an EMA of length N lags by about (N − 1)/2 bars, and the de-lagging step is sized to cancel exactly that.')),
        ...directionInputs(),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const lag = Math.round((len - 1) / 2);
        const delagged = zip(src, shift(src, lag), (a, b) => 2 * a - b);
        return { plots: [slopeColoredPlot('zlema', msg('indicator.zlema.plot.zlema', 'ZLEMA'), ema(delagged, len), inputs)] };
    },
};

const MOMENTUM_SCALER = 'Momentum (|CMO|)';
const VOLATILITY_SCALER = 'Volatility (StDev Ratio)';
const REGIME = 'Trend Regime';

const vidya: ClassicIndicatorSpec = {
    type: 'vidya',
    title: msg('indicator.vidya.title', 'Variable Index Dynamic Average'),
    shortTitle: msg('indicator.vidya.shortTitle', 'VIDYA'),
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.vidya.source', 'Source'), msg('indicator.vidya.source.tooltip', 'Price series the average smooths. VIDYA is classically computed on the close.')),
        lengthInput(12, 'length', msg('indicator.vidya.length', 'VIDYA Length'), 5000, msg('indicator.vidya.length.tooltip', 'EMA-equivalent length N of the base smoothing constant, alpha = 2 / (N + 1). The adaptive scaler rescales this base speed bar by bar.')),
        optionInput('scaler', msg('indicator.vidya.scaler', 'Adaptive Scaler'), MOMENTUM_SCALER, [MOMENTUM_SCALER, VOLATILITY_SCALER], msg('indicator.vidya.scaler.tooltip', "Bar-by-bar measure that rescales the smoothing constant. Momentum divides the absolute Chande Momentum Oscillator by 100; Volatility is Chande's original short-term over reference standard deviation.")),
        intInput('scalerLength', msg('indicator.vidya.scalerLength', 'Scaler Lookback'), 9, 1, 5000, msg('indicator.vidya.scalerLength.tooltip', 'Lookback of the adaptive scaler — the CMO period in momentum mode, or the short-term standard deviation window in volatility mode.')),
        intInput('refLength', msg('indicator.vidya.refLength', 'Reference StDev Length'), 30, 2, 5000, msg('indicator.vidya.refLength.tooltip', 'Volatility mode only — window of the reference standard deviation the short-term reading is divided by.')),
        { ...floatInput('flatThreshold', msg('indicator.vidya.flatThreshold', 'Flat Threshold'), 0.05, 0, 10, 0.01, msg('indicator.vidya.flatThreshold.tooltip', 'One-bar change of VIDYA, as a fraction of ATR, below which the line reads as flat.')), group: REGIME },
        { ...intInput('atrLength', msg('indicator.vidya.atrLength', 'ATR Normalization Length'), 14, 1, 5000, msg('indicator.vidya.atrLength.tooltip', "ATR window used to normalize VIDYA's one-bar slope, so the flat threshold behaves consistently across symbols and timeframes.")), group: REGIME },
        boolInput('trendColor', msg('indicator.vidya.trendColor', 'Trend Regime Coloring'), true, STYLE, msg('indicator.vidya.trendColor.tooltip', 'Colors VIDYA by its regime read — bullish while sloping up beyond the flat threshold, bearish while sloping down, flat inside congestion.')),
        boolInput('adaptiveGradient', msg('indicator.vidya.adaptiveGradient', 'Adaptive Gradient'), true, STYLE, msg('indicator.vidya.adaptiveGradient.tooltip', 'Blends the trend color toward the flat color according to the adaptive scaler, so the line pales as momentum dies.')),
        colorInput(BULLISH, msg('indicator.vidya.bullColor', 'Bullish'), 'bullColor'),
        colorInput(BEARISH, msg('indicator.vidya.bearColor', 'Bearish'), 'bearColor'),
        colorInput(NEUTRAL, msg('indicator.vidya.flatColor', 'Flat'), 'flatColor'),
        colorInput(NEUTRAL, msg('indicator.vidya.neutralColor', 'Neutral'), 'neutralColor'),
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
            return { plots: [{ key: 'vidya', title: msg('indicator.vidya.plot.vidya', 'VIDYA'), values: out, color: neutral, width: num(inputs, 'lineWidth', 2) }] };
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
        return { plots: [{ key: 'vidya', title: msg('indicator.vidya.plot.vidya', 'VIDYA'), values: out, color: flat, width: num(inputs, 'lineWidth', 2), colors }] };
    },
};

const maEnvelope: ClassicIndicatorSpec = {
    type: 'ma-envelope',
    title: msg('indicator.maEnvelope.title', 'Moving Average Envelope'),
    shortTitle: msg('indicator.maEnvelope.shortTitle', 'MA Env'),
    overlay: true,
    inputs: [
        optionInput('maType', msg('indicator.maEnvelope.maType', 'MA Type'), 'SMA', ENVELOPE_MA_TYPES, msg('indicator.maEnvelope.maType.tooltip', 'Moving average type used as the envelope basis.')),
        { ...lengthInput(20, 'length', msg('indicator.maEnvelope.length', 'Length'), 5000, msg('indicator.maEnvelope.length.tooltip', 'Number of bars in the basis moving average.')), min: 2 },
        sourceInput('Close', 'source', msg('indicator.maEnvelope.source', 'Source'), msg('indicator.maEnvelope.source.tooltip', 'Price series the basis moving average is calculated on.')),
        floatInput('percent', msg('indicator.maEnvelope.percent', 'Percent'), 2.5, 0, 50, 0.1, msg('indicator.maEnvelope.percent.tooltip', 'Envelope offset as a percentage of the basis. Upper = basis × (1 + percent / 100), lower = basis × (1 − percent / 100).')),
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

const leastSquaresMa: ClassicIndicatorSpec = {
    type: 'lsma',
    title: msg('indicator.lsma.title', 'Least Squares Moving Average'),
    shortTitle: msg('indicator.lsma.shortTitle', 'LSMA'),
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.lsma.source', 'Source'), msg('indicator.lsma.source.tooltip', 'Price series the regression line is fitted to.')),
        { ...lengthInput(25, 'length', msg('indicator.lsma.length', 'LSMA Length'), 5000, msg('indicator.lsma.length.tooltip', 'Number of bars N in each least-squares fit. Every bar fits a straight line to its last N values and plots where that line ends, so the average leads turns that a same-length SMA trails, at the cost of overshooting after sharp moves.')), min: 2 },
        intInput('offset', msg('indicator.lsma.offset', 'Regression Offset'), 0, 0, 500, msg('indicator.lsma.offset.tooltip', "Bars to step back along each bar's fitted line. 0 plots the line's endpoint at the current bar; larger values read the fit further back, trading lead for smoothness.")),
        ...directionInputs(),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = linreg(src, num(inputs, 'length', 25), Math.trunc(num(inputs, 'offset', 0)));
        return { plots: [slopeColoredPlot('lsma', msg('indicator.lsma.plot.lsma', 'LSMA'), values, inputs)] };
    },
};

const linearRegressionSlope: ClassicIndicatorSpec = {
    type: 'linear-regression-slope',
    title: msg('indicator.linearRegressionSlope.title', 'Linear Regression Slope'),
    shortTitle: msg('indicator.linearRegressionSlope.shortTitle', 'LRS'),
    overlay: false,
    inputs: [
        { ...lengthInput(100, 'length', msg('indicator.linearRegressionSlope.length', 'Length'), 5000, msg('indicator.linearRegressionSlope.length.tooltip', 'Number of bars used to fit the linear regression.')), min: 2 },
        sourceInput('Close', 'source', msg('indicator.linearRegressionSlope.source', 'Source'), msg('indicator.linearRegressionSlope.source.tooltip', 'Price series the regression is fitted to.')),
        colorInput(BULLISH, msg('indicator.linearRegressionSlope.bullColor', 'Rising'), 'bullColor', msg('indicator.linearRegressionSlope.bullColor.tooltip', 'Color of the slope line while the fit slopes upward.')),
        colorInput(BEARISH, msg('indicator.linearRegressionSlope.bearColor', 'Falling'), 'bearColor', msg('indicator.linearRegressionSlope.bearColor.tooltip', 'Color of the slope line while the fit slopes downward.')),
        colorInput(NEUTRAL, msg('indicator.linearRegressionSlope.lineColor', 'Slope Line'), 'lineColor', msg('indicator.linearRegressionSlope.lineColor.tooltip', 'Color of the slope line while the fit is flat.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 100);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        // Price change per bar along the current fit: its endpoint minus the point one bar back.
        const slope = zip(linreg(src, len, 0), linreg(src, len, 1), (a, b) => a - b);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const flat = str(inputs, 'lineColor', NEUTRAL);
        const colors = slope.map((s) => (Number.isFinite(s) ? (s > 0 ? bull : s < 0 ? bear : flat) : null));
        return {
            plots: [{ key: 'slope', title: msg('indicator.linearRegressionSlope.plot.slope', 'Slope'), values: slope, color: flat, width: 2, colors }],
            levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed' }],
        };
    },
};

/** The smoothings the multi-line studies offer. */
const BASIC_MA_TYPES = ['SMA', 'EMA', 'WMA'] as const;

/**
 * Ink of line `index` among `count` averages ordered fastest first: the generic
 * average's two inks at the ends, blended in between.
 */
function lineInk(index: number, count: number): string {
    return gradient(index, 0, count - 1, INFO, WARNING);
}

/** Radius of the dot that marks a cross, in pixels. */
const CROSS_MARKER_RADIUS = 4;

/** Which way the first line crossed the second on each bar: 1 above, −1 below, 0 no cross. */
function crossDirections(a: readonly number[], b: readonly number[]): number[] {
    return a.map((x, i) => {
        if (i === 0) return 0;
        const now = x - b[i]!;
        const before = a[i - 1]! - b[i - 1]!;
        return now > 0 && before < 0 ? 1 : now < 0 && before > 0 ? -1 : 0;
    });
}

/** One of the two lines of a cross study. `key` names its plot and prefixes its inputs. */
interface CrossLine {
    key: string;
    title: MessageLike;
    lengthTitle: MessageLike;
    length: number;
    smooth: (src: number[], len: number) => number[];
}

/** Two averages of one source and a marker on every bar where they change sides. */
function crossStudy(type: string, title: MessageLike, shortTitle: MessageLike, first: CrossLine, second: CrossLine): ClassicIndicatorSpec {
    const lengthTooltip = msg('indicator.maCross.length.tooltip', 'Number of bars this average covers.');
    return {
        type,
        title,
        shortTitle,
        overlay: true,
        inputs: [
            lengthInput(first.length, `${first.key}Length`, first.lengthTitle, 5000, lengthTooltip),
            lengthInput(second.length, `${second.key}Length`, second.lengthTitle, 5000, lengthTooltip),
            sourceInput('Close', 'source', msg('indicator.common.source', 'Source'), msg('indicator.maCross.source.tooltip', 'Price series both averages are calculated on.')),
            colorInput(INFO, first.title, `${first.key}Color`),
            colorInput(WARNING, second.title, `${second.key}Color`),
            colorInput(BULLISH, msg('indicator.maCross.bullColor', 'Bullish Cross'), 'bullColor', msg('indicator.maCross.bullColor.tooltip', 'Color of the marker where the first average crosses above the second.')),
            colorInput(BEARISH, msg('indicator.maCross.bearColor', 'Bearish Cross'), 'bearColor', msg('indicator.maCross.bearColor.tooltip', 'Color of the marker where the first average crosses below the second.')),
        ],
        compute: (bars, inputs) => {
            const src = sourceValues(bars, str(inputs, 'source', 'Close'));
            const a = first.smooth(src, num(inputs, `${first.key}Length`, first.length));
            const b = second.smooth(src, num(inputs, `${second.key}Length`, second.length));
            const directions = crossDirections(a, b);
            const bull = str(inputs, 'bullColor', BULLISH);
            const bear = str(inputs, 'bearColor', BEARISH);
            return {
                plots: [
                    { key: first.key, title: first.title, values: a, color: str(inputs, `${first.key}Color`, INFO), width: 2 },
                    { key: second.key, title: second.title, values: b, color: str(inputs, `${second.key}Color`, WARNING), width: 2 },
                    // A dot on the first line, not the hairline cross glyph: the marker sits where both lines meet, and the glyph disappears under them.
                    {
                        key: 'crosses',
                        title: msg('indicator.maCross.plot.crosses', 'Crosses'),
                        values: directions.map((d, i) => (d === 0 ? Number.NaN : a[i]!)),
                        kind: 'circles',
                        color: bull,
                        colors: directions.map((d) => (d === 0 ? null : d > 0 ? bull : bear)),
                        width: CROSS_MARKER_RADIUS,
                    },
                ],
            };
        },
    };
}

const shortLine = { key: 'short', title: msg('indicator.maCross.plot.short', 'Short'), lengthTitle: msg('indicator.maCross.shortLength', 'Short Length'), length: 9 };
const longLine = { key: 'long', title: msg('indicator.maCross.plot.long', 'Long'), lengthTitle: msg('indicator.maCross.longLength', 'Long Length'), length: 26 };

const maCross = crossStudy('ma-cross', msg('indicator.maCross.title', 'MA Cross'), msg('indicator.maCross.shortTitle', 'MA Cross'), { ...shortLine, smooth: sma }, { ...longLine, smooth: sma });
const emaCross = crossStudy('ema-cross', msg('indicator.emaCross.title', 'EMA Cross'), msg('indicator.emaCross.shortTitle', 'EMA Cross'), { ...shortLine, smooth: ema }, { ...longLine, smooth: ema });
const maWithEmaCross = crossStudy(
    'ma-with-ema-cross',
    msg('indicator.maWithEmaCross.title', 'MA with EMA Cross'),
    msg('indicator.maWithEmaCross.shortTitle', 'MA/EMA Cross'),
    { key: 'ma', title: msg('indicator.maWithEmaCross.plot.ma', 'MA'), lengthTitle: msg('indicator.maWithEmaCross.maLength', 'MA Length'), length: 10, smooth: sma },
    { key: 'ema', title: msg('indicator.maWithEmaCross.plot.ema', 'EMA'), lengthTitle: msg('indicator.maWithEmaCross.emaLength', 'EMA Length'), length: 10, smooth: ema },
);

/** Length and color labels of the multi-line studies, one pair per line. */
const MULTI_LINE_TEXT: ReadonlyArray<{ length: MessageLike; color: MessageLike }> = [
    { length: msg('indicator.multiAverage.length1', 'MA 1 Length'), color: msg('indicator.multiAverage.color1', 'MA 1') },
    { length: msg('indicator.multiAverage.length2', 'MA 2 Length'), color: msg('indicator.multiAverage.color2', 'MA 2') },
    { length: msg('indicator.multiAverage.length3', 'MA 3 Length'), color: msg('indicator.multiAverage.color3', 'MA 3') },
    { length: msg('indicator.multiAverage.length4', 'MA 4 Length'), color: msg('indicator.multiAverage.color4', 'MA 4') },
    { length: msg('indicator.multiAverage.length5', 'MA 5 Length'), color: msg('indicator.multiAverage.color5', 'MA 5') },
    { length: msg('indicator.multiAverage.length6', 'MA 6 Length'), color: msg('indicator.multiAverage.color6', 'MA 6') },
];

/** Several averages of one source under one smoothing, a line each. At most six lines. */
function multiAverage(type: string, title: MessageLike, shortTitle: MessageLike, lengths: readonly number[]): ClassicIndicatorSpec {
    const lines = lengths.map((length, i) => ({ length, plotKey: `ma${i + 1}`, lengthKey: `length${i + 1}`, colorKey: `color${i + 1}`, ink: lineInk(i, lengths.length), text: MULTI_LINE_TEXT[i]! }));
    return {
        type,
        title,
        shortTitle,
        overlay: true,
        inputs: [
            optionInput('maType', msg('indicator.multiAverage.maType', 'MA Type'), 'SMA', BASIC_MA_TYPES, msg('indicator.multiAverage.maType.tooltip', 'Moving average calculation every line uses.')),
            sourceInput('Close', 'source', msg('indicator.common.source', 'Source'), msg('indicator.multiAverage.source.tooltip', 'Price series every line is calculated on.')),
            ...lines.map((l) => lengthInput(l.length, l.lengthKey, l.text.length, 5000, msg('indicator.multiAverage.length.tooltip', 'Number of bars this line averages.'))),
            ...lines.map((l) => colorInput(l.ink, l.text.color, l.colorKey)),
        ],
        compute: (bars, inputs) => {
            const kind = str(inputs, 'maType', 'SMA');
            const src = sourceValues(bars, str(inputs, 'source', 'Close'));
            return {
                plots: lines.map((l) => {
                    const len = num(inputs, l.lengthKey, l.length);
                    return { key: l.plotKey, title: `${kind} ${len}`, values: movingAverageOf(kind, src, bars, len), color: str(inputs, l.colorKey, l.ink), width: 2 };
                }),
            };
        },
    };
}

const maDouble = multiAverage('moving-average-double', msg('indicator.maDouble.title', 'Moving Average Double'), msg('indicator.maDouble.shortTitle', 'MA Double'), [14, 21]);
const maTriple = multiAverage('moving-average-triple', msg('indicator.maTriple.title', 'Moving Average Triple'), msg('indicator.maTriple.shortTitle', 'MA Triple'), [14, 21, 35]);
const maMultiple = multiAverage('moving-average-multiple', msg('indicator.maMultiple.title', 'Moving Average Multiple'), msg('indicator.maMultiple.shortTitle', 'MA Multiple'), [14, 21, 35, 50, 100, 200]);

/** The two ribbons of the Guppy study: six short averages, then six long ones. */
const GUPPY_LINES: ReadonlyArray<{ key: string; length: number; title: MessageLike; trader: boolean }> = [
    { key: 'trader1', length: 3, title: msg('indicator.guppy.trader1', 'Trader EMA 1 Length'), trader: true },
    { key: 'trader2', length: 5, title: msg('indicator.guppy.trader2', 'Trader EMA 2 Length'), trader: true },
    { key: 'trader3', length: 8, title: msg('indicator.guppy.trader3', 'Trader EMA 3 Length'), trader: true },
    { key: 'trader4', length: 10, title: msg('indicator.guppy.trader4', 'Trader EMA 4 Length'), trader: true },
    { key: 'trader5', length: 12, title: msg('indicator.guppy.trader5', 'Trader EMA 5 Length'), trader: true },
    { key: 'trader6', length: 15, title: msg('indicator.guppy.trader6', 'Trader EMA 6 Length'), trader: true },
    { key: 'investor1', length: 30, title: msg('indicator.guppy.investor1', 'Investor EMA 1 Length'), trader: false },
    { key: 'investor2', length: 35, title: msg('indicator.guppy.investor2', 'Investor EMA 2 Length'), trader: false },
    { key: 'investor3', length: 40, title: msg('indicator.guppy.investor3', 'Investor EMA 3 Length'), trader: false },
    { key: 'investor4', length: 45, title: msg('indicator.guppy.investor4', 'Investor EMA 4 Length'), trader: false },
    { key: 'investor5', length: 50, title: msg('indicator.guppy.investor5', 'Investor EMA 5 Length'), trader: false },
    { key: 'investor6', length: 60, title: msg('indicator.guppy.investor6', 'Investor EMA 6 Length'), trader: false },
];

const guppy: ClassicIndicatorSpec = {
    type: 'guppy-multiple-moving-average',
    title: msg('indicator.guppy.title', 'Guppy Multiple Moving Average'),
    shortTitle: msg('indicator.guppy.shortTitle', 'GMMA'),
    overlay: true,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.common.source', 'Source'), msg('indicator.guppy.source.tooltip', 'Price series the twelve averages are calculated on.')),
        ...GUPPY_LINES.map((l) => lengthInput(l.length, l.key, l.title, 5000, msg('indicator.guppy.length.tooltip', 'Number of bars this exponential average covers.'))),
        colorInput(INFO, msg('indicator.guppy.traderColor', 'Traders'), 'traderColor', msg('indicator.guppy.traderColor.tooltip', 'Color of the six short averages.')),
        colorInput(WARNING, msg('indicator.guppy.investorColor', 'Investors'), 'investorColor', msg('indicator.guppy.investorColor.tooltip', 'Color of the six long averages.')),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const traderInk = str(inputs, 'traderColor', INFO);
        const investorInk = str(inputs, 'investorColor', WARNING);
        return {
            plots: GUPPY_LINES.map((l) => {
                const len = num(inputs, l.key, l.length);
                return { key: l.key, title: `EMA ${len}`, values: ema(src, len), color: l.trader ? traderInk : investorInk, width: 1 };
            }),
        };
    },
};

export const averageSpecs: ClassicIndicatorSpec[] = [simpleMa, exponentialMa, movingAverage, smoothedMa, zlema, vidya, maEnvelope, leastSquaresMa, linearRegressionSlope, maCross, emaCross, maWithEmaCross, maDouble, maTriple, maMultiple, guppy];
