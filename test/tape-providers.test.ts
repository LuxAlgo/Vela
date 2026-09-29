import { describe, it, expect, vi, afterEach } from 'vitest';
import { BinanceProvider, aggTradesToTrades } from '../src/data/providers/binance/BinanceProvider';
import { CoinbaseProvider, coinbaseTradesToTrades } from '../src/data/providers/coinbase/CoinbaseProvider';
import { HyperliquidProvider, hyperliquidTradesToTrades } from '../src/data/providers/hyperliquid/HyperliquidProvider';

const MIN = 60_000;

afterEach(() => { vi.unstubAllGlobals(); });

/** A JSON response carrying `headers` (the walks read pagination/weight headers). */
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...init.headers },
    });
}

describe('aggressor side — the one field every order-flow reading is signed by', () => {
    it('Binance: `m` is whether the BUYER was the maker, so it inverts', () => {
        expect(aggTradesToTrades([
            { a: 1, p: '100.5', q: '2', T: 1_000, m: false }, // buyer took the ask
            { a: 2, p: '100.4', q: '3', T: 1_001, m: true }, // buyer rested; a seller hit it
        ])).toEqual([
            { time: 1_000, price: 100.5, size: 2, side: 'buy', id: '1' },
            { time: 1_001, price: 100.4, size: 3, side: 'sell', id: '2' },
        ]);
    });

    it('Coinbase: `side` is the MAKER order side, so it inverts', () => {
        expect(coinbaseTradesToTrades([
            { trade_id: 7, time: '2024-01-01T00:00:00.000Z', price: '100', size: '1', side: 'buy' },
            { trade_id: 8, time: '2024-01-01T00:00:01.000Z', price: '101', size: '2', side: 'sell' },
        ])).toEqual([
            { time: Date.parse('2024-01-01T00:00:00.000Z'), price: 100, size: 1, side: 'sell', id: '7' },
            { time: Date.parse('2024-01-01T00:00:01.000Z'), price: 101, size: 2, side: 'buy', id: '8' },
        ]);
    });

    it('Hyperliquid: `side` is already the AGGRESSOR, so it does not invert', () => {
        expect(hyperliquidTradesToTrades([
            { coin: 'BTC', side: 'B', px: '100', sz: '1', time: 5, tid: 11 },
            { coin: 'BTC', side: 'A', px: '99', sz: '2', time: 6, tid: 12 },
        ])).toEqual([
            { time: 5, price: 100, size: 1, side: 'buy', id: '11' },
            { time: 6, price: 99, size: 2, side: 'sell', id: '12' },
        ]);
    });

    it('drops rows whose price, size or time will not parse', () => {
        expect(coinbaseTradesToTrades([
            { trade_id: 1, time: 'not a date', price: '1', size: '1', side: 'buy' },
            { trade_id: 2, time: '2024-01-01T00:00:00Z', price: 'x', size: '1', side: 'buy' },
            { trade_id: 3, time: '2024-01-01T00:00:00Z', price: '1', size: '1', side: 'buy' },
        ]).map((t) => t.id)).toEqual(['3']);
        expect(hyperliquidTradesToTrades([{ coin: 'BTC', side: 'B', px: 'nope', sz: '1', time: 1 }])).toEqual([]);
    });
});

describe('Binance tape walk', () => {
    /** Stub fetch: `/ping` is answered ok, `/aggTrades` from `pages`, in order. */
    function stubWalk(pages: Array<Array<{ a: number; p: string; q: string; T: number; m: boolean }>>): string[] {
        const urls: string[] = [];
        let page = 0;
        vi.stubGlobal('fetch', vi.fn((input: string) => {
            if (input.includes('/ping')) return Promise.resolve(jsonResponse({}));
            urls.push(input);
            return Promise.resolve(jsonResponse(pages[page++] ?? [], { headers: { 'x-mbx-used-weight-1m': '10' } }));
        }));
        return urls;
    }

    const row = (a: number, T: number, m = false) => ({ a, p: '100', q: '1', T, m });

    it('slices the window — the endpoint refuses a span of an hour or more', async () => {
        const urls = stubWalk([[row(1, 0)], [row(2, 60 * MIN)], [row(3, 115 * MIN)]]);
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: 120 * MIN });

        expect(urls).toHaveLength(3);
        const spans: Array<[number, number]> = urls.map((u) => {
            const q = new URL(u).searchParams;
            return [Number(q.get('startTime')), Number(q.get('endTime'))];
        });
        expect(spans[0]).toEqual([0, 55 * MIN - 1]);
        expect(spans[1]).toEqual([55 * MIN, 110 * MIN - 1]);
        expect(spans[2]).toEqual([110 * MIN, 120 * MIN]);
        for (const [start, end] of spans) expect(end - start).toBeLessThan(60 * MIN);
        expect(trades.map((t) => t.id)).toEqual(['1', '2', '3']);
    });

    it('pages a full slice by trade id — paging by time would loop on a busy millisecond', async () => {
        // A full page (1000 rows) all stamped the same millisecond: there is no later
        // `startTime` to advance to, so the only way forward is the next trade id.
        const full = Array.from({ length: 1000 }, (_, i) => row(i + 1, 1_000));
        const urls = stubWalk([full, [row(1001, 1_100)]]);
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: 10 * MIN });

        expect(new URL(urls[0]!).searchParams.get('fromId')).toBeNull();
        expect(new URL(urls[1]!).searchParams.get('fromId')).toBe('1001'); // last id + 1
        expect(trades).toHaveLength(1001);
    });

    it('stops as soon as a page runs past the requested window', async () => {
        const full = Array.from({ length: 1000 }, (_, i) => row(i + 1, 1_000));
        const urls = stubWalk([full, [row(1001, 99 * MIN)], [row(2001, 2_000)]]);
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: 10 * MIN });

        expect(urls).toHaveLength(2); // the third page is never asked for
        expect(trades).toHaveLength(1000); // the overshooting print is not kept
        expect(trades.every((t) => t.time <= 10 * MIN)).toBe(true);
    });

    it('de-duplicates by trade id and returns ascending', async () => {
        stubWalk([[row(2, 2_000), row(1, 1_000), row(2, 2_000)]]);
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: MIN });
        expect(trades.map((t) => t.id)).toEqual(['1', '2']);
    });

    it('keeps the NEWEST `limit` prints', async () => {
        stubWalk([[row(1, 1_000), row(2, 2_000), row(3, 3_000)]]);
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: MIN, limit: 2 });
        expect(trades.map((t) => t.id)).toEqual(['2', '3']);
    });

    it('gives up on a 418 ban instead of extending it', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn((input: string) => {
            if (input.includes('/ping')) return Promise.resolve(jsonResponse({}));
            calls += 1;
            return Promise.resolve(jsonResponse({ code: -1003 }, { status: 418, headers: { 'retry-after': '1' } }));
        }));
        // A 3-slice window: the ban must stop the walk at the first request, not the third.
        const trades = await new BinanceProvider().getTrades('BTCUSDT', { from: 0, to: 120 * MIN });
        expect(trades).toEqual([]);
        expect(calls).toBe(1);
    });

    it('returns an empty tape for an inverted window rather than walking backwards', async () => {
        const urls = stubWalk([[row(1, 0)]]);
        expect(await new BinanceProvider().getTrades('BTCUSDT', { from: 10 * MIN, to: MIN })).toEqual([]);
        expect(urls).toEqual([]);
    });

    it('declares a full-depth, streaming tape', () => {
        const caps = new BinanceProvider().info().capabilities;
        expect(caps.trades).toBe('full');
        expect(caps.tradeStream).toBe(true);
    });
});

describe('Coinbase tape walk', () => {
    const iso = (ms: number): string => new Date(ms).toISOString();
    const row = (id: number, ms: number) => ({ trade_id: id, time: iso(ms), price: '100', size: '1', side: 'buy' });

    /** Stub fetch with cursor pages (newest first), each carrying the next `cb-after`. */
    function stubPages(pages: Array<{ rows: unknown[]; after?: string }>): string[] {
        const urls: string[] = [];
        let page = 0;
        vi.stubGlobal('fetch', vi.fn((input: string) => {
            urls.push(input);
            const p = pages[page++];
            return Promise.resolve(jsonResponse(p?.rows ?? [], p?.after ? { headers: { 'cb-after': p.after } } : {}));
        }));
        return urls;
    }

    it('walks back from the tip with the cursor and stops once past the window', async () => {
        const now = 10 * MIN;
        const urls = stubPages([
            { rows: [row(3, now), row(2, now - MIN)], after: '2' },
            { rows: [row(1, now - 20 * MIN)], after: '1' }, // older than `from` → stop
            { rows: [row(0, 0)], after: '0' },
        ]);
        const trades = await new CoinbaseProvider().getTrades('BTC-USD', { from: now - 5 * MIN, to: now });

        expect(urls).toHaveLength(2); // the third page is never asked for
        expect(new URL(urls[0]!).searchParams.get('after')).toBeNull(); // starts at the tip
        expect(new URL(urls[1]!).searchParams.get('after')).toBe('2');
        expect(trades.map((t) => t.id)).toEqual(['2', '3']); // ascending, window-clipped
    });

    it('gives up after the page cap — that is what `recent` depth means', async () => {
        const now = 1_000 * MIN;
        // Every page stays inside the (very old) window's future, so the walk never reaches it.
        const pages = Array.from({ length: 50 }, (_, i) => ({ rows: [row(1000 - i, now - i * MIN)], after: String(1000 - i) }));
        const urls = stubPages(pages);
        const trades = await new CoinbaseProvider().getTrades('BTC-USD', { from: 0, to: MIN });

        expect(urls.length).toBe(20); // MAX_TRADE_PAGES, not 50
        expect(trades).toEqual([]); // out of reach, reported as empty rather than as a partial guess
    });

    it('declares a recent-only, streaming tape', () => {
        const caps = new CoinbaseProvider().info().capabilities;
        expect(caps.trades).toBe('recent');
        expect(caps.tradeStream).toBe(true);
    });
});

describe('Hyperliquid tape', () => {
    it('declares a live-only tape — the venue serves no trade history', () => {
        const caps = new HyperliquidProvider().info().capabilities;
        expect(caps.trades).toBe('none');
        expect(caps.tradeStream).toBe(true);
        expect((new HyperliquidProvider() as { getTrades?: unknown }).getTrades).toBeUndefined();
    });
});
