// Shared timezone list + labels for the bottom-bar picker (and future axis menus).

export interface TimezoneEntry {
    value: string;
    label: string;
}

export const TIMEZONES: readonly TimezoneEntry[] = [
    { value: 'Etc/UTC', label: 'UTC' },
    { value: 'America/New_York', label: 'New York' },
    { value: 'America/Chicago', label: 'Chicago' },
    { value: 'America/Los_Angeles', label: 'Los Angeles' },
    { value: 'America/Sao_Paulo', label: 'São Paulo' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Europe/Moscow', label: 'Moscow' },
    { value: 'Asia/Dubai', label: 'Dubai' },
    { value: 'Asia/Kolkata', label: 'Mumbai' },
    { value: 'Asia/Shanghai', label: 'Shanghai' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Australia/Sydney', label: 'Sydney' },
];

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
    if (zone === 'Etc/UTC') return location;
    return `(${tzOffset(zone)}) ${location}`;
}

/** Compact label for the bottom-bar button ("UTC", "UTC+2 Paris"). */
export function tzButtonLabel(zone: string): string {
    const entry = TIMEZONES.find((t) => t.value === zone);
    if (!entry || zone === 'Etc/UTC') return 'UTC';
    return `${tzOffset(zone)} ${entry.label}`;
}
