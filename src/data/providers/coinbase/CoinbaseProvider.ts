import type { OHLCV } from '../../../core/model/ohlcv';
import type { BarRange, SymbolInfo } from '../../../core/ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from '../../../core/ports/DataProvider';
import { baseOf, ledgerCryptoIconUrl } from '../../symbol-base';
import type { Unsubscribe } from '../../../core/util/types';
import { RequestGate } from './RequestGate';

const REST_BASE = 'https://api.exchange.coinbase.com';
const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
/** Browsers supply User-Agent; Accept keeps the JSON content negotiation explicit. */
const REQ_HEADERS = { Accept: 'application/json' };
/**
 * If a ticker socket opens but delivers no price within this window, treat it as
 * non-delivering and fall back to polling — covers an illiquid product (no trades) or a
 * blocked endpoint that ACKs the subscription yet stays silent, so live updates never go dead.
 */
const STREAM_STALL_MS = 15_000;
/** Reconnect backoff after an unexpected socket close. */
const STREAM_RECONNECT_MS = 2_000;
/**
 * Coinbase has no native candle stream, so a forming bar is built from the `ticker` channel
 * (smooth price) re-seeded from REST candles on this cadence for an authoritative open/volume.
 */
const LIVE_RESEED_MS = 5_000;

/** Coinbase ranged-candle hard cap: at most 300 buckets per request (a wider range → HTTP 400). */
const MAX_CANDLES_PER_REQ = 300;

/** Public REST shaping: a small concurrency cap + min-spacing keeps the sustained rate under ~10/s. */
const REST_CONCURRENCY = 4;
const REST_MIN_INTERVAL_MS = 120;
/** How many times a single request retries after a 429 before giving up. */
const REQUEST_MAX_RETRIES = 4;
/** Exponential-backoff base + jitter for a 429 retry when no Retry-After is given (ms). */
const BACKOFF_BASE_MS = 600;
const BACKOFF_JITTER_MS = 400;

/** A `Retry-After` header (seconds) as ms, falling back to `fallbackMs` when absent/invalid. */
function retryAfterMs(res: Response, fallbackMs: number): number {
    const sec = Number(res.headers.get('retry-after'));
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : fallbackMs;
}

/** One raw Coinbase candle row: `[time(sec), low, high, open, close, volume]` (note: low before high). */
type RawCandle = number[];

/** One raw Coinbase trade. `side` is the MAKER order side (inverted to get the aggressor). */
/** The subset of a Coinbase product entry this provider reads. */
interface CoinbaseProduct {
    id: string;
    base_currency: string;
    quote_currency: string;
    quote_increment?: string;
    base_increment?: string;
    status?: string;
    trading_disabled?: boolean;
}

/** Canonical timeframe → Coinbase candle granularity (seconds). Native, no aggregation. */
const TF_TO_GRAN: Record<string, number> = {
    '1': 60, '5': 300, '15': 900, '60': 3600, '360': 21600, D: 86400,
};

/** User-facing timeframe aliases → canonical keys (matches the other Vela layers). */
const TF_NORMALIZE: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45',
    '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
    '1d': 'D', '1w': 'W', '1mo': 'M', '1D': 'D', '1W': 'W', '4H': '240',
    D: 'D', W: 'W', M: 'M',
};

/** Native granularities in minutes (the aggregation sub-candle candidates Coinbase serves directly). */
const NATIVE_MINUTES = [1, 5, 15, 60, 360, 1440];
const MIN_TO_GRAN: Record<number, number> = { 1: 60, 5: 300, 15: 900, 60: 3600, 360: 21600, 1440: 86400 };
const SUPPORTED_TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '360', '480', '720', 'D', 'W', 'M'];

const MS_PER_DAY = 86_400_000;

/** Normalize a user timeframe to a canonical key. */
export function normalizeTf(tf: string): string {
    return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}

/** Map a Vela ticker to a Coinbase product id (`BTC-USD`). Upper-cased; whitespace trimmed. */
export function parseProductId(ticker: string): string {
    return ticker.trim().toUpperCase();
}

/** Map a single raw Coinbase candle to neutral OHLCV. Row order is `[time, LOW, HIGH, open, close, volume]`. */
export function candleRowToOHLCV(r: RawCandle): OHLCV {
    return { time: Number(r[0]) * 1000, open: Number(r[3]), high: Number(r[2]), low: Number(r[1]), close: Number(r[4]), volume: Number(r[5]) };
}


/** Sort by open-time and drop duplicate open-times (incoming wins) — the bar contract. */
export function dedupeSorted(bars: OHLCV[]): OHLCV[] {
    const byTime = new Map<number, OHLCV>();
    for (const b of bars) byTime.set(b.time, b);
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Aggregate ascending sub-candles into `bucketMs` buckets aligned to the epoch (intraday timeframes). */
export function aggregate(sub: OHLCV[], bucketMs: number): OHLCV[] {
    return aggregateBy(sub, (t) => Math.floor(t / bucketMs) * bucketMs);
}

/**
 * Aggregate ascending daily candles into calendar weeks (Monday-aligned, UTC) or calendar months
 * (UTC) — Coinbase has no native weekly/monthly granularity, so `W`/`M` are folded from `1d`.
 */
export function aggregateCalendar(sub: OHLCV[], unit: 'W' | 'M'): OHLCV[] {
    return aggregateBy(sub, unit === 'W' ? weekStartUTC : monthStartUTC);
}

/** Fold ascending sub-candles into buckets keyed by `keyMs(time)`; bucket time = the key. */
function aggregateBy(sub: OHLCV[], keyMs: (timeMs: number) => number): OHLCV[] {
    const buckets = new Map<number, OHLCV>();
    for (const b of sub) {
        const key = keyMs(b.time);
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

/** Start of the Monday-aligned UTC week containing `ms`. */
function weekStartUTC(ms: number): number {
    const d = new Date(ms);
    const sinceMonday = (d.getUTCDay() + 6) % 7; // 0=Sun..6=Sat → days since Monday
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}

/** Start of the calendar UTC month containing `ms`. */
function monthStartUTC(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
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
 * Coinbase market-data provider, built from scratch on the public Exchange REST + WebSocket APIs
 * — no third-party SDK, no API key. Serves spot products (`BTC-USD`, `ETH-EUR`, …), paginates past the
 * 300-candle cap, aggregates timeframes Coinbase doesn't serve natively (e.g. `30`, `4h`) and
 * folds `W`/`M` from daily. Live ticks build a forming candle from the `ticker` stream (Coinbase
 * has no native kline stream), with a poll fallback.
 *
 * Trades: Coinbase trades cursor-walk back from the live tip (the `cb-after` header) with no
 * time-seek, so trade-derived depth is `'recent'` — live and recent windows reconstruct; older bars
 * are served empty rather than walked unbounded.
 *
 *   import { CoinbaseProvider } from 'vela/providers/coinbase';
 *   chart.data.registerProvider('coinbase', new CoinbaseProvider());
 */
export class CoinbaseProvider implements DataProvider {
    /** Cached symbol enumeration (the products list is large; fetch once). */
    private symbolsPromise: Promise<SymbolDescriptor[]> | null = null;
    /** Shared request gate: caps concurrency, spaces request starts, honors 429 backoff. */
    private readonly gate = new RequestGate(REST_CONCURRENCY, REST_MIN_INTERVAL_MS);

    info(): ProviderInfo {
        return {
            name: 'coinbase',
            displayName: 'Coinbase',
            requiresApiKey: false,
            supportedTimeframes: SUPPORTED_TIMEFRAMES,
            capabilities: { enumerate: true, stream: true, symbolInfo: true },
        };
    }


    async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        try {
            const product = parseProductId(ticker);
            const tf = normalizeTf(timeframe);

            const gran = TF_TO_GRAN[tf];
            if (gran) return dedupeSorted(await this.fetchCandles(product, gran, range));

            // Calendar aggregation: W/M fold from daily candles (Coinbase has no weekly/monthly granularity).
            if (tf === 'W' || tf === 'M') {
                const span = tf === 'W' ? 7 * MS_PER_DAY : 31 * MS_PER_DAY;
                const subRange: BarRange = range.from != null
                    ? range
                    : { ...range, limit: range.limit != null ? Math.ceil((range.limit * span) / MS_PER_DAY) + 31 : undefined };
                const sub = await this.fetchCandles(product, 86400, subRange);
                return clampLimit(aggregateCalendar(sub, tf), range.limit);
            }

            // Numeric intraday aggregation from a native sub-timeframe.
            const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
            const subMin = targetMin != null ? selectSubTf(targetMin) : null;
            if (targetMin == null || subMin == null) {
                console.warn(`[vela] Coinbase: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
                return [];
            }
            const ratio = targetMin / subMin;
            const subRange: BarRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : undefined };
            const sub = await this.fetchCandles(product, MIN_TO_GRAN[subMin]!, subRange);
            return clampLimit(aggregate(sub, targetMin * 60_000), range.limit);
        } catch (e) {
            // Fail soft (consistent with the other providers): empty + warning rather than rejecting.
            console.warn(`[vela] Coinbase: failed to fetch ${ticker} ${timeframe} — ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }
    }


    async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
        const product = parseProductId(ticker);
        const p = (await this.json(`${REST_BASE}/products/${product}`).catch(() => null)) as CoinbaseProduct | null;
        if (!p || !p.id) return undefined;
        const tickSize = p.quote_increment != null ? parseFloat(p.quote_increment) : 0.01;
        const mintick = tickSize > 0 ? tickSize : 0.01;
        return {
            ticker, // keep the original ticker (as Pine Script expects)
            tickerid: `COINBASE:${ticker}`,
            prefix: 'COINBASE',
            description: `${p.base_currency} / ${p.quote_currency}`,
            type: 'crypto',
            basecurrency: p.base_currency,
            currency: p.quote_currency,
            mintick,
            pricescale: Math.round(1 / mintick),
            timezone: 'Etc/UTC',
            session: '24x7',
        };
    }

    listSymbols(): Promise<SymbolDescriptor[]> {
        if (!this.symbolsPromise) {
            this.symbolsPromise = this.fetchProducts()
                .then((products) => products
                    .filter((p) => p.status === 'online' && !p.trading_disabled)
                    .map((p) => ({ ticker: p.id, description: `${p.base_currency} / ${p.quote_currency}`, type: 'crypto' })))
                .catch(() => [] as SymbolDescriptor[]);
        }
        return this.symbolsPromise;
    }

    /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
     *  the BASE asset (the description's first segment, else the de-suffixed ticker). */
    resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
        return ledgerCryptoIconUrl(baseOf(symbol));
    }

    subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        const gran = TF_TO_GRAN[normalizeTf(timeframe)];
        // Native granularity + a WebSocket implementation ⇒ ticker-built streaming. Otherwise
        // (aggregated timeframe, W/M, or no WebSocket) fall back to polling getBars.
        if (gran && typeof WebSocket !== 'undefined') return this.streamTicker(ticker, timeframe, gran, onBar);
        return this.pollBars(ticker, timeframe, onBar);
    }

    // ── internals ────────────────────────────────────────────────────────

    private async fetchProducts(): Promise<CoinbaseProduct[]> {
        const data = await this.json(`${REST_BASE}/products`);
        return Array.isArray(data) ? (data as CoinbaseProduct[]) : [];
    }

    /**
     * Fetch candles for a count (most-recent `limit`) or a `[from, to]` range, paginating past the
     * 300-bucket cap. Returns ascending OHLCV (newest-first rows from the API are sorted on the way out).
     */
    private async fetchCandles(product: string, granSec: number, range: BarRange): Promise<OHLCV[]> {
        if (range.from != null) return this.paginateForward(product, granSec, range.from, range.to ?? Date.now(), range.limit);
        return this.paginateBackward(product, granSec, range.limit ?? 500, range.to ?? Date.now());
    }

    /** Assemble the most-recent `limit` bars, walking backward in ≤300-bucket windows. */
    private async paginateBackward(product: string, granSec: number, limit: number, endMs: number): Promise<OHLCV[]> {
        const granMs = granSec * 1000;
        let out: OHLCV[] = [];
        let remaining = limit;
        let cursorEnd = endMs;
        let guard = Math.ceil(limit / MAX_CANDLES_PER_REQ) + 4;
        while (remaining > 0 && guard-- > 0) {
            const size = Math.min(remaining, MAX_CANDLES_PER_REQ);
            const startMs = cursorEnd - size * granMs;
            const rows = await this.candlesChunk(product, granSec, startMs, cursorEnd);
            if (rows.length === 0) break;
            out = rows.concat(out);
            remaining -= rows.length;
            cursorEnd = rows[0]!.time - 1; // earliest bar's open-time − 1ms
            if (rows.length < size) break; // drained available history
        }
        return clampLimit(dedupeSorted(out), limit);
    }

    /** Walk `[from, to]` forward in ≤300-bucket windows (ranged/tail fetches). */
    private async paginateForward(product: string, granSec: number, fromMs: number, toMs: number, limit?: number): Promise<OHLCV[]> {
        const granMs = granSec * 1000;
        const out: OHLCV[] = [];
        let cursor = fromMs;
        let guard = Math.ceil((toMs - fromMs) / (MAX_CANDLES_PER_REQ * granMs)) + 4;
        while (cursor < toMs && guard-- > 0) {
            const windowEnd = Math.min(cursor + MAX_CANDLES_PER_REQ * granMs, toMs);
            const rows = await this.candlesChunk(product, granSec, cursor, windowEnd);
            if (rows.length > 0) out.push(...rows);
            cursor = windowEnd; // advance a full window; the one-bucket overlap is deduped out
            if (limit != null && out.length >= limit) break;
        }
        const sorted = dedupeSorted(out);
        return limit != null ? sorted.slice(0, limit) : sorted;
    }

    /** One candles request over `[startMs, endMs]` → ascending OHLCV (the API returns newest-first). */
    private async candlesChunk(product: string, granSec: number, startMs: number, endMs: number): Promise<OHLCV[]> {
        const url = new URL(`${REST_BASE}/products/${product}/candles`);
        url.searchParams.set('granularity', String(granSec));
        url.searchParams.set('start', String(Math.floor(startMs / 1000)));
        url.searchParams.set('end', String(Math.floor(endMs / 1000)));
        const data = await this.json(url.toString());
        if (!Array.isArray(data) || (data.length > 0 && !Array.isArray(data[0]))) return [];
        return (data as RawCandle[]).map(candleRowToOHLCV).sort((a, b) => a.time - b.time);
    }

    /**
     * Build a forming candle from the Coinbase `ticker` channel (Coinbase has no native kline stream):
     * the stream supplies a smooth live price/high/low, while a periodic REST re-seed fixes the
     * authoritative open + volume and corrects any drift. A stall watchdog falls back to polling if the
     * socket opens but never delivers a price; reconnects on an unexpected close until unsubscribed.
     */
    private streamTicker(ticker: string, timeframe: string, granSec: number, onBar: (bar: OHLCV) => void): Unsubscribe {
        const product = parseProductId(ticker);
        const granMs = granSec * 1000;
        const align = (ms: number): number => Math.floor(ms / granMs) * granMs;
        let closed = false;
        let ws: WebSocket | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let stall: ReturnType<typeof setTimeout> | null = null;
        let reseedTimer: ReturnType<typeof setInterval> | null = null;
        let polling: Unsubscribe | null = null;
        let current: OHLCV | null = null;

        const clearStall = (): void => { if (stall) { clearTimeout(stall); stall = null; } };
        const clearReseed = (): void => { if (reseedTimer) { clearInterval(reseedTimer); reseedTimer = null; } };
        const emit = (): void => { if (current) onBar({ ...current }); };

        // Pull the authoritative recent bars from REST; merge the forming one with the live extremes.
        const reseed = async (emitClosed: boolean): Promise<void> => {
            try {
                const bars = await this.getBars(ticker, timeframe, { limit: 2 });
                if (closed || bars.length === 0) return;
                if (emitClosed && bars.length >= 2) onBar(bars[bars.length - 2]!); // the just-closed previous bar
                const last = bars[bars.length - 1]!;
                current = current && current.time === last.time
                    ? { ...last, high: Math.max(last.high, current.high), low: Math.min(last.low, current.low), close: current.close }
                    : { ...last };
                emit();
            } catch { /* transient — the next reseed/tick recovers */ }
        };

        const onTick = (priceStr: string, tMs: number): void => {
            const price = Number(priceStr);
            if (!Number.isFinite(price)) return;
            const barStart = align(tMs);
            if (!current || barStart > current.time) {
                current = { time: barStart, open: price, high: price, low: price, close: price, volume: 0 }; // provisional until reseed
                emit();
                void reseed(false); // fetch the authoritative open/volume for the new bar
            } else if (barStart === current.time) {
                current = { ...current, close: price, high: Math.max(current.high, price), low: Math.min(current.low, price) };
                emit();
            } // a stale tick (barStart < current.time) is ignored
        };

        const fallToPolling = (): void => {
            if (closed || polling) return;
            clearStall();
            clearReseed();
            if (reconnect) { clearTimeout(reconnect); reconnect = null; }
            try { ws?.close(); } catch { /* ignore */ }
            ws = null;
            console.warn(`[vela] Coinbase: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
            polling = this.pollBars(ticker, timeframe, onBar);
        };

        const open = (): void => {
            if (closed || polling) return;
            ws = new WebSocket(WS_URL);
            stall = setTimeout(fallToPolling, STREAM_STALL_MS); // watchdog: a price must arrive
            ws.onopen = () => {
                try { ws?.send(JSON.stringify({ type: 'subscribe', product_ids: [product], channels: ['ticker'] })); }
                catch { /* the watchdog falls back if this never delivers */ }
                void reseed(false); // seed the forming bar immediately (don't wait for the first tick)
                reseedTimer = setInterval(() => void reseed(false), LIVE_RESEED_MS);
            };
            ws.onmessage = (ev: MessageEvent) => {
                if (closed || polling) return;
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as { type?: string; product_id?: string; price?: string; time?: string };
                    if (msg.type === 'ticker' && msg.product_id === product && msg.price != null) {
                        clearStall();
                        onTick(msg.price, msg.time ? Date.parse(msg.time) : Date.now());
                    }
                } catch { /* ignore non-JSON / unrelated frames */ }
            };
            ws.onclose = () => {
                clearReseed();
                if (!closed && !polling) reconnect = setTimeout(open, STREAM_RECONNECT_MS);
            };
            ws.onerror = () => { try { ws?.close(); } catch { /* already closed → onclose reconnects */ } };
        };
        open();

        return () => {
            closed = true;
            clearStall();
            clearReseed();
            if (reconnect) clearTimeout(reconnect);
            polling?.();
            try { ws?.close(); } catch { /* ignore */ }
        };
    }

    /** Poll the forming candle (aggregated/W/M timeframes, or environments without WebSocket). */
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

    /** GET → parsed JSON, through the rate gate with 429 backoff. */
    private async json(url: string): Promise<unknown> {
        const res = await this.request(url);
        return res.json();
    }

    /**
     * Issue one GET through the shared {@link gate} (concurrency + spacing), retrying after a 429
     * (honoring `Retry-After`, else exponential backoff + jitter). Returns the `Response` so callers
     * can read pagination headers (`cb-after`) before consuming the body.
     */
    private async request(url: string): Promise<Response> {
        for (let attempt = 0; ; attempt += 1) {
            const res = await this.gate.run(() => fetch(url, { headers: REQ_HEADERS }));
            if (res.status === 429 && attempt < REQUEST_MAX_RETRIES) {
                const backoff = BACKOFF_BASE_MS * 2 ** attempt + Math.random() * BACKOFF_JITTER_MS;
                this.gate.pauseFor(Math.max(retryAfterMs(res, 0), backoff));
                continue;
            }
            if (!res.ok) throw new Error(`Coinbase HTTP ${res.status} for ${url}`);
            return res;
        }
    }
}
