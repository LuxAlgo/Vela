// plotcandle()/plotbar() per-bar colors are index-aligned to their series' bars, so a value
// patch that states them replaces them together with the bars. Replacing only the bars left
// each color on whatever candle moved into its index, and candles past the mount-time count
// kept the defaults. A patch that omits them keeps the current set, like the other optional
// fields of a value patch.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { CandleBarColor, CandleSeries } from '../src/core/model/series';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { SeriesValueDelta, ValuePatch } from '../src/core/model/patch';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, k) => from + k);
const bar = (i: number): OHLCV => ({ time: T0 + i * HOUR, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1 });
const color = (i: number): CandleBarColor => ({ color: `#0000${String(i).padStart(2, '0')}` });

function candleModel(from: number, to: number): IndicatorModel {
    const candles: CandleSeries = {
        id: 'trend:candle',
        title: 'Trend',
        paneId: 'price',
        kind: 'candle',
        bars: range(from, to).map(bar),
        barColors: range(from, to).map(color),
    };
    return {
        id: 'trend',
        title: 'Trend',
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [candles],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

/** Mounts the bars [0, 5) with their colors, applies one value patch, returns the series. */
function patchCandles(delta: Extract<SeriesValueDelta, { kind: 'bars' }>): CandleSeries | undefined {
    const r = new NativeRenderer();
    const internals = r as unknown as { scene: SceneGraph; scheduler: { invalidate(): void } };
    internals.scheduler = { invalidate: () => {} }; // unmounted: there is no frame to schedule
    // The scene half of `mountIndicator`, without its DOM (legend, panes, tables).
    internals.scene.indicators.set('trend', candleModel(0, 5));

    const times = delta.bars.map((b) => b.time);
    const patch: ValuePatch = { kind: 'value', indicatorId: 'trend', dirty: { from: Math.min(...times), to: Math.max(...times) }, series: [delta] };
    r.updateIndicator({ id: 'trend' }, patch);

    const s = internals.scene.indicators.get('trend')?.series[0];
    return s?.kind === 'candle' ? s : undefined;
}

describe('a value patch on a candle series with per-bar colors', () => {
    it('replaces the colors together with the bars', () => {
        // The next run covers a window one bar later: every color moves down one index.
        const s = patchCandles({ seriesId: 'trend:candle', kind: 'bars', bars: range(1, 6).map(bar), barColors: range(1, 6).map(color) });

        expect(s?.bars).toEqual(range(1, 6).map(bar));
        expect(s?.barColors).toEqual(range(1, 6).map(color));
    });

    it('shows a new color on the same bars', () => {
        // The next run recolors the last bar without adding one, e.g. a trend flip on the forming candle.
        const recolored = range(0, 5).map((i) => (i === 4 ? { color: '#ff0000' } : color(i)));
        const s = patchCandles({ seriesId: 'trend:candle', kind: 'bars', bars: range(0, 5).map(bar), barColors: recolored });

        expect(s?.bars).toEqual(range(0, 5).map(bar));
        expect(s?.barColors).toEqual(recolored);
    });

    it('colors the candles a growing series adds', () => {
        // The next run spans one more bar: the new candle needs its own color, not the default.
        const s = patchCandles({ seriesId: 'trend:candle', kind: 'bars', bars: range(0, 6).map(bar), barColors: range(0, 6).map(color) });

        expect(s?.bars).toHaveLength(6);
        expect(s?.barColors?.[5]).toEqual(color(5));
    });

    it('clears the colors when the patch states an empty set', () => {
        // A run where no bar sets a color: the mount-time colors must not stay on the new bars.
        const s = patchCandles({ seriesId: 'trend:candle', kind: 'bars', bars: range(1, 6).map(bar), barColors: [] });

        expect(s?.barColors).toEqual([]);
    });

    it('keeps the current colors when the patch leaves them out', () => {
        // A host driving `updateIndicator` itself may send the bars alone: the colors must survive that.
        const s = patchCandles({ seriesId: 'trend:candle', kind: 'bars', bars: range(0, 5).map(bar) });

        expect(s?.bars).toEqual(range(0, 5).map(bar));
        expect(s?.barColors).toEqual(range(0, 5).map(color));
    });
});
