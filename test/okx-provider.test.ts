import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    OkxProvider,
    normalizeTf,
    parseInstId,
    instTypeOf,
    candleRowToOHLCV,
} from '../src/data/providers/okx/OkxProvider';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** An OKX REST answer: the `{ code, msg, data }` envelope (errors also ride HTTP 200). */
const res = (body: unknown, status = 200): Response =>
    ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: () => Promise.resolve(body) }) as unknown as Response;
const okEnv = (data: unknown): Response => res({ code: '0', msg: '', data });

/** A raw OKX candle row: `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]`. */
function row(tMs: number, vol = '5', volCcy = '0.05'): string[] {
    return [String(tMs), '10', '12', '9', '11', vol, volCcy, '500', '1'];
}

/** `count` newest-first rows ending at `newestMs`, `stepMs` apart (the API order). */
function rowsDesc(newestMs: number, count: number, stepMs: number): string[][] {
    return Array.from({ length: count }, (_, i) => row(newestMs - i * stepMs));
}

/** Stub fetch with a router; records every requested URL. */
function stubFetch(route: (url: URL) => Response) {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
        const url = new URL(input.toString());
        calls.push(url);
        return Promise.resolve(route(url));
    }));
    return calls;
}

describe('OKX pure helpers', () => {
    it('normalizeTf maps aliases to canonical keys', () => {
        expect(normalizeTf('1h')).toBe('60');
        expect(normalizeTf('4h')).toBe('240');
        expect(normalizeTf('8h')).toBe('480');
        expect(normalizeTf('1d')).toBe('D');
        expect(normalizeTf('60')).toBe('60');
    });

    it('parseInstId upper-cases and trims (instrument id form)', () => {
        expect(parseInstId(' btc-usdt-swap ')).toBe('BTC-USDT-SWAP');
    });

    it('instTypeOf classifies spot, perpetual swaps and dated futures by id', () => {
        expect(instTypeOf('BTC-USDT')).toBe('SPOT');
        expect(instTypeOf('BTC-USDT-SWAP')).toBe('SWAP');
        expect(instTypeOf('BTC-USD-251226')).toBe('FUTURES');
    });

    it('candleRowToOHLCV reads base volume from vol on spot and volCcy on derivatives', () => {
        const r = ['1000', '10', '12', '9', '11', '472856.12', '4728.5612', '403710347', '0'];
        expect(candleRowToOHLCV(r, false)).toEqual({ time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 472856.12 });
        expect(candleRowToOHLCV(r, true).volume).toBe(4728.5612); // contracts → base currency
    });
});

describe('OkxProvider.getBars (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('fetches a native timeframe from /market/candles, ascending, with no cursor on the first page', async () => {
        const calls = stubFetch(() => okEnv(rowsDesc(2 * HOUR, 3, HOUR)));
        const bars = await new OkxProvider().getBars('btc-usdt', '1h', { limit: 3 });
        expect(bars.map((b) => b.time)).toEqual([0, HOUR, 2 * HOUR]);
        expect(bars[0]).toEqual({ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 5 });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.pathname).toBe('/api/v5/market/candles');
        expect(calls[0]!.searchParams.get('instId')).toBe('BTC-USDT');
        expect(calls[0]!.searchParams.get('bar')).toBe('1H');
        expect(calls[0]!.searchParams.has('after')).toBe(false); // the forming bar is never cut by the client clock
    });

    it('uses the UTC-aligned bars for daily and longer timeframes', async () => {
        const calls = stubFetch(() => okEnv([row(0)]));
        const p = new OkxProvider();
        await p.getBars('BTC-USDT', 'D', { limit: 1 });
        await p.getBars('BTC-USDT', 'W', { limit: 1 });
        await p.getBars('BTC-USDT', '360', { limit: 1 });
        expect(calls.map((u) => u.searchParams.get('bar'))).toEqual(['1Dutc', '1Wutc', '6Hutc']);
    });

    it('reports perpetual volume in base currency', async () => {
        stubFetch(() => okEnv([row(0, '1000', '10')]));
        const [bar] = await new OkxProvider().getBars('BTC-USDT-SWAP', '1h', { limit: 1 });
        expect(bar!.volume).toBe(10);
    });

    it('aggregates an unsupported timeframe (45) from a native 15m sub-timeframe', async () => {
        const calls = stubFetch(() => okEnv(rowsDesc(45 * MIN, 4, 15 * MIN)));
        const bars = await new OkxProvider().getBars('BTC-USDT', '45', { limit: 2 });
        expect(calls[0]!.searchParams.get('bar')).toBe('15m');
        expect(bars.map((b) => b.time)).toEqual([0, 45 * MIN]);
    });

    it('pages backward past the 300-row cap, then continues into history-candles once the recent window runs out', async () => {
        const now = Date.now();
        const tip = Math.floor(now / MIN) * MIN;
        // /candles serves 300 + 140 rows (its window ends), history serves the rest.
        const calls = stubFetch((u) => {
            const after = u.searchParams.get('after');
            const newest = after ? Number(after) - MIN : tip;
            const limit = Number(u.searchParams.get('limit'));
            const n = u.pathname.endsWith('/candles') ? (after ? 140 : 300) : limit;
            return okEnv(rowsDesc(newest, Math.min(n, limit), MIN));
        });
        const bars = await new OkxProvider().getBars('BTC-USDT', '1', { limit: 800 });
        expect(bars).toHaveLength(800);
        expect(bars[bars.length - 1]!.time).toBe(tip);
        expect(bars.every((b, i) => i === 0 || b.time - bars[i - 1]!.time === MIN)).toBe(true); // contiguous, ascending
        // 300 + 140 from the recent window, then 300 + 60 from history (the 300-row cap).
        expect(calls.map((u) => u.pathname.split('/').pop())).toEqual(['candles', 'candles', 'history-candles', 'history-candles']);
        expect(calls[3]!.searchParams.get('limit')).toBe('60');
        expect(calls[1]!.searchParams.get('after')).toBe(String(tip - 299 * MIN)); // oldest of page 1 (exclusive)
    });

    it('routes a page whose cursor is older than the recent window straight to history-candles', async () => {
        const deep = Date.now() - 5000 * HOUR;
        const calls = stubFetch(() => okEnv(rowsDesc(deep - HOUR, 10, HOUR)));
        await new OkxProvider().getBars('BTC-USDT', '60', { to: deep, limit: 10 });
        expect(calls[0]!.pathname).toBe('/api/v5/market/history-candles');
        expect(calls[0]!.searchParams.get('after')).toBe(String(deep + 1)); // `to` is inclusive
    });

    it('a from-bounded range sends exclusive bounds and stops on the short page that reached `from`', async () => {
        const tip = Math.floor(Date.now() / HOUR) * HOUR;
        const from = tip - 3 * HOUR;
        const calls = stubFetch(() => okEnv(rowsDesc(tip, 4, HOUR)));
        const bars = await new OkxProvider().getBars('BTC-USDT', '60', { from });
        expect(bars.map((b) => b.time)).toEqual([from, from + HOUR, from + 2 * HOUR, tip]);
        expect(calls).toHaveLength(1); // the cache tail refresh costs one request
        expect(calls[0]!.searchParams.get('before')).toBe(String(from - 1));
    });

    it('a from-bounded range with a limit keeps the OLDEST bars of the window', async () => {
        const tip = Math.floor(Date.now() / HOUR) * HOUR;
        stubFetch(() => okEnv(rowsDesc(tip, 5, HOUR)));
        const bars = await new OkxProvider().getBars('BTC-USDT', '60', { from: tip - 4 * HOUR, limit: 2 });
        expect(bars.map((b) => b.time)).toEqual([tip - 4 * HOUR, tip - 3 * HOUR]);
    });

    it('fails soft (empty + warning) on an OKX error code delivered with HTTP 200', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubFetch(() => res({ code: '51001', msg: "Instrument ID doesn't exist.", data: [] }));
        const bars = await new OkxProvider().getBars('NOPE-USDT', '1h', { limit: 5 });
        expect(bars).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('51001'));
        warn.mockRestore();
    });

    it('retries a rate-limited answer (code 50011) and then succeeds', async () => {
        vi.useFakeTimers();
        let n = 0;
        stubFetch(() => (++n === 1 ? res({ code: '50011', msg: 'Too Many Requests', data: [] }, 429) : okEnv([row(0)])));
        const pending = new OkxProvider().getBars('BTC-USDT', '1h', { limit: 1 });
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await pending).toHaveLength(1);
        expect(n).toBe(2);
        vi.useRealTimers();
    });
});

describe('OkxProvider — enumeration + symbol info (stubbed fetch)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const spot = [
        { instId: 'BTC-USDT', instType: 'SPOT', baseCcy: 'BTC', quoteCcy: 'USDT', tickSz: '0.1', state: 'live' },
        { instId: 'OLD-USDT', instType: 'SPOT', baseCcy: 'OLD', quoteCcy: 'USDT', tickSz: '0.1', state: 'suspend' },
    ];
    const swaps = [
        { instId: 'BTC-USDT-SWAP', instType: 'SWAP', baseCcy: '', quoteCcy: '', uly: 'BTC-USDT', settleCcy: 'USDT', tickSz: '0.1', state: 'live' },
        { instId: 'BTC-USD-SWAP', instType: 'SWAP', baseCcy: '', quoteCcy: '', uly: 'BTC-USD', settleCcy: 'BTC', tickSz: '0.1', state: 'live' },
    ];
    const route = (u: URL): Response => {
        if (u.pathname !== '/api/v5/public/instruments') return res({ code: '50000', msg: 'bad', data: [] });
        const list = u.searchParams.get('instType') === 'SWAP' ? swaps : spot;
        const id = u.searchParams.get('instId');
        return okEnv(id ? list.filter((i) => i.instId === id) : list);
    };

    it('listSymbols enumerates live spot and perpetual instruments with readable descriptions', async () => {
        stubFetch(route);
        const list = await new OkxProvider().listSymbols();
        expect(list.map((s) => s.ticker)).toEqual(['BTC-USDT', 'BTC-USDT-SWAP', 'BTC-USD-SWAP']);
        expect(list[0]).toMatchObject({ description: 'BTC / USDT', type: 'crypto' });
        expect(list[1]).toMatchObject({ description: 'BTC / USDT Perpetual', type: 'futures' });
        expect(list[2]).toMatchObject({ description: 'BTC / USD Perpetual' }); // inverse: pair from `uly`
    });

    it('getSymbolInfo builds a spot record with mintick from tickSz', async () => {
        stubFetch(route);
        const info = await new OkxProvider().getSymbolInfo('BTC-USDT');
        expect(info).toMatchObject({ ticker: 'BTC-USDT', tickerid: 'OKX:BTC-USDT', prefix: 'OKX', type: 'crypto', basecurrency: 'BTC', currency: 'USDT' });
        expect(info!.mintick).toBe(0.1);
        expect(info!.pricescale).toBe(10);
    });

    it('getSymbolInfo queries the SWAP class for a perpetual id and derives its pair', async () => {
        const calls = stubFetch(route);
        const info = await new OkxProvider().getSymbolInfo('BTC-USDT-SWAP');
        expect(calls[0]!.searchParams.get('instType')).toBe('SWAP');
        expect(info).toMatchObject({ type: 'futures', basecurrency: 'BTC', currency: 'USDT', description: 'BTC / USDT Perpetual' });
    });

    it('getSymbolInfo resolves undefined for an unknown instrument', async () => {
        stubFetch(route);
        expect(await new OkxProvider().getSymbolInfo('NOPE-USDT')).toBeUndefined();
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

describe('OkxProvider.subscribe', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('streams the native candle channel and maps pushes to OHLCV', () => {
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        const bars: OHLCV[] = [];
        const unsub = new OkxProvider().subscribe('BTC-USDT-SWAP', '1h', (b) => bars.push(b));
        const ws = FakeWS.instances[0]!;
        expect(ws.url).toBe('wss://ws.okx.com:8443/ws/v5/business');
        ws._open();
        expect(JSON.parse(ws.sent[0]!)).toEqual({ op: 'subscribe', args: [{ channel: 'candle1H', instId: 'BTC-USDT-SWAP' }] });

        ws._msg({ event: 'subscribe', arg: { channel: 'candle1H', instId: 'BTC-USDT-SWAP' } }); // ack: no bar
        ws._msg({ arg: { channel: 'candle1H', instId: 'ETH-USDT-SWAP' }, data: [row(0)] }); // another instrument
        ws._msg({ arg: { channel: 'candle1H', instId: 'BTC-USDT-SWAP' }, data: [row(HOUR, '1000', '10')] });
        expect(bars).toEqual([{ time: HOUR, open: 10, high: 12, low: 9, close: 11, volume: 10 }]);

        unsub();
        expect(ws.readyState).toBe(3);
    });

    it('falls back to polling getBars for an aggregated (non-native) timeframe', async () => {
        vi.useFakeTimers();
        stubFetch(() => okEnv(rowsDesc(30 * MIN, 3, 15 * MIN)));
        const bars: OHLCV[] = [];
        const unsub = new OkxProvider().subscribe('BTC-USDT', '45', (b) => bars.push(b));
        await vi.advanceTimersByTimeAsync(3500); // a poll cycle + the request gate's spacing
        expect(bars.length).toBeGreaterThan(0);
        unsub();
    });

    it('falls back to polling when the socket opens but never delivers', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const FakeWS = makeFakeWS();
        vi.stubGlobal('WebSocket', FakeWS);
        stubFetch(() => okEnv([row(0)]));
        const bars: OHLCV[] = [];
        const unsub = new OkxProvider().subscribe('BTC-USDT', '1h', (b) => bars.push(b));
        FakeWS.instances[0]!._open();
        await vi.advanceTimersByTimeAsync(20_000); // past the 15s watchdog + a poll cycle
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to polling'));
        expect(bars.length).toBeGreaterThan(0);
        unsub();
        warn.mockRestore();
    });
});
