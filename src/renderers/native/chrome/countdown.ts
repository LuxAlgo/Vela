import { ENGLISH_FORMAT } from '../../../core/format/formatters';
import type { ResolvedFormatters } from '../../../core/format/types';

/**
 * The countdown-to-bar-close chip's text for a bar opened at `barOpen` on a `barMs`
 * cadence, as seen at wall-clock `now`; `null` once the bar has closed (the chip
 * disappears until the next bar arrives instead of sitting at `00:00`).
 *
 * The remaining time is rounded UP so the chip agrees with a clock that shows whole
 * seconds: at `hh:mm:54.500` the clock reads `:54`, which implies 6 s to the minute,
 * and the chip reads `00:06` — flooring would read `00:05` for that whole second.
 */
export function countdownText(barOpen: number, barMs: number, now: number, fmt: ResolvedFormatters = ENGLISH_FORMAT): string | null {
    if (!(barMs > 0)) return null;
    const remaining = barOpen + barMs - now;
    if (remaining <= 0) return null;
    return formatCountdown(remaining, fmt);
}

/** `MM:SS` (or `H:MM:SS` past an hour) for the ms remaining until the bar closes, rounded up. */
export function formatCountdown(ms: number, fmt: ResolvedFormatters = ENGLISH_FORMAT): string {
    return fmt.duration(ms, { style: 'countdown', surface: 'lastPrice' });
}
