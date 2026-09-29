// Where a cumulative reading restarts. Boundaries are computed in UTC, which is the right
// answer for the continuously-traded markets the bundled providers serve; a venue with real
// trading sessions would anchor on its calendar instead (`DataProvider.getCalendar`), and
// this deliberately does not pretend to do that.
import type { Millis } from '../../model/time';

/** The reset points a cumulative reading can be anchored to. */
export type CumulativeAnchor = 'none' | 'day' | 'week' | 'month';

/** Option labels for the settings dropdown, in the order they are offered. */
export const ANCHOR_OPTIONS = ['None', 'Day', 'Week', 'Month'] as const;

/** Parse a stored/settings label into an anchor (anything unrecognized means no reset). */
export function parseAnchor(label: string | undefined): CumulativeAnchor {
    switch ((label ?? '').trim().toLowerCase()) {
        case 'day': return 'day';
        case 'week': return 'week';
        case 'month': return 'month';
        default: return 'none';
    }
}

const MS_PER_DAY = 86_400_000;

/** The UTC day index a timestamp falls in. */
function dayIndex(t: Millis): number {
    return Math.floor(t / MS_PER_DAY);
}

/** The UTC week index a timestamp falls in, weeks starting MONDAY (epoch day 0 was a Thursday). */
function weekIndex(t: Millis): number {
    return Math.floor((dayIndex(t) + 3) / 7);
}

/** The UTC month index a timestamp falls in, counted from year 0. */
function monthIndex(t: Millis): number {
    const d = new Date(t);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Whether `time` opens a new anchor period relative to `previous`. Feeds
 * `cumulativeDeltaBars`, which asks it per bar.
 */
export function crossesAnchor(anchor: CumulativeAnchor, time: Millis, previous: Millis): boolean {
    switch (anchor) {
        case 'day': return dayIndex(time) !== dayIndex(previous);
        case 'week': return weekIndex(time) !== weekIndex(previous);
        case 'month': return monthIndex(time) !== monthIndex(previous);
        case 'none': return false;
    }
}

/**
 * The start of the anchor period containing `time` — how far back a cumulative reading must
 * have the tape covered before its running total means anything. `'none'` has no start, so
 * the caller decides how much history it is willing to sum.
 */
export function anchorStart(anchor: CumulativeAnchor, time: Millis): Millis | null {
    switch (anchor) {
        case 'day': return dayIndex(time) * MS_PER_DAY;
        case 'week': return (weekIndex(time) * 7 - 3) * MS_PER_DAY;
        case 'month': {
            const d = new Date(time);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        }
        case 'none': return null;
    }
}
