import { describe, it, expect, vi } from 'vitest';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { DataControl } from '../src/core/DataControl';
import { BarStore, seriesKey } from '../src/data/BarStore';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function makeBars(n: number): OHLCV[] {
    const bars: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        const price = 100 + Math.sin(i / 4) * 5;
        bars.push({ time: 1_700_000_000_000 + i * 3_600_000, open: price, high: price + 1, low: price - 1, close: price, volume: 1 });
    }
    return bars;
}

const up = (s: string): string => s.toUpperCase();

/**
 * A neutral fake provider. `served` = tickers `getBars` returns data for; `list` =
 * what `listSymbols` enumerates (defaults to `served`, so they can differ — to test
 * explicit-prefix routing to an un-indexed ticker). `enumerate:false` omits
 * `listSymbols` entirely (an un-enumerable provider).
 */
function fakeProvider(served: string[], opts: { list?: string[]; enumerate?: boolean; symInfo?: Record<string, unknown>; throws?: boolean } = {}) {
    const calls: Array<{ ticker: string; tf: string }> = [];
    const list = opts.list ?? served;
    const provider: DataProvider = {
        getBars(ticker, tf, range) {
            calls.push({ ticker, tf });
            if (opts.throws) return Promise.reject(new Error('boom'));
            if (!served.map(up).includes(up(ticker))) return Promise.resolve([]);
            return Promise.resolve(makeBars(range.limit ?? 10));
        },
    };
    if (opts.enumerate !== false) provider.listSymbols = () => Promise.resolve(list.map((t) => ({ ticker: t })));
    if (opts.symInfo) provider.getSymbolInfo = (ticker) => Promise.resolve({ ticker, ...opts.symInfo });
    return { provider, calls };
}

describe('MultiProviderFeed — parked load lifecycle', () => {
    it('parks load() until a provider that resolves the symbol is registered', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const p = feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 10 });

        let resolved = false;
        void p.then(() => (resolved = true));
        await flush();
        expect(resolved).toBe(false); // no provider yet → parked

        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        const bars = await p;
        expect(bars.length).toBe(10);
    });

    it('with multiple providers + a bare symbol, renders via the FIRST supporting provider (others skipped)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        const binance = fakeProvider(['BTCUSDT', 'ETHUSDT']); // no AAPL
        const fmp = fakeProvider(['AAPL', 'MSFT']); // has AAPL

        const p = feed.load({ symbol: 'AAPL', timeframe: '60', bars: 5 });
        feed.registerProvider('binance', binance.provider);
        feed.registerProvider('fmp', fmp.provider);

        const bars = await p;
        expect(bars.length).toBe(5);
        expect(fmp.calls.some((c) => up(c.ticker) === 'AAPL')).toBe(true); // fetched from FMP
        expect(binance.calls.some((c) => up(c.ticker) === 'AAPL')).toBe(false); // never a doomed load on Binance
        warn.mockRestore();
    });

    it('resolution is registration-order-independent (right provider wins regardless of order)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        const fmp = fakeProvider(['AAPL']);
        const binance = fakeProvider(['BTCUSDT']);

        const p = feed.load({ symbol: 'AAPL', timeframe: '60', bars: 4 });
        feed.registerProvider('fmp', fmp.provider); // supporting provider registered FIRST this time
        feed.registerProvider('binance', binance.provider);

        const bars = await p;
        expect(bars.length).toBe(4);
        expect(fmp.calls.some((c) => up(c.ticker) === 'AAPL')).toBe(true);
        warn.mockRestore();
    });

    it('stays parked and warns when no registered provider supports the symbol, then resolves once one does', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        const p = feed.load({ symbol: 'AAPL', timeframe: '60', bars: 5 });

        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        await feed.ready(); // binance indexed; AAPL absent

        let resolved = false;
        void p.then(() => (resolved = true));
        await flush();
        expect(resolved).toBe(false); // still parked — lone provider doesn't serve AAPL
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('AAPL'));

        feed.registerProvider('fmp', fakeProvider(['AAPL']).provider);
        const bars = await p;
        expect(bars.length).toBe(5);
        warn.mockRestore();
    });

    it('an explicit prefix resolves without waiting for the eager index to finish building', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        // listSymbols never resolves → the index never settles; the prefix must not wait on it.
        const provider: DataProvider = {
            getBars: (_t, _tf, r) => Promise.resolve(makeBars(r.limit ?? 6)),
            listSymbols: () => new Promise<never>(() => {}),
        };
        const p = feed.load({ symbol: 'binance:BTCUSDT', timeframe: '60', bars: 6 });
        feed.registerProvider('binance', provider);
        const bars = await p;
        expect(bars.length).toBe(6);
    });

    it('offline `data` loads immediately with no provider registered', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const data = makeBars(6);
        const bars = await feed.load({ data });
        expect(bars).toEqual(data);
    });
});

describe('a parked load is REPORTED and RELEASABLE (never a silent, leaking wait)', () => {
    it('reports the unservable symbol once the provider index settles', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const seen: Array<{ symbol: string; providers: string[] }> = [];
        feed.onUnresolved((info) => seen.push(info));
        void feed.load({ symbol: 'NOPE', timeframe: '60', bars: 10 });
        await feed.registerProvider('hyperliquid', fakeProvider(['BTC']).provider);
        await flush();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toEqual({ symbol: 'NOPE', providers: ['hyperliquid'] });
    });

    it('waits for EVERY index before declaring a symbol unservable', async () => {
        // With several providers, the first index to settle is usually not the one that serves
        // the symbol. Reporting there is a false verdict the user sees as an error on a symbol
        // that resolves a moment later.
        const feed = new MultiProviderFeed(new BarStore());
        const seen: string[] = [];
        feed.onUnresolved((i) => seen.push(i.symbol));

        let releaseSlow: (() => void) | null = null;
        const slow: DataProvider = {
            getBars: (_t, _tf, range) => Promise.resolve(makeBars(range.limit ?? 10)),
            listSymbols: () =>
                new Promise((res) => {
                    releaseSlow = () => res([{ ticker: 'BTC' }]);
                }),
        };

        void feed.load({ symbol: 'BTC', timeframe: '60', bars: 10 });
        feed.registerProvider('slow', slow);
        await feed.registerProvider('fast', fakeProvider(['ETHUSDT']).provider); // settles first, has no BTC
        await flush();
        expect(seen).toEqual([]); // the slow venue may still serve it — no verdict yet

        releaseSlow!();
        await flush();
        expect(seen).toEqual([]); // …and it did serve it: never reported at all
    });

    it('still reports once the LAST index settles with nothing serving the symbol', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const seen: string[] = [];
        feed.onUnresolved((i) => seen.push(i.symbol));
        void feed.load({ symbol: 'NOPE', timeframe: '60', bars: 10 });
        await feed.registerProvider('a', fakeProvider(['BTC']).provider);
        await feed.registerProvider('b', fakeProvider(['ETH']).provider);
        await flush();
        expect(seen).toContain('NOPE');
    });

    it('destroy() drops the parked wait, so a rebuilt chart leaves nothing behind', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const seen: string[] = [];
        feed.onUnresolved((i) => seen.push(i.symbol));
        void feed.load({ symbol: 'NOPE', timeframe: '60', bars: 10 });
        await feed.registerProvider('a', fakeProvider(['BTC']).provider);
        await flush();
        const before = seen.length;
        expect(before).toBeGreaterThan(0);

        feed.destroy(); // the chart went away — its wait must go with it
        await feed.registerProvider('b', fakeProvider(['ETH']).provider);
        await flush();
        expect(seen.length).toBe(before); // no listener left to re-report
    });

    it('a parked load still resumes when a capable provider registers', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        let bars = 0;
        void feed.load({ symbol: 'BTC', timeframe: '60', bars: 10 }).then((b) => (bars = b.length));
        await flush();
        expect(bars).toBe(0);
        await feed.registerProvider('hyperliquid', fakeProvider(['BTC']).provider);
        await flush();
        expect(bars).toBeGreaterThan(0);
    });
});

describe('venue resolution: declaration order for bare symbols, an EXCHANGE: prefix to pin one', () => {
    it('a bare symbol resolves via whatever registered venue lists it', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('hyperliquid', fakeProvider(['BTC']).provider);
        const bars = await feed.load({ symbol: 'BTC', timeframe: '60', bars: 10 });
        expect(bars.length).toBeGreaterThan(0);
        expect(feed.resolveSymbol('BTC')).toEqual({ provider: 'hyperliquid', ticker: 'BTC' });
    });

    it('an ambiguous bare symbol goes to the FIRST DECLARED venue that lists it', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const hl = fakeProvider(['BTC']);
        const bn = fakeProvider(['BTC']);
        await feed.registerProvider('hyperliquid', hl.provider); // declared FIRST
        await feed.registerProvider('binance', bn.provider);
        // Both index BTC; declaration order decides who serves it.
        await feed.load({ symbol: 'BTC', timeframe: '60', bars: 10 });
        expect(hl.calls.length).toBe(1);
        expect(bn.calls.length).toBe(0);
    });

    it('an EXCHANGE: prefix pins the venue, beating declaration order', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const hl = fakeProvider(['BTC']);
        const bn = fakeProvider(['BTC']);
        await feed.registerProvider('hyperliquid', hl.provider); // declared FIRST
        await feed.registerProvider('binance', bn.provider);
        await feed.load({ symbol: 'binance:BTC', timeframe: '60', bars: 10 });
        expect(bn.calls.length).toBe(1); // the pinned venue served…
        expect(hl.calls.length).toBe(0); // …and declaration order never entered it
    });

    it('a first-declared venue that does not LIST the symbol steps aside', async () => {
        // The cross-venue pick: the chart lives on binance, the user picks a ticker only
        // another venue lists. Binance is declared first and healthy — it simply does not
        // list this ticker, so it must not capture the request (that produced a blank
        // chart labelled with the wrong venue).
        const feed = new MultiProviderFeed(new BarStore());
        const bn = fakeProvider(['BTCUSDT']);
        const hl = fakeProvider(['BTC']);
        await feed.registerProvider('binance', bn.provider);
        await feed.registerProvider('hyperliquid', hl.provider);

        const bars = await feed.load({ symbol: 'BTC', timeframe: '60', bars: 10 });
        expect(bars.length).toBeGreaterThan(0);
        expect(hl.calls.length).toBe(1); // the venue that LISTS it served it…
        expect(bn.calls.length).toBe(0); // …first-declared but unlisting was never asked
        expect(feed.resolveSymbol('BTC')).toEqual({ provider: 'hyperliquid', ticker: 'BTC' });
    });

    it('an in-place switch to another venue is not poisoned by the first load', async () => {
        // `primaryProvider` is latched on the first load; a later switch to a symbol only
        // another venue serves must still resolve there, or every venue change after the first
        // would silently fall back to the chart's original provider.
        const feed = new MultiProviderFeed(new BarStore());
        const bn = fakeProvider(['BTCUSDT']);
        const cb = fakeProvider(['BTC-USD']);
        await feed.registerProvider('binance', bn.provider);
        await feed.registerProvider('coinbase', cb.provider);

        await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 10 });
        const after = await feed.load({ symbol: 'BTC-USD', timeframe: '60', bars: 10 });
        expect(after.length).toBeGreaterThan(0);
        expect(cb.calls.map((c) => c.ticker)).toEqual(['BTC-USD']);
        expect(bn.calls.map((c) => c.ticker)).toEqual(['BTCUSDT']); // binance served only its own
    });

    it('a bare secondary symbol follows the venue the chart switched TO', async () => {
        // `primaryProvider` is the default for bare symbols (request.security, metadata and
        // capability probes). Latching it on the FIRST load pinned every later probe to the venue
        // the chart happened to open on, so after a venue switch they answered for the old one.
        const feed = new MultiProviderFeed(new BarStore());
        const bn = fakeProvider(['BTCUSDT', 'ETHUSDT']);
        const cb = fakeProvider(['BTCUSDT', 'ETHUSDT']); // both list both tickers
        await feed.registerProvider('binance', bn.provider);
        await feed.registerProvider('coinbase', cb.provider);

        await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 10 });
        await feed.load({ symbol: 'coinbase:BTCUSDT', timeframe: '60', bars: 10 }); // venue switch (prefix pins it)

        await feed.loadRange({ symbol: 'ETHUSDT', timeframe: '60' }, { limit: 5 }); // bare secondary
        expect(cb.calls.map((c) => c.ticker)).toContain('ETHUSDT'); // the venue on screen serves it
        expect(bn.calls.map((c) => c.ticker)).not.toContain('ETHUSDT');
    });

    it('an EXPLICIT prefix in the symbol stays a hard requirement (parks until it registers)', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('hyperliquid', fakeProvider(['BTC']).provider);
        let settled = false;
        void feed.load({ symbol: 'binance:BTC', timeframe: '60', bars: 10 }).then(() => (settled = true));
        await flush();
        expect(settled).toBe(false); // the caller NAMED binance — waiting for it is correct
        await feed.registerProvider('binance', fakeProvider(['BTC']).provider);
        await flush();
        expect(settled).toBe(true);
    });
});

describe('MultiProviderFeed — resolution + cache identity', () => {
    it('collapses bare, prefixed, and legacy-provider forms to one canonical identity', async () => {
        const store = new BarStore();
        const feed = new MultiProviderFeed(store);
        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        await feed.ready();

        const canon = { provider: 'binance', ticker: 'BTCUSDT' };
        expect(feed.resolveSymbol('BTCUSDT')).toEqual(canon);
        expect(feed.resolveSymbol('BINANCE:BTCUSDT')).toEqual(canon);
        expect(feed.resolveSymbol('binance:BTCUSDT')).toEqual(canon);

        // a load keys the cache on the resolved identity, so the prefixed form reuses it
        await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 10 });
        expect(store.get(seriesKey('binance', 'BTCUSDT', '60'))).toBeDefined();
    });

    it('routes an explicit prefix even to a ticker the index does not list', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const binance = fakeProvider(['BTCUSDT', 'ETHUSDT'], { list: ['BTCUSDT'] }); // serves ETH, lists only BTC
        feed.registerProvider('binance', binance.provider);
        await feed.ready();

        const bars = await feed.load({ symbol: 'binance:ETHUSDT', timeframe: '60', bars: 8 });
        expect(bars.length).toBe(8);
        expect(binance.calls.some((c) => up(c.ticker) === 'ETHUSDT')).toBe(true);
    });

    it('resolveSymbol returns null for an unknown provider prefix', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        await feed.ready();
        expect(feed.resolveSymbol('NASDAQ:AAPL')).toBeNull();
    });

    it('an EXCHANGE:-prefixed symbol resolves immediately (no index wait)', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const binance = fakeProvider(['BTCUSDT']);
        feed.registerProvider('binance', binance.provider);
        await feed.ready();

        const bars = await feed.load({ symbol: 'binance:BTCUSDT', timeframe: '60', bars: 9 });
        expect(bars.length).toBe(9);
    });
});

describe('DataControl facade', () => {
    it('delegates registration to the MultiProviderFeed', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const data = new DataControl(feed);
        data.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        await data.ready();
        expect(data.providers().map((p) => p.name)).toContain('binance');
        expect(data.resolve('BTCUSDT')).toEqual({ provider: 'binance', ticker: 'BTCUSDT' });
    });

    it('warns and no-ops when the active feed is a custom (non-registry) feed', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const custom: MarketDataFeed = { load: () => Promise.resolve([]), subscribe: () => () => {} };
        const data = new DataControl(custom);
        data.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('custom feed'));
        expect(data.providers()).toEqual([]);
        expect(data.resolve('BTCUSDT')).toBeNull();
        warn.mockRestore();
    });
});

describe('MultiProviderFeed — unregister, secondary series, symbolInfo, resilience', () => {
    it('unregisterProvider removes the provider and makes its symbols unresolvable', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        await feed.ready();
        expect(feed.resolveSymbol('BTCUSDT')).toEqual({ provider: 'binance', ticker: 'BTCUSDT' });

        feed.unregisterProvider('binance');
        expect(feed.resolveSymbol('BTCUSDT')).toBeNull();
        expect(feed.providers()).toEqual([]);
    });

    it('DataControl.unregisterProvider is chainable and clears resolution', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const data = new DataControl(feed);
        expect(data.registerProvider('binance', fakeProvider(['BTCUSDT']).provider)).toBe(data);
        await data.ready();
        expect(data.unregisterProvider('binance')).toBe(data);
        expect(data.resolve('BTCUSDT')).toBeNull();
    });

    it('loadRange (secondary series) resolves each symbol independently with the primary as bare default', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const binance = fakeProvider(['BTCUSDT', 'ETHUSDT']);
        const fmp = fakeProvider(['AAPL']);
        feed.registerProvider('binance', binance.provider);
        feed.registerProvider('fmp', fmp.provider);
        await feed.ready();
        // establish the primary provider via a primary load
        await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 5 });

        const aapl = await feed.loadRange({ symbol: 'AAPL', timeframe: '240' }, { from: 1 });
        expect(aapl.length).toBeGreaterThan(0);
        expect(fmp.calls.some((c) => up(c.ticker) === 'AAPL')).toBe(true);

        const eth = await feed.loadRange({ symbol: 'binance:ETHUSDT', timeframe: '240' }, { from: 1 });
        expect(eth.length).toBeGreaterThan(0);

        // a bare secondary the primary (binance) serves routes to binance, not fmp
        const bareEth = await feed.loadRange({ symbol: 'ETHUSDT', timeframe: '240' }, { from: 1 });
        expect(bareEth.length).toBeGreaterThan(0);
        expect(binance.calls.some((c) => up(c.ticker) === 'ETHUSDT')).toBe(true);

        // unresolvable secondary → empty (engine degrades), never throws
        expect(await feed.loadRange({ symbol: 'NASDAQ:AAPL', timeframe: '240' }, { from: 1 })).toEqual([]);
    });

    it('warms sync symbolInfo from the provider on load, and serves it via the facade', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('binance', fakeProvider(['BTCUSDT'], { symInfo: { mintick: 0.5, pricescale: 2 } }).provider);
        await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 5 });
        await flush(); // let the fire-and-forget prefetch land

        expect(feed.symbolInfo({ symbol: 'BTCUSDT', timeframe: '60' })).toMatchObject({ ticker: 'BTCUSDT', mintick: 0.5 });
        expect(await new DataControl(feed).symbolInfo('BINANCE:BTCUSDT')).toMatchObject({ mintick: 0.5 });
        expect(feed.symbolInfo({ symbol: 'NASDAQ:AAPL', timeframe: '60' })).toBeUndefined();
    });

    it('a throwing provider yields an empty result + warning, not a rejected load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('binance', fakeProvider(['BTCUSDT'], { throws: true }).provider);
        const bars = await feed.load({ symbol: 'BTCUSDT', timeframe: '60', bars: 5 });
        expect(bars).toEqual([]); // did not reject
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('data fetch failed'));
        warn.mockRestore();
    });

    it('synthesizes offline ticks and stops cleanly on unsubscribe', async () => {
        vi.useFakeTimers();
        try {
            const feed = new MultiProviderFeed(new BarStore());
            const data = makeBars(5);
            await feed.load({ data });
            let ticks = 0;
            const stop = feed.subscribe({ data, timeframe: '60' }, () => { ticks += 1; });
            await vi.advanceTimersByTimeAsync(1100);
            expect(ticks).toBeGreaterThan(0);
            stop();
            const after = ticks;
            await vi.advanceTimersByTimeAsync(3000);
            expect(ticks).toBe(after); // unsubscribe fully detached
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('ProviderRegistry — dotted provider prefixes', () => {
    it('routes a dotted-qualifier prefix (regional venue) and keeps the market suffix on the ticker', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const us = fakeProvider(['BTCUSDT']);
        const com = fakeProvider(['BTCUSDT', 'BTCUSDT.P']);
        await feed.registerProvider('binance', com.provider);
        await feed.registerProvider('binance.us', us.provider);

        expect(feed.resolveSymbol('BINANCE.US:BTCUSDT')).toEqual({ provider: 'binance.us', ticker: 'BTCUSDT' });
        expect(feed.resolveSymbol('BINANCE:BTCUSDT.P')).toEqual({ provider: 'binance', ticker: 'BTCUSDT.P' });
        expect(feed.resolveSymbol('binance.us:btcusdt')?.provider).toBe('binance.us'); // case-insensitive prefix
        expect(feed.resolveSymbol('BTCUSDT.P')?.provider).toBe('binance'); // bare + suffix: index resolution unaffected
    });
});

describe('DataControl.capabilities', () => {
    it('exposes the resolved per-symbol capability record (null while unresolvable)', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const dc = new DataControl(feed);
        expect(dc.capabilities('nope:NOPE')).toBeNull();
        const provider: DataProvider = {
            getBars: () => Promise.resolve([]),
            listSymbols: () => Promise.resolve([{ ticker: 'TEST' }]),
            info: () => ({ name: 'x', capabilities: { enumerate: true, stream: false, symbolInfo: false } }),
        };
        await feed.registerProvider('x', provider);
        expect(dc.capabilities('x:TEST')?.enumerate).toBe(true);
        expect(dc.capabilities('x:TEST')?.stream).toBe(false);
    });
});

describe('providerInstance (extended-surface seam)', () => {
    it('returns the registered instance so consumers can narrow extra interfaces', async () => {
        const feed = new MultiProviderFeed();
        const provider = {
            getBars: async () => [],
            // an EXTENDED surface beyond the DataProvider port (capability narrowing)
            getFootprints: async () => ['slice'],
        };
        await feed.registerProvider('lux', provider as never);
        const got = feed.providerInstance('lux');
        expect(got).toBe(provider);
        const extended = got as { getFootprints?: () => Promise<string[]> };
        expect(typeof extended.getFootprints).toBe('function');
        expect(await extended.getFootprints!()).toEqual(['slice']);
        expect(feed.providerInstance('nope')).toBeUndefined();
    });
});

describe('poll-fallback live ticks (a provider without subscribe)', () => {
    it('a poll in flight when unsubscribe lands must NOT deliver its stale bars', async () => {
        vi.useFakeTimers();
        try {
            // Gate getBars so the poll's fetch is IN FLIGHT when the test unsubscribes —
            // the market-switch race: stale old-market bars arriving after the switch
            // would silently replace the new market's forming candle (same open time).
            let release: (() => void) | null = null;
            const provider: DataProvider = {
                getBars: () =>
                    new Promise((resolve) => {
                        release = () => resolve(makeBars(2));
                    }),
                listSymbols: () => Promise.resolve([{ ticker: 'AAA' }]),
            };
            const feed = new MultiProviderFeed(new BarStore());
            await feed.registerProvider('p', provider);
            let ticks = 0;
            const stop = feed.subscribe({ symbol: 'AAA', timeframe: '60' }, () => { ticks += 1; });
            await vi.advanceTimersByTimeAsync(3100); // first poll fires → getBars parks on the gate
            expect(release).not.toBeNull();
            stop(); // the market switches away while the fetch is in flight
            release!();
            await vi.advanceTimersByTimeAsync(10);
            expect(ticks).toBe(0); // the stale bars were dropped, never delivered
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('listing-prefix resolution (TradingView parity)', () => {
    /** One provider serving a US-equities tape: descriptors carry the LISTING prefix. */
    function equitiesProvider() {
        const provider: DataProvider = {
            getBars: (_t, _tf, range) => Promise.resolve(makeBars(range.limit ?? 10)),
            listSymbols: () =>
                Promise.resolve([
                    { ticker: 'AAPL', type: 'stock', prefix: 'NASDAQ' },
                    { ticker: 'IBM', type: 'stock', prefix: 'NYSE' },
                    { ticker: 'SPY', type: 'stock', prefix: 'AMEX' },
                ]),
        };
        return provider;
    }

    async function boot() {
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('binance', fakeProvider(['BTCUSDT']).provider);
        feed.registerProvider('edgx', equitiesProvider());
        await feed.ready();
        return feed;
    }

    it('PREFIX:TICKER resolves through the descriptor prefix to the serving provider', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('NASDAQ:AAPL')).toEqual({ provider: 'edgx', ticker: 'AAPL' });
        // Case-insensitive, and the resolved ticker takes the DESCRIPTOR spelling.
        expect(feed.resolveSymbol('nyse:ibm')).toEqual({ provider: 'edgx', ticker: 'IBM' });
    });

    it('is TradingView-STRICT: a wrong listing venue resolves to nothing, never auto-corrects', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('NYSE:AAPL')).toBeNull();
    });

    it('the provider name still routes (persisted `edgx:AAPL` documents keep resolving)', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('edgx:AAPL')).toEqual({ provider: 'edgx', ticker: 'AAPL' });
    });

    it('display prefix and canonical form come from the DATA; provider-name fallback for crypto', async () => {
        const feed = await boot();
        expect(feed.displayPrefix('AAPL')).toBe('NASDAQ'); //          bare pick re-displays canonical
        expect(feed.displayPrefix('edgx:AAPL')).toBe('NASDAQ'); //     legacy spelling re-displays canonical
        expect(feed.canonicalSymbol('edgx:ibm')).toBe('NYSE:IBM');
        expect(feed.displayPrefix('BTCUSDT')).toBe('binance'); //      no prefix declared -> provider name
        expect(feed.canonicalSymbol('BTCUSDT')).toBe('binance:BTCUSDT');
        expect(feed.displayPrefix('NOPE:NOPE')).toBeNull();
    });
});

describe('session flag propagation (provider seam)', () => {
    it('rides getBars ranges (load, loadRange, poll) and the subscribe opts', async () => {
        const ranges: Array<Record<string, unknown>> = [];
        const subOpts: unknown[] = [];
        const provider: DataProvider = {
            getBars(_t, _tf, range) {
                ranges.push({ ...range });
                return Promise.resolve(makeBars(range.limit ?? 10));
            },
            listSymbols: () => Promise.resolve([{ ticker: 'AAPL', prefix: 'NASDAQ' }]),
            subscribe(_t, _tf, _onBar, opts) {
                subOpts.push(opts);
                return () => {};
            },
        };
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('edgx', provider);
        await feed.ready();

        await feed.load({ symbol: 'NASDAQ:AAPL', timeframe: '60', bars: 5, session: 'extended' });
        expect(ranges[ranges.length - 1]!.session).toBe('extended');

        await feed.loadRange!({ symbol: 'NASDAQ:AAPL', timeframe: '60', session: 'extended' }, { from: 0, limit: 5 });
        expect(ranges[ranges.length - 1]).toMatchObject({ from: 0, session: 'extended' });

        const off = feed.subscribe({ symbol: 'NASDAQ:AAPL', timeframe: '60', session: 'extended' }, () => {});
        off();
        expect(subOpts).toEqual([{ session: 'extended' }]);

        // No session set -> nothing invented: the flag is simply absent.
        await feed.load({ symbol: 'NASDAQ:AAPL', timeframe: '60', bars: 5 });
        expect(ranges[ranges.length - 1]!.session).toBeUndefined();
        const off2 = feed.subscribe({ symbol: 'NASDAQ:AAPL', timeframe: '60' }, () => {});
        off2();
        expect(subOpts[1]).toBeUndefined();
    });
});

describe('symbol icons — routed to the OWNING provider (resolveSymbolIcon)', () => {
    const withIcons = (served: string[], url: (t: string) => string | undefined) => {
        const { provider } = fakeProvider(served);
        provider.resolveSymbolIcon = (d) => url(d.ticker);
        return provider;
    };

    it('symbolIconOf routes a descriptor to ITS provider; absent resolver ⇒ undefined', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('binance', withIcons(['BTCUSDT'], (t) => `https://icons.example/${t}.png`));
        await feed.registerProvider('plain', fakeProvider(['AAPL']).provider); // no resolver
        await flush();
        expect(feed.symbolIconOf({ ticker: 'BTCUSDT', provider: 'binance' })).toBe('https://icons.example/BTCUSDT.png');
        expect(feed.symbolIconOf({ ticker: 'AAPL', provider: 'plain' })).toBeUndefined();
        expect(feed.symbolIconOf({ ticker: 'X', provider: 'ghost' })).toBeUndefined(); // unknown provider
    });

    it('symbolIcon resolves a RAW string (prefix or bare) then routes — and hands the resolver the indexed descriptor', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const { provider } = fakeProvider(['BTCUSDT']);
        const seen: unknown[] = [];
        provider.resolveSymbolIcon = (d) => {
            seen.push(d);
            return `u/${d.ticker}`;
        };
        await feed.registerProvider('binance', provider);
        await flush();
        expect(feed.symbolIcon('binance:BTCUSDT')).toBe('u/BTCUSDT');
        expect(feed.symbolIcon('BTCUSDT')).toBe('u/BTCUSDT'); // bare — declaration order
        expect(feed.symbolIcon('nope:NOTHING')).toBeUndefined(); // unresolvable ⇒ initials upstream
        expect((seen[0] as { provider?: string }).provider).toBe('binance'); // the registry-annotated descriptor
    });

    it('a resolver that THROWS means "no icon", never an error', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const { provider } = fakeProvider(['ETHUSDT']);
        provider.resolveSymbolIcon = () => {
            throw new Error('bad resolver');
        };
        await feed.registerProvider('binance', provider);
        await flush();
        expect(feed.symbolIcon('ETHUSDT')).toBeUndefined();
    });

    it('DataControl.symbolIcon delegates (and no-ops on a custom feed)', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('binance', withIcons(['BTCUSDT'], () => 'u/icon.png'));
        await flush();
        expect(new DataControl(feed).symbolIcon('BTCUSDT')).toBe('u/icon.png');
        expect(new DataControl({} as MarketDataFeed).symbolIcon('BTCUSDT')).toBeUndefined();
    });
});

describe('grouped listings (futures roots)', () => {
    /** A futures-shaped venue: one GROUP row per root, then its continuous members. */
    function futuresProvider() {
        const provider: DataProvider = {
            getBars: (_t, _tf, range) => Promise.resolve(makeBars(range.limit ?? 10)),
            listSymbols: () =>
                Promise.resolve([
                    { ticker: 'ES', type: 'root', group: 'ES', prefix: 'CME' },
                    { ticker: 'ES1!', type: 'futures', group: 'ES', prefix: 'CME', default: true },
                    { ticker: 'ES2!', type: 'futures', group: 'ES', prefix: 'CME' },
                    { ticker: 'NQ', type: 'root', group: 'NQ', prefix: 'CME' },
                    { ticker: 'NQ1!', type: 'futures', group: 'NQ', prefix: 'CME' }, // no default marked
                    { ticker: 'NQ2!', type: 'futures', group: 'NQ', prefix: 'CME' },
                ]),
        };
        return provider;
    }

    async function boot() {
        const feed = new MultiProviderFeed(new BarStore());
        feed.registerProvider('lux', futuresProvider());
        await feed.ready();
        return feed;
    }

    it('a bare ROOT resolves to the group default member — roots are listed, never loadable', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('ES')).toEqual({ provider: 'lux', ticker: 'ES1!' });
    });

    it('the listing-prefix form translates too (CME:ES → the default member)', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('CME:ES')).toEqual({ provider: 'lux', ticker: 'ES1!' });
    });

    it('the explicit provider-name form translates too (lux:ES)', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('lux:ES')).toEqual({ provider: 'lux', ticker: 'ES1!' });
    });

    it('no default marked → the FIRST listed member', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('NQ')).toEqual({ provider: 'lux', ticker: 'NQ1!' });
    });

    it('member tickers pass through untouched', async () => {
        const feed = await boot();
        expect(feed.resolveSymbol('ES2!')).toEqual({ provider: 'lux', ticker: 'ES2!' });
        expect(feed.resolveSymbol('CME:ES2!')).toEqual({ provider: 'lux', ticker: 'ES2!' });
    });
});
