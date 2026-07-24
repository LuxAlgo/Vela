import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    CoinbaseProvider,
    normalizeTf,
    parseProductId,
    candleRowToOHLCV,
    dedupeSorted,
    aggregate,
    aggregateCalendar,
} from '../src/data/providers/coinbase/CoinbaseProvider';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;
const res = (ok: boolean, body: unknown, status = ok ? 200 : 404): Response =>
    ({ ok, status, headers: new Headers(), json: () => Promise.resolve(body) }) as unknown as Response;

/** A raw Coinbase candle row: `[time(sec), low, high, open, close, volume]`. */
function row(tSec: number, low = 9, high = 12, open = 10, close = 11, vol = 5): number[] {
    return [tSec, low, high, open, close, vol];
}

describe('Coinbase pure helpers', () => {
    it('normalizeTf maps aliases to canonical keys', () => {
        expect(normalizeTf('1h')).toBe('60');
        expect(normalizeTf('4h')).toBe('240');
        expect(normalizeTf('6h')).toBe('360');
        expect(normalizeTf('1d')).toBe('D');
        expect(normalizeTf('45m')).toBe('45');
        expect(normalizeTf('60')).toBe('60'); // already canonical
    });

    it('parseProductId upper-cases and trims (product id form)', () => {
        expect(parseProductId('btc-usd')).toBe('BTC-USD');
        expect(parseProductId('  eth-eur ')).toBe('ETH-EUR');
    });

    it('candleRowToOHLCV maps the [time,LOW,HIGH,open,close,vol] tuple (seconds → ms)', () => {
        // note the API order: low precedes high
        expect(candleRowToOHLCV([1000, 9, 12, 10, 11, 100])).toEqual({
            time: 1_000_000, open: 10, high: 12, low: 9, close: 11, volume: 100,
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
        const sub: OHLCV[] = [0, 15, 30, 45, 60, 75].map((m, i) => ({
            time: m * MIN, open: 100 + i, high: 110 + i, low: 90 + i, close: 101 + i, volume: 1,
        }));
        const out = aggregate(sub, 45 * MIN);
        expect(out.map((x) => x.time)).toEqual([0, 45 * MIN]);
        expect(out[0]).toMatchObject({ open: 100, close: 103, high: 112, low: 90, volume: 3 });
    });

    it('aggregateCalendar folds daily candles into Monday-aligned weeks (UTC)', () => {
        const mon = Date.UTC(2021, 0, 4); // 2021-01-04 is a Monday
        const tue = Date.UTC(2021, 0, 5);
        const nextMon = Date.UTC(2021, 0, 11);
        const daily: OHLCV[] = [mon, tue, nextMon].map((t, i) => ({ time: t, open: 10 + i, high: 20 + i, low: 5 + i, close: 15 + i, volume: 1 }));
        const out = aggregateCalendar(daily, 'W');
        expect(out.map((b) => b.time)).toEqual([mon, nextMon]);
        expect(out[0]).toMatchObject({ open: 10, close: 16, high: 21, low: 5, volume: 2 }); // Mon+Tue folded
    });

    it('aggregateCalendar folds daily candles into calendar months (UTC)', () => {
        const jan1 = Date.UTC(2021, 0, 1);
        const jan15 = Date.UTC(2021, 0, 15);
        const feb1 = Date.UTC(2021, 1, 1);
        const monthStart = Date.UTC(2021, 0, 1);
        const daily: OHLCV[] = [jan1, jan15, feb1].map((t, i) => ({ time: t, open: 10 + i, high: 20 + i, low: 5 + i, close: 15 + i, volume: 1 }));
        const out = aggregateCalendar(daily, 'M');
        expect(out.map((b) => b.time)).toEqual([monthStart, feb1]);
        expect(out[0]).toMatchObject({ volume: 2 }); // Jan 1 + Jan 15 folded
    });
});

describe('CoinbaseProvider.getBars (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Mock fetch: /candles → the supplied rows; records requested URLs. */
    function stubCandles(rows: number[][]) {
        const calls: string[] = [];
        const fetchMock = vi.fn((input: string | URL) => {
            const url = input.toString();
            calls.push(url);
            if (url.includes('/candles')) return Promise.resolve(res(true, rows));
            return Promise.resolve(res(false, {}));
        });
        vi.stubGlobal('fetch', fetchMock);
        return calls;
    }

    it('fetches a native timeframe directly and maps to OHLCV (sorted ascending)', async () => {
        // newest-first rows (as the API returns) at 0/60/120 min
        const rows = [120, 60, 0].map((m) => row(m * 60));
        const calls = stubCandles(rows);

        const bars = await new CoinbaseProvider().getBars('BTC-USD', '1h', { limit: 3 });
        expect(bars.length).toBe(3);
        expect(bars[0]).toEqual({ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 5 });
        expect(bars[0]!.time).toBeLessThan(bars[2]!.time); // ascending
        expect(calls.some((u) => u.includes('granularity=3600') && u.includes('/products/BTC-USD/candles'))).toBe(true);
    });

    it('aggregates an unsupported timeframe (30) from a native 15m sub-timeframe', async () => {
        // four 15m candles → two 30m bars ([0,30) and [30,60))
        const rows = [45, 30, 15, 0].map((m) => row(m * 60));
        const calls = stubCandles(rows);

        const bars = await new CoinbaseProvider().getBars('BTC-USD', '30', { limit: 2 });
        expect(calls.some((u) => u.includes('granularity=900'))).toBe(true); // requested 15m
        expect(bars.map((b) => b.time)).toEqual([0, 30 * MIN]);
    });

    it('folds W from daily candles (granularity=86400)', async () => {
        const mon = Date.UTC(2021, 0, 4) / 1000;
        const tue = Date.UTC(2021, 0, 5) / 1000;
        const nextMon = Date.UTC(2021, 0, 11) / 1000;
        const rows = [nextMon, tue, mon].map((s) => row(s)); // newest-first
        const calls = stubCandles(rows);

        const bars = await new CoinbaseProvider().getBars('BTC-USD', '1w', { limit: 2 });
        expect(calls.some((u) => u.includes('granularity=86400'))).toBe(true);
        expect(bars.map((b) => b.time)).toEqual([Date.UTC(2021, 0, 4), Date.UTC(2021, 0, 11)]);
    });

    it('uses range.from directly (the cache tail refresh) as the forward window start', async () => {
        const calls = stubCandles([row(5000)]);
        await new CoinbaseProvider().getBars('BTC-USD', '1h', { from: 5_000_000, to: 5_100_000 });
        // start param is in seconds → range.from(ms) / 1000
        expect(calls.some((u) => u.includes('start=5000'))).toBe(true);
    });

    it('fails soft (empty + warning) when a fetch errors, instead of rejecting', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(false, {}, 503))));
        const bars = await new CoinbaseProvider().getBars('BTC-USD', '1h', { limit: 5 });
        expect(bars).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch'));
        warn.mockRestore();
    });
});

describe('CoinbaseProvider — pagination + enumeration + symbol info (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('paginates backward past the 300-candle cap and merges pages ascending', async () => {
        const step = 3600; // 1h in seconds
        let candleCalls = 0;
        // page 1 = most-recent 300, page 2 = older 200 (newest-first within each page)
        const page1 = Array.from({ length: 300 }, (_, i) => row((1000 + 299 - i) * step));
        const page2 = Array.from({ length: 200 }, (_, i) => row((800 + 199 - i) * step));
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/candles')) {
                candleCalls += 1;
                return Promise.resolve(res(true, candleCalls === 1 ? page1 : candleCalls === 2 ? page2 : []));
            }
            return Promise.resolve(res(false, {}));
        }));

        const bars = await new CoinbaseProvider().getBars('BTC-USD', '1h', { limit: 500 });
        expect(candleCalls).toBe(2); // 300 + 200
        expect(bars.length).toBe(500);
        expect(bars[0]!.time).toBeLessThan(bars[bars.length - 1]!.time); // merged + sorted ascending
    });

    it('listSymbols enumerates online, trading-enabled products only', async () => {
        const products = [
            { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online', trading_disabled: false },
            { id: 'ETH-EUR', base_currency: 'ETH', quote_currency: 'EUR', status: 'online', trading_disabled: false },
            { id: 'OLD-USD', base_currency: 'OLD', quote_currency: 'USD', status: 'delisted', trading_disabled: false },
            { id: 'HALT-USD', base_currency: 'HALT', quote_currency: 'USD', status: 'online', trading_disabled: true },
        ];
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (/\/products$/.test(url)) return Promise.resolve(res(true, products));
            return Promise.resolve(res(false, {}));
        }));

        const tickers = (await new CoinbaseProvider().listSymbols()).map((s) => s.ticker);
        expect(tickers).toContain('BTC-USD');
        expect(tickers).toContain('ETH-EUR');
        expect(tickers).not.toContain('OLD-USD'); // delisted
        expect(tickers).not.toContain('HALT-USD'); // trading disabled
    });

    it('getSymbolInfo derives mintick from quote_increment', async () => {
        const product = { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', quote_increment: '0.01', base_increment: '0.00000001', status: 'online' };
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (/\/products\/BTC-USD$/.test(url)) return Promise.resolve(res(true, product));
            return Promise.resolve(res(false, {}));
        }));

        const info = await new CoinbaseProvider().getSymbolInfo('BTC-USD');
        expect(info).toMatchObject({ ticker: 'BTC-USD', type: 'crypto', basecurrency: 'BTC', currency: 'USD', prefix: 'COINBASE' });
        expect(info!.mintick).toBe(0.01);
        expect(info!.pricescale).toBe(100);
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
        _open(): void { this.readyState = 1; this.onopen?.(); }
        _msg(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
    }
    return FakeWS;
}

describe('CoinbaseProvider.subscribe', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('builds a forming bar from the ticker channel for a native interval', async () => {
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        // reseed() → getBars → /candles; give it one 1h bar so the seed has a base
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/candles')) return Promise.resolve(res(true, [row(3600)])); // bar at 3,600,000ms
            return Promise.resolve(res(false, {}));
        }));
        const bars: OHLCV[] = [];
        const unsub = new CoinbaseProvider().subscribe('BTC-USD', '1h', (b) => bars.push(b));
        const ws = FakeWS.instances[0]!;
        expect(ws.url).toBe('wss://ws-feed.exchange.coinbase.com');
        ws._open();
        expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker'] });

        // a ticker tick within the 1h bar [3,600,000, 7,200,000) updates close/high/low
        ws._msg({ type: 'ticker', product_id: 'BTC-USD', price: '105', time: new Date(3_600_000 + MIN).toISOString() });
        const formed = bars[bars.length - 1]!;
        expect(formed.close).toBe(105);
        expect(formed.high).toBeGreaterThanOrEqual(105);
        unsub();
        expect(ws.readyState).toBe(3); // closed on unsubscribe
    });

    it('falls back to polling getBars for an aggregated (non-native) timeframe', async () => {
        vi.useFakeTimers();
        const rows = [0, 15, 30].map((m) => row(m * 60));
        vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
            const url = input.toString();
            if (url.includes('/candles')) return Promise.resolve(res(true, rows));
            return Promise.resolve(res(false, {}));
        }));
        const bars: OHLCV[] = [];
        const unsub = new CoinbaseProvider().subscribe('BTC-USD', '30', (b) => bars.push(b));
        await vi.advanceTimersByTimeAsync(3100);
        expect(bars.length).toBeGreaterThan(0);
        unsub();
    });
});
