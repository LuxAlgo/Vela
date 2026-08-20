// Session-zone expansion + tracker behind the pre/post-market chart shading. The bands
// are computed LOCALLY from the symbol's declared session vocabulary (`syminfo.session`,
// e.g. `0930-1600`, optional `session_extended`, e.g. `0400-2000`, both in the market's
// `timezone`) — the same timestamps the time axis already understands — so shading is
// synchronous: it paints the moment symbol info is known and follows any pan/zoom depth
// with zero network round trips. Holiday precision is deliberately NOT this feature's
// job: a non-trading day has no bars, so its (unshaded) hours collapse out of the bar
// axis anyway — the resolved calendar (`DataProvider.getCalendar`) stays the truth for
// consumers that genuinely need holidays (market-status badges, session profiles).
// Symbols with no session vocabulary (crypto `24x7`) report null — nothing shaded.
import type { DataControl } from '../core/DataControl';
import type { MarketSession } from '../core/options';
import type { VisibleRange } from '../core/ports/IChartRenderer';
import type { SymbolInfo } from '../core/ports/MarketDataFeed';
import type { CalendarWindow } from './market-status';

/** The `sessionZones` feature payload: `[start, end)` epoch-ms bands per phase. */
export interface SessionZonesUpdate {
    pre: CalendarWindow[];
    post: CalendarWindow[];
}

/** One `[start, end)` window as minutes into the market's civil day. */
interface DayWindow {
    start: number;
    end: number;
}

/** A symbol's session structure, as declared by its metadata — enough to expand
 *  pre/post bands over any time range without asking the provider anything else. */
export interface SessionSpec {
    regular: DayWindow;
    extended: DayWindow;
    timezone: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Parse an `HHMM-HHMM` vocabulary into civil-day minutes. Overnight windows
 *  (`start >= end`) don't describe a same-day pre/post split — rejected. */
function parseWindow(text: unknown): DayWindow | null {
    if (typeof text !== 'string') return null;
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(text);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]); // `2400` = end of day
    if (start >= end || end > 1440) return null;
    return { start, end };
}

/**
 * The session structure on a symbol's metadata, or null when it has none (continuous
 * markets, missing metadata). Recognized keys: `session` (regular hours, required),
 * `session_extended` (the full tape's bounds — must contain the regular window to
 * mean anything), `timezone`. Without an extended vocabulary the full civil day
 * bounds the bands; hours no bar ever occupies collapse out of the bar axis.
 */
export function parseSessionSpec(si: SymbolInfo | undefined): SessionSpec | null {
    const session = si?.['session'];
    if (typeof session !== 'string' || session === '' || session === '24x7') return null;
    const regular = parseWindow(session);
    if (!regular) return null;
    const tz = si?.['timezone'];
    const timezone = typeof tz === 'string' && tz !== '' ? tz : 'Etc/UTC';
    const ext = parseWindow(si?.['session_extended']);
    const extended = ext && ext.start <= regular.start && ext.end >= regular.end ? ext : { start: 0, end: 1440 };
    return { regular, extended, timezone };
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

/**
 * Expand a session spec into concrete pre/post bands over `[from, to]`, Mon–Fri in the
 * market's timezone. Per civil day, one offset sample at NOON anchors the minute marks:
 * DST transitions land in the small hours, so the noon offset is the day's prevailing
 * one for every session edge. Iterating in 24 h steps and de-duplicating by civil date
 * absorbs the 23/25 h transition days.
 */
export function expandSessionZones(spec: SessionSpec, from: number, to: number): SessionZonesUpdate {
    const pre: CalendarWindow[] = [];
    const post: CalendarWindow[] = [];
    const dtf = civilFormatter(spec.timezone);
    if (!dtf || !Number.isFinite(from) || !Number.isFinite(to)) return { pre, post };
    const seen = new Set<number>();
    for (let cursor = from - DAY_MS; cursor < to + DAY_MS; cursor += DAY_MS) {
        const civil = civilParts(dtf, cursor);
        const key = civil.year * 10_000 + civil.month * 100 + civil.day;
        if (!Number.isFinite(key) || seen.has(key)) continue;
        seen.add(key);
        if (civil.weekday === 'Sat' || civil.weekday === 'Sun') continue;
        // Civil midnight spelled as UTC; the noon offset turns civil minutes into epochs.
        const naive = Date.UTC(civil.year, civil.month - 1, civil.day);
        const noonGuess = naive + 720 * MINUTE_MS;
        const atNoon = civilParts(dtf, noonGuess);
        const offset = Date.UTC(atNoon.year, atNoon.month - 1, atNoon.day, atNoon.hour, atNoon.minute) - noonGuess;
        const at = (minutes: number): number => naive + minutes * MINUTE_MS - offset;
        if (spec.extended.start < spec.regular.start) pre.push([at(spec.extended.start), at(spec.regular.start)]);
        if (spec.regular.end < spec.extended.end) post.push([at(spec.regular.end), at(spec.extended.end)]);
    }
    return { pre, post };
}

/** Recompute coverage reaches this far beyond the visible span on each side, so
 *  ordinary panning keeps landing inside the last expansion. */
const COVER_PAD_MIN_MS = 2 * DAY_MS;

/**
 * Keeps ONE chart's session shading honest and INSTANT: `track` resolves the symbol's
 * session spec once (symbol metadata — memoized by providers), then every range update
 * is a synchronous local expansion. Reports:
 *  - `null` — no session structure at all (continuous market / no metadata);
 *  - empty bands — sessions exist but the REGULAR tape is shown (no pre/post bars on
 *    screen to shade);
 *  - the expanded bands — the extended tape is shown. The renderer clips them to the
 *    loaded bar slots, so nothing paints before history or ahead of the current bar.
 */
export class SessionShadingTracker {
    /** Invalidates the one async step (metadata resolution) — bumped by track()/stop(). */
    private epoch = 0;
    private spec: SessionSpec | null = null;
    private ready = false;
    private session: MarketSession = 'regular';
    private covered: VisibleRange | null = null;
    /** The newest range seen — viewport moves during metadata resolution (a load's fit
     *  animation) must not be lost, so the resolution always expands the LATEST range. */
    private lastRange: VisibleRange | null = null;

    constructor(private readonly onZones: (zones: SessionZonesUpdate | null) => void) {}

    /** (Re)bind to a chart's data surface + market and expand once metadata lands. */
    track(data: DataControl, symbol: string, opts: { session: MarketSession; range: VisibleRange }): void {
        const my = ++this.epoch;
        this.ready = false;
        this.spec = null;
        this.covered = null;
        this.session = opts.session;
        this.lastRange = opts.range;
        void data
            .symbolInfo(symbol)
            .catch(() => undefined)
            .then((si) => {
                if (my !== this.epoch) return;
                this.ready = true;
                this.spec = parseSessionSpec(si);
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
        this.covered = null;
        this.lastRange = null;
    }

    private emit(range: VisibleRange, force: boolean): void {
        if (!this.spec) {
            if (force) this.onZones(null);
            return;
        }
        if (this.session !== 'extended') {
            // Regular tape: pre/post bars aren't on screen — bands would collapse into
            // the inter-session gap. Keep the structure known but shade nothing.
            if (force) this.onZones({ pre: [], post: [] });
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
