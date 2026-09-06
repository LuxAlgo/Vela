// Market-status derivation + tracker behind the statusline's session badge: turns a
// provider's RESOLVED calendar windows (`DataProvider.getCalendar` — holidays and DST
// already applied by the source) into the badge vocabulary and keeps it current across
// session boundaries with a self-arming timer. Symbols with no calendar (crypto, a
// provider without the capability) keep the constructor's permanent 'open' — exactly
// the pre-calendar behavior.
import type { DataControl } from '../core/DataControl';
import type { MarketSession } from '../core/options';
import type { MarketStatus } from './statusline';
import { parseSessionSpec } from './session-shading';

/** One `[start, end)` open window, epoch ms — the `getCalendar` wire shape. */
export type CalendarWindow = readonly [number, number];

/** The two window sets a status derivation reads: RTH and the full tape. */
export interface MarketWindows {
    regular: ReadonlyArray<CalendarWindow>;
    extended: ReadonlyArray<CalendarWindow>;
}

/** The civil date (`YYYY-MM-DD`) of `ms` in `tz`; empty string when the tz is bogus. */
function civilDate(ms: number, tz: string): string {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms);
    } catch {
        return '';
    }
}

/** Mon–Fri in `tz`? A bogus tz answers false (never claim a holiday on bad data). */
function isWeekday(ms: number, tz: string): boolean {
    try {
        const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(ms);
        return wd !== 'Sat' && wd !== 'Sun';
    } catch {
        return false;
    }
}

/**
 * The market status at `now` given resolved windows:
 *  - inside a regular window → `open`;
 *  - inside the extended tape but outside regular hours → `extended` on overnight roll
 *    tapes (no same-day pre/post split exists); otherwise `pre` when the
 *    day's regular open still lies ahead within the SAME extended window, `post`
 *    otherwise;
 *  - otherwise closed — spelled `holiday` when a WEEKDAY (market tz) carries no
 *    extended window at all (a skipped trading day), plain `closed` for nights and
 *    weekends. A window "belongs" to the civil day its start falls on.
 */
export function deriveMarketStatus(now: number, w: MarketWindows, tz: string, overnight = false): MarketStatus {
    const within = (ws: ReadonlyArray<CalendarWindow>): CalendarWindow | undefined => ws.find(([s, e]) => now >= s && now < e);
    if (within(w.regular)) return 'open';
    const ext = within(w.extended);
    if (ext) {
        if (overnight) return 'extended';
        return w.regular.some(([s]) => s >= now && s < ext[1]) ? 'pre' : 'post';
    }
    if (isWeekday(now, tz)) {
        const today = civilDate(now, tz);
        if (today !== '' && !w.extended.some(([s]) => civilDate(s, tz) === today)) return 'holiday';
    }
    return 'closed';
}

/** The next window edge (either set) strictly after `now`, or null when none is known. */
export function nextStatusBoundary(now: number, w: MarketWindows): number | null {
    let next: number | null = null;
    for (const ws of [w.regular, w.extended]) {
        for (const [s, e] of ws) {
            for (const t of [s, e]) {
                if (t > now && (next == null || t < next)) next = t;
            }
        }
    }
    return next;
}

/** How far around `now` one evaluation fetches windows — enough for the longest
 *  holiday cluster behind and a re-arm horizon ahead. */
const FETCH_BACK_MS = 4 * 86_400_000;
const FETCH_AHEAD_MS = 10 * 86_400_000;
/** Timer clamp: at least 15 s (boundary jitter), at most an hour — the hourly
 *  re-evaluation also rolls the civil day for the holiday verdict. */
const MIN_TIMER_MS = 15_000;
const MAX_TIMER_MS = 3_600_000;
/** Retry cadence when the calendar fetch fails (the badge keeps its last state). */
const RETRY_MS = 60_000;

/**
 * Keeps ONE statusline's market badge honest: resolves the symbol's provider, reads its
 * calendar when it has one (`getCalendar` + a real session vocabulary on syminfo),
 * derives the status, and re-derives at every window boundary. `track` rebinds on any
 * symbol/chart change; `stop` ends the timers. Symbols without a calendar report a
 * permanent `'open'` — continuous markets, and the exact legacy posture.
 */
export class MarketStatusTracker {
    /** Invalidates detached async work — bumped by every track()/stop(). */
    private epoch = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly onStatus: (status: MarketStatus) => void) {}

    /** (Re)bind to a chart's data surface + symbol and start evaluating. */
    track(
        data: DataControl,
        symbol: string,
        options: { explicit?: boolean; session?: MarketSession; sessionTimezone?: string } = {},
    ): void {
        const my = ++this.epoch;
        this.clearTimer();
        void this.evaluate(my, data, symbol, options);
    }

    stop(): void {
        this.epoch += 1;
        this.clearTimer();
    }

    private async evaluate(
        my: number,
        data: DataControl,
        symbol: string,
        options: { explicit?: boolean; session?: MarketSession; sessionTimezone?: string },
    ): Promise<void> {
        const resolved = data.resolve(symbol);
        const provider = resolved ? data.providerInstance(resolved.provider) : undefined;
        const si = await data.symbolInfo(symbol).catch(() => undefined);
        if (my !== this.epoch) return;
        if (options.explicit) {
            if (!provider?.getCalendar || !resolved || !options.session) {
                this.onStatus('open');
                return;
            }
            const now = Date.now();
            const range = { from: now - FETCH_BACK_MS, to: now + FETCH_AHEAD_MS, session: options.session };
            const windows = await provider.getCalendar(resolved.ticker, range).catch(() => null);
            if (my !== this.epoch) return;
            if (!windows) {
                this.arm(my, data, symbol, options, RETRY_MS);
                return;
            }
            this.onStatus(windows.some(([start, end]) => now >= start && now < end) ? 'open' : 'closed');
            const boundary = windows.flatMap(([start, end]) => [start, end]).filter((edge) => edge > now).sort((a, b) => a - b)[0];
            const delay = Math.min(boundary != null ? boundary - now : MAX_TIMER_MS, MAX_TIMER_MS);
            this.arm(my, data, symbol, options, Math.max(delay, MIN_TIMER_MS));
            return;
        }
        const hasSessions = typeof si?.session === 'string' && si.session !== '' && si.session !== '24x7';
        if (!provider?.getCalendar || !hasSessions || !resolved) {
            this.onStatus('open'); // continuous market / no calendar — the legacy badge
            return;
        }
        const tz = typeof si?.timezone === 'string' && si.timezone !== '' ? si.timezone : 'Etc/UTC';
        const now = Date.now();
        const range = { from: now - FETCH_BACK_MS, to: now + FETCH_AHEAD_MS };
        const [regular, extended] = await Promise.all([
            provider.getCalendar(resolved.ticker, { ...range, session: 'regular' }).catch(() => null),
            provider.getCalendar(resolved.ticker, { ...range, session: 'extended' }).catch(() => null),
        ]);
        if (my !== this.epoch) return;
        if (!regular || !extended) {
            // Transient fetch failure: keep the badge as it stands and retry.
            this.arm(my, data, symbol, options, RETRY_MS);
            return;
        }
        const w: MarketWindows = { regular, extended };
        // Roll tapes (overnight `session_extended`) badge the single extended-hours
        // state — pre/post is a day-split vocabulary they don't have.
        const overnight = parseSessionSpec(si)?.overnight === true;
        this.onStatus(deriveMarketStatus(now, w, tz, overnight));
        const boundary = nextStatusBoundary(now, w);
        const delay = Math.min(boundary != null ? boundary - now : MAX_TIMER_MS, MAX_TIMER_MS);
        this.arm(my, data, symbol, options, Math.max(delay, MIN_TIMER_MS));
    }

    private arm(
        my: number,
        data: DataControl,
        symbol: string,
        options: { explicit?: boolean; session?: MarketSession; sessionTimezone?: string },
        delay: number,
    ): void {
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            if (my !== this.epoch) return;
            void this.evaluate(my, data, symbol, options);
        }, delay);
    }

    private clearTimer(): void {
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = null;
    }
}
