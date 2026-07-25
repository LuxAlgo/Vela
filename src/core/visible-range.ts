import type { OHLCV } from './model/ohlcv';
import type { VisibleRange } from './ports/IChartRenderer';

/** A named visible-range shortcut, resolved against the loaded bars. */
export type VisibleRangePreset = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'YTD' | 'ALL';

const DAY_MS = 86_400_000;

const PRESET_SPAN_MS: Record<Exclude<VisibleRangePreset, 'YTD' | 'ALL'>, number> = {
    '1D': DAY_MS,
    '1W': 7 * DAY_MS,
    '1M': 30 * DAY_MS,
    '3M': 90 * DAY_MS,
    '6M': 180 * DAY_MS,
    '1Y': 365 * DAY_MS,
    '5Y': 5 * 365 * DAY_MS,
};

/**
 * Map a date-range preset to a `[from, to]` in epoch-ms from the loaded bars.
 * `to` is the last loaded bar; `from` is the preset's span before it, clamped to
 * the first loaded bar — the visible window can't extend past loaded history, so a
 * deeper preset than the data simply frames everything (fetching more is out of
 * scope here). `YTD` starts at Jan 1 (UTC) of the last bar's year. Returns null
 * when there are no bars.
 */
export function presetToRange(preset: VisibleRangePreset, bars: readonly OHLCV[]): VisibleRange | null {
    if (bars.length === 0) return null;
    const first = bars[0]!.time;
    const last = bars[bars.length - 1]!.time;
    if (preset === 'ALL') return { from: first, to: last };
    let from: number;
    if (preset === 'YTD') {
        from = Date.UTC(new Date(last).getUTCFullYear(), 0, 1);
    } else {
        from = last - PRESET_SPAN_MS[preset];
    }
    return { from: Math.max(first, from), to: last };
}
