import type { InputSchema, InputValue } from '../../model/inputs';
import type { OHLCV } from '../../model/ohlcv';
import type { SeriesPoint, SeriesSpec } from '../../model/series';
import { stableSeriesId } from '../../model/identity';
import { BEARISH, BULLISH } from '../../palette';
import type { TapeSource } from '../../../data/tape/TapeSource';
import type { NativeIndicatorDescriptor } from '../NativeIndicator';
import { registerNativeIndicator } from '../NativeIndicator';
import type { DataControl } from '../../DataControl';
import { TapeIndicator, sideColorInputs, str, tapeAvailable } from './TapeIndicator';

const DEFAULT_UP = BULLISH;
const DEFAULT_DOWN = BEARISH;

/**
 * BAR DELTA: how much of each bar's volume was bought by takers minus how much was sold,
 * as a column per bar in its own pane. A bar that closed up on selling delta — or down on
 * buying delta — is the disagreement this indicator exists to show, which is why it is
 * drawn against the bars rather than folded into them.
 *
 * Bars whose tape has not been read yet carry NO column rather than a zero: an empty bar and
 * an unread one look identical in the book, and drawing an unread bar as balanced would
 * invent a reading.
 */
class DeltaIndicator extends TapeIndicator {
    protected draw(source: TapeSource, bars: readonly OHLCV[]): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const up = str(this.inputs.upColor, DEFAULT_UP);
        const down = str(this.inputs.downColor, DEFAULT_DOWN);

        const points: SeriesPoint[] = [];
        for (const bar of bars) {
            const fp = source.footprint(bar.time);
            if (fp == null) {
                points.push({ time: bar.time, value: null });
                continue;
            }
            points.push({ time: bar.time, value: fp.delta, color: fp.delta >= 0 ? up : down });
        }

        const series: SeriesSpec[] = [{
            id: stableSeriesId({ instanceId: 'orderflow-delta', kind: 'columns', title: 'Delta', ordinal: 0 }),
            title: 'Delta',
            paneId: '', // stamped by the orchestrator
            kind: 'columns',
            points,
            style: { color: up, width: 1, lineStyle: 'solid', base: 0 },
        }];
        ctx.emit({ series });
    }
}

export const deltaDescriptor: NativeIndicatorDescriptor = {
    type: 'orderflow-delta',
    title: 'Delta',
    shortTitle: 'Delta',
    paneHint: 'new',
    overlay: false,
    reactsToViewport: true,
    beta: true,
    inputsSchema: (): InputSchema[] => sideColorInputs(DEFAULT_UP, DEFAULT_DOWN),
    defaultInputs: (): Record<string, InputValue> => ({ upColor: DEFAULT_UP, downColor: DEFAULT_DOWN }),
    create: () => new DeltaIndicator(),
    isSupported: (symbol: string, data: DataControl): boolean => tapeAvailable(symbol, data),
};

/** Register the built-in bar-delta indicator (idempotent). Called by the composition root. */
export function registerDelta(): void {
    registerNativeIndicator(deltaDescriptor);
}
