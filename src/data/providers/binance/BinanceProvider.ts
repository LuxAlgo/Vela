import type { OHLCV } from '../../../core/model/ohlcv';
import type { Trade } from '../../../core/model/tape';
import type { BarRange, SymbolInfo } from '../../../core/ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor, TradeRange } from '../../../core/ports/DataProvider';
import { baseOf, ledgerCryptoIconUrl } from '../../symbol-base';
import type { Unsubscribe } from '../../../core/util/types';
import { RateGate, RateLimitError } from './RateGate';

const SPOT_BASE = 'https://api.binance.com/api/v3';
const SPOT_BASE_US = 'https://api.binance.us/api/v3';
const FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';
/**
 * Stream hosts on the DEFAULT wss port. Binance also serves 9443, but pinning it strands the
 * stream behind any egress proxy that only allows CONNECT to 443 — the socket never opens and
 * the kline path silently degrades to polling while the tape, which has no poll fallback,
 * goes quiet altogether.
 */
const SPOT_WS = 'wss://stream.binance.com';
const SPOT_WS_US = 'wss://stream.binance.us';
const FUTURES_WS = 'wss://fstream.binance.com';
/**
 * If a kline socket opens but delivers no candle within this window, treat it as
 * non-delivering and fall back to polling. Covers a socket that connects but stays
 * silent — e.g. Binance USD-M futures streams are geo-restricted in some regions and
 * ACK the subscription yet never push data. Generous enough not to mis-fire on an
 * illiquid symbol (which degrades to polling harmlessly anyway).
 */
const STREAM_STALL_MS = 15_000;
/** Reconnect backoff after an unexpected socket close. */
const STREAM_RECONNECT_MS = 2_000;

/** Aggregated-trade rows per request (the endpoint's hard cap). */
const AGG_TRADES_LIMIT = 1000;
/**
 * Widest `startTime`/`endTime` span the aggTrades endpoint accepts. Binance rejects a
 * window of an hour or more outright, so a walk slices the request window and pages
 * within each slice by trade id.
 */
const AGG_TRADES_WINDOW_MS = 55 * 60_000;
/**
 * Hard stop on one walk. A busy symbol prints faster than any window can be paged
 * through, and an unbounded walk would keep a 429 pause cycling forever; the walk
 * returns what it confirmed instead.
 */
const TRADE_WALK_MAX_REQUESTS = 300;
/** Requests in flight per provider on the trade path (the gate's concurrency cap). */
const TRADE_CONCURRENCY = 3;
/** Per-minute request-weight caps the gate throttles against (spot is the looser one). */
const WEIGHT_LIMIT_SPOT = 6_000;
const WEIGHT_LIMIT_FUTURES = 2_400;
/** How long live prints are buffered before one batch is delivered. */
const TRADE_BATCH_MS = 100;
/** Default tape window when a caller names neither end. */
const TRADE_DEFAULT_WINDOW_MS = 60 * 60_000;


/** One raw Binance kline row: `[openTime, open, high, low, close, volume, closeTime, …]`. */
type RawKline = (string | number)[];

/**
 * One raw Binance aggregated-trade row — the fields this provider reads. `m` is whether
 * the BUYER was the maker, which is the inverse of the aggressor: `m: true` means a
 * seller took the resting bid.
 */
interface RawAggTrade {
    a: number; // aggregate trade id
    p: string | number; // price
    q: string | number; // quantity
    T: number; // trade time (ms)
    m: boolean; // buyer was the maker
}

/** Map raw aggregated trades to neutral tape prints (aggressor side resolved). */
export function aggTradesToTrades(raw: readonly RawAggTrade[]): Trade[] {
    return raw.map((t) => ({
        time: Number(t.T),
        price: Number(t.p),
        size: Number(t.q),
        // The buyer being the maker means the SELLER lifted nothing — it hit the bid.
        side: t.m ? ('sell' as const) : ('buy' as const),
        id: String(t.a),
    }));
}

/** Canonical timeframe → Binance interval string (native, no aggregation). */
const TF_TO_INTERVAL: Record<string, string> = {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
    '60': '1h', '120': '2h', '240': '4h', '360': '6h', '480': '8h', '720': '12h',
    D: '1d', W: '1w', M: '1M',
};

/** User-facing timeframe aliases → canonical keys (matches the other Vela layers). */
const TF_NORMALIZE: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45',
    '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
    '1d': 'D', '1w': 'W', '1mo': 'M', '1D': 'D', '1W': 'W', '4H': '240',
    D: 'D', W: 'W', M: 'M',
};

/** Native intraday timeframes in minutes (the aggregation sub-candle candidates). */
const NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720];
const MIN_TO_INTERVAL: Record<number, string> = {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 480: '8h', 720: '12h',
};
const SUPPORTED_TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', 'D', 'W', 'M'];

/** Normalize a user timeframe to a canonical key. */
export function normalizeTf(tf: string): string {
    return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}

/** Split a Vela ticker into the Binance API symbol + whether it's a perpetual future (`.P`). */
export function parseTicker(ticker: string): { apiSymbol: string; isFutures: boolean } {
    const t = ticker.trim().toUpperCase();
    if (t.endsWith('.P')) return { apiSymbol: t.slice(0, -2), isFutures: true };
    return { apiSymbol: t, isFutures: false };
}

/** Map raw Binance klines to neutral OHLCV (open-time in epoch ms). */
export function klinesToOHLCV(raw: RawKline[]): OHLCV[] {
    return raw.map((k) => ({
        time: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
    }));
}

/** Map the kline payload (`k`) of a Binance `@kline` WS event to neutral OHLCV. */
export function klineEventToOHLCV(k: KlineEvent): OHLCV {
    return { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
}


/** A `Retry-After` header (seconds) as ms, falling back to `fallbackMs` when absent/invalid. */
function retryAfterMs(res: Response, fallbackMs: number): number {
    const sec = Number(res.headers.get('retry-after'));
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : fallbackMs;
}

/** Sort by open-time and drop duplicate open-times (incoming wins) — the bar contract. */
export function dedupeSorted(bars: OHLCV[]): OHLCV[] {
    const byTime = new Map<number, OHLCV>();
    for (const b of bars) byTime.set(b.time, b);
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Aggregate ascending sub-candles into `bucketMs` buckets aligned to the epoch. */
export function aggregate(sub: OHLCV[], bucketMs: number): OHLCV[] {
    const buckets = new Map<number, OHLCV>();
    for (const b of sub) {
        const key = Math.floor(b.time / bucketMs) * bucketMs;
        const cur = buckets.get(key);
        if (!cur) {
            buckets.set(key, { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
        } else {
            cur.high = Math.max(cur.high, b.high);
            cur.low = Math.min(cur.low, b.low);
            cur.close = b.close;
            cur.volume = (cur.volume ?? 0) + (b.volume ?? 0);
        }
    }
    return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Largest native sub-timeframe (minutes) that evenly divides `targetMin`, or null. */
function selectSubTf(targetMin: number): number | null {
    return NATIVE_MINUTES.filter((m) => m < targetMin && targetMin % m === 0).sort((a, b) => b - a)[0] ?? null;
}

/**
 * Binance market-data provider, built from scratch on the public REST + WebSocket
 * APIs — no third-party market-data SDK. Serves spot and USDT-margined perpetual futures (`SYMBOL.P`),
 * paginates past the 1000-kline cap, falls back `api.binance.com → api.binance.us`,
 * and aggregates timeframes Binance doesn't serve natively (e.g. `45`, `180`). No API
 * key; live ticks stream from a native kline WebSocket (`subscribe`), with a poll
 * fallback for aggregated timeframes.
 *
 *   import { BinanceProvider } from 'vela/providers/binance';
 *   chart.data.registerProvider('binance', new BinanceProvider());
 */
export class BinanceProvider implements DataProvider {
    /** The spot endpoint confirmed reachable (cached after the first probe). */
    private spotBaseUrl: string | null = null;
    /** The in-flight endpoint probe, shared so concurrent first calls don't each ping. */
    private spotBaseProbe: Promise<string> | null = null;
    /** Cached symbol enumeration (exchangeInfo is large; fetch once). */
    private symbolsPromise: Promise<SymbolDescriptor[]> | null = null;
    /**
     * Shared gate for the TRADE path: caps concurrency, honors 429 backoff and 418 bans,
     * and pre-emptively pauses as the used-weight header nears the cap. Bar requests are
     * a handful per load; a tape walk is hundreds, and it is the one path that can get an
     * IP banned — so it is the path that is gated.
     */
    private readonly tradeGate = new RateGate(TRADE_CONCURRENCY);

    info(): ProviderInfo {
        return {
            name: 'binance',
            displayName: 'Binance',
            requiresApiKey: false,
            supportedTimeframes: SUPPORTED_TIMEFRAMES,
            capabilities: { enumerate: true, stream: true, symbolInfo: true, trades: 'full', tradeStream: true },
        };
    }

    async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        try {
            const { apiSymbol, isFutures } = parseTicker(ticker);
            const base = isFutures ? FUTURES_BASE : await this.spotBase();
            const tf = normalizeTf(timeframe);

            const nativeInterval = TF_TO_INTERVAL[tf];
            if (nativeInterval) {
                return dedupeSorted(klinesToOHLCV(await this.fetchKlines(base, apiSymbol, nativeInterval, range)));
            }

            // Aggregation path: fetch a native sub-timeframe and combine.
            const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
            const subMin = targetMin != null ? selectSubTf(targetMin) : null;
            if (targetMin == null || subMin == null) {
                console.warn(`[vela] Binance: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
                return [];
            }
            const ratio = targetMin / subMin;
            const subRange: BarRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : undefined };
            const sub = klinesToOHLCV(await this.fetchKlines(base, apiSymbol, MIN_TO_INTERVAL[subMin]!, subRange));
            const agg = aggregate(sub, targetMin * 60_000);
            return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
        } catch (e) {
            // Fail soft (consistent with getSymbolInfo): an empty result parks/empties the
            // chart with a warning rather than rejecting the parked load.
            console.warn(`[vela] Binance: failed to fetch ${ticker} ${timeframe} — ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }
    }


    async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
        const { apiSymbol, isFutures } = parseTicker(ticker);
        const base = isFutures ? FUTURES_BASE : await this.spotBase();
        // Spot accepts ?symbol=; the futures exchangeInfo returns all symbols.
        const url = isFutures ? `${base}/exchangeInfo` : `${base}/exchangeInfo?symbol=${apiSymbol}`;
        const data = (await this.json(url).catch(() => null)) as { symbols?: BinanceSymbol[] } | null;
        const symbols: BinanceSymbol[] = data?.symbols ?? [];
        const s = isFutures ? symbols.find((x) => x.symbol === apiSymbol) : symbols[0];
        if (!s) return undefined;

        const priceFilter = s.filters?.find((f) => f.filterType === 'PRICE_FILTER');
        const tickSize = priceFilter ? parseFloat(priceFilter.tickSize ?? '0.01') : 0.01;
        return {
            ticker, // keep the original, incl. any .P (as Pine Script expects)
            tickerid: `BINANCE:${ticker}`,
            prefix: 'BINANCE',
            description: `${s.baseAsset} / ${s.quoteAsset}${isFutures ? ' Perpetual' : ''}`,
            type: isFutures ? 'futures' : 'crypto',
            basecurrency: s.baseAsset,
            currency: s.quoteAsset,
            mintick: tickSize,
            pricescale: Math.round(1 / tickSize),
            timezone: 'Etc/UTC',
            session: '24x7',
        };
    }

    listSymbols(): Promise<SymbolDescriptor[]> {
        if (!this.symbolsPromise) {
            this.symbolsPromise = Promise.all([
                this.listSpot().catch(() => [] as SymbolDescriptor[]),
                this.listFutures().catch(() => [] as SymbolDescriptor[]),
            ]).then(([spot, futures]) => [...spot, ...futures]);
        }
        return this.symbolsPromise;
    }

    /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
     *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
    resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
        return ledgerCryptoIconUrl(baseOf(symbol));
    }

    subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        const { apiSymbol, isFutures } = parseTicker(ticker);
        const interval = TF_TO_INTERVAL[normalizeTf(timeframe)];
        // Native interval + a WebSocket implementation ⇒ true streaming. Otherwise
        // (aggregated timeframe, or no WebSocket) fall back to polling getBars.
        if (interval && typeof WebSocket !== 'undefined') return this.streamKlines(ticker, timeframe, apiSymbol, isFutures, interval, onBar);
        return this.pollBars(ticker, timeframe, onBar);
    }


    /**
     * Walk the aggregated-trade tape over `range`. Binance refuses a time window of an
     * hour or more, so the walk slices the window and pages each slice by trade id —
     * which is also what makes it correct on a symbol printing more than 1000 trades in a
     * single millisecond, where paging by time would loop forever.
     *
     * Every request goes through the shared rate gate; a 429 pauses it and a 418 marks the
     * IP banned, at which point the walk returns what it has rather than extending the ban.
     * `opts.signal` does the same. The answer is ascending, de-duplicated by trade id, and
     * cut to `range.limit` from the NEWEST end.
     */
    async getTrades(ticker: string, range: TradeRange, opts?: { signal?: AbortSignal }): Promise<Trade[]> {
        const { apiSymbol, isFutures } = parseTicker(ticker);
        const base = isFutures ? FUTURES_BASE : await this.spotBase();
        const to = range.to ?? Date.now();
        const from = range.from ?? to - TRADE_DEFAULT_WINDOW_MS;
        if (!(to > from)) return [];

        const byId = new Map<number, RawAggTrade>();
        let sliceStart = from;
        let fromId: number | null = null;
        let requests = 0;
        /** Newest trade time an id page reached — id pages ignore the slice's time bounds. */
        let pagedTo = 0;

        while (sliceStart <= to && requests < TRADE_WALK_MAX_REQUESTS) {
            if (opts?.signal?.aborted) break;
            const sliceEnd = Math.min(sliceStart + AGG_TRADES_WINDOW_MS - 1, to);
            let rows: RawAggTrade[];
            try {
                rows = await this.aggTradesChunk(base, isFutures, fromId == null
                    ? { symbol: apiSymbol, startTime: sliceStart, endTime: sliceEnd }
                    : { symbol: apiSymbol, fromId });
            } catch (e) {
                // A ban is terminal for this walk; anything else (a blip, a 4xx on one
                // window) ends it too — a partial tape is honest, a rejected load is not.
                if (e instanceof RateLimitError && e.banned) break;
                break;
            }
            requests += 1;

            // A `fromId` page ignores the time bounds, so the cut is made here.
            let overshot = false;
            for (const t of rows) {
                if (t.T > pagedTo) pagedTo = t.T;
                if (t.T > to) { overshot = true; continue; }
                if (t.T >= from) byId.set(t.a, t);
            }

            if (rows.length === AGG_TRADES_LIMIT && !overshot) {
                // The slice holds more than one page — continue by id from the last row.
                fromId = rows[rows.length - 1]!.a + 1;
                continue;
            }
            // Slice exhausted (or we ran past `to`): jump to the next one by time.
            if (overshot) break;
            fromId = null;
            // Resume past whichever is further: the slice's end, or wherever id paging got to.
            sliceStart = Math.max(sliceEnd, pagedTo) + 1;
        }

        const trades = aggTradesToTrades([...byId.values()].sort((a, b) => a.a - b.a));
        return range.limit != null && trades.length > range.limit ? trades.slice(-range.limit) : trades;
    }

    /**
     * Stream live prints. Batched on a short timer: a busy symbol prints faster than a
     * per-trade callback can be afforded, and the consumer folds a batch as cheaply as one
     * trade. There is no poll fallback — polling a tape drops the prints between rounds,
     * and a dropped print is a permanently wrong delta — so a reconnect BACKFILLS the gap
     * from the trade id it last saw instead.
     */
    subscribeTrades(ticker: string, onTrades: (trades: readonly Trade[]) => void): Unsubscribe {
        const { apiSymbol, isFutures } = parseTicker(ticker);
        if (typeof WebSocket === 'undefined') return () => {};

        let closed = false;
        let ws: WebSocket | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let flush: ReturnType<typeof setInterval> | null = null;
        let buffer: Trade[] = [];
        /** Newest id delivered so far — the anchor a reconnect backfills from. */
        let lastId = 0;
        let lastTime = 0;
        const stream = `${apiSymbol.toLowerCase()}@aggTrade`;

        const deliver = (trades: readonly Trade[]): void => {
            if (closed || trades.length === 0) return;
            for (const t of trades) {
                const id = Number(t.id);
                if (Number.isFinite(id) && id > lastId) lastId = id;
                if (t.time > lastTime) lastTime = t.time;
            }
            onTrades(trades);
        };

        const drain = (): void => {
            if (buffer.length === 0) return;
            const batch = buffer;
            buffer = [];
            deliver(batch);
        };

        // Re-walk what the socket missed while it was down. Overlap is expected and
        // harmless: every print carries its id, so the consumer de-duplicates.
        const backfill = async (): Promise<void> => {
            if (closed || lastTime === 0) return;
            const gap = await this.getTrades(ticker, { from: lastTime, to: Date.now() }).catch(() => [] as Trade[]);
            deliver(gap.filter((t) => Number(t.id) > lastId));
        };

        const open = async (): Promise<void> => {
            if (closed) return;
            const reopening = lastId > 0;
            const base = isFutures ? FUTURES_WS : await this.spotWsBase();
            if (closed) return; // unsubscribed during the host probe
            ws = new WebSocket(`${base}/ws/${stream}`);
            ws.onopen = () => { if (reopening) void backfill(); };
            ws.onmessage = (ev: MessageEvent) => {
                if (closed) return;
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as RawAggTrade & { e?: string };
                    if (msg.a != null && msg.p != null) buffer.push(...aggTradesToTrades([msg]));
                } catch { /* ignore non-JSON / control frames */ }
            };
            ws.onclose = () => { if (!closed) reconnect = setTimeout(() => void open(), STREAM_RECONNECT_MS); };
            ws.onerror = () => { try { ws?.close(); } catch { /* already closed → onclose reconnects */ } };
        };
        flush = setInterval(drain, TRADE_BATCH_MS);
        void open();

        return () => {
            closed = true;
            if (reconnect) clearTimeout(reconnect);
            if (flush) clearInterval(flush);
            try { ws?.close(); } catch { /* ignore */ }
        };
    }

    // ── internals ────────────────────────────────────────────────────────

    /**
     * One aggTrades request, through the rate gate. The response's used-weight header
     * feeds the gate so a long walk throttles itself before Binance does; a 429 pauses
     * every request on the path and a 418 marks the IP banned.
     */
    private async aggTradesChunk(
        base: string,
        isFutures: boolean,
        params: { symbol: string; startTime?: number; endTime?: number; fromId?: number },
    ): Promise<RawAggTrade[]> {
        const url = new URL(`${base}/aggTrades`);
        url.searchParams.set('symbol', params.symbol);
        url.searchParams.set('limit', String(AGG_TRADES_LIMIT));
        if (params.fromId != null) url.searchParams.set('fromId', String(params.fromId));
        else {
            if (params.startTime != null) url.searchParams.set('startTime', String(params.startTime));
            if (params.endTime != null) url.searchParams.set('endTime', String(params.endTime));
        }

        return this.tradeGate.run(async () => {
            const res = await fetch(url.toString());
            const used = Number(res.headers.get('x-mbx-used-weight-1m'));
            if (Number.isFinite(used) && used > 0) {
                this.tradeGate.noteWeight(used, isFutures ? WEIGHT_LIMIT_FUTURES : WEIGHT_LIMIT_SPOT);
            }
            if (res.status === 429) {
                this.tradeGate.pauseFor(retryAfterMs(res, 5_000));
                throw new RateLimitError(`Binance rate-limited the tape for ${params.symbol}`, false);
            }
            if (res.status === 418) {
                this.tradeGate.banFor(retryAfterMs(res, 120_000));
                throw new RateLimitError(`Binance banned this IP (418) on the tape for ${params.symbol}`, true);
            }
            if (!res.ok) throw new Error(`Binance HTTP ${res.status} for ${url.toString()}`);
            const data: unknown = await res.json();
            return Array.isArray(data) ? (data as RawAggTrade[]) : [];
        });
    }


    /**
     * Open a Binance kline WebSocket (single-stream URL form — the stream is in the
     * path, so no subscribe frame is sent). Perpetuals use `fstream`; spot uses the
     * host matching the resolved REST endpoint (`.com`/`.us`). Reconnects on an
     * unexpected close until unsubscribed; the browser auto-answers Binance's
     * protocol-level pings, so no manual keepalive is needed.
     *
     * A stall watchdog falls the subscription back to polling if the socket opens but
     * never delivers a candle — so a blocked/silent stream (e.g. geo-restricted
     * futures) still yields live updates instead of a silently-dead feed.
     */
    private streamKlines(
        ticker: string, timeframe: string, apiSymbol: string, isFutures: boolean, interval: string, onBar: (bar: OHLCV) => void,
    ): Unsubscribe {
        let closed = false;
        let ws: WebSocket | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let stall: ReturnType<typeof setTimeout> | null = null;
        let polling: Unsubscribe | null = null; // engaged when the stream is declared non-delivering
        const stream = `${apiSymbol.toLowerCase()}@kline_${interval}`;

        const clearStall = (): void => { if (stall) { clearTimeout(stall); stall = null; } };

        // Tear down the socket and switch to polling — covers an open-but-silent stream.
        const fallToPolling = (): void => {
            if (closed || polling) return;
            clearStall();
            if (reconnect) { clearTimeout(reconnect); reconnect = null; }
            try { ws?.close(); } catch { /* ignore */ }
            ws = null;
            console.warn(`[vela] Binance: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
            polling = this.pollBars(ticker, timeframe, onBar);
        };

        const open = async (): Promise<void> => {
            if (closed) return;
            const base = isFutures ? FUTURES_WS : await this.spotWsBase();
            if (closed) return; // unsubscribed during the host probe
            ws = new WebSocket(`${base}/ws/${stream}`);
            stall = setTimeout(fallToPolling, STREAM_STALL_MS); // watchdog: data must arrive
            ws.onmessage = (ev: MessageEvent) => {
                if (closed || polling) return; // unsubscribed, or already fell back to polling
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as { k?: KlineEvent };
                    if (msg.k) { clearStall(); onBar(klineEventToOHLCV(msg.k)); }
                } catch { /* ignore non-JSON / control frames */ }
            };
            ws.onclose = () => { if (!closed && !polling) reconnect = setTimeout(() => void open(), STREAM_RECONNECT_MS); };
            ws.onerror = () => { try { ws?.close(); } catch { /* already closed → onclose reconnects */ } };
        };
        void open();

        return () => {
            closed = true;
            clearStall();
            if (reconnect) clearTimeout(reconnect);
            polling?.();
            try { ws?.close(); } catch { /* ignore */ }
        };
    }

    /** WebSocket host matching the resolved REST spot endpoint (`.com` default, else `.us`). */
    private async spotWsBase(): Promise<string> {
        const base = await this.spotBase();
        return base.includes('binance.us') ? SPOT_WS_US : SPOT_WS;
    }

    /** Poll the forming candle (for aggregated timeframes Binance has no native kline stream for). */
    private pollBars(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const poll = async (): Promise<void> => {
            if (stopped) return;
            try {
                const bars = await this.getBars(ticker, timeframe, { limit: 2 });
                for (const b of bars) onBar(b);
            } catch { /* transient — keep polling */ }
            if (!stopped) timer = setTimeout(() => void poll(), 3000);
        };
        timer = setTimeout(() => void poll(), 3000);
        return () => { stopped = true; if (timer) clearTimeout(timer); };
    }

    private async listSpot(): Promise<SymbolDescriptor[]> {
        const base = await this.spotBase();
        const data = (await this.json(`${base}/exchangeInfo`)) as { symbols?: BinanceSymbol[] };
        return (data.symbols ?? [])
            .filter((s) => s.status === 'TRADING')
            .map((s) => ({ ticker: s.symbol, description: `${s.baseAsset} / ${s.quoteAsset}`, type: 'crypto' }));
    }

    private async listFutures(): Promise<SymbolDescriptor[]> {
        const data = (await this.json(`${FUTURES_BASE}/exchangeInfo`)) as { symbols?: BinanceSymbol[] };
        return (data.symbols ?? [])
            .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
            .map((s) => ({ ticker: `${s.symbol}.P`, description: `${s.baseAsset} / ${s.quoteAsset} Perpetual`, type: 'futures' }));
    }

    /** Fetch klines, paginating past Binance's 1000-row cap. */
    private async fetchKlines(base: string, symbol: string, interval: string, range: BarRange): Promise<RawKline[]> {
        if (range.from != null) return this.paginateForward(base, symbol, interval, range.from, range.to ?? Date.now(), range.limit);
        const limit = range.limit ?? 500;
        if (limit > 1000) return this.paginateBackward(base, symbol, interval, limit, range.to);
        return this.klinesChunk(base, { symbol, interval, limit, endTime: range.to });
    }

    /** Forward pagination from `from` to `to` (used by ranged/tail fetches). */
    private async paginateForward(base: string, symbol: string, interval: string, from: number, to: number, limit?: number): Promise<RawKline[]> {
        const out: RawKline[] = [];
        let cursor = from;
        while (cursor < to) {
            const chunk = await this.klinesChunk(base, { symbol, interval, limit: 1000, startTime: cursor, endTime: to });
            if (chunk.length === 0) break;
            out.push(...chunk);
            cursor = Number(chunk[chunk.length - 1]![6]) + 1; // last closeTime + 1ms
            if (chunk.length < 1000) break;
            if (limit && out.length >= limit) break;
        }
        return limit ? out.slice(0, limit) : out;
    }

    /** Backward pagination to assemble the most-recent `limit` bars. */
    private async paginateBackward(base: string, symbol: string, interval: string, limit: number, endTime?: number): Promise<RawKline[]> {
        let out: RawKline[] = [];
        let remaining = limit;
        let cursor = endTime;
        let guard = Math.ceil(limit / 1000) + 5;
        while (remaining > 0 && guard-- > 0) {
            const size = Math.min(remaining, 1000);
            const chunk = await this.klinesChunk(base, { symbol, interval, limit: size, endTime: cursor });
            if (chunk.length === 0) break;
            out = chunk.concat(out);
            remaining -= chunk.length;
            cursor = Number(chunk[0]![0]) - 1; // earliest openTime - 1ms
            if (chunk.length < size) break;
        }
        return out;
    }

    private async klinesChunk(
        base: string,
        params: { symbol: string; interval: string; limit?: number; startTime?: number; endTime?: number },
    ): Promise<RawKline[]> {
        const url = new URL(`${base}/klines`);
        url.searchParams.set('symbol', params.symbol);
        url.searchParams.set('interval', params.interval);
        if (params.limit) url.searchParams.set('limit', String(Math.min(params.limit, 1000)));
        if (params.startTime != null) url.searchParams.set('startTime', String(params.startTime));
        if (params.endTime != null) url.searchParams.set('endTime', String(params.endTime));
        const data = await this.json(url.toString());
        if (!Array.isArray(data)) return [];
        // Binance returns an array OF arrays; guard against a malformed flat array.
        if (data.length > 0 && !Array.isArray(data[0])) return [];
        return data as RawKline[];
    }

    /**
     * Resolve the reachable spot endpoint (default, else the US mirror). The in-flight
     * probe is shared, so a burst of concurrent first calls issues ONE ping pair, not one
     * per call. A confirmed endpoint is cached permanently; a total failure clears the
     * probe so a later call can retry.
     */
    private spotBase(): Promise<string> {
        if (this.spotBaseUrl) return Promise.resolve(this.spotBaseUrl);
        if (!this.spotBaseProbe) {
            this.spotBaseProbe = (async () => {
                try {
                    for (const url of [SPOT_BASE, SPOT_BASE_US]) {
                        try {
                            const res = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(5000) });
                            if (res.ok) return (this.spotBaseUrl = url);
                        } catch {
                            // try the next endpoint
                        }
                    }
                    return SPOT_BASE; // give up; let the actual request surface the error
                } finally {
                    this.spotBaseProbe = null; // allow a fresh probe later if no endpoint was cached
                }
            })();
        }
        return this.spotBaseProbe;
    }

    private async json(url: string): Promise<unknown> {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Binance HTTP ${res.status} for ${url}`);
        return res.json();
    }
}

/** The kline payload (`k`) of a Binance `@kline` WS event (the fields this provider reads). */
interface KlineEvent {
    t: number; // open time (ms)
    o: string | number;
    h: string | number;
    l: string | number;
    c: string | number;
    v: string | number;
    x?: boolean; // whether this kline has closed
}

/** The subset of a Binance `exchangeInfo` symbol entry this provider reads. */
interface BinanceSymbol {
    symbol: string;
    status?: string;
    baseAsset: string;
    quoteAsset: string;
    contractType?: string;
    filters?: Array<{ filterType: string; tickSize?: string }>;
}
