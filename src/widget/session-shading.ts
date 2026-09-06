// Session-zone expansion + tracker behind the session chart shading (pre/post-market on
// day-split tapes, one extended-hours phase on overnight roll tapes). The bands are
// computed LOCALLY from the symbol's declared session vocabulary (`syminfo.session`,
// e.g. `0930-1600`, optional `session_extended`, e.g. `0400-2000` or overnight
// `1700-1600`, both in the market's `timezone`) — the same timestamps the time axis
// already understands — so shading is
// synchronous: it paints the moment symbol info is known and follows any pan/zoom depth
// with zero network round trips. Holiday precision is deliberately NOT this feature's
// job: a non-trading day has no bars, so its (unshaded) hours collapse out of the bar
// axis anyway — the resolved calendar (`DataProvider.getCalendar`) stays the truth for
// consumers that genuinely need holidays (market-status badges, session profiles).
// Symbols with no session vocabulary (crypto `24x7`) report null — nothing shaded.
import type { DataControl } from '../core/DataControl';
import type { MarketSession, MarketSessionDefinition } from '../core/options';
import type { VisibleRange } from '../core/ports/IChartRenderer';
import type { SymbolInfo } from '../core/ports/MarketDataFeed';
import type { CalendarWindow } from './market-status';
import { timeframeMs } from './timeframe';

/** The `sessionZones` feature payload: `[start, end)` epoch-ms bands per phase.
 *  Day-split tapes populate `pre`/`post`; overnight roll tapes (the extended window
 *  wraps midnight) have no same-day split and populate the single `extended` phase
 *  instead. */
export interface SessionZonesUpdate {
    pre: CalendarWindow[];
    post: CalendarWindow[];
    extended: CalendarWindow[];
    /** Host-declared session windows carry their own color. Metadata-derived sessions
     * keep using the legacy phase buckets above and renderer-configured colors. */
    bands?: Array<{ from: number; to: number; color: string }>;
}

/** One `[start, end)` window as minutes into the market's civil day. */
interface DayWindow {
    start: number;
    end: number;
}

/** A symbol's session structure, as declared by its metadata — enough to expand
 *  session bands over any time range without asking the provider anything else. */
export interface SessionSpec {
    regular: DayWindow;
    /** With `overnight`, `end < start`: the tape wraps midnight (evening → next day). */
    extended: DayWindow;
    /** Roll markets (`1700-1600`): one continuous extended phase, no same-day pre/post
     *  split exists. */
    overnight: boolean;
    timezone: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Parse an `HHMM-HHMM` vocabulary into civil-day minutes. Overnight windows
 *  (`start >= end` — a tape that wraps midnight) only make sense for the extended
 *  spelling on roll markets; callers opt in via `allowOvernight`. */
function parseWindow(text: unknown, allowOvernight = false): DayWindow | null {
    if (typeof text !== 'string') return null;
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(text);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]); // `2400` = end of day
    if (end > 1440 || start >= 1440) return null;
    if (start >= end && !allowOvernight) return null;
    return { start, end };
}

/**
 * The session structure on a symbol's metadata, or null when it has none (continuous
 * markets, missing metadata). Recognized keys: `session` (regular hours, required),
 * `session_extended` (the full tape's bounds — must contain the regular window to
 * mean anything), `timezone`. An OVERNIGHT extended spelling (`1700-1600` — roll
 * markets, the trading day runs evening-to-evening) marks the spec `overnight`:
 * one continuous extended phase instead of a pre/post split. Without an extended
 * vocabulary the full civil day bounds the bands; hours no bar ever occupies collapse
 * out of the bar axis.
 */
export function parseSessionSpec(si: SymbolInfo | undefined): SessionSpec | null {
    const session = si?.['session'];
    if (typeof session !== 'string' || session === '' || session === '24x7') return null;
    const regular = parseWindow(session);
    if (!regular) return null;
    const tz = si?.['timezone'];
    const timezone = typeof tz === 'string' && tz !== '' ? tz : 'Etc/UTC';
    const ext = parseWindow(si?.['session_extended'], true);
    if (ext && ext.start >= ext.end) {
        // Overnight tape: valid when the evening opens after the regular close and the
        // same-day tail reaches at least that close — the regular window then sits
        // wholly inside the wrapped span.
        if (ext.start >= regular.end && ext.end >= regular.end) return { regular, extended: ext, overnight: true, timezone };
        return { regular, extended: { start: 0, end: 1440 }, overnight: false, timezone };
    }
    const extended = ext && ext.start <= regular.start && ext.end >= regular.end ? ext : { start: 0, end: 1440 };
    return { regular, extended, overnight: false, timezone };
}

const dtfCache = new Map<string, Intl.DateTimeFormat | null>();

/** Cached civil-time formatter for `tz` (constructing one is the expensive part);
 *  null when the timezone name is bogus — no shading beats wrong shading. */
function civilFormatter(tz: string): Intl.DateTimeFormat | null {
    const cached = dtfCache.get(tz);
    if (cached !== undefined) return cached;
    let dtf: Intl.DateTimeFormat | null = null;
    try {
        dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        dtf = null;
    }
    dtfCache.set(tz, dtf);
    return dtf;
}

interface CivilParts {
    weekday: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function civilParts(dtf: Intl.DateTimeFormat, ms: number): CivilParts {
    const parts = dtf.formatToParts(ms);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    return {
        weekday: get('weekday'),
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')) % 24,
        minute: Number(get('minute')),
    };
}

/** Sort + join touching/overlapping bands (the evening head and the next civil day's
 *  continuation meet at midnight) so an overnight session paints as one seamless wash. */
function mergeAbutting(bands: CalendarWindow[]): CalendarWindow[] {
    const sorted = [...bands].sort((a, b) => a[0] - b[0]);
    const out: Array<[number, number]> = [];
    for (const [s, e] of sorted) {
        if (e <= s) continue;
        const last = out[out.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
}

/**
 * Expand a session spec into concrete session bands over `[from, to]` in the market's
 * timezone. Day-split tapes emit pre/post per weekday; overnight roll tapes emit the
 * single `extended` phase — Sun–Thu evening heads (Friday has none), each trading day's
 * continuation up to the regular open, and the post-close tail — merged across midnight
 * into seamless bands. Per civil day, one offset sample at NOON anchors the minute
 * marks: DST transitions land in the small hours, so the noon offset is the day's
 * prevailing one for every session edge. Iterating in 24 h steps and de-duplicating by
 * civil date absorbs the 23/25 h transition days.
 */
export function expandSessionZones(spec: SessionSpec, from: number, to: number): SessionZonesUpdate {
    const pre: CalendarWindow[] = [];
    const post: CalendarWindow[] = [];
    const extended: CalendarWindow[] = [];
    const dtf = civilFormatter(spec.timezone);
    if (!dtf || !Number.isFinite(from) || !Number.isFinite(to)) return { pre, post, extended };
    const seen = new Set<number>();
    for (let cursor = from - DAY_MS; cursor < to + DAY_MS; cursor += DAY_MS) {
        const civil = civilParts(dtf, cursor);
        const key = civil.year * 10_000 + civil.month * 100 + civil.day;
        if (!Number.isFinite(key) || seen.has(key)) continue;
        seen.add(key);
        const sunday = civil.weekday === 'Sun';
        if (civil.weekday === 'Sat' || (sunday && !spec.overnight)) continue;
        // Civil midnight spelled as UTC; the noon offset turns civil minutes into epochs.
        const naive = Date.UTC(civil.year, civil.month - 1, civil.day);
        const noonGuess = naive + 720 * MINUTE_MS;
        const atNoon = civilParts(dtf, noonGuess);
        const offset = Date.UTC(atNoon.year, atNoon.month - 1, atNoon.day, atNoon.hour, atNoon.minute) - noonGuess;
        const at = (minutes: number): number => naive + minutes * MINUTE_MS - offset;
        if (spec.overnight) {
            if (!sunday) {
                extended.push([at(0), at(spec.regular.start)]);
                if (spec.regular.end < spec.extended.end) extended.push([at(spec.regular.end), at(spec.extended.end)]);
            }
            if (civil.weekday !== 'Fri') extended.push([at(spec.extended.start), at(1440)]);
            continue;
        }
        if (spec.extended.start < spec.regular.start) pre.push([at(spec.extended.start), at(spec.regular.start)]);
        if (spec.regular.end < spec.extended.end) post.push([at(spec.regular.end), at(spec.extended.end)]);
    }
    return { pre, post, extended: mergeAbutting(extended) };
}

/** Convert a civil date plus an arbitrary minute offset to epoch time in `dtf`'s zone.
 * Re-resolving the offset at the candidate instant keeps edges on both sides of a DST
 * transition accurate instead of applying one daily offset to the whole window. */
function atCivilMinute(dtf: Intl.DateTimeFormat, year: number, month: number, day: number, minute: number): number {
    const shifted = new Date(Date.UTC(year, month - 1, day) + minute * MINUTE_MS);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
    const naive = Date.UTC(y, m - 1, d);
    const wall = naive + minuteOfDay * MINUTE_MS;
    let candidate = wall;
    for (let i = 0; i < 3; i += 1) {
        const atCandidate = civilParts(dtf, candidate);
        const rendered = Date.UTC(
            atCandidate.year,
            atCandidate.month - 1,
            atCandidate.day,
            atCandidate.hour,
            atCandidate.minute,
        );
        const next = wall - (rendered - candidate);
        if (next === candidate) break;
        candidate = next;
    }
    return candidate;
}

/** Expand one explicit definition into colored market-time bands. Windows recur every
 * civil day; the renderer's bar-slot clipping naturally removes closed-market days.
 * An overnight window belongs to the civil day on which it ends (`1700-1600` Monday
 * starts Sunday evening). */
export function expandSessionDefinition(
    definition: MarketSessionDefinition,
    timezone: string,
    from: number,
    to: number,
): Array<{ from: number; to: number; color: string }> {
    const dtf = civilFormatter(timezone);
    if (!dtf || !Number.isFinite(from) || !Number.isFinite(to)) return [];
    const parsed: DayWindow[] = [];
    for (const window of definition.windows) {
        const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(window);
        if (!m) return [];
        const sh = Number(m[1]);
        const sm = Number(m[2]);
        const eh = Number(m[3]);
        const em = Number(m[4]);
        if (sh > 23 || sm > 59 || eh > 24 || em > 59 || (eh === 24 && em !== 0) || (sh === eh && sm === em)) return [];
        parsed.push({ start: sh * 60 + sm, end: eh * 60 + em });
    }
    const bands: CalendarWindow[] = [];
    const seen = new Set<number>();
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let cursor = lo - 2 * DAY_MS; cursor < hi + 2 * DAY_MS; cursor += DAY_MS) {
        const civil = civilParts(dtf, cursor);
        const key = civil.year * 10_000 + civil.month * 100 + civil.day;
        if (!Number.isFinite(key) || seen.has(key)) continue;
        seen.add(key);
        for (const window of parsed) {
            const overnight = window.start > window.end;
            const start = atCivilMinute(dtf, civil.year, civil.month, civil.day, overnight ? window.start - 1440 : window.start);
            const end = atCivilMinute(dtf, civil.year, civil.month, civil.day, window.end);
            if (end > start && end > lo && start < hi) bands.push([start, end]);
        }
    }
    return mergeAbutting(bands).map(([start, end]) => ({ from: start, to: end, color: definition.color }));
}

/** Recompute coverage reaches this far beyond the visible span on each side, so
 *  ordinary panning keeps landing inside the last expansion. */
const COVER_PAD_MIN_MS = 2 * DAY_MS;

/**
 * Keeps ONE chart's session shading honest and INSTANT: `track` resolves the symbol's
 * session spec once (symbol metadata — memoized by providers), then every range update
 * is a synchronous local expansion. Reports:
 *  - `null` — no session structure at all (continuous market / no metadata);
 *  - empty bands — sessions exist but there are no pre/post bar slots to shade: the
 *    REGULAR tape is shown, or the timeframe is daily+ (each bar aggregates whole
 *    sessions, so a band would just tint full-day candles);
 *  - the expanded bands — the extended tape is shown. The renderer clips them to the
 *    loaded bar slots, so nothing paints before history or ahead of the current bar.
 */
export class SessionShadingTracker {
    /** Invalidates the one async step (metadata resolution) — bumped by track()/stop(). */
    private epoch = 0;
    private spec: SessionSpec | null = null;
    /** `undefined` means metadata mode; null is an authoritative empty explicit list. */
    private definition: MarketSessionDefinition | null | undefined;
    private sessionTimezone = 'Etc/UTC';
    private ready = false;
    private session: MarketSession = 'regular';
    /** Whether one bar is shorter than a civil day — only then do pre/post bars exist. */
    private intraday = false;
    private covered: VisibleRange | null = null;
    /** The newest range seen — viewport moves during metadata resolution (a load's fit
     *  animation) must not be lost, so the resolution always expands the LATEST range. */
    private lastRange: VisibleRange | null = null;

    constructor(private readonly onZones: (zones: SessionZonesUpdate | null) => void) {}

    /** (Re)bind to a chart's data surface + market and expand once metadata lands. */
    track(
        data: DataControl,
        symbol: string,
        opts: {
            session: MarketSession;
            timeframe: string;
            range: VisibleRange;
            definitions?: readonly MarketSessionDefinition[];
            sessionTimezone?: string;
        },
    ): void {
        const my = ++this.epoch;
        this.ready = false;
        this.spec = null;
        this.covered = null;
        this.sessionTimezone = 'Etc/UTC';
        this.session = opts.session;
        this.definition = opts.definitions === undefined ? undefined : (opts.definitions.find((definition) => definition.id === opts.session) ?? null);
        const tfMs = timeframeMs(opts.timeframe);
        this.intraday = Number.isFinite(tfMs) && tfMs < DAY_MS;
        this.lastRange = opts.range;
        const explicitTimezone = typeof opts.sessionTimezone === 'string' && opts.sessionTimezone.trim() !== '' ? opts.sessionTimezone.trim() : undefined;
        // An empty catalog is immediately authoritative. Likewise, an explicit
        // timezone makes a selected definition independent from symbol metadata.
        if (this.definition === null || (this.definition && explicitTimezone !== undefined)) {
            this.ready = true;
            this.sessionTimezone = explicitTimezone ?? 'Etc/UTC';
            this.emit(opts.range, true);
            return;
        }
        void data
            .symbolInfo(symbol)
            .catch(() => undefined)
            .then((si) => {
                if (my !== this.epoch) return;
                this.ready = true;
                if (opts.definitions === undefined) {
                    this.spec = parseSessionSpec(si);
                } else {
                    this.spec = null;
                    const metadataTimezone = typeof si?.timezone === 'string' && si.timezone !== '' ? si.timezone : undefined;
                    this.sessionTimezone = metadataTimezone || 'Etc/UTC';
                }
                this.emit(this.lastRange ?? opts.range, true);
            });
    }

    /** Follow a pan/zoom synchronously: bands are epoch-anchored, so only a range that
     *  leaves the last expansion's coverage needs a recompute — no fetch, no debounce. */
    updateRange(range: VisibleRange): void {
        this.lastRange = range;
        if (!this.ready) return;
        this.emit(range, false);
    }

    stop(): void {
        this.epoch += 1;
        this.ready = false;
        this.spec = null;
        this.definition = undefined;
        this.covered = null;
        this.lastRange = null;
    }

    private emit(range: VisibleRange, force: boolean): void {
        if (this.definition !== undefined) {
            if (!this.definition) {
                if (force) this.onZones(null);
                return;
            }
            if (!this.intraday) {
                if (force) this.onZones({ pre: [], post: [], extended: [], bands: [] });
                return;
            }
            const from = Math.min(range.from, range.to);
            const to = Math.max(range.from, range.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) return;
            if (!force && this.covered && from >= this.covered.from && to <= this.covered.to) return;
            const pad = Math.max(to - from, COVER_PAD_MIN_MS);
            const covered = { from: from - pad, to: to + pad };
            this.covered = covered;
            this.onZones({
                pre: [],
                post: [],
                extended: [],
                bands: expandSessionDefinition(this.definition, this.sessionTimezone, covered.from, covered.to),
            });
            return;
        }
        if (!this.spec) {
            if (force) this.onZones(null);
            return;
        }
        if (this.session !== 'extended' || !this.intraday) {
            // No extended-hours bars on screen: the regular tape collapses those hours
            // out of the bar axis, and a daily+ bar aggregates its whole day — either way
            // a band would land on the wrong pixels. Keep the structure known, shade nothing.
            if (force) this.onZones({ pre: [], post: [], extended: [] });
            return;
        }
        const from = Math.min(range.from, range.to);
        const to = Math.max(range.from, range.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        if (!force && this.covered && from >= this.covered.from && to <= this.covered.to) return;
        const pad = Math.max(to - from, COVER_PAD_MIN_MS);
        const covered = { from: from - pad, to: to + pad };
        this.covered = covered;
        this.onZones(expandSessionZones(this.spec, covered.from, covered.to));
    }
}
