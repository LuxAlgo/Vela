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

    it('legacy cfg.provider acts as an explicit prefix for a bare symbol', async () => {
        const feed = new MultiProviderFeed(new BarStore());
        const binance = fakeProvider(['BTCUSDT']);
        feed.registerProvider('binance', binance.provider);
        await feed.ready();

        const bars = await feed.load({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '60', bars: 9 });
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
            const stop = feed.subscribe({ provider: 'p', symbol: 'AAA', timeframe: '60' }, () => { ticks += 1; });
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
