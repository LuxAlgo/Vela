import type { InputSchema, InputValue } from '../../model/inputs';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicBand, ClassicIndicatorSpec, ClassicLevel, ClassicOutput, ClassicPlot } from './define';
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
    atr,
    zip,
    map,
    sub,
    shift,
} from './math';

/** Momentum oscillators — study-pane classics driven by a price source. */

/** Overbought / oversold thresholds, as every bounded oscillator declares them. */
function thresholdInputs(obDefault: number, osDefault: number, min = 0, max = 100, obTitle = 'Overbought Level', osTitle = 'Oversold Level'): InputSchema[] {
    return [
        floatInput('overbought', obTitle, obDefault, min, max, 1, 'Level above which the oscillator is considered overbought.'),
        floatInput('oversold', osTitle, osDefault, min, max, 1, 'Level below which the oscillator is considered oversold.'),
    ];
}

const rsiSpec: ClassicIndicatorSpec = {
    type: 'rsi',
    title: 'Relative Strength Index',
    shortTitle: 'RSI',
    overlay: false,
    inputs: [
        lengthInput(14, 'length', 'Length', 5000, 'Number of bars used in the Wilder smoothing of average gains and losses.'),
        sourceInput('Close', 'source', 'Source', 'Price series the RSI is calculated on.'),
        ...thresholdInputs(70, 30, 0, 100, 'Overbought', 'Oversold'),
        colorInput(NEUTRAL, 'RSI', 'color', 'Color of the RSI line at the midline. Toward either threshold it blends into that threshold’s color.'),
        colorInput(BULLISH, 'Oversold', 'oversoldColor', 'Color of the line and zone shading at and below the oversold level.'),
        colorInput(BEARISH, 'Overbought', 'overboughtColor', 'Color of the line and zone shading at and above the overbought level.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Color of the overbought, midline and oversold levels.'),
        colorInput(transp(NEUTRAL, 90), 'Band Fill', 'fillColor', 'Color of the fill between the overbought and oversold levels.'),
    ],
    compute: (bars, inputs) =>
        boundedOscillator({
            key: 'rsi',
            title: 'RSI',
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
            { key: 'k', title: '%K', values: k, color: str(inputs, 'kColor', INFO) },
            { key: 'd', title: '%D', values: d, color: str(inputs, 'dColor', WARNING) },
            anchorPlot('obAnchor', 'Overbought Anchor', k.length, overbought),
            anchorPlot('osAnchor', 'Oversold Anchor', k.length, oversold),
        ],
        bands: [{ key: 'band', from: 'obAnchor', to: 'osAnchor', color: str(inputs, 'fillColor', transp(INFO, 90)) }],
        levels: [
            { key: 'overbought', price: overbought, color: NEUTRAL, lineStyle: 'dashed', title: 'Overbought' },
            { key: 'oversold', price: oversold, color: NEUTRAL, lineStyle: 'dashed', title: 'Oversold' },
        ],
    };
}

const stochastic: ClassicIndicatorSpec = {
    type: 'stochastic',
    title: 'Stochastic',
    shortTitle: 'Stoch',
    overlay: false,
    inputs: [
        lengthInput(14, 'kLength', '%K Length', 5000, 'Number of bars used for the highest high / lowest low range of the raw %K.'),
        lengthInput(3, 'kSmoothing', '%K Smoothing', 500, 'Simple moving average length applied to the raw %K. 1 gives the fast stochastic, 3 the classic slow stochastic.'),
        lengthInput(3, 'dLength', '%D Smoothing', 500, 'Simple moving average length of the %D signal line, applied to the smoothed %K.'),
        ...thresholdInputs(80, 20),
        colorInput(INFO, '%K', 'kColor', 'Color of the %K line.'),
        colorInput(WARNING, '%D', 'dColor', 'Color of the %D signal line.'),
        colorInput(transp(INFO, 90), 'Band Fill', 'fillColor', 'Fill color of the area between the overbought and oversold levels.'),
    ],
    compute: (bars, inputs) => {
        const k = sma(stoch(closes(bars), highs(bars), lows(bars), num(inputs, 'kLength', 14)), num(inputs, 'kSmoothing', 3));
        return stochasticOutput(k, sma(k, num(inputs, 'dLength', 3)), inputs);
    },
};

const stochasticRsi: ClassicIndicatorSpec = {
    type: 'stochastic-rsi',
    title: 'Stochastic RSI',
    shortTitle: 'Stoch RSI',
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', 'RSI Source', 'Price series the RSI is computed on.'),
        lengthInput(14, 'rsiLength', 'RSI Length', 5000, 'Lookback length of the Wilder RSI.'),
        lengthInput(14, 'stochLength', 'Stochastic Length', 5000, 'Lookback over which the highest and lowest RSI values are taken.'),
        lengthInput(3, 'kSmoothing', '%K Smoothing', 500, 'Simple moving average length applied to the stochastic of RSI to form %K.'),
        lengthInput(3, 'dLength', '%D Smoothing', 500, 'Simple moving average length applied to %K to form the %D signal line.'),
        ...thresholdInputs(80, 20),
        colorInput(INFO, '%K Color', 'kColor', 'Color of the %K line.'),
        colorInput(WARNING, '%D Color', 'dColor', 'Color of the %D signal line.'),
        colorInput(transp(INFO, 90), 'Zone Fill', 'fillColor', 'Fill color of the area between the overbought and oversold levels.'),
    ],
    compute: (bars, inputs) => {
        const r = rsi(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'rsiLength', 14));
        const k = sma(stoch(r, r, r, num(inputs, 'stochLength', 14)), num(inputs, 'kSmoothing', 3));
        return stochasticOutput(k, sma(k, num(inputs, 'dLength', 3)), inputs);
    },
};

const macd: ClassicIndicatorSpec = {
    type: 'macd',
    title: 'MACD',
    overlay: false,
    inputs: [
        lengthInput(12, 'fastLength', 'Fast Length', 5000, 'Length of the fast EMA.'),
        lengthInput(26, 'slowLength', 'Slow Length', 5000, 'Length of the slow EMA.'),
        lengthInput(9, 'signalLength', 'Signal Smoothing', 500, 'Length of the EMA applied to the MACD line to obtain the signal line.'),
        sourceInput('Close', 'source', 'Source', 'Price series used to compute the fast and slow EMAs.'),
        colorInput(INFO, 'MACD Line', 'color', 'Color of the MACD line.'),
        colorInput(WARNING, 'Signal Line', 'signalColor', 'Color of the signal line.'),
        colorInput(BULLISH, 'Grow Above', 'growAboveColor', 'Histogram color when above zero and rising.'),
        colorInput(transp(BULLISH, 50), 'Fall Above', 'fallAboveColor', 'Histogram color when above zero and falling.'),
        colorInput(transp(BEARISH, 50), 'Grow Below', 'growBelowColor', 'Histogram color when below zero and rising.'),
        colorInput(BEARISH, 'Fall Below', 'fallBelowColor', 'Histogram color when below zero and falling.'),
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
                { key: 'hist', title: 'Histogram', values: hist, kind: 'columns', color: BULLISH, colors, base: 0 },
                { key: 'macd', title: 'MACD', values: line, color: str(inputs, 'color', INFO) },
                { key: 'signal', title: 'Signal', values: signal, color: str(inputs, 'signalColor', WARNING) },
            ],
            levels: [{ key: 'zero', price: 0, color: NEUTRAL, lineStyle: 'dashed', title: 'Zero Line' }],
        };
    },
};

const ppo: ClassicIndicatorSpec = {
    type: 'ppo',
    title: 'Percentage Price Oscillator',
    shortTitle: 'PPO',
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', 'Source', 'Price series fed into the fast and slow averages.'),
        lengthInput(12, 'fastLength', 'Fast Length', 5000, 'Length of the fast moving average.'),
        lengthInput(26, 'slowLength', 'Slow Length', 5000, 'Length of the slow moving average. The spread is divided by it and scaled to a percentage of price.'),
        optionInput('maType', 'Average Type', 'EMA', ['EMA', 'SMA'], 'Moving average type used for the fast and slow averages.'),
        lengthInput(9, 'signalLength', 'Signal Smoothing', 500, 'Length of the signal line that smooths the PPO line.'),
        optionInput('signalType', 'Signal Type', 'EMA', ['EMA', 'SMA'], 'Moving average type used for the signal line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the PPO line, gradient fill and histogram above the zero line.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the PPO line, gradient fill and histogram below the zero line.'),
        colorInput(WARNING, 'Signal Line', 'signalColor', 'Color of the signal line.'),
        boolInput('showHistogram', 'Show Histogram', true, STYLE, 'Displays the histogram (PPO minus signal line) as columns. Bright columns mark a spread still widening, faded ones a spread narrowing back.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the area between the zero line and the PPO line with a vertical gradient.'),
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
            title: 'PPO Line',
            values: line,
            ink: { bull, bear, neutral: bear },
            zeroInk: transp(NEUTRAL, 90),
            fill: bool(inputs, 'gradientFill', true),
            extraPlots: [{ key: 'signal', title: 'Signal Line', values: signal, color: str(inputs, 'signalColor', WARNING) }],
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
            out.plots.unshift({ key: 'hist', title: 'Histogram', values: hist, kind: 'columns', color: bull, colors, base: 0 });
        }
        return out;
    },
};

const awesome: ClassicIndicatorSpec = {
    type: 'awesome-oscillator',
    title: 'Awesome Oscillator',
    shortTitle: 'AO',
    overlay: false,
    inputs: [
        colorInput(BULLISH, 'Rising', 'risingColor', 'Histogram color when the oscillator is higher than on the previous bar.'),
        colorInput(BEARISH, 'Falling', 'fallingColor', 'Histogram color when the oscillator is lower than or equal to the previous bar.'),
        colorInput(NEUTRAL, 'Zero Line', 'zeroColor', 'Color of the zero reference line.'),
    ],
    compute: (bars, inputs) => {
        const hl2 = sourceValues(bars, 'HL2');
        const ao = sub(sma(hl2, 5), sma(hl2, 34));
        const rising = str(inputs, 'risingColor', BULLISH);
        const falling = str(inputs, 'fallingColor', BEARISH);
        const colors = ao.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            const prev = i > 0 ? ao[i - 1]! : Number.NaN;
            return Number.isFinite(prev) && x > prev ? rising : falling;
        });
        return {
            plots: [{ key: 'ao', title: 'AO', values: ao, kind: 'columns', color: rising, colors, base: 0 }],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'dashed', title: 'Zero Line' }],
        };
    },
};

/** Lambert's scaling constant. */
const CCI_SCALING = 0.015;

const cci: ClassicIndicatorSpec = {
    type: 'commodity-channel-index',
    title: 'Commodity Channel Index',
    shortTitle: 'CCI',
    overlay: false,
    inputs: [
        lengthInput(20, 'length', 'Length', 5000, 'Number of bars used for the moving average and the mean absolute deviation of the source.'),
        sourceInput('HLC3', 'source', 'Source', 'Price series measured by the CCI; the typical price hlc3 is the classic choice.'),
        floatInput('upper', 'Upper Level', 100, -1000, 1000, 10, 'Overbought reference level, +100 classically.'),
        floatInput('lower', 'Lower Level', -100, -1000, 1000, 10, 'Oversold reference level, −100 classically.'),
        colorInput(NEUTRAL, 'CCI Line', 'color', 'Color of the CCI line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while the CCI reads above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while the CCI reads below zero.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Color of the upper, lower and zero reference lines.'),
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
            title: 'CCI',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: levelInk,
            zeroLineStyle: 'dotted',
            extraLevels: [
                { key: 'upper', price: num(inputs, 'upper', 100), color: levelInk, lineStyle: 'dashed', title: 'Upper Level' },
                { key: 'lower', price: num(inputs, 'lower', -100), color: levelInk, lineStyle: 'dashed', title: 'Lower Level' },
            ],
        });
    },
};

const williamsR: ClassicIndicatorSpec = {
    type: 'williams-percent-r',
    title: 'Williams %R',
    shortTitle: '%R',
    overlay: false,
    inputs: [
        lengthInput(14, 'length', 'Length', 5000, 'Lookback length of the highest high / lowest low range. 14 is the classic setting.'),
        sourceInput('Close', 'source', 'Source', 'Series located within the lookback range. Close is the classic choice.'),
        ...thresholdInputs(-20, -80, -100, 0),
        colorInput(NEUTRAL, '%R Line', 'color', 'Color of the %R line between the thresholds. Toward either level it blends into that level’s color.'),
        colorInput(BEARISH, 'Overbought', 'overboughtColor', 'Color of the line and zone shading at and above the overbought level.'),
        colorInput(BULLISH, 'Oversold', 'oversoldColor', 'Color of the line and zone shading at and below the oversold level.'),
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
            title: '%R',
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
    title: 'Chande Momentum Oscillator',
    shortTitle: 'CMO',
    overlay: false,
    inputs: [
        lengthInput(9, 'length', 'Length', 5000, 'Number of bars over which up moves and down moves are summed.'),
        sourceInput('Close', 'source', 'Source', 'Price series used to measure bar-to-bar changes.'),
        floatInput('overbought', 'Overbought Level', 50, 0, 100, 1, 'Level above which the oscillator is considered overbought.'),
        floatInput('oversold', 'Oversold Level', -50, -100, 0, 1, 'Level below which the oscillator is considered oversold.'),
        colorInput(NEUTRAL, 'CMO Line', 'color', 'Color of the CMO line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while momentum is positive, and shading of the oversold zone.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while momentum is negative, and shading of the overbought zone.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Color of the overbought, oversold, and zero lines.'),
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
            title: 'CMO',
            values,
            ink: { bull, bear, neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: levelInk,
            zeroLineStyle: 'dotted',
            extraLevels: [
                { key: 'overbought', price: overbought, color: levelInk, lineStyle: 'dashed', title: 'Overbought' },
                { key: 'oversold', price: oversold, color: levelInk, lineStyle: 'dashed', title: 'Oversold' },
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
    title: 'Connors RSI',
    shortTitle: 'CRSI',
    overlay: false,
    inputs: [
        lengthInput(3, 'rsiLength', 'RSI Length', 5000, 'Length of the Wilder RSI applied to the closing price.'),
        lengthInput(2, 'streakLength', 'Streak RSI Length', 5000, 'Length of the Wilder RSI applied to the up/down close streak.'),
        lengthInput(100, 'rankLength', 'Percent Rank Length', 5000, 'Lookback of the percent rank applied to the 1-bar rate of change of the closing price.'),
        ...thresholdInputs(90, 10),
        colorInput(NEUTRAL, 'CRSI Line', 'color', 'Color of the Connors RSI line.'),
        colorInput(BULLISH, 'Oversold', 'oversoldColor', 'Line, fill and zone color toward and below the oversold level.'),
        colorInput(BEARISH, 'Overbought', 'overboughtColor', 'Line, fill and zone color toward and above the overbought level.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Color of the overbought and oversold levels.'),
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
            title: 'Connors RSI',
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
    title: 'Fisher Transform',
    shortTitle: 'Fisher',
    overlay: false,
    inputs: [
        lengthInput(9, 'length', 'Length', 5000, "Lookback period used to locate the median price hl2 within its highest-lowest range. Ehlers' original length is 10; 9 is the common platform default."),
        colorInput(NEUTRAL, 'Fisher Line', 'color', 'Color of the Fisher line when it sits exactly on its trigger.'),
        colorInput(NEUTRAL, 'Trigger Line', 'triggerColor', 'Color of the trigger line, the Fisher value delayed one bar.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the Fisher line and fill while it is above the trigger.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the Fisher line and fill while it is below the trigger.'),
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
                { key: 'fisher', title: 'Fisher', values: out, color: neutral, width: 2, colors: out.map((x, i) => (Number.isFinite(x) ? inkOf(i) : null)) },
                { key: 'trigger', title: 'Trigger', values: trigger, color: str(inputs, 'triggerColor', NEUTRAL) },
            ],
            bands: [{ key: 'spread', from: 'fisher', to: 'trigger', color: transp(neutral, 80), colors: out.map((x, i) => (Number.isFinite(x) ? transp(inkOf(i), 80) : null)) }],
            levels: [
                { key: 'upper', price: 1.5, color: NEUTRAL, lineStyle: 'dashed', title: 'Upper Level' },
                { key: 'lower', price: -1.5, color: NEUTRAL, lineStyle: 'dashed', title: 'Lower Level' },
                { key: 'zero', price: 0, color: NEUTRAL, lineStyle: 'dotted', title: 'Zero Line' },
            ],
        };
    },
};

const trix: ClassicIndicatorSpec = {
    type: 'trix',
    title: 'TRIX',
    overlay: false,
    inputs: [
        lengthInput(18, 'length', 'Length', 5000, 'Length of each of the three EMA smoothing passes applied to the close price.'),
        lengthInput(9, 'signalLength', 'Signal Length', 500, 'Length of the EMA applied to TRIX to form the signal line.'),
        colorInput(NEUTRAL, 'TRIX Color', 'color', 'Color of the TRIX line.'),
        colorInput(WARNING, 'Signal Color', 'signalColor', 'Color of the signal line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the TRIX line and its gradient fill while TRIX holds above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the TRIX line and its gradient fill while TRIX holds below zero.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 18);
        const smooth = ema(ema(ema(closes(bars), len), len), len);
        const values = roc(smooth, 1);
        return centeredOscillator({
            key: 'trix',
            title: 'TRIX',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            extraPlots: [{ key: 'signal', title: 'Signal', values: ema(values, num(inputs, 'signalLength', 9)), color: str(inputs, 'signalColor', WARNING) }],
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
    title: 'True Strength Index',
    shortTitle: 'TSI',
    overlay: false,
    inputs: [
        lengthInput(25, 'longLength', 'Long Length', 5000, 'Length of the first (long) EMA applied to the 1-bar price change.'),
        lengthInput(13, 'shortLength', 'Short Length', 5000, 'Length of the second (short) EMA applied to the long-smoothed price change.'),
        lengthInput(13, 'signalLength', 'Signal Length', 500, 'Length of the EMA of TSI used as the signal line.'),
        colorInput(NEUTRAL, 'TSI', 'color', 'Color of the TSI line.'),
        colorInput(WARNING, 'Signal', 'signalColor', 'Color of the signal line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the TSI line and its gradient fill while TSI holds above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the TSI line and its gradient fill while TSI holds below zero.'),
    ],
    compute: (bars, inputs) => {
        const values = map(tsiRatio(closes(bars), num(inputs, 'longLength', 25), num(inputs, 'shortLength', 13)), (x) => 100 * x);
        return centeredOscillator({
            key: 'tsi',
            title: 'TSI',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            extraPlots: [{ key: 'signal', title: 'Signal', values: ema(values, num(inputs, 'signalLength', 13)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const SMI_INDICATOR = 'Indicator';
const SMI_OSCILLATOR = 'Oscillator';

const smiErgodic: ClassicIndicatorSpec = {
    type: 'smi-ergodic',
    title: 'SMI Ergodic Oscillator',
    shortTitle: 'SMIE',
    overlay: false,
    inputs: [
        lengthInput(20, 'longLength', 'Long Length', 5000, 'Length of the first EMA smoothing applied to the momentum of the closing price.'),
        lengthInput(5, 'shortLength', 'Short Length', 5000, 'Length of the second EMA smoothing applied to the momentum of the closing price.'),
        lengthInput(5, 'signalLength', 'Signal Length', 500, 'Length of the EMA of the SMI that forms the signal line.'),
        optionInput('display', 'Display', SMI_INDICATOR, [SMI_INDICATOR, SMI_OSCILLATOR], 'Indicator plots the SMI and its signal line. Oscillator plots the difference between them as a histogram.'),
        colorInput(NEUTRAL, 'SMI', 'color', 'Color of the SMI line while it sits exactly on its signal line.'),
        colorInput(WARNING, 'Signal', 'signalColor', 'Color of the signal line.'),
        colorInput(BULLISH, 'Oscillator Grow', 'growColor', 'Color of the rising oscillator histogram, and of the SMI line while it leads its signal.'),
        colorInput(BEARISH, 'Oscillator Fall', 'fallColor', 'Color of the falling oscillator histogram, and of the SMI line while it lags its signal.'),
    ],
    compute: (bars, inputs) => {
        const smi = tsiRatio(closes(bars), num(inputs, 'longLength', 20), num(inputs, 'shortLength', 5));
        const signal = ema(smi, num(inputs, 'signalLength', 5));
        const grow = str(inputs, 'growColor', BULLISH);
        const fall = str(inputs, 'fallColor', BEARISH);
        const zero: ClassicLevel[] = [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed', title: 'Zero' }];
        if (str(inputs, 'display', SMI_INDICATOR) === SMI_OSCILLATOR) {
            const osc = sub(smi, signal);
            const colors = osc.map((x, i) => {
                if (!Number.isFinite(x)) return null;
                const prev = i > 0 && Number.isFinite(osc[i - 1]!) ? osc[i - 1]! : x;
                return x > prev ? grow : fall;
            });
            return { plots: [{ key: 'osc', title: 'Oscillator', values: osc, kind: 'columns', color: grow, colors, base: 0 }], levels: zero };
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
                { key: 'smi', title: 'SMI', values: smi, color: neutral, colors: smi.map((x, i) => (Number.isFinite(x) ? inkOf(i) : null)) },
                { key: 'signal', title: 'Signal', values: signal, color: str(inputs, 'signalColor', WARNING) },
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
    title: 'Schaff Trend Cycle',
    shortTitle: 'Schaff Trend Cycle',
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', 'Source', 'Price series used to build the MACD that the trend cycle is measured on.'),
        lengthInput(23, 'fastLength', 'Fast Length', 5000, 'Fast EMA length of the underlying MACD.'),
        lengthInput(50, 'slowLength', 'Slow Length', 5000, 'Slow EMA length of the underlying MACD.'),
        { ...lengthInput(10, 'cycleLength', 'Cycle Length', 5000, 'Window of the two stochastic passes. Each pass measures where its input sits inside the range of its own values over this many bars.'), min: 2 },
        floatInput('factor', 'Smoothing Factor', 0.5, 0.01, 1, 0.05, '%D style recursive smoothing applied after each stochastic pass. 0.5 is the published default.'),
        { ...floatInput('upper', 'Upper Trigger', 75, 0, 100, 1, 'Upper trigger line. A cross down through it flags an emerging downtrend.'), group: TRIGGERS },
        { ...floatInput('lower', 'Lower Trigger', 25, 0, 100, 1, 'Lower trigger line. A cross up through it flags an emerging uptrend.'), group: TRIGGERS },
        colorInput(BULLISH, 'Bullish Color', 'bullColor', 'Color of the trend cycle line and gradient while the cycle holds the upper half of its 0-100 scale.'),
        colorInput(BEARISH, 'Bearish Color', 'bearColor', 'Color of the trend cycle line and gradient while the cycle holds the lower half of its 0-100 scale.'),
        colorInput(NEUTRAL, 'Levels Color', 'levelsColor', 'Color of the dashed trigger lines and the dotted midline.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Vertical gradient between the midline and the trend cycle, fading out toward the midline.'),
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
            { key: 'stc', title: 'Schaff Trend Cycle', values, color: bear, width: 2, colors: values.map((x) => (Number.isFinite(x) ? (x > STC_MID ? bull : bear) : null)) },
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
                { key: 'upper', price: num(inputs, 'upper', 75), color: transp(levelInk, 25), lineStyle: 'dashed', title: 'Upper Trigger' },
                { key: 'lower', price: num(inputs, 'lower', 25), color: transp(levelInk, 25), lineStyle: 'dashed', title: 'Lower Trigger' },
                { key: 'midline', price: STC_MID, color: transp(levelInk, 60), lineStyle: 'dotted', title: 'Midline' },
            ],
        };
    },
};

const kst: ClassicIndicatorSpec = {
    type: 'know-sure-thing',
    title: 'Know Sure Thing',
    shortTitle: 'KST',
    overlay: false,
    inputs: [
        lengthInput(10, 'rocLength1', 'ROC Length #1', 5000, 'Lookback of the first (shortest) rate of change.'),
        lengthInput(15, 'rocLength2', 'ROC Length #2', 5000, 'Lookback of the second rate of change.'),
        lengthInput(20, 'rocLength3', 'ROC Length #3', 5000, 'Lookback of the third rate of change.'),
        lengthInput(30, 'rocLength4', 'ROC Length #4', 5000, 'Lookback of the fourth (longest) rate of change.'),
        lengthInput(10, 'smaLength1', 'SMA Length #1', 5000, 'Smoothing length applied to the first rate of change (RCMA #1).'),
        lengthInput(10, 'smaLength2', 'SMA Length #2', 5000, 'Smoothing length applied to the second rate of change (RCMA #2).'),
        lengthInput(10, 'smaLength3', 'SMA Length #3', 5000, 'Smoothing length applied to the third rate of change (RCMA #3).'),
        lengthInput(15, 'smaLength4', 'SMA Length #4', 5000, 'Smoothing length applied to the fourth rate of change (RCMA #4).'),
        lengthInput(9, 'signalLength', 'Signal Length', 500, 'Simple moving average length of the signal line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the KST line while above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the KST line while below zero.'),
        colorInput(WARNING, 'Signal', 'signalColor', 'Color of the signal line.'),
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
            title: 'KST',
            values,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: NEUTRAL,
            valueTransparency: 60,
            extraPlots: [{ key: 'signal', title: 'Signal', values: sma(values, num(inputs, 'signalLength', 9)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const coppock: ClassicIndicatorSpec = {
    type: 'coppock-curve',
    title: 'Coppock Curve',
    shortTitle: 'Coppock',
    overlay: false,
    inputs: [
        lengthInput(10, 'wmaLength', 'WMA Length', 5000, 'Length of the weighted moving average applied to the sum of the two rates of change.'),
        lengthInput(14, 'longRoc', 'Long RoC Length', 5000, 'Lookback of the long rate of change, in bars. The original definition uses 14 monthly closes.'),
        lengthInput(11, 'shortRoc', 'Short RoC Length', 5000, 'Lookback of the short rate of change, in bars. The original definition uses 11 monthly closes.'),
        sourceInput('Close', 'source', 'Source', 'Price series used for the rate of change calculations.'),
        colorInput(NEUTRAL, 'Coppock Curve', 'color', 'Color of the Coppock Curve line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while the curve reads above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while the curve reads below zero.'),
        colorInput(NEUTRAL, 'Zero Line', 'zeroColor', 'Color of the zero reference line.'),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = wma(zip(roc(src, num(inputs, 'longRoc', 14)), roc(src, num(inputs, 'shortRoc', 11)), (a, b) => a + b), num(inputs, 'wmaLength', 10));
        return centeredOscillator({
            key: 'coppock',
            title: 'Coppock Curve',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

const dpo: ClassicIndicatorSpec = {
    type: 'detrended-price-oscillator',
    title: 'Detrended Price Oscillator',
    shortTitle: 'DPO',
    overlay: false,
    inputs: [
        lengthInput(21, 'length', 'Length', 5000, 'Lookback of the simple moving average that price is detrended against. The comparison is displaced by Length / 2 + 1 bars.'),
        sourceInput('Close', 'source', 'Source', 'Price series used in the detrending calculation.'),
        boolInput('centered', 'Centered', false, undefined, 'Shifts the oscillator back by Length / 2 + 1 bars so it is centered on the prices it detrends. The most recent bars then show no value.'),
        colorInput(NEUTRAL, 'DPO', 'color', 'Color of the line when it sits exactly at zero.'),
        colorInput(BULLISH, 'Above Zero', 'bullColor', 'Color of the line and fill while the oscillator is above zero.'),
        colorInput(BEARISH, 'Below Zero', 'bearColor', 'Color of the line and fill while the oscillator is below zero.'),
        colorInput(NEUTRAL, 'Zero Line', 'zeroColor', 'Color of the zero reference line.'),
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
            title: 'DPO',
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
    title: 'Rate of Change',
    shortTitle: 'ROC',
    overlay: false,
    inputs: [
        lengthInput(9, 'length', 'Length', 5000, 'Lookback period; the source is compared with its value this many bars ago.'),
        sourceInput('Close', 'source', 'Source', 'Series used as input for the calculation.'),
        optionInput('mode', 'Mode', ROC_PERCENT, [ROC_PERCENT, ROC_MOMENTUM], 'ROC % plots the change as a percentage of the source value from the lookback; Momentum plots the raw difference.'),
        colorInput(NEUTRAL, 'Line', 'color', 'Color of the line when the reading sits exactly at zero.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the line and fill while the reading is above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the line and fill while the reading is below zero.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the area between the line and zero, following the line color.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 9);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = str(inputs, 'mode', ROC_PERCENT) === ROC_MOMENTUM ? change(src, len) : roc(src, len);
        return centeredOscillator({
            key: 'roc',
            title: 'ROC',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

const ultimate: ClassicIndicatorSpec = {
    type: 'ultimate-oscillator',
    title: 'Ultimate Oscillator',
    shortTitle: 'UO',
    overlay: false,
    inputs: [
        lengthInput(7, 'fastLength', 'Fast Length', 5000, 'Bars in the fastest averaging window. Weighted 4 in the final blend, so it dominates the oscillator.'),
        lengthInput(14, 'middleLength', 'Middle Length', 5000, 'Bars in the intermediate averaging window. Weighted 2 in the final blend.'),
        lengthInput(28, 'slowLength', 'Slow Length', 5000, 'Bars in the slowest averaging window. Weighted 1 in the final blend.'),
        ...thresholdInputs(70, 30, 0, 100, 'Overbought', 'Oversold'),
        colorInput(NEUTRAL, 'Oscillator', 'color', 'Color of the line midway between the levels. Toward either level it blends into that level’s color.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Color of the overbought and oversold levels.'),
        colorInput(BULLISH, 'Oversold', 'oversoldColor', 'Color of the line at the oversold level and of the oversold zone shading.'),
        colorInput(BEARISH, 'Overbought', 'overboughtColor', 'Color of the line at the overbought level and of the overbought zone shading.'),
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
            title: 'UO',
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
    title: 'Relative Vigor Index',
    shortTitle: 'RVGI',
    overlay: false,
    inputs: [
        lengthInput(10, 'length', 'Length', 5000, 'Number of bars summed for the smoothed numerator (close − open) and denominator (high − low).'),
        colorInput(BULLISH, 'RVGI', 'color', 'Color of the RVGI line.'),
        colorInput(BEARISH, 'Signal', 'signalColor', 'Color of the signal line.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const co = swma(sub(closes(bars), opens(bars)));
        const hl = swma(sub(highs(bars), lows(bars)));
        const line = zip(sum(co, len), sum(hl, len), (a, b) => (b === 0 ? 0 : a / b));
        return {
            plots: [
                { key: 'rvgi', title: 'RVGI', values: line, color: str(inputs, 'color', BULLISH) },
                { key: 'signal', title: 'Signal', values: swma(line), color: str(inputs, 'signalColor', BEARISH) },
            ],
            levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dashed', title: 'Zero' }],
        };
    },
};

const RVI_EMA = 'EMA';
const RVI_RMA = 'Wilder (RMA)';

const relVolatility: ClassicIndicatorSpec = {
    type: 'relative-volatility-index',
    title: 'Relative Volatility Index',
    shortTitle: 'RVI',
    overlay: false,
    inputs: [
        lengthInput(10, 'stdevLength', 'Stdev Length', 5000, "Number of bars used for the standard deviation of closing prices that serves as each bar's volatility reading."),
        lengthInput(14, 'smoothLength', 'Smoothing Length', 5000, 'Number of bars used to smooth the up and down volatility streams.'),
        optionInput('smoothType', 'Smoothing Type', RVI_EMA, [RVI_EMA, RVI_RMA], "Moving average applied to the volatility streams. EMA is Dorsey's classic calculation; Wilder (RMA) matches platforms that use Wilder smoothing."),
        ...thresholdInputs(80, 20),
        colorInput(NEUTRAL, 'RVI Line', 'color', 'Color of the RVI line at the midline. Toward either threshold it blends into that threshold’s color.'),
        colorInput(BULLISH, 'Up Volatility', 'overboughtColor', 'Color of the line and zone shading at and above the overbought level.'),
        colorInput(BEARISH, 'Down Volatility', 'oversoldColor', 'Color of the line and zone shading at and below the oversold level.'),
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
            title: 'RVI',
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
    title: 'Balance of Power',
    shortTitle: 'BOP',
    overlay: false,
    inputs: [
        boolInput('smoothing', 'Smoothing', false, undefined, 'Smooth the raw Balance of Power with a simple moving average instead of plotting the single-bar value.'),
        lengthInput(14, 'smoothLength', 'Length', 5000, 'Simple moving average length applied when smoothing is enabled.'),
        colorInput(NEUTRAL, 'BOP Color', 'color', 'Color of the line at exactly zero.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while the Balance of Power is above zero — buyers in control of the bar.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while the Balance of Power is below zero — sellers in control of the bar.'),
    ],
    compute: (bars, inputs) => {
        const raw = bars.map((b) => (b.high === b.low ? 0 : (b.close - b.open) / (b.high - b.low)));
        const values = bool(inputs, 'smoothing', false) ? sma(raw, num(inputs, 'smoothLength', 14)) : raw;
        return centeredOscillator({
            key: 'bop',
            title: 'BOP',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            valueTransparency: 60,
        });
    },
};

const elderRay: ClassicIndicatorSpec = {
    type: 'elder-ray',
    title: 'Elder Ray',
    overlay: false,
    inputs: [
        lengthInput(13, 'length', 'EMA Length', 5000, "Number of bars in the exponential moving average of closing prices used as the reference level for Bull Power and Bear Power. Alexander Elder's classic setting is 13."),
        colorInput(BULLISH, 'Bull Power', 'bullColor', 'Color of the Bull Power columns.'),
        colorInput(BEARISH, 'Bear Power', 'bearColor', 'Color of the Bear Power columns.'),
    ],
    compute: (bars, inputs) => {
        const basis = ema(closes(bars), num(inputs, 'length', 13));
        return {
            plots: [
                { key: 'bull', title: 'Bull Power', values: sub(highs(bars), basis), kind: 'columns', color: str(inputs, 'bullColor', BULLISH), base: 0 },
                { key: 'bear', title: 'Bear Power', values: sub(lows(bars), basis), kind: 'columns', color: str(inputs, 'bearColor', BEARISH), base: 0 },
            ],
            levels: [{ key: 'zero', price: 0, color: transp(NEUTRAL, 30), lineStyle: 'dashed', title: 'Zero Line' }],
        };
    },
};

const ttmSqueeze: ClassicIndicatorSpec = {
    type: 'ttm-squeeze',
    title: 'TTM Squeeze',
    overlay: false,
    inputs: [
        { ...lengthInput(20, 'length', 'Length', 5000, "Shared lookback for the Bollinger Bands, the Keltner Channels, and the momentum regression. John Carter's original setting is 20."), min: 2 },
        sourceInput('Close', 'source', 'Source', 'Price series used for the shared moving average basis, the standard deviation, and the momentum displacement.'),
        floatInput('bbMult', 'Bollinger Bands Multiplier', 2, 0.1, 50, 0.1, 'Standard deviation multiplier for the Bollinger Bands.'),
        floatInput('kcMult', 'Keltner Channels Multiplier', 1.5, 0.1, 50, 0.1, 'ATR multiplier for the Keltner Channels. A smaller multiplier demands a tighter compression before the squeeze turns on.'),
        colorInput(BULLISH, 'Momentum Up', 'bullColor', 'Histogram color while momentum is positive. Bars building away from zero print solid, bars fading back print dimmed.'),
        colorInput(BEARISH, 'Momentum Down', 'bearColor', 'Histogram color while momentum is negative. Bars building away from zero print solid, bars fading back print dimmed.'),
        colorInput(WARNING, 'Squeeze On', 'squeezeOnColor', 'Zero-line dot color while both Bollinger Bands sit fully inside the Keltner Channels.'),
        colorInput(NEUTRAL, 'Squeeze Off', 'squeezeOffColor', 'Zero-line dot color while the Bollinger Bands trade outside the Keltner Channels.'),
        boolInput('markFires', 'Mark Squeeze Fires', true, STYLE, 'Draws a cross on the zero line on the first bar where the bands re-emerge outside the channels, colored by the side of the momentum histogram.'),
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
            { key: 'mom', title: 'Momentum', values: mom, kind: 'columns', color: bull, colors: momColors, base: 0 },
            {
                key: 'state',
                title: 'Squeeze State',
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
                title: 'Squeeze Fire',
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

export const oscillatorSpecs: ClassicIndicatorSpec[] = [
    rsiSpec,
    stochastic,
    stochasticRsi,
    macd,
    ppo,
    awesome,
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
    ultimate,
    rvgi,
    relVolatility,
    bop,
    elderRay,
    ttmSqueeze,
];
