import { describe, it, expect } from 'vitest';
import { CachingDataFeed } from '../src/data/CachingDataFeed';
import { BarStore, seriesKey } from '../src/data/BarStore';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Unsubscribe } from '../src/core/util/types';

const clone = (b: OHLCV): OHLCV => ({ ...b });

/** A feed over a synthetic, growing timeline. `load` returns the most-recent N; `loadRange` the tail. */
class FakeFeed implements MarketDataFeed {
    loadCalls = 0;
    rangeCalls = 0;
    lastRangeFrom?: number;
    ranges: BarRange[] = [];
    private all: OHLCV[] = [];

    constructor(count: number, private readonly start = 1_700_000_000_000, private readonly step = 3_600_000) {
        for (let i = 0; i < count; i += 1) this.all.push(this.bar(i));
    }

    private bar(i: number): OHLCV {
        const price = 100 + Math.sin(i / 5) * 10;
        return { time: this.start + i * this.step, open: price, high: price + 1, low: price - 1, close: price, volume: 1 };
    }

    /** Append n new bars (advancing "now"); the last is the forming candle. */
    advance(n: number): void {
        const base = this.all.length;
        for (let i = 0; i < n; i += 1) this.all.push(this.bar(base + i));
    }

    /** The most-recent n bars (the correct expected window). */
    expected(n: number): OHLCV[] {
        return this.all.slice(-n).map(clone);
    }

    load(cfg: MarketConfig): Promise<OHLCV[]> {
        this.loadCalls += 1;
        if (cfg.data && cfg.data.length > 0) return Promise.resolve(cfg.data);
        return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)).map(clone));
    }

    loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls += 1;
        this.lastRangeFrom = range.from;
        this.ranges.push({ ...range });
        const from = range.from ?? -Infinity;
        const to = range.to ?? Infinity;
        let out = this.all.filter((b) => b.time >= from && b.time <= to);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out.map(clone));
    }

    subscribe(): Unsubscribe {
        return () => {};
    }
}

const CFG: MarketConfig = { symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500 };
const KEY = seriesKey('binance', 'BTCUSDT', '60');
const times = (bars: OHLCV[]): number[] => bars.map((b) => b.time);

function setup(count: number): { feed: FakeFeed; store: BarStore; cf: CachingDataFeed } {
    const feed = new FakeFeed(count);
    const store = new BarStore();
    return { feed, store, cf: new CachingDataFeed(feed, store) };
}

describe('CachingDataFeed', () => {
    it('cold load fetches in full, caches the closed bars, and excludes the forming bar', async () => {
        const { feed, store, cf } = setup(600);
        const r1 = await cf.load(CFG);

        expect(r1.length).toBe(500);
        expect(feed.loadCalls).toBe(1);
        expect(feed.rangeCalls).toBe(0);

        const cached = store.get(KEY)!;
        expect(cached.length).toBe(499); // forming bar dropped
        // the forming (newest) bar is NOT cached
        expect(cached[cached.length - 1]!.time).toBeLessThan(r1[r1.length - 1]!.time);
    });

    it('a re-run (same N) fetches ONLY the tail via loadRange — no second full load', async () => {
        const { feed, cf } = setup(600);
        await cf.load(CFG);
        const r2 = await cf.load(CFG);

        expect(feed.loadCalls).toBe(1); // not re-fetched in full
        expect(feed.rangeCalls).toBe(1); // tail-only
        expect(r2.length).toBe(500);
        expect(times(r2)).toEqual(times(feed.expected(500))); // correct window, incl. forming
    });

    it('after new bars form, the re-run still tails and returns the shifted window', async () => {
        const { feed, cf } = setup(600);
        await cf.load(CFG);
        feed.advance(3); // 3 new bars
        const r3 = await cf.load(CFG);

        expect(feed.loadCalls).toBe(1);
        expect(feed.rangeCalls).toBe(1); // one cold load + one tail re-run
        expect(times(r3)).toEqual(times(feed.expected(500)));
    });

    it('caches a contiguous, sorted, de-duplicated set (tail overlap dedups)', async () => {
        const { feed, store, cf } = setup(600);
        await cf.load(CFG);
        feed.advance(2);
        await cf.load(CFG);

        const cached = store.get(KEY)!;
        const t = times(cached);
        expect(t).toEqual([...t].sort((a, b) => a - b)); // sorted
        expect(new Set(t).size).toBe(t.length); // no duplicates
    });

    it('requesting MORE bars than cached falls back to a full fetch', async () => {
        const { feed, cf } = setup(3000);
        await cf.load(CFG); // caches ~499
        const big = await cf.load({ ...CFG, bars: 2000 });

        expect(feed.loadCalls).toBe(2); // 499 < 1999 → full fetch, not tail
        expect(big.length).toBe(2000);
    });

    it('changing symbol purges the previous symbol (current-symbol-only)', async () => {
        const { feed, store, cf } = setup(600);
        await cf.load(CFG);
        expect(store.get(KEY)).toBeDefined();

        await cf.load({ ...CFG, symbol: 'binance:ETHUSDT' });
        expect(store.get(KEY)).toBeUndefined(); // BTCUSDT evicted
        expect(store.get(seriesKey('binance', 'ETHUSDT', '60'))).toBeDefined();

        // …and re-loading the original is a cold fetch again.
        const before = feed.loadCalls;
        await cf.load(CFG);
        expect(feed.loadCalls).toBe(before + 1);
    });

    it('offline `data` bypasses the cache entirely', async () => {
        const { feed, store, cf } = setup(10);
        const offline: OHLCV[] = feed.expected(5);
        const r = await cf.load({ data: offline });

        expect(r).toEqual(offline);
        // nothing written under any key
        expect(store.get(seriesKey('binance', 'TEST', '60'))).toBeUndefined();
    });

    it('falls back to full load when the inner feed has no loadRange', async () => {
        const noRange: MarketDataFeed = {
            load: (cfg) => Promise.resolve(new FakeFeed(600).expected(cfg.bars ?? 500)),
            subscribe: () => () => {},
        };
        const cf = new CachingDataFeed(noRange, new BarStore());
        const a = await cf.load(CFG);
        const b = await cf.load(CFG);
        expect(a.length).toBe(500);
        expect(b.length).toBe(500); // still correct, just not tail-optimized
    });

    it('loadRange caches a secondary series and re-fetches only the tail', async () => {
        const { feed, store, cf } = setup(600);
        const cfg: MarketConfig = { symbol: 'binance:ETHUSDT', timeframe: '240' };
        const earliest = feed.expected(600)[0]!.time;

        await cf.loadRange(cfg, { from: earliest });
        expect(store.get(seriesKey('binance', 'ETHUSDT', '240'))).toBeDefined();
        const firstFrom = feed.lastRangeFrom!;

        await cf.loadRange(cfg, { from: earliest });
        // second call fetched only the tail (from the last cached bar), not the full range
        expect(feed.lastRangeFrom!).toBeGreaterThan(firstFrom);
    });

    it('loadRange caches even when the fetch start precedes the first bar (HTF warmup buffer)', async () => {
        const { feed, cf } = setup(600);
        const cfg: MarketConfig = { symbol: 'binance:ETHUSDT', timeframe: '240' };
        // `from` earlier than any available bar — the cached first bar will be AFTER it,
        // so the old "oldest.time <= from" check could never prove coverage.
        const buffered = feed.expected(600)[0]!.time - 5_000_000;

        await cf.loadRange(cfg, { from: buffered });
        const firstFrom = feed.lastRangeFrom!; // full fetch from `buffered`

        await cf.loadRange(cfg, { from: buffered });
        // still tail-only on the re-run (coverage tracked by the recorded from, not bar alignment)
        expect(feed.lastRangeFrom!).toBeGreaterThan(firstFrom);
    });

    it('backward {to, limit} chunks walk older history and never re-serve the cache as a "chunk"', async () => {
        const { feed, cf } = setup(3000);
        await cf.load(CFG); // caches ~499 recent bars
        const oldest = (await cf.load(CFG))[0]!.time;

        // Chunk 1: strictly-older window ending AT the current oldest (overlap-by-one).
        const c1 = await cf.loadRange(CFG, { to: oldest, limit: 100 });
        expect(c1.length).toBe(100);
        expect(c1[c1.length - 1]!.time).toBe(oldest); // overlap bar included
        expect(c1[0]!.time).toBeLessThan(oldest); // genuinely older data — the loop progresses
        const callsAfterC1 = feed.rangeCalls;

        // Chunk 2 walks further back from chunk 1's oldest bar.
        const c2 = await cf.loadRange(CFG, { to: c1[0]!.time, limit: 100 });
        expect(c2[0]!.time).toBeLessThan(c1[0]!.time);
        expect(feed.rangeCalls).toBe(callsAfterC1 + 1);

        // Re-requesting chunk 1's window is now served from cache — no new fetch.
        const again = await cf.loadRange(CFG, { to: oldest, limit: 100 });
        expect(times(again)).toEqual(times(c1));
        expect(feed.rangeCalls).toBe(callsAfterC1 + 1);
    });

    it('a backward chunk at genesis returns empty (nothing older exists)', async () => {
        const { feed, cf } = setup(300);
        await cf.load(CFG);
        const first = feed.expected(300)[0]!.time; // the very first bar that exists

        const partial = await cf.loadRange(CFG, { to: first, limit: 100 });
        expect(partial.length).toBe(1); // only the boundary bar — a partial chunk

        const empty = await cf.loadRange(CFG, { to: first - 3_600_000, limit: 100 });
        expect(empty).toEqual([]); // strictly before genesis → empty
    });

    it('a from-request older than coverage fetches ONLY the missing head, not the full range', async () => {
        const { feed, cf } = setup(600);
        // Timeframe matches the fixture's hourly cadence: computed explicit limits size off it.
        const cfg: MarketConfig = { symbol: 'binance:ETHUSDT', timeframe: '60' };
        const all = feed.expected(600);
        const mid = all[300]!.time;
        const earlier = all[100]!.time;

        await cf.loadRange(cfg, { from: mid }); // coverage recorded at mid
        feed.ranges.length = 0;

        const r = await cf.loadRange(cfg, { from: earlier });
        // Exactly one head fetch [earlier, mid] + one tail refresh — never a full re-fetch.
        const head = feed.ranges[0]!;
        expect(head.from).toBe(earlier);
        expect(head.to).toBe(mid);
        expect(feed.ranges.length).toBe(2); // head + tail
        expect(r[0]!.time).toBe(earlier); // the served window spans the full request
        expect(times(r)).toEqual(times(all.filter((b) => b.time >= earlier)));
    });

    it('a covered {from, to} window is clipped at `to` (no tail bars beyond it)', async () => {
        const { feed, cf } = setup(600);
        const cfg: MarketConfig = { symbol: 'binance:ETHUSDT', timeframe: '60' };
        const all = feed.expected(600);
        const from = all[0]!.time;
        const to = all[599]!.time; // the current tip — NOT a historical request

        await cf.loadRange(cfg, { from });
        feed.advance(5); // newer bars exist beyond `to` now
        const r = await cf.loadRange(cfg, { from, to });
        expect(r[r.length - 1]!.time).toBeLessThanOrEqual(to);
    });

    it('a giant count-bounded miss pages backward with explicit limits', async () => {
        const { feed, cf } = setup(30_000);
        const tip = feed.expected(1)[0]!.time;
        feed.ranges.length = 0;

        const r = await cf.loadRange(CFG, { to: tip, limit: 25_000 });
        expect(r.length).toBe(25_000);
        expect(times(r)).toEqual([...times(r)].sort((a, b) => a - b)); // ascending, deduped merge
        // Three bounded pages instead of one 25k request; every page carries an explicit limit.
        expect(feed.ranges.map((x) => x.limit)).toEqual([10_000, 10_000, 5_000]);
        expect(feed.ranges.every((x) => x.to != null)).toBe(true);
    });

    it('a paged walk that runs out of history stops and marks only what it PROVED covered', async () => {
        const { feed, store, cf } = setup(5_000); // less exists than requested
        const tip = feed.expected(1)[0]!.time;
        const oldest = feed.expected(5_000)[0]!.time;

        const r = await cf.loadRange(CFG, { to: tip, limit: 20_000 });
        expect(r.length).toBe(5_000); // everything that exists
        // Coverage claims only down to the oldest bar actually seen — never the full ask.
        expect(store.coveredFromOf(KEY)).toBe(oldest);
    });

    it('a from-bounded walk steps ACROSS an empty time window instead of stopping (time-window sources)', async () => {
        // A lux-server-shaped feed: {to, limit} means "the WINDOW of `limit` bar-slots ending
        // at `to`" — an empty window mid-history is a quiet gap, not genesis.
        const STEP = 3_600_000;
        const T0 = 1_700_000_000_000;
        const mk = (i: number): OHLCV => ({ time: T0 + i * STEP, open: 1, high: 2, low: 0, close: 1, volume: 1 });
        // Two clusters separated by a >1-page hole: indices 0..99 and 20_000..20_099.
        const all = [...Array.from({ length: 100 }, (_, i) => mk(i)), ...Array.from({ length: 100 }, (_, i) => mk(20_000 + i))];
        const ranges: BarRange[] = [];
        const windowed: MarketDataFeed = {
            load: () => Promise.resolve(all.slice(-500)),
            subscribe: () => () => {},
            loadRange: (_cfg, range) => {
                ranges.push({ ...range });
                const to = range.to ?? Infinity;
                const from = range.limit != null ? to - range.limit * STEP : (range.from ?? -Infinity);
                return Promise.resolve(all.filter((b) => b.time >= from && b.time <= to));
            },
        };
        const cf = new CachingDataFeed(windowed, new BarStore());
        const cfg: MarketConfig = { symbol: 'binance:BTCUSDT', timeframe: '60' };

        const r = await cf.loadRange(cfg, { from: all[0]!.time, to: all[all.length - 1]!.time });
        // BOTH clusters arrive — the walk stepped through the empty middle window(s)
        // instead of treating them as genesis and abandoning the older cluster.
        expect(r.length).toBe(200);
        expect(r[0]!.time).toBe(all[0]!.time);
        expect(ranges.length).toBeGreaterThan(2); // paged, incl. at least one empty-window step
    });

    it('every outgoing ranged request carries an explicit limit (silent-clip regression)', async () => {
        const { feed, cf } = setup(600);
        await cf.load(CFG); // cold
        feed.advance(3);
        await cf.load(CFG); // tail refresh
        const earliest = feed.expected(600)[0]!.time;
        await cf.loadRange({ ...CFG, symbol: 'ETHUSDT', timeframe: '60' }, { from: earliest }); // secondary miss
        // A source that clips limit-less requests to a 500-bar default can no longer truncate:
        // nothing we send omits the limit.
        expect(feed.ranges.length).toBeGreaterThan(0);
        expect(feed.ranges.every((r) => r.limit != null)).toBe(true);
    });

    it('secondary series survive a same-symbol re-run, dropped on chart-symbol change', async () => {
        const { feed, store, cf } = setup(600);
        const main: MarketConfig = { symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500 };
        const secondary: MarketConfig = { symbol: 'binance:ETHUSDT', timeframe: '240' };
        const secKey = seriesKey('binance', 'ETHUSDT', '240');
        const earliest = feed.expected(600)[0]!.time;

        await cf.load(main); // chart symbol = BTC
        await cf.loadRange(secondary, { from: earliest }); // cache an ETH secondary
        expect(store.get(secKey)).toBeDefined();

        await cf.load(main); // re-run, same chart symbol
        expect(store.get(secKey)).toBeDefined(); // secondary survives the re-run

        await cf.load({ ...main, symbol: 'SOLUSDT' }); // chart symbol changes
        expect(store.get(secKey)).toBeUndefined(); // now dropped
    });
});

describe('BarStore', () => {
    it('merges by time (incoming wins) and stays sorted', () => {
        const store = new BarStore();
        store.merge('k', [{ time: 3, open: 1, high: 1, low: 1, close: 1, volume: 0 }, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
        store.merge('k', [{ time: 2, open: 1, high: 1, low: 1, close: 1, volume: 0 }, { time: 3, open: 9, high: 9, low: 9, close: 9, volume: 0 }]);
        const out = store.get('k')!;
        expect(times(out)).toEqual([1, 2, 3]);
        expect(out[2]!.close).toBe(9); // incoming overwrote time=3
    });

    it('retainSymbol evicts other symbols, keeps the current symbol across timeframes', () => {
        const store = new BarStore();
        const bar = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
        store.merge(seriesKey('binance', 'BTCUSDT', '60'), [bar]);
        store.merge(seriesKey('binance', 'BTCUSDT', '15'), [bar]);
        store.merge(seriesKey('binance', 'ETHUSDT', '60'), [bar]);

        store.retainSymbol('BTCUSDT');
        expect(store.get(seriesKey('binance', 'BTCUSDT', '60'))).toBeDefined();
        expect(store.get(seriesKey('binance', 'BTCUSDT', '15'))).toBeDefined(); // other tf of same symbol kept
        expect(store.get(seriesKey('binance', 'ETHUSDT', '60'))).toBeUndefined();
    });

    it('retainSymbol is idempotent per symbol — keeps cross-symbol series added after it', () => {
        const store = new BarStore();
        const bar = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
        store.retainSymbol('BTCUSDT'); // chart symbol set
        // an ETH secondary fetched during the run, AFTER retainSymbol:
        store.merge(seriesKey('binance', 'ETHUSDT', '240'), [bar]);

        store.retainSymbol('BTCUSDT'); // a re-run of the same chart → must NOT purge the secondary
        expect(store.get(seriesKey('binance', 'ETHUSDT', '240'))).toBeDefined();

        store.retainSymbol('SOLUSDT'); // chart symbol actually changes → drop the secondary
        expect(store.get(seriesKey('binance', 'ETHUSDT', '240'))).toBeUndefined();
    });
});

describe('session-keyed series (RTH vs ETH are different bars)', () => {
    it('seriesKey keys extended apart and leaves regular/absent on the legacy key', () => {
        expect(seriesKey('edgx', 'AAPL', '60')).toBe('edgx|AAPL|60');
        expect(seriesKey('edgx', 'AAPL', '60', 'regular')).toBe('edgx|AAPL|60'); // default = keyless
        expect(seriesKey('edgx', 'AAPL', '60', 'extended')).toBe('edgx|AAPL|60|extended');
    });

    it('the two sessions never share cached bars, and the flag reaches the inner feed', async () => {
        const { feed, store, cf } = setup(600);
        const regular = await cf.load({ symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500 });
        // Extended is a COLD series of its own — a fresh full load, not the cached regular bars.
        const callsAfterRegular = feed.loadCalls;
        const extended = await cf.load({ symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500, session: 'extended' });
        expect(feed.loadCalls).toBe(callsAfterRegular + 1);
        expect(times(extended)).toEqual(times(regular)); // same fake universe...
        expect(store.get(seriesKey('binance', 'BTCUSDT', '60'))).toBeDefined();
        expect(store.get(seriesKey('binance', 'BTCUSDT', '60', 'extended'))).toBeDefined(); // ...two series
    });
});
