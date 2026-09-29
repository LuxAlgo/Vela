import { describe, it, expect, vi } from 'vitest';
import { TapeSource, type TapeAccess } from '../src/data/tape/TapeSource';
import type { Trade } from '../src/core/model/tape';
import type { TradeDepth, TradeRange } from '../src/core/ports/DataProvider';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;

function bars(start: number, count: number): OHLCV[] {
    return Array.from({ length: count }, (_, i) => ({
        time: start + i * MIN, open: 1, high: 1, low: 1, close: 1, volume: 0,
    }));
}

function trade(time: number, price: number, size: number, side: 'buy' | 'sell', id?: string): Trade {
    return { time, price, size, side, id };
}

/** A recorded history call. */
interface Call {
    range: TradeRange;
}

/**
 * A scriptable tape: `answer` decides what each window returns, every call is recorded,
 * and `push` plays the live stream. Nothing here touches the network or a timer.
 */
function fakeAccess(opts: {
    depth?: TradeDepth;
    stream?: boolean;
    answer?: (range: TradeRange) => Trade[];
} = {}) {
    const calls: Call[] = [];
    let onTrades: ((t: readonly Trade[]) => void) | null = null;
    let unsubscribed = 0;
    const access: TapeAccess = {
        trades: (_symbol, range = {}) => {
            calls.push({ range });
            return Promise.resolve(opts.answer?.(range) ?? []);
        },
        subscribeTrades: (_symbol, cb) => {
            onTrades = cb;
            return () => { onTrades = null; unsubscribed += 1; };
        },
        tradeDepth: () => opts.depth ?? 'full',
        tradeStream: () => opts.stream ?? true,
    };
    return {
        access,
        calls,
        push: (t: readonly Trade[]) => onTrades?.(t),
        streaming: (): boolean => onTrades != null,
        unsubscribed: (): number => unsubscribed,
    };
}

/** Let every queued promise settle (the source's fetches are fire-and-forget). */
async function settle(turns = 20): Promise<void> {
    for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

describe('TapeSource — live stream', () => {
    it('folds streamed batches into the book and reports the bars touched', async () => {
        const fake = fakeAccess();
        const b = bars(0, 3);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, live: true });
        const seen: number[][] = [];
        src.onChange((touched) => { if (touched.length > 0) seen.push([...touched]); });

        src.start();
        expect(fake.streaming()).toBe(true);
        fake.push([trade(0, 100, 2, 'buy', 'a'), trade(MIN + 1, 100, 3, 'sell', 'b')]);
        await settle();

        expect(seen).toEqual([[0, MIN]]);
        expect(src.footprint(0)!.buy).toBe(2);
        expect(src.footprint(MIN)!.sell).toBe(3);
        expect(src.footprint(2 * MIN)).toBeNull();
    });

    it('does not open a stream on a venue that has none, and closes it on stop', () => {
        const none = fakeAccess({ stream: false });
        const a = new TapeSource(none.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 1 });
        a.start();
        expect(none.streaming()).toBe(false);

        const fake = fakeAccess();
        const b = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 1 });
        b.start();
        b.stop();
        expect(fake.unsubscribed()).toBe(1);
        expect(fake.streaming()).toBe(false);
    });

    it('de-duplicates by trade id across the history/live seam', async () => {
        const fake = fakeAccess({ answer: () => [trade(0, 100, 5, 'buy', 'dup')] });
        const b = bars(0, 3);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1 });
        src.start();
        fake.push([trade(0, 100, 5, 'buy', 'dup')]);
        await settle();
        src.request(0, 2 * MIN);
        await settle();

        // The same print arrived twice; it is counted once.
        expect(src.footprint(0)!.buy).toBe(5);
    });
});

describe('TapeSource — history', () => {
    it('fetches only the missing bars, and not twice', async () => {
        const fake = fakeAccess({ answer: (r) => [trade(r.from!, 100, 1, 'buy', `t${r.from}`)] });
        const b = bars(0, 4);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, barsPerRequest: 2 });
        src.start();

        src.request(0, 3 * MIN);
        await settle();
        expect(fake.calls).toHaveLength(2); // 4 bars at 2 per request

        // Newest chunk first: panning fills in from the edge the user is looking at.
        expect(fake.calls[0]!.range.from).toBe(2 * MIN);
        expect(fake.calls[1]!.range.from).toBe(0);
        // The window covers its whole last bar, not just that bar's open.
        expect(fake.calls[0]!.range.to).toBe(4 * MIN - 1);

        fake.calls.length = 0;
        src.request(0, 3 * MIN);
        await settle();
        expect(fake.calls).toEqual([]); // already fetched
    });

    it('leaves the forming bar to the live stream while live', async () => {
        const fake = fakeAccess();
        const b = bars(0, 3);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, live: true, barsPerRequest: 10 });
        src.start();
        src.request(0, 2 * MIN);
        await settle();

        // Bars 0 and 1 are walked; the forming bar (2) is not — walking it would count the
        // same prints twice, once from the walk and once from the stream.
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]!.range.from).toBe(0);
        expect(fake.calls[0]!.range.to).toBe(2 * MIN - 1);
    });

    it('walks every bar including the last when the chart is not live', async () => {
        const fake = fakeAccess();
        const b = bars(0, 3);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, live: false, barsPerRequest: 10 });
        src.start();
        src.request(0, 2 * MIN);
        await settle();
        expect(fake.calls[0]!.range.to).toBe(3 * MIN - 1);
    });

    it('never fetches on a venue with no trade history', async () => {
        const fake = fakeAccess({ depth: 'none' });
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 3), levelSize: 1 });
        src.start();
        src.request(0, 2 * MIN);
        await settle();
        expect(fake.calls).toEqual([]);
        expect(src.depth).toBe('none');
    });

    it('treats an empty answer as final — an out-of-reach window is not re-walked', async () => {
        const fake = fakeAccess({ depth: 'recent', answer: () => [] });
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 2), levelSize: 1, barsPerRequest: 10 });
        src.start();
        src.request(0, MIN);
        await settle();
        expect(fake.calls).toHaveLength(1);

        src.request(0, MIN);
        await settle();
        expect(fake.calls).toHaveLength(1); // re-asking would walk a cursor that cannot get there
    });

    it('retries a window whose fetch failed', async () => {
        let fail = true;
        const access: TapeAccess = {
            trades: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve([trade(0, 100, 1, 'buy', 'a')])),
            subscribeTrades: () => () => {},
            tradeDepth: () => 'full',
            tradeStream: () => false,
        };
        const src = new TapeSource(access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 1, live: false });
        src.start();
        src.request(0, 0);
        await settle();
        expect(src.footprint(0)).toBeNull();

        fail = false;
        src.request(0, 0);
        await settle();
        expect(src.footprint(0)!.buy).toBe(1);
    });

    it('does not double-fetch a window a concurrent request is already walking', async () => {
        const fake = fakeAccess();
        const b = bars(0, 6);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, barsPerRequest: 2, live: false });
        src.start();
        src.request(0, 5 * MIN);
        src.request(0, 5 * MIN); // same window, before the first walk's later chunks run
        await settle();
        expect(fake.calls).toHaveLength(3); // 6 bars at 2 per request, walked once
    });

    it('reports pending bar ranges while a walk is in flight, merging contiguous runs', async () => {
        // Held in an object so narrowing does not collapse it to `null` at the call below.
        const held: { release: (() => void) | null } = { release: null };
        const access: TapeAccess = {
            trades: () => new Promise<Trade[]>((resolve) => { held.release = (): void => resolve([]); }),
            subscribeTrades: () => () => {},
            tradeDepth: () => 'full',
            tradeStream: () => false,
        };
        const b = bars(0, 3);
        const src = new TapeSource(access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, barsPerRequest: 10, live: false });
        src.start();
        src.request(0, 2 * MIN);
        await settle();

        expect(src.pending()).toEqual([[0, 3 * MIN]]); // one band over all three bars
        held.release?.();
        await settle();
        expect(src.pending()).toEqual([]);
    });

    it('prune drops bars that scrolled out of the loaded history', async () => {
        const fake = fakeAccess();
        let b = bars(0, 3);
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => b, levelSize: 1, live: true });
        src.start();
        fake.push([trade(0, 100, 1, 'buy', 'a'), trade(2 * MIN, 100, 1, 'buy', 'b')]);
        await settle();
        expect(src.footprints()).toHaveLength(2);

        b = b.slice(2); // history retention dropped the first two bars
        src.prune();
        expect(src.footprints().map((f) => f.time)).toEqual([2 * MIN]);
    });
});

describe('TapeSource — level size', () => {
    it('serves a coarser level size by merging, with no refetch', async () => {
        const fake = fakeAccess({ answer: () => [trade(0, 100, 1, 'buy', 'a'), trade(0, 101, 2, 'buy', 'b')] });
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 1, live: false });
        src.start();
        src.request(0, 0);
        await settle();
        expect(src.footprint(0)!.levels).toHaveLength(2);

        fake.calls.length = 0;
        src.setLevelSize(2);
        expect(src.levelSize).toBe(2);
        expect(src.footprint(0)!.levels).toEqual([{ price: 100, buy: 3, sell: 0 }]);
        expect(fake.calls).toEqual([]); // merging needs nothing from the venue
    });

    it('rebuilds when asked for a FINER level size than it stored', async () => {
        const fake = fakeAccess({ answer: () => [trade(0, 100, 1, 'buy', 'a'), trade(0, 100.5, 2, 'buy', 'b')] });
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 1, live: false });
        src.start();
        src.request(0, 0);
        await settle();
        expect(src.footprint(0)!.levels).toEqual([{ price: 100, buy: 3, sell: 0 }]);

        fake.calls.length = 0;
        src.setLevelSize(0.5); // merged volume cannot be split back apart — refetch
        await settle();
        expect(fake.calls).toHaveLength(1);
        expect(src.footprint(0)!.levels).toEqual([
            { price: 100, buy: 1, sell: 0 },
            { price: 100.5, buy: 2, sell: 0 },
        ]);
    });

    it('ignores a level-size change that changes nothing', () => {
        const fake = fakeAccess();
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 1), levelSize: 2 });
        src.start();
        const spy = vi.spyOn(fake.access, 'trades');
        src.setLevelSize(2);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('TapeSource — teardown', () => {
    it('destroy releases the stream, the book and the listeners', async () => {
        const fake = fakeAccess();
        const src = new TapeSource(fake.access, { symbol: 'X', timeframe: '1', bars: () => bars(0, 2), levelSize: 1, live: true });
        const seen: number[] = [];
        src.onChange(() => seen.push(1));
        src.start();
        fake.push([trade(0, 100, 1, 'buy', 'a')]);
        await settle();
        expect(src.footprints()).toHaveLength(1);

        src.destroy();
        expect(fake.unsubscribed()).toBe(1);
        expect(src.footprints()).toEqual([]);
        const before = seen.length;
        fake.push([trade(0, 100, 1, 'buy', 'z')]);
        expect(seen.length).toBe(before); // no listeners left to notify
    });
});
