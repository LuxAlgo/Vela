/**
 * Minimal IANA-timezone support for the time axis + stamps. The renderer works in
 * epoch-ms (UTC) everywhere; to render labels in a chosen zone we compute that zone's
 * UTC offset for a given instant and shift the ms before reading `getUTC*`. A single
 * offset (sampled at the visible range's midpoint) is reused across the range — exact
 * away from DST boundaries, with at most a one-hour seam across a transition, which is
 * an acceptable trade for cheap, dependency-free zoning.
 */
import { zoneOffsetMs } from '../../../core/format/dates';

const DAY_MS = 86_400_000;

/** The zone a bar time is read in. Bars of a day or longer (D, W, M and their multiples)
 *  are stamped at 00:00 UTC of their trading date: a date, not an instant. Shifting one
 *  into a zone behind UTC would move it onto the previous day, so they read in UTC whatever
 *  the display zone. Intraday bars are real instants and read in `timeZone`. */
export function displayZone(timeZone: string, barIntervalMs: number): string {
    return barIntervalMs >= DAY_MS ? 'UTC' : timeZone;
}

/** The zone's offset from UTC at `ms`, in milliseconds (e.g. New York in winter ⇒ -5h).
 *  Returns 0 for UTC / empty / unknown zones so callers degrade to plain UTC. The
 *  formatter behind it stays pinned to en-US whatever the chart's locale: it PARSES the
 *  zone's wall-clock parts back into numbers, so localized digits or calendars would
 *  break the arithmetic. */
export function tzOffsetMs(ms: number, timeZone: string): number {
    return zoneOffsetMs(ms, timeZone);
}

/** A `Date` whose `getUTC*` accessors read the wall-clock time in `timeZone`. */
export function zonedDate(ms: number, timeZone: string): Date {
    return new Date(ms + tzOffsetMs(ms, timeZone));
}
