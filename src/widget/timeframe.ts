// Timeframe grammar — the pure, DOM-free half of the timeframe picker ("type a number to
// change timeframe"). An optional count followed by an optional unit letter; a bare number
// is MINUTES; a lone unit letter implies a count of 1. Units are case-insensitive:
//
//   (none) → minutes    T → ticks      S → seconds    H → hours
//   D → days            W → weeks      M → months     Y → years
//
// e.g. "3" → 3 minutes, "100T" → 100 ticks, "1h" → 1 hour, "3M" → 3 months, "S" → 1 second.

import { msg } from '../core/i18n/message';
import { localizeNumberText, textOf } from '../core/i18n/text';
import type { MessageDescriptor, Translator } from '../core/i18n/types';

type TimeUnitKey = 'S' | 'MIN' | 'H' | 'D' | 'W' | 'M' | 'Y';
type UnitKey = 'T' | TimeUnitKey;

/** Per-unit duration in ms. Month = 30 days, year = 365 days — matches the core's bucketing. */
const UNIT_MS: Record<TimeUnitKey, number> = {
    S: 1_000,
    MIN: 60_000,
    H: 3_600_000,
    D: 86_400_000,
    W: 604_800_000,
    M: 2_592_000_000,
    Y: 31_536_000_000,
};

/** A count of each unit in words ("3 months"); `count` picks the plural form, `n` is the
 *  count as shown. */
const UNIT_NAME: Record<UnitKey, MessageDescriptor> = {
    T: msg('widget.timeframe.ticks', '{count, plural, one {{n} tick} other {{n} ticks}}'),
    S: msg('widget.timeframe.seconds', '{count, plural, one {{n} second} other {{n} seconds}}'),
    MIN: msg('widget.timeframe.minutes', '{count, plural, one {{n} minute} other {{n} minutes}}'),
    H: msg('widget.timeframe.hours', '{count, plural, one {{n} hour} other {{n} hours}}'),
    D: msg('widget.timeframe.days', '{count, plural, one {{n} day} other {{n} days}}'),
    W: msg('widget.timeframe.weeks', '{count, plural, one {{n} week} other {{n} weeks}}'),
    M: msg('widget.timeframe.months', '{count, plural, one {{n} month} other {{n} months}}'),
    Y: msg('widget.timeframe.years', '{count, plural, one {{n} year} other {{n} years}}'),
};

/** The compact topbar label ("100T", "30m", "1D", "3M"): a count and the unit's letter. */
const UNIT_SHORT: Record<UnitKey, MessageDescriptor> = {
    T: msg('widget.timeframe.short.ticks', '{n}T'),
    S: msg('widget.timeframe.short.seconds', '{n}s'),
    MIN: msg('widget.timeframe.short.minutes', '{n}m'),
    H: msg('widget.timeframe.short.hours', '{n}h'),
    D: msg('widget.timeframe.short.days', '{n}D'),
    W: msg('widget.timeframe.short.weeks', '{n}W'),
    M: msg('widget.timeframe.short.months', '{n}M'),
    Y: msg('widget.timeframe.short.years', '{n}Y'),
};

/** The compact label of `count` units in `i18n`'s language. */
function shortLabel(key: UnitKey, count: number, i18n: Translator | null | undefined): string {
    return textOf(i18n, UNIT_SHORT[key], { n: localizeNumberText(String(count), i18n) });
}

function unitKey(letter: string): UnitKey | null {
    if (letter === '') return 'MIN'; // a bare number is minutes
    return letter === 'T' || letter === 'S' || letter === 'H' || letter === 'D' || letter === 'W' || letter === 'M' || letter === 'Y'
        ? (letter as UnitKey)
        : null;
}

/** Minutes per unit — how each unit collapses to the canonical bare-minute timeframe string. */
const UNIT_MINUTES: Record<Exclude<TimeUnitKey, 'S'>, number> = {
    MIN: 1,
    H: 60,
    D: 1440,
    W: 10_080,
    M: 43_200,
    Y: 525_600,
};

/** The canonical timeframe string the chart consumes. Every unit from minutes up collapses
 *  to BARE MINUTES — the one form providers and the core read identically (a provider's
 *  interval table knows `M`, not every `NM` count). Seconds pass through as `NS`, ticks as `NT`. */
function canonicalFor(key: UnitKey, count: number): string {
    if (key === 'T') return `${count}T`;
    if (key === 'S') return `${count}S`;
    return `${count * UNIT_MINUTES[key]}`;
}

export interface ParsedTimeframe {
    valid: boolean;
    count?: number;
    unit?: string;
    ms?: number;
    /** What the chart consumes ("180" for 3h, "100T" for 100 ticks). */
    canonical?: string;
    /** Human line ("3 months", "100 ticks"). */
    label?: string;
    /** Compact chip ("3M", "100T"). */
    short?: string;
}

/** Parse a typed timeframe string. `valid` is false for empty/garbage input (count ≥ 1).
 *  The labels read in `i18n`'s language (English without one). */
export function parseTimeframe(text: string, i18n?: Translator | null): ParsedTimeframe {
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

    const ms = key === 'T' ? undefined : count * UNIT_MS[key];
    return {
        valid: true,
        count,
        unit: key,
        ...(ms !== undefined ? { ms } : {}),
        canonical: canonicalFor(key, count),
        label: textOf(i18n, UNIT_NAME[key], { count, n: localizeNumberText(String(count), i18n) }),
        short: shortLabel(key, count, i18n),
    };
}

/**
 * A data source's timeframe (`'1D'`, `'W'`, `'1M'`, `'3M'`, `'12M'`, `'240'`, `'30S'`, `'100T'`)
 * in the form the chart consumes: `D`, `W` or `M` for one day, week or month — the default
 * presets' own values — `NT`/`NS` for ticks and seconds, and canonical bare minutes for any
 * other count (`'3M'` → `'129600'`). Unit letters read as sources write them, upper-case:
 * `M` is a month. Null when unparsed.
 */
export function chartTimeframeOf(value: string | undefined): string | null {
    if (value === undefined) return null;
    const parsed = parseTimeframe(value);
    if (!parsed.valid) return null;
    if (parsed.count === 1 && (parsed.unit === 'D' || parsed.unit === 'W' || parsed.unit === 'M')) return parsed.unit;
    return parsed.canonical ?? null;
}

/** Duration in ms of an existing timeframe value (`1`, `60`, `4h`, `D`, `W`, …), NaN if unknown
 *  or variable-duration (`100T`). */
export function timeframeMs(value: string): number {
    const v = String(value ?? '').trim();
    if (!v) return NaN;
    const m = /^(\d*)\s*([a-zA-Z]?)$/.exec(v);
    if (!m) return NaN;
    const key = unitKey((m[2] ?? '').toUpperCase());
    if (key === null || key === 'T') return NaN;
    if ((m[1] ?? '') === '' && key === 'MIN') return NaN;
    const count = (m[1] ?? '') === '' ? 1 : parseInt(m[1]!, 10);
    if (!Number.isFinite(count) || count < 1) return NaN;
    return count * UNIT_MS[key];
}

/** Sort key for ordering timeframe chips: tick timeframes first (by tick count), then
 *  fixed-duration timeframes (by ms), then unparsed entries last. */
function chipRank(tf: string): [number, number] {
    const parsed = parseTimeframe(tf);
    if (!parsed.valid) return [2, 0];
    if (parsed.unit === 'T') return [0, parsed.count ?? 0];
    return [1, parsed.ms ?? 0];
}

/** Favorite chips in ascending resolution order (ticks first, then shortest duration).
 *  First-seen wins on duplicates; values that do not parse sort last, keeping their
 *  relative order. The current timeframe is included when it is a favorite so the
 *  highlight can sit in place. */
export function favoriteTimeframeChips(favorites: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tf of favorites) {
        if (seen.has(tf)) continue;
        seen.add(tf);
        out.push(tf);
    }
    return out.sort((a, b) => {
        const [ga, va] = chipRank(a);
        const [gb, vb] = chipRank(b);
        if (ga !== gb) return ga - gb;
        if (va !== vb) return va - vb;
        return 0;
    });
}

/** Compact display label for any timeframe value ("60" → "1h", "D" → "1D", "100T" → "100T"),
 *  in `i18n`'s language (English without one). */
export function timeframeLabel(value: string, i18n?: Translator | null): string {
    const parsed = parseTimeframe(value, i18n);
    if (!parsed.valid) return value;
    if (parsed.unit === 'T') return parsed.short!;
    // Prefer the largest unit that divides evenly (60 → 1h, 240 → 4h, 1440 → 1D).
    const ms = parsed.ms!;
    const order: TimeUnitKey[] = ['Y', 'M', 'W', 'D', 'H', 'MIN', 'S'];
    for (const key of order) {
        if (ms % UNIT_MS[key] === 0 && ms / UNIT_MS[key] >= 1) {
            return shortLabel(key, ms / UNIT_MS[key], i18n);
        }
    }
    return parsed.short!;
}
