// The canonical display-timezone catalog — ONE list for every zone picker (the widget's
// bottom bar, the time-axis context menu, the renderer's settings dialog), so they can
// never drift apart. Ordered by standard UTC offset (UTC first); every whole, half and
// quarter-hour offset from UTC-12 to UTC+14 is represented. Offsets are computed live
// (DST-aware), never hardcoded in labels.

export interface TimezoneEntry {
    value: string;
    label: string;
}

export const TIMEZONES: readonly TimezoneEntry[] = [
    { value: 'Etc/UTC', label: 'UTC' },
    { value: 'Etc/GMT+12', label: 'International Date Line West' },
    { value: 'Pacific/Pago_Pago', label: 'Pago Pago' },
    { value: 'Pacific/Honolulu', label: 'Honolulu' },
    { value: 'Pacific/Marquesas', label: 'Marquesas Islands' },
    { value: 'America/Anchorage', label: 'Anchorage' },
    { value: 'America/Los_Angeles', label: 'Los Angeles' },
    { value: 'America/Phoenix', label: 'Phoenix' },
    { value: 'America/Denver', label: 'Denver' },
    { value: 'America/Chicago', label: 'Chicago' },
    { value: 'America/Mexico_City', label: 'Mexico City' },
    { value: 'America/New_York', label: 'New York' },
    { value: 'America/Bogota', label: 'Bogotá' },
    { value: 'America/Caracas', label: 'Caracas' },
    { value: 'America/Santiago', label: 'Santiago' },
    { value: 'America/St_Johns', label: "St. John's" },
    { value: 'America/Sao_Paulo', label: 'São Paulo' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
    { value: 'America/Noronha', label: 'Fernando de Noronha' },
    { value: 'Atlantic/Azores', label: 'Azores' },
    { value: 'Atlantic/Reykjavik', label: 'Reykjavik' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Europe/Berlin', label: 'Berlin' },
    { value: 'Europe/Athens', label: 'Athens' },
    { value: 'Africa/Cairo', label: 'Cairo' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg' },
    { value: 'Europe/Moscow', label: 'Moscow' },
    { value: 'Europe/Istanbul', label: 'Istanbul' },
    { value: 'Asia/Tehran', label: 'Tehran' },
    { value: 'Asia/Dubai', label: 'Dubai' },
    { value: 'Asia/Kabul', label: 'Kabul' },
    { value: 'Asia/Karachi', label: 'Karachi' },
    { value: 'Asia/Kolkata', label: 'Mumbai' },
    { value: 'Asia/Kathmandu', label: 'Kathmandu' },
    { value: 'Asia/Dhaka', label: 'Dhaka' },
    { value: 'Asia/Yangon', label: 'Yangon' },
    { value: 'Asia/Bangkok', label: 'Bangkok' },
    { value: 'Asia/Shanghai', label: 'Shanghai' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'Australia/Eucla', label: 'Eucla' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Seoul', label: 'Seoul' },
    { value: 'Australia/Adelaide', label: 'Adelaide' },
    { value: 'Australia/Sydney', label: 'Sydney' },
    { value: 'Australia/Lord_Howe', label: 'Lord Howe Island' },
    { value: 'Pacific/Noumea', label: 'Nouméa' },
    { value: 'Pacific/Auckland', label: 'Auckland' },
    { value: 'Pacific/Chatham', label: 'Chatham Islands' },
    { value: 'Pacific/Apia', label: 'Apia' },
    { value: 'Pacific/Kiritimati', label: 'Kiritimati' },
];

/** The renderer's config default is the bare `'UTC'` alias — fold it (and any other
 *  UTC spelling) onto the catalog's `'Etc/UTC'` so selection checks land on one entry. */
export function normalizeTimezone(zone: string): string {
    return zone === 'UTC' || zone === 'Etc/UTC' || zone === 'Etc/GMT' ? 'Etc/UTC' : zone;
}

/** Current UTC offset of an IANA zone as `"UTC"`, `"UTC+2"` or `"UTC-9:30"`. */
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

/** Dropdown row label — UTC omits the offset prefix. */
export function tzMenuLabel(zone: string, location: string): string {
    if (normalizeTimezone(zone) === 'Etc/UTC') return location;
    return `(${tzOffset(zone)}) ${location}`;
}

/** A zone's display location: the catalog label, else its IANA city segment. */
function tzLocation(zone: string): string {
    const entry = TIMEZONES.find((t) => t.value === normalizeTimezone(zone));
    return entry?.label ?? (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** Compact label for the bottom-bar button ("UTC", "UTC+2 Paris"). */
export function tzButtonLabel(zone: string): string {
    if (normalizeTimezone(zone) === 'Etc/UTC') return 'UTC';
    return `${tzOffset(zone)} ${tzLocation(zone)}`;
}
