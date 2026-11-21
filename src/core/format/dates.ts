// Built-in date and time formatting for chart text. English keeps Vela's established
// shapes (`Jan 5`, `14:30`, `Sun 30 Aug '26 19:00`); other languages take month and
// weekday names and field order from `Intl`. The calendar is always Gregorian (a Thai
// locale would otherwise count Buddhist years) and the clock is 24-hour unless the host
// asks otherwise.
import { localizeAscii, localizeDigits, numberFormat, stripBidiMarks } from './numbers';
import type { ClockFormatOptions, DurationFormatOptions, FormatSettings, TimeStampFormatOptions, TimeTickFormatOptions, TimeTickUnit } from './types';

export const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const EN_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const DAY_MS = 86_400_000;

const zoneParsers = new Map<string, Intl.DateTimeFormat | null>();

/**
 * The zone's offset from UTC at `ms`, in milliseconds (New York in winter: -5 h); 0 for
 * UTC, an empty zone or an unknown one. The formatter is pinned to en-US because its
 * parts are PARSED back into numbers, never shown: a localized formatter could emit
 * other digits or calendars and break the arithmetic.
 */
export function zoneOffsetMs(ms: number, timeZone: string): number {
    if (!timeZone || timeZone === 'UTC') return 0;
    let dtf = zoneParsers.get(timeZone);
    if (dtf === undefined) {
        try {
            dtf = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
        } catch {
            dtf = null;
        }
        zoneParsers.set(timeZone, dtf);
    }
    if (!dtf) return 0;
    try {
        const parts = dtf.formatToParts(new Date(ms));
        const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
        const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
        return asUTC - ms;
    } catch {
        return 0;
    }
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** A cached Gregorian `Intl.DateTimeFormat` that reads wall-clock fields in UTC (callers
 *  shift the instant into the display zone first, the way the axes align their ticks). */
export function dateFormat(settings: FormatSettings, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${settings.locale}|${settings.numberingSystem}|${JSON.stringify(options)}`;
    let dtf = dateFormats.get(key);
    if (!dtf) {
        const full: Intl.DateTimeFormatOptions = { ...options, timeZone: 'UTC', calendar: 'gregory', numberingSystem: settings.numberingSystem };
        try {
            dtf = new Intl.DateTimeFormat(settings.locale, full);
        } catch {
            dtf = new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC', calendar: 'gregory' });
        }
        dateFormats.set(key, dtf);
    }
    return dtf;
}

/** The `Intl` options of a time of day under the settings' clock. */
function clockOptions(settings: FormatSettings): Intl.DateTimeFormatOptions {
    if (settings.hourCycle === 'h23') return { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (settings.hourCycle === 'h12') return { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' };
    return { hour: 'numeric', minute: '2-digit' };
}

/** English time of day: Vela's `14:30` on the default clock, `Intl` on any other. */
function englishClock(wall: Date, settings: FormatSettings): string {
    if (settings.hourCycle === 'h23') return localizeAscii(`${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`, settings);
    return stripBidiMarks(dateFormat(settings, clockOptions(settings)).format(wall));
}

const TICK_OPTIONS: Record<'year' | 'month' | 'day', Intl.DateTimeFormatOptions> = {
    year: { year: 'numeric' },
    month: { month: 'short' },
    day: { month: 'short', day: 'numeric' },
};

const isClockUnit = (unit: TimeTickUnit): boolean => unit === 'hour' || unit === 'minute' || unit === 'second';

export function formatTimeTick(ms: number, options: TimeTickFormatOptions, settings: FormatSettings): string {
    const wall = new Date(ms + (options.offsetMs ?? 0));
    const unit = options.unit;
    if (settings.english) {
        if (isClockUnit(unit)) return englishClock(wall, settings);
        const month = EN_MONTHS_SHORT[wall.getUTCMonth()]!;
        if (unit === 'year') return localizeAscii(String(wall.getUTCFullYear()), settings);
        if (unit === 'month') return month;
        return localizeAscii(`${month} ${wall.getUTCDate()}`, settings);
    }
    const opts = isClockUnit(unit) ? clockOptions(settings) : TICK_OPTIONS[unit as 'year' | 'month' | 'day'];
    return stripBidiMarks(dateFormat(settings, opts).format(wall));
}

export function formatTimeStamp(ms: number, options: TimeStampFormatOptions | undefined, settings: FormatSettings): string {
    const wall = new Date(ms + zoneOffsetMs(ms, options?.timeZone ?? 'UTC'));
    const withTime = options?.withTime ?? true;
    if (settings.english) {
        const date = localizeAscii(
            `${EN_WEEKDAYS_SHORT[wall.getUTCDay()]} ${wall.getUTCDate()} ${EN_MONTHS_SHORT[wall.getUTCMonth()]} '${pad2(wall.getUTCFullYear() % 100)}`,
            settings,
        );
        return withTime ? `${date} ${englishClock(wall, settings)}` : date;
    }
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', ...(withTime ? clockOptions(settings) : {}) };
    return stripBidiMarks(dateFormat(settings, opts).format(wall));
}

/** `MM:SS`, or `H:MM:SS` past an hour, rounded up to whole seconds. */
function countdownText(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (v: number): string => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The two largest units of a span: `2d 4h`, `3h 15m`, `45m`, `30s`. */
function spanParts(ms: number): Array<readonly [number, 'day' | 'hour' | 'minute' | 'second']> {
    const m = Math.abs(ms);
    const HR = 3_600_000;
    const MIN = 60_000;
    if (m >= DAY_MS) {
        const d = Math.floor(m / DAY_MS);
        const h = Math.round((m % DAY_MS) / HR);
        return h ? [[d, 'day'], [h, 'hour']] : [[d, 'day']];
    }
    if (m >= HR) {
        const h = Math.floor(m / HR);
        const mn = Math.round((m % HR) / MIN);
        return mn ? [[h, 'hour'], [mn, 'minute']] : [[h, 'hour']];
    }
    if (m >= MIN) return [[Math.round(m / MIN), 'minute']];
    return [[Math.round(m / 1000), 'second']];
}

const EN_UNIT = { day: 'd', hour: 'h', minute: 'm', second: 's' } as const;

export function formatDuration(ms: number, options: DurationFormatOptions | undefined, settings: FormatSettings): string {
    if ((options?.style ?? 'countdown') === 'countdown') return localizeDigits(countdownText(ms), settings);
    const parts = spanParts(ms);
    if (settings.english) return localizeDigits(parts.map(([n, u]) => `${n}${EN_UNIT[u]}`).join(' '), settings);
    return parts.map(([n, unit]) => stripBidiMarks(numberFormat(settings, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n))).join(' ');
}

const clockFormats = new Map<string, Intl.DateTimeFormat | null>();

/** A wall clock in a zone. English on the default clock keeps Vela's `14:05:09`; other
 *  locales and clocks read `Intl`, with the settings' digits and hour cycle. */
export function formatClock(ms: number, options: ClockFormatOptions | undefined, settings: FormatSettings): string {
    const timeZone = options?.timeZone ?? 'UTC';
    const seconds = options?.seconds ?? true;
    const english = settings.english && settings.hourCycle === 'h23';
    const key = `${english ? 'en-GB' : settings.locale}|${settings.numberingSystem}|${settings.hourCycle}|${timeZone}|${seconds}`;
    let dtf = clockFormats.get(key);
    if (dtf === undefined) {
        const base: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), timeZone };
        try {
            dtf = english
                ? new Intl.DateTimeFormat('en-GB', { ...base, hour12: false })
                : new Intl.DateTimeFormat(settings.locale, {
                      ...base,
                      calendar: 'gregory',
                      numberingSystem: settings.numberingSystem,
                      ...(settings.hourCycle === 'locale' ? {} : { hourCycle: settings.hourCycle }),
                  });
        } catch {
            dtf = null;
        }
        clockFormats.set(key, dtf);
    }
    if (!dtf) return '';
    try {
        return stripBidiMarks(dtf.format(new Date(ms)));
    } catch {
        return '';
    }
}
