/** Named non-minute resolutions → ms. `M` is treated as a 30-day month (bucketing only). */
const NAMED_TF_MS: Record<string, number> = { D: 86_400_000, W: 604_800_000, M: 2_592_000_000 };

/** Unit letter → ms, lower-cased except `M`: a month, which the `m` (minute) alias must not shadow. */
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000 };

/**
 * Parse a tick-count timeframe (`1T`, `100T`, `1000T`, or bare `T` ⇒ `1`). Returns the
 * positive integer tick count, or `null` for any non-tick timeframe.
 */
export function parseTickTimeframe(timeframe: string): number | null {
    const tf = timeframe.trim();
    const m = /^(\d*)\s*[tT]$/.exec(tf);
    if (!m) return null;
    const count = m[1] === '' ? 1 : parseInt(m[1]!, 10);
    return Number.isFinite(count) && count >= 1 ? count : null;
}

/** Whether `timeframe` is a tick-count resolution (`1T`, `100T`, …). */
export function isTickTimeframe(timeframe: string): boolean {
    return parseTickTimeframe(timeframe) !== null;
}

/**
 * Whether bars on `timeframe` have no fixed wall-clock duration (tick bars, etc.).
 * Fixed-duration assumptions — time-based gap healing, bar-close countdowns, and
 * time-keyed deduplication — stand down for these series.
 */
export function isVariableDurationTimeframe(timeframe: string): boolean {
    return isTickTimeframe(timeframe);
}

/**
 * Bar duration in ms for a Vela timeframe: a bare number is **minutes** (Pine
 * resolution — `60` = 1h, `240` = 4h), `D`/`W`/`M` are the named periods, also with a
 * count (`1D`, `2W`, `3M`, `12M`), `S` counts seconds (`30S`), and the `15m`/`4h`/`1d`/`1w`
 * aliases are also accepted. Letters are case-insensitive except `M` (month) vs `m`
 * (minute). Falls back to 1h for anything unparsed.
 */
export function timeframeToMs(timeframe: string): number {
    const tf = timeframe.trim();
    if (NAMED_TF_MS[tf]) return NAMED_TF_MS[tf];
    const m = /^(\d+)\s*([a-zA-Z])?$/.exec(tf);
    if (m) {
        const letter = m[2] ?? 'm'; // bare number ⇒ minutes
        const mult = UNIT_MS[letter === 'M' ? 'M' : letter.toLowerCase()];
        if (mult !== undefined) return parseInt(m[1]!, 10) * mult;
    }
    return 3_600_000;
}
