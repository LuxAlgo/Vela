import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    HyperliquidProvider,
    normalizeTf,
    parseCoin,
    candleToOHLCV,
    dedupeSorted,
    aggregate,
} from '../src/data/providers/hyperliquid/HyperliquidProvider';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;

/** A raw Hyperliquid candle (prices/volume as strings, like the live API). */
function candle(tMin: number, intervalMin: number, o = '100', h = '110', l = '90', c = '101', s = 'BTC'): Record<string, unknown> {
    const t = tMin * MIN;
    return { t, T: t + intervalMin * MIN - 1, s, i: `${intervalMin}m`, o, h, l, c, v: '1', n: 1 };
}

describe('Hyperliquid pure helpers', () => {
    it('normalizeTf maps aliases to canonical keys', () => {
        expect(normalizeTf('1h')).toBe('60');
        expect(normalizeTf('4h')).toBe('240');
        expect(normalizeTf('1d')).toBe('D');
        expect(normalizeTf('45m')).toBe('45');
        expect(normalizeTf('D')).toBe('D');
        expect(normalizeTf('60')).toBe('60'); // already canonical
    });

    it('parseCoin upper-cases bare perps and passes spot pairs through', () => {
        expect(parseCoin('btc')).toBe('BTC');
        expect(parseCoin(' eth ')).toBe('ETH');
        expect(parseCoin('PURR/USDC')).toBe('PURR/USDC');
    });

    it('candleToOHLCV parses string prices into numbers (open-time in ms)', () => {
        expect(candleToOHLCV({ t: 1000, T: 4999, s: 'BTC', i: '1m', o: '10', h: '12', l: '9', c: '11', v: '100', n: 4 })).toEqual({
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
        const sub: OHLCV[] = [0, 15, 30, 45, 60, 75].map((m, i) => ({
            time: m * MIN, open: 100 + i, high: 110 + i, low: 90 + i, close: 101 + i, volume: 1,
        }));
        const out = aggregate(sub, 45 * MIN);
        expect(out.map((x) => x.time)).toEqual([0, 45 * MIN]);
        expect(out[0]).toMatchObject({ open: 100, close: 103, high: 112, low: 90, volume: 3 });
    });
});

/** Stub `fetch` for the single POST /info endpoint; `route(body)` returns the JSON payload. */
function stubInfo(route: (body: any) => unknown): any[] {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string | URL, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}');
        calls.push(body);
        const out = route(body) as { __notok?: boolean; status?: number } | unknown;
        if (out && (out as { __notok?: boolean }).__notok) {
            return Promise.resolve({ ok: false, status: (out as { status?: number }).status ?? 500, json: () => Promise.resolve({}) } as unknown as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(out) } as unknown as Response);
    }));
    return calls;
}

describe('HyperliquidProvider.getBars (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('fetches a native timeframe directly and maps to OHLCV', async () => {
        const rows = [0, 60, 120].map((m) => candle(m, 60));
        const calls = stubInfo((b) => (b.type === 'candleSnapshot' ? rows : []));

        const bars = await new HyperliquidProvider().getBars('BTC', '1h', { limit: 3 });
        expect(bars.length).toBe(3);
        expect(bars[0]).toEqual({ time: 0, open: 100, high: 110, low: 90, close: 101, volume: 1 });
        const snap = calls.find((c) => c.type === 'candleSnapshot');
        expect(snap.req.coin).toBe('BTC');
        expect(snap.req.interval).toBe('1h');
        expect(snap.req.startTime).toBeLessThan(snap.req.endTime);
    });

    it('aggregates an unsupported timeframe (45) from a native 15m sub-timeframe', async () => {
        const sub = [0, 15, 30, 45, 60, 75].map((m) => candle(m, 15));
        const calls = stubInfo((b) => (b.type === 'candleSnapshot' ? sub : []));

        const bars = await new HyperliquidProvider().getBars('BTC', '45', { limit: 2 });
        expect(calls.find((c) => c.type === 'candleSnapshot').req.interval).toBe('15m');
        expect(bars.map((b) => b.time)).toEqual([0, 45 * MIN]);
    });

    it('passes a spot pair through as the API coin verbatim', async () => {
        const calls = stubInfo((b) => (b.type === 'candleSnapshot' ? [candle(0, 60, '1', '1', '1', '1', 'PURR/USDC')] : []));
        await new HyperliquidProvider().getBars('PURR/USDC', '1h', { limit: 1 });
        expect(calls.find((c) => c.type === 'candleSnapshot').req.coin).toBe('PURR/USDC');
    });

    it('uses range.from directly (the cache tail refresh) instead of a count window', async () => {
        const calls = stubInfo((b) => (b.type === 'candleSnapshot' ? [candle(100, 60)] : []));
        await new HyperliquidProvider().getBars('BTC', '1h', { from: 5_000_000 });
        expect(calls.find((c) => c.type === 'candleSnapshot').req.startTime).toBe(5_000_000);
    });

    it('fails soft (empty + warning) when the request errors, instead of rejecting', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubInfo(() => ({ __notok: true, status: 503 }));
        const bars = await new HyperliquidProvider().getBars('BTC', '1h', { limit: 5 });
        expect(bars).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to fetch'));
        warn.mockRestore();
    });
});

describe('HyperliquidProvider — enumeration + symbol info (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const meta = { universe: [
        { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
        { name: 'OLD', szDecimals: 1, maxLeverage: 5, isDelisted: true },
        { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
    ] };
    const spotMeta = {
        universe: [{ tokens: [1, 0], name: 'PURR/USDC', index: 0, isCanonical: true }],
        tokens: [{ name: 'USDC', szDecimals: 8, index: 0 }, { name: 'PURR', szDecimals: 0, index: 1 }],
    };
    const route = (b: any): unknown => (b.type === 'meta' ? meta : b.type === 'spotMeta' ? spotMeta : []);

    it('listSymbols enumerates perps (excluding delisted) + spot with readable descriptions', async () => {
        stubInfo(route);
        const list = await new HyperliquidProvider().listSymbols();
        const tickers = list.map((s) => s.ticker);
        expect(tickers).toContain('BTC');
        expect(tickers).toContain('ETH');
        expect(tickers).not.toContain('OLD'); // delisted
        expect(tickers).toContain('PURR/USDC'); // spot pair (ticker = API coin)
        expect(list.find((s) => s.ticker === 'BTC')!.type).toBe('futures');
        expect(list.find((s) => s.ticker === 'PURR/USDC')!.description).toBe('PURR / USDC');
    });

    it('getSymbolInfo builds a perp record (USD-margined, tick from szDecimals)', async () => {
        stubInfo(route);
        const info = await new HyperliquidProvider().getSymbolInfo('BTC');
        expect(info).toMatchObject({ ticker: 'BTC', type: 'futures', basecurrency: 'BTC', currency: 'USD', prefix: 'HYPERLIQUID' });
        expect(info!.mintick).toBeCloseTo(0.1); // 6 − szDecimals(5) = 1 decimal
        expect(info!.pricescale).toBe(10);
    });

    it('getSymbolInfo builds a spot record from the token pair', async () => {
        stubInfo(route);
        const info = await new HyperliquidProvider().getSymbolInfo('PURR/USDC');
        expect(info).toMatchObject({ type: 'crypto', basecurrency: 'PURR', currency: 'USDC' });
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

describe('HyperliquidProvider.subscribe', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('streams via WebSocket for a native interval', () => {
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        const bars: OHLCV[] = [];
        const unsub = new HyperliquidProvider().subscribe('BTC', '1h', (b) => bars.push(b));
        const ws = FakeWS.instances[0]!;
        ws._open();
        expect(JSON.parse(ws.sent[0]!)).toMatchObject({ method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '1h' } });
        ws._msg({ channel: 'candle', data: { t: 1000, s: 'BTC', i: '1h', o: '10', h: '12', l: '9', c: '11', v: '3', n: 1 } });
        expect(bars).toEqual([{ time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 3 }]);
        unsub();
        expect(ws.readyState).toBe(3); // closed on unsubscribe
    });

    it('falls back to polling getBars for an aggregated (non-native) timeframe', async () => {
        vi.useFakeTimers();
        const sub = [0, 15, 30].map((m) => candle(m, 15));
        stubInfo((b) => (b.type === 'candleSnapshot' ? sub : []));
        const bars: OHLCV[] = [];
        const unsub = new HyperliquidProvider().subscribe('BTC', '45', (b) => bars.push(b));
        await vi.advanceTimersByTimeAsync(3100);
        expect(bars.length).toBeGreaterThan(0);
        unsub();
    });

    it('falls back to polling when the stream opens but delivers no data', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const FakeWS = makeFakeWS(); // never delivers a candle frame
        vi.stubGlobal('WebSocket', FakeWS);
        stubInfo((b) => (b.type === 'candleSnapshot' ? [candle(0, 60)] : [])); // the poll fallback's getBars
        const bars: OHLCV[] = [];
        const unsub = new HyperliquidProvider().subscribe('BTC', '1h', (b) => bars.push(b));
        expect(FakeWS.instances.length).toBe(1); // socket opened synchronously
        await vi.advanceTimersByTimeAsync(20_000); // past the 15s stall watchdog + a poll cycle
        expect(bars.length).toBeGreaterThan(0); // delivered via the poll fallback
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to polling'));
        expect(FakeWS.instances[0]!.readyState).toBe(3); // the dead socket was closed
        unsub();
        warn.mockRestore();
    });
});
