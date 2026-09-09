/**
 * The countdown-to-bar-close chip's text for a bar opened at `barOpen` on a `barMs`
 * cadence, as seen at wall-clock `now`; `null` once the bar has closed (the chip
 * disappears until the next bar arrives instead of sitting at `00:00`).
 *
 * The remaining time is rounded UP so the chip agrees with a clock that shows whole
 * seconds: at `hh:mm:54.500` the clock reads `:54`, which implies 6 s to the minute,
 * and the chip reads `00:06` — flooring would read `00:05` for that whole second.
 */
export function countdownText(barOpen: number, barMs: number, now: number): string | null {
    if (!(barMs > 0)) return null;
    const remaining = barOpen + barMs - now;
    if (remaining <= 0) return null;
    return formatCountdown(remaining);
}

/** `MM:SS` (or `H:MM:SS` past an hour) for the ms remaining until the bar closes, rounded up. */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (v: number): string => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
