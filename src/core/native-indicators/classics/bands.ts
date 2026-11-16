import { msg } from '../../i18n/message';
import type { OHLCV } from '../../model/ohlcv';
import type { InputValue } from '../../model/inputs';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec, ClassicInput, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { STYLE, boolInput, channelStyleInputs, colorInput, directionalChannel, floatInput, intInput, lengthInput, optionInput, sourceInput, transp } from './shared';
import { sourceValues, highs, lows, sma, ema, rma, wma, stdev, stdError, linreg, highest, lowest, atr, trueRange, zip, map, sub, shift } from './math';

/** Bands and channels — envelopes around price plus their derived oscillators. */

/** Bill Williams' balance lines are drawn in their own inks, unrelated to direction. */
const JAW_COLOR = '#ab47bc'; // palette-exempt: the Alligator's own jaw hue, not a semantic color
const TEETH_COLOR = WARNING;
const LIPS_COLOR = '#ffd700'; // palette-exempt: the Alligator's own lips hue, not a semantic color

function bollinger(bars: readonly OHLCV[], inputs: Record<string, InputValue>): { src: number[]; basis: number[]; upper: number[]; lower: number[] } {
    const len = num(inputs, 'length', 20);
    const mult = num(inputs, 'mult', 2);
    const src = sourceValues(bars, str(inputs, 'source', 'Close'));
    const basis = sma(src, len);
    const dev = map(stdev(src, len), (x) => x * mult);
    return { src, basis, upper: zip(basis, dev, (b, d) => b + d), lower: zip(basis, dev, (b, d) => b - d) };
}

/** Length / source / multiplier, as the derived %B and BandWidth studies declare them. */
function bollingerInputs(multMin: number, multStep: number): ClassicInput[] {
    return [
        { ...lengthInput(20, 'length', msg('indicator.common.length', 'Length'), 5000, msg('indicator.bollinger.length.tooltip', 'Number of bars used for the Bollinger Bands basis (a simple moving average) and for the standard deviation.')), min: 2 },
        sourceInput('Close', 'source', msg('indicator.common.source', 'Source'), msg('indicator.bollinger.source.tooltip', 'Price series the bands are computed from.')),
        floatInput('mult', msg('indicator.bollinger.mult', 'Multiplier'), 2, multMin, 50, multStep, msg('indicator.bollinger.mult.tooltip', 'Standard deviation multiplier for the upper and lower bands.')),
    ];
}

const bollingerBands: ClassicIndicatorSpec = {
    type: 'bollinger-bands',
    title: msg('indicator.bollingerBands.title', 'Bollinger Bands'),
    shortTitle: msg('indicator.bollingerBands.shortTitle', 'BB'),
    overlay: true,
    inputs: [
        lengthInput(20, 'length', msg('indicator.bollingerBands.length', 'Length'), 5000, msg('indicator.bollingerBands.length.tooltip', 'Number of bars used to calculate the basis SMA and the standard deviation.')),
        sourceInput('Close', 'source', msg('indicator.bollingerBands.source', 'Source'), msg('indicator.bollingerBands.source.tooltip', 'Price series the bands are calculated on.')),
        floatInput('mult', msg('indicator.bollingerBands.mult', 'Multiplier'), 2, 0, 50, 0.1, msg('indicator.bollingerBands.mult.tooltip', 'Number of standard deviations added above and below the basis to form the bands.')),
        colorInput(WARNING, msg('indicator.bollingerBands.basisColor', 'Basis'), 'basisColor', msg('indicator.bollingerBands.basisColor.tooltip', 'Color of the basis (middle band) moving average.')),
        colorInput(INFO, msg('indicator.bollingerBands.color', 'Bands'), 'color', msg('indicator.bollingerBands.color.tooltip', 'Color of the upper and lower bands.')),
        colorInput(transp(INFO, 92), msg('indicator.bollingerBands.fillColor', 'Fill'), 'fillColor', msg('indicator.bollingerBands.fillColor.tooltip', 'Fill color of the area between the upper and lower bands.')),
    ],
    compute: (bars, inputs) => {
        const { basis, upper, lower } = bollinger(bars, inputs);
        const ink = str(inputs, 'color', INFO);
        return {
            plots: [
                { key: 'basis', title: msg('indicator.bollingerBands.plot.basis', 'Basis'), values: basis, color: str(inputs, 'basisColor', WARNING) },
                { key: 'upper', title: msg('indicator.bollingerBands.plot.upper', 'Upper'), values: upper, color: ink },
                { key: 'lower', title: msg('indicator.bollingerBands.plot.lower', 'Lower'), values: lower, color: ink },
            ],
            bands: [{ key: 'bb', from: 'upper', to: 'lower', color: str(inputs, 'fillColor', transp(INFO, 92)) }],
        };
    },
};

const PERCENT_B_MID = 0.5;
const THRESHOLDS = 'Thresholds';

const percentB: ClassicIndicatorSpec = {
    type: 'percent-b',
    title: msg('indicator.percentB.title', 'Bollinger Bands %B'),
    shortTitle: msg('indicator.percentB.shortTitle', '%B'),
    overlay: false,
    inputs: [
        ...bollingerInputs(0.001, 0.25),
        { ...floatInput('overbought', msg('indicator.percentB.overbought', 'Overbought'), 1, -10, 10, 0.05, msg('indicator.percentB.overbought.tooltip', 'Level treated as overbought. 1 is the upper band itself, so readings above the default mean price sits outside the bands.')), group: THRESHOLDS },
        { ...floatInput('oversold', msg('indicator.percentB.oversold', 'Oversold'), 0, -10, 10, 0.05, msg('indicator.percentB.oversold.tooltip', 'Level treated as oversold. 0 is the lower band itself, so readings below the default mean price sits outside the bands.')), group: THRESHOLDS },
        colorInput(BULLISH, msg('indicator.percentB.bullColor', 'Bullish'), 'bullColor', msg('indicator.percentB.bullColor.tooltip', 'Color of %B above the 0.5 midline, where price trades in the upper half of the bands.')),
        colorInput(BEARISH, msg('indicator.percentB.bearColor', 'Bearish'), 'bearColor', msg('indicator.percentB.bearColor.tooltip', 'Color of %B below the 0.5 midline, where price trades in the lower half of the bands.')),
        boolInput('gradientFill', msg('indicator.percentB.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.percentB.gradientFill.tooltip', 'Vertical gradient between %B and the 0.5 midline, fully transparent at the midline and more opaque at the oscillator value.')),
        colorInput(NEUTRAL, msg('indicator.percentB.levelsColor', 'Levels Color'), 'levelsColor', msg('indicator.percentB.levelsColor.tooltip', 'Color of the dashed overbought/oversold levels and of the dotted midline.')),
    ],
    compute: (bars, inputs) => {
        const { src, upper, lower } = bollinger(bars, inputs);
        const values = src.map((x, i) => {
            const u = upper[i]!;
            const l = lower[i]!;
            return Number.isFinite(u) && Number.isFinite(l) && u !== l ? (x - l) / (u - l) : Number.NaN;
        });
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const levels = str(inputs, 'levelsColor', NEUTRAL);
        const colors = values.map((x) => (Number.isFinite(x) ? (x > PERCENT_B_MID ? bull : bear) : null));
        const plots: ClassicPlot[] = [
            { key: 'pb', title: msg('indicator.percentB.plot.pb', '%B'), values, color: bear, colors },
            { key: 'mid', title: msg('indicator.percentB.plot.mid', 'Midline'), values: values.map((x) => (Number.isFinite(x) ? PERCENT_B_MID : Number.NaN)), color: levels, display: { pane: false, legend: false, dataWindow: false } },
        ];
        const bands = bool(inputs, 'gradientFill', true)
            ? [
                  {
                      key: 'pbFill',
                      from: 'pb',
                      to: 'mid',
                      color: transp(NEUTRAL, 100),
                      // Opaque at the oscillator, invisible where it meets the midline.
                      gradient: values.map((x) => {
                          if (!Number.isFinite(x)) return null;
                          const up = x > PERCENT_B_MID;
                          const ink = up ? bull : bear;
                          return {
                              topValue: Math.max(x, PERCENT_B_MID),
                              bottomValue: Math.min(x, PERCENT_B_MID),
                              topColor: up ? transp(ink, 50) : transp(ink, 100),
                              bottomColor: up ? transp(ink, 100) : transp(ink, 50),
                          };
                      }),
                  },
              ]
            : [];
        return {
            plots,
            bands,
            levels: [
                { key: 'overbought', price: num(inputs, 'overbought', 1), color: levels, lineStyle: 'dashed', title: msg('indicator.percentB.level.overbought', 'Overbought') },
                { key: 'oversold', price: num(inputs, 'oversold', 0), color: levels, lineStyle: 'dashed', title: msg('indicator.percentB.level.oversold', 'Oversold') },
                { key: 'midline', price: PERCENT_B_MID, color: transp(levels, 50), lineStyle: 'dotted', title: msg('indicator.percentB.level.midline', 'Midline') },
            ],
        };
    },
};

const SQUEEZE_BULGE = 'Squeeze & Bulge';

const bandwidth: ClassicIndicatorSpec = {
    type: 'bandwidth',
    title: msg('indicator.bandwidth.title', 'Bollinger Bands Width'),
    shortTitle: msg('indicator.bandwidth.shortTitle', 'BandWidth'),
    overlay: false,
    inputs: [
        ...bollingerInputs(0.001, 0.25),
        { ...intInput('lookback', msg('indicator.bandwidth.lookback', 'Reference Lookback'), 125, 2, 5000, msg('indicator.bandwidth.lookback.tooltip', 'Window used to locate the lowest (Squeeze) and highest (Bulge) BandWidth references.')), group: SQUEEZE_BULGE },
        boolInput('showSqueeze', msg('indicator.bandwidth.showSqueeze', 'Show Squeeze Level'), true, SQUEEZE_BULGE, msg('indicator.bandwidth.showSqueeze.tooltip', 'Plots the lowest BandWidth of the reference lookback — unusually compressed volatility, a condition rather than a directional signal.')),
        boolInput('showBulge', msg('indicator.bandwidth.showBulge', 'Show Bulge Level'), true, SQUEEZE_BULGE, msg('indicator.bandwidth.showBulge.tooltip', 'Plots the highest BandWidth of the reference lookback — extreme width that is unlikely to be sustained.')),
        colorInput(NEUTRAL, msg('indicator.bandwidth.color', 'BandWidth'), 'color', msg('indicator.bandwidth.color.tooltip', 'Color of the BandWidth line. At its Squeeze reference the line takes the Squeeze color, at its Bulge reference the Bulge color.')),
        boolInput('gradientFill', msg('indicator.bandwidth.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.bandwidth.gradientFill.tooltip', 'Fills the area between zero and BandWidth with a vertical gradient, fully transparent at zero.')),
        colorInput(WARNING, msg('indicator.bandwidth.squeezeColor', 'Squeeze Level'), 'squeezeColor', msg('indicator.bandwidth.squeezeColor.tooltip', 'Color of the lowest-BandWidth reference line.')),
        colorInput(BEARISH, msg('indicator.bandwidth.bulgeColor', 'Bulge Level'), 'bulgeColor', msg('indicator.bandwidth.bulgeColor.tooltip', 'Color of the highest-BandWidth reference line.')),
    ],
    compute: (bars, inputs) => {
        const { basis, upper, lower } = bollinger(bars, inputs);
        // Dividing the span by the basis normalizes it, so readings compare across instruments.
        const values = basis.map((b, i) => {
            const u = upper[i]!;
            const l = lower[i]!;
            return Number.isFinite(b) && b !== 0 && Number.isFinite(u) && Number.isFinite(l) ? (u - l) / b : Number.NaN;
        });
        const lookback = num(inputs, 'lookback', 125);
        const squeezeLevel = lowest(values, lookback);
        const bulgeLevel = highest(values, lookback);
        const base = str(inputs, 'color', NEUTRAL);
        const squeezeInk = str(inputs, 'squeezeColor', WARNING);
        const bulgeInk = str(inputs, 'bulgeColor', BEARISH);
        const colors = values.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            if (x <= squeezeLevel[i]!) return squeezeInk;
            if (x >= bulgeLevel[i]!) return bulgeInk;
            return base;
        });
        const plots: ClassicPlot[] = [
            { key: 'bbw', title: msg('indicator.bandwidth.plot.bbw', 'BandWidth'), values, color: base, colors },
            { key: 'zero', title: msg('indicator.bandwidth.plot.zero', 'Zero Line'), values: values.map((x) => (Number.isFinite(x) ? 0 : Number.NaN)), color: transp(NEUTRAL, 90) },
        ];
        if (bool(inputs, 'showSqueeze', true)) plots.push({ key: 'squeeze', title: msg('indicator.bandwidth.plot.squeeze', 'Squeeze Level'), values: squeezeLevel, color: squeezeInk });
        if (bool(inputs, 'showBulge', true)) plots.push({ key: 'bulge', title: msg('indicator.bandwidth.plot.bulge', 'Bulge Level'), values: bulgeLevel, color: bulgeInk });
        const bands = bool(inputs, 'gradientFill', true)
            ? [
                  {
                      key: 'bbwFill',
                      from: 'bbw',
                      to: 'zero',
                      color: transp(NEUTRAL, 100),
                      gradient: values.map((x, i) => {
                          if (!Number.isFinite(x)) return null;
                          const ink = colors[i] ?? base;
                          return { topValue: x, bottomValue: 0, topColor: transp(ink, 50), bottomColor: transp(ink, 100) };
                      }),
                  },
              ]
            : [];
        return { plots, bands };
    },
};

const keltner: ClassicIndicatorSpec = {
    type: 'keltner-channels',
    title: msg('indicator.keltnerChannels.title', 'Keltner Channels'),
    shortTitle: msg('indicator.keltnerChannels.shortTitle', 'KC'),
    overlay: true,
    inputs: [
        lengthInput(20, 'length', msg('indicator.keltnerChannels.length', 'EMA Length'), 5000, msg('indicator.keltnerChannels.length.tooltip', 'Number of bars used to compute the exponential moving average basis line.')),
        intInput('atrLength', msg('indicator.keltnerChannels.atrLength', 'ATR Length'), 10, 1, 5000, msg('indicator.keltnerChannels.atrLength.tooltip', 'Number of bars used to compute the Average True Range (Wilder smoothing).')),
        floatInput('mult', msg('indicator.keltnerChannels.mult', 'Multiplier'), 2, 0, 50, 0.1, msg('indicator.keltnerChannels.mult.tooltip', 'ATR multiple used to offset the upper and lower bands from the basis line.')),
        sourceInput('Close', 'source', msg('indicator.keltnerChannels.source', 'Source'), msg('indicator.keltnerChannels.source.tooltip', 'Price series used to compute the basis line.')),
        ...channelStyleInputs('Basis Color'),
    ],
    compute: (bars, inputs) => {
        const basis = ema(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 20));
        const range = map(atr(bars, num(inputs, 'atrLength', 10)), (x) => x * num(inputs, 'mult', 2));
        const ink = { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'basisColor', NEUTRAL) };
        return directionalChannel(bars, basis, zip(basis, range, (b, r) => b + r), zip(basis, range, (b, r) => b - r), ink, 'kc');
    },
};

const donchian: ClassicIndicatorSpec = {
    type: 'donchian-channels',
    title: msg('indicator.donchianChannels.title', 'Donchian Channels'),
    shortTitle: msg('indicator.donchianChannels.shortTitle', 'DC'),
    overlay: true,
    inputs: [
        lengthInput(20, 'length', msg('indicator.donchianChannels.length', 'Length'), 5000, msg('indicator.donchianChannels.length.tooltip', 'Lookback length. The upper and lower channels are the highest high and lowest low over this many bars.')),
        colorInput(BEARISH, msg('indicator.donchianChannels.upperColor', 'Upper'), 'upperColor', msg('indicator.donchianChannels.upperColor.tooltip', 'Color of the upper channel line.')),
        colorInput(NEUTRAL, msg('indicator.donchianChannels.middleColor', 'Middle'), 'middleColor', msg('indicator.donchianChannels.middleColor.tooltip', 'Color of the channel midline.')),
        colorInput(BULLISH, msg('indicator.donchianChannels.lowerColor', 'Lower'), 'lowerColor', msg('indicator.donchianChannels.lowerColor.tooltip', 'Color of the lower channel line.')),
        colorInput(transp(NEUTRAL, 92), msg('indicator.donchianChannels.fillColor', 'Fill'), 'fillColor', msg('indicator.donchianChannels.fillColor.tooltip', 'Color of the channel interior fill.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const upper = highest(highs(bars), len);
        const lower = lowest(lows(bars), len);
        return {
            plots: [
                { key: 'upper', title: msg('indicator.donchianChannels.plot.upper', 'Upper'), values: upper, color: str(inputs, 'upperColor', BEARISH) },
                { key: 'middle', title: msg('indicator.donchianChannels.plot.middle', 'Middle'), kind: 'circles', values: zip(upper, lower, (u, l) => (u + l) / 2), color: str(inputs, 'middleColor', NEUTRAL) },
                { key: 'lower', title: msg('indicator.donchianChannels.plot.lower', 'Lower'), values: lower, color: str(inputs, 'lowerColor', BULLISH) },
            ],
            bands: [{ key: 'dc', from: 'upper', to: 'lower', color: str(inputs, 'fillColor', transp(NEUTRAL, 92)) }],
        };
    },
};

const movingAverageChannel: ClassicIndicatorSpec = {
    type: 'moving-average-channel',
    title: msg('indicator.movingAverageChannel.title', 'Moving Average Channel'),
    shortTitle: msg('indicator.movingAverageChannel.shortTitle', 'MAC'),
    overlay: true,
    inputs: [
        lengthInput(20, 'upperLength', msg('indicator.movingAverageChannel.upperLength', 'Upper Length'), 5000, msg('indicator.movingAverageChannel.upperLength.tooltip', 'Number of bars in the simple moving average of the highs.')),
        lengthInput(20, 'lowerLength', msg('indicator.movingAverageChannel.lowerLength', 'Lower Length'), 5000, msg('indicator.movingAverageChannel.lowerLength.tooltip', 'Number of bars in the simple moving average of the lows.')),
        intInput('upperOffset', msg('indicator.movingAverageChannel.upperOffset', 'Upper Offset'), 0, -500, 500, msg('indicator.movingAverageChannel.upperOffset.tooltip', 'Bars the upper line is displaced by. Positive values push it to the right.')),
        intInput('lowerOffset', msg('indicator.movingAverageChannel.lowerOffset', 'Lower Offset'), 0, -500, 500, msg('indicator.movingAverageChannel.lowerOffset.tooltip', 'Bars the lower line is displaced by. Positive values push it to the right.')),
        colorInput(BEARISH, msg('indicator.movingAverageChannel.upperColor', 'Upper'), 'upperColor', msg('indicator.movingAverageChannel.upperColor.tooltip', 'Color of the upper channel line.')),
        colorInput(BULLISH, msg('indicator.movingAverageChannel.lowerColor', 'Lower'), 'lowerColor', msg('indicator.movingAverageChannel.lowerColor.tooltip', 'Color of the lower channel line.')),
        colorInput(transp(NEUTRAL, 92), msg('indicator.movingAverageChannel.fillColor', 'Fill'), 'fillColor', msg('indicator.movingAverageChannel.fillColor.tooltip', 'Color of the channel interior fill.')),
    ],
    compute: (bars, inputs) => ({
        plots: [
            { key: 'upper', title: msg('indicator.movingAverageChannel.plot.upper', 'Upper'), values: shift(sma(highs(bars), num(inputs, 'upperLength', 20)), Math.trunc(num(inputs, 'upperOffset', 0))), color: str(inputs, 'upperColor', BEARISH) },
            { key: 'lower', title: msg('indicator.movingAverageChannel.plot.lower', 'Lower'), values: shift(sma(lows(bars), num(inputs, 'lowerLength', 20)), Math.trunc(num(inputs, 'lowerOffset', 0))), color: str(inputs, 'lowerColor', BULLISH) },
        ],
        bands: [{ key: 'mac', from: 'upper', to: 'lower', color: str(inputs, 'fillColor', transp(NEUTRAL, 92)) }],
    }),
};

/** How far each band's fill fades, on the reference's 0 (opaque) to 100 (invisible) scale. */
const SEB_FILL_TRANSPARENCY = 90;

const standardErrorBands: ClassicIndicatorSpec = {
    type: 'standard-error-bands',
    title: msg('indicator.standardErrorBands.title', 'Standard Error Bands'),
    shortTitle: msg('indicator.standardErrorBands.shortTitle', 'SEB'),
    overlay: true,
    inputs: [
        { ...lengthInput(21, 'length', msg('indicator.standardErrorBands.length', 'Length'), 5000, msg('indicator.standardErrorBands.length.tooltip', 'Number of bars used to fit the linear regression and compute its standard error.')), min: 3 },
        floatInput('mult', msg('indicator.standardErrorBands.mult', 'SE Multiplier'), 2, 0, 50, 0.1, msg('indicator.standardErrorBands.mult.tooltip', 'Multiple of the regression standard error used to offset the bands from the regression line.')),
        lengthInput(3, 'smoothing', msg('indicator.standardErrorBands.smoothing', 'Smoothing'), 500, msg('indicator.standardErrorBands.smoothing.tooltip', 'Moving average length applied to the regression line and to its standard error. 1 leaves both unsmoothed.')),
        optionInput('smoothingType', msg('indicator.standardErrorBands.smoothingType', 'Smoothing Type'), 'SMA', ['SMA', 'EMA', 'WMA'], msg('indicator.standardErrorBands.smoothingType.tooltip', 'Moving average used for that smoothing.')),
        sourceInput('Close', 'source', msg('indicator.standardErrorBands.source', 'Source'), msg('indicator.standardErrorBands.source.tooltip', 'Price series the regression is fitted to.')),
        colorInput(NEUTRAL, msg('indicator.standardErrorBands.basisColor', 'Regression Line'), 'basisColor', msg('indicator.standardErrorBands.basisColor.tooltip', 'Color of the smoothed linear regression midline.')),
        colorInput(BEARISH, msg('indicator.standardErrorBands.upperColor', 'Upper Band'), 'upperColor', msg('indicator.standardErrorBands.upperColor.tooltip', 'Color of the upper band and of the fill between it and the regression line.')),
        colorInput(BULLISH, msg('indicator.standardErrorBands.lowerColor', 'Lower Band'), 'lowerColor', msg('indicator.standardErrorBands.lowerColor.tooltip', 'Color of the lower band and of the fill between it and the regression line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 21);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const kind = str(inputs, 'smoothingType', 'SMA');
        const smoothLen = num(inputs, 'smoothing', 3);
        const smooth = (v: number[]): number[] => (kind === 'EMA' ? ema(v, smoothLen) : kind === 'WMA' ? wma(v, smoothLen) : sma(v, smoothLen));
        // The line is each bar's regression endpoint; the bands ride its standard error, both smoothed alike.
        const middle = smooth(linreg(src, len));
        const reach = map(smooth(stdError(src, len)), (x) => x * num(inputs, 'mult', 2));
        const upperInk = str(inputs, 'upperColor', BEARISH);
        const lowerInk = str(inputs, 'lowerColor', BULLISH);
        return {
            plots: [
                { key: 'basis', title: msg('indicator.standardErrorBands.plot.basis', 'Basis'), values: middle, color: str(inputs, 'basisColor', NEUTRAL) },
                { key: 'upper', title: msg('indicator.standardErrorBands.plot.upper', 'Upper Band'), values: zip(middle, reach, (m, r) => m + r), color: upperInk },
                { key: 'lower', title: msg('indicator.standardErrorBands.plot.lower', 'Lower Band'), values: zip(middle, reach, (m, r) => m - r), color: lowerInk },
            ],
            bands: [
                { key: 'sebUpper', from: 'upper', to: 'basis', color: transp(upperInk, SEB_FILL_TRANSPARENCY) },
                { key: 'sebLower', from: 'basis', to: 'lower', color: transp(lowerInk, SEB_FILL_TRANSPARENCY) },
            ],
        };
    },
};

const volatilityIndex: ClassicIndicatorSpec = {
    type: 'volatility-index',
    title: msg('indicator.volatilityIndex.title', 'Volatility Index'),
    shortTitle: msg('indicator.volatilityIndex.shortTitle', 'Vol Index'),
    overlay: true,
    inputs: [
        lengthInput(10, 'length', msg('indicator.volatilityIndex.length', 'Length'), 5000, msg('indicator.volatilityIndex.length.tooltip', 'Number of bars in the average true range.')),
        floatInput('mult', msg('indicator.volatilityIndex.mult', 'ATR Multiplier'), 3, 0, 50, 0.1, msg('indicator.volatilityIndex.mult.tooltip', 'Multiple of the average true range the stop keeps from the most favorable close.')),
        optionInput('smoothing', msg('indicator.volatilityIndex.smoothing', 'Smoothing'), 'RMA', ['RMA', 'EMA'], msg('indicator.volatilityIndex.smoothing.tooltip', "Average applied to the true range. RMA is Wilder's own smoothing; EMA reacts faster.")),
        colorInput(BULLISH, msg('indicator.volatilityIndex.longColor', 'Long Stop'), 'longColor', msg('indicator.volatilityIndex.longColor.tooltip', 'Color of the stop while it trails below price.')),
        colorInput(BEARISH, msg('indicator.volatilityIndex.shortColor', 'Short Stop'), 'shortColor', msg('indicator.volatilityIndex.shortColor.tooltip', 'Color of the stop while it sits above price.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const mult = num(inputs, 'mult', 3);
        const alpha = str(inputs, 'smoothing', 'RMA') === 'EMA' ? 2 / (len + 1) : 1 / len;
        const range = trueRange(bars);
        const n = bars.length;
        const longStop = new Array<number>(n).fill(Number.NaN);
        const shortStop = new Array<number>(n).fill(Number.NaN);
        let long = true;
        let extreme = Number.NaN; // the most favorable close since the stop last switched sides
        let average = Number.NaN;
        let seed = 0;
        let seeded = 0;
        for (let i = 0; i < n; i++) {
            const close = bars[i]!.close;
            // A bar that closes unchanged moves nothing: the stop holds and the average range does not take the bar in.
            if (i > 0 && close === bars[i - 1]!.close) {
                longStop[i] = longStop[i - 1]!;
                shortStop[i] = shortStop[i - 1]!;
                continue;
            }
            // The stop a bar shows was set before the bar: by the closes and the ranges up to the one before it.
            const stop = long ? extreme - mult * average : extreme + mult * average;
            if (Number.isFinite(stop)) (long ? longStop : shortStop)[i] = stop;
            if (Number.isFinite(average)) average += alpha * (range[i]! - average);
            else {
                seed += range[i]!;
                seeded += 1;
                if (seeded >= len) average = seed / len;
            }
            if (Number.isFinite(stop) && (long ? close < stop : close > stop)) {
                long = !long;
                extreme = close;
            } else if (!Number.isFinite(extreme)) extreme = close;
            else extreme = long ? Math.max(extreme, close) : Math.min(extreme, close);
        }
        return {
            plots: [
                { key: 'long', title: msg('indicator.volatilityIndex.plot.long', 'Long Stop'), values: longStop, color: str(inputs, 'longColor', BULLISH) },
                { key: 'short', title: msg('indicator.volatilityIndex.plot.short', 'Short Stop'), values: shortStop, color: str(inputs, 'shortColor', BEARISH) },
            ],
        };
    },
};

const chandelier: ClassicIndicatorSpec = {
    type: 'chandelier-exit',
    title: msg('indicator.chandelierExit.title', 'Chandelier Exit'),
    shortTitle: msg('indicator.chandelierExit.shortTitle', 'CE'),
    overlay: true,
    inputs: [
        lengthInput(22, 'length', msg('indicator.chandelierExit.length', 'Length'), 5000, msg('indicator.chandelierExit.length.tooltip', 'Lookback used for both the highest high / lowest low extremes and the ATR.')),
        floatInput('mult', msg('indicator.chandelierExit.mult', 'ATR Multiplier'), 3, 0, 50, 0.1, msg('indicator.chandelierExit.mult.tooltip', 'Multiple of ATR subtracted from the highest high (long stop) and added to the lowest low (short stop).')),
        boolInput('ratchet', msg('indicator.chandelierExit.ratchet', 'Ratchet Stops'), false, undefined, msg('indicator.chandelierExit.ratchet.tooltip', 'Prevents the long stop from falling and the short stop from rising, resetting once close crosses through the stop.')),
        colorInput(BULLISH, msg('indicator.chandelierExit.longColor', 'Long Stop'), 'longColor', msg('indicator.chandelierExit.longColor.tooltip', 'Color of the long trailing stop line.')),
        colorInput(BEARISH, msg('indicator.chandelierExit.shortColor', 'Short Stop'), 'shortColor', msg('indicator.chandelierExit.shortColor.tooltip', 'Color of the short trailing stop line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 22);
        const range = map(atr(bars, len), (x) => x * num(inputs, 'mult', 3));
        const basicLong = zip(highest(highs(bars), len), range, (h, r) => h - r);
        const basicShort = zip(lowest(lows(bars), len), range, (l, r) => l + r);
        let long = basicLong;
        let short = basicShort;
        if (bool(inputs, 'ratchet', false)) {
            long = new Array<number>(bars.length).fill(Number.NaN);
            short = new Array<number>(bars.length).fill(Number.NaN);
            for (let i = 0; i < bars.length; i++) {
                const bl = basicLong[i]!;
                const bs = basicShort[i]!;
                const prevClose = i > 0 ? bars[i - 1]!.close : bars[i]!.close;
                const prevLong = i > 0 && Number.isFinite(long[i - 1]!) ? long[i - 1]! : bl;
                const prevShort = i > 0 && Number.isFinite(short[i - 1]!) ? short[i - 1]! : bs;
                long[i] = Number.isFinite(bl) ? (prevClose > prevLong ? Math.max(bl, prevLong) : bl) : Number.NaN;
                short[i] = Number.isFinite(bs) ? (prevClose < prevShort ? Math.min(bs, prevShort) : bs) : Number.NaN;
            }
        }
        return {
            plots: [
                { key: 'long', title: msg('indicator.chandelierExit.plot.long', 'Long Stop'), values: long, color: str(inputs, 'longColor', BULLISH) },
                { key: 'short', title: msg('indicator.chandelierExit.plot.short', 'Short Stop'), values: short, color: str(inputs, 'shortColor', BEARISH) },
            ],
        };
    },
};

const chandeKroll: ClassicIndicatorSpec = {
    type: 'chande-kroll-stop',
    title: msg('indicator.chandeKrollStop.title', 'Chande Kroll Stop'),
    shortTitle: msg('indicator.chandeKrollStop.shortTitle', 'CKS'),
    overlay: true,
    inputs: [
        intInput('p', msg('indicator.chandeKrollStop.p', 'ATR Length (P)'), 10, 1, 5000, msg('indicator.chandeKrollStop.p.tooltip', 'Lookback used for both the ATR and the highest high / lowest low price extremes.')),
        floatInput('x', msg('indicator.chandeKrollStop.x', 'ATR Multiplier (X)'), 1, 0, 50, 0.1, msg('indicator.chandeKrollStop.x.tooltip', 'Multiplier applied to the ATR to offset the preliminary stops from the price extremes.')),
        intInput('q', msg('indicator.chandeKrollStop.q', 'Stop Length (Q)'), 9, 1, 5000, msg('indicator.chandeKrollStop.q.tooltip', 'Lookback over which the preliminary stops are extended into the final stop levels.')),
        colorInput(BEARISH, msg('indicator.chandeKrollStop.shortColor', 'Short Stop'), 'shortColor', msg('indicator.chandeKrollStop.shortColor.tooltip', 'Color of the protective stop line for short positions.')),
        colorInput(BULLISH, msg('indicator.chandeKrollStop.longColor', 'Long Stop'), 'longColor', msg('indicator.chandeKrollStop.longColor.tooltip', 'Color of the protective stop line for long positions.')),
    ],
    compute: (bars, inputs) => {
        const p = num(inputs, 'p', 10);
        const q = num(inputs, 'q', 9);
        const range = map(atr(bars, p), (v) => v * num(inputs, 'x', 1));
        const firstHigh = zip(highest(highs(bars), p), range, (h, r) => h - r);
        const firstLow = zip(lowest(lows(bars), p), range, (l, r) => l + r);
        return {
            plots: [
                { key: 'stopShort', title: 'Stop Short', displayTitle: msg('indicator.chandeKrollStop.plot.stopShort', 'Short Stop'), values: highest(firstHigh, q), color: str(inputs, 'shortColor', BEARISH) },
                { key: 'stopLong', title: 'Stop Long', displayTitle: msg('indicator.chandeKrollStop.plot.stopLong', 'Long Stop'), values: lowest(firstLow, q), color: str(inputs, 'longColor', BULLISH) },
            ],
        };
    },
};

const supertrend: ClassicIndicatorSpec = {
    type: 'supertrend',
    title: msg('indicator.supertrend.title', 'SuperTrend'),
    shortTitle: msg('indicator.supertrend.shortTitle', 'SuperTrend'),
    overlay: true,
    inputs: [
        intInput('atrLength', msg('indicator.supertrend.atrLength', 'ATR Length'), 10, 1, 5000, msg('indicator.supertrend.atrLength.tooltip', 'Number of bars used to compute the Wilder ATR.')),
        floatInput('mult', msg('indicator.supertrend.mult', 'Factor'), 3, 0, 50, 0.1, msg('indicator.supertrend.mult.tooltip', 'ATR multiplier setting how far the trailing stop sits from the bar midpoint.')),
        colorInput(BULLISH, msg('indicator.supertrend.upColor', 'Uptrend Color'), 'upColor', msg('indicator.supertrend.upColor.tooltip', 'Line color while the trend is up.')),
        colorInput(BEARISH, msg('indicator.supertrend.downColor', 'Downtrend Color'), 'downColor', msg('indicator.supertrend.downColor.tooltip', 'Line color while the trend is down.')),
    ],
    compute: (bars, inputs) => {
        const mult = num(inputs, 'mult', 3);
        const range = atr(bars, num(inputs, 'atrLength', 10));
        const n = bars.length;
        const up = new Array<number>(n).fill(Number.NaN);
        const down = new Array<number>(n).fill(Number.NaN);
        let finalUpper = Number.NaN;
        let finalLower = Number.NaN;
        let trend = -1;
        for (let i = 0; i < n; i++) {
            const r = range[i]!;
            if (!Number.isFinite(r)) continue;
            const b = bars[i]!;
            const mid = (b.high + b.low) / 2;
            const basicUpper = mid + mult * r;
            const basicLower = mid - mult * r;
            const prevUpper = Number.isFinite(finalUpper) ? finalUpper : basicUpper;
            const prevLower = Number.isFinite(finalLower) ? finalLower : basicLower;
            const prevClose = i > 0 ? bars[i - 1]!.close : b.close;
            // Bands only ratchet while the prior close holds inside them; otherwise they reset.
            finalUpper = prevClose <= prevUpper ? Math.min(basicUpper, prevUpper) : basicUpper;
            finalLower = prevClose >= prevLower ? Math.max(basicLower, prevLower) : basicLower;
            trend = b.close > finalUpper ? 1 : b.close < finalLower ? -1 : trend;
            if (trend === 1) up[i] = finalLower;
            else down[i] = finalUpper;
        }
        return {
            plots: [
                { key: 'up', title: msg('indicator.supertrend.plot.up', 'Uptrend'), values: up, color: str(inputs, 'upColor', BULLISH) },
                { key: 'down', title: msg('indicator.supertrend.plot.down', 'Downtrend'), values: down, color: str(inputs, 'downColor', BEARISH) },
            ],
        };
    },
};

const alligator: ClassicIndicatorSpec = {
    type: 'williams-alligator',
    title: msg('indicator.williamsAlligator.title', 'Williams Alligator'),
    shortTitle: msg('indicator.williamsAlligator.shortTitle', 'Alligator'),
    overlay: true,
    inputs: [
        intInput('jawLength', msg('indicator.williamsAlligator.jawLength', 'Jaw Length'), 13, 1, 5000, msg('indicator.williamsAlligator.jawLength.tooltip', 'Smoothing length of the Jaw SMMA of median price (hl2), 13 in the classic setup.')),
        intInput('teethLength', msg('indicator.williamsAlligator.teethLength', 'Teeth Length'), 8, 1, 5000, msg('indicator.williamsAlligator.teethLength.tooltip', 'Smoothing length of the Teeth SMMA of median price (hl2), 8 in the classic setup.')),
        intInput('lipsLength', msg('indicator.williamsAlligator.lipsLength', 'Lips Length'), 5, 1, 5000, msg('indicator.williamsAlligator.lipsLength.tooltip', 'Smoothing length of the Lips SMMA of median price (hl2), 5 in the classic setup.')),
        intInput('jawOffset', msg('indicator.williamsAlligator.jawOffset', 'Jaw Offset'), 8, 0, 100, msg('indicator.williamsAlligator.jawOffset.tooltip', 'Number of bars the Jaw plot is shifted into the future, 8 in the classic setup.')),
        intInput('teethOffset', msg('indicator.williamsAlligator.teethOffset', 'Teeth Offset'), 5, 0, 100, msg('indicator.williamsAlligator.teethOffset.tooltip', 'Number of bars the Teeth plot is shifted into the future, 5 in the classic setup.')),
        intInput('lipsOffset', msg('indicator.williamsAlligator.lipsOffset', 'Lips Offset'), 3, 0, 100, msg('indicator.williamsAlligator.lipsOffset.tooltip', 'Number of bars the Lips plot is shifted into the future, 3 in the classic setup.')),
        colorInput(JAW_COLOR, msg('indicator.williamsAlligator.jawColor', 'Jaw'), 'jawColor', msg('indicator.williamsAlligator.jawColor.tooltip', 'Color of the Jaw line.')),
        colorInput(TEETH_COLOR, msg('indicator.williamsAlligator.teethColor', 'Teeth'), 'teethColor', msg('indicator.williamsAlligator.teethColor.tooltip', 'Color of the Teeth line.')),
        colorInput(LIPS_COLOR, msg('indicator.williamsAlligator.lipsColor', 'Lips'), 'lipsColor', msg('indicator.williamsAlligator.lipsColor.tooltip', 'Color of the Lips line.')),
    ],
    compute: (bars, inputs) => {
        const hl2 = sourceValues(bars, 'HL2');
        // Offsets plot each balance line within the available bars (no future timestamps to plot onto).
        const jaw = shift(rma(hl2, num(inputs, 'jawLength', 13)), num(inputs, 'jawOffset', 8));
        const teeth = shift(rma(hl2, num(inputs, 'teethLength', 8)), num(inputs, 'teethOffset', 5));
        const lips = shift(rma(hl2, num(inputs, 'lipsLength', 5)), num(inputs, 'lipsOffset', 3));
        return {
            plots: [
                { key: 'jaw', title: msg('indicator.williamsAlligator.plot.jaw', 'Jaw'), values: jaw, color: str(inputs, 'jawColor', JAW_COLOR) },
                { key: 'teeth', title: msg('indicator.williamsAlligator.plot.teeth', 'Teeth'), values: teeth, color: str(inputs, 'teethColor', TEETH_COLOR) },
                { key: 'lips', title: msg('indicator.williamsAlligator.plot.lips', 'Lips'), values: lips, color: str(inputs, 'lipsColor', LIPS_COLOR) },
            ],
        };
    },
};

const GATOR_LINES = 'Alligator Lines';
const SMMA_TYPE = 'SMMA (Wilder)';

const gator: ClassicIndicatorSpec = {
    type: 'gator-oscillator',
    title: msg('indicator.gatorOscillator.title', 'Gator Oscillator'),
    shortTitle: msg('indicator.gatorOscillator.shortTitle', 'Gator Oscillator'),
    overlay: false,
    inputs: [
        { ...sourceInput('HL2', 'source', msg('indicator.gatorOscillator.source', 'Source'), msg('indicator.gatorOscillator.source.tooltip', "Price series fed to the three Alligator averages. Bill Williams' original recipe uses the median price (high + low) / 2.")), group: GATOR_LINES },
        { ...optionInput('maType', msg('indicator.gatorOscillator.maType', 'Smoothing'), SMMA_TYPE, [SMMA_TYPE, 'SMA', 'EMA'], msg('indicator.gatorOscillator.maType.tooltip', 'Moving average applied to the source for the jaw, teeth and lips. The original uses the smoothed (Wilder-style) moving average.')), group: GATOR_LINES },
        { ...intInput('jawLength', msg('indicator.gatorOscillator.jawLength', 'Jaw Length'), 13, 1, 500, msg('indicator.gatorOscillator.jawLength.tooltip', 'Averaging length of the jaw line.')), group: GATOR_LINES },
        { ...intInput('jawOffset', msg('indicator.gatorOscillator.jawOffset', 'Jaw Offset'), 8, 0, 100, msg('indicator.gatorOscillator.jawOffset.tooltip', 'Bars the jaw is displaced forward, 8 in the original recipe. The upper histogram measures the absolute spread between the displaced jaw and teeth.')), group: GATOR_LINES },
        { ...intInput('teethLength', msg('indicator.gatorOscillator.teethLength', 'Teeth Length'), 8, 1, 500, msg('indicator.gatorOscillator.teethLength.tooltip', 'Averaging length of the teeth line.')), group: GATOR_LINES },
        { ...intInput('teethOffset', msg('indicator.gatorOscillator.teethOffset', 'Teeth Offset'), 5, 0, 100, msg('indicator.gatorOscillator.teethOffset.tooltip', 'Bars the teeth are displaced forward, 5 in the original recipe. The teeth line enters both spreads.')), group: GATOR_LINES },
        { ...intInput('lipsLength', msg('indicator.gatorOscillator.lipsLength', 'Lips Length'), 5, 1, 500, msg('indicator.gatorOscillator.lipsLength.tooltip', 'Averaging length of the lips line.')), group: GATOR_LINES },
        { ...intInput('lipsOffset', msg('indicator.gatorOscillator.lipsOffset', 'Lips Offset'), 3, 0, 100, msg('indicator.gatorOscillator.lipsOffset.tooltip', 'Bars the lips are displaced forward, 3 in the original recipe. The lower histogram measures the negative absolute spread between the displaced teeth and lips.')), group: GATOR_LINES },
        colorInput(BULLISH, msg('indicator.gatorOscillator.growColor', 'Expanding'), 'growColor', msg('indicator.gatorOscillator.growColor.tooltip', 'Column color while a spread grew against its own previous bar — the averages are spreading apart.')),
        colorInput(BEARISH, msg('indicator.gatorOscillator.shrinkColor', 'Contracting'), 'shrinkColor', msg('indicator.gatorOscillator.shrinkColor.tooltip', 'Column color while a spread shrank — the averages are converging. Color encodes expansion, not trade direction.')),
        colorInput(NEUTRAL, msg('indicator.gatorOscillator.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.gatorOscillator.zeroColor.tooltip', 'Color of the zero line separating the two histograms.')),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'HL2'));
        const kind = str(inputs, 'maType', SMMA_TYPE);
        const smooth = (len: number): number[] => (kind === 'SMA' ? sma(src, len) : kind === 'EMA' ? ema(src, len) : rma(src, len));
        const jaw = shift(smooth(num(inputs, 'jawLength', 13)), num(inputs, 'jawOffset', 8));
        const teeth = shift(smooth(num(inputs, 'teethLength', 8)), num(inputs, 'teethOffset', 5));
        const lips = shift(smooth(num(inputs, 'lipsLength', 5)), num(inputs, 'lipsOffset', 3));
        const upper = map(sub(jaw, teeth), Math.abs);
        const lower = map(sub(teeth, lips), Math.abs);
        const grow = str(inputs, 'growColor', BULLISH);
        const shrink = str(inputs, 'shrinkColor', BEARISH);
        // Each side is graded against its own previous bar; an exact tie keeps the state.
        const expansionColors = (v: readonly number[]): Array<string | null> => {
            let growing = false;
            return v.map((x, i) => {
                if (!Number.isFinite(x)) return null;
                const prev = i > 0 ? v[i - 1]! : Number.NaN;
                if (Number.isFinite(prev)) growing = x > prev ? true : x < prev ? false : growing;
                return growing ? grow : shrink;
            });
        };
        return {
            plots: [
                { key: 'upper', title: 'Upper Histogram (Jaw - Teeth)', displayTitle: msg('indicator.gatorOscillator.plot.upper', 'Upper Histogram (Jaw − Teeth)'), values: upper, kind: 'columns', color: grow, colors: expansionColors(upper), base: 0 },
                { key: 'lower', title: 'Lower Histogram (Teeth - Lips)', displayTitle: msg('indicator.gatorOscillator.plot.lower', 'Lower Histogram (Teeth − Lips)'), values: map(lower, (x) => -x), kind: 'columns', color: shrink, colors: expansionColors(lower), base: 0 },
            ],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'solid', title: msg('indicator.gatorOscillator.level.zero', 'Zero Line') }],
        };
    },
};

export const bandSpecs: ClassicIndicatorSpec[] = [bollingerBands, percentB, bandwidth, keltner, donchian, movingAverageChannel, standardErrorBands, volatilityIndex, chandelier, chandeKroll, supertrend, alligator, gator];
