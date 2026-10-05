import type { OHLCV } from '../../../core/model/ohlcv';
import type { BarRange, SymbolInfo } from '../../../core/ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, SymbolDescriptor } from '../../../core/ports/DataProvider';
import { baseOf, ledgerCryptoIconUrl } from '../../symbol-base';
import type { Unsubscribe } from '../../../core/util/types';
import { RequestGate } from '../RequestGate';

const REST_BASE = 'https://www.okx.com/api/v5';
const WS_URL = 'wss://ws.okx.com/ws/v5/business';
/**
 * If a candle socket opens but delivers no candle within this window, treat it as
 * non-delivering and fall back to polling. OKX re-pushes the forming candle about every
 * 10s even without trades, so silence past this window means a blocked or dead stream.
 */
const STREAM_STALL_MS = 15_000;
/** Reconnect backoff after an unexpected socket close. */
const STREAM_RECONNECT_MS = 2_000;

/** Both candle endpoints cap a page at 300 rows. */
const MAX_CANDLES_PER_REQ = 300;
/** `/market/candles` reaches back only this many bars; older pages come from `/market/history-candles`. */
const RECENT_WINDOW_BARS = 1440;

/**
 * Public REST shaping: `history-candles` allows 20 req/2s per IP and answers the excess with
 * HTTP 429, which concurrent walks (initial load + backfill + polling, several charts) hit.
 */
const REST_CONCURRENCY = 4;
const REST_MIN_INTERVAL_MS = 110;
/** How many times a single request retries after a 429 before giving up. */
const REQUEST_MAX_RETRIES = 4;
/** Exponential-backoff base + jitter for a 429 retry (OKX sends no Retry-After) (ms). */
const BACKOFF_BASE_MS = 600;
const BACKOFF_JITTER_MS = 400;

/** One raw OKX candle row: `[ts(ms), o, h, l, c, vol, volCcy, volCcyQuote, confirm]`, all strings. */
type RawCandle = string[];

/** The envelope every OKX REST answer is wrapped in; `code !== '0'` is an error even on HTTP 200. */
interface OkxEnvelope {
    code?: string;
    msg?: string;
    data?: unknown;
}

/** The OKX instrument classes this provider serves (instrument ids are the tickers). */
export type InstType = 'SPOT' | 'SWAP' | 'FUTURES';

/**
 * Canonical timeframe → OKX bar (native, no aggregation). Six hours and longer use the `utc`
 * variants: the plain `6H`/`12H`/`1D`/`1W`/`1M` bars are aligned to UTC+8.
 */
const TF_TO_BAR: Record<string, string> = {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
    '60': '1H', '120': '2H', '240': '4H', '360': '6Hutc', '720': '12Hutc',
    D: '1Dutc', W: '1Wutc', M: '1Mutc',
};

/** User-facing timeframe aliases → canonical keys (matches the other Vela layers). */
const TF_NORMALIZE: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45',
    '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
    '1d': 'D', '1w': 'W', '1mo': 'M', '1D': 'D', '1W': 'W', '4H': '240',
    D: 'D', W: 'W', M: 'M',
};

/** Native intraday timeframes in minutes (the aggregation sub-candle candidates). */
const NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 360, 720];
const MIN_TO_BAR: Record<number, string> = {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 120: '2H', 240: '4H', 360: '6Hutc', 720: '12Hutc',
};
const SUPPORTED_TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '360', '480', '720', 'D', 'W', 'M'];

/** Duration of one canonical-timeframe bar in ms (paging decisions only; not bar alignment). */
const TF_MS: Record<string, number> = { D: 86_400_000, W: 604_800_000, M: 2_678_400_000 }; // month = 31d
function tfMs(tf: string): number {
    if (TF_MS[tf]) return TF_MS[tf];
    const min = parseInt(tf, 10);
    return Number.isFinite(min) && min > 0 ? min * 60_000 : 3_600_000;
}

/** Normalize a user timeframe to a canonical key. */
export function normalizeTf(tf: string): string {
    return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}

/** Map a Vela ticker to an OKX instrument id (`BTC-USDT`, `BTC-USDT-SWAP`). Upper-cased; whitespace trimmed. */
export function parseInstId(ticker: string): string {
    return ticker.trim().toUpperCase();
}

/** The instrument class an OKX instrument id names: `…-SWAP` perpetuals, `…-YYMMDD` dated futures, else spot. */
export function instTypeOf(instId: string): InstType {
    if (instId.endsWith('-SWAP')) return 'SWAP';
    if (/-\d{6}$/.test(instId)) return 'FUTURES';
    return 'SPOT';
}

/**
 * Map one raw OKX candle row to neutral OHLCV. Derivatives count `vol` in contracts, so their
 * base-currency volume is `volCcy` — which keeps spot and perpetual volume on the same unit.
 */
export function candleRowToOHLCV(r: RawCandle, derivative: boolean): OHLCV {
    return {
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(derivative ? r[6] : r[5]),
    };
}

/** Sort by open-time and drop duplicate open-times (incoming wins) — the bar contract. */
function dedupeSorted(bars: OHLCV[]): OHLCV[] {
    const byTime = new Map<number, OHLCV>();
    for (const b of bars) byTime.set(b.time, b);
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Aggregate ascending sub-candles into `bucketMs` buckets aligned to the epoch. */
function aggregate(sub: OHLCV[], bucketMs: number): OHLCV[] {
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

/** Keep the most-recent `limit` bars when a count was requested (no-op when unbounded). */
function clampLimit(bars: OHLCV[], limit?: number): OHLCV[] {
    return limit != null && bars.length > limit ? bars.slice(-limit) : bars;
}

/**
 * OKX market-data provider, built from scratch on the public v5 REST + WebSocket APIs — no
 * third-party SDK, no API key. Tickers are OKX instrument ids: spot (`BTC-USDT`, `ETH-USDC`),
 * perpetual swaps (`BTC-USDT-SWAP`, inverse `BTC-USD-SWAP`) and, by explicit id, dated futures
 * (`BTC-USD-251226`). History pages through `/market/candles` for the recent window and
 * `/market/history-candles` beyond it, back to listing. Timeframes OKX doesn't serve natively
 * (e.g. `45`, `180`, `480`) are aggregated; daily and longer bars are UTC-aligned. Live ticks
 * stream from the native candle WebSocket, with a poll fallback.
 *
 *   import { OkxProvider } from 'vela/providers/okx';
 *   chart.data.registerProvider('okx', new OkxProvider());
 */
export class OkxProvider implements DataProvider {
    /** Cached symbol enumeration (the instrument lists are large; fetch once). */
    private symbolsPromise: Promise<SymbolDescriptor[]> | null = null;
    /** Shared request gate: caps concurrency, spaces request starts, honors rate-limit backoff. */
    private readonly gate = new RequestGate(REST_CONCURRENCY, REST_MIN_INTERVAL_MS);

    info(): ProviderInfo {
        return {
            name: 'okx',
            displayName: 'OKX',
            requiresApiKey: false,
            supportedTimeframes: SUPPORTED_TIMEFRAMES,
            capabilities: { enumerate: true, stream: true, symbolInfo: true },
        };
    }

    async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        try {
            const instId = parseInstId(ticker);
            const tf = normalizeTf(timeframe);

            const bar = TF_TO_BAR[tf];
            if (bar) return await this.fetchCandles(instId, bar, tfMs(tf), range);

            // Aggregation path: fetch a native sub-timeframe and combine.
            const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
            const subMin = targetMin != null ? selectSubTf(targetMin) : null;
            if (targetMin == null || subMin == null) {
                console.warn(`[vela] OKX: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
                return [];
            }
            const ratio = targetMin / subMin;
            const subRange: BarRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : undefined };
            const sub = await this.fetchCandles(instId, MIN_TO_BAR[subMin]!, subMin * 60_000, subRange);
            return clampLimit(aggregate(sub, targetMin * 60_000), range.limit);
        } catch (e) {
            // Fail soft (consistent with the other providers): empty + warning rather than rejecting.
            console.warn(`[vela] OKX: failed to fetch ${ticker} ${timeframe} — ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }
    }

    async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
        const instId = parseInstId(ticker);
        const instType = instTypeOf(instId);
        const url = `${REST_BASE}/public/instruments?instType=${instType}&instId=${encodeURIComponent(instId)}`;
        const list = (await this.json(url).catch(() => null)) as OkxInstrument[] | null;
        const inst = Array.isArray(list) ? list[0] : undefined;
        if (!inst) return undefined;
        const { base, quote } = pairOf(inst);
        const tickSize = parseFloat(inst.tickSz ?? '');
        const mintick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
        return {
            ticker, // keep the original ticker (as Pine Script expects)
            tickerid: `OKX:${ticker}`,
            prefix: 'OKX',
            description: describe(base, quote, instType),
            type: instType === 'SPOT' ? 'crypto' : 'futures',
            basecurrency: base,
            currency: quote,
            mintick,
            pricescale: Math.round(1 / mintick),
            timezone: 'Etc/UTC',
            session: '24x7',
        };
    }

    listSymbols(): Promise<SymbolDescriptor[]> {
        if (!this.symbolsPromise) {
            this.symbolsPromise = Promise.all([
                this.listInstruments('SPOT').catch(() => [] as SymbolDescriptor[]),
                this.listInstruments('SWAP').catch(() => [] as SymbolDescriptor[]),
            ]).then(([spot, swaps]) => [...spot, ...swaps]);
        }
        return this.symbolsPromise;
    }

    /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
     *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
    resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
        return ledgerCryptoIconUrl(baseOf(symbol));
    }

    subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        const instId = parseInstId(ticker);
        const bar = TF_TO_BAR[normalizeTf(timeframe)];
        // Native bar + a WebSocket implementation ⇒ true streaming. Otherwise
        // (aggregated timeframe, or no WebSocket) fall back to polling getBars.
        if (bar && typeof WebSocket !== 'undefined') return this.streamCandles(ticker, timeframe, instId, bar, onBar);
        return this.pollBars(ticker, timeframe, onBar);
    }

    // ── internals ────────────────────────────────────────────────────────

    private async listInstruments(instType: 'SPOT' | 'SWAP'): Promise<SymbolDescriptor[]> {
        const list = (await this.json(`${REST_BASE}/public/instruments?instType=${instType}`)) as OkxInstrument[];
        return (Array.isArray(list) ? list : [])
            .filter((i) => i.state === 'live')
            .map((i) => {
                const { base, quote } = pairOf(i);
                return { ticker: i.instId, description: describe(base, quote, instType), type: instType === 'SPOT' ? 'crypto' : 'futures' };
            });
    }

    /**
     * Walk backward from `range.to` (or the live tip) in ≤300-row pages. Pages come from
     * `/market/candles` while the cursor sits inside its recent window, and from
     * `/market/history-candles` once that window runs out. A `from` bound walks the whole
     * `[from, to]` window and keeps its oldest `limit` bars; a count-only request keeps the
     * newest `limit`. Returns ascending OHLCV.
     */
    private async fetchCandles(instId: string, bar: string, barMs: number, range: BarRange): Promise<OHLCV[]> {
        const derivative = instTypeOf(instId) !== 'SPOT';
        const from = range.from;
        const want = from == null ? range.limit ?? 500 : Infinity;
        // Both bounds are exclusive. No `after` on the first page when `to` is open, so a
        // client clock running behind the venue still receives the forming bar.
        let after = range.to != null ? range.to + 1 : undefined;
        const before = from != null ? from - 1 : undefined;
        let guard = from != null
            ? Math.ceil(((range.to ?? Date.now()) - from) / barMs / MAX_CANDLES_PER_REQ) + 4
            : Math.ceil(want / MAX_CANDLES_PER_REQ) + 4;
        let useHistory = false;
        let out: OHLCV[] = [];

        while (out.length < want && guard-- > 0) {
            useHistory ||= after != null && after <= Date.now() - RECENT_WINDOW_BARS * barMs;
            const size = Math.min(MAX_CANDLES_PER_REQ, want - out.length);
            const rows = await this.candlesPage(useHistory ? 'history-candles' : 'candles', instId, bar, size, after, before);
            const page = rows.map((r) => candleRowToOHLCV(r, derivative)).sort((a, b) => a.time - b.time);
            if (page.length > 0) {
                const oldest = page[0]!.time;
                if (after != null && oldest >= after) break; // defensive: no backward progress
                out = page.concat(out);
                after = oldest;
            }
            if (page.length === size) continue;
            // A short page means the walk reached `from` or the listing — unless it was only the
            // recent window running out, in which case the walk continues into history.
            if (useHistory) break;
            if (from != null && after != null && after - barMs < from) break;
            useHistory = true;
        }

        const sorted = dedupeSorted(out);
        if (from != null) return range.limit != null ? sorted.slice(0, range.limit) : sorted;
        return clampLimit(sorted, want);
    }

    /** One candles request (newest-first rows), bounded by the exclusive `after`/`before` open-times. */
    private async candlesPage(
        endpoint: 'candles' | 'history-candles', instId: string, bar: string, limit: number, after?: number, before?: number,
    ): Promise<RawCandle[]> {
        const url = new URL(`${REST_BASE}/market/${endpoint}`);
        url.searchParams.set('instId', instId);
        url.searchParams.set('bar', bar);
        url.searchParams.set('limit', String(limit));
        if (after != null) url.searchParams.set('after', String(Math.floor(after)));
        if (before != null) url.searchParams.set('before', String(Math.floor(before)));
        const data = await this.json(url.toString());
        if (!Array.isArray(data) || (data.length > 0 && !Array.isArray(data[0]))) return [];
        return data as RawCandle[];
    }

    /**
     * Open an OKX candle WebSocket (`candle<bar>` on the business endpoint); reconnects on an
     * unexpected close until unsubscribed. A stall watchdog falls the subscription back to
     * polling if the socket opens but never delivers a candle, so live updates never go
     * silently dead.
     */
    private streamCandles(
        ticker: string, timeframe: string, instId: string, bar: string, onBar: (bar: OHLCV) => void,
    ): Unsubscribe {
        const derivative = instTypeOf(instId) !== 'SPOT';
        const channel = `candle${bar}`;
        let closed = false;
        let ws: WebSocket | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let stall: ReturnType<typeof setTimeout> | null = null;
        let polling: Unsubscribe | null = null;

        const clearStall = (): void => { if (stall) { clearTimeout(stall); stall = null; } };

        const fallToPolling = (): void => {
            if (closed || polling) return;
            clearStall();
            if (reconnect) { clearTimeout(reconnect); reconnect = null; }
            try { ws?.close(); } catch { /* ignore */ }
            ws = null;
            console.warn(`[vela] OKX: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
            polling = this.pollBars(ticker, timeframe, onBar);
        };

        const open = (): void => {
            if (closed || polling) return;
            ws = new WebSocket(WS_URL);
            clearStall(); // a socket that closed before its first candle left its watchdog armed
            stall = setTimeout(fallToPolling, STREAM_STALL_MS);
            ws.onopen = () => {
                try { ws?.send(JSON.stringify({ op: 'subscribe', args: [{ channel, instId }] })); }
                catch { /* the watchdog falls back if this never delivers */ }
            };
            ws.onmessage = (ev: MessageEvent) => {
                if (closed || polling) return;
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as { arg?: { channel?: string; instId?: string }; data?: RawCandle[] };
                    if (msg.arg?.channel !== channel || msg.arg.instId !== instId || !Array.isArray(msg.data)) return;
                    clearStall();
                    const bars = msg.data.map((r) => candleRowToOHLCV(r, derivative)).sort((a, b) => a.time - b.time);
                    for (const b of bars) onBar(b);
                } catch { /* ignore non-JSON / unrelated frames */ }
            };
            ws.onclose = () => { if (!closed && !polling) reconnect = setTimeout(open, STREAM_RECONNECT_MS); };
            ws.onerror = () => { try { ws?.close(); } catch { /* already closed → onclose reconnects */ } };
        };
        open();

        return () => {
            closed = true;
            clearStall();
            if (reconnect) clearTimeout(reconnect);
            polling?.();
            try { ws?.close(); } catch { /* ignore */ }
        };
    }

    /** Poll the forming candle (aggregated timeframes, or environments without WebSocket). */
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

    /**
     * GET → the envelope's `data`, through the shared {@link gate}. Retries a 429 with
     * exponential backoff + jitter; any other non-`'0'` code throws with OKX's message.
     */
    private async json(url: string): Promise<unknown> {
        for (let attempt = 0; ; attempt += 1) {
            const res = await this.gate.run(() => fetch(url));
            if (res.status === 429 && attempt < REQUEST_MAX_RETRIES) {
                this.gate.pauseFor(BACKOFF_BASE_MS * 2 ** attempt + Math.random() * BACKOFF_JITTER_MS);
                continue;
            }
            const body = (await res.json().catch(() => null)) as OkxEnvelope | null;
            if (!body || body.code !== '0') {
                const detail = body?.code ? `code ${body.code}${body.msg ? ` (${body.msg})` : ''}` : `HTTP ${res.status}`;
                throw new Error(`OKX ${detail} for ${url}`);
            }
            return body.data;
        }
    }
}

/** Base/quote of an instrument. Spot carries them directly; derivatives name the pair in `uly` (`BTC-USDT`). */
function pairOf(i: OkxInstrument): { base: string; quote: string } {
    if (i.baseCcy && i.quoteCcy) return { base: i.baseCcy, quote: i.quoteCcy };
    const [base = '', quote = ''] = (i.uly ?? '').split('-');
    return { base, quote };
}

function describe(base: string, quote: string, instType: InstType): string {
    const pair = `${base} / ${quote}`;
    if (instType === 'SWAP') return `${pair} Perpetual`;
    if (instType === 'FUTURES') return `${pair} Futures`;
    return pair;
}

/** The subset of an OKX `/public/instruments` entry this provider reads. */
interface OkxInstrument {
    instId: string;
    baseCcy?: string;
    quoteCcy?: string;
    uly?: string;
    tickSz?: string;
    state?: string;
}
