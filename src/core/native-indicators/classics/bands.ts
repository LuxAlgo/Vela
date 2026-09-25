import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { STYLE, boolInput, channelStyleInputs, colorInput, directionalChannel, floatInput, intInput, lengthInput, optionInput, sourceInput, transp } from './shared';
import { sourceValues, highs, lows, sma, ema, rma, stdev, highest, lowest, atr, zip, map, sub, shift } from './math';

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
function bollingerInputs(multMin: number, multStep: number): InputSchema[] {
    return [
        { ...lengthInput(20, 'length', 'Length', 5000, 'Number of bars used for the Bollinger Bands basis (a simple moving average) and for the standard deviation.'), min: 2 },
        sourceInput('Close', 'source', 'Source', 'Price series the bands are computed from.'),
        floatInput('mult', 'Multiplier', 2, multMin, 50, multStep, 'Standard deviation multiplier for the upper and lower bands.'),
    ];
}

const bollingerBands: ClassicIndicatorSpec = {
    type: 'bollinger-bands',
    title: 'Bollinger Bands',
    shortTitle: 'BB',
    overlay: true,
    inputs: [
        lengthInput(20, 'length', 'Length', 5000, 'Number of bars used to calculate the basis SMA and the standard deviation.'),
        sourceInput('Close', 'source', 'Source', 'Price series the bands are calculated on.'),
        floatInput('mult', 'Multiplier', 2, 0, 50, 0.1, 'Number of standard deviations added above and below the basis to form the bands.'),
        colorInput(WARNING, 'Basis', 'basisColor', 'Color of the basis (middle band) moving average.'),
        colorInput(INFO, 'Bands', 'color', 'Color of the upper and lower bands.'),
        colorInput(transp(INFO, 92), 'Fill', 'fillColor', 'Fill color of the area between the upper and lower bands.'),
    ],
    compute: (bars, inputs) => {
        const { basis, upper, lower } = bollinger(bars, inputs);
        const ink = str(inputs, 'color', INFO);
        return {
            plots: [
                { key: 'basis', title: 'Basis', values: basis, color: str(inputs, 'basisColor', WARNING) },
                { key: 'upper', title: 'Upper', values: upper, color: ink },
                { key: 'lower', title: 'Lower', values: lower, color: ink },
            ],
            bands: [{ key: 'bb', from: 'upper', to: 'lower', color: str(inputs, 'fillColor', transp(INFO, 92)) }],
        };
    },
};

const PERCENT_B_MID = 0.5;
const THRESHOLDS = 'Thresholds';

const percentB: ClassicIndicatorSpec = {
    type: 'percent-b',
    title: 'Bollinger Bands %B',
    shortTitle: '%B',
    overlay: false,
    inputs: [
        ...bollingerInputs(0.001, 0.25),
        { ...floatInput('overbought', 'Overbought', 1, -10, 10, 0.05, 'Level treated as overbought. 1 is the upper band itself, so readings above the default mean price sits outside the bands.'), group: THRESHOLDS },
        { ...floatInput('oversold', 'Oversold', 0, -10, 10, 0.05, 'Level treated as oversold. 0 is the lower band itself, so readings below the default mean price sits outside the bands.'), group: THRESHOLDS },
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of %B above the 0.5 midline, where price trades in the upper half of the bands.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of %B below the 0.5 midline, where price trades in the lower half of the bands.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Vertical gradient between %B and the 0.5 midline, fully transparent at the midline and more opaque at the oscillator value.'),
        colorInput(NEUTRAL, 'Levels Color', 'levelsColor', 'Color of the dashed overbought/oversold levels and of the dotted midline.'),
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
            { key: 'pb', title: '%B', values, color: bear, colors },
            { key: 'mid', title: 'Midline', values: values.map((x) => (Number.isFinite(x) ? PERCENT_B_MID : Number.NaN)), color: levels, display: { pane: false, legend: false, dataWindow: false } },
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
                { key: 'overbought', price: num(inputs, 'overbought', 1), color: levels, lineStyle: 'dashed', title: 'Overbought' },
                { key: 'oversold', price: num(inputs, 'oversold', 0), color: levels, lineStyle: 'dashed', title: 'Oversold' },
                { key: 'midline', price: PERCENT_B_MID, color: transp(levels, 50), lineStyle: 'dotted', title: 'Midline' },
            ],
        };
    },
};

const SQUEEZE_BULGE = 'Squeeze & Bulge';

const bandwidth: ClassicIndicatorSpec = {
    type: 'bandwidth',
    title: 'Bollinger Bands Width',
    shortTitle: 'BandWidth',
    overlay: false,
    inputs: [
        ...bollingerInputs(0.001, 0.25),
        { ...intInput('lookback', 'Reference Lookback', 125, 2, 5000, 'Window used to locate the lowest (Squeeze) and highest (Bulge) BandWidth references.'), group: SQUEEZE_BULGE },
        boolInput('showSqueeze', 'Show Squeeze Level', true, SQUEEZE_BULGE, 'Plots the lowest BandWidth of the reference lookback — unusually compressed volatility, a condition rather than a directional signal.'),
        boolInput('showBulge', 'Show Bulge Level', true, SQUEEZE_BULGE, 'Plots the highest BandWidth of the reference lookback — extreme width that is unlikely to be sustained.'),
        colorInput(NEUTRAL, 'BandWidth', 'color', 'Color of the BandWidth line. At its Squeeze reference the line takes the Squeeze color, at its Bulge reference the Bulge color.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the area between zero and BandWidth with a vertical gradient, fully transparent at zero.'),
        colorInput(WARNING, 'Squeeze Level', 'squeezeColor', 'Color of the lowest-BandWidth reference line.'),
        colorInput(BEARISH, 'Bulge Level', 'bulgeColor', 'Color of the highest-BandWidth reference line.'),
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
            { key: 'bbw', title: 'BandWidth', values, color: base, colors },
            { key: 'zero', title: 'Zero Line', values: values.map((x) => (Number.isFinite(x) ? 0 : Number.NaN)), color: transp(NEUTRAL, 90) },
        ];
        if (bool(inputs, 'showSqueeze', true)) plots.push({ key: 'squeeze', title: 'Squeeze Level', values: squeezeLevel, color: squeezeInk });
        if (bool(inputs, 'showBulge', true)) plots.push({ key: 'bulge', title: 'Bulge Level', values: bulgeLevel, color: bulgeInk });
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
    title: 'Keltner Channels',
    shortTitle: 'KC',
    overlay: true,
    inputs: [
        lengthInput(20, 'length', 'EMA Length', 5000, 'Number of bars used to compute the exponential moving average basis line.'),
        intInput('atrLength', 'ATR Length', 10, 1, 5000, 'Number of bars used to compute the Average True Range (Wilder smoothing).'),
        floatInput('mult', 'Multiplier', 2, 0, 50, 0.1, 'ATR multiple used to offset the upper and lower bands from the basis line.'),
        sourceInput('Close', 'source', 'Source', 'Price series used to compute the basis line.'),
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
    title: 'Donchian Channels',
    shortTitle: 'DC',
    overlay: true,
    inputs: [
        lengthInput(20, 'length', 'Length', 5000, 'Lookback length. The upper and lower channels are the highest high and lowest low over this many bars.'),
        colorInput(BEARISH, 'Upper', 'upperColor', 'Color of the upper channel line.'),
        colorInput(NEUTRAL, 'Middle', 'middleColor', 'Color of the channel midline.'),
        colorInput(BULLISH, 'Lower', 'lowerColor', 'Color of the lower channel line.'),
        colorInput(transp(NEUTRAL, 92), 'Fill', 'fillColor', 'Color of the channel interior fill.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const upper = highest(highs(bars), len);
        const lower = lowest(lows(bars), len);
        return {
            plots: [
                { key: 'upper', title: 'Upper', values: upper, color: str(inputs, 'upperColor', BEARISH) },
                { key: 'middle', title: 'Middle', kind: 'circles', values: zip(upper, lower, (u, l) => (u + l) / 2), color: str(inputs, 'middleColor', NEUTRAL) },
                { key: 'lower', title: 'Lower', values: lower, color: str(inputs, 'lowerColor', BULLISH) },
            ],
            bands: [{ key: 'dc', from: 'upper', to: 'lower', color: str(inputs, 'fillColor', transp(NEUTRAL, 92)) }],
        };
    },
};

const chandelier: ClassicIndicatorSpec = {
    type: 'chandelier-exit',
    title: 'Chandelier Exit',
    shortTitle: 'CE',
    overlay: true,
    inputs: [
        lengthInput(22, 'length', 'Length', 5000, 'Lookback used for both the highest high / lowest low extremes and the ATR.'),
        floatInput('mult', 'ATR Multiplier', 3, 0, 50, 0.1, 'Multiple of ATR subtracted from the highest high (long stop) and added to the lowest low (short stop).'),
        boolInput('ratchet', 'Ratchet Stops', false, undefined, 'Prevents the long stop from falling and the short stop from rising, resetting once close crosses through the stop.'),
        colorInput(BULLISH, 'Long Stop', 'longColor', 'Color of the long trailing stop line.'),
        colorInput(BEARISH, 'Short Stop', 'shortColor', 'Color of the short trailing stop line.'),
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
                { key: 'long', title: 'Long Stop', values: long, color: str(inputs, 'longColor', BULLISH) },
                { key: 'short', title: 'Short Stop', values: short, color: str(inputs, 'shortColor', BEARISH) },
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
        intInput('p', 'ATR Length (P)', 10, 1, 5000, 'Lookback used for both the ATR and the highest high / lowest low price extremes.'),
        floatInput('x', 'ATR Multiplier (X)', 1, 0, 50, 0.1, 'Multiplier applied to the ATR to offset the preliminary stops from the price extremes.'),
        intInput('q', 'Stop Length (Q)', 9, 1, 5000, 'Lookback over which the preliminary stops are extended into the final stop levels.'),
        colorInput(BEARISH, 'Stop Short', 'shortColor', 'Color of the protective stop line for short positions.'),
        colorInput(BULLISH, 'Stop Long', 'longColor', 'Color of the protective stop line for long positions.'),
    ],
    compute: (bars, inputs) => {
        const p = num(inputs, 'p', 10);
        const q = num(inputs, 'q', 9);
        const range = map(atr(bars, p), (v) => v * num(inputs, 'x', 1));
        const firstHigh = zip(highest(highs(bars), p), range, (h, r) => h - r);
        const firstLow = zip(lowest(lows(bars), p), range, (l, r) => l + r);
        return {
            plots: [
                { key: 'stopShort', title: 'Stop Short', values: highest(firstHigh, q), color: str(inputs, 'shortColor', BEARISH) },
                { key: 'stopLong', title: 'Stop Long', values: lowest(firstLow, q), color: str(inputs, 'longColor', BULLISH) },
            ],
        };
    },
};

const supertrend: ClassicIndicatorSpec = {
    type: 'supertrend',
    title: 'SuperTrend',
    shortTitle: 'SuperTrend',
    overlay: true,
    inputs: [
        intInput('atrLength', 'ATR Length', 10, 1, 5000, 'Number of bars used to compute the Wilder ATR.'),
        floatInput('mult', 'Factor', 3, 0, 50, 0.1, 'ATR multiplier setting how far the trailing stop sits from the bar midpoint.'),
        colorInput(BULLISH, 'Uptrend Color', 'upColor', 'Line color while the trend is up.'),
        colorInput(BEARISH, 'Downtrend Color', 'downColor', 'Line color while the trend is down.'),
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
                { key: 'up', title: 'Uptrend', values: up, color: str(inputs, 'upColor', BULLISH) },
                { key: 'down', title: 'Downtrend', values: down, color: str(inputs, 'downColor', BEARISH) },
            ],
        };
    },
};

const alligator: ClassicIndicatorSpec = {
    type: 'williams-alligator',
    title: 'Williams Alligator',
    shortTitle: 'Alligator',
    overlay: true,
    inputs: [
        intInput('jawLength', 'Jaw Length', 13, 1, 5000, 'Smoothing length of the Jaw SMMA of median price (hl2), 13 in the classic setup.'),
        intInput('teethLength', 'Teeth Length', 8, 1, 5000, 'Smoothing length of the Teeth SMMA of median price (hl2), 8 in the classic setup.'),
        intInput('lipsLength', 'Lips Length', 5, 1, 5000, 'Smoothing length of the Lips SMMA of median price (hl2), 5 in the classic setup.'),
        intInput('jawOffset', 'Jaw Offset', 8, 0, 100, 'Number of bars the Jaw plot is shifted into the future, 8 in the classic setup.'),
        intInput('teethOffset', 'Teeth Offset', 5, 0, 100, 'Number of bars the Teeth plot is shifted into the future, 5 in the classic setup.'),
        intInput('lipsOffset', 'Lips Offset', 3, 0, 100, 'Number of bars the Lips plot is shifted into the future, 3 in the classic setup.'),
        colorInput(JAW_COLOR, 'Jaw', 'jawColor', 'Color of the Jaw line.'),
        colorInput(TEETH_COLOR, 'Teeth', 'teethColor', 'Color of the Teeth line.'),
        colorInput(LIPS_COLOR, 'Lips', 'lipsColor', 'Color of the Lips line.'),
    ],
    compute: (bars, inputs) => {
        const hl2 = sourceValues(bars, 'HL2');
        // Offsets plot each balance line within the available bars (no future timestamps to plot onto).
        const jaw = shift(rma(hl2, num(inputs, 'jawLength', 13)), num(inputs, 'jawOffset', 8));
        const teeth = shift(rma(hl2, num(inputs, 'teethLength', 8)), num(inputs, 'teethOffset', 5));
        const lips = shift(rma(hl2, num(inputs, 'lipsLength', 5)), num(inputs, 'lipsOffset', 3));
        return {
            plots: [
                { key: 'jaw', title: 'Jaw', values: jaw, color: str(inputs, 'jawColor', JAW_COLOR) },
                { key: 'teeth', title: 'Teeth', values: teeth, color: str(inputs, 'teethColor', TEETH_COLOR) },
                { key: 'lips', title: 'Lips', values: lips, color: str(inputs, 'lipsColor', LIPS_COLOR) },
            ],
        };
    },
};

const GATOR_LINES = 'Alligator Lines';
const SMMA_TYPE = 'SMMA (Wilder)';

const gator: ClassicIndicatorSpec = {
    type: 'gator-oscillator',
    title: 'Gator Oscillator',
    shortTitle: 'Gator Oscillator',
    overlay: false,
    inputs: [
        { ...sourceInput('HL2', 'source', 'Source', "Price series fed to the three Alligator averages. Bill Williams' original recipe uses the median price (high + low) / 2."), group: GATOR_LINES },
        { ...optionInput('maType', 'Smoothing', SMMA_TYPE, [SMMA_TYPE, 'SMA', 'EMA'], 'Moving average applied to the source for the jaw, teeth and lips. The original uses the smoothed (Wilder-style) moving average.'), group: GATOR_LINES },
        { ...intInput('jawLength', 'Jaw Length', 13, 1, 500, 'Averaging length of the jaw line.'), group: GATOR_LINES },
        { ...intInput('jawOffset', 'Jaw Offset', 8, 0, 100, 'Bars the jaw is displaced forward, 8 in the original recipe. The upper histogram measures the absolute spread between the displaced jaw and teeth.'), group: GATOR_LINES },
        { ...intInput('teethLength', 'Teeth Length', 8, 1, 500, 'Averaging length of the teeth line.'), group: GATOR_LINES },
        { ...intInput('teethOffset', 'Teeth Offset', 5, 0, 100, 'Bars the teeth are displaced forward, 5 in the original recipe. The teeth line enters both spreads.'), group: GATOR_LINES },
        { ...intInput('lipsLength', 'Lips Length', 5, 1, 500, 'Averaging length of the lips line.'), group: GATOR_LINES },
        { ...intInput('lipsOffset', 'Lips Offset', 3, 0, 100, 'Bars the lips are displaced forward, 3 in the original recipe. The lower histogram measures the negative absolute spread between the displaced teeth and lips.'), group: GATOR_LINES },
        colorInput(BULLISH, 'Expanding', 'growColor', 'Column color while a spread grew against its own previous bar — the averages are spreading apart.'),
        colorInput(BEARISH, 'Contracting', 'shrinkColor', 'Column color while a spread shrank — the averages are converging. Color encodes expansion, not trade direction.'),
        colorInput(NEUTRAL, 'Zero Line', 'zeroColor', 'Color of the zero line separating the two histograms.'),
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
                { key: 'upper', title: 'Upper Histogram (Jaw - Teeth)', values: upper, kind: 'columns', color: grow, colors: expansionColors(upper), base: 0 },
                { key: 'lower', title: 'Lower Histogram (Teeth - Lips)', values: map(lower, (x) => -x), kind: 'columns', color: shrink, colors: expansionColors(lower), base: 0 },
            ],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'solid', title: 'Zero Line' }],
        };
    },
};

export const bandSpecs: ClassicIndicatorSpec[] = [bollingerBands, percentB, bandwidth, keltner, donchian, chandelier, chandeKroll, supertrend, alligator, gator];
