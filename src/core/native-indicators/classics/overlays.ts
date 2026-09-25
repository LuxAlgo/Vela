import type { OHLCV } from '../../model/ohlcv';
import type { MarkerPoint } from '../../model/series';
import type { DrawingPolyline } from '../../model/drawings';
import { BULLISH, BEARISH, NEUTRAL, WARNING } from '../../palette';
import type { ClassicBand, ClassicIndicatorSpec, ClassicPlot } from './define';
import { bool, num, str } from './define';
import { SETTINGS, STYLE, boolInput, colorInput, floatInput, intInput, optionInput, sourceInput, transp } from './shared';
import { sourceValues } from './math';

/** Price-anchored specials: stops, anchored averages, levels, pivots, patterns. */

const DAY_MS = 86400000;

type Anchor = 'Session' | 'Week' | 'Month' | 'Quarter' | 'Year';

/** UTC period key for an anchor (epoch day 0 was a Thursday; weeks start Monday). */
function periodKey(anchor: Anchor, time: number): number {
    if (anchor === 'Week') return Math.floor((Math.floor(time / DAY_MS) + 3) / 7);
    if (anchor === 'Month' || anchor === 'Quarter' || anchor === 'Year') {
        const d = new Date(time);
        if (anchor === 'Year') return d.getUTCFullYear();
        if (anchor === 'Quarter') return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    return Math.floor(time / DAY_MS);
}

/** Median spacing between bars, in ms — the classics' only handle on the chart's timeframe. */
function barInterval(bars: readonly OHLCV[]): number {
    if (bars.length < 2) return 0;
    const gaps: number[] = [];
    for (let i = 1; i < bars.length; i++) gaps.push(bars[i]!.time - bars[i - 1]!.time);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

const parabolicSar: ClassicIndicatorSpec = {
    type: 'parabolic-sar',
    title: 'Parabolic SAR',
    shortTitle: 'SAR',
    overlay: true,
    inputs: [
        floatInput('start', 'Start', 0.02, 0, 1, 0.01, 'Initial acceleration factor applied when a new trend begins.'),
        floatInput('increment', 'Increment', 0.02, 0, 1, 0.01, 'Amount added to the acceleration factor each time the trend makes a new extreme point.'),
        floatInput('maximum', 'Maximum', 0.2, 0.01, 1, 0.01, 'Upper cap on the acceleration factor.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the SAR crosses while they trail below price — uptrend, the stop sits under the market.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the SAR crosses while they sit above price — downtrend, the stop sits over the market.'),
    ],
    compute: (bars, inputs) => {
        const start = num(inputs, 'start', 0.02);
        const inc = num(inputs, 'increment', 0.02);
        const max = num(inputs, 'maximum', 0.2);
        const n = bars.length;
        const values = new Array<number>(n).fill(Number.NaN);
        if (n >= 2) {
            let long = bars[1]!.close >= bars[0]!.close;
            let sar = long ? bars[0]!.low : bars[0]!.high;
            let ep = long ? bars[0]!.high : bars[0]!.low;
            let af = start;
            for (let i = 1; i < n; i++) {
                const b = bars[i]!;
                sar += af * (ep - sar);
                // SAR may never poke inside the prior two bars' range.
                if (long) sar = Math.min(sar, bars[i - 1]!.low, i >= 2 ? bars[i - 2]!.low : bars[i - 1]!.low);
                else sar = Math.max(sar, bars[i - 1]!.high, i >= 2 ? bars[i - 2]!.high : bars[i - 1]!.high);
                const reversed = long ? b.low < sar : b.high > sar;
                if (reversed) {
                    long = !long;
                    sar = ep;
                    ep = long ? b.high : b.low;
                    af = start;
                } else if (long && b.high > ep) {
                    ep = b.high;
                    af = Math.min(max, af + inc);
                } else if (!long && b.low < ep) {
                    ep = b.low;
                    af = Math.min(max, af + inc);
                }
                values[i] = sar;
            }
        }
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const colors = values.map((x, i) => (Number.isFinite(x) ? (x < bars[i]!.close ? bull : bear) : null));
        return { plots: [{ key: 'sar', title: 'SAR', values, kind: 'cross', color: bull, colors }] };
    },
};

const VWAP_ANCHORS = ['Session', 'Week', 'Month', 'Quarter', 'Year'] as const;
const BANDS_STDEV = 'Standard Deviation';
const BANDS_PERCENT = 'Percentage';
const VWAP_BANDS = [
    { show: 'band1', mult: 'band1Mult', defMult: 1, defOn: true },
    { show: 'band2', mult: 'band2Mult', defMult: 2, defOn: false },
    { show: 'band3', mult: 'band3Mult', defMult: 3, defOn: false },
] as const;

const vwap: ClassicIndicatorSpec = {
    type: 'vwap',
    title: 'Volume Weighted Average Price',
    shortTitle: 'VWAP',
    overlay: true,
    inputs: [
        optionInput('anchor', 'Anchor Period', 'Session', VWAP_ANCHORS, 'Period anchoring the average. VWAP and its bands reset on the first bar of each new session, week, month, quarter or year (UTC).'),
        sourceInput('HLC3', 'source', 'Source', 'Price used in the volume weighted average. Typical price (HLC3) is the classic choice.'),
        optionInput('bandsMode', 'Bands Mode', BANDS_STDEV, [BANDS_STDEV, BANDS_PERCENT], 'Bands offset method: multiples of the volume weighted standard deviation of price around VWAP, or a percentage of the VWAP value.'),
        ...VWAP_BANDS.flatMap((b, i) => [
            boolInput(b.show, `Band #${i + 1}`, b.defOn, SETTINGS, `Show the ${['first', 'second', 'third'][i]} band pair.`),
            floatInput(b.mult, `Band #${i + 1} Multiplier`, b.defMult, 0, 50, 0.5, 'Multiplier for this band pair, in standard deviations or percent depending on the bands mode.'),
        ]),
        boolInput('hideDwm', 'Hide VWAP on 1D or Above', true, SETTINGS, 'Hide the VWAP and its bands on daily and higher timeframes, where an intraday anchored VWAP is not meaningful.'),
        colorInput(BULLISH, 'Bullish', 'bullColor', 'VWAP line color while price closes above it, and the color of the lower (support) bands.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'VWAP line color while price closes below it, and the color of the upper (resistance) bands.'),
        colorInput(NEUTRAL, 'Bands', 'bandsColor', 'Deviation bands fill color.'),
        boolInput('fill', 'Bands Fill', true, STYLE, 'Fill the area between each visible band pair.'),
    ],
    compute: (bars, inputs) => {
        const anchor = str(inputs, 'anchor', 'Session') as Anchor;
        const src = sourceValues(bars, str(inputs, 'source', 'HLC3'));
        const n = bars.length;
        const hidden = bool(inputs, 'hideDwm', true) && barInterval(bars) >= DAY_MS;
        const values = new Array<number>(n).fill(Number.NaN);
        const bands = VWAP_BANDS.filter((b) => bool(inputs, b.show, b.defOn)).map((b) => ({
            mult: Math.max(0, num(inputs, b.mult, b.defMult)),
            up: new Array<number>(n).fill(Number.NaN),
            down: new Array<number>(n).fill(Number.NaN),
        }));
        const percentMode = str(inputs, 'bandsMode', BANDS_STDEV) === BANDS_PERCENT;
        let period = Number.NaN;
        let cumPV = 0;
        let cumPV2 = 0;
        let cumV = 0;
        for (let i = 0; i < n && !hidden; i++) {
            const b = bars[i]!;
            const key = periodKey(anchor, b.time);
            if (key !== period) {
                period = key;
                cumPV = 0;
                cumPV2 = 0;
                cumV = 0;
            }
            const v = b.volume;
            if (v != null && Number.isFinite(v) && v > 0) {
                const tp = src[i]!;
                cumPV += tp * v;
                cumPV2 += tp * tp * v;
                cumV += v;
            }
            if (cumV <= 0) continue;
            const mean = cumPV / cumV;
            // Variance clamped at 0 — IEEE drift can dip `E[x²] − mean²` a hair under.
            const offset = percentMode ? mean / 100 : Math.sqrt(Math.max(0, cumPV2 / cumV - mean * mean));
            values[i] = mean;
            for (const band of bands) {
                band.up[i] = mean + band.mult * offset;
                band.down[i] = mean - band.mult * offset;
            }
        }
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const fillColor = transp(str(inputs, 'bandsColor', NEUTRAL), 95);
        const plots: ClassicPlot[] = [
            { key: 'vwap', title: 'VWAP', values, color: bull, colors: values.map((x, i) => (Number.isFinite(x) ? (bars[i]!.close >= x ? bull : bear) : null)) },
        ];
        const fills: ClassicBand[] = [];
        bands.forEach((band, i) => {
            plots.push(
                { key: `up${i}`, title: `Upper Band #${i + 1}`, values: band.up, color: transp(bear, 40) },
                { key: `down${i}`, title: `Lower Band #${i + 1}`, values: band.down, color: transp(bull, 40) },
            );
            if (bool(inputs, 'fill', true)) fills.push({ key: `band${i}`, from: `up${i}`, to: `down${i}`, color: fillColor });
        });
        return { plots, bands: fills };
    },
};

const PIVOT_TRADITIONAL = 'Traditional';
const PIVOT_FIBONACCI = 'Fibonacci';
const PIVOT_CAMARILLA = 'Camarilla';
const PIVOT_WOODIE = 'Woodie';
const PIVOT_AUTO = 'Auto';

const pivotPoints: ClassicIndicatorSpec = {
    type: 'pivot-points',
    title: 'Pivot Points Standard',
    shortTitle: 'Pivots',
    overlay: true,
    inputs: [
        optionInput('kind', 'Type', PIVOT_TRADITIONAL, [PIVOT_TRADITIONAL, PIVOT_FIBONACCI, PIVOT_CAMARILLA, PIVOT_WOODIE], 'Formula used to calculate the levels. Traditional is the classic floor-trader method; Fibonacci projects 38.2/61.8/100% of the prior range around the pivot; Camarilla scales the prior range around the prior close; Woodie gives extra weight to the period open.'),
        optionInput('anchor', 'Pivots Timeframe', PIVOT_AUTO, [PIVOT_AUTO, 'Daily', 'Weekly', 'Monthly', 'Yearly'], "Period the pivots are anchored to. 'Auto' follows the chart's bar spacing: daily pivots up to 15-minute bars, weekly on other intraday bars, monthly on daily bars, yearly above."),
        colorInput(WARNING, 'Pivot', 'pivotColor', 'Color of the central pivot (P) level.'),
        colorInput(BEARISH, 'Resistances', 'resistanceColor', 'Color of the resistance (R) levels.'),
        colorInput(BULLISH, 'Supports', 'supportColor', 'Color of the support (S) levels.'),
    ],
    compute: (bars, inputs) => {
        const interval = barInterval(bars);
        const requested = str(inputs, 'anchor', PIVOT_AUTO);
        const auto: Anchor = interval <= 15 * 60000 ? 'Session' : interval < DAY_MS ? 'Week' : interval <= DAY_MS ? 'Month' : 'Year';
        const anchor: Anchor = requested === 'Daily' ? 'Session' : requested === 'Weekly' ? 'Week' : requested === 'Monthly' ? 'Month' : requested === 'Yearly' ? 'Year' : auto;
        const kind = str(inputs, 'kind', PIVOT_TRADITIONAL);
        // Aggregate each period's OHLC; a period's levels come from the PREVIOUS one.
        interface Agg { open: number; high: number; low: number; close: number }
        const aggs = new Map<number, Agg>();
        for (const b of bars) {
            const key = periodKey(anchor, b.time);
            const a = aggs.get(key);
            if (!a) aggs.set(key, { open: b.open, high: b.high, low: b.low, close: b.close });
            else {
                a.high = Math.max(a.high, b.high);
                a.low = Math.min(a.low, b.low);
                a.close = b.close;
            }
        }
        const n = bars.length;
        const mk = (): number[] => new Array<number>(n).fill(Number.NaN);
        const levels = { p: mk(), r1: mk(), s1: mk(), r2: mk(), s2: mk(), r3: mk(), s3: mk(), r4: mk(), s4: mk() };
        let lastKey = Number.NaN;
        for (let i = 0; i < n; i++) {
            const key = periodKey(anchor, bars[i]!.time);
            const fresh = key !== lastKey;
            lastKey = key;
            // A break on the period's first bar keeps each period's ladder a separate segment.
            if (fresh) continue;
            const prev = aggs.get(key - 1);
            const curr = aggs.get(key);
            if (!prev || !curr) continue;
            const range = prev.high - prev.low;
            const traditional = (prev.high + prev.low + prev.close) / 3;
            const p = kind === PIVOT_WOODIE ? (prev.high + prev.low + 2 * curr.open) / 4 : traditional;
            levels.p[i] = p;
            if (kind === PIVOT_FIBONACCI) {
                levels.r1[i] = traditional + 0.382 * range;
                levels.s1[i] = traditional - 0.382 * range;
                levels.r2[i] = traditional + 0.618 * range;
                levels.s2[i] = traditional - 0.618 * range;
                levels.r3[i] = traditional + range;
                levels.s3[i] = traditional - range;
            } else if (kind === PIVOT_CAMARILLA) {
                const cam = 1.1 * range;
                levels.r1[i] = prev.close + cam / 12;
                levels.s1[i] = prev.close - cam / 12;
                levels.r2[i] = prev.close + cam / 6;
                levels.s2[i] = prev.close - cam / 6;
                levels.r3[i] = prev.close + cam / 4;
                levels.s3[i] = prev.close - cam / 4;
                levels.r4[i] = prev.close + cam / 2;
                levels.s4[i] = prev.close - cam / 2;
            } else {
                // Traditional and Woodie share the R1/S1/R2/S2 shape around their own pivot.
                levels.r1[i] = 2 * p - prev.low;
                levels.s1[i] = 2 * p - prev.high;
                levels.r2[i] = p + range;
                levels.s2[i] = p - range;
                if (kind !== PIVOT_WOODIE) {
                    levels.r3[i] = prev.high + 2 * (p - prev.low);
                    levels.s3[i] = prev.low - 2 * (prev.high - p);
                }
            }
        }
        const resistance = str(inputs, 'resistanceColor', BEARISH);
        const support = str(inputs, 'supportColor', BULLISH);
        const plot = (key: keyof typeof levels, title: string, color: string): ClassicPlot => ({ key, title, values: levels[key], color });
        const plots: ClassicPlot[] = [
            plot('p', 'P', str(inputs, 'pivotColor', WARNING)),
            plot('r1', 'R1', resistance),
            plot('s1', 'S1', support),
            plot('r2', 'R2', resistance),
            plot('s2', 'S2', support),
        ];
        if (kind !== PIVOT_WOODIE) plots.push(plot('r3', 'R3', resistance), plot('s3', 'S3', support));
        if (kind === PIVOT_CAMARILLA) plots.push(plot('r4', 'R4', resistance), plot('s4', 'S4', support));
        return { plots };
    },
};

const fiftyTwoWeek: ClassicIndicatorSpec = {
    type: '52-week-high-low',
    title: '52 Week High/Low',
    shortTitle: '52W H/L',
    overlay: true,
    inputs: [
        intInput('weeks', 'Weeks', 52, 1, 520, 'Length of the rolling window, in weeks.'),
        boolInput('showAllTime', 'Show All-Time High/Low', false, SETTINGS, "Additionally display the all-time high and low, tracked over the symbol's full loaded history."),
        colorInput(BULLISH, '52 Week High', 'highColor', 'Color of the 52 week high level.'),
        colorInput(BEARISH, '52 Week Low', 'lowColor', 'Color of the 52 week low level.'),
        colorInput(NEUTRAL, 'All-Time High/Low', 'allTimeColor', 'Color of the all-time high and all-time low levels.'),
    ],
    compute: (bars, inputs) => {
        const span = num(inputs, 'weeks', 52) * 7 * DAY_MS;
        const n = bars.length;
        const hi = new Array<number>(n).fill(Number.NaN);
        const lo = new Array<number>(n).fill(Number.NaN);
        const ath = new Array<number>(n).fill(Number.NaN);
        const atl = new Array<number>(n).fill(Number.NaN);
        // Two-pointer sliding window over the time span, monotonic deques for the extremes.
        const maxIdx: number[] = [];
        const minIdx: number[] = [];
        let from = 0;
        let runHigh = -Infinity;
        let runLow = Infinity;
        for (let i = 0; i < n; i++) {
            const b = bars[i]!;
            while (maxIdx.length > 0 && bars[maxIdx[maxIdx.length - 1]!]!.high <= b.high) maxIdx.pop();
            maxIdx.push(i);
            while (minIdx.length > 0 && bars[minIdx[minIdx.length - 1]!]!.low >= b.low) minIdx.pop();
            minIdx.push(i);
            while (bars[from]!.time < b.time - span) from += 1;
            while (maxIdx[0]! < from) maxIdx.shift();
            while (minIdx[0]! < from) minIdx.shift();
            hi[i] = bars[maxIdx[0]!]!.high;
            lo[i] = bars[minIdx[0]!]!.low;
            runHigh = Math.max(runHigh, b.high);
            runLow = Math.min(runLow, b.low);
            ath[i] = runHigh;
            atl[i] = runLow;
        }
        const plots: ClassicPlot[] = [
            { key: 'high', title: '52 Week High', values: hi, kind: 'step', color: str(inputs, 'highColor', BULLISH), width: 2 },
            { key: 'low', title: '52 Week Low', values: lo, kind: 'step', color: str(inputs, 'lowColor', BEARISH), width: 2 },
        ];
        if (bool(inputs, 'showAllTime', false)) {
            const ink = str(inputs, 'allTimeColor', NEUTRAL);
            plots.push({ key: 'ath', title: 'All-Time High', values: ath, kind: 'step', color: ink }, { key: 'atl', title: 'All-Time Low', values: atl, kind: 'step', color: ink });
        }
        return { plots };
    },
};

const zigzag: ClassicIndicatorSpec = {
    type: 'zigzag',
    title: 'ZigZag',
    overlay: true,
    inputs: [
        floatInput('deviation', 'Deviation (%)', 5, 0.01, 100, 0.1, 'Minimum reversal from the leg extreme, as a percentage of that extreme, required to confirm a new pivot.'),
        { ...intInput('depth', 'Depth', 10, 2, 500, 'Minimum number of bars required between two consecutive pivots.') },
        colorInput(BULLISH, 'Up Leg', 'bullColor', 'Color of rising zigzag segments.'),
        colorInput(BEARISH, 'Down Leg', 'bearColor', 'Color of falling zigzag segments.'),
        { key: 'lineWidth', title: 'Width', type: 'int', defval: 2, min: 1, max: 10, step: 1, group: STYLE, tooltip: 'Width of the zigzag segments.' },
    ],
    compute: (bars, inputs) => {
        const dev = num(inputs, 'deviation', 5) / 100;
        const depth = num(inputs, 'depth', 10);
        interface Pivot { i: number; price: number }
        const pivots: Pivot[] = [];
        if (bars.length > 1) {
            // Walk the bars tracking the running extreme; a retrace beyond the deviation
            // (and at least `depth` bars past the last pivot) confirms the extreme as a pivot.
            let up = bars[1]!.close >= bars[0]!.close;
            let ext: Pivot = up ? { i: 0, price: bars[0]!.high } : { i: 0, price: bars[0]!.low };
            for (let i = 1; i < bars.length; i++) {
                const b = bars[i]!;
                if (up) {
                    if (b.high >= ext.price) ext = { i, price: b.high };
                    else if (b.low <= ext.price * (1 - dev) && ext.i - (pivots[pivots.length - 1]?.i ?? -depth) >= depth) {
                        pivots.push(ext);
                        up = false;
                        ext = { i, price: b.low };
                    }
                } else if (b.low <= ext.price) {
                    ext = { i, price: b.low };
                } else if (b.high >= ext.price * (1 + dev) && ext.i - (pivots[pivots.length - 1]?.i ?? -depth) >= depth) {
                    pivots.push(ext);
                    up = true;
                    ext = { i, price: b.high };
                }
            }
            pivots.push(ext); // the provisional last leg
        }
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const width = num(inputs, 'lineWidth', 2);
        // One polyline per leg, so each segment can carry its own direction ink.
        const polylines: Array<Omit<DrawingPolyline, 'id' | 'paneId'> & { key: string }> = [];
        for (let k = 1; k < pivots.length; k++) {
            const a = pivots[k - 1]!;
            const b = pivots[k]!;
            polylines.push({
                key: `leg${k}`,
                points: [
                    { xloc: 'bar_time' as const, x: bars[a.i]!.time, price: a.price },
                    { xloc: 'bar_time' as const, x: bars[b.i]!.time, price: b.price },
                ],
                curved: false,
                closed: false,
                lineColor: b.price >= a.price ? bull : bear,
                lineWidth: width,
                lineStyle: 'solid' as const,
                arrowLeft: false,
                arrowRight: false,
            });
        }
        return { plots: [], polylines };
    },
};

const williamsFractal: ClassicIndicatorSpec = {
    type: 'williams-fractal',
    title: 'Williams Fractal',
    shortTitle: 'Fractals',
    overlay: true,
    inputs: [
        intInput('periods', 'Periods', 2, 2, 50, "Bars required on each side of the candidate bar. 2 is Bill Williams' classic 5-bar fractal; a fractal is confirmed only once this many later bars have closed."),
        colorInput(BEARISH, 'Up Fractal', 'upColor', 'Color of the up fractal marker (swing high), drawn above the fractal bar.'),
        colorInput(BULLISH, 'Down Fractal', 'downColor', 'Color of the down fractal marker (swing low), drawn below the fractal bar.'),
    ],
    compute: (bars, inputs) => {
        const p = num(inputs, 'periods', 2);
        const markers: MarkerPoint[] = [];
        const up = str(inputs, 'upColor', BEARISH);
        const down = str(inputs, 'downColor', BULLISH);
        // The candidate must STRICTLY exceed every neighbour, so a tie never prints a fractal.
        const isExtreme = (i: number, pick: (b: OHLCV) => number, better: (a: number, b: number) => boolean): boolean => {
            const v = pick(bars[i]!);
            for (let k = i - p; k <= i + p; k++) {
                if (k === i) continue;
                if (!better(v, pick(bars[k]!))) return false;
            }
            return true;
        };
        for (let i = p; i < bars.length - p; i++) {
            if (isExtreme(i, (b) => b.high, (a, b) => a > b)) markers.push({ time: bars[i]!.time, position: 'aboveBar', shape: 'triangleup', color: up });
            if (isExtreme(i, (b) => b.low, (a, b) => a < b)) markers.push({ time: bars[i]!.time, position: 'belowBar', shape: 'triangledown', color: down });
        }
        return { plots: [], markers };
    },
};

export const overlaySpecs: ClassicIndicatorSpec[] = [parabolicSar, vwap, pivotPoints, fiftyTwoWeek, zigzag, williamsFractal];
