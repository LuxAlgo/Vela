import { msg } from './i18n/message';
import { sourceText, textOf } from './i18n/text';
import type { MessageDescriptor, Translator } from './i18n/types';
// The canonical display-timezone catalog — ONE list for every zone picker (the widget's
// bottom bar, the time-axis context menu, the renderer's settings dialog), so they can
// never drift apart. Ordered by standard UTC offset (UTC first); every whole, half and
// quarter-hour offset from UTC-12 to UTC+14 is represented. Offsets are computed live
// (DST-aware), never hardcoded in labels.

export interface TimezoneEntry {
    value: string;
    /** The place the zone is named after, in English. */
    label: string;
    /** The same name as a message, for pickers in other languages. */
    name: MessageDescriptor;
}

function tz(value: string, name: MessageDescriptor): TimezoneEntry {
    return { value, label: sourceText(name), name };
}

export const TIMEZONES: readonly TimezoneEntry[] = [
    tz('Etc/UTC', msg('timezone.Etc.UTC', 'UTC')),
    tz('Etc/GMT+12', msg('timezone.Etc.GMTPlus12', 'International Date Line West')),
    tz('Pacific/Pago_Pago', msg('timezone.Pacific.PagoPago', 'Pago Pago')),
    tz('Pacific/Honolulu', msg('timezone.Pacific.Honolulu', 'Honolulu')),
    tz('Pacific/Marquesas', msg('timezone.Pacific.Marquesas', 'Marquesas Islands')),
    tz('America/Anchorage', msg('timezone.America.Anchorage', 'Anchorage')),
    tz('America/Los_Angeles', msg('timezone.America.LosAngeles', 'Los Angeles')),
    tz('America/Phoenix', msg('timezone.America.Phoenix', 'Phoenix')),
    tz('America/Denver', msg('timezone.America.Denver', 'Denver')),
    tz('America/Chicago', msg('timezone.America.Chicago', 'Chicago')),
    tz('America/Mexico_City', msg('timezone.America.MexicoCity', 'Mexico City')),
    tz('America/New_York', msg('timezone.America.NewYork', 'New York')),
    tz('America/Bogota', msg('timezone.America.Bogota', 'Bogotá')),
    tz('America/Caracas', msg('timezone.America.Caracas', 'Caracas')),
    tz('America/Santiago', msg('timezone.America.Santiago', 'Santiago')),
    tz('America/St_Johns', msg('timezone.America.StJohns', "St. John's")),
    tz('America/Sao_Paulo', msg('timezone.America.SaoPaulo', 'São Paulo')),
    tz('America/Argentina/Buenos_Aires', msg('timezone.America.Argentina.BuenosAires', 'Buenos Aires')),
    tz('America/Noronha', msg('timezone.America.Noronha', 'Fernando de Noronha')),
    tz('Atlantic/Azores', msg('timezone.Atlantic.Azores', 'Azores')),
    tz('Atlantic/Reykjavik', msg('timezone.Atlantic.Reykjavik', 'Reykjavik')),
    tz('Europe/London', msg('timezone.Europe.London', 'London')),
    tz('Europe/Paris', msg('timezone.Europe.Paris', 'Paris')),
    tz('Europe/Berlin', msg('timezone.Europe.Berlin', 'Berlin')),
    tz('Europe/Athens', msg('timezone.Europe.Athens', 'Athens')),
    tz('Africa/Cairo', msg('timezone.Africa.Cairo', 'Cairo')),
    tz('Africa/Johannesburg', msg('timezone.Africa.Johannesburg', 'Johannesburg')),
    tz('Europe/Moscow', msg('timezone.Europe.Moscow', 'Moscow')),
    tz('Europe/Istanbul', msg('timezone.Europe.Istanbul', 'Istanbul')),
    tz('Asia/Tehran', msg('timezone.Asia.Tehran', 'Tehran')),
    tz('Asia/Dubai', msg('timezone.Asia.Dubai', 'Dubai')),
    tz('Asia/Kabul', msg('timezone.Asia.Kabul', 'Kabul')),
    tz('Asia/Karachi', msg('timezone.Asia.Karachi', 'Karachi')),
    tz('Asia/Kolkata', msg('timezone.Asia.Kolkata', 'Mumbai')),
    tz('Asia/Kathmandu', msg('timezone.Asia.Kathmandu', 'Kathmandu')),
    tz('Asia/Dhaka', msg('timezone.Asia.Dhaka', 'Dhaka')),
    tz('Asia/Yangon', msg('timezone.Asia.Yangon', 'Yangon')),
    tz('Asia/Bangkok', msg('timezone.Asia.Bangkok', 'Bangkok')),
    tz('Asia/Shanghai', msg('timezone.Asia.Shanghai', 'Shanghai')),
    tz('Asia/Hong_Kong', msg('timezone.Asia.HongKong', 'Hong Kong')),
    tz('Asia/Singapore', msg('timezone.Asia.Singapore', 'Singapore')),
    tz('Australia/Eucla', msg('timezone.Australia.Eucla', 'Eucla')),
    tz('Asia/Tokyo', msg('timezone.Asia.Tokyo', 'Tokyo')),
    tz('Asia/Seoul', msg('timezone.Asia.Seoul', 'Seoul')),
    tz('Australia/Adelaide', msg('timezone.Australia.Adelaide', 'Adelaide')),
    tz('Australia/Sydney', msg('timezone.Australia.Sydney', 'Sydney')),
    tz('Australia/Lord_Howe', msg('timezone.Australia.LordHowe', 'Lord Howe Island')),
    tz('Pacific/Noumea', msg('timezone.Pacific.Noumea', 'Nouméa')),
    tz('Pacific/Auckland', msg('timezone.Pacific.Auckland', 'Auckland')),
    tz('Pacific/Chatham', msg('timezone.Pacific.Chatham', 'Chatham Islands')),
    tz('Pacific/Apia', msg('timezone.Pacific.Apia', 'Apia')),
    tz('Pacific/Kiritimati', msg('timezone.Pacific.Kiritimati', 'Kiritimati')),
];

/**
 * The "follow the market" choice: not a zone but a RULE, resolved per chart to the
 * symbol's own trading timezone (`SymbolInfo.timezone` — Chicago for CME futures, New
 * York for US equities, UTC for crypto). It is what the workspace stores and persists;
 * a renderer only ever receives the resolved IANA zone (see {@link resolveTimezone}).
 */
export const EXCHANGE_TIMEZONE = 'exchange';

export function isExchangeTimezone(zone: string): boolean {
    return zone === EXCHANGE_TIMEZONE;
}

/**
 * The IANA zone a chart actually renders in. The exchange rule resolves to the market's
 * zone, falling back to UTC while symbol metadata is unknown (not landed yet, or a
 * provider that declares none); an explicit zone passes through untouched.
 */
export function resolveTimezone(zone: string, exchangeZone: string | undefined): string {
    if (!isExchangeTimezone(zone)) return zone;
    return exchangeZone && exchangeZone !== '' ? exchangeZone : 'Etc/UTC';
}

/** The renderer's config default is the bare `'UTC'` alias — fold it (and any other
 *  UTC spelling) onto the catalog's `'Etc/UTC'` so selection checks land on one entry. */
export function normalizeTimezone(zone: string): string {
    return zone === 'UTC' || zone === 'Etc/UTC' || zone === 'Etc/GMT' ? 'Etc/UTC' : zone;
}

export interface TimezoneRow {
    /** The value a pick stores — an IANA zone, or {@link EXCHANGE_TIMEZONE}. */
    value: string;
    label: string;
    checked: boolean;
}

/**
 * The rows every zone PICKER offers (bottom bar, time-axis menu, mobile sheet, the
 * workspace's chart-settings row): UTC, then the exchange rule, then the rest of the
 * catalog. `current` is the stored choice (rule or zone). The exchange row reads plain
 * "Exchange" — it is a rule, not a zone, so it carries no offset (the bar's clock/offset
 * label shows the resolved zone). The renderer's own settings row does NOT use this: it
 * edits a resolved zone and lists {@link TIMEZONES} alone (the workspace hides that row
 * and contributes this list in its place).
 */
export function timezoneMenuRows(current: string, i18n?: Translator | null): TimezoneRow[] {
    const active = normalizeTimezone(current);
    const [utc, ...zones] = TIMEZONES.map((t) => ({ value: t.value, label: tzMenuLabel(t.value, textOf(i18n, t.name), i18n), checked: t.value === active }));
    return [utc!, { value: EXCHANGE_TIMEZONE, label: textOf(i18n, EXCHANGE_LABEL), checked: isExchangeTimezone(current) }, ...zones];
}

const EXCHANGE_LABEL = msg('timezone.exchange', 'Exchange');
const MENU_LABEL = msg('timezone.menuLabel', '({offset}) {location}');

/** Current UTC offset of an IANA zone as `"UTC"`, `"UTC+2"` or `"UTC-9:30"`. The
 *  formatter stays pinned to en-US whatever the chart's locale: the `GMT±h:mm` it emits is
 *  PARSED below, and a localized one could spell the offset differently. */
export function tzOffset(zone: string, date: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(date);
        const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        const m = raw.match(/GMT(?:(\+|-)(\d{1,2})(?::(\d{2}))?)?/);
        if (!m || !m[1]) return 'UTC';
        const sign = m[1] === '-' ? '-' : '+';
        const hrs = m[2] ?? '0';
        const mins = m[3] ?? '';
        return mins ? `UTC${sign}${hrs}:${mins}` : `UTC${sign}${hrs}`;
    } catch {
        return 'UTC';
    }
}

/** Dropdown row label — UTC omits the offset prefix. `location` is the zone's place name
 *  as the picker shows it; `i18n` places the offset the way its language writes it. */
export function tzMenuLabel(zone: string, location: string, i18n?: Translator | null): string {
    if (normalizeTimezone(zone) === 'Etc/UTC') return location;
    return textOf(i18n, MENU_LABEL, { offset: tzOffset(zone), location });
}

/** Compact label for the bottom-bar button — just the offset ("UTC", "UTC+2", "UTC-9:30"). */
export function tzButtonLabel(zone: string): string {
    // Some ICU builds format Etc/UTC as "GMT+0" — fold that back to the bare "UTC".
    if (normalizeTimezone(zone) === 'Etc/UTC') return 'UTC';
    return tzOffset(zone);
}
