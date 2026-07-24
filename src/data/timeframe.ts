/** Named non-minute resolutions → ms. `M` is treated as a 30-day month (bucketing only). */
const NAMED_TF_MS: Record<string, number> = { D: 86_400_000, W: 604_800_000, M: 2_592_000_000 };

/**
 * Bar duration in ms for a Vela timeframe: a bare number is **minutes** (Pine
 * resolution — `60` = 1h, `240` = 4h), `D`/`W`/`M` are the named periods, and the
 * `15m`/`4h`/`1d`/`1w` aliases are also accepted. Falls back to 1h for anything unparsed.
 */
export function timeframeToMs(timeframe: string): number {
    const tf = timeframe.trim();
    if (NAMED_TF_MS[tf]) return NAMED_TF_MS[tf];
    const m = /^(\d+)\s*(m|h|d|w)?$/i.exec(tf);
    if (m) {
        const n = parseInt(m[1]!, 10);
        const unit = (m[2] ?? 'm').toLowerCase(); // bare number ⇒ minutes
        const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
        return n * mult;
    }
    return 3_600_000;
}
