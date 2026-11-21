import type { MessageLike } from '../../i18n/types';
import { msg } from '../../i18n/message';
import type { OHLCV } from '../../model/ohlcv';
import { INFO, BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicBand, ClassicIndicatorSpec, ClassicInput, ClassicPlot } from './define';
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
    title: MessageLike,
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
            title: msg('indicator.regime.plot.signal', 'Signal EMA'),
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
    title: msg('indicator.onBalanceVolume.title', 'On Balance Volume'),
    shortTitle: msg('indicator.onBalanceVolume.shortTitle', 'OBV'),
    overlay: false,
    inputs: [
        boolInput('smoothing', msg('indicator.onBalanceVolume.smoothing', 'Smoothing MA'), false, SETTINGS, msg('indicator.onBalanceVolume.smoothing.tooltip', 'Display a moving average of OBV to act as a smoothing/signal line.')),
        optionInput('maType', msg('indicator.onBalanceVolume.maType', 'MA Type'), 'SMA', ['SMA', 'EMA', 'WMA', 'RMA (SMMA)'], msg('indicator.onBalanceVolume.maType.tooltip', 'Moving average type used for the smoothing MA.')),
        lengthInput(20, 'maLength', msg('indicator.onBalanceVolume.maLength', 'MA Length'), 5000, msg('indicator.onBalanceVolume.maLength.tooltip', 'Number of bars used for the smoothing MA.')),
        colorInput(INFO, msg('indicator.onBalanceVolume.color', 'OBV'), 'color', msg('indicator.onBalanceVolume.color.tooltip', 'Color of the OBV line.')),
        colorInput(WARNING, msg('indicator.onBalanceVolume.maColor', 'Smoothing MA'), 'maColor', msg('indicator.onBalanceVolume.maColor.tooltip', 'Color of the smoothing MA line.')),
    ],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const d = change(closes(bars));
        const values = cumSum(zip(vol, d, (v, x) => (x > 0 ? v : x < 0 ? -v : 0)));
        const plots: ClassicPlot[] = [{ key: 'obv', title: msg('indicator.onBalanceVolume.plot.obv', 'OBV'), values, color: str(inputs, 'color', INFO) }];
        if (bool(inputs, 'smoothing', false)) {
            const len = num(inputs, 'maLength', 20);
            const kind = str(inputs, 'maType', 'SMA');
            const ma = kind === 'EMA' ? ema(values, len) : kind === 'WMA' ? wma(values, len) : kind === 'RMA (SMMA)' ? rma(values, len) : sma(values, len);
            plots.push({ key: 'ma', title: msg('indicator.onBalanceVolume.plot.ma', 'Smoothing MA'), values: ma, color: str(inputs, 'maColor', WARNING) });
        }
        return { plots };
    },
};

const netVolume: ClassicIndicatorSpec = {
    type: 'net-volume',
    title: msg('indicator.netVolume.title', 'Net Volume'),
    overlay: false,
    inputs: [
        colorInput(BULLISH, msg('indicator.netVolume.upColor', 'Up'), 'upColor', msg('indicator.netVolume.upColor.tooltip', 'Color of the columns on bars that close above the previous close.')),
        colorInput(BEARISH, msg('indicator.netVolume.downColor', 'Down'), 'downColor', msg('indicator.netVolume.downColor.tooltip', 'Color of the columns on bars that close below the previous close.')),
        colorInput(NEUTRAL, msg('indicator.netVolume.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.netVolume.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        // The bar's whole volume, signed by its close against the previous close; an unchanged close nets to zero.
        const values = zip(volumes(bars), change(closes(bars)), (v, d) => (d > 0 ? v : d < 0 ? -v : 0));
        const up = str(inputs, 'upColor', BULLISH);
        const down = str(inputs, 'downColor', BEARISH);
        return {
            plots: [{ key: 'net', title: msg('indicator.netVolume.plot.net', 'Net Volume'), values, kind: 'columns', color: up, colors: values.map((x) => (Number.isFinite(x) ? (x < 0 ? down : up) : null)), base: 0 }],
            levels: [{ key: 'zero', price: 0, color: str(inputs, 'zeroColor', NEUTRAL), lineStyle: 'dashed', title: msg('indicator.common.level.zero', 'Zero Line') }],
        };
    },
};

const accDist: ClassicIndicatorSpec = {
    type: 'accumulation-distribution',
    title: msg('indicator.accumulationDistribution.title', 'Accumulation / Distribution'),
    shortTitle: msg('indicator.accumulationDistribution.shortTitle', 'A/D'),
    overlay: false,
    inputs: [
        boolInput('slopeColoring', msg('indicator.accumulationDistribution.slopeColoring', 'Slope Coloring'), true, STYLE, msg('indicator.accumulationDistribution.slopeColoring.tooltip', 'Color the line by its slope — bullish while rising (accumulation), bearish while falling (distribution).')),
        colorInput(NEUTRAL, msg('indicator.accumulationDistribution.color', 'A/D Line'), 'color', msg('indicator.accumulationDistribution.color.tooltip', 'Color of the line when slope coloring is disabled or the line is flat.')),
        colorInput(BULLISH, msg('indicator.accumulationDistribution.bullColor', 'Rising'), 'bullColor', msg('indicator.accumulationDistribution.bullColor.tooltip', 'Line color while the A/D Line rises.')),
        colorInput(BEARISH, msg('indicator.accumulationDistribution.bearColor', 'Falling'), 'bearColor', msg('indicator.accumulationDistribution.bearColor.tooltip', 'Line color while the A/D Line falls.')),
    ],
    compute: (bars, inputs) => {
        const values = cumSum(moneyFlowVolume(bars));
        const flat = str(inputs, 'color', NEUTRAL);
        return {
            plots: [
                {
                    key: 'ad',
                    title: msg('indicator.accumulationDistribution.plot.ad', 'A/D'),
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
    title: msg('indicator.chaikinMoneyFlow.title', 'Chaikin Money Flow'),
    shortTitle: msg('indicator.chaikinMoneyFlow.shortTitle', 'CMF'),
    overlay: false,
    inputs: [
        lengthInput(20, 'length', msg('indicator.chaikinMoneyFlow.length', 'Length'), 5000, msg('indicator.chaikinMoneyFlow.length.tooltip', 'Lookback length over which money flow volume and volume are summed.')),
        colorInput(NEUTRAL, msg('indicator.chaikinMoneyFlow.color', 'CMF Line'), 'color', msg('indicator.chaikinMoneyFlow.color.tooltip', 'Color of the Chaikin Money Flow line.')),
        colorInput(BULLISH, msg('indicator.chaikinMoneyFlow.bullColor', 'Bullish'), 'bullColor', msg('indicator.chaikinMoneyFlow.bullColor.tooltip', 'Line and fill color while the CMF reads above zero (net money flowing in).')),
        colorInput(BEARISH, msg('indicator.chaikinMoneyFlow.bearColor', 'Bearish'), 'bearColor', msg('indicator.chaikinMoneyFlow.bearColor.tooltip', 'Line and fill color while the CMF reads below zero (net money flowing out).')),
        colorInput(NEUTRAL, msg('indicator.chaikinMoneyFlow.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.chaikinMoneyFlow.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 20);
        const values = zip(sum(moneyFlowVolume(bars), len), sum(volumes(bars), len), (m, v) => (v === 0 ? 0 : m / v));
        return centeredOscillator({
            key: 'cmf',
            title: msg('indicator.chaikinMoneyFlow.plot.cmf', 'CMF'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

const chaikinOscillator: ClassicIndicatorSpec = {
    type: 'chaikin-oscillator',
    title: msg('indicator.chaikinOscillator.title', 'Chaikin Oscillator'),
    shortTitle: msg('indicator.chaikinOscillator.shortTitle', 'Chaikin Osc'),
    overlay: false,
    inputs: [
        lengthInput(3, 'fastLength', msg('indicator.chaikinOscillator.fastLength', 'Fast Length'), 5000, msg('indicator.chaikinOscillator.fastLength.tooltip', 'Length of the fast EMA applied to the accumulation/distribution line.')),
        lengthInput(10, 'slowLength', msg('indicator.chaikinOscillator.slowLength', 'Slow Length'), 5000, msg('indicator.chaikinOscillator.slowLength.tooltip', 'Length of the slow EMA applied to the accumulation/distribution line.')),
        colorInput(NEUTRAL, msg('indicator.chaikinOscillator.color', 'Oscillator'), 'color', msg('indicator.chaikinOscillator.color.tooltip', 'Color of the Chaikin Oscillator line.')),
        colorInput(BULLISH, msg('indicator.chaikinOscillator.bullColor', 'Bullish'), 'bullColor', msg('indicator.chaikinOscillator.bullColor.tooltip', 'Line and fill color while the oscillator reads above zero (accumulation).')),
        colorInput(BEARISH, msg('indicator.chaikinOscillator.bearColor', 'Bearish'), 'bearColor', msg('indicator.chaikinOscillator.bearColor.tooltip', 'Line and fill color while the oscillator reads below zero (distribution).')),
    ],
    compute: (bars, inputs) => {
        const ad = cumSum(moneyFlowVolume(bars));
        const values = sub(ema(ad, num(inputs, 'fastLength', 3)), ema(ad, num(inputs, 'slowLength', 10)));
        return centeredOscillator({
            key: 'co',
            title: msg('indicator.chaikinOscillator.plot.co', 'Chaikin Oscillator'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
        });
    },
};

const eom: ClassicIndicatorSpec = {
    type: 'ease-of-movement',
    title: msg('indicator.easeOfMovement.title', 'Ease of Movement'),
    shortTitle: msg('indicator.easeOfMovement.shortTitle', 'EOM'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.easeOfMovement.length', 'Length'), 5000, msg('indicator.easeOfMovement.length.tooltip', 'Number of bars in the simple moving average smoothing the 1-bar Ease of Movement values.')),
        intInput('divisor', msg('indicator.easeOfMovement.divisor', 'Divisor'), 10000, 1, 1000000000, msg('indicator.easeOfMovement.divisor.tooltip', 'Volume scaling constant of the box ratio; larger values scale the oscillator up. 10000 is the conventional default.')),
        colorInput(NEUTRAL, msg('indicator.easeOfMovement.color', 'EOM Line'), 'color', msg('indicator.easeOfMovement.color.tooltip', 'Color of the line when it sits exactly at zero.')),
        colorInput(BULLISH, msg('indicator.easeOfMovement.bullColor', 'Above Zero'), 'bullColor', msg('indicator.easeOfMovement.bullColor.tooltip', 'Color of the line and fill while Ease of Movement is positive.')),
        colorInput(BEARISH, msg('indicator.easeOfMovement.bearColor', 'Below Zero'), 'bearColor', msg('indicator.easeOfMovement.bearColor.tooltip', 'Color of the line and fill while Ease of Movement is negative.')),
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
            title: msg('indicator.easeOfMovement.plot.eom', 'EOM'),
            values: sma(raw, num(inputs, 'length', 14)),
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
        });
    },
};

const forceIndex: ClassicIndicatorSpec = {
    type: 'force-index',
    title: msg('indicator.forceIndex.title', 'Force Index'),
    shortTitle: msg('indicator.forceIndex.shortTitle', 'FI'),
    overlay: false,
    inputs: [
        lengthInput(13, 'length', msg('indicator.forceIndex.length', 'Length'), 5000, msg('indicator.forceIndex.length.tooltip', 'EMA length applied to the raw 1-bar force index, (close − close[1]) × volume. Elder used 13 for the intermediate trend and 2 for short-term timing.')),
        colorInput(BULLISH, msg('indicator.forceIndex.color', 'Bullish'), 'color', msg('indicator.forceIndex.color.tooltip', 'Color of the line while above zero (buying pressure).')),
        colorInput(BEARISH, msg('indicator.forceIndex.bearColor', 'Bearish'), 'bearColor', msg('indicator.forceIndex.bearColor.tooltip', 'Color of the line while below zero (selling pressure).')),
    ],
    compute: (bars, inputs) => {
        const raw = zip(change(closes(bars)), volumes(bars), (d, v) => d * v);
        const bull = str(inputs, 'color', BULLISH);
        return centeredOscillator({
            key: 'force',
            title: msg('indicator.forceIndex.plot.force', 'Force Index'),
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
    title: msg('indicator.klingerOscillator.title', 'Klinger Oscillator'),
    shortTitle: msg('indicator.klingerOscillator.shortTitle', 'KVO'),
    overlay: false,
    inputs: [
        lengthInput(34, 'fastLength', msg('indicator.klingerOscillator.fastLength', 'Fast Length'), 5000, msg('indicator.klingerOscillator.fastLength.tooltip', 'Length of the fast EMA applied to the volume force.')),
        lengthInput(55, 'slowLength', msg('indicator.klingerOscillator.slowLength', 'Slow Length'), 5000, msg('indicator.klingerOscillator.slowLength.tooltip', 'Length of the slow EMA applied to the volume force.')),
        lengthInput(13, 'signalLength', msg('indicator.klingerOscillator.signalLength', 'Signal Length'), 500, msg('indicator.klingerOscillator.signalLength.tooltip', 'Length of the EMA applied to the oscillator to obtain the signal line.')),
        colorInput(BULLISH, msg('indicator.klingerOscillator.color', 'Bullish'), 'color', msg('indicator.klingerOscillator.color.tooltip', 'Color of the Klinger oscillator while above zero.')),
        colorInput(BEARISH, msg('indicator.klingerOscillator.bearColor', 'Bearish'), 'bearColor', msg('indicator.klingerOscillator.bearColor.tooltip', 'Color of the Klinger oscillator while below zero.')),
        colorInput(WARNING, msg('indicator.klingerOscillator.signalColor', 'Signal'), 'signalColor', msg('indicator.klingerOscillator.signalColor.tooltip', 'Color of the signal line.')),
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
            title: msg('indicator.klingerOscillator.plot.kvo', 'KVO'),
            values: line,
            ink: { bull, bear: str(inputs, 'bearColor', BEARISH), neutral: bull },
            zeroInk: transp(NEUTRAL, 50),
            valueTransparency: 60,
            extraPlots: [{ key: 'signal', title: msg('indicator.klingerOscillator.plot.signal', 'Signal'), values: ema(line, num(inputs, 'signalLength', 13)), color: str(inputs, 'signalColor', WARNING) }],
        });
    },
};

const mfi: ClassicIndicatorSpec = {
    type: 'money-flow-index',
    title: msg('indicator.moneyFlowIndex.title', 'Money Flow Index'),
    shortTitle: msg('indicator.moneyFlowIndex.shortTitle', 'MFI'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.moneyFlowIndex.length', 'Length'), 5000, msg('indicator.moneyFlowIndex.length.tooltip', 'Number of bars used to sum positive and negative money flow.')),
        floatInput('overbought', msg('indicator.moneyFlowIndex.overbought', 'Overbought Level'), 80, 0, 100, 1, msg('indicator.moneyFlowIndex.overbought.tooltip', 'Level above which the MFI is considered overbought.')),
        floatInput('oversold', msg('indicator.moneyFlowIndex.oversold', 'Oversold Level'), 20, 0, 100, 1, msg('indicator.moneyFlowIndex.oversold.tooltip', 'Level below which the MFI is considered oversold.')),
        colorInput(NEUTRAL, msg('indicator.moneyFlowIndex.color', 'MFI'), 'color', msg('indicator.moneyFlowIndex.color.tooltip', 'Color of the MFI line between the levels. Toward either level it blends into that level’s color.')),
        colorInput(BEARISH, msg('indicator.moneyFlowIndex.overboughtColor', 'Overbought'), 'overboughtColor', msg('indicator.moneyFlowIndex.overboughtColor.tooltip', 'Color of the line and zone shading at and above the overbought level.')),
        colorInput(BULLISH, msg('indicator.moneyFlowIndex.oversoldColor', 'Oversold'), 'oversoldColor', msg('indicator.moneyFlowIndex.oversoldColor.tooltip', 'Color of the line and zone shading at and below the oversold level.')),
        colorInput(transp(NEUTRAL, 94), msg('indicator.moneyFlowIndex.fillColor', 'OB/OS Zone Fill'), 'fillColor', msg('indicator.moneyFlowIndex.fillColor.tooltip', 'Fill color of the area between the overbought and oversold levels.')),
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
            title: msg('indicator.moneyFlowIndex.plot.mfi', 'MFI'),
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
function regimeStyleInputs(signalTitle: MessageLike): ClassicInput[] {
    return [
        colorInput(BULLISH, msg('indicator.common.bullColor', 'Bullish'), 'bullColor', msg('indicator.regime.bullColor.tooltip', 'Color of the line and gradient fill while it holds above its signal EMA.')),
        colorInput(BEARISH, msg('indicator.common.bearColor', 'Bearish'), 'bearColor', msg('indicator.regime.bearColor.tooltip', 'Color of the line and gradient fill while it holds below its signal EMA.')),
        colorInput(NEUTRAL, msg('indicator.common.neutralColor', 'Neutral'), 'neutralColor', msg('indicator.regime.neutralColor.tooltip', 'Color used while the signal EMA is still forming, or the line sits exactly on it.')),
        colorInput(NEUTRAL, signalTitle, 'signalColor', msg('indicator.regime.signalColor.tooltip', 'Color of the signal EMA overlay.')),
        boolInput('gradientFill', msg('indicator.regime.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.regime.gradientFill.tooltip', 'Fills the gap between the line and its signal EMA with a vertical gradient — transparent at the average, strongest at the line.')),
    ];
}

const NVI_POSITION = 'Position vs Average';
const NVI_SINGLE = 'Single Color';

const nvi: ClassicIndicatorSpec = {
    type: 'negative-volume-index',
    title: msg('indicator.negativeVolumeIndex.title', 'Negative Volume Index'),
    shortTitle: msg('indicator.negativeVolumeIndex.shortTitle', 'Negative Volume Index'),
    overlay: false,
    inputs: [
        floatInput('base', msg('indicator.negativeVolumeIndex.base', 'Starting Value'), 1000, 0.01, 1000000, 1, msg('indicator.negativeVolumeIndex.base.tooltip', 'Arbitrary seed of the cumulative line, conventionally 1000. The absolute level carries no information — the line is read by slope and by position against the signal EMA.')),
        boolInput('showSignal', msg('indicator.negativeVolumeIndex.showSignal', 'Signal EMA'), true, SETTINGS, msg('indicator.negativeVolumeIndex.showSignal.tooltip', 'Displays the conventional signal overlay. Hiding it only removes the plotted average; the regime coloring and fill still use it.')),
        lengthInput(255, 'signalLength', msg('indicator.negativeVolumeIndex.signalLength', 'Signal Length'), 5000, msg('indicator.negativeVolumeIndex.signalLength.tooltip', 'Length of the signal EMA. The convention is 255 sessions on daily charts, about one trading year.')),
        optionInput('colorMode', msg('indicator.negativeVolumeIndex.colorMode', 'Line Coloring'), NVI_POSITION, [NVI_POSITION, NVI_SINGLE], msg('indicator.negativeVolumeIndex.colorMode.tooltip', 'Position vs Average colors the line by the classic regime read; Single Color draws the whole line in the neutral color.')),
        ...regimeStyleInputs(msg('indicator.negativeVolumeIndex.signalColor', 'Signal EMA')),
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
    title: msg('indicator.positiveVolumeIndex.title', 'Positive Volume Index'),
    shortTitle: msg('indicator.positiveVolumeIndex.shortTitle', 'Positive Volume Index'),
    overlay: false,
    inputs: [
        sourceInput('Close', 'source', msg('indicator.positiveVolumeIndex.source', 'Source'), msg('indicator.positiveVolumeIndex.source.tooltip', 'Price series whose one-bar percentage change moves PVI on its active sessions.')),
        floatInput('base', msg('indicator.positiveVolumeIndex.base', 'Starting Value'), 1000, 1, 1000000, 1, msg('indicator.positiveVolumeIndex.base.tooltip', 'Seed of the cumulative line. The absolute level carries no information, so the reads are the slope and the position against the signal EMA.')),
        boolInput('showSignal', msg('indicator.positiveVolumeIndex.showSignal', 'Signal EMA'), true, SETTINGS, msg('indicator.positiveVolumeIndex.showSignal.tooltip', 'Plots the long EMA of PVI that anchors the classic regime read. Hiding it keeps the regime coloring and fill, which are always measured against it.')),
        lengthInput(255, 'signalLength', msg('indicator.positiveVolumeIndex.signalLength', 'Signal Length'), 5000, msg('indicator.positiveVolumeIndex.signalLength.tooltip', 'Length of the signal EMA. The classic reference is 255 trading days on daily charts, about one year.')),
        ...regimeStyleInputs(msg('indicator.positiveVolumeIndex.signalColor', 'Signal Line')),
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
    title: msg('indicator.priceVolumeTrend.title', 'Price Volume Trend'),
    shortTitle: msg('indicator.priceVolumeTrend.shortTitle', 'PVT'),
    overlay: false,
    inputs: [
        boolInput('showSignal', msg('indicator.priceVolumeTrend.showSignal', 'Signal Line'), false, SETTINGS, msg('indicator.priceVolumeTrend.showSignal.tooltip', 'Display a moving average of PVT acting as a signal line.')),
        optionInput('signalType', msg('indicator.priceVolumeTrend.signalType', 'Signal Type'), 'SMA', ['SMA', 'EMA'], msg('indicator.priceVolumeTrend.signalType.tooltip', 'Moving average type used for the signal line.')),
        lengthInput(21, 'signalLength', msg('indicator.priceVolumeTrend.signalLength', 'Signal Length'), 5000, msg('indicator.priceVolumeTrend.signalLength.tooltip', 'Number of bars used to compute the signal line.')),
        colorInput(NEUTRAL, msg('indicator.priceVolumeTrend.color', 'PVT Color'), 'color', msg('indicator.priceVolumeTrend.color.tooltip', 'Color of the PVT line while it is flat.')),
        colorInput(BULLISH, msg('indicator.priceVolumeTrend.bullColor', 'Rising'), 'bullColor', msg('indicator.priceVolumeTrend.bullColor.tooltip', 'Color of the PVT line while it rises bar to bar.')),
        colorInput(BEARISH, msg('indicator.priceVolumeTrend.bearColor', 'Falling'), 'bearColor', msg('indicator.priceVolumeTrend.bearColor.tooltip', 'Color of the PVT line while it falls bar to bar.')),
        colorInput(WARNING, msg('indicator.priceVolumeTrend.signalColor', 'Signal Color'), 'signalColor', msg('indicator.priceVolumeTrend.signalColor.tooltip', 'Color of the signal line.')),
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
            { key: 'pvt', title: msg('indicator.priceVolumeTrend.plot.pvt', 'PVT'), values, color: flat, width: 2, colors: slopeColors(values, str(inputs, 'bullColor', BULLISH), str(inputs, 'bearColor', BEARISH), flat) },
        ];
        if (bool(inputs, 'showSignal', false)) {
            const len = num(inputs, 'signalLength', 21);
            const signal = str(inputs, 'signalType', 'SMA') === 'EMA' ? ema(values, len) : sma(values, len);
            plots.push({ key: 'signal', title: msg('indicator.priceVolumeTrend.plot.signal', 'Signal'), values: signal, color: str(inputs, 'signalColor', WARNING) });
        }
        return { plots };
    },
};

const volumeOscillator: ClassicIndicatorSpec = {
    type: 'volume-oscillator',
    title: msg('indicator.volumeOscillator.title', 'Volume Oscillator'),
    shortTitle: msg('indicator.volumeOscillator.shortTitle', 'Vol Osc'),
    overlay: false,
    inputs: [
        lengthInput(5, 'fastLength', msg('indicator.volumeOscillator.fastLength', 'Fast Length'), 5000, msg('indicator.volumeOscillator.fastLength.tooltip', 'Length of the fast EMA of volume.')),
        lengthInput(10, 'slowLength', msg('indicator.volumeOscillator.slowLength', 'Slow Length'), 5000, msg('indicator.volumeOscillator.slowLength.tooltip', 'Length of the slow EMA of volume.')),
        colorInput(BULLISH, msg('indicator.volumeOscillator.color', 'Above Zero'), 'color', msg('indicator.volumeOscillator.color.tooltip', 'Color of the line and fill while it holds above zero — volume expanding.')),
        colorInput(BEARISH, msg('indicator.volumeOscillator.bearColor', 'Below Zero'), 'bearColor', msg('indicator.volumeOscillator.bearColor.tooltip', 'Color of the line and fill while it holds below zero — volume contracting.')),
    ],
    compute: (bars, inputs) => {
        const vol = volumes(bars);
        const fast = ema(vol, num(inputs, 'fastLength', 5));
        const slow = ema(vol, num(inputs, 'slowLength', 10));
        const values = zip(fast, slow, (f, s) => (s === 0 ? 0 : (100 * (f - s)) / s));
        const bull = str(inputs, 'color', BULLISH);
        return centeredOscillator({
            key: 'vo',
            title: msg('indicator.volumeOscillator.plot.vo', 'Volume Oscillator'),
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
    title: msg('indicator.pvo.title', 'Percentage Volume Oscillator'),
    shortTitle: msg('indicator.pvo.shortTitle', 'PVO'),
    overlay: false,
    inputs: [
        { ...lengthInput(12, 'fastLength', msg('indicator.pvo.fastLength', 'Fast Length'), 5000, msg('indicator.pvo.fastLength.tooltip', 'Period of the fast EMA of volume. The conventional setting is 12.')), group: OSCILLATOR },
        { ...lengthInput(26, 'slowLength', msg('indicator.pvo.slowLength', 'Slow Length'), 5000, msg('indicator.pvo.slowLength.tooltip', 'Period of the slow EMA of volume. The PVO expresses the fast/slow spread as a percentage of this slow average.')), group: OSCILLATOR },
        { ...lengthInput(9, 'signalLength', msg('indicator.pvo.signalLength', 'Signal Length'), 500, msg('indicator.pvo.signalLength.tooltip', 'Period of the EMA applied to the PVO to form the signal line.')), group: OSCILLATOR },
        colorInput(BULLISH, msg('indicator.pvo.color', 'Expansion Color'), 'color', msg('indicator.pvo.color.tooltip', 'Color of the oscillator and fill while participation expands.')),
        colorInput(BEARISH, msg('indicator.pvo.bearColor', 'Contraction Color'), 'bearColor', msg('indicator.pvo.bearColor.tooltip', 'Color of the oscillator and fill while participation contracts.')),
        colorInput(WARNING, msg('indicator.pvo.signalColor', 'Signal Line'), 'signalColor', msg('indicator.pvo.signalColor.tooltip', 'Color of the signal line.')),
        colorInput(transp(NEUTRAL, 50), msg('indicator.pvo.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.pvo.zeroColor.tooltip', 'Color of the zero reference line.')),
        boolInput('showSignal', msg('indicator.pvo.showSignal', 'Show Signal Line'), true, STYLE, msg('indicator.pvo.showSignal.tooltip', 'Plot the signal line, an EMA of the PVO.')),
        boolInput('showHistogram', msg('indicator.pvo.showHistogram', 'Show Histogram'), true, STYLE, msg('indicator.pvo.showHistogram.tooltip', 'Plot the difference between the PVO and its signal line as columns behind the oscillator.')),
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
                title: msg('indicator.pvo.plot.hist', 'Histogram'),
                values: hist,
                kind: 'columns',
                color: transp(expansion, 60),
                colors: hist.map((x) => (Number.isFinite(x) ? transp(x > 0 ? expansion : contraction, 60) : null)),
                base: 0,
            });
        }
        if (bool(inputs, 'showSignal', true)) extraPlots.push({ key: 'signal', title: msg('indicator.pvo.plot.signal', 'Signal'), values: signal, color: str(inputs, 'signalColor', WARNING) });
        return centeredOscillator({
            key: 'pvo',
            title: msg('indicator.pvo.plot.pvo', 'PVO'),
            values,
            ink: { bull: expansion, bear: contraction, neutral: contraction },
            zeroInk: str(inputs, 'zeroColor', transp(NEUTRAL, 50)),
            extraPlots,
        });
    },
};

const vfi: ClassicIndicatorSpec = {
    type: 'volume-flow-indicator',
    title: msg('indicator.volumeFlowIndicator.title', 'Volume Flow Indicator'),
    shortTitle: msg('indicator.volumeFlowIndicator.shortTitle', 'Volume Flow Indicator'),
    overlay: false,
    inputs: [
        { ...lengthInput(130, 'length', msg('indicator.volumeFlowIndicator.length', 'Length'), 5000, msg('indicator.volumeFlowIndicator.length.tooltip', 'Rolling summation window, also used for the average volume that scales the result. The published default of 130 bars targets position-horizon work on daily charts.')), min: 2 },
        floatInput('coef', msg('indicator.volumeFlowIndicator.coef', 'Cutoff Coefficient'), 0.2, 0, 10, 0.05, msg('indicator.volumeFlowIndicator.coef.tooltip', 'Scales the volatility-based minimum change in typical price. Moves smaller than the cutoff count as noise and contribute no volume.')),
        floatInput('volCoef', msg('indicator.volumeFlowIndicator.volCoef', 'Volume Cap Multiplier'), 2.5, 0.1, 50, 0.1, msg('indicator.volumeFlowIndicator.volCoef.tooltip', "Caps each bar's volume contribution at this multiple of the average volume, so a single climactic print stays bounded.")),
        { ...lengthInput(30, 'volLength', msg('indicator.volumeFlowIndicator.volLength', 'Volatility Length'), 5000, msg('indicator.volumeFlowIndicator.volLength.tooltip', 'Window of the standard deviation of the log change in typical price used to build the adaptive cutoff.')), min: 2 },
        boolInput('smooth', msg('indicator.volumeFlowIndicator.smooth', 'Smooth VFI'), true, SETTINGS, msg('indicator.volumeFlowIndicator.smooth.tooltip', 'Applies the published light smoothing — an EMA of the summed line — before plotting.')),
        lengthInput(3, 'smoothLength', msg('indicator.volumeFlowIndicator.smoothLength', 'Smoothing Length'), 500, msg('indicator.volumeFlowIndicator.smoothLength.tooltip', 'Length of the smoothing EMA. The published version uses 3 bars.')),
        boolInput('showSignal', msg('indicator.volumeFlowIndicator.showSignal', 'Signal Line'), true, SETTINGS, msg('indicator.volumeFlowIndicator.showSignal.tooltip', 'Plots an EMA of VFI as a signal line.')),
        lengthInput(5, 'signalLength', msg('indicator.volumeFlowIndicator.signalLength', 'Signal Length'), 500, msg('indicator.volumeFlowIndicator.signalLength.tooltip', 'Length of the signal-line EMA.')),
        colorInput(BULLISH, msg('indicator.volumeFlowIndicator.color', 'Bullish'), 'color', msg('indicator.volumeFlowIndicator.color.tooltip', 'Color of the VFI line and gradient fill above the zero line — the net accumulation regime.')),
        colorInput(BEARISH, msg('indicator.volumeFlowIndicator.bearColor', 'Bearish'), 'bearColor', msg('indicator.volumeFlowIndicator.bearColor.tooltip', 'Color of the VFI line and gradient fill below the zero line — the net distribution regime.')),
        colorInput(WARNING, msg('indicator.volumeFlowIndicator.signalColor', 'Signal Line'), 'signalColor', msg('indicator.volumeFlowIndicator.signalColor.tooltip', 'Color of the signal line.')),
        boolInput('gradientFill', msg('indicator.volumeFlowIndicator.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.volumeFlowIndicator.gradientFill.tooltip', 'Fills the area between the zero line and the VFI line with a vertical gradient.')),
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
            ? [{ key: 'signal', title: msg('indicator.volumeFlowIndicator.plot.signal', 'Signal Line'), values: ema(values, num(inputs, 'signalLength', 5)), color: str(inputs, 'signalColor', WARNING) }]
            : [];
        return centeredOscillator({
            key: 'vfi',
            title: msg('indicator.volumeFlowIndicator.plot.vfi', 'VFI'),
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
    title: msg('indicator.intradayIntensity.title', 'Intraday Intensity'),
    shortTitle: msg('indicator.intradayIntensity.shortTitle', 'Intraday Intensity'),
    overlay: false,
    inputs: [
        optionInput('mode', msg('indicator.intradayIntensity.mode', 'Display'), II_OSCILLATOR, [II_OSCILLATOR, II_CUMULATIVE], msg('indicator.intradayIntensity.mode.tooltip', 'The two published forms. The cumulative line is open-ended and read by slope against price; the normalized oscillator divides a rolling sum of intensity by the rolling sum of volume and oscillates around zero.')),
        lengthInput(21, 'length', msg('indicator.intradayIntensity.length', 'Oscillator Length'), 5000, msg('indicator.intradayIntensity.length.tooltip', 'Window of the rolling sums in the normalized form. The common setting is 21 bars. It has no effect on the cumulative line.')),
        colorInput(BULLISH, msg('indicator.intradayIntensity.color', 'Bullish'), 'color', msg('indicator.intradayIntensity.color.tooltip', 'Color of positive readings, the rising cumulative line and the fill above zero — the accumulation side.')),
        colorInput(BEARISH, msg('indicator.intradayIntensity.bearColor', 'Bearish'), 'bearColor', msg('indicator.intradayIntensity.bearColor.tooltip', 'Color of negative readings, the falling cumulative line and the fill below zero — the distribution side.')),
        boolInput('gradientFill', msg('indicator.intradayIntensity.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.intradayIntensity.gradientFill.tooltip', 'Fills the area between the zero line and the oscillator with a vertical gradient. Applies to the normalized oscillator only.')),
    ],
    compute: (bars, inputs) => {
        const intensity = moneyFlowVolume(bars);
        const bull = str(inputs, 'color', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        if (str(inputs, 'mode', II_OSCILLATOR) === II_CUMULATIVE) {
            // The open-ended line is read by slope, so it carries no zero line and no wash.
            const values = cumSum(intensity);
            return { plots: [{ key: 'ii', title: msg('indicator.intradayIntensity.plot.ii', 'Intraday Intensity'), values, color: bull, colors: slopeColors(values, bull, bear, bull) }] };
        }
        const len = num(inputs, 'length', 21);
        const values = zip(sum(intensity, len), sum(volumes(bars), len), (m, v) => (v > 0 ? (100 * m) / v : Number.NaN));
        return centeredOscillator({
            key: 'ii',
            title: msg('indicator.intradayIntensity.plot.ii', 'Intraday Intensity'),
            values,
            ink: { bull, bear, neutral: bear },
            zeroInk: transp(NEUTRAL, 90),
            fill: bool(inputs, 'gradientFill', true),
        });
    },
};

export const volumeSpecs: ClassicIndicatorSpec[] = [
    obv,
    netVolume,
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
