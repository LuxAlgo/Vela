/**
 * Per-drawing timeframe visibility. A drawing may be limited to some timeframes — a weekly
 * level that should stay off a one-minute chart. Timeframes are grouped into bands, each
 * covering every bar duration from its own up to the next band's, so any timeframe (a
 * custom 3-minute or 2-hour one included) lands in exactly one band.
 */

export interface TimeframeBand {
    /** Stable key persisted on the drawing. */
    key: string;
    /** Short label for a picker. */
    label: string;
    /** The shortest bar duration (ms) in the band; it runs up to the next band's. */
    fromMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TIMEFRAME_BANDS: readonly TimeframeBand[] = [
    { key: 's', label: 'Sec', fromMs: 0 },
    { key: '1', label: '1m', fromMs: MIN },
    { key: '5', label: '5m', fromMs: 5 * MIN },
    { key: '15', label: '15m', fromMs: 15 * MIN },
    { key: '60', label: '1H', fromMs: HOUR },
    { key: '240', label: '4H', fromMs: 4 * HOUR },
    { key: 'D', label: 'D', fromMs: DAY },
    { key: 'W', label: 'W', fromMs: 7 * DAY },
    { key: 'M', label: 'M', fromMs: 28 * DAY },
];

const BAND_KEYS = new Set(TIMEFRAME_BANDS.map((b) => b.key));

/** The band a bar duration falls in, or null when the duration is unknown. */
export function timeframeBandOf(barMs: number): string | null {
    if (!(barMs > 0)) return null;
    let key: string | null = null;
    for (const band of TIMEFRAME_BANDS) if (barMs >= band.fromMs) key = band.key;
    return key;
}

/** Whether a drawing limited to `showOn` shows on a chart whose bars last `barMs`. No limit,
 *  or an unknown chart timeframe, always shows. */
export function shownOnTimeframe(showOn: readonly string[] | undefined, barMs: number): boolean {
    if (!showOn) return true;
    const band = timeframeBandOf(barMs);
    return band === null || showOn.includes(band);
}

/** Coerce an untrusted value into a band list (known keys, band order, no repeats);
 *  `undefined` — every timeframe — for anything that is not an array. */
export function sanitizeShowOn(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const wanted = new Set(v.filter((k): k is string => typeof k === 'string' && BAND_KEYS.has(k)));
    return TIMEFRAME_BANDS.map((b) => b.key).filter((k) => wanted.has(k));
}
