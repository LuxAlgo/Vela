// Calendar names for date pickers: month and weekday names, the year label, the order of
// month and year in a header, and the first day of the week. English keeps the picker's
// own tables (`September`, `Sep`, `Su`); other languages read `Intl`, always on the
// Gregorian calendar because the picker produces Gregorian dates.
import { dateFormat } from './dates';
import { localizeAscii, stripBidiMarks } from './numbers';
import type { FormatSettings } from './types';

export const EN_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const EN_MONTHS_SHORT_PICKER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const EN_WEEKDAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Twelve month names, January first. */
export function monthNames(settings: FormatSettings, width: 'long' | 'short'): string[] {
    if (settings.english) return [...(width === 'long' ? EN_MONTHS_LONG : EN_MONTHS_SHORT_PICKER)];
    const dtf = dateFormat(settings, { month: width });
    return Array.from({ length: 12 }, (_, m) => stripBidiMarks(dtf.format(Date.UTC(2000, m, 15))));
}

/** Seven short weekday names, Sunday first (index = `Date#getDay()`). */
export function weekdayNames(settings: FormatSettings): string[] {
    if (settings.english) return [...EN_WEEKDAYS_MIN];
    const dtf = dateFormat(settings, { weekday: 'short' });
    // 2 January 2000 was a Sunday.
    return Array.from({ length: 7 }, (_, d) => stripBidiMarks(dtf.format(Date.UTC(2000, 0, 2 + d))));
}

/** A year as a header label (`2026`, `2026年`). */
export function yearLabel(settings: FormatSettings, year: number): string {
    if (settings.english) return localizeAscii(String(year), settings);
    return stripBidiMarks(dateFormat(settings, { year: 'numeric' }).format(Date.UTC(year, 6, 1)));
}

/** An integer in the settings' digits, without grouping (`2026`, `٢٠٢٦`). */
export function plainInteger(settings: FormatSettings, n: number): string {
    return localizeAscii(String(Math.trunc(n)), settings);
}

const yearFirstCache = new Map<string, boolean>();

/** Whether the locale writes the year before the month (`2026年9月`, not `September 2026`). */
export function yearBeforeMonth(settings: FormatSettings): boolean {
    if (settings.english) return false;
    const key = `${settings.locale}|${settings.numberingSystem}`;
    let first = yearFirstCache.get(key);
    if (first === undefined) {
        const types = dateFormat(settings, { year: 'numeric', month: 'long' })
            .formatToParts(Date.UTC(2026, 8, 15))
            .map((p) => p.type);
        first = types.indexOf('year') < types.indexOf('month');
        yearFirstCache.set(key, first);
    }
    return first;
}

/** Regions whose week starts on Sunday or Saturday (CLDR week data); every other region
 *  starts on Monday. Used where `Intl.Locale` has no week information. */
const SUNDAY_REGIONS = new Set([
    'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CN', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN',
    'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR', 'PT', 'PY',
    'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
]);
const SATURDAY_REGIONS = new Set(['AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY']);

interface WeekInfoLocale {
    weekInfo?: { firstDay?: number };
    getWeekInfo?: () => { firstDay?: number };
}

/** The locale's first day of the week as a `Date#getDay()` index: 0 Sunday, 1 Monday or
 *  6 Saturday. A bare language takes its likely region (`en` → US → Sunday). */
export function localeWeekStart(locale: string): 0 | 1 | 6 {
    let loc: Intl.Locale;
    try {
        loc = new Intl.Locale(locale);
    } catch {
        return 1;
    }
    try {
        const wl = loc as unknown as WeekInfoLocale;
        const info = typeof wl.getWeekInfo === 'function' ? wl.getWeekInfo() : wl.weekInfo;
        const firstDay = info?.firstDay;
        if (typeof firstDay === 'number') return firstDay === 7 ? 0 : firstDay === 6 ? 6 : 1;
    } catch {
        /* no week data on this engine: use the table */
    }
    let region = loc.region;
    if (!region) {
        try {
            region = loc.maximize().region;
        } catch {
            region = undefined;
        }
    }
    if (region && SUNDAY_REGIONS.has(region)) return 0;
    if (region && SATURDAY_REGIONS.has(region)) return 6;
    return 1;
}
