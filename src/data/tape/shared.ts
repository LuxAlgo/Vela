// Refcounted sharing of a TapeSource. Delta, cumulative delta and the footprint style are
// three READS of the same tape; each opening its own history walk and live subscription
// would multiply the venue's rate budget by the number of views on screen and still show
// the same numbers. Sources are keyed per CHART — the key includes the chart's own data
// control — so two charts never share a book built against a different bar array.
import type { OHLCV } from '../../core/model/ohlcv';
import { TapeSource, type TapeAccess } from './TapeSource';

/** What a view asks for when it leases a tape. */
export interface SharedTapeOptions {
    symbol: string;
    timeframe: string;
    /** The chart's bars — read fresh on every fold. */
    bars: () => readonly OHLCV[];
    /** Whether the chart streams live (a live chart never back-fills its forming bar). */
    live?: boolean;
    /**
     * The level size this view needs. Omit it when the view reads only per-bar totals
     * (delta, cumulative delta) — those are the same at any level size, so an omitted
     * value never forces the shared book to rebuild for a view that cannot tell.
     */
    levelSize?: number;
}

/** A held lease. Release it exactly once; the source dies with the last lease. */
export interface TapeLease {
    source: TapeSource;
    release(): void;
}

/**
 * Level size a shared book is built at when its first holder expresses no preference.
 * A view that later needs finer levels sets its own, which rebuilds once (see
 * `TapeSource.setLevelSize`) — paid at most once, when the first level-reading view opens.
 */
const DEFAULT_LEVEL_SIZE = 1;

interface Entry {
    source: TapeSource;
    leases: number;
}

/** Per-chart tables, dropped with the chart's data control. */
const byAccess = new WeakMap<TapeAccess, Map<string, Entry>>();

function keyOf(opts: SharedTapeOptions): string {
    return `${opts.symbol}|${opts.timeframe}|${opts.live ? 'live' : 'static'}`;
}

/**
 * Lease the tape for one symbol/timeframe on one chart, creating and starting it on the
 * first lease. A caller that needs a specific level size gets it applied to the shared
 * source; callers that omit it take whatever the book already uses.
 */
export function acquireTapeSource(access: TapeAccess, opts: SharedTapeOptions): TapeLease {
    let table = byAccess.get(access);
    if (!table) {
        table = new Map();
        byAccess.set(access, table);
    }
    const key = keyOf(opts);
    let entry = table.get(key);
    if (!entry) {
        entry = {
            source: new TapeSource(access, {
                symbol: opts.symbol,
                timeframe: opts.timeframe,
                bars: opts.bars,
                live: opts.live,
                levelSize: opts.levelSize ?? DEFAULT_LEVEL_SIZE,
            }),
            leases: 0,
        };
        table.set(key, entry);
        entry.source.start();
    } else if (opts.levelSize != null) {
        entry.source.setLevelSize(opts.levelSize);
    }
    entry.leases += 1;

    let released = false;
    const held = entry;
    return {
        source: held.source,
        release: () => {
            if (released) return; // idempotent: a double release must not free a live source
            released = true;
            held.leases -= 1;
            if (held.leases > 0) return;
            held.source.destroy();
            table?.delete(key);
        },
    };
}

/** How many sources this chart currently holds — for tests and leak checks. */
export function leasedTapeSources(access: TapeAccess): number {
    return byAccess.get(access)?.size ?? 0;
}
