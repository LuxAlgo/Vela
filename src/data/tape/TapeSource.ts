// The shared tape reader behind every order-flow view. It owns ONE history walk and ONE
// live subscription per symbol+timeframe, folds both into a single footprint book, and
// tells its listeners which bars changed. Footprint clusters, bar delta and cumulative
// delta are then three different READS of the same book — never three subscriptions to
// the same tape.
import type { OHLCV } from '../../core/model/ohlcv';
import type { Trade } from '../../core/model/tape';
import type { BarFootprint } from '../../core/model/orderflow';
import type { Millis } from '../../core/model/time';
import type { TradeDepth, TradeRange } from '../../core/ports/DataProvider';
import type { Unsubscribe } from '../../core/util/types';
import { timeframeToMs } from '../timeframe';
import {
    createBook,
    foldTrades,
    pruneBefore,
    readBar,
    readBars,
    type FootprintBook,
} from './footprint';

/**
 * The market-data surface a tape source needs — exactly the tape methods of
 * `chart.data`, named as a port so a test can drive the source from arrays.
 */
export interface TapeAccess {
    trades(symbol: string, range?: TradeRange, opts?: { signal?: AbortSignal }): Promise<Trade[]>;
    subscribeTrades(symbol: string, onTrades: (trades: readonly Trade[]) => void): Unsubscribe;
    tradeDepth(symbol: string): TradeDepth;
    tradeStream(symbol: string): boolean;
}

export interface TapeSourceOptions {
    symbol: string;
    timeframe: string;
    /** The chart's current bars — read fresh on every fold, never cached. */
    bars: () => readonly OHLCV[];
    /** Price height of one stored level; reads may coarsen above it (see {@link TapeSource.setLevelSize}). */
    levelSize: number;
    /** Whether the chart streams live — a live chart never back-fills its forming bar. */
    live?: boolean;
    /** Bars per history request. Kept modest so one slow window doesn't stall the rest. */
    barsPerRequest?: number;
}

/** How many folded trade ids are remembered for de-duplication (see {@link TapeSource}). */
const SEEN_IDS_CAP = 20_000;
/** Default bars per history request. */
const DEFAULT_BARS_PER_REQUEST = 60;

/**
 * Reads a symbol's tape into a footprint book on demand.
 *
 * **History is pulled per bar, never in bulk.** A view asks for the window it is about to
 * show ({@link request}); the source fetches only the bars of that window it has not
 * fetched before, in chunks, newest chunk first — so panning back fills in from the edge
 * the user is looking at. A `'recent'` venue serves out-of-reach bars as empty and they
 * are marked fetched anyway: re-asking would walk a cursor that cannot get there.
 *
 * **The forming bar belongs to the live stream.** While `live`, history requests stop at
 * the last bar's open time, because a bar that is still printing would otherwise be
 * counted twice — once from the walk, once from the stream. A capped set of trade ids
 * backs that up wherever a venue supplies them.
 */
export class TapeSource {
    readonly symbol: string;
    readonly timeframe: string;

    private readonly access: TapeAccess;
    private readonly barsOf: () => readonly OHLCV[];
    private readonly live: boolean;
    private readonly barsPerRequest: number;
    private readonly barMs: number;

    /** The stored (base) level size and the size reads are coarsened to. */
    private baseLevelSize: number;
    private readLevelSize: number;

    private book: FootprintBook;
    /** Bar times whose history has been fetched (or established as out of reach). */
    private fetched = new Set<Millis>();
    /** Bar times with a fetch in flight — the `-pending` channel's raw material. */
    private inflight = new Set<Millis>();
    /** The envelope of every window a view has asked for, so a rebuild can re-ask for it. */
    private requestedFrom: Millis | null = null;
    private requestedTo: Millis | null = null;

    /**
     * The oldest bar the live stream has been covering, set when the stream opens. Everything
     * from there on is covered by the tape whether or not it printed, which is what tells an
     * EMPTY bar (a quiet minute) apart from an UNFETCHED one — a distinction a cumulative
     * reading has to make, because summing across a hole in the data is simply wrong.
     */
    private streamedFrom: Millis | null = null;
    private stream: Unsubscribe | null = null;
    private abort: AbortController | null = null;
    private started = false;
    private readonly listeners = new Set<(touched: readonly Millis[]) => void>();

    /** Folded trade ids, newest last — the de-duplication window at the history/live seam. */
    private readonly seen = new Set<string>();
    private readonly seenOrder: string[] = [];

    constructor(access: TapeAccess, opts: TapeSourceOptions) {
        this.access = access;
        this.symbol = opts.symbol;
        this.timeframe = opts.timeframe;
        this.barsOf = opts.bars;
        this.live = opts.live ?? false;
        this.barsPerRequest = Math.max(1, opts.barsPerRequest ?? DEFAULT_BARS_PER_REQUEST);
        this.barMs = timeframeToMs(opts.timeframe);
        this.baseLevelSize = opts.levelSize > 0 ? opts.levelSize : 1;
        this.readLevelSize = this.baseLevelSize;
        this.book = createBook(this.baseLevelSize);
    }

    /** How far back this symbol's tape reaches — what a view reports when it cannot reconstruct. */
    get depth(): TradeDepth {
        return this.access.tradeDepth(this.symbol);
    }

    /** Open the live tape (when the venue has one). History waits for a {@link request}. */
    start(): void {
        if (this.started) return;
        this.started = true;
        if (this.access.tradeStream(this.symbol)) {
            const bars = this.barsOf();
            // Coverage starts at the bar being printed when we subscribed, never earlier:
            // the prints that bar already had before this moment are the history walk's.
            this.streamedFrom = bars[bars.length - 1]?.time ?? null;
            this.stream = this.access.subscribeTrades(this.symbol, (trades) => this.ingest(trades));
        }
    }

    /** Close the stream and abandon in-flight history; the book is kept for a cheap restart. */
    stop(): void {
        this.started = false;
        this.stream?.();
        this.stream = null;
        this.abort?.abort();
        this.abort = null;
        this.inflight.clear();
        this.streamedFrom = null;
    }

    /** Release everything, book included. */
    destroy(): void {
        this.stop();
        this.listeners.clear();
        this.book = createBook(this.baseLevelSize);
        this.fetched.clear();
        this.requestedFrom = null;
        this.requestedTo = null;
        this.seen.clear();
        this.seenOrder.length = 0;
    }

    /**
     * Whether this bar's tape is accounted for — its history was walked, or the live stream
     * has been open since before it opened. A covered bar with no footprint genuinely had no
     * prints; an uncovered one simply has not been read, and a cumulative sum must not run
     * across it.
     */
    isCovered(time: Millis): boolean {
        if (this.fetched.has(time)) return true;
        return this.streamedFrom != null && time >= this.streamedFrom;
    }

    /**
     * The longest run of CONSECUTIVE covered bars ending at the newest covered bar, as bar
     * times — what a cumulative reading may safely be summed over. Empty when nothing is
     * covered yet. `bars` must be the chart's ascending bars.
     */
    coveredTail(bars: readonly OHLCV[]): Millis[] {
        let end = -1;
        for (let i = bars.length - 1; i >= 0; i -= 1) {
            if (this.isCovered(bars[i]!.time)) { end = i; break; }
        }
        if (end < 0) return [];
        let start = end;
        while (start > 0 && this.isCovered(bars[start - 1]!.time)) start -= 1;
        return bars.slice(start, end + 1).map((b) => b.time);
    }

    /** Told which bar times changed after any fold. */
    onChange(cb: (touched: readonly Millis[]) => void): Unsubscribe {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /**
     * Ask for tape coverage over `[from, to]` (bar open times, inclusive) — normally the
     * visible range. Fetches only what is missing, and returns immediately: results arrive
     * through {@link onChange}.
     */
    request(from: Millis, to: Millis): void {
        if (!this.started || this.depth === 'none') return;
        this.requestedFrom = this.requestedFrom == null ? from : Math.min(this.requestedFrom, from);
        this.requestedTo = this.requestedTo == null ? to : Math.max(this.requestedTo, to);
        void this.fetchMissing(from, to);
    }

    /**
     * Set the level size reads are reported at. A multiple of the stored size is served by
     * merging levels (no refetch). Anything FINER than what is stored cannot be recovered
     * by merging, so the book is rebuilt: it is cleared and every window a view has asked
     * for is fetched again.
     */
    setLevelSize(levelSize: number): void {
        const next = levelSize > 0 ? levelSize : 1;
        if (next === this.readLevelSize) return;
        const factor = next / this.baseLevelSize;
        const isMultiple = Math.abs(factor - Math.round(factor)) < 1e-9 && Math.round(factor) >= 1;
        this.readLevelSize = next;
        if (isMultiple) return;
        this.baseLevelSize = next;
        this.rebuild();
    }

    /** The level size reads currently report at. */
    get levelSize(): number {
        return this.readLevelSize;
    }

    /** One bar's footprint at the current level size, or null when nothing traded there yet. */
    footprint(time: Millis): BarFootprint | null {
        return readBar(this.book, time, this.coarsen());
    }

    /** Every bar in the book, ascending, at the current level size. */
    footprints(): BarFootprint[] {
        return readBars(this.book, this.coarsen());
    }

    /**
     * Bar-time ranges with history still in flight — for a skeleton/reveal UI. Contiguous
     * runs are merged so a view gets whole bands instead of one range per bar.
     */
    pending(): ReadonlyArray<readonly [number, number]> {
        if (this.inflight.size === 0) return [];
        const times = [...this.inflight].sort((a, b) => a - b);
        const out: Array<readonly [number, number]> = [];
        let start = times[0]!;
        let prev = start;
        for (const t of times.slice(1)) {
            if (t - prev > this.barMs) {
                out.push([start, prev + this.barMs]);
                start = t;
            }
            prev = t;
        }
        out.push([start, prev + this.barMs]);
        return out;
    }

    /** Forget bars older than the loaded history's first bar (they can never be shown again). */
    prune(): void {
        const bars = this.barsOf();
        const first = bars[0]?.time;
        if (first == null) return;
        pruneBefore(this.book, first);
        for (const t of this.fetched) if (t < first) this.fetched.delete(t);
    }

    // ── internals ────────────────────────────────────────────────────────

    private coarsen(): number {
        return Math.max(1, Math.round(this.readLevelSize / this.baseLevelSize));
    }

    /** Fold a batch and notify. Shared by the live stream and every history chunk. */
    private ingest(trades: readonly Trade[]): void {
        const fresh = this.dedupe(trades);
        if (fresh.length === 0) return;
        const touched = foldTrades(this.book, fresh, this.barsOf(), this.barMs);
        if (touched.length > 0) this.emit(touched);
    }

    /**
     * Drop trades already folded, by venue id. A venue without ids contributes nothing to
     * the window and its trades pass through — the only exposure is the forming bar, which
     * the history walk stays out of while live.
     */
    private dedupe(trades: readonly Trade[]): Trade[] {
        const out: Trade[] = [];
        for (const t of trades) {
            if (t.id != null) {
                if (this.seen.has(t.id)) continue;
                this.seen.add(t.id);
                this.seenOrder.push(t.id);
            }
            out.push(t);
        }
        while (this.seenOrder.length > SEEN_IDS_CAP) {
            const old = this.seenOrder.shift();
            if (old != null) this.seen.delete(old);
        }
        return out;
    }

    private emit(touched: readonly Millis[]): void {
        for (const cb of [...this.listeners]) cb(touched);
    }

    /**
     * Fetch the bars of `[from, to]` that have no history yet, newest chunk first. Each
     * chunk's bars are marked fetched whatever came back — an empty answer from a
     * `'recent'` venue is a final answer for that window, and re-asking would walk a
     * cursor that cannot reach it.
     */
    private async fetchMissing(from: Millis, to: Millis): Promise<void> {
        const bars = this.barsOf();
        if (bars.length === 0) return;
        // While live the forming bar is the stream's; a walk over it would double-count.
        const lastOpen = bars[bars.length - 1]!.time;
        const ceiling = this.live ? lastOpen - 1 : Infinity;

        const missing = bars
            .filter((b) => b.time >= from && b.time <= to && b.time <= ceiling && !this.fetched.has(b.time) && !this.inflight.has(b.time))
            .map((b) => b.time);
        if (missing.length === 0) return;

        // Claim every bar of this walk BEFORE the first await: a second request arriving
        // while this one is in flight must see the later chunks as taken, or both fetch them.
        for (const t of missing) this.inflight.add(t);
        this.emit([]); // pending changed — let a skeleton UI repaint before the fetch lands

        this.abort ??= new AbortController();
        const signal = this.abort.signal;

        for (let end = missing.length; end > 0; end -= this.barsPerRequest) {
            const chunk = missing.slice(Math.max(0, end - this.barsPerRequest), end);
            const first = chunk[0]!;
            const last = chunk[chunk.length - 1]!;
            try {
                const trades = await this.access.trades(this.symbol, { from: first, to: last + this.barMs - 1 }, { signal });
                if (signal.aborted) return;
                this.ingest(trades);
            } catch {
                // A failed window is left unfetched so a later request can retry it.
                for (const t of chunk) this.inflight.delete(t);
                this.emit([]);
                continue;
            } finally {
                for (const t of chunk) this.inflight.delete(t);
            }
            for (const t of chunk) this.fetched.add(t);
            this.emit(chunk);
        }
    }

    /** Clear the book and re-ask for every window a view had requested. */
    private rebuild(): void {
        this.abort?.abort();
        this.abort = null;
        this.inflight.clear();
        this.fetched.clear();
        this.seen.clear();
        this.seenOrder.length = 0;
        this.book = createBook(this.baseLevelSize);
        const from = this.requestedFrom;
        const to = this.requestedTo;
        this.requestedFrom = null;
        this.requestedTo = null;
        this.emit([]);
        if (from != null && to != null) this.request(from, to);
    }
}
