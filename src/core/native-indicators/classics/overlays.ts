import type { OHLCV } from '../../model/ohlcv';
import type { MarkerPoint } from '../../model/series';
import { SERIES_LINE, BULLISH, BEARISH, INFO, WARNING } from '../../palette';
import type { ClassicIndicatorSpec, ClassicPlot } from './define';
import { num, str } from './define';
import { colorInput } from './shared';

/** Price-anchored specials: stops, anchored averages, levels, pivots, patterns. */

const DAY_MS = 86400000;

type Anchor = 'Day' | 'Week' | 'Month';

/** UTC period key for an anchor (epoch day 0 was a Thursday; weeks start Monday). */
function periodKey(anchor: Anchor, time: number): number {
    if (anchor === 'Week') return Math.floor((Math.floor(time / DAY_MS) + 3) / 7);
    if (anchor === 'Month') {
        const d = new Date(time);
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    return Math.floor(time / DAY_MS);
}

const parabolicSar: ClassicIndicatorSpec = {
    type: 'parabolic-sar',
    title: 'Parabolic SAR',
    shortTitle: 'SAR',
    overlay: true,
    inputs: [
        { key: 'start', title: 'Start', type: 'float', defval: 0.02, min: 0.001, max: 1, step: 0.001 },
        { key: 'increment', title: 'Increment', type: 'float', defval: 0.02, min: 0.001, max: 1, step: 0.001 },
        { key: 'maximum', title: 'Max value', type: 'float', defval: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    compute: (bars, inputs) => {
        const start = num(inputs, 'start', 0.02);
        const inc = num(inputs, 'increment', 0.02);
        const max = num(inputs, 'maximum', 0.2);
        const n = bars.length;
        const values = new Array<number>(n).fill(Number.NaN);
        const colors = new Array<string | null>(n).fill(null);
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
                colors[i] = long ? BULLISH : BEARISH;
            }
        }
        return { plots: [{ key: 'sar', title: 'PSAR', values, kind: 'circles', color: SERIES_LINE, colors }] };
    },
};

const vwap: ClassicIndicatorSpec = {
    type: 'vwap',
    title: 'Volume Weighted Average Price',
    shortTitle: 'VWAP',
    overlay: true,
    inputs: [
        { key: 'anchor', title: 'Anchor', type: 'string', defval: 'Day', options: ['Day', 'Week', 'Month'], tooltip: 'Where the accumulation resets (UTC periods)' },
        { key: 'source', title: 'Source', type: 'string', defval: 'HLC3', options: ['HLC3', 'OHLC4', 'Close'] },
        colorInput(INFO),
    ],
    compute: (bars, inputs) => {
        const anchor = str(inputs, 'anchor', 'Day') as Anchor;
        const source = str(inputs, 'source', 'HLC3');
        const values = new Array<number>(bars.length).fill(Number.NaN);
        let period = Number.NaN;
        let cumPV = 0;
        let cumV = 0;
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i]!;
            const key = periodKey(anchor, b.time);
            if (key !== period) {
                period = key;
                cumPV = 0;
                cumV = 0;
            }
            const v = b.volume;
            if (v != null && Number.isFinite(v) && v > 0) {
                const tp = source === 'Close' ? b.close : source === 'OHLC4' ? (b.open + b.high + b.low + b.close) / 4 : (b.high + b.low + b.close) / 3;
                cumPV += tp * v;
                cumV += v;
            }
            if (cumV > 0) values[i] = cumPV / cumV;
        }
        return { plots: [{ key: 'vwap', title: 'VWAP', values, color: str(inputs, 'color', INFO), width: 2 }] };
    },
};

const pivotPoints: ClassicIndicatorSpec = {
    type: 'pivot-points',
    title: 'Pivot Points',
    shortTitle: 'Pivots',
    overlay: true,
    inputs: [{ key: 'anchor', title: 'Period', type: 'string', defval: 'Day', options: ['Day', 'Week', 'Month'] }],
    compute: (bars, inputs) => {
        const anchor = str(inputs, 'anchor', 'Day') as Anchor;
        // Aggregate each period's OHLC; a period's levels come from the PREVIOUS one.
        interface Agg { high: number; low: number; close: number }
        const aggs = new Map<number, Agg>();
        for (const b of bars) {
            const key = periodKey(anchor, b.time);
            const a = aggs.get(key);
            if (!a) aggs.set(key, { high: b.high, low: b.low, close: b.close });
            else {
                a.high = Math.max(a.high, b.high);
                a.low = Math.min(a.low, b.low);
                a.close = b.close;
            }
        }
        const n = bars.length;
        const mk = (): number[] => new Array<number>(n).fill(Number.NaN);
        const levels = { p: mk(), r1: mk(), s1: mk(), r2: mk(), s2: mk(), r3: mk(), s3: mk() };
        for (let i = 0; i < n; i++) {
            const prev = aggs.get(periodKey(anchor, bars[i]!.time) - 1);
            if (!prev) continue;
            const p = (prev.high + prev.low + prev.close) / 3;
            levels.p[i] = p;
            levels.r1[i] = 2 * p - prev.low;
            levels.s1[i] = 2 * p - prev.high;
            levels.r2[i] = p + (prev.high - prev.low);
            levels.s2[i] = p - (prev.high - prev.low);
            levels.r3[i] = prev.high + 2 * (p - prev.low);
            levels.s3[i] = prev.low - 2 * (prev.high - p);
        }
        const plot = (key: keyof typeof levels, title: string, color: string): ClassicPlot => ({ key, title, kind: 'step', values: levels[key], color });
        return {
            plots: [
                plot('p', 'P', WARNING),
                plot('r1', 'R1', BEARISH),
                plot('s1', 'S1', BULLISH),
                plot('r2', 'R2', BEARISH),
                plot('s2', 'S2', BULLISH),
                plot('r3', 'R3', BEARISH),
                plot('s3', 'S3', BULLISH),
            ],
        };
    },
};

const fiftyTwoWeek: ClassicIndicatorSpec = {
    type: '52-week-high-low',
    title: '52 Week High/Low',
    shortTitle: '52W H/L',
    overlay: true,
    inputs: [{ key: 'weeks', title: 'Weeks', type: 'int', defval: 52, min: 1, max: 520, step: 1 }],
    compute: (bars, inputs) => {
        const span = num(inputs, 'weeks', 52) * 7 * DAY_MS;
        const n = bars.length;
        const hi = new Array<number>(n).fill(Number.NaN);
        const lo = new Array<number>(n).fill(Number.NaN);
        // Two-pointer sliding window over the time span, monotonic deques for the extremes.
        const maxIdx: number[] = [];
        const minIdx: number[] = [];
        let from = 0;
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
        }
        return {
            plots: [
                { key: 'high', title: '52W high', values: hi, kind: 'step', color: BULLISH },
                { key: 'low', title: '52W low', values: lo, kind: 'step', color: BEARISH },
            ],
        };
    },
};

const zigzag: ClassicIndicatorSpec = {
    type: 'zigzag',
    title: 'ZigZag',
    overlay: true,
    inputs: [
        { key: 'deviation', title: 'Deviation %', type: 'float', defval: 5, min: 0.01, max: 100, step: 0.1 },
        { key: 'depth', title: 'Depth', type: 'int', defval: 10, min: 1, max: 500, step: 1 },
        colorInput(),
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
                    else if (b.low <= ext.price * (1 - dev) && i - (pivots[pivots.length - 1]?.i ?? -depth) >= depth) {
                        pivots.push(ext);
                        up = false;
                        ext = { i, price: b.low };
                    }
                } else if (b.low <= ext.price) {
                    ext = { i, price: b.low };
                } else if (b.high >= ext.price * (1 + dev) && i - (pivots[pivots.length - 1]?.i ?? -depth) >= depth) {
                    pivots.push(ext);
                    up = true;
                    ext = { i, price: b.high };
                }
            }
            pivots.push(ext); // the provisional last leg
        }
        return {
            plots: [],
            polylines: [
                {
                    key: 'zigzag',
                    points: pivots.map((p) => ({ xloc: 'bar_time' as const, x: bars[p.i]!.time, price: p.price })),
                    curved: false,
                    closed: false,
                    lineColor: str(inputs, 'color', SERIES_LINE),
                    lineWidth: 2,
                    lineStyle: 'solid' as const,
                    arrowLeft: false,
                    arrowRight: false,
                },
            ],
        };
    },
};

const williamsFractal: ClassicIndicatorSpec = {
    type: 'williams-fractal',
    title: 'Williams Fractal',
    shortTitle: 'Fractals',
    overlay: true,
    inputs: [{ key: 'periods', title: 'Periods', type: 'int', defval: 2, min: 1, max: 50, step: 1 }],
    compute: (bars, inputs) => {
        const p = num(inputs, 'periods', 2);
        const markers: MarkerPoint[] = [];
        const isExtreme = (i: number, pick: (b: OHLCV) => number, better: (a: number, b: number) => boolean): boolean => {
            const v = pick(bars[i]!);
            for (let k = i - p; k <= i + p; k++) {
                if (k === i) continue;
                if (!better(v, pick(bars[k]!))) return false;
            }
            return true;
        };
        for (let i = p; i < bars.length - p; i++) {
            if (isExtreme(i, (b) => b.high, (a, b) => a >= b)) {
                markers.push({ time: bars[i]!.time, position: 'aboveBar', shape: 'triangleup', color: BULLISH });
            }
            if (isExtreme(i, (b) => b.low, (a, b) => a <= b)) {
                markers.push({ time: bars[i]!.time, position: 'belowBar', shape: 'triangledown', color: BEARISH });
            }
        }
        return { plots: [], markers };
    },
};

export const overlaySpecs: ClassicIndicatorSpec[] = [parabolicSar, vwap, pivotPoints, fiftyTwoWeek, zigzag, williamsFractal];
