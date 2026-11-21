import type { MessageLike } from '../../i18n/types';
import { msg } from '../../i18n/message';
import type { InputValue } from '../../model/inputs';
import type { OHLCV } from '../../model/ohlcv';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicBand, ClassicIndicatorSpec, ClassicInput, ClassicLevel, ClassicOutput, ClassicPlot } from './define';
import { bool, num, str } from './define';
import {
    STYLE,
    anchorPlot,
    baselineGradient,
    boolInput,
    boundedOscillator,
    centeredOscillator,
    colorInput,
    floatInput,
    lengthInput,
    momentumColumnColors,
    optionInput,
    sourceInput,
    thresholdZones,
    transp,
} from './shared';
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
    meanDev,
    percentRank,
    rankCorrelation,
    cumSum,
    atr,
    zip,
    map,
    sub,
    shift,
} from './math';

/** Momentum oscillators — study-pane classics driven by a price source. */

/** Overbought / oversold thresholds, as every bounded oscillator declares them. */
function thresholdInputs(
    obDefault: number,
    osDefault: number,
    min = 0,
    max = 100,
    obTitle: MessageLike = msg('indicator.threshold.overbought', 'Overbought Level'),
    osTitle: MessageLike = msg('indicator.threshold.oversold', 'Oversold Level'),
    step = 1,
): ClassicInput[] {
    return [
        floatInput('overbought', obTitle, obDefault, min, max, step, msg('indicator.threshold.overbought.tooltip', 'Level above which the oscillator is considered overbought.')),
        floatInput('oversold', osTitle, osDefault, min, max, step, msg('indicator.threshold.oversold.tooltip', 'Level below which the oscillator is considered oversold.')),
    ];
}

/** Column ink by direction against the bar before: rising, or falling (an unchanged bar counts as falling). */
function directionColors(values: readonly number[], rising: string, falling: string): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 ? values[i - 1]! : Number.NaN;
        return Number.isFinite(prev) && x > prev ? rising : falling;
    });
}

const rsiSpec: ClassicIndicatorSpec = {
    type: 'rsi',
    title: msg('indicator.rsi.title', 'Relative Strength Index'),
    shortTitle: msg('indicator.rsi.shortTitle', 'RSI'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.rsi.length', 'Length'), 5000, msg('indicator.rsi.length.tooltip', 'Number of bars used in the Wilder smoothing of average gains and losses.')),
        sourceInput('Close', 'source', msg('indicator.rsi.source', 'Source'), msg('indicator.rsi.source.tooltip', 'Price series the RSI is calculated on.')),
        ...thresholdInputs(70, 30, 0, 100, msg('indicator.rsi.overbought', 'Overbought'), msg('indicator.rsi.oversold', 'Oversold')),
        colorInput(NEUTRAL, msg('indicator.rsi.color', 'RSI'), 'color', msg('indicator.rsi.color.tooltip', 'Color of the RSI line at the midline. Toward either threshold it blends into that threshold’s color.')),
        colorInput(BULLISH, msg('indicator.rsi.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.rsi.oversoldColor.tooltip', 'Color of the line and zone shading at and below the oversold level.')),
        colorInput(BEARISH, msg('indicator.rsi.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.rsi.overboughtColor.tooltip', 'Color of the line and zone shading at and above the overbought level.')),
        colorInput(NEUTRAL, msg('indicator.rsi.levelsColor', 'Levels'), 'levelsColor', msg('indicator.rsi.levelsColor.tooltip', 'Color of the overbought, midline and oversold levels.')),
        colorInput(transp(NEUTRAL, 90), msg('indicator.rsi.fillColor', 'Band Fill'), 'fillColor', msg('indicator.rsi.fillColor.tooltip', 'Color of the fill between the overbought and oversold levels.')),
    ],
    compute: (bars, inputs) =>
        boundedOscillator({
            key: 'rsi',
            title: msg('indicator.rsi.plot.rsi', 'RSI'),
            values: rsi(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14)),
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'overbought', 70),
            oversold: num(inputs, 'oversold', 30),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: str(inputs, 'levelsColor', NEUTRAL),
            width: 2,
            midline: 50,
            bandFill: str(inputs, 'fillColor', transp(NEUTRAL, 90)),
        }),
};

/** %K / %D over a threshold band — the shape the two stochastics share. */
function stochasticOutput(k: number[], d: number[], inputs: Record<string, InputValue>): ClassicOutput {
    const overbought = num(inputs, 'overbought', 80);
    const oversold = num(inputs, 'oversold', 20);
    return {
        plots: [
            { key: 'k', title: msg('indicator.stochastic.plot.k', '%K'), values: k, color: str(inputs, 'kColor', INFO) },
            { key: 'd', title: msg('indicator.stochastic.plot.d', '%D'), values: d, color: str(inputs, 'dColor', WARNING) },
            anchorPlot('obAnchor', 'Overbought Anchor', k.length, overbought),
            anchorPlot('osAnchor', 'Oversold Anchor', k.length, oversold),
        ],
        bands: [{ key: 'band', from: 'obAnchor', to: 'osAnchor', color: str(inputs, 'fillColor', transp(INFO, 90)) }],
        levels: [
            { key: 'overbought', price: overbought, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.common.level.overbought', 'Overbought') },
            { key: 'oversold', price: oversold, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.common.level.oversold', 'Oversold') },
        ],
    };
}

const stochastic: ClassicIndicatorSpec = {
    type: 'stochastic',
    title: msg('indicator.stochastic.title', 'Stochastic'),
    shortTitle: msg('indicator.stochastic.shortTitle', 'Stoch'),
    overlay: false,
    inputs: [
        lengthInput(14, 'kLength', msg('indicator.stochastic.kLength', '%K Length'), 5000, msg('indicator.stochastic.kLength.tooltip', 'Number of bars used for the highest high / lowest low range of the raw %K.')),
        lengthInput(3, 'kSmoothing', msg('indicator.stochastic.kSmoothing', '%K Smoothing'), 500, msg('indicator.stochastic.kSmoothing.tooltip', 'Simple moving average length applied to the raw %K. 1 gives the fast stochastic, 3 the classic slow stochastic.')),
        lengthInput(3, 'dLength', msg('indicator.stochastic.dLength', '%D Smoothing'), 500, msg('indicator.stochastic.dLength.tooltip', 'Simple moving average length of the %D signal line, applied to the smoothed %K.')),
        ...thresholdInputs(80, 20),
        colorInput(INFO, msg('indicator.stochastic.kColor', '%K'), 'kColor', msg('indicator.stochastic.kColor.tooltip', 'Color of the %K line.')),
        colorInput(WARNING, msg('indicator.stochastic.dColor', '%D'), 'dColor', msg('indicator.stochastic.dColor.tooltip', 'Color of the %D signal line.')),
        colorInput(transp(INFO, 90), msg('indicator.stochastic.fillColor', 'Band Fill'), 'fillColor', msg('indicator.stochastic.fillColor.tooltip', 'Fill color of the area between the overbought and oversold levels.')),
    ],
    compute: (bars, inputs) => {
        const k = sma(stoch(closes(bars), highs(bars), lows(bars), num(inputs, 'kLength', 14)), num(inputs, 'kSmoothing', 3));
        return stochasticOutput(k, sma(k, num(inputs, 'dLength', 3)), inputs);
    },
};

const stochasticRsi: ClassicIndicatorSpec = {
    type: 'stochastic-rsi',
    title: msg('indicator.stochasticRsi.title', 'Stochastic RSI'),
    shortTitle: msg('indicator.stochasticRsi.shortTitle', 'Stoch RSI'),
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.stochasticRsi.source', 'RSI Source'), msg('indicator.stochasticRsi.source.tooltip', 'Price series the RSI is computed on.')),
        lengthInput(14, 'rsiLength', msg('indicator.stochasticRsi.rsiLength', 'RSI Length'), 5000, msg('indicator.stochasticRsi.rsiLength.tooltip', 'Lookback length of the Wilder RSI.')),
        lengthInput(14, 'stochLength', msg('indicator.stochasticRsi.stochLength', 'Stochastic Length'), 5000, msg('indicator.stochasticRsi.stochLength.tooltip', 'Lookback over which the highest and lowest RSI values are taken.')),
        lengthInput(3, 'kSmoothing', msg('indicator.stochasticRsi.kSmoothing', '%K Smoothing'), 500, msg('indicator.stochasticRsi.kSmoothing.tooltip', 'Simple moving average length applied to the stochastic of RSI to form %K.')),
        lengthInput(3, 'dLength', msg('indicator.stochasticRsi.dLength', '%D Smoothing'), 500, msg('indicator.stochasticRsi.dLength.tooltip', 'Simple moving average length applied to %K to form the %D signal line.')),
        ...thresholdInputs(80, 20),
        colorInput(INFO, msg('indicator.stochasticRsi.kColor', '%K Color'), 'kColor', msg('indicator.stochasticRsi.kColor.tooltip', 'Color of the %K line.')),
        colorInput(WARNING, msg('indicator.stochasticRsi.dColor', '%D Color'), 'dColor', msg('indicator.stochasticRsi.dColor.tooltip', 'Color of the %D signal line.')),
        colorInput(transp(INFO, 90), msg('indicator.stochasticRsi.fillColor', 'Zone Fill'), 'fillColor', msg('indicator.stochasticRsi.fillColor.tooltip', 'Fill color of the area between the overbought and oversold levels.')),
    ],
    compute: (bars, inputs) => {
        const r = rsi(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'rsiLength', 14));
        const k = sma(stoch(r, r, r, num(inputs, 'stochLength', 14)), num(inputs, 'kSmoothing', 3));
        return stochasticOutput(k, sma(k, num(inputs, 'dLength', 3)), inputs);
    },
};

const macd: ClassicIndicatorSpec = {
    type: 'macd',
    title: msg('indicator.macd.title', 'MACD'),
    overlay: false,
    inputs: [
        lengthInput(12, 'fastLength', msg('indicator.macd.fastLength', 'Fast Length'), 5000, msg('indicator.macd.fastLength.tooltip', 'Length of the fast EMA.')),
        lengthInput(26, 'slowLength', msg('indicator.macd.slowLength', 'Slow Length'), 5000, msg('indicator.macd.slowLength.tooltip', 'Length of the slow EMA.')),
        lengthInput(9, 'signalLength', msg('indicator.macd.signalLength', 'Signal Smoothing'), 500, msg('indicator.macd.signalLength.tooltip', 'Length of the EMA applied to the MACD line to obtain the signal line.')),
        sourceInput('Close', 'source', msg('indicator.macd.source', 'Source'), msg('indicator.macd.source.tooltip', 'Price series used to compute the fast and slow EMAs.')),
        colorInput(INFO, msg('indicator.macd.color', 'MACD Line'), 'color', msg('indicator.macd.color.tooltip', 'Color of the MACD line.')),
        colorInput(WARNING, msg('indicator.macd.signalColor', 'Signal Line'), 'signalColor', msg('indicator.macd.signalColor.tooltip', 'Color of the signal line.')),
        colorInput(BULLISH, msg('indicator.macd.growAboveColor', 'Grow Above'), 'growAboveColor', msg('indicator.macd.growAboveColor.tooltip', 'Histogram color when above zero and rising.')),
        colorInput(transp(BULLISH, 50), msg('indicator.macd.fallAboveColor', 'Fall Above'), 'fallAboveColor', msg('indicator.macd.fallAboveColor.tooltip', 'Histogram color when above zero and falling.')),
        colorInput(transp(BEARISH, 50), msg('indicator.macd.growBelowColor', 'Grow Below'), 'growBelowColor', msg('indicator.macd.growBelowColor.tooltip', 'Histogram color when below zero and rising.')),
        colorInput(BEARISH, msg('indicator.macd.fallBelowColor', 'Fall Below'), 'fallBelowColor', msg('indicator.macd.fallBelowColor.tooltip', 'Histogram color when below zero and falling.')),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const line = sub(ema(src, num(inputs, 'fastLength', 12)), ema(src, num(inputs, 'slowLength', 26)));
        const signal = ema(line, num(inputs, 'signalLength', 9));
        const hist = sub(line, signal);
        const colors = momentumColumnColors(hist, {
            growAbove: str(inputs, 'growAboveColor', BULLISH),
            fallAbove: str(inputs, 'fallAboveColor', transp(BULLISH, 50)),
            growBelow: str(inputs, 'growBelowColor', transp(BEARISH, 50)),
            fallBelow: str(inputs, 'fallBelowColor', BEARISH),
        });
        return {
            plots: [
                { key: 'hist', title: msg('indicator.macd.plot.hist', 'Histogram'), values: hist, kind: 'columns', color: BULLISH, colors, base: 0 },
                { key: 'macd', title: msg('indicator.macd.plot.macd', 'MACD'), values: line, color: str(inputs, 'color', INFO) },
                { key: 'signal', title: msg('indicator.macd.plot.signal', 'Signal'), values: signal, color: str(inputs, 'signalColor', WARNING) },
            ],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.macd.level.zero', 'Zero Line') }],
        };
    },
};

const ppo: ClassicIndicatorSpec = {
    type: 'ppo',
    title: msg('indicator.ppo.title', 'Percentage Price Oscillator'),
    shortTitle: msg('indicator.ppo.shortTitle', 'PPO'),
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.ppo.source', 'Source'), msg('indicator.ppo.source.tooltip', 'Price series fed into the fast and slow averages.')),
        lengthInput(12, 'fastLength', msg('indicator.ppo.fastLength', 'Fast Length'), 5000, msg('indicator.ppo.fastLength.tooltip', 'Length of the fast moving average.')),
        lengthInput(26, 'slowLength', msg('indicator.ppo.slowLength', 'Slow Length'), 5000, msg('indicator.ppo.slowLength.tooltip', 'Length of the slow moving average. The spread is divided by it and scaled to a percentage of price.')),
        optionInput('maType', msg('indicator.ppo.maType', 'Average Type'), 'EMA', ['EMA', 'SMA'], msg('indicator.ppo.maType.tooltip', 'Moving average type used for the fast and slow averages.')),
        lengthInput(9, 'signalLength', msg('indicator.ppo.signalLength', 'Signal Smoothing'), 500, msg('indicator.ppo.signalLength.tooltip', 'Length of the signal line that smooths the PPO line.')),
        optionInput('signalType', msg('indicator.ppo.signalType', 'Signal Type'), 'EMA', ['EMA', 'SMA'], msg('indicator.ppo.signalType.tooltip', 'Moving average type used for the signal line.')),
        colorInput(BULLISH, msg('indicator.ppo.bullColor', 'Bullish'), 'bullColor', msg('indicator.ppo.bullColor.tooltip', 'Color of the PPO line, gradient fill and histogram above the zero line.')),
        colorInput(BEARISH, msg('indicator.ppo.bearColor', 'Bearish'), 'bearColor', msg('indicator.ppo.bearColor.tooltip', 'Color of the PPO line, gradient fill and histogram below the zero line.')),
        colorInput(WARNING, msg('indicator.ppo.signalColor', 'Signal Line'), 'signalColor', msg('indicator.ppo.signalColor.tooltip', 'Color of the signal line.')),
        boolInput('showHistogram', msg('indicator.ppo.showHistogram', 'Show Histogram'), true, STYLE, msg('indicator.ppo.showHistogram.tooltip', 'Displays the histogram (PPO minus signal line) as columns. Bright columns mark a spread still widening, faded ones a spread narrowing back.')),
        boolInput('gradientFill', msg('indicator.ppo.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.ppo.gradientFill.tooltip', 'Fills the area between the zero line and the PPO line with a vertical gradient.')),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const average = (kind: string, v: readonly number[], len: number): number[] => (kind === 'SMA' ? sma(v, len) : ema(v, len));
        const kind = str(inputs, 'maType', 'EMA');
        const fast = average(kind, src, num(inputs, 'fastLength', 12));
        const slow = average(kind, src, num(inputs, 'slowLength', 26));
        const line = zip(fast, slow, (f, s) => (s === 0 ? Number.NaN : ((f - s) / s) * 100));
        const signal = average(str(inputs, 'signalType', 'EMA'), line, num(inputs, 'signalLength', 9));
        const hist = sub(line, signal);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const out = centeredOscillator({
            key: 'ppo',
            title: msg('indicator.ppo.plot.ppo', 'PPO Line'),
            values: line,
            ink: { bull, bear, neutral: bear },
            zeroInk: transp(NEUTRAL, 90),
            fill: bool(inputs, 'gradientFill', true),
            extraPlots: [{ key: 'signal', title: msg('indicator.ppo.plot.signal', 'Signal Line'), values: signal, color: str(inputs, 'signalColor', WARNING) }],
        });
        if (bool(inputs, 'showHistogram', true)) {
            // Bright while the spread between the averages widens, faded once it narrows again.
            const colors = hist.map((x, i) => {
                if (!Number.isFinite(x)) return null;
                const prev = i > 0 && Number.isFinite(hist[i - 1]!) ? hist[i - 1]! : x;
                const ink = x >= 0 ? bull : bear;
                const expanding = x >= 0 ? x > prev : x < prev;
                return transp(ink, expanding ? 40 : 70);
            });
            out.plots.unshift({ key: 'hist', title: msg('indicator.ppo.plot.hist', 'Histogram'), values: hist, kind: 'columns', color: bull, colors, base: 0 });
        }
        return out;
    },
};

/** The Awesome Oscillator's values: the 5-bar average of the bar midpoint less its 34-bar average. */
function awesomeValues(bars: readonly OHLCV[]): number[] {
    const hl2 = sourceValues(bars, 'HL2');
    return sub(sma(hl2, 5), sma(hl2, 34));
}

const awesome: ClassicIndicatorSpec = {
    type: 'awesome-oscillator',
    title: msg('indicator.awesomeOscillator.title', 'Awesome Oscillator'),
    shortTitle: msg('indicator.awesomeOscillator.shortTitle', 'AO'),
    overlay: false,
    inputs: [
        colorInput(BULLISH, msg('indicator.awesomeOscillator.risingColor', 'Rising'), 'risingColor', msg('indicator.awesomeOscillator.risingColor.tooltip', 'Histogram color when the oscillator is higher than on the previous bar.')),
        colorInput(BEARISH, msg('indicator.awesomeOscillator.fallingColor', 'Falling'), 'fallingColor', msg('indicator.awesomeOscillator.fallingColor.tooltip', 'Histogram color when the oscillator is lower than or equal to the previous bar.')),
        colorInput(NEUTRAL, msg('indicator.awesomeOscillator.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.awesomeOscillator.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        const ao = awesomeValues(bars);
        const rising = str(inputs, 'risingColor', BULLISH);
        return {
            plots: [{ key: 'ao', title: msg('indicator.awesomeOscillator.plot.ao', 'AO'), values: ao, kind: 'columns', color: rising, colors: directionColors(ao, rising, str(inputs, 'fallingColor', BEARISH)), base: 0 }],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'dashed', title: msg('indicator.awesomeOscillator.level.zero', 'Zero Line') }],
        };
    },
};

const ACCELERATOR_LENGTH = 5;

const accelerator: ClassicIndicatorSpec = {
    type: 'accelerator-oscillator',
    title: msg('indicator.acceleratorOscillator.title', 'Accelerator Oscillator'),
    shortTitle: msg('indicator.acceleratorOscillator.shortTitle', 'AC'),
    overlay: false,
    inputs: [
        colorInput(BULLISH, msg('indicator.acceleratorOscillator.risingColor', 'Rising'), 'risingColor', msg('indicator.acceleratorOscillator.risingColor.tooltip', 'Histogram color when the oscillator is higher than on the previous bar.')),
        colorInput(BEARISH, msg('indicator.acceleratorOscillator.fallingColor', 'Falling'), 'fallingColor', msg('indicator.acceleratorOscillator.fallingColor.tooltip', 'Histogram color when the oscillator is lower than or equal to the previous bar.')),
        colorInput(NEUTRAL, msg('indicator.acceleratorOscillator.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.acceleratorOscillator.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        // How far the Awesome Oscillator runs ahead of its own 5-bar average.
        const ao = awesomeValues(bars);
        const ac = sub(ao, sma(ao, ACCELERATOR_LENGTH));
        const rising = str(inputs, 'risingColor', BULLISH);
        return {
            plots: [{ key: 'ac', title: msg('indicator.acceleratorOscillator.plot.ac', 'AC'), values: ac, kind: 'columns', color: rising, colors: directionColors(ac, rising, str(inputs, 'fallingColor', BEARISH)), base: 0 }],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'dashed', title: msg('indicator.common.level.zero', 'Zero Line') }],
        };
    },
};

/** Lambert's scaling constant. */
const CCI_SCALING = 0.015;

const cci: ClassicIndicatorSpec = {
    type: 'commodity-channel-index',
    title: msg('indicator.commodityChannelIndex.title', 'Commodity Channel Index'),
    shortTitle: msg('indicator.commodityChannelIndex.shortTitle', 'CCI'),
    overlay: false,
    inputs: [
        lengthInput(20, 'length', msg('indicator.commodityChannelIndex.length', 'Length'), 5000, msg('indicator.commodityChannelIndex.length.tooltip', 'Number of bars used for the moving average and the mean absolute deviation of the source.')),
        sourceInput('HLC3', 'source', msg('indicator.commodityChannelIndex.source', 'Source'), msg('indicator.commodityChannelIndex.source.tooltip', 'Price series measured by the CCI; the typical price hlc3 is the classic choice.')),
        floatInput('upper', msg('indicator.commodityChannelIndex.upper', 'Upper Level'), 100, -1000, 1000, 10, msg('indicator.commodityChannelIndex.upper.tooltip', 'Overbought reference level, +100 classically.')),
        floatInput('lower', msg('indicator.commodityChannelIndex.lower', 'Lower Level'), -100, -1000, 1000, 10, msg('indicator.commodityChannelIndex.lower.tooltip', 'Oversold reference level, −100 classically.')),
        colorInput(NEUTRAL, msg('indicator.commodityChannelIndex.color', 'CCI Line'), 'color', msg('indicator.commodityChannelIndex.color.tooltip', 'Color of the CCI line.')),
        colorInput(BULLISH, msg('indicator.commodityChannelIndex.bullColor', 'Bullish'), 'bullColor', msg('indicator.commodityChannelIndex.bullColor.tooltip', 'Line and fill color while the CCI reads above zero.')),
        colorInput(BEARISH, msg('indicator.commodityChannelIndex.bearColor', 'Bearish'), 'bearColor', msg('indicator.commodityChannelIndex.bearColor.tooltip', 'Line and fill color while the CCI reads below zero.')),
        colorInput(NEUTRAL, msg('indicator.commodityChannelIndex.levelsColor', 'Levels'), 'levelsColor', msg('indicator.commodityChannelIndex.levelsColor.tooltip', 'Color of the upper, lower and zero reference lines.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const src = sourceValues(bars, str(inputs, 'source', 'HLC3'));
        const basis = sma(src, len);
        const dev = meanDev(src, len);
        const values = src.map((x, i) => {
            const b = basis[i]!;
            const d = dev[i]!;
            if (!Number.isFinite(b) || !Number.isFinite(d)) return Number.NaN;
            return d === 0 ? 0 : (x - b) / (CCI_SCALING * d);
        });
        const levelInk = str(inputs, 'levelsColor', NEUTRAL);
        return centeredOscillator({
            key: 'cci',
            title: msg('indicator.commodityChannelIndex.plot.cci', 'CCI'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: levelInk,
            zeroLineStyle: 'dotted',
            extraLevels: [
                { key: 'upper', price: num(inputs, 'upper', 100), color: levelInk, lineStyle: 'dashed', title: msg('indicator.commodityChannelIndex.level.upper', 'Upper Level') },
                { key: 'lower', price: num(inputs, 'lower', -100), color: levelInk, lineStyle: 'dashed', title: msg('indicator.commodityChannelIndex.level.lower', 'Lower Level') },
            ],
        });
    },
};

const williamsR: ClassicIndicatorSpec = {
    type: 'williams-percent-r',
    title: msg('indicator.williamsPercentR.title', 'Williams %R'),
    shortTitle: msg('indicator.williamsPercentR.shortTitle', '%R'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.williamsPercentR.length', 'Length'), 5000, msg('indicator.williamsPercentR.length.tooltip', 'Lookback length of the highest high / lowest low range. 14 is the classic setting.')),
        sourceInput('Close', 'source', msg('indicator.williamsPercentR.source', 'Source'), msg('indicator.williamsPercentR.source.tooltip', 'Series located within the lookback range. Close is the classic choice.')),
        ...thresholdInputs(-20, -80, -100, 0),
        colorInput(NEUTRAL, msg('indicator.williamsPercentR.color', '%R Line'), 'color', msg('indicator.williamsPercentR.color.tooltip', 'Color of the %R line between the levels. Toward either level it blends into that level’s color.')),
        colorInput(BEARISH, msg('indicator.williamsPercentR.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.williamsPercentR.overboughtColor.tooltip', 'Color of the line and zone shading at and above the overbought level.')),
        colorInput(BULLISH, msg('indicator.williamsPercentR.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.williamsPercentR.oversoldColor.tooltip', 'Color of the line and zone shading at and below the oversold level.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const hh = highest(highs(bars), len);
        const ll = lowest(lows(bars), len);
        // A flat lookback range leaves %R undefined — a gap, never a fabricated midpoint.
        const values = src.map((x, i) => {
            const h = hh[i]!;
            const l = ll[i]!;
            return Number.isFinite(h) && Number.isFinite(l) && h > l ? (-100 * (h - x)) / (h - l) : Number.NaN;
        });
        return boundedOscillator({
            key: 'wr',
            title: msg('indicator.williamsPercentR.plot.wr', '%R'),
            values,
            scale: { top: 0, bottom: -100 },
            overbought: num(inputs, 'overbought', -20),
            oversold: num(inputs, 'oversold', -80),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: NEUTRAL,
        });
    },
};

const cmoSpec: ClassicIndicatorSpec = {
    type: 'chande-momentum-oscillator',
    title: msg('indicator.chandeMomentumOscillator.title', 'Chande Momentum Oscillator'),
    shortTitle: msg('indicator.chandeMomentumOscillator.shortTitle', 'CMO'),
    overlay: false,
    inputs: [
        lengthInput(9, 'length', msg('indicator.chandeMomentumOscillator.length', 'Length'), 5000, msg('indicator.chandeMomentumOscillator.length.tooltip', 'Number of bars over which up moves and down moves are summed.')),
        sourceInput('Close', 'source', msg('indicator.chandeMomentumOscillator.source', 'Source'), msg('indicator.chandeMomentumOscillator.source.tooltip', 'Price series used to measure bar-to-bar changes.')),
        floatInput('overbought', msg('indicator.chandeMomentumOscillator.overbought', 'Overbought Level'), 50, 0, 100, 1, msg('indicator.chandeMomentumOscillator.overbought.tooltip', 'Level above which the oscillator is considered overbought.')),
        floatInput('oversold', msg('indicator.chandeMomentumOscillator.oversold', 'Oversold Level'), -50, -100, 0, 1, msg('indicator.chandeMomentumOscillator.oversold.tooltip', 'Level below which the oscillator is considered oversold.')),
        colorInput(NEUTRAL, msg('indicator.chandeMomentumOscillator.color', 'CMO Line'), 'color', msg('indicator.chandeMomentumOscillator.color.tooltip', 'Color of the CMO line.')),
        colorInput(BULLISH, msg('indicator.chandeMomentumOscillator.bullColor', 'Bullish'), 'bullColor', msg('indicator.chandeMomentumOscillator.bullColor.tooltip', 'Line and fill color while momentum is positive, and shading of the oversold zone.')),
        colorInput(BEARISH, msg('indicator.chandeMomentumOscillator.bearColor', 'Bearish'), 'bearColor', msg('indicator.chandeMomentumOscillator.bearColor.tooltip', 'Line and fill color while momentum is negative, and shading of the overbought zone.')),
        colorInput(NEUTRAL, msg('indicator.chandeMomentumOscillator.levelsColor', 'Levels'), 'levelsColor', msg('indicator.chandeMomentumOscillator.levelsColor.tooltip', 'Color of the overbought, oversold, and zero lines.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const d = change(sourceValues(bars, str(inputs, 'source', 'Close')));
        const up = sum(map(d, (x) => Math.max(x, 0)), len);
        const down = sum(map(d, (x) => Math.max(-x, 0)), len);
        const values = zip(up, down, (u, w) => (u + w === 0 ? 0 : (100 * (u - w)) / (u + w)));
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const levelInk = str(inputs, 'levelsColor', NEUTRAL);
        const overbought = num(inputs, 'overbought', 50);
        const oversold = num(inputs, 'oversold', -50);
        const out = centeredOscillator({
            key: 'cmo',
            title: msg('indicator.chandeMomentumOscillator.plot.cmo', 'CMO'),
            values,
            ink: { bull, bear, neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: levelInk,
            zeroLineStyle: 'dotted',
            extraLevels: [
                { key: 'overbought', price: overbought, color: levelInk, lineStyle: 'dashed', title: msg('indicator.chandeMomentumOscillator.level.overbought', 'Overbought') },
                { key: 'oversold', price: oversold, color: levelInk, lineStyle: 'dashed', title: msg('indicator.chandeMomentumOscillator.level.oversold', 'Oversold') },
            ],
        });
        const zones = thresholdZones(values.length, { overbought, oversold, top: 100, bottom: -100 }, { overbought: bear, oversold: bull });
        out.plots.push(...zones.plots);
        out.bands = [...(out.bands ?? []), ...zones.bands];
        return out;
    },
};

const connorsRsi: ClassicIndicatorSpec = {
    type: 'connors-rsi',
    title: msg('indicator.connorsRsi.title', 'Connors RSI'),
    shortTitle: msg('indicator.connorsRsi.shortTitle', 'CRSI'),
    overlay: false,
    inputs: [
        lengthInput(3, 'rsiLength', msg('indicator.connorsRsi.rsiLength', 'RSI Length'), 5000, msg('indicator.connorsRsi.rsiLength.tooltip', 'Length of the Wilder RSI applied to the closing price.')),
        lengthInput(2, 'streakLength', msg('indicator.connorsRsi.streakLength', 'Streak RSI Length'), 5000, msg('indicator.connorsRsi.streakLength.tooltip', 'Length of the Wilder RSI applied to the up/down close streak.')),
        lengthInput(100, 'rankLength', msg('indicator.connorsRsi.rankLength', 'Percent Rank Length'), 5000, msg('indicator.connorsRsi.rankLength.tooltip', 'Lookback of the percent rank applied to the 1-bar rate of change of the closing price.')),
        ...thresholdInputs(90, 10),
        colorInput(NEUTRAL, msg('indicator.connorsRsi.color', 'CRSI Line'), 'color', msg('indicator.connorsRsi.color.tooltip', 'Color of the Connors RSI line.')),
        colorInput(BULLISH, msg('indicator.connorsRsi.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.connorsRsi.oversoldColor.tooltip', 'Line, fill and zone color toward and below the oversold level.')),
        colorInput(BEARISH, msg('indicator.connorsRsi.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.connorsRsi.overboughtColor.tooltip', 'Line, fill and zone color toward and above the overbought level.')),
        colorInput(NEUTRAL, msg('indicator.connorsRsi.levelsColor', 'Levels'), 'levelsColor', msg('indicator.connorsRsi.levelsColor.tooltip', 'Color of the overbought and oversold levels.')),
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
        return boundedOscillator({
            key: 'crsi',
            title: msg('indicator.connorsRsi.plot.crsi', 'Connors RSI'),
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'overbought', 90),
            oversold: num(inputs, 'oversold', 10),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: str(inputs, 'levelsColor', NEUTRAL),
            midpointWash: true,
        });
    },
};

const fisher: ClassicIndicatorSpec = {
    type: 'fisher-transform',
    title: msg('indicator.fisherTransform.title', 'Fisher Transform'),
    shortTitle: msg('indicator.fisherTransform.shortTitle', 'Fisher'),
    overlay: false,
    inputs: [
        lengthInput(9, 'length', msg('indicator.fisherTransform.length', 'Length'), 5000, msg('indicator.fisherTransform.length.tooltip', "Lookback period used to locate the median price hl2 within its highest-lowest range. Ehlers' original length is 10; 9 is the common platform default.")),
        colorInput(NEUTRAL, msg('indicator.fisherTransform.color', 'Fisher Line'), 'color', msg('indicator.fisherTransform.color.tooltip', 'Color of the Fisher line when it sits exactly on its trigger.')),
        colorInput(NEUTRAL, msg('indicator.fisherTransform.triggerColor', 'Trigger Line'), 'triggerColor', msg('indicator.fisherTransform.triggerColor.tooltip', 'Color of the trigger line, the Fisher value delayed one bar.')),
        colorInput(BULLISH, msg('indicator.fisherTransform.bullColor', 'Bullish'), 'bullColor', msg('indicator.fisherTransform.bullColor.tooltip', 'Color of the Fisher line and fill while it is above the trigger.')),
        colorInput(BEARISH, msg('indicator.fisherTransform.bearColor', 'Bearish'), 'bearColor', msg('indicator.fisherTransform.bearColor.tooltip', 'Color of the Fisher line and fill while it is below the trigger.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const hl2 = sourceValues(bars, 'HL2');
        const hi = highest(hl2, len);
        const lo = lowest(hl2, len);
        const n = bars.length;
        const out = new Array<number>(n).fill(Number.NaN);
        let position = 0;
        let value = 0;
        for (let i = 0; i < n; i++) {
            const h = hi[i]!;
            const l = lo[i]!;
            if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
            // A flat range contributes a 0 position term so the recursion stays defined.
            const raw = h > l ? (hl2[i]! - l) / (h - l) - 0.5 : 0;
            position = 0.66 * raw + 0.67 * position;
            position = position > 0.99 ? 0.999 : position < -0.99 ? -0.999 : position;
            value = 0.5 * Math.log((1 + position) / (1 - position)) + 0.5 * value;
            out[i] = value;
        }
        const trigger = shift(out, 1);
        const neutral = str(inputs, 'color', NEUTRAL);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const inkOf = (i: number): string => {
            const f = out[i]!;
            const t = trigger[i]!;
            if (!Number.isFinite(t)) return neutral;
            return f > t ? bull : f < t ? bear : neutral;
        };
        return {
            plots: [
                { key: 'fisher', title: msg('indicator.fisherTransform.plot.fisher', 'Fisher'), values: out, color: neutral, width: 2, colors: out.map((x, i) => (Number.isFinite(x) ? inkOf(i) : null)) },
                { key: 'trigger', title: msg('indicator.fisherTransform.plot.trigger', 'Trigger'), values: trigger, color: str(inputs, 'triggerColor', NEUTRAL) },
            ],
            bands: [{ key: 'spread', from: 'fisher', to: 'trigger', color: transp(neutral, 80), colors: out.map((x, i) => (Number.isFinite(x) ? transp(inkOf(i), 80) : null)) }],
            levels: [
                { key: 'upper', price: 1.5, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.fisherTransform.level.upper', 'Upper Level') },
                { key: 'lower', price: -1.5, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.fisherTransform.level.lower', 'Lower Level') },
                { key: 'zero', price: 0, color: NEUTRAL, lineStyle: 'dotted', title: msg('indicator.fisherTransform.level.zero', 'Zero Line') },
            ],
        };
    },
};

const trix: ClassicIndicatorSpec = {
    type: 'trix',
    title: msg('indicator.trix.title', 'TRIX'),
    overlay: false,
    inputs: [
        lengthInput(18, 'length', msg('indicator.trix.length', 'Length'), 5000, msg('indicator.trix.length.tooltip', 'Length of each of the three EMA smoothing passes applied to the close price.')),
        lengthInput(9, 'signalLength', msg('indicator.trix.signalLength', 'Signal Length'), 500, msg('indicator.trix.signalLength.tooltip', 'Length of the EMA applied to TRIX to form the signal line.')),
        colorInput(NEUTRAL, msg('indicator.trix.color', 'TRIX Color'), 'color', msg('indicator.trix.color.tooltip', 'Color of the TRIX line.')),
        colorInput(WARNING, msg('indicator.trix.signalColor', 'Signal Color'), 'signalColor', msg('indicator.trix.signalColor.tooltip', 'Color of the signal line.')),
        colorInput(BULLISH, msg('indicator.trix.bullColor', 'Bullish'), 'bullColor', msg('indicator.trix.bullColor.tooltip', 'Color of the TRIX line and its gradient fill while TRIX holds above zero.')),
        colorInput(BEARISH, msg('indicator.trix.bearColor', 'Bearish'), 'bearColor', msg('indicator.trix.bearColor.tooltip', 'Color of the TRIX line and its gradient fill while TRIX holds below zero.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 18);
        const smooth = ema(ema(ema(closes(bars), len), len), len);
        const values = roc(smooth, 1);
        return centeredOscillator({
            key: 'trix',
            title: msg('indicator.trix.plot.trix', 'TRIX'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            extraPlots: [{ key: 'signal', title: msg('indicator.trix.plot.signal', 'Signal'), values: ema(values, num(inputs, 'signalLength', 9)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

/** Double-smoothed momentum ratio — Blau's TSI core, in −1..1. */
function tsiRatio(src: readonly number[], long: number, short: number): number[] {
    const mom = change(src);
    const numer = ema(ema(mom, long), short);
    const denom = ema(ema(map(mom, Math.abs), long), short);
    return zip(numer, denom, (a, b) => (b === 0 ? 0 : a / b));
}

const tsi: ClassicIndicatorSpec = {
    type: 'true-strength-index',
    title: msg('indicator.trueStrengthIndex.title', 'True Strength Index'),
    shortTitle: msg('indicator.trueStrengthIndex.shortTitle', 'TSI'),
    overlay: false,
    inputs: [
        lengthInput(25, 'longLength', msg('indicator.trueStrengthIndex.longLength', 'Long Length'), 5000, msg('indicator.trueStrengthIndex.longLength.tooltip', 'Length of the first (long) EMA applied to the 1-bar price change.')),
        lengthInput(13, 'shortLength', msg('indicator.trueStrengthIndex.shortLength', 'Short Length'), 5000, msg('indicator.trueStrengthIndex.shortLength.tooltip', 'Length of the second (short) EMA applied to the long-smoothed price change.')),
        lengthInput(13, 'signalLength', msg('indicator.trueStrengthIndex.signalLength', 'Signal Length'), 500, msg('indicator.trueStrengthIndex.signalLength.tooltip', 'Length of the EMA of TSI used as the signal line.')),
        colorInput(NEUTRAL, msg('indicator.trueStrengthIndex.color', 'TSI'), 'color', msg('indicator.trueStrengthIndex.color.tooltip', 'Color of the TSI line.')),
        colorInput(WARNING, msg('indicator.trueStrengthIndex.signalColor', 'Signal'), 'signalColor', msg('indicator.trueStrengthIndex.signalColor.tooltip', 'Color of the signal line.')),
        colorInput(BULLISH, msg('indicator.trueStrengthIndex.bullColor', 'Bullish'), 'bullColor', msg('indicator.trueStrengthIndex.bullColor.tooltip', 'Color of the TSI line and its gradient fill while TSI holds above zero.')),
        colorInput(BEARISH, msg('indicator.trueStrengthIndex.bearColor', 'Bearish'), 'bearColor', msg('indicator.trueStrengthIndex.bearColor.tooltip', 'Color of the TSI line and its gradient fill while TSI holds below zero.')),
    ],
    compute: (bars, inputs) => {
        const values = map(tsiRatio(closes(bars), num(inputs, 'longLength', 25), num(inputs, 'shortLength', 13)), (x) => 100 * x);
        return centeredOscillator({
            key: 'tsi',
            title: msg('indicator.trueStrengthIndex.plot.tsi', 'TSI'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            extraPlots: [{ key: 'signal', title: msg('indicator.trueStrengthIndex.plot.signal', 'Signal'), values: ema(values, num(inputs, 'signalLength', 13)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const SMI_INDICATOR = 'Indicator';
const SMI_OSCILLATOR = 'Oscillator';

const smiErgodic: ClassicIndicatorSpec = {
    type: 'smi-ergodic',
    title: msg('indicator.smiErgodic.title', 'SMI Ergodic Oscillator'),
    shortTitle: msg('indicator.smiErgodic.shortTitle', 'SMIE'),
    overlay: false,
    inputs: [
        lengthInput(20, 'longLength', msg('indicator.smiErgodic.longLength', 'Long Length'), 5000, msg('indicator.smiErgodic.longLength.tooltip', 'Length of the first EMA smoothing applied to the momentum of the closing price.')),
        lengthInput(5, 'shortLength', msg('indicator.smiErgodic.shortLength', 'Short Length'), 5000, msg('indicator.smiErgodic.shortLength.tooltip', 'Length of the second EMA smoothing applied to the momentum of the closing price.')),
        lengthInput(5, 'signalLength', msg('indicator.smiErgodic.signalLength', 'Signal Length'), 500, msg('indicator.smiErgodic.signalLength.tooltip', 'Length of the EMA of the SMI that forms the signal line.')),
        optionInput('display', msg('indicator.smiErgodic.display', 'Display'), SMI_INDICATOR, [SMI_INDICATOR, SMI_OSCILLATOR], msg('indicator.smiErgodic.display.tooltip', 'Indicator plots the SMI and its signal line. Oscillator plots the difference between them as a histogram.')),
        colorInput(NEUTRAL, msg('indicator.smiErgodic.color', 'SMI'), 'color', msg('indicator.smiErgodic.color.tooltip', 'Color of the SMI line while it sits exactly on its signal line.')),
        colorInput(WARNING, msg('indicator.smiErgodic.signalColor', 'Signal'), 'signalColor', msg('indicator.smiErgodic.signalColor.tooltip', 'Color of the signal line.')),
        colorInput(BULLISH, msg('indicator.smiErgodic.growColor', 'Oscillator Grow'), 'growColor', msg('indicator.smiErgodic.growColor.tooltip', 'Color of the rising oscillator histogram, and of the SMI line while it leads its signal.')),
        colorInput(BEARISH, msg('indicator.smiErgodic.fallColor', 'Oscillator Fall'), 'fallColor', msg('indicator.smiErgodic.fallColor.tooltip', 'Color of the falling oscillator histogram, and of the SMI line while it lags its signal.')),
    ],
    compute: (bars, inputs) => {
        const smi = tsiRatio(closes(bars), num(inputs, 'longLength', 20), num(inputs, 'shortLength', 5));
        const signal = ema(smi, num(inputs, 'signalLength', 5));
        const grow = str(inputs, 'growColor', BULLISH);
        const fall = str(inputs, 'fallColor', BEARISH);
        const zero: ClassicLevel[] = [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed', title: msg('indicator.smiErgodic.level.zero', 'Zero Line') }];
        if (str(inputs, 'display', SMI_INDICATOR) === SMI_OSCILLATOR) {
            const osc = sub(smi, signal);
            const colors = osc.map((x, i) => {
                if (!Number.isFinite(x)) return null;
                const prev = i > 0 && Number.isFinite(osc[i - 1]!) ? osc[i - 1]! : x;
                return x > prev ? grow : fall;
            });
            return { plots: [{ key: 'osc', title: msg('indicator.smiErgodic.plot.osc', 'Oscillator'), values: osc, kind: 'columns', color: grow, colors, base: 0 }], levels: zero };
        }
        const neutral = str(inputs, 'color', NEUTRAL);
        const inkOf = (i: number): string => {
            const a = smi[i]!;
            const b = signal[i]!;
            if (!Number.isFinite(b)) return neutral;
            return a > b ? grow : a < b ? fall : neutral;
        };
        return {
            plots: [
                { key: 'smi', title: msg('indicator.smiErgodic.plot.smi', 'SMI'), values: smi, color: neutral, colors: smi.map((x, i) => (Number.isFinite(x) ? inkOf(i) : null)) },
                { key: 'signal', title: msg('indicator.smiErgodic.plot.signal', 'Signal'), values: signal, color: str(inputs, 'signalColor', WARNING) },
            ],
            bands: [{ key: 'spread', from: 'smi', to: 'signal', color: transp(neutral, 75), colors: smi.map((x, i) => (Number.isFinite(x) ? transp(inkOf(i), 75) : null)) }],
            levels: zero,
        };
    },
};

const STC_MID = 50;
const TRIGGERS = 'Trigger Levels';

const stc: ClassicIndicatorSpec = {
    type: 'schaff-trend-cycle',
    title: msg('indicator.schaffTrendCycle.title', 'Schaff Trend Cycle'),
    shortTitle: msg('indicator.schaffTrendCycle.shortTitle', 'Schaff Trend Cycle'),
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.schaffTrendCycle.source', 'Source'), msg('indicator.schaffTrendCycle.source.tooltip', 'Price series used to build the MACD that the trend cycle is measured on.')),
        lengthInput(23, 'fastLength', msg('indicator.schaffTrendCycle.fastLength', 'Fast Length'), 5000, msg('indicator.schaffTrendCycle.fastLength.tooltip', 'Fast EMA length of the underlying MACD.')),
        lengthInput(50, 'slowLength', msg('indicator.schaffTrendCycle.slowLength', 'Slow Length'), 5000, msg('indicator.schaffTrendCycle.slowLength.tooltip', 'Slow EMA length of the underlying MACD.')),
        { ...lengthInput(10, 'cycleLength', msg('indicator.schaffTrendCycle.cycleLength', 'Cycle Length'), 5000, msg('indicator.schaffTrendCycle.cycleLength.tooltip', 'Window of the two stochastic passes. Each pass measures where its input sits inside the range of its own values over this many bars.')), min: 2 },
        floatInput('factor', msg('indicator.schaffTrendCycle.factor', 'Smoothing Factor'), 0.5, 0.01, 1, 0.05, msg('indicator.schaffTrendCycle.factor.tooltip', '%D style recursive smoothing applied after each stochastic pass. 0.5 is the published default.')),
        { ...floatInput('upper', msg('indicator.schaffTrendCycle.upper', 'Upper Trigger'), 75, 0, 100, 1, msg('indicator.schaffTrendCycle.upper.tooltip', 'Upper trigger line. A cross down through it flags an emerging downtrend.')), group: TRIGGERS },
        { ...floatInput('lower', msg('indicator.schaffTrendCycle.lower', 'Lower Trigger'), 25, 0, 100, 1, msg('indicator.schaffTrendCycle.lower.tooltip', 'Lower trigger line. A cross up through it flags an emerging uptrend.')), group: TRIGGERS },
        colorInput(BULLISH, msg('indicator.schaffTrendCycle.bullColor', 'Bullish Color'), 'bullColor', msg('indicator.schaffTrendCycle.bullColor.tooltip', 'Color of the trend cycle line and gradient while the cycle holds the upper half of its 0-100 scale.')),
        colorInput(BEARISH, msg('indicator.schaffTrendCycle.bearColor', 'Bearish Color'), 'bearColor', msg('indicator.schaffTrendCycle.bearColor.tooltip', 'Color of the trend cycle line and gradient while the cycle holds the lower half of its 0-100 scale.')),
        colorInput(NEUTRAL, msg('indicator.schaffTrendCycle.levelsColor', 'Levels Color'), 'levelsColor', msg('indicator.schaffTrendCycle.levelsColor.tooltip', 'Color of the dashed trigger lines and the dotted midline.')),
        boolInput('gradientFill', msg('indicator.schaffTrendCycle.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.schaffTrendCycle.gradientFill.tooltip', 'Vertical gradient between the midline and the trend cycle, fading out toward the midline.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'cycleLength', 10);
        const factor = num(inputs, 'factor', 0.5);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const macdLine = sub(ema(src, num(inputs, 'fastLength', 23)), ema(src, num(inputs, 'slowLength', 50)));
        // Position inside the window's own range; a flat window holds the previous reading.
        const stochNorm = (v: readonly number[]): number[] => {
            const lo = lowest(v, len);
            const hi = highest(v, len);
            const out = new Array<number>(v.length).fill(Number.NaN);
            let pct = Number.NaN;
            for (let i = 0; i < v.length; i++) {
                const x = v[i]!;
                const l = lo[i]!;
                const h = hi[i]!;
                if (!Number.isFinite(x) || !Number.isFinite(l) || !Number.isFinite(h)) continue;
                if (h > l) pct = (100 * (x - l)) / (h - l);
                out[i] = pct;
            }
            return out;
        };
        const smoothStep = (v: readonly number[]): number[] => {
            const out = new Array<number>(v.length).fill(Number.NaN);
            let smoothed = Number.NaN;
            for (let i = 0; i < v.length; i++) {
                const x = v[i]!;
                if (!Number.isFinite(x)) continue;
                smoothed = Number.isFinite(smoothed) ? smoothed + factor * (x - smoothed) : x;
                out[i] = smoothed;
            }
            return out;
        };
        const values = smoothStep(stochNorm(smoothStep(stochNorm(macdLine))));
        const levelInk = str(inputs, 'levelsColor', NEUTRAL);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const plots: ClassicPlot[] = [
            { key: 'stc', title: msg('indicator.schaffTrendCycle.plot.stc', 'Schaff Trend Cycle'), values, color: bear, width: 2, colors: values.map((x) => (Number.isFinite(x) ? (x > STC_MID ? bull : bear) : null)) },
        ];
        const bands: ClassicBand[] = [];
        if (bool(inputs, 'gradientFill', true)) {
            plots.push(anchorPlot('midAnchor', 'Midline Anchor', values.length, STC_MID));
            bands.push({ key: 'wash', from: 'stc', to: 'midAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(values, STC_MID, (x) => (x > STC_MID ? bull : bear)) });
        }
        return {
            plots,
            bands,
            levels: [
                { key: 'upper', price: num(inputs, 'upper', 75), color: transp(levelInk, 25), lineStyle: 'dashed', title: msg('indicator.schaffTrendCycle.level.upper', 'Upper Trigger') },
                { key: 'lower', price: num(inputs, 'lower', 25), color: transp(levelInk, 25), lineStyle: 'dashed', title: msg('indicator.schaffTrendCycle.level.lower', 'Lower Trigger') },
                { key: 'midline', price: STC_MID, color: transp(levelInk, 60), lineStyle: 'dotted', title: msg('indicator.schaffTrendCycle.level.midline', 'Midline') },
            ],
        };
    },
};

const kst: ClassicIndicatorSpec = {
    type: 'know-sure-thing',
    title: msg('indicator.knowSureThing.title', 'Know Sure Thing'),
    shortTitle: msg('indicator.knowSureThing.shortTitle', 'KST'),
    overlay: false,
    inputs: [
        lengthInput(10, 'rocLength1', msg('indicator.knowSureThing.rocLength1', 'ROC Length #1'), 5000, msg('indicator.knowSureThing.rocLength1.tooltip', 'Lookback of the first (shortest) rate of change.')),
        lengthInput(15, 'rocLength2', msg('indicator.knowSureThing.rocLength2', 'ROC Length #2'), 5000, msg('indicator.knowSureThing.rocLength2.tooltip', 'Lookback of the second rate of change.')),
        lengthInput(20, 'rocLength3', msg('indicator.knowSureThing.rocLength3', 'ROC Length #3'), 5000, msg('indicator.knowSureThing.rocLength3.tooltip', 'Lookback of the third rate of change.')),
        lengthInput(30, 'rocLength4', msg('indicator.knowSureThing.rocLength4', 'ROC Length #4'), 5000, msg('indicator.knowSureThing.rocLength4.tooltip', 'Lookback of the fourth (longest) rate of change.')),
        lengthInput(10, 'smaLength1', msg('indicator.knowSureThing.smaLength1', 'SMA Length #1'), 5000, msg('indicator.knowSureThing.smaLength1.tooltip', 'Smoothing length applied to the first rate of change (RCMA #1).')),
        lengthInput(10, 'smaLength2', msg('indicator.knowSureThing.smaLength2', 'SMA Length #2'), 5000, msg('indicator.knowSureThing.smaLength2.tooltip', 'Smoothing length applied to the second rate of change (RCMA #2).')),
        lengthInput(10, 'smaLength3', msg('indicator.knowSureThing.smaLength3', 'SMA Length #3'), 5000, msg('indicator.knowSureThing.smaLength3.tooltip', 'Smoothing length applied to the third rate of change (RCMA #3).')),
        lengthInput(15, 'smaLength4', msg('indicator.knowSureThing.smaLength4', 'SMA Length #4'), 5000, msg('indicator.knowSureThing.smaLength4.tooltip', 'Smoothing length applied to the fourth rate of change (RCMA #4).')),
        lengthInput(9, 'signalLength', msg('indicator.knowSureThing.signalLength', 'Signal Length'), 500, msg('indicator.knowSureThing.signalLength.tooltip', 'Simple moving average length of the signal line.')),
        colorInput(BULLISH, msg('indicator.knowSureThing.bullColor', 'Bullish'), 'bullColor', msg('indicator.knowSureThing.bullColor.tooltip', 'Color of the KST line while above zero.')),
        colorInput(BEARISH, msg('indicator.knowSureThing.bearColor', 'Bearish'), 'bearColor', msg('indicator.knowSureThing.bearColor.tooltip', 'Color of the KST line while below zero.')),
        colorInput(WARNING, msg('indicator.knowSureThing.signalColor', 'Signal'), 'signalColor', msg('indicator.knowSureThing.signalColor.tooltip', 'Color of the signal line.')),
    ],
    compute: (bars, inputs) => {
        const c = closes(bars);
        const rcma = (rocKey: string, rocDefault: number, smaKey: string, smaDefault: number): number[] => sma(roc(c, num(inputs, rocKey, rocDefault)), num(inputs, smaKey, smaDefault));
        const values = [rcma('rocLength1', 10, 'smaLength1', 10), rcma('rocLength2', 15, 'smaLength2', 10), rcma('rocLength3', 20, 'smaLength3', 10), rcma('rocLength4', 30, 'smaLength4', 15)].reduce(
            (acc, r, i) => zip(acc, r, (a, b) => a + b * (i + 1)),
            new Array<number>(c.length).fill(0),
        );
        const bull = str(inputs, 'bullColor', BULLISH);
        return centeredOscillator({
            key: 'kst',
            title: msg('indicator.knowSureThing.plot.kst', 'KST'),
            values,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: NEUTRAL,
            valueTransparency: 60,
            extraPlots: [{ key: 'signal', title: msg('indicator.knowSureThing.plot.signal', 'Signal'), values: sma(values, num(inputs, 'signalLength', 9)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const coppock: ClassicIndicatorSpec = {
    type: 'coppock-curve',
    title: msg('indicator.coppockCurve.title', 'Coppock Curve'),
    shortTitle: msg('indicator.coppockCurve.shortTitle', 'Coppock'),
    overlay: false,
    inputs: [
        lengthInput(10, 'wmaLength', msg('indicator.coppockCurve.wmaLength', 'WMA Length'), 5000, msg('indicator.coppockCurve.wmaLength.tooltip', 'Length of the weighted moving average applied to the sum of the two rates of change.')),
        lengthInput(14, 'longRoc', msg('indicator.coppockCurve.longRoc', 'Long ROC Length'), 5000, msg('indicator.coppockCurve.longRoc.tooltip', 'Lookback of the long rate of change, in bars. The original definition uses 14 monthly closes.')),
        lengthInput(11, 'shortRoc', msg('indicator.coppockCurve.shortRoc', 'Short ROC Length'), 5000, msg('indicator.coppockCurve.shortRoc.tooltip', 'Lookback of the short rate of change, in bars. The original definition uses 11 monthly closes.')),
        sourceInput('Close', 'source', msg('indicator.coppockCurve.source', 'Source'), msg('indicator.coppockCurve.source.tooltip', 'Price series used for the rate of change calculations.')),
        colorInput(NEUTRAL, msg('indicator.coppockCurve.color', 'Coppock Curve'), 'color', msg('indicator.coppockCurve.color.tooltip', 'Color of the Coppock Curve line.')),
        colorInput(BULLISH, msg('indicator.coppockCurve.bullColor', 'Bullish'), 'bullColor', msg('indicator.coppockCurve.bullColor.tooltip', 'Line and fill color while the curve reads above zero.')),
        colorInput(BEARISH, msg('indicator.coppockCurve.bearColor', 'Bearish'), 'bearColor', msg('indicator.coppockCurve.bearColor.tooltip', 'Line and fill color while the curve reads below zero.')),
        colorInput(NEUTRAL, msg('indicator.coppockCurve.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.coppockCurve.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = wma(zip(roc(src, num(inputs, 'longRoc', 14)), roc(src, num(inputs, 'shortRoc', 11)), (a, b) => a + b), num(inputs, 'wmaLength', 10));
        return centeredOscillator({
            key: 'coppock',
            title: msg('indicator.coppockCurve.plot.coppock', 'Coppock Curve'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

const dpo: ClassicIndicatorSpec = {
    type: 'detrended-price-oscillator',
    title: msg('indicator.detrendedPriceOscillator.title', 'Detrended Price Oscillator'),
    shortTitle: msg('indicator.detrendedPriceOscillator.shortTitle', 'DPO'),
    overlay: false,
    inputs: [
        lengthInput(21, 'length', msg('indicator.detrendedPriceOscillator.length', 'Length'), 5000, msg('indicator.detrendedPriceOscillator.length.tooltip', 'Lookback of the simple moving average that price is detrended against. The comparison is displaced by Length / 2 + 1 bars.')),
        sourceInput('Close', 'source', msg('indicator.detrendedPriceOscillator.source', 'Source'), msg('indicator.detrendedPriceOscillator.source.tooltip', 'Price series used in the detrending calculation.')),
        boolInput('centered', msg('indicator.detrendedPriceOscillator.centered', 'Centered'), false, undefined, msg('indicator.detrendedPriceOscillator.centered.tooltip', 'Shifts the oscillator back by Length / 2 + 1 bars so it is centered on the prices it detrends. The most recent bars then show no value.')),
        colorInput(NEUTRAL, msg('indicator.detrendedPriceOscillator.color', 'DPO'), 'color', msg('indicator.detrendedPriceOscillator.color.tooltip', 'Color of the line when it sits exactly at zero.')),
        colorInput(BULLISH, msg('indicator.detrendedPriceOscillator.bullColor', 'Above Zero'), 'bullColor', msg('indicator.detrendedPriceOscillator.bullColor.tooltip', 'Color of the line and fill while the oscillator is above zero.')),
        colorInput(BEARISH, msg('indicator.detrendedPriceOscillator.bearColor', 'Below Zero'), 'bearColor', msg('indicator.detrendedPriceOscillator.bearColor.tooltip', 'Color of the line and fill while the oscillator is below zero.')),
        colorInput(NEUTRAL, msg('indicator.detrendedPriceOscillator.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.detrendedPriceOscillator.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const barsBack = Math.trunc(len / 2) + 1;
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const basis = sma(src, len);
        const centered = bool(inputs, 'centered', false);
        // Centered mode compares the displaced price with today's average, then plots the
        // result back over the bars it detrends — leaving the newest bars empty.
        const values = centered ? shift(sub(shift(src, barsBack), basis), -barsBack) : sub(src, shift(basis, barsBack));
        return centeredOscillator({
            key: 'dpo',
            title: msg('indicator.detrendedPriceOscillator.plot.dpo', 'DPO'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

const ROC_PERCENT = 'ROC %';
const ROC_MOMENTUM = 'Momentum';

const rocSpec: ClassicIndicatorSpec = {
    type: 'rate-of-change',
    title: msg('indicator.rateOfChange.title', 'Rate of Change'),
    shortTitle: msg('indicator.rateOfChange.shortTitle', 'ROC'),
    overlay: false,
    inputs: [
        lengthInput(9, 'length', msg('indicator.rateOfChange.length', 'Length'), 5000, msg('indicator.rateOfChange.length.tooltip', 'Lookback period; the source is compared with its value this many bars ago.')),
        sourceInput('Close', 'source', msg('indicator.rateOfChange.source', 'Source'), msg('indicator.rateOfChange.source.tooltip', 'Series used as input for the calculation.')),
        optionInput('mode', msg('indicator.rateOfChange.mode', 'Mode'), ROC_PERCENT, [ROC_PERCENT, ROC_MOMENTUM], msg('indicator.rateOfChange.mode.tooltip', 'ROC % plots the change as a percentage of the source value from the lookback; Momentum plots the raw difference.')),
        colorInput(NEUTRAL, msg('indicator.rateOfChange.color', 'Line'), 'color', msg('indicator.rateOfChange.color.tooltip', 'Color of the line when the reading sits exactly at zero.')),
        colorInput(BULLISH, msg('indicator.rateOfChange.bullColor', 'Bullish'), 'bullColor', msg('indicator.rateOfChange.bullColor.tooltip', 'Color of the line and fill while the reading is above zero.')),
        colorInput(BEARISH, msg('indicator.rateOfChange.bearColor', 'Bearish'), 'bearColor', msg('indicator.rateOfChange.bearColor.tooltip', 'Color of the line and fill while the reading is below zero.')),
        boolInput('gradientFill', msg('indicator.rateOfChange.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.rateOfChange.gradientFill.tooltip', 'Fills the area between the line and zero, following the line color.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = str(inputs, 'mode', ROC_PERCENT) === ROC_MOMENTUM ? change(src, len) : roc(src, len);
        return centeredOscillator({
            key: 'roc',
            title: msg('indicator.rateOfChange.plot.roc', 'ROC'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

const ultimate: ClassicIndicatorSpec = {
    type: 'ultimate-oscillator',
    title: msg('indicator.ultimateOscillator.title', 'Ultimate Oscillator'),
    shortTitle: msg('indicator.ultimateOscillator.shortTitle', 'UO'),
    overlay: false,
    inputs: [
        lengthInput(7, 'fastLength', msg('indicator.ultimateOscillator.fastLength', 'Fast Length'), 5000, msg('indicator.ultimateOscillator.fastLength.tooltip', 'Bars in the fastest averaging window. Weighted 4 in the final blend, so it dominates the oscillator.')),
        lengthInput(14, 'middleLength', msg('indicator.ultimateOscillator.middleLength', 'Middle Length'), 5000, msg('indicator.ultimateOscillator.middleLength.tooltip', 'Bars in the intermediate averaging window. Weighted 2 in the final blend.')),
        lengthInput(28, 'slowLength', msg('indicator.ultimateOscillator.slowLength', 'Slow Length'), 5000, msg('indicator.ultimateOscillator.slowLength.tooltip', 'Bars in the slowest averaging window. Weighted 1 in the final blend.')),
        ...thresholdInputs(70, 30, 0, 100, msg('indicator.ultimateOscillator.overbought', 'Overbought'), msg('indicator.ultimateOscillator.oversold', 'Oversold')),
        colorInput(NEUTRAL, msg('indicator.ultimateOscillator.color', 'Oscillator'), 'color', msg('indicator.ultimateOscillator.color.tooltip', 'Color of the line midway between the levels. Toward either level it blends into that level’s color.')),
        colorInput(NEUTRAL, msg('indicator.ultimateOscillator.levelsColor', 'Levels'), 'levelsColor', msg('indicator.ultimateOscillator.levelsColor.tooltip', 'Color of the overbought and oversold levels.')),
        colorInput(BULLISH, msg('indicator.ultimateOscillator.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.ultimateOscillator.oversoldColor.tooltip', 'Color of the line at the oversold level and of the oversold zone shading.')),
        colorInput(BEARISH, msg('indicator.ultimateOscillator.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.ultimateOscillator.overboughtColor.tooltip', 'Color of the line at the overbought level and of the overbought zone shading.')),
    ],
    compute: (bars, inputs) => {
        const n = bars.length;
        const bp = new Array<number>(n).fill(Number.NaN);
        const tr = new Array<number>(n).fill(Number.NaN);
        for (let i = 0; i < n; i++) {
            const b = bars[i]!;
            const pc = i > 0 ? bars[i - 1]!.close : b.close;
            const trueLow = Math.min(b.low, pc);
            bp[i] = b.close - trueLow;
            tr[i] = Math.max(b.high, pc) - trueLow;
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
        return boundedOscillator({
            key: 'uo',
            title: msg('indicator.ultimateOscillator.plot.uo', 'UO'),
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'overbought', 70),
            oversold: num(inputs, 'oversold', 30),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: str(inputs, 'levelsColor', NEUTRAL),
            zoneTransparency: 91,
        });
    },
};

const rvgi: ClassicIndicatorSpec = {
    type: 'relative-vigor-index',
    title: msg('indicator.relativeVigorIndex.title', 'Relative Vigor Index'),
    shortTitle: msg('indicator.relativeVigorIndex.shortTitle', 'RVGI'),
    overlay: false,
    inputs: [
        lengthInput(10, 'length', msg('indicator.relativeVigorIndex.length', 'Length'), 5000, msg('indicator.relativeVigorIndex.length.tooltip', 'Number of bars summed for the smoothed numerator (close − open) and denominator (high − low).')),
        colorInput(BULLISH, msg('indicator.relativeVigorIndex.color', 'RVGI'), 'color', msg('indicator.relativeVigorIndex.color.tooltip', 'Color of the RVGI line.')),
        colorInput(BEARISH, msg('indicator.relativeVigorIndex.signalColor', 'Signal'), 'signalColor', msg('indicator.relativeVigorIndex.signalColor.tooltip', 'Color of the signal line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const co = swma(sub(closes(bars), opens(bars)));
        const hl = swma(sub(highs(bars), lows(bars)));
        const line = zip(sum(co, len), sum(hl, len), (a, b) => (b === 0 ? 0 : a / b));
        return {
            plots: [
                { key: 'rvgi', title: msg('indicator.relativeVigorIndex.plot.rvgi', 'RVGI'), values: line, color: str(inputs, 'color', BULLISH) },
                { key: 'signal', title: msg('indicator.relativeVigorIndex.plot.signal', 'Signal'), values: swma(line), color: str(inputs, 'signalColor', BEARISH) },
            ],
            levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed', title: msg('indicator.relativeVigorIndex.level.zero', 'Zero Line') }],
        };
    },
};

const RVI_EMA = 'EMA';
const RVI_RMA = 'Wilder (RMA)';

const relVolatility: ClassicIndicatorSpec = {
    type: 'relative-volatility-index',
    title: msg('indicator.relativeVolatilityIndex.title', 'Relative Volatility Index'),
    shortTitle: msg('indicator.relativeVolatilityIndex.shortTitle', 'RVI'),
    overlay: false,
    inputs: [
        lengthInput(10, 'stdevLength', msg('indicator.relativeVolatilityIndex.stdevLength', 'Stdev Length'), 5000, msg('indicator.relativeVolatilityIndex.stdevLength.tooltip', "Number of bars used for the standard deviation of closing prices that serves as each bar's volatility reading.")),
        lengthInput(14, 'smoothLength', msg('indicator.relativeVolatilityIndex.smoothLength', 'Smoothing Length'), 5000, msg('indicator.relativeVolatilityIndex.smoothLength.tooltip', 'Number of bars used to smooth the up and down volatility streams.')),
        optionInput('smoothType', msg('indicator.relativeVolatilityIndex.smoothType', 'Smoothing Type'), RVI_EMA, [RVI_EMA, RVI_RMA], msg('indicator.relativeVolatilityIndex.smoothType.tooltip', "Moving average applied to the volatility streams. EMA is Dorsey's classic calculation; Wilder (RMA) matches platforms that use Wilder smoothing.")),
        ...thresholdInputs(80, 20),
        colorInput(NEUTRAL, msg('indicator.relativeVolatilityIndex.color', 'RVI Line'), 'color', msg('indicator.relativeVolatilityIndex.color.tooltip', 'Color of the RVI line at the midline. Toward either threshold it blends into that threshold’s color.')),
        colorInput(BULLISH, msg('indicator.relativeVolatilityIndex.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.relativeVolatilityIndex.overboughtColor.tooltip', 'Color of the line and zone shading at and above the overbought level.')),
        colorInput(BEARISH, msg('indicator.relativeVolatilityIndex.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.relativeVolatilityIndex.oversoldColor.tooltip', 'Color of the line and zone shading at and below the oversold level.')),
    ],
    compute: (bars, inputs) => {
        const c = closes(bars);
        const sigma = stdev(c, num(inputs, 'stdevLength', 10));
        const d = change(c);
        const up = zip(sigma, d, (s, x) => (x > 0 ? s : 0));
        const down = zip(sigma, d, (s, x) => (x < 0 ? s : 0));
        const smoothLen = num(inputs, 'smoothLength', 14);
        const smooth = str(inputs, 'smoothType', RVI_EMA) === RVI_RMA ? rma : ema;
        const values = zip(smooth(up, smoothLen), smooth(down, smoothLen), (u, w) => (u + w === 0 ? 0 : (100 * u) / (u + w)));
        return boundedOscillator({
            key: 'rvi',
            title: msg('indicator.relativeVolatilityIndex.plot.rvi', 'RVI'),
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'overbought', 80),
            oversold: num(inputs, 'oversold', 20),
            ink: { low: str(inputs, 'oversoldColor', BEARISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BULLISH) },
            levelInk: NEUTRAL,
            width: 2,
        });
    },
};

const bop: ClassicIndicatorSpec = {
    type: 'balance-of-power',
    title: msg('indicator.balanceOfPower.title', 'Balance of Power'),
    shortTitle: msg('indicator.balanceOfPower.shortTitle', 'BOP'),
    overlay: false,
    inputs: [
        boolInput('smoothing', msg('indicator.balanceOfPower.smoothing', 'Smoothing'), false, undefined, msg('indicator.balanceOfPower.smoothing.tooltip', 'Smooth the raw Balance of Power with a simple moving average instead of plotting the single-bar value.')),
        lengthInput(14, 'smoothLength', msg('indicator.balanceOfPower.smoothLength', 'Length'), 5000, msg('indicator.balanceOfPower.smoothLength.tooltip', 'Simple moving average length applied when smoothing is enabled.')),
        colorInput(NEUTRAL, msg('indicator.balanceOfPower.color', 'BOP Color'), 'color', msg('indicator.balanceOfPower.color.tooltip', 'Color of the line at exactly zero.')),
        colorInput(BULLISH, msg('indicator.balanceOfPower.bullColor', 'Bullish'), 'bullColor', msg('indicator.balanceOfPower.bullColor.tooltip', 'Line and fill color while the Balance of Power is above zero — buyers in control of the bar.')),
        colorInput(BEARISH, msg('indicator.balanceOfPower.bearColor', 'Bearish'), 'bearColor', msg('indicator.balanceOfPower.bearColor.tooltip', 'Line and fill color while the Balance of Power is below zero — sellers in control of the bar.')),
    ],
    compute: (bars, inputs) => {
        const raw = bars.map((b) => (b.high === b.low ? 0 : (b.close - b.open) / (b.high - b.low)));
        const values = bool(inputs, 'smoothing', false) ? sma(raw, num(inputs, 'smoothLength', 14)) : raw;
        return centeredOscillator({
            key: 'bop',
            title: msg('indicator.balanceOfPower.plot.bop', 'BOP'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            valueTransparency: 60,
        });
    },
};

const elderRay: ClassicIndicatorSpec = {
    type: 'elder-ray',
    title: msg('indicator.elderRay.title', 'Elder Ray'),
    overlay: false,
    inputs: [
        lengthInput(13, 'length', msg('indicator.elderRay.length', 'EMA Length'), 5000, msg('indicator.elderRay.length.tooltip', "Number of bars in the exponential moving average of closing prices used as the reference level for Bull Power and Bear Power. Alexander Elder's classic setting is 13.")),
        colorInput(BULLISH, msg('indicator.elderRay.bullColor', 'Bull Power'), 'bullColor', msg('indicator.elderRay.bullColor.tooltip', 'Color of the Bull Power columns.')),
        colorInput(BEARISH, msg('indicator.elderRay.bearColor', 'Bear Power'), 'bearColor', msg('indicator.elderRay.bearColor.tooltip', 'Color of the Bear Power columns.')),
    ],
    compute: (bars, inputs) => {
        const basis = ema(closes(bars), num(inputs, 'length', 13));
        return {
            plots: [
                { key: 'bull', title: msg('indicator.elderRay.plot.bull', 'Bull Power'), values: sub(highs(bars), basis), kind: 'columns', color: str(inputs, 'bullColor', BULLISH), base: 0 },
                { key: 'bear', title: msg('indicator.elderRay.plot.bear', 'Bear Power'), values: sub(lows(bars), basis), kind: 'columns', color: str(inputs, 'bearColor', BEARISH), base: 0 },
            ],
            levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 30), lineStyle: 'dashed', title: msg('indicator.elderRay.level.zero', 'Zero Line') }],
        };
    },
};

const ttmSqueeze: ClassicIndicatorSpec = {
    type: 'ttm-squeeze',
    title: msg('indicator.ttmSqueeze.title', 'TTM Squeeze'),
    overlay: false,
    inputs: [
        { ...lengthInput(20, 'length', msg('indicator.ttmSqueeze.length', 'Length'), 5000, msg('indicator.ttmSqueeze.length.tooltip', "Shared lookback for the Bollinger Bands, the Keltner Channels, and the momentum regression. John Carter's original setting is 20.")), min: 2 },
        sourceInput('Close', 'source', msg('indicator.ttmSqueeze.source', 'Source'), msg('indicator.ttmSqueeze.source.tooltip', 'Price series used for the shared moving average basis, the standard deviation, and the momentum displacement.')),
        floatInput('bbMult', msg('indicator.ttmSqueeze.bbMult', 'Bollinger Bands Multiplier'), 2, 0.1, 50, 0.1, msg('indicator.ttmSqueeze.bbMult.tooltip', 'Standard deviation multiplier for the Bollinger Bands.')),
        floatInput('kcMult', msg('indicator.ttmSqueeze.kcMult', 'Keltner Channels Multiplier'), 1.5, 0.1, 50, 0.1, msg('indicator.ttmSqueeze.kcMult.tooltip', 'ATR multiplier for the Keltner Channels. A smaller multiplier demands a tighter compression before the squeeze turns on.')),
        colorInput(BULLISH, msg('indicator.ttmSqueeze.bullColor', 'Momentum Up'), 'bullColor', msg('indicator.ttmSqueeze.bullColor.tooltip', 'Histogram color while momentum is positive. Bars building away from zero print solid, bars fading back print dimmed.')),
        colorInput(BEARISH, msg('indicator.ttmSqueeze.bearColor', 'Momentum Down'), 'bearColor', msg('indicator.ttmSqueeze.bearColor.tooltip', 'Histogram color while momentum is negative. Bars building away from zero print solid, bars fading back print dimmed.')),
        colorInput(WARNING, msg('indicator.ttmSqueeze.squeezeOnColor', 'Squeeze On'), 'squeezeOnColor', msg('indicator.ttmSqueeze.squeezeOnColor.tooltip', 'Zero-line dot color while both Bollinger Bands sit fully inside the Keltner Channels.')),
        colorInput(NEUTRAL, msg('indicator.ttmSqueeze.squeezeOffColor', 'Squeeze Off'), 'squeezeOffColor', msg('indicator.ttmSqueeze.squeezeOffColor.tooltip', 'Zero-line dot color while the Bollinger Bands trade outside the Keltner Channels.')),
        boolInput('markFires', msg('indicator.ttmSqueeze.markFires', 'Mark Squeeze Fires'), true, STYLE, msg('indicator.ttmSqueeze.markFires.tooltip', 'Draws a cross on the zero line on the first bar where the bands re-emerge outside the channels, colored by the side of the momentum histogram.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const basis = sma(src, len);
        const dev = map(stdev(src, len), (x) => x * num(inputs, 'bbMult', 2));
        const kcRange = map(atr(bars, len), (x) => x * num(inputs, 'kcMult', 1.5));
        // Momentum: regression of price against an anchor midway between the range
        // midpoint and the shared basis.
        const rangeMid = zip(highest(highs(bars), len), lowest(lows(bars), len), (h, l) => (h + l) / 2);
        const anchor = zip(rangeMid, basis, (d, b) => (d + b) / 2);
        const mom = linreg(sub(src, anchor), len, 0);
        const squeezeOn = basis.map((b, i) => {
            const d = dev[i]!;
            const r = kcRange[i]!;
            if (!Number.isFinite(b) || !Number.isFinite(d) || !Number.isFinite(r)) return null;
            return d < r;
        });
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const onInk = str(inputs, 'squeezeOnColor', WARNING);
        const offInk = str(inputs, 'squeezeOffColor', NEUTRAL);
        const momColors = mom.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            const prev = i > 0 && Number.isFinite(mom[i - 1]!) ? mom[i - 1]! : x;
            const rising = x > prev;
            return x >= 0 ? (rising ? bull : transp(bull, 60)) : rising ? transp(bear, 60) : bear;
        });
        const plots: ClassicPlot[] = [
            { key: 'mom', title: msg('indicator.ttmSqueeze.plot.mom', 'Momentum'), values: mom, kind: 'columns', color: bull, colors: momColors, base: 0 },
            {
                key: 'state',
                title: msg('indicator.ttmSqueeze.plot.state', 'Squeeze State'),
                values: squeezeOn.map((s) => (s == null ? Number.NaN : 0)),
                kind: 'circles',
                color: offInk,
                width: 2,
                colors: squeezeOn.map((s) => (s == null ? null : s ? onInk : offInk)),
            },
        ];
        if (bool(inputs, 'markFires', true)) {
            // The fire bar: the first bar the bands re-emerge outside the channels.
            const fires = squeezeOn.map((s, i) => (s === false && squeezeOn[i - 1] === true ? 0 : Number.NaN));
            plots.push({
                key: 'fire',
                title: msg('indicator.ttmSqueeze.plot.fire', 'Squeeze Fire'),
                values: fires,
                kind: 'cross',
                color: offInk,
                width: 3,
                colors: fires.map((x, i) => (Number.isFinite(x) ? (Number.isFinite(mom[i]!) ? (mom[i]! >= 0 ? bull : bear) : offInk) : null)),
            });
        }
        return { plots };
    },
};

const momentum: ClassicIndicatorSpec = {
    type: 'momentum',
    title: msg('indicator.momentum.title', 'Momentum'),
    shortTitle: msg('indicator.momentum.shortTitle', 'Mom'),
    overlay: false,
    inputs: [
        lengthInput(10, 'length', msg('indicator.momentum.length', 'Length'), 5000, msg('indicator.momentum.length.tooltip', 'Lookback period; the source is compared with its value this many bars ago.')),
        sourceInput('Close', 'source', msg('indicator.momentum.source', 'Source'), msg('indicator.momentum.source.tooltip', 'Series the difference is measured on.')),
        colorInput(NEUTRAL, msg('indicator.momentum.color', 'Line'), 'color', msg('indicator.momentum.color.tooltip', 'Color of the line when the reading sits exactly at zero.')),
        colorInput(BULLISH, msg('indicator.momentum.bullColor', 'Bullish'), 'bullColor', msg('indicator.momentum.bullColor.tooltip', 'Color of the line and fill while the reading is above zero.')),
        colorInput(BEARISH, msg('indicator.momentum.bearColor', 'Bearish'), 'bearColor', msg('indicator.momentum.bearColor.tooltip', 'Color of the line and fill while the reading is below zero.')),
        boolInput('gradientFill', msg('indicator.momentum.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.momentum.gradientFill.tooltip', 'Fills the area between the line and zero, following the line color.')),
    ],
    compute: (bars, inputs) =>
        centeredOscillator({
            key: 'mom',
            title: msg('indicator.momentum.plot.mom', 'Momentum'),
            values: change(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 10)),
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            fill: bool(inputs, 'gradientFill', true),
        }),
};

/**
 * Ink of a line against its own last confirmed swing points: `bull` above the swing
 * high, `bear` below the swing low, `neutral` between them. A swing is a bar no bar
 * within `length` on either side exceeds, so it is only known `length` bars later.
 */
function swingBreakoutColors(values: readonly number[], length: number, ink: { bull: string; bear: string; neutral: string }): Array<string | null> {
    let swingHigh = Number.NaN;
    let swingLow = Number.NaN;
    return values.map((x, i) => {
        const candidate = i - length;
        if (candidate - length >= 0) {
            const pivot = values[candidate]!;
            let isHigh = Number.isFinite(pivot);
            let isLow = isHigh;
            for (let k = candidate - length; k <= i && (isHigh || isLow); k++) {
                if (k === candidate) continue;
                const v = values[k]!;
                // A plateau counts once, at its last bar; a gap in the window confirms nothing.
                if (!Number.isFinite(v) || (k < candidate ? v > pivot : v >= pivot)) isHigh = false;
                if (!Number.isFinite(v) || (k < candidate ? v < pivot : v <= pivot)) isLow = false;
            }
            if (isHigh) swingHigh = pivot;
            if (isLow) swingLow = pivot;
        }
        if (!Number.isFinite(x)) return null;
        return x > swingHigh ? ink.bull : x < swingLow ? ink.bear : ink.neutral;
    });
}

const accumulativeSwingIndex: ClassicIndicatorSpec = {
    type: 'accumulative-swing-index',
    title: msg('indicator.accumulativeSwingIndex.title', 'Accumulative Swing Index'),
    overlay: false,
    inputs: [
        floatInput('limitMove', msg('indicator.accumulativeSwingIndex.limitMove', 'Limit Move'), 10, 0.1, 100000, 0.1, msg('indicator.accumulativeSwingIndex.limitMove.tooltip', 'Largest price change allowed in one direction in a session. Every swing is divided by it, so a larger value flattens the whole line.')),
        lengthInput(10, 'swingLength', msg('indicator.accumulativeSwingIndex.swingLength', 'Swing Length'), 200, msg('indicator.accumulativeSwingIndex.swingLength.tooltip', 'Bars on each side required to confirm a swing high or low of the line. The line is colored against its most recent confirmed swing points.')),
        colorInput(NEUTRAL, msg('indicator.accumulativeSwingIndex.color', 'ASI Line'), 'color', msg('indicator.accumulativeSwingIndex.color.tooltip', 'Color of the line while it sits between its prior swing high and swing low.')),
        colorInput(BULLISH, msg('indicator.accumulativeSwingIndex.bullColor', 'Bullish'), 'bullColor', msg('indicator.accumulativeSwingIndex.bullColor.tooltip', 'Color of the line while it reads above its prior swing high, which Wilder took as confirming an upside breakout in price.')),
        colorInput(BEARISH, msg('indicator.accumulativeSwingIndex.bearColor', 'Bearish'), 'bearColor', msg('indicator.accumulativeSwingIndex.bearColor.tooltip', 'Color of the line while it reads below its prior swing low, which Wilder took as confirming a downside breakout in price.')),
    ],
    compute: (bars, inputs) => {
        const limit = Math.max(num(inputs, 'limitMove', 10), 0.1);
        const swing = new Array<number>(bars.length).fill(Number.NaN);
        for (let i = 1; i < bars.length; i++) {
            const b = bars[i]!;
            const p = bars[i - 1]!;
            const toHigh = Math.abs(b.high - p.close);
            const toLow = Math.abs(b.low - p.close);
            const range = b.high - b.low;
            const prevBody = Math.abs(p.close - p.open);
            // Wilder's R takes its form from whichever of the three distances is the largest.
            const r = toHigh >= toLow && toHigh >= range ? toHigh - 0.5 * toLow + 0.25 * prevBody : toLow >= toHigh && toLow >= range ? toLow - 0.5 * toHigh + 0.25 * prevBody : range + 0.25 * prevBody;
            const weighted = b.close - p.close + 0.5 * (b.close - b.open) + 0.25 * (p.close - p.open);
            // A bar with no movement at all swings nothing.
            swing[i] = r === 0 ? 0 : (50 * weighted * (Math.max(toHigh, toLow) / limit)) / r;
        }
        const values = cumSum(swing);
        const ink = { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) };
        return { plots: [{ key: 'asi', title: msg('indicator.accumulativeSwingIndex.plot.asi', 'ASI'), values, color: ink.neutral, colors: swingBreakoutColors(values, Math.trunc(num(inputs, 'swingLength', 10)), ink) }] };
    },
};

const rankCorrelationIndex: ClassicIndicatorSpec = {
    type: 'rank-correlation-index',
    title: msg('indicator.rankCorrelationIndex.title', 'Rank Correlation Index'),
    shortTitle: msg('indicator.rankCorrelationIndex.shortTitle', 'RCI'),
    overlay: false,
    inputs: [
        { ...lengthInput(12, 'length', msg('indicator.rankCorrelationIndex.length', 'Length'), 1000, msg('indicator.rankCorrelationIndex.length.tooltip', 'Number of bars whose order in time is compared with their order by price.')), min: 2 },
        sourceInput('Close', 'source', msg('indicator.rankCorrelationIndex.source', 'Source'), msg('indicator.rankCorrelationIndex.source.tooltip', 'Price series the bars are ranked by.')),
        ...thresholdInputs(0.8, -0.8, -1, 1, undefined, undefined, 0.05),
        colorInput(NEUTRAL, msg('indicator.rankCorrelationIndex.color', 'RCI Line'), 'color', msg('indicator.rankCorrelationIndex.color.tooltip', 'Color of the RCI line between the levels. Toward either level it blends into that level’s color.')),
        colorInput(BEARISH, msg('indicator.rankCorrelationIndex.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.rankCorrelationIndex.overboughtColor.tooltip', 'Color of the line and zone shading at and above the overbought level.')),
        colorInput(BULLISH, msg('indicator.rankCorrelationIndex.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.rankCorrelationIndex.oversoldColor.tooltip', 'Color of the line and zone shading at and below the oversold level.')),
    ],
    compute: (bars, inputs) =>
        boundedOscillator({
            key: 'rci',
            title: msg('indicator.rankCorrelationIndex.plot.rci', 'RCI'),
            values: rankCorrelation(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 12)),
            scale: { top: 1, bottom: -1 },
            overbought: num(inputs, 'overbought', 0.8),
            oversold: num(inputs, 'oversold', -0.8),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: NEUTRAL,
            midline: 0,
        }),
};

const majorityRule: ClassicIndicatorSpec = {
    type: 'majority-rule',
    title: msg('indicator.majorityRule.title', 'Majority Rule'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.majorityRule.length', 'Rolling Period'), 5000, msg('indicator.majorityRule.length.tooltip', 'Number of bars counted. The reading is the percentage of them that closed above the bar before.')),
        colorInput(NEUTRAL, msg('indicator.majorityRule.color', 'Line'), 'color', msg('indicator.majorityRule.color.tooltip', 'Color of the line when exactly half the bars closed higher.')),
        colorInput(BULLISH, msg('indicator.majorityRule.bullColor', 'Bullish'), 'bullColor', msg('indicator.majorityRule.bullColor.tooltip', 'Color of the line and fill while more than half the bars closed higher.')),
        colorInput(BEARISH, msg('indicator.majorityRule.bearColor', 'Bearish'), 'bearColor', msg('indicator.majorityRule.bearColor.tooltip', 'Color of the line and fill while fewer than half the bars closed higher.')),
        boolInput('gradientFill', msg('indicator.majorityRule.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.majorityRule.gradientFill.tooltip', 'Fills the area between the line and the midline, following the line color.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const closedHigher = map(change(closes(bars)), (d) => (d > 0 ? 1 : 0));
        return centeredOscillator({
            key: 'majority',
            title: msg('indicator.majorityRule.plot.majority', 'Majority Rule'),
            values: map(sum(closedHigher, len), (count) => (100 * count) / len),
            baseline: 50,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            zeroTitle: msg('indicator.common.level.midline', 'Midline'),
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

const advanceDecline: ClassicIndicatorSpec = {
    type: 'advance-decline',
    title: msg('indicator.advanceDecline.title', 'Advance/Decline'),
    overlay: false,
    inputs: [
        lengthInput(10, 'length', msg('indicator.advanceDecline.length', 'Length'), 5000, msg('indicator.advanceDecline.length.tooltip', 'Number of bars counted. The reading divides how many closed above their open by how many closed below it.')),
        colorInput(NEUTRAL, msg('indicator.advanceDecline.color', 'Line'), 'color', msg('indicator.advanceDecline.color.tooltip', 'Color of the line when up bars and down bars are level.')),
        colorInput(BULLISH, msg('indicator.advanceDecline.bullColor', 'Bullish'), 'bullColor', msg('indicator.advanceDecline.bullColor.tooltip', 'Color of the line and fill while up bars outnumber down bars.')),
        colorInput(BEARISH, msg('indicator.advanceDecline.bearColor', 'Bearish'), 'bearColor', msg('indicator.advanceDecline.bearColor.tooltip', 'Color of the line and fill while down bars outnumber up bars.')),
        boolInput('gradientFill', msg('indicator.advanceDecline.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.advanceDecline.gradientFill.tooltip', 'Fills the area between the line and 1, following the line color.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const up = sum(bars.map((b) => (b.close > b.open ? 1 : 0)), len);
        const down = sum(bars.map((b) => (b.close < b.open ? 1 : 0)), len);
        return centeredOscillator({
            key: 'ratio',
            title: msg('indicator.advanceDecline.plot.ratio', 'Advance/Decline'),
            // A window with no down bar reads as its count of up bars, never a division by zero.
            values: zip(up, down, (u, d) => (d === 0 ? u : u / d)),
            baseline: 1,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            zeroTitle: msg('indicator.advanceDecline.level.even', 'Even'),
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

export const oscillatorSpecs: ClassicIndicatorSpec[] = [
    rsiSpec,
    stochastic,
    stochasticRsi,
    macd,
    ppo,
    awesome,
    accelerator,
    cci,
    williamsR,
    cmoSpec,
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
    momentum,
    ultimate,
    rvgi,
    relVolatility,
    bop,
    elderRay,
    ttmSqueeze,
    accumulativeSwingIndex,
    rankCorrelationIndex,
    majorityRule,
    advanceDecline,
];
