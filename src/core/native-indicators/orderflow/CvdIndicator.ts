import type { InputSchema, InputValue } from '../../model/inputs';
import type { OHLCV } from '../../model/ohlcv';
import type { SeriesPoint, SeriesSpec } from '../../model/series';
import type { BarFootprint } from '../../model/orderflow';
import type { Millis } from '../../model/time';
import { stableSeriesId } from '../../model/identity';
import { BEARISH, BULLISH } from '../../palette';
import { cumulativeDeltaBars } from '../../../data/tape/footprint';
import type { TapeSource } from '../../../data/tape/TapeSource';
import type { NativeIndicatorDescriptor } from '../NativeIndicator';
import { registerNativeIndicator } from '../NativeIndicator';
import type { DataControl } from '../../DataControl';
import { TapeIndicator, sideColorInputs, str, tapeAvailable } from './TapeIndicator';
import { ANCHOR_OPTIONS, anchorStart, crossesAnchor, parseAnchor } from './anchors';

const DEFAULT_UP = BULLISH;
const DEFAULT_DOWN = BEARISH;
const DEFAULT_ANCHOR = 'None';
const DEFAULT_STYLE = 'Candles';
/** With no anchor, how much history the running total is willing to sum over. */
const UNANCHORED_BARS = 500;

/**
 * CUMULATIVE VOLUME DELTA: the running sum of bar delta, drawn as candles so it reads the
 * way price does — the total carried in, the total carried out, and the extremes it reached
 * inside the bar. Those wicks come from the delta's PATH through the bar, so a push that was
 * absorbed and reversed before the close still shows instead of averaging away.
 *
 * A cumulative reading is only as good as the tape underneath it, so this draws over the
 * longest UNBROKEN run of bars whose tape has actually been read, ending at the newest one.
 * Summing across a window that was never fetched would produce a confident line built on a
 * hole, which is worse than a shorter one: the number would be wrong, not merely partial.
 */
class CvdIndicator extends TapeIndicator {
    protected override coverageFrom(visibleFrom: Millis, bars: readonly OHLCV[]): Millis {
        const anchor = parseAnchor(str(this.inputs.anchor, DEFAULT_ANCHOR));
        const start = anchorStart(anchor, visibleFrom);
        // Anchored: the total is meaningless before its period opens, so cover from there.
        if (start != null) return Math.max(start, bars[0]?.time ?? start);
        // Unanchored: sum a bounded stretch back from what is on screen rather than the
        // whole loaded history, which on a fine timeframe is a walk of millions of prints.
        const index = bars.findIndex((b) => b.time >= visibleFrom);
        const from = index < 0 ? bars.length - 1 : index;
        return bars[Math.max(0, from - UNANCHORED_BARS)]?.time ?? visibleFrom;
    }

    protected draw(source: TapeSource, bars: readonly OHLCV[]): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const anchor = parseAnchor(str(this.inputs.anchor, DEFAULT_ANCHOR));
        const up = str(this.inputs.upColor, DEFAULT_UP);
        const down = str(this.inputs.downColor, DEFAULT_DOWN);
        const asLine = str(this.inputs.style, DEFAULT_STYLE) === 'Line';

        // Only the unbroken, actually-read tail can be summed (see the class note).
        const covered = source.coveredTail(bars);
        const footprints: BarFootprint[] = [];
        for (const time of covered) {
            const fp = source.footprint(time);
            // A covered bar that never printed is a real zero-delta bar, not a gap.
            footprints.push(fp ?? emptyFootprint(time, source.levelSize));
        }
        const cvd = cumulativeDeltaBars(footprints, (bar, previous) => crossesAnchor(anchor, bar.time, previous.time));

        const series: SeriesSpec[] = asLine
            ? [{
                id: stableSeriesId({ instanceId: 'orderflow-cvd', kind: 'line', title: 'CVD', ordinal: 0 }),
                title: 'CVD',
                paneId: '',
                kind: 'line',
                points: cvd.map((b): SeriesPoint => ({ time: b.time, value: b.close, color: b.close >= b.open ? up : down })),
                style: { color: up, width: 2, lineStyle: 'solid' },
            }]
            : [{
                id: stableSeriesId({ instanceId: 'orderflow-cvd', kind: 'candle', title: 'CVD', ordinal: 0 }),
                title: 'CVD',
                paneId: '',
                kind: 'candle',
                bars: cvd.map((b): OHLCV => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })),
                style: { up, down },
            }];

        ctx.emit({ series, priceLines: [{
            id: stableSeriesId({ instanceId: 'orderflow-cvd', kind: 'hline', title: 'zero', ordinal: 0 }),
            paneId: '',
            price: 0,
            lineStyle: 'dotted',
            width: 1,
        }] });
    }
}

/** A covered bar that printed nothing — a genuine flat bar, distinct from an unread one. */
function emptyFootprint(time: Millis, levelSize: number): BarFootprint {
    return { time, levelSize, levels: [], buy: 0, sell: 0, delta: 0, volume: 0, deltaHigh: 0, deltaLow: 0, poc: null };
}

export const cvdDescriptor: NativeIndicatorDescriptor = {
    type: 'orderflow-cvd',
    title: 'Cumulative Volume Delta',
    shortTitle: 'CVD',
    paneHint: 'new',
    overlay: false,
    reactsToViewport: true,
    beta: true,
    inputsSchema: (): InputSchema[] => [
        { key: 'anchor', title: 'Reset', type: 'string', defval: DEFAULT_ANCHOR, options: [...ANCHOR_OPTIONS], tooltip: 'Restart the running total at each period (UTC)' },
        { key: 'style', title: 'Style', type: 'string', defval: DEFAULT_STYLE, options: ['Candles', 'Line'] },
        ...sideColorInputs(DEFAULT_UP, DEFAULT_DOWN),
    ],
    defaultInputs: (): Record<string, InputValue> => ({ anchor: DEFAULT_ANCHOR, style: DEFAULT_STYLE, upColor: DEFAULT_UP, downColor: DEFAULT_DOWN }),
    create: () => new CvdIndicator(),
    isSupported: (symbol: string, data: DataControl): boolean => tapeAvailable(symbol, data),
};

/** Register the built-in cumulative-delta indicator (idempotent). Called by the composition root. */
export function registerCvd(): void {
    registerNativeIndicator(cvdDescriptor);
}
