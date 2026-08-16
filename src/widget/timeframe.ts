// Timeframe grammar — the pure, DOM-free half of the timeframe picker ("type a number to
// change timeframe"). An optional count followed by an optional unit letter; a bare number
// is MINUTES; a lone unit letter implies a count of 1. Units are case-insensitive:
//
//   (none) → minutes    S → seconds    H → hours    D → days
//   W → weeks           M → months     Y → years
//
// e.g. "3" → 3 minutes, "30" → 30 minutes, "1h" → 1 hour, "3M" → 3 months, "S" → 1 second.

type UnitKey = 'S' | 'MIN' | 'H' | 'D' | 'W' | 'M' | 'Y';

/** Per-unit duration in ms. Month = 30 days, year = 365 days — matches the core's bucketing. */
const UNIT_MS: Record<UnitKey, number> = {
    S: 1_000,
    MIN: 60_000,
    H: 3_600_000,
    D: 86_400_000,
    W: 604_800_000,
    M: 2_592_000_000,
    Y: 31_536_000_000,
};

const UNIT_NAME: Record<UnitKey, string> = {
    S: 'second',
    MIN: 'minute',
    H: 'hour',
    D: 'day',
    W: 'week',
    M: 'month',
    Y: 'year',
};

/** The single-letter suffix used in the compact topbar label ("30m", "1D", "3M"). */
const UNIT_SHORT: Record<UnitKey, string> = { S: 's', MIN: 'm', H: 'h', D: 'D', W: 'W', M: 'M', Y: 'Y' };

function unitKey(letter: string): UnitKey | null {
    if (letter === '') return 'MIN'; // a bare number is minutes
    return letter === 'S' || letter === 'H' || letter === 'D' || letter === 'W' || letter === 'M' || letter === 'Y'
        ? (letter as UnitKey)
        : null;
}

/** Minutes per unit — how each unit collapses to the canonical bare-minute timeframe string. */
const UNIT_MINUTES: Record<Exclude<UnitKey, 'S'>, number> = {
    MIN: 1,
    H: 60,
    D: 1440,
    W: 10_080,
    M: 43_200,
    Y: 525_600,
};

/** The canonical timeframe string the chart consumes. Every unit from minutes up collapses
 *  to BARE MINUTES — the one form providers and the core read identically (`3M` would mean
 *  "3 minutes" to `timeframeToMs`, not "3 months"). Seconds pass through as `NS`. */
function canonicalFor(key: UnitKey, count: number): string {
    if (key === 'S') return `${count}S`;
    return `${count * UNIT_MINUTES[key]}`;
}

export interface ParsedTimeframe {
    valid: boolean;
    count?: number;
    unit?: string;
    ms?: number;
    /** What the chart consumes ("180" for 3h). */
    canonical?: string;
    /** Human line ("3 months"). */
    label?: string;
    /** Compact chip ("3M"). */
    short?: string;
}

/** Parse a typed timeframe string. `valid` is false for empty/garbage input (count ≥ 1). */
export function parseTimeframe(text: string): ParsedTimeframe {
    const raw = String(text ?? '').trim();
    if (!raw) return { valid: false };

    const m = /^(\d*)\s*([a-zA-Z]?)$/.exec(raw);
    if (!m) return { valid: false };

    const numStr = m[1] ?? '';
    const key = unitKey((m[2] ?? '').toUpperCase());
    if (key === null) return { valid: false };
    // A bare unit with no number means "1 of it"; a bare number needs its digits.
    if (numStr === '' && key === 'MIN') return { valid: false };

    const count = numStr === '' ? 1 : parseInt(numStr, 10);
    if (!Number.isFinite(count) || count < 1) return { valid: false };

    const ms = count * UNIT_MS[key];
    const name = UNIT_NAME[key];
    return {
        valid: true,
        count,
        unit: key,
        ms,
        canonical: canonicalFor(key, count),
        label: `${count} ${name}${count === 1 ? '' : 's'}`,
        short: `${count}${UNIT_SHORT[key]}`,
    };
}

/** Duration in ms of an existing timeframe value (`1`, `60`, `4h`, `D`, `W`, …), NaN if unknown. */
export function timeframeMs(value: string): number {
    const v = String(value ?? '').trim();
    if (!v) return NaN;
    const m = /^(\d*)\s*([a-zA-Z]?)$/.exec(v);
    if (!m) return NaN;
    const key = unitKey((m[2] ?? '').toUpperCase());
    if (key === null) return NaN;
    if ((m[1] ?? '') === '' && key === 'MIN') return NaN;
    const count = (m[1] ?? '') === '' ? 1 : parseInt(m[1]!, 10);
    if (!Number.isFinite(count) || count < 1) return NaN;
    return count * UNIT_MS[key];
}

/** Favorite chips in duration order (shortest first). First-seen wins on duplicates;
 *  values that do not parse sort last, keeping their relative order. The current
 *  timeframe is included when it is a favorite so the highlight can sit in place. */
export function favoriteTimeframeChips(favorites: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tf of favorites) {
        if (seen.has(tf)) continue;
        seen.add(tf);
        out.push(tf);
    }
    return out.sort((a, b) => {
        const ma = timeframeMs(a);
        const mb = timeframeMs(b);
        const aOk = Number.isFinite(ma);
        const bOk = Number.isFinite(mb);
        if (aOk && bOk && ma !== mb) return ma - mb;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return 0;
    });
}

/** Compact display label for any timeframe value ("60" → "1h", "D" → "1D"). */
export function timeframeLabel(value: string): string {
    const parsed = parseTimeframe(value);
    if (!parsed.valid) return value;
    // Prefer the largest unit that divides evenly (60 → 1h, 240 → 4h, 1440 → 1D).
    const ms = parsed.ms!;
    const order: UnitKey[] = ['Y', 'M', 'W', 'D', 'H', 'MIN', 'S'];
    for (const key of order) {
        if (ms % UNIT_MS[key] === 0 && ms / UNIT_MS[key] >= 1) {
            return `${ms / UNIT_MS[key]}${UNIT_SHORT[key]}`;
        }
    }
    return parsed.short!;
}
