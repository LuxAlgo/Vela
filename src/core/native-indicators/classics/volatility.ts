import { BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { STYLE, anchorPlot, baselineGradient, boolInput, boundedOscillator, centeredOscillator, colorInput, floatInput, gradient, intInput, lengthInput, optionInput, sourceInput, transp } from './shared';
import { sourceValues, highs, lows, closes, trueRange, ema, sma, rma, wma, stdev, sum, highest, lowest, map, zip, sub, shift } from './math';

/** Volatility studies — how much price moves, regardless of direction. */

/** Rising readings take the accent; contracting or flat volatility stays structural grey. */
function expansionColors(values: readonly number[], calm: string, expanding: string): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 && Number.isFinite(values[i - 1]!) ? values[i - 1]! : x;
        return x > prev ? expanding : calm;
    });
}

/** Line plus a wash down to zero — the shared look of the one-sided volatility metrics. */
function washedToZero(key: string, title: string, values: number[], colors: Array<string | null>, fallback: string, valueTransparency: number, width = 1): { plots: ClassicPlot[]; bands: NonNullable<ReturnType<typeof centeredOscillator>['bands']> } {
    return {
        plots: [{ key, title, values, color: fallback, width, colors }, anchorPlot('zeroAnchor', 'Zero Anchor', values.length, 0)],
        bands: [{ key: 'wash', from: key, to: 'zeroAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(values, 0, (_x, i) => colors[i] ?? fallback, valueTransparency) }],
    };
}

const atrSpec: ClassicIndicatorSpec = {
    type: 'average-true-range',
    title: 'Average True Range',
    shortTitle: 'ATR',
    overlay: false,
    inputs: [
        lengthInput(14, 'length', 'Length', 5000, 'Number of bars used to average the true range.'),
        optionInput('smoothing', 'Smoothing', 'RMA', ['RMA', 'SMA', 'EMA', 'WMA'], "Moving average applied to the true range. RMA is Wilder's original smoothing used by the classic ATR."),
        colorInput(NEUTRAL, 'ATR Line', 'color', 'Color of the ATR line while volatility contracts or holds flat.'),
        colorInput(WARNING, 'Expanding', 'expandColor', 'Color of the ATR line while it rises — volatility expanding bar to bar.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const tr = trueRange(bars);
        const kind = str(inputs, 'smoothing', 'RMA');
        const values = kind === 'SMA' ? sma(tr, len) : kind === 'EMA' ? ema(tr, len) : kind === 'WMA' ? wma(tr, len) : rma(tr, len);
        const calm = str(inputs, 'color', NEUTRAL);
        return washedToZero('atr', 'ATR', values, expansionColors(values, calm, str(inputs, 'expandColor', WARNING)), calm, 75);
    },
};

const historicalVolatility: ClassicIndicatorSpec = {
    type: 'historical-volatility',
    title: 'Historical Volatility',
    shortTitle: 'HV',
    overlay: false,
    inputs: [
        { ...lengthInput(10, 'length', 'Length', 5000, 'Lookback window in bars for the standard deviation of close-to-close log returns.'), min: 2 },
        boolInput('annualize', 'Annualize', true, undefined, 'Scale the per-bar volatility to an annual figure by multiplying by the square root of the periods per year.'),
        intInput('periodsPerYear', 'Periods Per Year', 252, 1, 100000, 'Number of periods in a year used for annualization: 252 for daily bars, 52 for weekly, 12 for monthly.'),
        colorInput(WARNING, 'Volatility Line', 'color', 'Color of the line at its recent highs; it fades toward grey as volatility contracts.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const logReturns = sub(map(closes(bars), Math.log), shift(map(closes(bars), Math.log), 1));
        // Sample (n − 1) standard deviation about the window mean.
        const meanReturn = map(sum(logReturns, len), (s) => s / len);
        const squaredSum = sum(map(logReturns, (r) => r * r), len);
        const factor = bool(inputs, 'annualize', true) ? Math.sqrt(num(inputs, 'periodsPerYear', 252)) : 1;
        const values = zip(squaredSum, meanReturn, (sq, m) => Math.sqrt(Math.max(sq - len * m * m, 0) / (len - 1)) * factor * 100);
        // Intensity tracks where the reading sits in its own recent range.
        const low = lowest(values, 100);
        const high = highest(values, 100);
        const accent = str(inputs, 'color', WARNING);
        const colors = values.map((x, i) => (Number.isFinite(x) ? gradient(x, low[i] ?? 0, high[i] ?? 0, NEUTRAL, accent) : null));
        return washedToZero('hv', 'Historical Volatility', values, colors, accent, 75, 2);
    },
};

const chaikinVolatility: ClassicIndicatorSpec = {
    type: 'chaikin-volatility',
    title: 'Chaikin Volatility',
    shortTitle: 'CHV',
    overlay: false,
    inputs: [
        lengthInput(10, 'emaLength', 'EMA Length', 5000, 'Length of the exponential moving average applied to the bar high-low range.'),
        lengthInput(10, 'rocLength', 'ROC Length', 5000, 'Number of bars used for the rate of change of the smoothed high-low range.'),
        colorInput(NEUTRAL, 'CHV Color', 'color', 'Color of the Chaikin Volatility line.'),
        colorInput(WARNING, 'Expansion', 'expansionColor', 'Line and fill color while the reading is above zero — the smoothed range is wider than it was ROC Length bars ago.'),
    ],
    compute: (bars, inputs) => {
        const range = ema(sub(highs(bars), lows(bars)), num(inputs, 'emaLength', 10));
        const prior = shift(range, num(inputs, 'rocLength', 10));
        const values = zip(range, prior, (r, p) => (p === 0 ? Number.NaN : (100 * (r - p)) / p));
        const calm = str(inputs, 'color', NEUTRAL);
        const expansion = str(inputs, 'expansionColor', WARNING);
        return centeredOscillator({
            key: 'chv',
            title: 'Chaikin Volatility',
            values,
            // Only expansion is a state worth accenting; contraction stays structural grey.
            ink: { bull: expansion, bear: calm, neutral: calm },
            zeroInk: NEUTRAL,
        });
    },
};

const massIndex: ClassicIndicatorSpec = {
    type: 'mass-index',
    title: 'Mass Index',
    shortTitle: 'MI',
    overlay: false,
    inputs: [
        lengthInput(25, 'length', 'Sum Length', 5000, 'Number of bars over which the single/double EMA ratio is summed.'),
        lengthInput(9, 'emaLength', 'EMA Length', 5000, 'Length of the single EMA of the high-low range and of its double smoothing.'),
        floatInput('setupLevel', 'Setup Level', 27, 0, 1000, 0.1, 'Reversal bulge set-up level; a rise above it arms the pattern.'),
        floatInput('triggerLevel', 'Trigger Level', 26.5, 0, 1000, 0.1, 'Reversal bulge trigger level; a decline below it after a set-up completes the pattern.'),
        colorInput(NEUTRAL, 'Mass Index', 'color', 'Line color while no reversal bulge is armed.'),
        colorInput(WARNING, 'Armed', 'armedColor', 'Line color from the rise above the setup level until the decline below the trigger level.'),
        colorInput(NEUTRAL, 'Levels', 'levelsColor', 'Reversal bulge levels color.'),
    ],
    compute: (bars, inputs) => {
        const emaLen = num(inputs, 'emaLength', 9);
        const single = ema(sub(highs(bars), lows(bars)), emaLen);
        // A flat market yields the neutral ratio 1 rather than a gap.
        const ratio = zip(single, ema(single, emaLen), (a, b) => (b === 0 ? 1 : a / b));
        const values = sum(ratio, num(inputs, 'length', 25));
        const setup = num(inputs, 'setupLevel', 27);
        const trigger = num(inputs, 'triggerLevel', 26.5);
        const calm = str(inputs, 'color', NEUTRAL);
        const armedInk = str(inputs, 'armedColor', WARNING);
        const levelInk = str(inputs, 'levelsColor', NEUTRAL);
        // Armed by the rise above the setup level, cleared by the decline below the trigger.
        let armed = false;
        const colors = values.map((x) => {
            if (!Number.isFinite(x)) return null;
            armed = x > setup ? true : x < trigger ? false : armed;
            return armed ? armedInk : calm;
        });
        return {
            plots: [
                { key: 'mi', title: 'Mass Index', values, color: calm, colors },
                anchorPlot('setupAnchor', 'Setup Anchor', values.length, setup),
                anchorPlot('triggerAnchor', 'Trigger Anchor', values.length, trigger),
            ],
            bands: [{ key: 'bulge', from: 'setupAnchor', to: 'triggerAnchor', color: transp(armedInk, 90) }],
            levels: [
                { key: 'setup', price: setup, color: levelInk, lineStyle: 'dashed', title: 'Setup Level' },
                { key: 'trigger', price: trigger, color: levelInk, lineStyle: 'dashed', title: 'Trigger Level' },
            ],
        };
    },
};

const standardDeviation: ClassicIndicatorSpec = {
    type: 'standard-deviation',
    title: 'Standard Deviation',
    shortTitle: 'StdDev',
    overlay: false,
    inputs: [
        lengthInput(20, 'length', 'Length', 5000, 'Number of bars used to compute the standard deviation.'),
        sourceInput('Close', 'source', 'Source', 'Price series the standard deviation is calculated on.'),
        colorInput(NEUTRAL, 'Standard Deviation', 'color', 'Line color while volatility contracts or holds flat.'),
        colorInput(WARNING, 'Expanding', 'expandColor', 'Line and fill color while volatility expands bar to bar.'),
    ],
    compute: (bars, inputs) => {
        const values = stdev(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 20));
        const calm = str(inputs, 'color', NEUTRAL);
        return washedToZero('stdev', 'Standard Deviation', values, expansionColors(values, calm, str(inputs, 'expandColor', WARNING)), calm, 80);
    },
};

const ulcerIndex: ClassicIndicatorSpec = {
    type: 'ulcer-index',
    title: 'Ulcer Index',
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', 'Length', 500, "Lookback window. At each bar the percentage drawdown from the window's running maximum is squared; the squares are averaged and the root taken."), min: 2 },
        sourceInput('Close', 'source', 'Source', 'Price series the Ulcer Index is computed on. Close is the standard choice.'),
        floatInput('threshold', 'Alert Threshold', 5, 0, 1000, 0.25, "Reference level drawn as a dashed line. The index scales with the instrument's volatility and the window length, so set it relative to its own history."),
        colorInput(NEUTRAL, 'Ulcer Index', 'color', 'Color of the index near zero; it blends toward the stress color as the reading approaches the threshold.'),
        colorInput(BEARISH, 'Stress', 'stressColor', 'Color of the index at and beyond the alert threshold.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Vertical gradient between zero and the Ulcer Index, fully transparent at zero.'),
        boolInput('showDrawdown', 'Drawdown %', false, STYLE, 'Plot the current percentage drawdown from the window high as columns below zero — the raw ingredient the index averages.'),
        colorInput(transp(BEARISH, 50), 'Drawdown Color', 'drawdownColor', 'Color of the drawdown columns.'),
        colorInput(NEUTRAL, 'Threshold', 'thresholdColor', 'Color of the alert threshold line.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const n = src.length;
        const values = new Array<number>(n).fill(Number.NaN);
        const drawdown = new Array<number>(n).fill(Number.NaN);
        for (let i = len - 1; i < n; i++) {
            // The running maximum walks forward from the start of the window, so an early
            // peak keeps scoring every later bar as underwater.
            let runMax = Number.NaN;
            let sumSq = 0;
            let valid = true;
            let last = Number.NaN;
            for (let k = i - len + 1; k <= i; k++) {
                const price = src[k]!;
                if (!Number.isFinite(price)) {
                    valid = false;
                    break;
                }
                runMax = Number.isFinite(runMax) ? Math.max(runMax, price) : price;
                if (runMax <= 0) {
                    valid = false;
                    break;
                }
                last = (100 * (price - runMax)) / runMax;
                sumSq += last * last;
            }
            if (!valid) continue;
            values[i] = Math.sqrt(sumSq / len);
            drawdown[i] = last;
        }
        const calm = str(inputs, 'color', NEUTRAL);
        const stress = str(inputs, 'stressColor', BEARISH);
        const threshold = num(inputs, 'threshold', 5);
        const colors = values.map((x) => (Number.isFinite(x) ? (threshold > 0 ? gradient(x, 0, threshold, calm, stress) : stress) : null));
        const plots: ClassicPlot[] = [{ key: 'ui', title: 'Ulcer Index', values, color: calm, colors }];
        const bands = [];
        if (bool(inputs, 'gradientFill', true)) {
            plots.push(anchorPlot('zeroAnchor', 'Zero Base', n, 0));
            bands.push({ key: 'wash', from: 'ui', to: 'zeroAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(values, 0, (_x, i) => colors[i] ?? calm) });
        }
        if (bool(inputs, 'showDrawdown', false)) {
            plots.push({ key: 'dd', title: 'Drawdown %', values: drawdown, kind: 'columns', color: str(inputs, 'drawdownColor', transp(BEARISH, 50)), base: 0 });
        }
        return {
            plots,
            bands,
            levels: [
                { key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dotted', title: 'Zero Level' },
                { key: 'threshold', price: threshold, color: str(inputs, 'thresholdColor', NEUTRAL), lineStyle: 'dashed', title: 'Alert Threshold' },
            ],
        };
    },
};

const choppiness: ClassicIndicatorSpec = {
    type: 'choppiness-index',
    title: 'Choppiness Index',
    shortTitle: 'CHOP',
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', 'Length', 5000, 'Number of bars used to sum true ranges and to measure the highest high − lowest low range.'), min: 2 },
        floatInput('upperBand', 'Upper Band', 61.8, 0, 100, 0.1, 'Readings above this level indicate a choppy, range-bound market.'),
        floatInput('lowerBand', 'Lower Band', 38.2, 0, 100, 0.1, 'Readings below this level indicate a strong trend.'),
        colorInput(NEUTRAL, 'CHOP Line', 'color', 'Color of the Choppiness Index line.'),
        colorInput(BULLISH, 'Trending', 'trendingColor', 'Line, fill and zone color toward and below the lower band — a trending market.'),
        colorInput(BEARISH, 'Choppy', 'choppyColor', 'Line, fill and zone color toward and above the upper band — a choppy, range-bound market.'),
        colorInput(transp(NEUTRAL, 90), 'Band Fill', 'fillColor', 'Fill color of the zone between the upper and lower bands.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const trSum = sum(trueRange(bars), len);
        const span = zip(highest(highs(bars), len), lowest(lows(bars), len), (h, l) => h - l);
        const values = zip(trSum, span, (t, s) => (s > 0 && t > 0 ? (100 * Math.log10(t / s)) / Math.log10(len) : Number.NaN));
        return boundedOscillator({
            key: 'chop',
            title: 'CHOP',
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'upperBand', 61.8),
            oversold: num(inputs, 'lowerBand', 38.2),
            ink: { low: str(inputs, 'trendingColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'choppyColor', BEARISH) },
            levelInk: NEUTRAL,
            bandFill: str(inputs, 'fillColor', transp(NEUTRAL, 90)),
            midpointWash: true,
            levelTitles: { overbought: 'Upper Band', oversold: 'Lower Band' },
        });
    },
};

export const volatilitySpecs: ClassicIndicatorSpec[] = [atrSpec, historicalVolatility, chaikinVolatility, massIndex, standardDeviation, ulcerIndex, choppiness];
