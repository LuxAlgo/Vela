// Tape → footprint aggregation: the pure core every order-flow view reads. Trades fold
// into a BOOK (one accumulator per bar, levels keyed by bucket index) and are read back
// as immutable {@link BarFootprint}s, optionally coarsened to a wider level size. Nothing
// here fetches, subscribes or de-duplicates — the book is fed whatever the source
// already decided is new, which is what keeps every rule below testable from an array.
import type { OHLCV } from '../../core/model/ohlcv';
import type { Trade } from '../../core/model/tape';
import type { BarFootprint, FootprintImbalance, FootprintLevel, CumulativeDeltaBar } from '../../core/model/orderflow';
import type { Millis } from '../../core/model/time';

/** Guards the bucket floor against binary-float error: 0.3/0.1 is 2.9999999999999996. */
const EPS = 1e-9;

/** One level's running totals inside a bar accumulator. */
interface LevelAcc {
    buy: number;
    sell: number;
}

/** One bar's running totals — the book's mutable unit. */
export interface BarAcc {
    time: Millis;
    /** Bucket index (see {@link levelIndex}) → totals. Sparse: only levels that traded. */
    levels: Map<number, LevelAcc>;
    buy: number;
    sell: number;
    /** Running delta, and the extremes it has reached (both start at 0). */
    delta: number;
    deltaHigh: number;
    deltaLow: number;
}

/**
 * Accumulated tape, keyed by bar open time. Built at ONE level size (the book's base) —
 * reads may coarsen to any integer multiple of it, never below it, because volume that
 * has been merged into a bucket cannot be split back out.
 */
export interface FootprintBook {
    /** Price height of one stored level, in quote units. */
    levelSize: number;
    bars: Map<Millis, BarAcc>;
}

/** An empty book at `levelSize`. */
export function createBook(levelSize: number): FootprintBook {
    return { levelSize: levelSize > 0 ? levelSize : 1, bars: new Map() };
}

/** The level size `ticks` price increments make up (the footprint's row height). */
export function levelSizeFor(tickSize: number, ticks: number): number {
    const t = tickSize > 0 ? tickSize : 1;
    return t * Math.max(1, Math.round(ticks));
}

/** The bucket a price falls in: `floor(price / levelSize)`, float error absorbed. */
export function levelIndex(price: number, levelSize: number): number {
    return Math.floor(price / levelSize + EPS);
}

/**
 * The low price edge of bucket `index`, rounded to the level size's own precision —
 * `index * levelSize` alone yields 0.30000000000000004 edges, which then print as
 * row labels and fail equality against a price the venue quoted exactly.
 */
export function levelPrice(index: number, levelSize: number): number {
    const decimals = decimalsOf(levelSize);
    return Number((index * levelSize).toFixed(decimals));
}

/** Decimal places needed to write `levelSize` exactly (capped at what a double holds). */
function decimalsOf(levelSize: number): number {
    const s = String(levelSize);
    const exp = /e-(\d+)$/i.exec(s);
    if (exp) return Math.min(15, Number(exp[1]));
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : Math.min(15, s.length - dot - 1);
}

/**
 * The open time of the bar a trade belongs to. Bars are searched rather than computed
 * from the epoch, so session breaks, holidays and non-UTC daily opens land correctly —
 * the loaded bars already encode all of that.
 *
 * A trade NEWER than the last bar (the live tape runs ahead of the candle feed) is
 * extrapolated forward in `barMs` steps from the last bar's open. That assumes the next
 * bar opens one period later, which is true except across a session break — where the
 * bucket simply never becomes a bar and is never read.
 *
 * Returns null for a trade older than the loaded history, and for an empty bar array.
 */
export function barTimeAt(bars: readonly OHLCV[], time: Millis, barMs: number): Millis | null {
    if (bars.length === 0) return null;
    const first = bars[0]!;
    if (time < first.time) return null;

    // Last bar with open <= time (upper-bound binary search).
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid]!.time <= time) lo = mid;
        else hi = mid - 1;
    }
    const bar = bars[lo]!;
    if (lo < bars.length - 1) return bar.time;

    const ahead = time - bar.time;
    if (ahead < barMs || barMs <= 0) return bar.time;
    return bar.time + Math.floor(ahead / barMs) * barMs;
}

/**
 * Fold `trades` into `book`, assigning each to its bar. Returns the bar times touched, so
 * a caller can repaint or recompute exactly those bars.
 *
 * Trades are folded IN THE ORDER GIVEN: the running-delta extremes (`deltaHigh`/`deltaLow`)
 * are path-dependent, so a caller that folds a window out of order gets correct totals
 * and wrong extremes. Providers deliver ascending; keep it that way.
 *
 * Trades outside the loaded bars, at a non-finite price, or at a non-positive size are
 * dropped — a zero-size print carries no information and a NaN price would poison a
 * bucket index for the life of the book.
 */
export function foldTrades(
    book: FootprintBook,
    trades: readonly Trade[],
    bars: readonly OHLCV[],
    barMs: number,
): Millis[] {
    const touched = new Set<Millis>();
    for (const t of trades) {
        if (!Number.isFinite(t.price) || !Number.isFinite(t.size) || t.size <= 0) continue;
        const time = barTimeAt(bars, t.time, barMs);
        if (time == null) continue;

        let acc = book.bars.get(time);
        if (!acc) {
            acc = { time, levels: new Map(), buy: 0, sell: 0, delta: 0, deltaHigh: 0, deltaLow: 0 };
            book.bars.set(time, acc);
        }
        const idx = levelIndex(t.price, book.levelSize);
        let level = acc.levels.get(idx);
        if (!level) {
            level = { buy: 0, sell: 0 };
            acc.levels.set(idx, level);
        }
        if (t.side === 'buy') {
            level.buy += t.size;
            acc.buy += t.size;
            acc.delta += t.size;
        } else {
            level.sell += t.size;
            acc.sell += t.size;
            acc.delta -= t.size;
        }
        if (acc.delta > acc.deltaHigh) acc.deltaHigh = acc.delta;
        if (acc.delta < acc.deltaLow) acc.deltaLow = acc.delta;
        touched.add(time);
    }
    return [...touched];
}

/** Drop every bar older than `time` (retention as history scrolls out of the window). */
export function pruneBefore(book: FootprintBook, time: Millis): void {
    for (const key of book.bars.keys()) if (key < time) book.bars.delete(key);
}

/** Forget one bar — a re-fetch replacing a window must not double-count what it re-reads. */
export function clearBar(book: FootprintBook, time: Millis): void {
    book.bars.delete(time);
}

/**
 * Read one bar out of the book as an immutable footprint, merging every `coarsen`
 * stored levels into one. `coarsen` is a count of STORED levels (1 = as stored); values
 * below 1 are clamped, since a merged bucket cannot be split.
 */
export function readBar(book: FootprintBook, time: Millis, coarsen = 1): BarFootprint | null {
    const acc = book.bars.get(time);
    if (!acc) return null;
    return materialize(acc, book.levelSize, coarsen);
}

/** Every bar in the book, ascending by time (see {@link readBar} for `coarsen`). */
export function readBars(book: FootprintBook, coarsen = 1): BarFootprint[] {
    return [...book.bars.values()]
        .sort((a, b) => a.time - b.time)
        .map((acc) => materialize(acc, book.levelSize, coarsen));
}

/** Turn one accumulator into the immutable read shape. */
function materialize(acc: BarAcc, baseSize: number, coarsen: number): BarFootprint {
    const factor = Math.max(1, Math.round(coarsen));
    const levelSize = baseSize * factor;
    const merged = new Map<number, LevelAcc>();
    for (const [idx, lv] of acc.levels) {
        // Floor-divide so negative indices (a price below the level size, e.g. sub-1.0
        // quotes) group downward like every other bucket instead of toward zero.
        const key = Math.floor(idx / factor);
        const cur = merged.get(key);
        if (cur) {
            cur.buy += lv.buy;
            cur.sell += lv.sell;
        } else {
            merged.set(key, { buy: lv.buy, sell: lv.sell });
        }
    }

    const levels: FootprintLevel[] = [...merged.entries()]
        .map(([key, lv]) => ({ price: levelPrice(key, levelSize), buy: lv.buy, sell: lv.sell }))
        .sort((a, b) => a.price - b.price);

    let poc: number | null = null;
    let best = 0;
    for (const lv of levels) {
        const vol = lv.buy + lv.sell;
        // Strictly greater keeps the LOWER level on a tie (levels are ascending).
        if (vol > best) {
            best = vol;
            poc = lv.price;
        }
    }

    return {
        time: acc.time,
        levelSize,
        levels,
        buy: acc.buy,
        sell: acc.sell,
        delta: acc.buy - acc.sell,
        volume: acc.buy + acc.sell,
        deltaHigh: acc.deltaHigh,
        deltaLow: acc.deltaLow,
        poc,
    };
}

/** How an imbalance compares two levels. */
export interface ImbalanceOptions {
    /** Dominance the winning side must reach, as a multiple (3 = 300%). */
    ratio: number;
    /**
     * `'diagonal'` (the conventional reading) compares buyers at a level against sellers
     * one level BELOW it — the two sides that were actually resting against each other.
     * `'level'` compares the two sides within the same level, which is blunter but needs
     * no neighbour and so also flags the extremes of the bar.
     */
    mode?: 'diagonal' | 'level';
    /** Ignore levels whose compared volume is below this (keeps thin edges from flagging). */
    minVolume?: number;
}

/**
 * Flag the imbalanced levels of a footprint. A side is imbalanced when its volume is at
 * least `ratio` times the volume it is compared against; an empty comparison side gives
 * an infinite ratio and flags whenever the dominant side clears `minVolume`.
 */
export function footprintImbalances(fp: BarFootprint, opts: ImbalanceOptions): FootprintImbalance[] {
    const ratio = opts.ratio > 0 ? opts.ratio : 1;
    const mode = opts.mode ?? 'diagonal';
    const minVolume = opts.minVolume ?? 0;
    const out: FootprintImbalance[] = [];

    const flag = (price: number, side: 'buy' | 'sell', win: number, against: number): void => {
        if (win < minVolume || win <= 0) return;
        const r = against > 0 ? win / against : Infinity;
        if (r >= ratio) out.push({ price, side, ratio: r });
    };

    if (mode === 'level') {
        for (const lv of fp.levels) {
            flag(lv.price, 'buy', lv.buy, lv.sell);
            flag(lv.price, 'sell', lv.sell, lv.buy);
        }
        return out;
    }

    // Diagonal: buyers at level i against sellers at i-1, sellers at i against buyers at
    // i+1. Neighbours are matched by PRICE (levels are sparse — a gap is not a neighbour).
    const byPrice = new Map<number, FootprintLevel>();
    for (const lv of fp.levels) byPrice.set(lv.price, lv);
    const below = (lv: FootprintLevel): FootprintLevel | undefined =>
        byPrice.get(levelPrice(levelIndex(lv.price, fp.levelSize) - 1, fp.levelSize));
    const above = (lv: FootprintLevel): FootprintLevel | undefined =>
        byPrice.get(levelPrice(levelIndex(lv.price, fp.levelSize) + 1, fp.levelSize));

    for (const lv of fp.levels) {
        flag(lv.price, 'buy', lv.buy, below(lv)?.sell ?? 0);
        flag(lv.price, 'sell', lv.sell, above(lv)?.buy ?? 0);
    }
    return out;
}

/**
 * Build the cumulative-delta series over `footprints` (ascending by time). Each bar
 * carries the running total in (`open`), out (`close`) and the extremes it reached
 * inside the bar — the bar's own delta path, so a spike that reversed within the bar
 * still shows.
 *
 * `resetBefore` starts a fresh total AT a bar: it is asked, for each bar after the first,
 * whether the running total should restart there (a session open, a day boundary). The
 * predicate is supplied rather than computed here because only the caller knows the
 * chart's timezone and session.
 */
export function cumulativeDeltaBars(
    footprints: readonly BarFootprint[],
    resetBefore?: (bar: BarFootprint, previous: BarFootprint) => boolean,
): CumulativeDeltaBar[] {
    const out: CumulativeDeltaBar[] = [];
    let running = 0;
    let previous: BarFootprint | null = null;
    for (const fp of footprints) {
        if (previous && resetBefore?.(fp, previous)) running = 0;
        const open = running;
        const close = open + fp.delta;
        out.push({
            time: fp.time,
            open,
            close,
            high: open + Math.max(fp.deltaHigh, fp.delta, 0),
            low: open + Math.min(fp.deltaLow, fp.delta, 0),
        });
        running = close;
        previous = fp;
    }
    return out;
}
