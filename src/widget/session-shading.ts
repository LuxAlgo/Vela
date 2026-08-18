// Session-zone derivation + tracker behind the pre/post-market chart shading: turns a
// provider's RESOLVED calendar windows (`DataProvider.getCalendar`) into the pre/post
// bands the renderer's `sessionZones` feature shades. Symbols with no calendar (crypto,
// a provider without the capability) report null — no session structure, nothing shaded.
import type { DataControl } from '../core/DataControl';
import type { MarketSession } from '../core/options';
import type { CalendarWindow } from './market-status';

/** The `sessionZones` feature payload: `[start, end)` epoch-ms bands per phase. */
export interface SessionZonesUpdate {
    pre: CalendarWindow[];
    post: CalendarWindow[];
}

/**
 * The extended tape minus regular hours, split into pre/post bands: inside one extended
 * window, every gap BEFORE a regular open still ahead is pre-market (a lunch-break gap
 * counts — the day's session resumes), and the remainder after the last regular close is
 * post-market. An extended window with no regular hours at all (a data quirk) reads as
 * post — nothing opens ahead within it.
 */
export function deriveSessionZones(regular: ReadonlyArray<CalendarWindow>, extended: ReadonlyArray<CalendarWindow>): SessionZonesUpdate {
    const pre: CalendarWindow[] = [];
    const post: CalendarWindow[] = [];
    for (const [extStart, extEnd] of extended) {
        const inside = regular
            .filter(([s, e]) => e > extStart && s < extEnd)
            .sort((a, b) => a[0] - b[0]);
        let cursor = extStart;
        for (const [regStart, regEnd] of inside) {
            if (regStart > cursor) pre.push([cursor, Math.min(regStart, extEnd)]);
            cursor = Math.max(cursor, regEnd);
        }
        if (cursor < extEnd) post.push([cursor, extEnd]);
    }
    return { pre, post };
}

/** How far past `now` one evaluation fetches windows — covers the live right edge for
 *  days of an open chart (a market change re-evaluates long before this runs out). */
const FETCH_AHEAD_MS = 10 * 86_400_000;
/** Lookback clamp: at least a few days of bands, at most a calendar fetch that stays cheap. */
const MIN_LOOKBACK_MS = 3 * 86_400_000;
const MAX_LOOKBACK_MS = 120 * 86_400_000;

/**
 * Keeps ONE chart's session shading honest: resolves the symbol's provider, reads its
 * calendar when it has one (`getCalendar` + a real session vocabulary on syminfo), and
 * reports the pre/post bands over the chart's loaded span. `track` rebinds on any
 * market change; `stop` invalidates in-flight work. Reports:
 *  - `null` — no session structure at all (continuous market / no calendar);
 *  - empty bands — sessions exist but the REGULAR tape is shown (no pre/post bars on
 *    screen to shade);
 *  - the derived bands — the extended tape is shown.
 */
export class SessionShadingTracker {
    /** Invalidates detached async work — bumped by every track()/stop(). */
    private epoch = 0;

    constructor(private readonly onZones: (zones: SessionZonesUpdate | null) => void) {}

    /** (Re)bind to a chart's data surface + market and evaluate once. */
    track(data: DataControl, symbol: string, opts: { session: MarketSession; lookbackMs: number }): void {
        const my = ++this.epoch;
        void this.evaluate(my, data, symbol, opts);
    }

    stop(): void {
        this.epoch += 1;
    }

    private async evaluate(my: number, data: DataControl, symbol: string, opts: { session: MarketSession; lookbackMs: number }): Promise<void> {
        const resolved = data.resolve(symbol);
        const provider = resolved ? data.providerInstance(resolved.provider) : undefined;
        const si = await data.symbolInfo(symbol).catch(() => undefined);
        if (my !== this.epoch) return;
        const hasSessions = typeof si?.session === 'string' && si.session !== '' && si.session !== '24x7';
        if (!provider?.getCalendar || !hasSessions || !resolved) {
            this.onZones(null);
            return;
        }
        if (opts.session !== 'extended') {
            // Regular tape: pre/post bars aren't on screen — bands would collapse into
            // the inter-session gap. Keep the structure known but shade nothing.
            this.onZones({ pre: [], post: [] });
            return;
        }
        const now = Date.now();
        const lookback = Math.max(MIN_LOOKBACK_MS, Math.min(MAX_LOOKBACK_MS, opts.lookbackMs));
        const range = { from: now - lookback, to: now + FETCH_AHEAD_MS };
        const [regular, extended] = await Promise.all([
            provider.getCalendar(resolved.ticker, { ...range, session: 'regular' }).catch(() => null),
            provider.getCalendar(resolved.ticker, { ...range, session: 'extended' }).catch(() => null),
        ]);
        if (my !== this.epoch) return;
        if (!regular || !extended) return; // transient fetch failure — keep the last bands
        this.onZones(deriveSessionZones(regular, extended));
    }
}
