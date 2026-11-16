import type { MessageLike } from '../../i18n/types';
import { msg } from '../../i18n/message';
import { BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { STYLE, anchorPlot, baselineGradient, boolInput, boundedOscillator, centeredOscillator, colorInput, floatInput, gradient, intInput, lengthInput, optionInput, sourceInput, transp } from './shared';
import { sourceValues, highs, lows, closes, trueRange, elapsedDays, ema, sma, rma, wma, stdev, stdError, sum, highest, lowest, map, zip, sub, shift } from './math';

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
function washedToZero(key: string, title: MessageLike, values: number[], colors: Array<string | null>, fallback: string, valueTransparency: number, width = 1): { plots: ClassicPlot[]; bands: NonNullable<ReturnType<typeof centeredOscillator>['bands']> } {
    return {
        plots: [{ key, title, values, color: fallback, width, colors }, anchorPlot('zeroAnchor', 'Zero Anchor', values.length, 0)],
        bands: [{ key: 'wash', from: key, to: 'zeroAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(values, 0, (_x, i) => colors[i] ?? fallback, valueTransparency) }],
    };
}

/** An annualized volatility line: inked by where the reading sits in its own recent range, washed down to zero. */
function rangeInkedVolatility(key: string, title: MessageLike, values: number[], accent: string): ReturnType<typeof washedToZero> {
    const low = lowest(values, 100);
    const high = highest(values, 100);
    const colors = values.map((x, i) => (Number.isFinite(x) ? gradient(x, low[i]!, high[i]!, NEUTRAL, accent) : null));
    return washedToZero(key, title, values, colors, accent, 75, 2);
}

const atrSpec: ClassicIndicatorSpec = {
    type: 'average-true-range',
    title: msg('indicator.averageTrueRange.title', 'Average True Range'),
    shortTitle: msg('indicator.averageTrueRange.shortTitle', 'ATR'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.averageTrueRange.length', 'Length'), 5000, msg('indicator.averageTrueRange.length.tooltip', 'Number of bars used to average the true range.')),
        optionInput('smoothing', msg('indicator.averageTrueRange.smoothing', 'Smoothing'), 'RMA', ['RMA', 'SMA', 'EMA', 'WMA'], msg('indicator.averageTrueRange.smoothing.tooltip', "Moving average applied to the true range. RMA is Wilder's original smoothing used by the classic ATR.")),
        colorInput(NEUTRAL, msg('indicator.averageTrueRange.color', 'ATR Line'), 'color', msg('indicator.averageTrueRange.color.tooltip', 'Color of the ATR line while volatility contracts or holds flat.')),
        colorInput(WARNING, msg('indicator.averageTrueRange.expandColor', 'Expanding'), 'expandColor', msg('indicator.averageTrueRange.expandColor.tooltip', 'Color of the ATR line while it rises — volatility expanding bar to bar.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const tr = trueRange(bars);
        const kind = str(inputs, 'smoothing', 'RMA');
        const values = kind === 'SMA' ? sma(tr, len) : kind === 'EMA' ? ema(tr, len) : kind === 'WMA' ? wma(tr, len) : rma(tr, len);
        const calm = str(inputs, 'color', NEUTRAL);
        return washedToZero('atr', msg('indicator.averageTrueRange.plot.atr', 'ATR'), values, expansionColors(values, calm, str(inputs, 'expandColor', WARNING)), calm, 75);
    },
};

const historicalVolatility: ClassicIndicatorSpec = {
    type: 'historical-volatility',
    title: msg('indicator.historicalVolatility.title', 'Historical Volatility'),
    shortTitle: msg('indicator.historicalVolatility.shortTitle', 'HV'),
    overlay: false,
    inputs: [
        { ...lengthInput(10, 'length', msg('indicator.historicalVolatility.length', 'Length'), 5000, msg('indicator.historicalVolatility.length.tooltip', 'Lookback window in bars for the standard deviation of close-to-close log returns.')), min: 2 },
        boolInput('annualize', msg('indicator.historicalVolatility.annualize', 'Annualize'), true, undefined, msg('indicator.historicalVolatility.annualize.tooltip', 'Scale the per-bar volatility to an annual figure by multiplying by the square root of the periods per year.')),
        intInput('periodsPerYear', msg('indicator.historicalVolatility.periodsPerYear', 'Periods Per Year'), 252, 1, 100000, msg('indicator.historicalVolatility.periodsPerYear.tooltip', 'Number of periods in a year used for annualization: 252 for daily bars, 52 for weekly, 12 for monthly.')),
        colorInput(WARNING, msg('indicator.historicalVolatility.color', 'Volatility Line'), 'color', msg('indicator.historicalVolatility.color.tooltip', 'Color of the line at its recent highs; it fades toward grey as volatility contracts.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 10);
        const logReturns = sub(map(closes(bars), Math.log), shift(map(closes(bars), Math.log), 1));
        // Sample (n − 1) standard deviation about the window mean.
        const meanReturn = map(sum(logReturns, len), (s) => s / len);
        const squaredSum = sum(map(logReturns, (r) => r * r), len);
        const factor = bool(inputs, 'annualize', true) ? Math.sqrt(num(inputs, 'periodsPerYear', 252)) : 1;
        const values = zip(squaredSum, meanReturn, (sq, m) => Math.sqrt(Math.max(sq - len * m * m, 0) / (len - 1)) * factor * 100);
        return rangeInkedVolatility('hv', msg('indicator.historicalVolatility.plot.hv', 'Historical Volatility'), values, str(inputs, 'color', WARNING));
    },
};

/** Garman and Klass's weight on the squared open-to-close move in their range estimator. */
const SESSION_BODY_WEIGHT = 2 * Math.LN2 - 1;
/** Their weight on the overnight gap once part of the day is spent closed. */
const OVERNIGHT_WEIGHT = 0.12;

const volatilityOhlc: ClassicIndicatorSpec = {
    type: 'volatility-ohlc',
    title: msg('indicator.volatilityOhlc.title', 'Volatility O-H-L-C'),
    shortTitle: msg('indicator.volatilityOhlc.shortTitle', 'Vol OHLC'),
    overlay: false,
    inputs: [
        lengthInput(10, 'length', msg('indicator.volatilityOhlc.length', 'Length'), 5000, msg('indicator.volatilityOhlc.length.tooltip', 'Number of bars whose daily variance estimates are averaged.')),
        floatInput('marketClosed', msg('indicator.volatilityOhlc.marketClosed', 'Market Closed Fraction'), 0, 0, 0.999, 0.01, msg('indicator.volatilityOhlc.marketClosed.tooltip', 'Share of the day the market spends closed, from 0 to 0.999. At 0 only each bar’s own range counts; above 0 the gap from the previous close is weighed in.')),
        intInput('daysPerYear', msg('indicator.volatilityOhlc.daysPerYear', 'Days Per Year'), 252, 1, 366, msg('indicator.volatilityOhlc.daysPerYear.tooltip', 'Trading days in a year, used to annualize the daily variance.')),
        colorInput(WARNING, msg('indicator.volatilityOhlc.color', 'Volatility Line'), 'color', msg('indicator.volatilityOhlc.color.tooltip', 'Color of the line at its recent highs; it fades toward grey as volatility contracts.')),
    ],
    compute: (bars, inputs) => {
        const days = elapsedDays(bars);
        const closed = Math.min(Math.max(num(inputs, 'marketClosed', 0), 0), 0.999);
        // Each bar's variance estimate, per day elapsed since the bar before it.
        const perDay = bars.map((b, i) => {
            const elapsed = days[i]!;
            if (!Number.isFinite(elapsed) || !(b.low > 0) || !(b.open > 0)) return Number.NaN;
            const range = Math.log(b.high / b.low);
            const body = Math.log(b.close / b.open);
            const session = 0.5 * range * range - SESSION_BODY_WEIGHT * body * body;
            if (closed === 0) return session / elapsed;
            const gap = Math.log(b.open / bars[i - 1]!.close);
            return ((OVERNIGHT_WEIGHT * gap * gap) / closed + ((1 - OVERNIGHT_WEIGHT) * session) / (1 - closed)) / elapsed;
        });
        const annual = num(inputs, 'daysPerYear', 252);
        const values = map(sma(perDay, num(inputs, 'length', 10)), (v) => 100 * Math.sqrt(v * annual));
        return rangeInkedVolatility('vol', msg('indicator.volatilityOhlc.plot.vol', 'Volatility'), values, str(inputs, 'color', WARNING));
    },
};

const volatilityZeroTrend: ClassicIndicatorSpec = {
    type: 'volatility-zero-trend',
    title: msg('indicator.volatilityZeroTrend.title', 'Volatility Zero Trend Close-to-Close'),
    shortTitle: msg('indicator.volatilityZeroTrend.shortTitle', 'Vol Zero Trend'),
    overlay: false,
    inputs: [
        lengthInput(10, 'length', msg('indicator.volatilityZeroTrend.length', 'Length'), 5000, msg('indicator.volatilityZeroTrend.length.tooltip', 'Number of close-to-close returns averaged.')),
        intInput('daysPerYear', msg('indicator.volatilityZeroTrend.daysPerYear', 'Days Per Year'), 252, 1, 366, msg('indicator.volatilityZeroTrend.daysPerYear.tooltip', 'Trading days in a year, used to annualize the daily variance.')),
        colorInput(WARNING, msg('indicator.volatilityZeroTrend.color', 'Volatility Line'), 'color', msg('indicator.volatilityZeroTrend.color.tooltip', 'Color of the line at its recent highs; it fades toward grey as volatility contracts.')),
    ],
    compute: (bars, inputs) => {
        const logClose = map(closes(bars), Math.log);
        // No mean is taken out: each squared return counts whole, per day elapsed since the bar before it.
        const perDay = zip(sub(logClose, shift(logClose, 1)), elapsedDays(bars), (r, elapsed) => (r * r) / elapsed);
        const annual = num(inputs, 'daysPerYear', 252);
        const values = map(sma(perDay, num(inputs, 'length', 10)), (v) => 100 * Math.sqrt(v * annual));
        return rangeInkedVolatility('vol', msg('indicator.volatilityZeroTrend.plot.vol', 'Volatility'), values, str(inputs, 'color', WARNING));
    },
};

const chaikinVolatility: ClassicIndicatorSpec = {
    type: 'chaikin-volatility',
    title: msg('indicator.chaikinVolatility.title', 'Chaikin Volatility'),
    shortTitle: msg('indicator.chaikinVolatility.shortTitle', 'CHV'),
    overlay: false,
    inputs: [
        lengthInput(10, 'emaLength', msg('indicator.chaikinVolatility.emaLength', 'EMA Length'), 5000, msg('indicator.chaikinVolatility.emaLength.tooltip', 'Length of the exponential moving average applied to the bar high-low range.')),
        lengthInput(10, 'rocLength', msg('indicator.chaikinVolatility.rocLength', 'ROC Length'), 5000, msg('indicator.chaikinVolatility.rocLength.tooltip', 'Number of bars used for the rate of change of the smoothed high-low range.')),
        colorInput(NEUTRAL, msg('indicator.chaikinVolatility.color', 'CHV Color'), 'color', msg('indicator.chaikinVolatility.color.tooltip', 'Color of the Chaikin Volatility line.')),
        colorInput(WARNING, msg('indicator.chaikinVolatility.expansionColor', 'Expansion'), 'expansionColor', msg('indicator.chaikinVolatility.expansionColor.tooltip', 'Line and fill color while the reading is above zero, when the smoothed range is wider than it was at the start of the ROC Length lookback.')),
    ],
    compute: (bars, inputs) => {
        const range = ema(sub(highs(bars), lows(bars)), num(inputs, 'emaLength', 10));
        const prior = shift(range, num(inputs, 'rocLength', 10));
        const values = zip(range, prior, (r, p) => (p === 0 ? Number.NaN : (100 * (r - p)) / p));
        const calm = str(inputs, 'color', NEUTRAL);
        const expansion = str(inputs, 'expansionColor', WARNING);
        return centeredOscillator({
            key: 'chv',
            title: msg('indicator.chaikinVolatility.plot.chv', 'Chaikin Volatility'),
            values,
            // Only expansion is a state worth accenting; contraction stays structural grey.
            ink: { bull: expansion, bear: calm, neutral: calm },
            zeroInk: NEUTRAL,
        });
    },
};

const massIndex: ClassicIndicatorSpec = {
    type: 'mass-index',
    title: msg('indicator.massIndex.title', 'Mass Index'),
    shortTitle: msg('indicator.massIndex.shortTitle', 'MI'),
    overlay: false,
    inputs: [
        lengthInput(25, 'length', msg('indicator.massIndex.length', 'Sum Length'), 5000, msg('indicator.massIndex.length.tooltip', 'Number of bars over which the single/double EMA ratio is summed.')),
        lengthInput(9, 'emaLength', msg('indicator.massIndex.emaLength', 'EMA Length'), 5000, msg('indicator.massIndex.emaLength.tooltip', 'Length of the single EMA of the high-low range and of its double smoothing.')),
        floatInput('setupLevel', msg('indicator.massIndex.setupLevel', 'Setup Level'), 27, 0, 1000, 0.1, msg('indicator.massIndex.setupLevel.tooltip', 'Reversal bulge setup level; a rise above it arms the pattern.')),
        floatInput('triggerLevel', msg('indicator.massIndex.triggerLevel', 'Trigger Level'), 26.5, 0, 1000, 0.1, msg('indicator.massIndex.triggerLevel.tooltip', 'Reversal bulge trigger level; a decline below it after a setup completes the pattern.')),
        colorInput(NEUTRAL, msg('indicator.massIndex.color', 'Mass Index'), 'color', msg('indicator.massIndex.color.tooltip', 'Line color while no reversal bulge is armed.')),
        colorInput(WARNING, msg('indicator.massIndex.armedColor', 'Armed'), 'armedColor', msg('indicator.massIndex.armedColor.tooltip', 'Line color from the rise above the setup level until the decline below the trigger level.')),
        colorInput(NEUTRAL, msg('indicator.massIndex.levelsColor', 'Levels'), 'levelsColor', msg('indicator.massIndex.levelsColor.tooltip', 'Reversal bulge levels color.')),
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
                { key: 'mi', title: msg('indicator.massIndex.plot.mi', 'Mass Index'), values, color: calm, colors },
                anchorPlot('setupAnchor', 'Setup Anchor', values.length, setup),
                anchorPlot('triggerAnchor', 'Trigger Anchor', values.length, trigger),
            ],
            bands: [{ key: 'bulge', from: 'setupAnchor', to: 'triggerAnchor', color: transp(armedInk, 90) }],
            levels: [
                { key: 'setup', price: setup, color: levelInk, lineStyle: 'dashed', title: msg('indicator.massIndex.level.setup', 'Setup Level') },
                { key: 'trigger', price: trigger, color: levelInk, lineStyle: 'dashed', title: msg('indicator.massIndex.level.trigger', 'Trigger Level') },
            ],
        };
    },
};

const standardDeviation: ClassicIndicatorSpec = {
    type: 'standard-deviation',
    title: msg('indicator.standardDeviation.title', 'Standard Deviation'),
    shortTitle: msg('indicator.standardDeviation.shortTitle', 'StdDev'),
    overlay: false,
    inputs: [
        lengthInput(20, 'length', msg('indicator.standardDeviation.length', 'Length'), 5000, msg('indicator.standardDeviation.length.tooltip', 'Number of bars used to compute the standard deviation.')),
        sourceInput('Close', 'source', msg('indicator.standardDeviation.source', 'Source'), msg('indicator.standardDeviation.source.tooltip', 'Price series the standard deviation is calculated on.')),
        colorInput(NEUTRAL, msg('indicator.standardDeviation.color', 'Standard Deviation'), 'color', msg('indicator.standardDeviation.color.tooltip', 'Line color while volatility contracts or holds flat.')),
        colorInput(WARNING, msg('indicator.standardDeviation.expandColor', 'Expanding'), 'expandColor', msg('indicator.standardDeviation.expandColor.tooltip', 'Line and fill color while volatility expands bar to bar.')),
    ],
    compute: (bars, inputs) => {
        const values = stdev(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 20));
        const calm = str(inputs, 'color', NEUTRAL);
        return washedToZero('stdev', msg('indicator.standardDeviation.plot.stdev', 'Standard Deviation'), values, expansionColors(values, calm, str(inputs, 'expandColor', WARNING)), calm, 80);
    },
};

const standardError: ClassicIndicatorSpec = {
    type: 'standard-error',
    title: msg('indicator.standardError.title', 'Standard Error'),
    shortTitle: msg('indicator.standardError.shortTitle', 'StdErr'),
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', msg('indicator.standardError.length', 'Length'), 5000, msg('indicator.standardError.length.tooltip', 'Number of bars the regression line is fitted over.')), min: 3 },
        sourceInput('Close', 'source', msg('indicator.standardError.source', 'Source'), msg('indicator.standardError.source.tooltip', 'Price series the regression line is fitted to.')),
        colorInput(NEUTRAL, msg('indicator.standardError.color', 'Standard Error'), 'color', msg('indicator.standardError.color.tooltip', 'Line color while the reading contracts or holds flat.')),
        colorInput(WARNING, msg('indicator.standardError.expandColor', 'Expanding'), 'expandColor', msg('indicator.standardError.expandColor.tooltip', 'Line and fill color while the reading expands bar to bar.')),
    ],
    compute: (bars, inputs) => {
        const values = stdError(sourceValues(bars, str(inputs, 'source', 'Close')), num(inputs, 'length', 14));
        const calm = str(inputs, 'color', NEUTRAL);
        return washedToZero('se', msg('indicator.standardError.plot.se', 'Standard Error'), values, expansionColors(values, calm, str(inputs, 'expandColor', WARNING)), calm, 80);
    },
};

const ulcerIndex: ClassicIndicatorSpec = {
    type: 'ulcer-index',
    title: msg('indicator.ulcerIndex.title', 'Ulcer Index'),
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', msg('indicator.ulcerIndex.length', 'Length'), 500, msg('indicator.ulcerIndex.length.tooltip', "Lookback window. At each bar the percentage drawdown from the window's running maximum is squared; the squares are averaged and the root taken.")), min: 2 },
        sourceInput('Close', 'source', msg('indicator.ulcerIndex.source', 'Source'), msg('indicator.ulcerIndex.source.tooltip', 'Price series the Ulcer Index is computed on. Close is the standard choice.')),
        floatInput('threshold', msg('indicator.ulcerIndex.threshold', 'Stress Threshold'), 5, 0, 1000, 0.25, msg('indicator.ulcerIndex.threshold.tooltip', "Reference level drawn as a dashed line. The index scales with the instrument's volatility and the window length, so set it relative to its own history.")),
        colorInput(NEUTRAL, msg('indicator.ulcerIndex.color', 'Ulcer Index'), 'color', msg('indicator.ulcerIndex.color.tooltip', 'Color of the index near zero; it blends toward the stress color as the reading approaches the threshold.')),
        colorInput(BEARISH, msg('indicator.ulcerIndex.stressColor', 'Stress'), 'stressColor', msg('indicator.ulcerIndex.stressColor.tooltip', 'Color of the index at and beyond the stress threshold.')),
        boolInput('gradientFill', msg('indicator.ulcerIndex.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.ulcerIndex.gradientFill.tooltip', 'Vertical gradient between zero and the Ulcer Index, fully transparent at zero.')),
        boolInput('showDrawdown', msg('indicator.ulcerIndex.showDrawdown', 'Drawdown %'), false, STYLE, msg('indicator.ulcerIndex.showDrawdown.tooltip', 'Plot the current percentage drawdown from the window high as columns below zero — the raw ingredient the index averages.')),
        colorInput(transp(BEARISH, 50), msg('indicator.ulcerIndex.drawdownColor', 'Drawdown Color'), 'drawdownColor', msg('indicator.ulcerIndex.drawdownColor.tooltip', 'Color of the drawdown columns.')),
        colorInput(NEUTRAL, msg('indicator.ulcerIndex.thresholdColor', 'Threshold'), 'thresholdColor', msg('indicator.ulcerIndex.thresholdColor.tooltip', 'Color of the stress threshold line.')),
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
        const plots: ClassicPlot[] = [{ key: 'ui', title: msg('indicator.ulcerIndex.plot.ui', 'Ulcer Index'), values, color: calm, colors }];
        const bands = [];
        if (bool(inputs, 'gradientFill', true)) {
            plots.push(anchorPlot('zeroAnchor', 'Zero Base', n, 0));
            bands.push({ key: 'wash', from: 'ui', to: 'zeroAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(values, 0, (_x, i) => colors[i] ?? calm) });
        }
        if (bool(inputs, 'showDrawdown', false)) {
            plots.push({ key: 'dd', title: msg('indicator.ulcerIndex.plot.dd', 'Drawdown %'), values: drawdown, kind: 'columns', color: str(inputs, 'drawdownColor', transp(BEARISH, 50)), base: 0 });
        }
        return {
            plots,
            bands,
            levels: [
                { key: 'zero', price: 0, color: transp(NEUTRAL, 50), lineStyle: 'dotted', title: msg('indicator.ulcerIndex.level.zero', 'Zero Line') },
                { key: 'threshold', price: threshold, color: str(inputs, 'thresholdColor', NEUTRAL), lineStyle: 'dashed', title: msg('indicator.ulcerIndex.level.threshold', 'Stress Threshold') },
            ],
        };
    },
};

const choppiness: ClassicIndicatorSpec = {
    type: 'choppiness-index',
    title: msg('indicator.choppinessIndex.title', 'Choppiness Index'),
    shortTitle: msg('indicator.choppinessIndex.shortTitle', 'CHOP'),
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', msg('indicator.choppinessIndex.length', 'Length'), 5000, msg('indicator.choppinessIndex.length.tooltip', 'Number of bars used to sum true ranges and to measure the highest high − lowest low range.')), min: 2 },
        floatInput('upperBand', msg('indicator.choppinessIndex.upperBand', 'Upper Band'), 61.8, 0, 100, 0.1, msg('indicator.choppinessIndex.upperBand.tooltip', 'Readings above this level indicate a choppy, range-bound market.')),
        floatInput('lowerBand', msg('indicator.choppinessIndex.lowerBand', 'Lower Band'), 38.2, 0, 100, 0.1, msg('indicator.choppinessIndex.lowerBand.tooltip', 'Readings below this level indicate a strong trend.')),
        colorInput(NEUTRAL, msg('indicator.choppinessIndex.color', 'CHOP Line'), 'color', msg('indicator.choppinessIndex.color.tooltip', 'Color of the Choppiness Index line.')),
        colorInput(BULLISH, msg('indicator.choppinessIndex.trendingColor', 'Trending'), 'trendingColor', msg('indicator.choppinessIndex.trendingColor.tooltip', 'Line, fill and zone color toward and below the lower band — a trending market.')),
        colorInput(BEARISH, msg('indicator.choppinessIndex.choppyColor', 'Choppy'), 'choppyColor', msg('indicator.choppinessIndex.choppyColor.tooltip', 'Line, fill and zone color toward and above the upper band — a choppy, range-bound market.')),
        colorInput(transp(NEUTRAL, 90), msg('indicator.choppinessIndex.fillColor', 'Band Fill'), 'fillColor', msg('indicator.choppinessIndex.fillColor.tooltip', 'Fill color of the zone between the upper and lower bands.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const trSum = sum(trueRange(bars), len);
        const span = zip(highest(highs(bars), len), lowest(lows(bars), len), (h, l) => h - l);
        const values = zip(trSum, span, (t, s) => (s > 0 && t > 0 ? (100 * Math.log10(t / s)) / Math.log10(len) : Number.NaN));
        return boundedOscillator({
            key: 'chop',
            title: msg('indicator.choppinessIndex.plot.chop', 'CHOP'),
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'upperBand', 61.8),
            oversold: num(inputs, 'lowerBand', 38.2),
            ink: { low: str(inputs, 'trendingColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'choppyColor', BEARISH) },
            levelInk: NEUTRAL,
            bandFill: str(inputs, 'fillColor', transp(NEUTRAL, 90)),
            midpointWash: true,
            levelTitles: { overbought: msg('indicator.choppinessIndex.level.upperBand', 'Upper Band'), oversold: msg('indicator.choppinessIndex.level.lowerBand', 'Lower Band') },
        });
    },
};

export const volatilitySpecs: ClassicIndicatorSpec[] = [atrSpec, historicalVolatility, volatilityOhlc, volatilityZeroTrend, chaikinVolatility, massIndex, standardDeviation, standardError, ulcerIndex, choppiness];
