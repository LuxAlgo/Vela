import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema } from '../../model/inputs';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicBand, ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { SETTINGS, STYLE, anchorPlot, baselineGradient, boolInput, boundedOscillator, centeredOscillator, colorInput, floatInput, intInput, lengthInput, optionInput, sourceInput, transp } from './shared';
import { volumes, closes, highs, lows, sourceValues, ema, sma, wma, rma, stdev, sum, change, cumSum, zip, map, sub, shift } from './math';

/**
 * Volume studies. All of them read the bars' own volume; bars without a volume
 * report become gaps (never fake zeros), which the math module's NaN handling
 * carries through every derived line.
 */

/** Close-location value × volume (the accumulation/distribution money-flow term). */
function moneyFlowVolume(bars: readonly OHLCV[]): number[] {
    return bars.map((b) => {
        if (b.volume == null || !Number.isFinite(b.volume)) return Number.NaN;
        if (b.high === b.low) return 0;
        return ((2 * b.close - b.high - b.low) / (b.high - b.low)) * b.volume;
    });
}

/** Per-bar ink from the line's own slope, holding the last color through a flat bar. */
function slopeColors(values: readonly number[], bull: string, bear: string, flat: string): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 ? values[i - 1]! : Number.NaN;
        if (!Number.isFinite(prev)) return flat;
        return x > prev ? bull : x < prev ? bear : flat;
    });
}

/** A cumulative index seeded at `base` that compounds only on the sessions `when` accepts. */
function volumeIndex(bars: readonly OHLCV[], src: readonly number[], base: number, when: (vol: number, prevVol: number) => boolean): number[] {
    const out = new Array<number>(bars.length).fill(Number.NaN);
    let index = base;
    for (let i = 0; i < bars.length; i++) {
        const v = bars[i]!.volume;
        const pv = i > 0 ? bars[i - 1]!.volume : null;
        const prev = i > 0 ? src[i - 1]! : Number.NaN;
        const active = v != null && pv != null && Number.isFinite(v) && Number.isFinite(pv) && when(v, pv);
        if (active && Number.isFinite(prev) && prev !== 0) index *= 1 + (src[i]! - prev) / prev;
        out[i] = index;
    }
    return out;
}

/**
 * The NVI/PVI look: a cumulative line colored by its side of a long signal average,
 * washed toward that average. Both indices differ only in which sessions move them.
 */
function regimeIndex(
    key: string,
    title: string,
    values: number[],
    signal: number[],
    ink: { bull: string; bear: string; neutral: string; signal: string },
    showSignal: boolean,
    gradientFill: boolean,
    singleColor = false,
): { plots: ClassicPlot[]; bands: ClassicBand[] } {
    const inkOf = (i: number): string => {
        const s = signal[i]!;
        const x = values[i]!;
        if (singleColor || !Number.isFinite(s)) return ink.neutral;
        return x > s ? ink.bull : x < s ? ink.bear : ink.neutral;
    };
    const plots: ClassicPlot[] = [
        {
            key: 'signal',
            title: 'Signal EMA',
            values: signal,
            color: ink.signal,
            ...(showSignal ? {} : { display: { pane: false } }),
        },
        { key, title, values, color: ink.neutral, width: 2, colors: values.map((x, i) => (Number.isFinite(x) ? inkOf(i) : null)) },
    ];
    const bands: ClassicBand[] = gradientFill
        ? [
              {
                  key: 'regime',
                  from: key,
                  to: 'signal',
                  color: transp(NEUTRAL, 100),
                  gradient: values.map((x, i) => {
                      const s = signal[i]!;
                      if (!Number.isFinite(x) || !Number.isFinite(s)) return null;
                      const above = x > s;
                      const c = above ? ink.bull : ink.bear;
                      return { topValue: Math.max(x, s), bottomValue: Math.min(x, s), topColor: transp(c, above ? 50 : 100), bottomColor: transp(c, above ? 100 : 50) };
                  }),
              },
          ]
        : [];
    return { plots, bands };
}

const obv: ClassicIndicatorSpec = {
    type: 'on-balance-volume',
    title: 'On Balance Volume',
    shortTitle: 'OBV',
    overlay: false,
    inputs: [
        boolInput('smoothing', 'Smoothing MA', false, SETTINGS, 'Display a moving average of OBV to act as a smoothing/signal line.'),
        optionInput('maType', 'MA Type', 'SMA', ['SMA', 'EMA', 'WMA', 'RMA (SMMA)'], 'Moving average type used for the smoothing MA.'),
        lengthInput(20, 'maLength', 'MA Length', 5000, 'Number of bars used for the smoothing MA.'),
        colorInput(INFO, 'OBV', 'color', 'Color of the OBV line.'),
        colorInput(WARNING, 'Smoothing MA', 'maColor', 'Color of the smoothing MA line.'),
    ],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const d = change(closes(bars));
        const values = cumSum(zip(vol, d, (v, x) => (x > 0 ? v : x < 0 ? -v : 0)));
        const plots: ClassicPlot[] = [{ key: 'obv', title: 'OBV', values, color: str(inputs, 'color', INFO) }];
        if (bool(inputs, 'smoothing', false)) {
            const len = num(inputs, 'maLength', 20);
            const kind = str(inputs, 'maType', 'SMA');
            const ma = kind === 'EMA' ? ema(values, len) : kind === 'WMA' ? wma(values, len) : kind === 'RMA (SMMA)' ? rma(values, len) : sma(values, len);
            plots.push({ key: 'ma', title: 'Smoothing MA', values: ma, color: str(inputs, 'maColor', WARNING) });
        }
        return { plots };
    },
};

const accDist: ClassicIndicatorSpec = {
    type: 'accumulation-distribution',
    title: 'Accumulation / Distribution',
    shortTitle: 'A/D',
    overlay: false,
    inputs: [
        boolInput('slopeColoring', 'Slope Coloring', true, STYLE, 'Color the line by its slope — bullish while rising (accumulation), bearish while falling (distribution).'),
        colorInput(NEUTRAL, 'A/D Line', 'color', 'Color of the line when slope coloring is disabled or the line is flat.'),
        colorInput(BULLISH, 'Rising', 'bullColor', 'Line color while the A/D Line rises.'),
        colorInput(BEARISH, 'Falling', 'bearColor', 'Line color while the A/D Line falls.'),
    ],
    compute: (bars, inputs) => {
        const values = cumSum(moneyFlowVolume(bars));
        const flat = str(inputs, 'color', NEUTRAL);
        return {
            plots: [
                {
                    key: 'ad',
                    title: 'A/D',
                    values,
                    color: flat,
                    ...(bool(inputs, 'slopeColoring', true) ? { colors: slopeColors(values, str(inputs, 'bullColor', BULLISH), str(inputs, 'bearColor', BEARISH), flat) } : {}),
                },
            ],
        };
    },
};

const cmf: ClassicIndicatorSpec = {
    type: 'chaikin-money-flow',
    title: 'Chaikin Money Flow',
    shortTitle: 'CMF',
    overlay: false,
    inputs: [
        lengthInput(20, 'length', 'Length', 5000, 'Lookback length over which money flow volume and volume are summed.'),
        colorInput(NEUTRAL, 'CMF Line', 'color', 'Color of the Chaikin Money Flow line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while the CMF reads above zero (net money flowing in).'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while the CMF reads below zero (net money flowing out).'),
        colorInput(NEUTRAL, 'Zero Line', 'zeroColor', 'Color of the zero reference line.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const values = zip(sum(moneyFlowVolume(bars), len), sum(volumes(bars), len), (m, v) => (v === 0 ? 0 : m / v));
        return centeredOscillator({
            key: 'cmf',
            title: 'CMF',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

const chaikinOscillator: ClassicIndicatorSpec = {
    type: 'chaikin-oscillator',
    title: 'Chaikin Oscillator',
    shortTitle: 'Chaikin Osc',
    overlay: false,
    inputs: [
        lengthInput(3, 'fastLength', 'Fast Length', 5000, 'Length of the fast EMA applied to the accumulation/distribution line.'),
        lengthInput(10, 'slowLength', 'Slow Length', 5000, 'Length of the slow EMA applied to the accumulation/distribution line.'),
        colorInput(NEUTRAL, 'Oscillator', 'color', 'Color of the Chaikin Oscillator line.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Line and fill color while the oscillator reads above zero (accumulation).'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Line and fill color while the oscillator reads below zero (distribution).'),
    ],
    compute: (bars, inputs) => {
        const ad = cumSum(moneyFlowVolume(bars));
        const values = sub(ema(ad, num(inputs, 'fastLength', 3)), ema(ad, num(inputs, 'slowLength', 10)));
        return centeredOscillator({
            key: 'co',
            title: 'Chaikin Oscillator',
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
        });
    },
};

const eom: ClassicIndicatorSpec = {
    type: 'ease-of-movement',
    title: 'Ease of Movement',
    shortTitle: 'EOM',
    overlay: false,
    inputs: [
        lengthInput(14, 'length', 'Length', 5000, 'Number of bars in the simple moving average smoothing the 1-bar Ease of Movement values.'),
        intInput('divisor', 'Divisor', 10000, 1, 1000000000, 'Volume scaling constant of the box ratio; larger values scale the oscillator up. 10000 is the conventional default.'),
        colorInput(NEUTRAL, 'EOM Line', 'color', 'Color of the line when it sits exactly at zero.'),
        colorInput(BULLISH, 'Above Zero', 'bullColor', 'Color of the line and fill while Ease of Movement is positive.'),
        colorInput(BEARISH, 'Below Zero', 'bearColor', 'Color of the line and fill while Ease of Movement is negative.'),
    ],
    compute: (bars, inputs) => {
        const div = num(inputs, 'divisor', 10000);
        const move = change(sourceValues(bars, 'HL2'));
        const raw = bars.map((b, i) => {
            const m = move[i]!;
            if (b.volume == null || !Number.isFinite(b.volume) || !Number.isFinite(m)) return Number.NaN;
            return b.volume === 0 ? 0 : (div * m * (b.high - b.low)) / b.volume;
        });
        return centeredOscillator({
            key: 'eom',
            title: 'EOM',
            values: sma(raw, num(inputs, 'length', 14)),
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
        });
    },
};

const forceIndex: ClassicIndicatorSpec = {
    type: 'force-index',
    title: 'Force Index',
    shortTitle: 'FI',
    overlay: false,
    inputs: [
        lengthInput(13, 'length', 'Length', 5000, 'EMA length applied to the raw 1-bar force index, (close − close[1]) × volume. Elder used 13 for the intermediate trend and 2 for short-term timing.'),
        colorInput(BULLISH, 'Force Index', 'color', 'Color of the line while above zero (buying pressure).'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the line while below zero (selling pressure).'),
    ],
    compute: (bars, inputs) => {
        const raw = zip(change(closes(bars)), volumes(bars), (d, v) => d * v);
        const bull = str(inputs, 'color', BULLISH);
        return centeredOscillator({
            key: 'force',
            title: 'Force Index',
            values: ema(raw, num(inputs, 'length', 13)),
            // The reference reads an exact zero as buying pressure, so neutral shares the bull ink.
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: NEUTRAL,
            width: 2,
            valueTransparency: 60,
        });
    },
};

const klinger: ClassicIndicatorSpec = {
    type: 'klinger-oscillator',
    title: 'Klinger Oscillator',
    shortTitle: 'KVO',
    overlay: false,
    inputs: [
        lengthInput(34, 'fastLength', 'Fast Length', 5000, 'Length of the fast EMA applied to the volume force.'),
        lengthInput(55, 'slowLength', 'Slow Length', 5000, 'Length of the slow EMA applied to the volume force.'),
        lengthInput(13, 'signalLength', 'Signal Length', 500, 'Length of the EMA applied to the oscillator to obtain the signal line.'),
        colorInput(BULLISH, 'Bullish', 'color', 'Color of the Klinger oscillator while above zero.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the Klinger oscillator while below zero.'),
        colorInput(WARNING, 'Signal', 'signalColor', 'Color of the signal line.'),
    ],
    compute: (bars, inputs) => {
        const n = bars.length;
        const force = new Array<number>(n).fill(Number.NaN);
        let trend = 1;
        let prevTrend = 1;
        let cm = 0;
        let prevDm = 0;
        for (let i = 0; i < n; i++) {
            const b = bars[i]!;
            const hlc = b.high + b.low + b.close;
            const prevHlc = i > 0 ? bars[i - 1]!.high + bars[i - 1]!.low + bars[i - 1]!.close : hlc;
            trend = hlc > prevHlc ? 1 : -1;
            const dm = b.high - b.low;
            // The cumulative measurement resets to the previous bar's range whenever the trend flips.
            cm = i > 0 && trend === prevTrend ? cm + dm : prevDm + dm;
            const v = b.volume;
            force[i] = v == null || !Number.isFinite(v) ? Number.NaN : cm === 0 ? 0 : v * Math.abs(2 * (dm / cm) - 1) * trend * 100;
            prevTrend = trend;
            prevDm = dm;
        }
        const line = sub(ema(force, num(inputs, 'fastLength', 34)), ema(force, num(inputs, 'slowLength', 55)));
        const bull = str(inputs, 'color', BULLISH);
        return centeredOscillator({
            key: 'kvo',
            title: 'KVO',
            values: line,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: transp(NEUTRAL, 50),
            valueTransparency: 60,
            extraPlots: [{ key: 'signal', title: 'Signal', values: ema(line, num(inputs, 'signalLength', 13)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const mfi: ClassicIndicatorSpec = {
    type: 'money-flow-index',
    title: 'Money Flow Index',
    shortTitle: 'MFI',
    overlay: false,
    inputs: [
        lengthInput(14, 'length', 'Length', 5000, 'Number of bars used to sum positive and negative money flow.'),
        floatInput('overbought', 'Overbought Level', 80, 0, 100, 1, 'Level above which the MFI is considered overbought.'),
        floatInput('oversold', 'Oversold Level', 20, 0, 100, 1, 'Level below which the MFI is considered oversold.'),
        colorInput(NEUTRAL, 'MFI', 'color', 'Color of the MFI line between the levels. Toward either level it blends into that level’s color.'),
        colorInput(BEARISH, 'Overbought', 'overboughtColor', 'Color of the line and zone shading at and above the overbought level.'),
        colorInput(BULLISH, 'Oversold', 'oversoldColor', 'Color of the line and zone shading at and below the oversold level.'),
        colorInput(transp(NEUTRAL, 94), 'OB/OS Zone Fill', 'fillColor', 'Fill color of the area between the overbought and oversold levels.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const tp = sourceValues(bars, 'HLC3');
        const rawFlow = zip(tp, volumes(bars), (p, v) => p * v);
        const d = change(tp);
        const pos = sum(zip(rawFlow, d, (f, x) => (x > 0 ? f : 0)), len);
        const neg = sum(zip(rawFlow, d, (f, x) => (x < 0 ? f : 0)), len);
        const values = zip(pos, neg, (p, w) => (p + w > 0 ? (100 * p) / (p + w) : Number.NaN));
        return boundedOscillator({
            key: 'mfi',
            title: 'MFI',
            values,
            scale: { top: 100, bottom: 0 },
            overbought: num(inputs, 'overbought', 80),
            oversold: num(inputs, 'oversold', 20),
            ink: { low: str(inputs, 'oversoldColor', BULLISH), mid: str(inputs, 'color', NEUTRAL), high: str(inputs, 'overboughtColor', BEARISH) },
            levelInk: NEUTRAL,
            zoneTransparency: 91,
            bandFill: str(inputs, 'fillColor', transp(NEUTRAL, 94)),
        });
    },
};

/** The style inputs NVI and PVI share. */
function regimeStyleInputs(signalTitle: string): InputSchema[] {
    return [
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the line and gradient fill while it holds above its signal EMA.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the line and gradient fill while it holds below its signal EMA.'),
        colorInput(NEUTRAL, 'Neutral', 'neutralColor', 'Color used while the signal EMA is still forming, or the line sits exactly on it.'),
        colorInput(NEUTRAL, signalTitle, 'signalColor', 'Color of the signal EMA overlay.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the gap between the line and its signal EMA with a vertical gradient — transparent at the average, strongest at the line.'),
    ];
}

const NVI_POSITION = 'Position vs Average';
const NVI_SINGLE = 'Single Color';

const nvi: ClassicIndicatorSpec = {
    type: 'negative-volume-index',
    title: 'Negative Volume Index',
    shortTitle: 'Negative Volume Index',
    overlay: false,
    inputs: [
        floatInput('base', 'Base Level', 1000, 0.01, 1000000, 1, 'Arbitrary seed of the cumulative line, conventionally 1000. The absolute level carries no information — the line is read by slope and by position against the signal EMA.'),
        boolInput('showSignal', 'Signal EMA', true, SETTINGS, 'Displays the conventional signal overlay. Hiding it only removes the plotted average; the regime coloring and fill still use it.'),
        lengthInput(255, 'signalLength', 'Signal Length', 5000, 'Length of the signal EMA. The convention is one trading year — 255 sessions on daily charts.'),
        optionInput('colorMode', 'Line Coloring', NVI_POSITION, [NVI_POSITION, NVI_SINGLE], "'Position vs Average' colors the line by the classic regime read; 'Single Color' draws the whole line in the neutral color."),
        ...regimeStyleInputs('Signal EMA'),
    ],
    compute: (bars, inputs) => {
        const values = volumeIndex(bars, closes(bars), num(inputs, 'base', 1000), (v, pv) => v < pv);
        const signal = ema(values, num(inputs, 'signalLength', 255));
        return regimeIndex(
            'nvi',
            'NVI',
            values,
            signal,
            { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'neutralColor', NEUTRAL), signal: str(inputs, 'signalColor', NEUTRAL) },
            bool(inputs, 'showSignal', true),
            bool(inputs, 'gradientFill', true),
            str(inputs, 'colorMode', NVI_POSITION) === NVI_SINGLE,
        );
    },
};

const pvi: ClassicIndicatorSpec = {
    type: 'positive-volume-index',
    title: 'Positive Volume Index',
    shortTitle: 'Positive Volume Index',
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', 'Source', 'Price series whose one-bar percentage change moves PVI on its active sessions.'),
        floatInput('base', 'Starting Value', 1000, 1, 1000000, 1, 'Seed of the cumulative line. The absolute level carries no information, so the reads are the slope and the position against the signal EMA.'),
        boolInput('showSignal', 'Signal EMA', true, SETTINGS, 'Plots the long EMA of PVI that anchors the classic regime read. Hiding it keeps the regime coloring and fill, which are always measured against it.'),
        lengthInput(255, 'signalLength', 'Signal Length', 5000, 'Length of the signal EMA. The classic reference is a one-year average — 255 trading days on daily charts.'),
        ...regimeStyleInputs('Signal Line'),
    ],
    compute: (bars, inputs) => {
        const src = sourceValues(bars, str(inputs, 'source', 'Close'));
        const values = volumeIndex(bars, src, num(inputs, 'base', 1000), (v, pv) => v > pv);
        const signal = ema(values, num(inputs, 'signalLength', 255));
        return regimeIndex(
            'pvi',
            'PVI',
            values,
            signal,
            { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'neutralColor', NEUTRAL), signal: str(inputs, 'signalColor', NEUTRAL) },
            bool(inputs, 'showSignal', true),
            bool(inputs, 'gradientFill', true),
        );
    },
};

const pvt: ClassicIndicatorSpec = {
    type: 'price-volume-trend',
    title: 'Price Volume Trend',
    shortTitle: 'PVT',
    overlay: false,
    inputs: [
        boolInput('showSignal', 'Signal Line', false, SETTINGS, 'Display a moving average of PVT acting as a signal line.'),
        optionInput('signalType', 'Signal Type', 'SMA', ['SMA', 'EMA'], 'Moving average type used for the signal line.'),
        lengthInput(21, 'signalLength', 'Signal Length', 5000, 'Number of bars used to compute the signal line.'),
        colorInput(NEUTRAL, 'PVT Color', 'color', 'Color of the PVT line while it is flat.'),
        colorInput(BULLISH, 'Rising', 'bullColor', 'Color of the PVT line while it rises bar to bar.'),
        colorInput(BEARISH, 'Falling', 'bearColor', 'Color of the PVT line while it falls bar to bar.'),
        colorInput(WARNING, 'Signal Color', 'signalColor', 'Color of the signal line.'),
    ],
    compute: (bars, inputs) => {
        const c = closes(bars);
        const raw = bars.map((b, i) => {
            if (i === 0 || b.volume == null || !Number.isFinite(b.volume)) return Number.NaN;
            const pc = c[i - 1]!;
            return pc === 0 ? 0 : ((c[i]! - pc) / pc) * b.volume;
        });
        const values = cumSum(raw);
        const flat = str(inputs, 'color', NEUTRAL);
        const plots: ClassicPlot[] = [
            { key: 'pvt', title: 'PVT', values, color: flat, width: 2, colors: slopeColors(values, str(inputs, 'bullColor', BULLISH), str(inputs, 'bearColor', BEARISH), flat) },
        ];
        if (bool(inputs, 'showSignal', false)) {
            const len = num(inputs, 'signalLength', 21);
            const signal = str(inputs, 'signalType', 'SMA') === 'EMA' ? ema(values, len) : sma(values, len);
            plots.push({ key: 'signal', title: 'Signal', values: signal, color: str(inputs, 'signalColor', WARNING) });
        }
        return { plots };
    },
};

const volumeOscillator: ClassicIndicatorSpec = {
    type: 'volume-oscillator',
    title: 'Volume Oscillator',
    shortTitle: 'Vol Osc',
    overlay: false,
    inputs: [
        lengthInput(5, 'fastLength', 'Fast Length', 5000, 'Length of the fast EMA of volume.'),
        lengthInput(10, 'slowLength', 'Slow Length', 5000, 'Length of the slow EMA of volume.'),
        colorInput(BULLISH, 'Above Zero', 'color', 'Color of the line and fill while it holds above zero — volume expanding.'),
        colorInput(BEARISH, 'Below Zero', 'bearColor', 'Color of the line and fill while it holds below zero — volume contracting.'),
    ],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const fast = ema(vol, num(inputs, 'fastLength', 5));
        const slow = ema(vol, num(inputs, 'slowLength', 10));
        const values = zip(fast, slow, (f, s) => (s === 0 ? 0 : (100 * (f - s)) / s));
        const bull = str(inputs, 'color', BULLISH);
        return centeredOscillator({
            key: 'vo',
            title: 'Volume Oscillator',
            values,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: NEUTRAL,
            valueTransparency: 60,
        });
    },
};

const OSCILLATOR = 'Oscillator';

const pvo: ClassicIndicatorSpec = {
    type: 'pvo',
    title: 'Percentage Volume Oscillator',
    shortTitle: 'PVO',
    overlay: false,
    inputs: [
        { ...lengthInput(12, 'fastLength', 'Fast Length', 5000, 'Period of the fast EMA of volume. The conventional setting is 12.'), group: OSCILLATOR },
        { ...lengthInput(26, 'slowLength', 'Slow Length', 5000, 'Period of the slow EMA of volume. The PVO expresses the fast/slow spread as a percentage of this slow average.'), group: OSCILLATOR },
        { ...lengthInput(9, 'signalLength', 'Signal Length', 500, 'Period of the EMA applied to the PVO to form the signal line.'), group: OSCILLATOR },
        colorInput(BULLISH, 'Expansion Color', 'color', 'Color of the oscillator and fill while participation expands.'),
        colorInput(BEARISH, 'Contraction Color', 'bearColor', 'Color of the oscillator and fill while participation contracts.'),
        colorInput(WARNING, 'Signal Line', 'signalColor', 'Color of the signal line.'),
        colorInput(transp(NEUTRAL, 50), 'Zero Line', 'zeroColor', 'Color of the zero reference line.'),
        boolInput('showSignal', 'Show Signal Line', true, STYLE, 'Plot the signal line, an EMA of the PVO.'),
        boolInput('showHistogram', 'Show Histogram', true, STYLE, 'Plot the difference between the PVO and its signal line as columns behind the oscillator.'),
    ],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const fast = ema(vol, num(inputs, 'fastLength', 12));
        const slow = ema(vol, num(inputs, 'slowLength', 26));
        const values = zip(fast, slow, (f, s) => (s > 0 ? (100 * (f - s)) / s : Number.NaN));
        const signal = ema(values, num(inputs, 'signalLength', 9));
        const expansion = str(inputs, 'color', BULLISH);
        const contraction = str(inputs, 'bearColor', BEARISH);
        const extraPlots: ClassicPlot[] = [];
        if (bool(inputs, 'showHistogram', true)) {
            const hist = sub(values, signal);
            extraPlots.push({
                key: 'hist',
                title: 'Histogram',
                values: hist,
                kind: 'columns',
                color: transp(expansion, 60),
                colors: hist.map((x) => (Number.isFinite(x) ? transp(x > 0 ? expansion : contraction, 60) : null)),
                base: 0,
            });
        }
        if (bool(inputs, 'showSignal', true)) extraPlots.push({ key: 'signal', title: 'Signal', values: signal, color: str(inputs, 'signalColor', WARNING) });
        return centeredOscillator({
            key: 'pvo',
            title: 'PVO',
            values,
            ink: { bull: expansion, bear: contraction, neutral: contraction },
            zeroInk: str(inputs, 'zeroColor', transp(NEUTRAL, 50)),
            extraPlots,
        });
    },
};

const vfi: ClassicIndicatorSpec = {
    type: 'volume-flow-indicator',
    title: 'Volume Flow Indicator',
    shortTitle: 'Volume Flow Indicator',
    overlay: false,
    inputs: [
        { ...lengthInput(130, 'length', 'Length', 5000, 'Rolling summation window, also used for the average volume that scales the result. The published default of 130 bars targets position-horizon work on daily charts.'), min: 2 },
        floatInput('coef', 'Cutoff Coefficient', 0.2, 0, 10, 0.05, "Scales the volatility-based minimum change in typical price. Moves smaller than the cutoff count as noise and contribute no volume."),
        floatInput('volCoef', 'Volume Cap Multiplier', 2.5, 0.1, 50, 0.1, "Caps each bar's volume contribution at this multiple of the average volume, so a single climactic print stays bounded."),
        { ...lengthInput(30, 'volLength', 'Volatility Length', 5000, 'Window of the standard deviation of the log change in typical price used to build the adaptive cutoff.'), min: 2 },
        boolInput('smooth', 'Smooth VFI', true, SETTINGS, 'Applies the published light smoothing — an EMA of the summed line — before plotting.'),
        lengthInput(3, 'smoothLength', 'Smoothing Length', 500, 'Length of the smoothing EMA. The published version uses 3 bars.'),
        boolInput('showSignal', 'Signal Line', true, SETTINGS, 'Plots an EMA of VFI as a signal line.'),
        lengthInput(5, 'signalLength', 'Signal Length', 500, 'Length of the signal-line EMA.'),
        colorInput(BULLISH, 'Bullish', 'color', 'Color of the VFI line and gradient fill above the zero line — the net accumulation regime.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the VFI line and gradient fill below the zero line — the net distribution regime.'),
        colorInput(WARNING, 'Signal Line', 'signalColor', 'Color of the signal line.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the area between the zero line and the VFI line with a vertical gradient.'),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 130);
        const typical = sourceValues(bars, 'HLC3');
        const logChange = sub(map(typical, Math.log), shift(map(typical, Math.log), 1));
        const volatility = stdev(logChange, num(inputs, 'volLength', 30));
        const coef = num(inputs, 'coef', 0.2);
        const volCoef = num(inputs, 'volCoef', 2.5);
        const vol = volumes(bars);
        // The cap reads the PREVIOUS bar's average, so the current bar never scales itself.
        const avgVolume = shift(sma(vol, len), 1);
        const typicalChange = change(typical);
        const signed = bars.map((b, i) => {
            const sd = volatility[i]!;
            const m = typicalChange[i]!;
            const v = vol[i]!;
            if (!Number.isFinite(sd) || !Number.isFinite(m) || !Number.isFinite(v)) return Number.NaN;
            const cutoff = coef * sd * b.close;
            const avg = avgVolume[i]!;
            const capped = Number.isFinite(avg) ? Math.min(v, avg * volCoef) : v;
            return m > cutoff ? capped : m < -cutoff ? -capped : 0;
        });
        const raw = zip(sum(signed, len), avgVolume, (f, a) => (a > 0 ? f / a : Number.NaN));
        const values = bool(inputs, 'smooth', true) ? ema(raw, num(inputs, 'smoothLength', 3)) : raw;
        const bull = str(inputs, 'color', BULLISH);
        const extraPlots: ClassicPlot[] = bool(inputs, 'showSignal', true)
            ? [{ key: 'signal', title: 'Signal Line', values: ema(values, num(inputs, 'signalLength', 5)), color: str(inputs, 'signalColor', WARNING) }]
            : [];
        return centeredOscillator({
            key: 'vfi',
            title: 'VFI',
            values,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'bearColor', BEARISH) },
            zeroInk: transp(NEUTRAL, 90),
            fill: bool(inputs, 'gradientFill', true),
            extraPlots,
        });
    },
};

const II_OSCILLATOR = 'Normalized Oscillator (II%)';
const II_CUMULATIVE = 'Cumulative Line';

const intradayIntensity: ClassicIndicatorSpec = {
    type: 'intraday-intensity',
    title: 'Intraday Intensity',
    shortTitle: 'Intraday Intensity',
    overlay: false,
    inputs: [
        optionInput('mode', 'Display', II_OSCILLATOR, [II_OSCILLATOR, II_CUMULATIVE], "The two published forms. The cumulative line is open-ended and read by slope against price; the normalized oscillator divides a rolling sum of intensity by the rolling sum of volume and oscillates around zero."),
        lengthInput(21, 'length', 'Oscillator Length', 5000, 'Window of the rolling sums in the normalized form. The common setting is 21 bars. It has no effect on the cumulative line.'),
        colorInput(BULLISH, 'Bullish', 'color', 'Color of positive readings, the rising cumulative line and the fill above zero — the accumulation side.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of negative readings, the falling cumulative line and the fill below zero — the distribution side.'),
        boolInput('gradientFill', 'Gradient Fill', true, STYLE, 'Fills the area between the zero line and the oscillator with a vertical gradient. Applies to the normalized oscillator only.'),
    ],
    compute: (bars, inputs) => {
        const intensity = moneyFlowVolume(bars);
        const bull = str(inputs, 'color', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        if (str(inputs, 'mode', II_OSCILLATOR) === II_CUMULATIVE) {
            // The open-ended line is read by slope, so it carries no zero line and no wash.
            const values = cumSum(intensity);
            return { plots: [{ key: 'ii', title: 'Intraday Intensity', values, color: bull, colors: slopeColors(values, bull, bear, bull) }] };
        }
        const len = num(inputs, 'length', 21);
        const values = zip(sum(intensity, len), sum(volumes(bars), len), (m, v) => (v > 0 ? (100 * m) / v : Number.NaN));
        return centeredOscillator({
            key: 'ii',
            title: 'Intraday Intensity',
            values,
            ink: { bull, bear, neutral: bear },
            zeroInk: transp(NEUTRAL, 90),
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

export const volumeSpecs: ClassicIndicatorSpec[] = [
    obv,
    accDist,
    cmf,
    chaikinOscillator,
    eom,
    forceIndex,
    klinger,
    mfi,
    nvi,
    pvi,
    pvt,
    volumeOscillator,
    pvo,
    vfi,
    intradayIntensity,
];
