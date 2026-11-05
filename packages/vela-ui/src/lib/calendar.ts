// Calendar names for the date picker in a translator's language: month and weekday names,
// the year label, the order of month and year in a header. English keeps the picker's own
// tables (`September`, `Sep`, `Su`); other languages read `Intl`, always on the Gregorian
// calendar because the picker produces Gregorian dates.
import type { Translator } from './i18n';

export interface CalendarSettings {
    readonly locale: string;
    readonly numberingSystem: string;
    /** The locale's language is English: the picker's own tables apply. */
    readonly english: boolean;
}

const EN_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_WEEKDAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const BIDI_MARKS = /[\u200e\u200f\u061c]/g;
const stripBidiMarks = (text: string): string => text.replace(BIDI_MARKS, '');

/** The calendar settings of a translator (English, Latin digits, without one). */
export function calendarSettings(i18n: Translator | null | undefined): CalendarSettings {
    const locale = i18n?.locale ?? 'en';
    let language = locale.split(/[-_]/)[0] ?? locale;
    try {
        language = new Intl.Locale(locale).language;
    } catch {
        /* an unparsable tag keeps its first subtag */
    }
    return { locale, numberingSystem: i18n?.numberingSystem ?? 'latn', english: language.toLowerCase() === 'en' };
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(settings: CalendarSettings, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${settings.locale}|${settings.numberingSystem}|${JSON.stringify(options)}`;
    let dtf = dateFormats.get(key);
    if (!dtf) {
        try {
            dtf = new Intl.DateTimeFormat(settings.locale, { ...options, timeZone: 'UTC', calendar: 'gregory', numberingSystem: settings.numberingSystem });
        } catch {
            dtf = new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC', calendar: 'gregory' });
        }
        dateFormats.set(key, dtf);
    }
    return dtf;
}

const digitTables = new Map<string, string[] | null>();

/** ASCII digits rewritten in the settings' numbering system. */
function localizeDigits(text: string, settings: CalendarSettings): string {
    const key = `${settings.locale}|${settings.numberingSystem}`;
    let digits = digitTables.get(key);
    if (digits === undefined) {
        let nf: Intl.NumberFormat;
        try {
            nf = new Intl.NumberFormat(settings.locale, { numberingSystem: settings.numberingSystem, useGrouping: false, maximumFractionDigits: 0 });
        } catch {
            nf = new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 0 });
        }
        const table = Array.from({ length: 10 }, (_, d) => stripBidiMarks(nf.format(d)));
        digits = table.every((d, i) => d === String(i)) ? null : table;
        digitTables.set(key, digits);
    }
    if (!digits) return text;
    const map = digits;
    return text.replace(/[0-9]/g, (d) => map[Number(d)]!);
}

/** Twelve month names, January first. */
export function monthNames(settings: CalendarSettings, width: 'long' | 'short'): string[] {
    if (settings.english) return [...(width === 'long' ? EN_MONTHS_LONG : EN_MONTHS_SHORT)];
    const dtf = dateFormat(settings, { month: width });
    return Array.from({ length: 12 }, (_, m) => stripBidiMarks(dtf.format(Date.UTC(2000, m, 15))));
}

/** Seven short weekday names, Sunday first (index = `Date#getDay()`). */
export function weekdayNames(settings: CalendarSettings): string[] {
    if (settings.english) return [...EN_WEEKDAYS_MIN];
    const dtf = dateFormat(settings, { weekday: 'short' });
    // 2 January 2000 was a Sunday.
    return Array.from({ length: 7 }, (_, d) => stripBidiMarks(dtf.format(Date.UTC(2000, 0, 2 + d))));
}

/** A year as a header label (`2026`, `2026年`). */
export function yearLabel(settings: CalendarSettings, year: number): string {
    if (settings.english) return localizeDigits(String(year), settings);
    return stripBidiMarks(dateFormat(settings, { year: 'numeric' }).format(Date.UTC(year, 6, 1)));
}

/** An integer in the settings' digits, without grouping (`2026`, `٢٠٢٦`). */
export function plainInteger(settings: CalendarSettings, n: number): string {
    return localizeDigits(String(Math.trunc(n)), settings);
}

const yearFirstCache = new Map<string, boolean>();

/** Whether the locale writes the year before the month (`2026年9月`, not `September 2026`). */
export function yearBeforeMonth(settings: CalendarSettings): boolean {
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
