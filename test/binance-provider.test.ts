import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    BinanceProvider,
    normalizeTf,
    parseTicker,
    klinesToOHLCV,
    klineEventToOHLCV,
    dedupeSorted,
    aggregate,
} from '../src/data/providers/binance/BinanceProvider';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;

describe('Binance pure helpers', () => {
    it('normalizeTf maps aliases to canonical keys', () => {
        expect(normalizeTf('1h')).toBe('60');
        expect(normalizeTf('4h')).toBe('240');
        expect(normalizeTf('1d')).toBe('D');
        expect(normalizeTf('45m')).toBe('45');
        expect(normalizeTf('D')).toBe('D');
        expect(normalizeTf('60')).toBe('60'); // already canonical
    });

    it('parseTicker splits perpetual futures (.P) from spot', () => {
        expect(parseTicker('BTCUSDT')).toEqual({ apiSymbol: 'BTCUSDT', isFutures: false });
        expect(parseTicker('BTCUSDT.P')).toEqual({ apiSymbol: 'BTCUSDT', isFutures: true });
        expect(parseTicker('btcusdt.p')).toEqual({ apiSymbol: 'BTCUSDT', isFutures: true }); // upper-cased
    });

    it('klinesToOHLCV maps raw rows (open-time in ms)', () => {
        const rows = [[1000, '10', '12', '9', '11', '100', 4999]];
        expect(klinesToOHLCV(rows)).toEqual([{ time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100 }]);
    });

    it('klineEventToOHLCV maps a WS kline payload (string prices)', () => {
        expect(klineEventToOHLCV({ t: 1000, o: '10', h: '12', l: '9', c: '11', v: '100', x: false })).toEqual({
            time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100,
        });
    });

    it('dedupeSorted sorts by time and keeps the last bar per time', () => {
        const a: OHLCV = { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 0 };
        const b: OHLCV = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 };
        const b2: OHLCV = { time: 1, open: 9, high: 9, low: 9, close: 9, volume: 0 };
        const out = dedupeSorted([a, b, b2]);
        expect(out.map((x) => x.time)).toEqual([1, 2]);
        expect(out[0]!.open).toBe(9); // incoming b2 won
    });

    it('aggregate buckets ascending sub-candles into epoch-aligned periods', () => {
        // six 15-min candles → two 45-min candles ([0,45) and [45,90))
        const sub: OHLCV[] = [0, 15, 30, 45, 60, 75].map((m, i) => ({
            time: m * MIN,
            open: 100 + i,
            high: 110 + i,
            low: 90 + i,
            close: 101 + i,
            volume: 1,
        }));
        const out = aggregate(sub, 45 * MIN);
        expect(out.map((b) => b.time)).toEqual([0, 45 * MIN]);
        // first bucket: open from candle@0, close from candle@30, high/low across the three
        expect(out[0]).toMatchObject({ open: 100, close: 103, high: 112, low: 90, volume: 3 });
        expect(out[1]).toMatchObject({ open: 103, close: 106, high: 115, low: 93, volume: 3 });
    });
});

describe('BinanceProvider.getBars (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Mock fetch: /ping → ok; /klines → the supplied rows; records requested intervals. */
    function stubFetch(rows: (string | number)[][]) {
        const calls: string[] = [];
        const res = (ok: boolean, body: unknown, status = ok ? 200 : 404): Response =>
            ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response;
        const fetchMock = vi.fn((input: string | URL) => {
            const url = input.toString();
            calls.push(url);
            if (url.includes('/ping')) return Promise.resolve(res(true, {}));
            if (url.includes('/klines')) return Promise.resolve(res(true, rows));
            return Promise.resolve(res(false, {}));
        });
        vi.stubGlobal('fetch', fetchMock);
        return calls;
    }

    it('fetches a native timeframe directly and maps to OHLCV', async () => {
        const rows = [0, 1, 2].map((i) => [i * 3_600_000, '10', '11', '9', '10', '5', i * 3_600_000 + 3_599_999]);
        const calls = stubFetch(rows);
        const provider = new BinanceProvider();

        const bars = await provider.getBars('BTCUSDT', '1h', { limit: 3 });
        expect(bars.length).toBe(3);
        expect(bars[0]).toEqual({ time: 0, open: 10, high: 11, low: 9, close: 10, volume: 5 });
        expect(calls.some((u) => u.includes('interval=1h') && u.includes('symbol=BTCUSDT'))).toBe(true);
    });

    it('aggregates an unsupported timeframe by fetching a native sub-timeframe', async () => {
        // 6 fifteen-minute candles → the provider should request interval=15m and return 45m bars
        const rows = [0, 15, 30, 45, 60, 75].map((m) => [m * MIN, '100', '110', '90', '101', '1', m * MIN + 15 * MIN - 1]);
        const calls = stubFetch(rows);
        const provider = new BinanceProvider();

        const bars = await provider.getBars('BTCUSDT', '45', { limit: 2 });
        expect(calls.some((u) => u.includes('interval=15m'))).toBe(true);
        expect(bars.map((b) => b.time)).toEqual([0, 45 * MIN]);
    });

    it('routes a .P ticker to the futures endpoint', async () => {
        const rows = [[0, '10', '11', '9', '10', '5', 3_599_999]];
        const calls = stubFetch(rows);
        const provider = new BinanceProvider();

        await provider.getBars('BTCUSDT.P', '1h', { limit: 1 });
        expect(calls.some((u) => u.includes('fapi.binance.com') && u.includes('symbol=BTCUSDT'))).toBe(true);
        expect(calls.some((u) => u.includes('symbol=BTCUSDT.P'))).toBe(false); // .P stripped for the API
    });

    it('fails soft (empty + warning) when a fetch errors, instead of rejecting', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/ping')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
            return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) } as unknown as Response); // klines 503
        }));
        const bars = await new BinanceProvider().getBars('BTCUSDT', '1h', { limit: 5 });
        expect(bars).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch'));
        warn.mockRestore();
    });
});

describe('BinanceProvider — pagination, fallback, enumeration (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());
    const res = (ok: boolean, body: unknown, status = ok ? 200 : 404): Response =>
        ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response;

    it('paginates backward past the 1000-kline cap and merges pages in order', async () => {
        const step = 3_600_000;
        const kl = (t: number): (string | number)[] => [t * step, '10', '11', '9', '10', '5', t * step + step - 1];
        const page1 = Array.from({ length: 1000 }, (_, i) => kl(1000 + i)); // most-recent page
        const page2 = Array.from({ length: 500 }, (_, i) => kl(500 + i)); // older page
        let klinesCalls = 0;
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/ping')) return Promise.resolve(res(true, {}));
            if (url.includes('/klines')) {
                klinesCalls += 1;
                return Promise.resolve(res(true, klinesCalls === 1 ? page1 : klinesCalls === 2 ? page2 : []));
            }
            return Promise.resolve(res(false, {}));
        }));

        const bars = await new BinanceProvider().getBars('BTCUSDT', '1h', { limit: 1500 });
        expect(klinesCalls).toBe(2); // 1000 + 500
        expect(bars.length).toBe(1500);
        expect(bars[0]!.time).toBeLessThan(bars[bars.length - 1]!.time); // merged + sorted ascending
    });

    it('falls back from api.binance.com to api.binance.us when the primary is unreachable', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            calls.push(url);
            if (url.includes('api.binance.com') && url.includes('/ping')) return Promise.reject(new Error('unreachable'));
            if (url.includes('/ping')) return Promise.resolve(res(true, {}));
            if (url.includes('/klines')) return Promise.resolve(res(true, [[0, '1', '2', '0', '1', '1', 1]]));
            return Promise.resolve(res(false, {}));
        }));

        await new BinanceProvider().getBars('BTCUSDT', '1h', { limit: 1 });
        expect(calls.some((u) => u.includes('api.binance.us') && u.includes('/klines'))).toBe(true);
    });

    it('listSymbols enumerates spot (TRADING only) + perpetual futures (.P)', async () => {
        const spot = { symbols: [
            { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
            { symbol: 'OLDX', status: 'BREAK', baseAsset: 'OLD', quoteAsset: 'USDT' },
        ] };
        const futures = { symbols: [
            { symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT' },
            { symbol: 'ETHUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'ETH', quoteAsset: 'USDT' },
            { symbol: 'BTCUSDT_240927', status: 'TRADING', contractType: 'CURRENT_QUARTER', baseAsset: 'BTC', quoteAsset: 'USDT' },
        ] };
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/ping')) return Promise.resolve(res(true, {}));
            if (url.includes('fapi') && url.includes('exchangeInfo')) return Promise.resolve(res(true, futures));
            if (url.includes('exchangeInfo')) return Promise.resolve(res(true, spot));
            return Promise.resolve(res(false, {}));
        }));

        const tickers = (await new BinanceProvider().listSymbols()).map((s) => s.ticker);
        expect(tickers).toContain('BTCUSDT'); // spot
        expect(tickers).toContain('BTCUSDT.P'); // perpetual
        expect(tickers).toContain('ETHUSDT.P');
        expect(tickers).not.toContain('OLDX'); // not TRADING
        expect(tickers).not.toContain('BTCUSDT_240927.P'); // not PERPETUAL
    });
});

/** Minimal scriptable WebSocket double. */
function makeFakeWS() {
    class FakeWS {
        static instances: FakeWS[] = [];
        url: string;
        sent: string[] = [];
        readyState = 0;
        onopen: (() => void) | null = null;
        onmessage: ((ev: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
        send(d: string): void { this.sent.push(d); }
        close(): void { this.readyState = 3; this.onclose?.(); }
        _msg(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
    }
    return FakeWS;
}

describe('BinanceProvider.subscribe', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('streams klines via WebSocket for a native interval (perp → fstream, .P stripped)', async () => {
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        const bars: OHLCV[] = [];
        const unsub = new BinanceProvider().subscribe('BTCUSDT.P', '1h', (b) => bars.push(b));
        await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
        const ws = FakeWS.instances[0]!;
        expect(ws.url).toContain('fstream.binance.com');
        expect(ws.url).toContain('btcusdt@kline_1h');
        expect(ws.url).not.toContain('btcusdt.p'); // .P stripped for the stream name
        ws._msg({ e: 'kline', s: 'BTCUSDT', k: { t: 1000, o: '10', h: '12', l: '9', c: '11', v: '3', x: false } });
        expect(bars).toEqual([{ time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 3 }]);
        unsub();
        expect(ws.readyState).toBe(3); // closed on unsubscribe
    });

    it('spot stream picks the WebSocket host matching the resolved REST endpoint', async () => {
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        // /ping ok on the primary → spotBase resolves to api.binance.com → stream.binance.com
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/ping')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as unknown as Response);
        }));
        const unsub = new BinanceProvider().subscribe('BTCUSDT', '1h', () => {});
        await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
        expect(FakeWS.instances[0]!.url).toContain('stream.binance.com:9443');
        expect(FakeWS.instances[0]!.url).toContain('btcusdt@kline_1h');
        unsub();
    });

    it('falls back to polling getBars for an aggregated (non-native) timeframe', async () => {
        vi.useFakeTimers();
        const rows = [0, 15, 30].map((m) => [m * MIN, '1', '1', '1', '1', '1', m * MIN + 15 * MIN - 1]);
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/ping')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
            if (url.includes('/klines')) return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) } as unknown as Response);
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as unknown as Response);
        }));
        const bars: OHLCV[] = [];
        const unsub = new BinanceProvider().subscribe('BTCUSDT', '45', (b) => bars.push(b));
        await vi.advanceTimersByTimeAsync(3100);
        expect(bars.length).toBeGreaterThan(0);
        unsub();
    });

    it('falls back to polling when the stream opens but delivers no data (e.g. geo-restricted futures)', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const FakeWS = makeFakeWS(); // never delivers a message
        vi.stubGlobal('WebSocket', FakeWS);
        // The poll fallback calls getBars → futures /klines (no spotBase ping for .P).
        const rows = [
            [0, '1', '1', '1', '1', '1', 59_999],
            [60_000, '2', '2', '2', '2', '2', 119_999],
        ];
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/klines')) return Promise.resolve({ ok: true, json: () => Promise.resolve(rows) } as unknown as Response);
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as unknown as Response);
        }));
        const bars: OHLCV[] = [];
        const unsub = new BinanceProvider().subscribe('BTCUSDT.P', '1h', (b) => bars.push(b));
        expect(FakeWS.instances.length).toBe(1); // futures socket opens synchronously (no host probe)…
        await vi.advanceTimersByTimeAsync(20_000); // …past the 15s stall watchdog + a poll cycle
        expect(bars.length).toBeGreaterThan(0); // delivered via the poll fallback
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to polling'));
        expect(FakeWS.instances[0]!.readyState).toBe(3); // the dead socket was closed
        unsub();
        warn.mockRestore();
    });
});
