import { msg } from '../../i18n/message';
import { BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { bool, num, str } from './define';
import { STYLE, boolInput, centeredOscillator, colorInput, floatInput, gradient, lengthInput, sourceInput, transp } from './shared';
import { sourceValues, highs, lows, closes, barsSinceHighest, barsSinceLowest, barIndex, correlation, trueRange, ema, rma, sum, highest, lowest, map, zip } from './math';

/** Directional/trend-strength studies. */

const aroon: ClassicIndicatorSpec = {
    type: 'aroon',
    title: msg('indicator.aroon.title', 'Aroon'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.aroon.length', 'Length'), 5000, msg('indicator.aroon.length.tooltip', 'Lookback length used to locate the highest high and lowest low.')),
        colorInput(BULLISH, msg('indicator.aroon.upColor', 'Aroon Up'), 'upColor', msg('indicator.aroon.upColor.tooltip', 'Color of the Aroon Up line.')),
        colorInput(BEARISH, msg('indicator.aroon.downColor', 'Aroon Down'), 'downColor', msg('indicator.aroon.downColor.tooltip', 'Color of the Aroon Down line.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const up = map(barsSinceHighest(highs(bars), len), (x) => (100 * (len - x)) / len);
        const down = map(barsSinceLowest(lows(bars), len), (x) => (100 * (len - x)) / len);
        return {
            plots: [
                { key: 'up', title: msg('indicator.aroon.plot.up', 'Aroon Up'), values: up, color: str(inputs, 'upColor', BULLISH) },
                { key: 'down', title: msg('indicator.aroon.plot.down', 'Aroon Down'), values: down, color: str(inputs, 'downColor', BEARISH) },
            ],
        };
    },
};

const adx: ClassicIndicatorSpec = {
    type: 'average-directional-index',
    title: msg('indicator.averageDirectionalIndex.title', 'Average Directional Index'),
    shortTitle: msg('indicator.averageDirectionalIndex.shortTitle', 'ADX'),
    overlay: false,
    inputs: [
        lengthInput(14, 'diLength', msg('indicator.averageDirectionalIndex.diLength', 'DI Length'), 5000, msg('indicator.averageDirectionalIndex.diLength.tooltip', 'Wilder RMA smoothing length applied to directional movement and true range when computing +DI and −DI.')),
        lengthInput(14, 'adxLength', msg('indicator.averageDirectionalIndex.adxLength', 'ADX Smoothing'), 5000, msg('indicator.averageDirectionalIndex.adxLength.tooltip', 'Wilder RMA smoothing length applied to DX to obtain the ADX line.')),
        floatInput('keyLevel', msg('indicator.averageDirectionalIndex.keyLevel', 'Key Level'), 25, 0, 100, 1, msg('indicator.averageDirectionalIndex.keyLevel.tooltip', 'Trend strength reference level; ADX above it is commonly read as a trending market.')),
        colorInput(BULLISH, msg('indicator.averageDirectionalIndex.plusDiColor', '+DI Color'), 'plusDiColor', msg('indicator.averageDirectionalIndex.plusDiColor.tooltip', 'Color of the plus directional indicator, and of the ADX line above the key level while +DI leads.')),
        colorInput(BEARISH, msg('indicator.averageDirectionalIndex.minusDiColor', '−DI Color'), 'minusDiColor', msg('indicator.averageDirectionalIndex.minusDiColor.tooltip', 'Color of the minus directional indicator, and of the ADX line above the key level while −DI leads.')),
        colorInput(NEUTRAL, msg('indicator.averageDirectionalIndex.adxColor', 'ADX Color'), 'adxColor', msg('indicator.averageDirectionalIndex.adxColor.tooltip', 'Color of the ADX line while it sits below the key level — no trend strong enough to trade.')),
    ],
    compute: (bars, inputs) => {
        const diLen = num(inputs, 'diLength', 14);
        const n = bars.length;
        const plusDm = new Array<number>(n).fill(Number.NaN);
        const minusDm = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            const up = bars[i]!.high - bars[i - 1]!.high;
            const dn = bars[i - 1]!.low - bars[i]!.low;
            plusDm[i] = up > dn && up > 0 ? up : 0;
            minusDm[i] = dn > up && dn > 0 ? dn : 0;
        }
        const atrLine = rma(trueRange(bars), diLen);
        const plusDi = zip(rma(plusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const minusDi = zip(rma(minusDm, diLen), atrLine, (d, a) => (a === 0 ? 0 : (100 * d) / a));
        const dx = zip(plusDi, minusDi, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
        const adxLine = rma(dx, num(inputs, 'adxLength', 14));
        const plusInk = str(inputs, 'plusDiColor', BULLISH);
        const minusInk = str(inputs, 'minusDiColor', BEARISH);
        const neutralInk = str(inputs, 'adxColor', NEUTRAL);
        const keyLevel = num(inputs, 'keyLevel', 25);
        // The ADX borrows the dominant DI's color once it clears the key level.
        const adxColors = adxLine.map((x, i) => {
            if (!Number.isFinite(x)) return null;
            if (x <= keyLevel) return neutralInk;
            return (plusDi[i] ?? 0) > (minusDi[i] ?? 0) ? plusInk : minusInk;
        });
        return {
            plots: [
                { key: 'plusDi', title: msg('indicator.averageDirectionalIndex.plot.plusDi', '+DI'), values: plusDi, color: transp(plusInk, 30) },
                { key: 'minusDi', title: '-DI', displayTitle: msg('indicator.averageDirectionalIndex.plot.minusDi', '−DI'), values: minusDi, color: transp(minusInk, 30) },
                { key: 'adx', title: msg('indicator.averageDirectionalIndex.plot.adx', 'ADX'), values: adxLine, color: neutralInk, width: 2, colors: adxColors },
            ],
            levels: [{ key: 'keyLevel', price: keyLevel, color: NEUTRAL, lineStyle: 'dashed', title: msg('indicator.averageDirectionalIndex.level.keyLevel', 'Key Level') }],
        };
    },
};

const vortex: ClassicIndicatorSpec = {
    type: 'vortex-indicator',
    title: msg('indicator.vortexIndicator.title', 'Vortex Indicator'),
    shortTitle: msg('indicator.vortexIndicator.shortTitle', 'VI'),
    overlay: false,
    inputs: [
        lengthInput(14, 'length', msg('indicator.vortexIndicator.length', 'Length'), 5000, msg('indicator.vortexIndicator.length.tooltip', 'Number of bars used to sum the vortex movements (VM+ and VM−) and the true range.')),
        colorInput(BULLISH, msg('indicator.vortexIndicator.plusColor', 'VI+'), 'plusColor', msg('indicator.vortexIndicator.plusColor.tooltip', 'Color of the positive vortex line (VI+).')),
        colorInput(BEARISH, msg('indicator.vortexIndicator.minusColor', 'VI−'), 'minusColor', msg('indicator.vortexIndicator.minusColor.tooltip', 'Color of the negative vortex line (VI−).')),
        colorInput(NEUTRAL, msg('indicator.vortexIndicator.baselineColor', 'Baseline'), 'baselineColor', msg('indicator.vortexIndicator.baselineColor.tooltip', 'Color of the dotted baseline drawn at 1.')),
    ],
    compute: (bars, inputs) => {
        const len = num(inputs, 'length', 14);
        const n = bars.length;
        const vmPlus = new Array<number>(n).fill(Number.NaN);
        const vmMinus = new Array<number>(n).fill(Number.NaN);
        for (let i = 1; i < n; i++) {
            vmPlus[i] = Math.abs(bars[i]!.high - bars[i - 1]!.low);
            vmMinus[i] = Math.abs(bars[i]!.low - bars[i - 1]!.high);
        }
        const trSum = sum(trueRange(bars), len);
        return {
            plots: [
                { key: 'viPlus', title: msg('indicator.vortexIndicator.plot.viPlus', 'VI+'), values: zip(sum(vmPlus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: str(inputs, 'plusColor', BULLISH) },
                { key: 'viMinus', title: 'VI-', displayTitle: msg('indicator.vortexIndicator.plot.viMinus', 'VI−'), values: zip(sum(vmMinus, len), trSum, (v, t) => (t === 0 ? Number.NaN : v / t)), color: str(inputs, 'minusColor', BEARISH) },
            ],
            levels: [{ key: 'baseline', price: 1, color: str(inputs, 'baselineColor', NEUTRAL), lineStyle: 'dotted', title: msg('indicator.vortexIndicator.level.baseline', 'Baseline') }],
        };
    },
};

const trendStrength: ClassicIndicatorSpec = {
    type: 'trend-strength-index',
    title: msg('indicator.trendStrengthIndex.title', 'Trend Strength Index'),
    overlay: false,
    inputs: [
        { ...lengthInput(14, 'length', msg('indicator.trendStrengthIndex.length', 'Length'), 5000, msg('indicator.trendStrengthIndex.length.tooltip', 'Number of bars over which the source is correlated with time.')), min: 2 },
        sourceInput('Close', 'source', msg('indicator.trendStrengthIndex.source', 'Source'), msg('indicator.trendStrengthIndex.source.tooltip', 'Price series correlated with time.')),
        colorInput(NEUTRAL, msg('indicator.trendStrengthIndex.color', 'Line'), 'color', msg('indicator.trendStrengthIndex.color.tooltip', 'Color of the line when the reading sits exactly at zero.')),
        colorInput(BULLISH, msg('indicator.trendStrengthIndex.bullColor', 'Bullish'), 'bullColor', msg('indicator.trendStrengthIndex.bullColor.tooltip', 'Color of the line and fill while the reading is above zero: price has been rising in step with time.')),
        colorInput(BEARISH, msg('indicator.trendStrengthIndex.bearColor', 'Bearish'), 'bearColor', msg('indicator.trendStrengthIndex.bearColor.tooltip', 'Color of the line and fill while the reading is below zero: price has been falling in step with time.')),
        boolInput('gradientFill', msg('indicator.trendStrengthIndex.gradientFill', 'Gradient Fill'), true, STYLE, msg('indicator.trendStrengthIndex.gradientFill.tooltip', 'Fills the area between the line and zero, following the line color.')),
    ],
    compute: (bars, inputs) =>
        // +1 is a straight climb, −1 a straight fall, 0 no trend at all over the window.
        centeredOscillator({
            key: 'tsi',
            title: msg('indicator.trendStrengthIndex.plot.tsi', 'Trend Strength'),
            values: correlation(sourceValues(bars, str(inputs, 'source', 'Close')), barIndex(bars.length), num(inputs, 'length', 14)),
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: str(inputs, 'color', NEUTRAL) },
            zeroInk: NEUTRAL,
            fill: bool(inputs, 'gradientFill', true),
        }),
};

const CHOP_TREND_LENGTH = 34;
const CHOP_RANGE_LENGTH = 30;
/** Scales the trend line's one-bar change, as a share of price, against the recent range. */
const CHOP_SPAN = 25;
/** Where the four zones on each side of flat begin, in degrees. The angle is rounded to a whole degree before it is placed. */
const CHOP_ZONE_EDGES = [0.71, 2.14, 3.57, 5] as const;

/** Which zone an angle falls in: 0 flat, 1 to 4 a steeper and steeper rise, −1 to −4 the same falling. */
function chopZone(angle: number): number {
    const steepness = Math.abs(angle);
    let zone = 0;
    for (const edge of CHOP_ZONE_EDGES) if (steepness >= edge) zone += 1;
    return angle < 0 ? -zone : zone;
}

const chopZoneSpec: ClassicIndicatorSpec = {
    type: 'chop-zone',
    title: msg('indicator.chopZone.title', 'Chop Zone'),
    overlay: false,
    inputs: [
        colorInput(BULLISH, msg('indicator.chopZone.bullColor', 'Rising'), 'bullColor', msg('indicator.chopZone.bullColor.tooltip', 'Color of the steepest rising zone. The three gentler rising zones blend from the flat color toward it.')),
        colorInput(BEARISH, msg('indicator.chopZone.bearColor', 'Falling'), 'bearColor', msg('indicator.chopZone.bearColor.tooltip', 'Color of the steepest falling zone. The three gentler falling zones blend from the flat color toward it.')),
        colorInput(WARNING, msg('indicator.chopZone.flatColor', 'Flat'), 'flatColor', msg('indicator.chopZone.flatColor.tooltip', 'Color of the bars where the trend line is flat: a choppy market.')),
    ],
    compute: (bars, inputs) => {
        const trend = ema(closes(bars), CHOP_TREND_LENGTH);
        // Both ends of the range are read on the highs.
        const top = highest(highs(bars), CHOP_RANGE_LENGTH);
        const bottom = lowest(highs(bars), CHOP_RANGE_LENGTH);
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const flat = str(inputs, 'flatColor', WARNING);
        const steepest = CHOP_ZONE_EDGES.length;
        const values = new Array<number>(bars.length).fill(Number.NaN);
        const colors = new Array<string | null>(bars.length).fill(null);
        for (let i = 1; i < bars.length; i++) {
            const now = trend[i]!;
            const before = trend[i - 1]!;
            const high = top[i]!;
            const low = bottom[i]!;
            if (!Number.isFinite(now) || !Number.isFinite(before) || !Number.isFinite(high) || !Number.isFinite(low)) continue;
            const b = bars[i]!;
            const typical = (b.high + b.low + b.close) / 3;
            const range = high - low;
            // A range of zero is a market that did not move: flat, whatever the trend line did.
            const rise = range > 0 && typical !== 0 ? ((now - before) / typical) * ((CHOP_SPAN / range) * low) : 0;
            const degrees = Math.round((Math.atan(Math.abs(rise)) * 180) / Math.PI);
            const zone = chopZone(rise < 0 ? -degrees : degrees);
            values[i] = 1;
            colors[i] = zone === 0 ? flat : gradient(Math.abs(zone), 0, steepest, flat, zone > 0 ? bull : bear);
        }
        return { plots: [{ key: 'zone', title: msg('indicator.chopZone.plot.zone', 'Chop Zone'), values, kind: 'columns', color: flat, colors, base: 0 }] };
    },
};

export const trendSpecs: ClassicIndicatorSpec[] = [aroon, adx, vortex, trendStrength, chopZoneSpec];
