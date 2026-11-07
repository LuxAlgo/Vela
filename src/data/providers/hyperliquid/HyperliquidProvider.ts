import type { OHLCV } from '../../../core/model/ohlcv';
import type { BarRange, SymbolInfo } from '../../../core/ports/MarketDataFeed';
import type { DataProvider, ProviderInfo, SymbolDescriptor } from '../../../core/ports/DataProvider';
import { baseOf, ledgerCryptoIconUrl } from '../../symbol-base';
import type { Unsubscribe } from '../../../core/util/types';

const INFO_URL = 'https://api.hyperliquid.xyz/info';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
/**
 * If a candle socket opens but delivers no candle within this window, treat it as
 * non-delivering and fall back to polling — covers a stream that connects (and ACKs
 * the subscription) but stays silent (e.g. a blocked/misconfigured endpoint), so live
 * updates never go silently dead. Generous enough not to mis-fire on an illiquid coin.
 */
const STREAM_STALL_MS = 15_000;
/** Reconnect backoff after an unexpected socket close. */
const STREAM_RECONNECT_MS = 2_000;
/** `spotMeta` token index of USDC, the main dex's collateral. */
const USDC_TOKEN = 0;

/** One raw Hyperliquid candle: `{ t, T, s, i, o, h, l, c, v, n }` (prices/volume are strings). */
interface RawCandle {
    t: number; // open time (ms)
    T: number; // close time (ms)
    s: string; // coin
    i: string; // interval
    o: string | number;
    h: string | number;
    l: string | number;
    c: string | number;
    v: string | number;
    n: number; // trade count
}

/** Canonical timeframe → Hyperliquid interval string (native, no aggregation). */
const TF_TO_INTERVAL: Record<string, string> = {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
    '60': '1h', '120': '2h', '240': '4h', '480': '8h', '720': '12h',
    D: '1d', W: '1w', M: '1M',
};

/** User-facing timeframe aliases → canonical keys (matches the other Vela layers). */
const TF_NORMALIZE: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45',
    '1h': '60', '2h': '120', '3h': '180', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
    '1d': 'D', '1w': 'W', '1mo': 'M', '1D': 'D', '1W': 'W', '4H': '240',
    D: 'D', W: 'W', M: 'M',
};

/** Native intraday timeframes Hyperliquid serves (minutes) — aggregation sub-candidates. */
const NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 480, 720];
const MIN_TO_INTERVAL: Record<number, string> = {
    1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 480: '8h', 720: '12h',
};
const SUPPORTED_TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', '360', '480', '720', 'D', 'W', 'M'];

/** Duration of one canonical-timeframe bar in ms (for translating a bar count into a time window). */
const TF_MS: Record<string, number> = {
    D: 86_400_000, W: 604_800_000, M: 2_592_000_000, // month ≈ 30d (windowing only; not bar alignment)
};
function tfMs(tf: string): number {
    if (TF_MS[tf]) return TF_MS[tf];
    const min = parseInt(tf, 10);
    return Number.isFinite(min) && min > 0 ? min * 60_000 : 3_600_000;
}

/** Normalize a user timeframe to a canonical key. */
export function normalizeTf(tf: string): string {
    return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}

/**
 * Map a Vela ticker to a Hyperliquid `coin`. Perps are bare names (`BTC`); spot
 * pairs are `BASE/QUOTE` (`PURR/USDC`); a builder-deployed (HIP-3) dex's perps are
 * `dex:COIN` (`xyz:TSLA`). Bare names are upper-cased for convenience; pair names are
 * passed through verbatim (they're the API coin). The API matches coins case-sensitively,
 * and dex names are lower-case, so a HIP-3 ticker gets a lower-case dex and an upper-case
 * coin — the provider swaps in the listed spelling when it knows the market.
 */
export function parseCoin(ticker: string): string {
    const t = ticker.trim();
    if (t.includes('/')) return t;
    const hip3 = splitDexCoin(t);
    return hip3 ? `${hip3.dex.toLowerCase()}:${hip3.name.toUpperCase()}` : t.toUpperCase();
}

/** The dex and coin of a HIP-3 market (`xyz:TSLA` → `{ dex: 'xyz', name: 'TSLA' }`), or null for any other ticker. */
export function splitDexCoin(coin: string): { dex: string; name: string } | null {
    const i = coin.indexOf(':');
    if (i <= 0 || i === coin.length - 1 || coin.includes('/')) return null;
    return { dex: coin.slice(0, i), name: coin.slice(i + 1) };
}

/** Map a single raw candle to neutral OHLCV (open-time in epoch ms). */
export function candleToOHLCV(k: RawCandle): OHLCV {
    return { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
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
 * Hyperliquid market-data provider, built from scratch on the public info API — no
 * third-party SDK, no API key. Serves USD-margined perpetuals (bare coins like `BTC`),
 * spot pairs (`PURR/USDC`) and the perpetuals of every builder-deployed (HIP-3) perp dex
 * (`xyz:TSLA` — the dex name, a colon, the coin: the API's own coin name, so
 * `hyperliquid:xyz:TSLA` is the qualified form), and aggregates timeframes Hyperliquid
 * doesn't serve natively (e.g. `45`, `180`, `360`). Live ticks use a real WebSocket
 * candle stream (`subscribe`).
 *
 * History note: Hyperliquid only serves the most recent ~5000 candles per interval
 * (≈ 3.5d of 1m, ~7mo of 1h, daily back to listing) — there is no deeper backfill, so
 * it's a live/recent-history venue rather than a deep-history source.
 *
 *   import { HyperliquidProvider } from 'vela/providers/hyperliquid';
 *   chart.data.registerProvider('hyperliquid', new HyperliquidProvider());
 */
export class HyperliquidProvider implements DataProvider {
    /** Cached perp `meta` (universe is large; fetch once). */
    private metaPromise: Promise<PerpMeta> | null = null;
    /** Cached `spotMeta`. */
    private spotMetaPromise: Promise<SpotMeta> | null = null;
    /** Cached `perpDexs` (the HIP-3 dexes; the main dex is left out). */
    private perpDexsPromise: Promise<PerpDex[]> | null = null;
    /** Cached `meta` per HIP-3 dex name. */
    private readonly dexMetaPromises = new Map<string, Promise<PerpMeta>>();
    /** Upper-cased HIP-3 coin → its listed spelling, filled as dex metas arrive. */
    private readonly hip3Coins = new Map<string, string>();
    /** Cached symbol enumeration. */
    private symbolsPromise: Promise<SymbolDescriptor[]> | null = null;

    info(): ProviderInfo {
        return {
            name: 'hyperliquid',
            displayName: 'Hyperliquid',
            requiresApiKey: false,
            supportedTimeframes: SUPPORTED_TIMEFRAMES,
            capabilities: { enumerate: true, stream: true, symbolInfo: true },
        };
    }

    async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        try {
            const coin = await this.resolveCoin(ticker);
            const tf = normalizeTf(timeframe);

            const nativeInterval = TF_TO_INTERVAL[tf];
            if (nativeInterval) {
                return dedupeSorted((await this.fetchCandles(coin, nativeInterval, tfMs(tf), range)).map(candleToOHLCV));
            }

            // Aggregation path: fetch a native sub-timeframe and combine.
            const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
            const subMin = targetMin != null ? selectSubTf(targetMin) : null;
            if (targetMin == null || subMin == null) {
                console.warn(`[vela] Hyperliquid: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
                return [];
            }
            const ratio = targetMin / subMin;
            const subRange: BarRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : undefined };
            const sub = (await this.fetchCandles(coin, MIN_TO_INTERVAL[subMin]!, subMin * 60_000, subRange)).map(candleToOHLCV);
            const agg = aggregate(sub, targetMin * 60_000);
            return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
        } catch (e) {
            // Fail soft (consistent with the Binance provider): an empty result parks/empties
            // the chart with a warning rather than rejecting the parked load.
            console.warn(`[vela] Hyperliquid: failed to fetch ${ticker} ${timeframe} — ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }
    }

    async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
        const coin = await this.resolveCoin(ticker);

        const hip3 = splitDexCoin(coin);
        if (hip3) {
            const meta = await this.fetchDexMeta(hip3.dex).catch(() => null);
            const perp = meta?.universe?.find((u) => u.name === coin);
            if (!perp) return undefined;
            const [dex, quote] = await Promise.all([this.findDex(hip3.dex), this.collateralName(meta?.collateralToken)]);
            const name = perp.name.slice(hip3.dex.length + 1);
            // Same price rule as the main dex's perps (≤ 6 − szDecimals decimals).
            const mintick = decimalsToTick(Math.max(0, 6 - (perp.szDecimals ?? 2)));
            return symbolInfo(ticker, name, quote, 'futures', hip3Description(name, quote, dex?.fullName || hip3.dex), mintick);
        }

        const meta = await this.fetchMeta().catch(() => null);
        const perp = meta?.universe?.find((u) => u.name === coin);
        if (perp) {
            // HL perp prices: ≤ 5 significant figures, ≤ (6 − szDecimals) decimals. Approximate
            // the tick from the decimal bound — a hint for `syminfo.mintick`, not an exact filter.
            const mintick = decimalsToTick(Math.max(0, 6 - (perp.szDecimals ?? 2)));
            return symbolInfo(ticker, coin, 'USD', 'futures', `${coin} / USD Perpetual`, mintick);
        }

        if (coin.includes('/')) {
            const spot = await this.fetchSpotMeta().catch(() => null);
            const entry = spot?.universe?.find((u) => u.name === coin);
            const baseTok = entry && spot?.tokens ? spot.tokens[entry.tokens?.[0] ?? -1] : undefined;
            const [base = coin, quote = 'USDC'] = coin.split('/');
            const mintick = decimalsToTick(Math.max(0, 8 - (baseTok?.szDecimals ?? 2)));
            return symbolInfo(ticker, base, quote, 'crypto', `${base} / ${quote}`, mintick);
        }

        return undefined;
    }

    listSymbols(): Promise<SymbolDescriptor[]> {
        if (!this.symbolsPromise) {
            this.symbolsPromise = Promise.all([
                this.listPerps().catch(() => [] as SymbolDescriptor[]),
                this.listSpot().catch(() => [] as SymbolDescriptor[]),
                this.listHip3().catch(() => [] as SymbolDescriptor[]),
            ]).then(([perps, spot, hip3]) => [...perps, ...spot, ...hip3]);
        }
        return this.symbolsPromise;
    }

    /** Predefined icon source for a crypto venue: the Ledger crypto-icon CDN, keyed by
     *  the BASE asset (the description's first segment, else the de-suffixed ticker; a
     *  HIP-3 ticker without its dex). */
    resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
        const hip3 = symbol.description ? null : splitDexCoin(symbol.ticker);
        return ledgerCryptoIconUrl(baseOf(hip3 ? { ticker: hip3.name } : symbol));
    }

    subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe {
        const coin = this.coinOf(ticker);
        const interval = TF_TO_INTERVAL[normalizeTf(timeframe)];
        // Native interval + a WebSocket implementation ⇒ true streaming. Otherwise
        // (aggregated timeframe, or no WebSocket) fall back to polling getBars.
        if (interval && typeof WebSocket !== 'undefined') return this.streamCandles(ticker, timeframe, coin, interval, onBar);
        return this.pollBars(ticker, timeframe, onBar);
    }

    // ── internals ────────────────────────────────────────────────────────

    /** The API coin for a ticker: {@link parseCoin}, with a known HIP-3 market's listed spelling. */
    private coinOf(ticker: string): string {
        const coin = parseCoin(ticker);
        return this.hip3Coins.get(coin.toUpperCase()) ?? coin;
    }

    /** {@link coinOf}, after loading a HIP-3 market's dex when its spelling isn't known yet. */
    private async resolveCoin(ticker: string): Promise<string> {
        const coin = this.coinOf(ticker);
        const hip3 = splitDexCoin(coin);
        if (!hip3 || this.hip3Coins.has(coin.toUpperCase())) return coin;
        await this.fetchDexMeta(hip3.dex).catch(() => null);
        return this.coinOf(ticker);
    }

    private async listPerps(): Promise<SymbolDescriptor[]> {
        const meta = await this.fetchMeta();
        return (meta.universe ?? [])
            .filter((u) => !u.isDelisted)
            .map((u) => ({ ticker: u.name, description: `${u.name} / USD Perpetual`, type: 'futures' }));
    }

    private async listSpot(): Promise<SymbolDescriptor[]> {
        const meta = await this.fetchSpotMeta();
        const tokens = meta.tokens ?? [];
        const nameOf = (i: number | undefined): string | null => (i != null ? tokens[i]?.name ?? null : null);
        return (meta.universe ?? []).map((u) => {
            const base = nameOf(u.tokens?.[0]);
            const quote = nameOf(u.tokens?.[1]);
            const description = base && quote ? `${base} / ${quote}` : u.name;
            return { ticker: u.name, description, type: 'crypto' };
        });
    }

    /**
     * Every HIP-3 dex's listed perps. A dex whose meta fails, or whose markets are all
     * delisted (a halted dex), simply contributes nothing.
     */
    private async listHip3(): Promise<SymbolDescriptor[]> {
        const dexes = await this.fetchPerpDexs();
        const lists = await Promise.all(
            dexes.map(async (dex) => {
                const meta = await this.fetchDexMeta(dex.name);
                const quote = await this.collateralName(meta.collateralToken);
                const prefix = `${dex.name}:`;
                return (meta.universe ?? [])
                    .filter((u) => !u.isDelisted && u.name.startsWith(prefix) && u.name.length > prefix.length)
                    .map((u): SymbolDescriptor => {
                        const name = u.name.slice(prefix.length);
                        return { ticker: u.name, description: hip3Description(name, quote, dex.fullName || dex.name), type: 'futures' };
                    });
            }).map((p) => p.catch(() => [] as SymbolDescriptor[])),
        );
        return lists.flat();
    }

    /** The quote currency of a dex's perps, from its collateral token: USDC reads `USD` like the main dex. */
    private async collateralName(token: number | undefined): Promise<string> {
        if (token == null || token === USDC_TOKEN) return 'USD';
        const spot = await this.fetchSpotMeta().catch(() => null);
        return spot?.tokens?.find((t) => t.index === token)?.name ?? 'USD';
    }

    private async findDex(name: string): Promise<PerpDex | undefined> {
        const dexes = await this.fetchPerpDexs().catch(() => [] as PerpDex[]);
        return dexes.find((d) => d.name === name);
    }

    /**
     * Fetch candles for a time window. Hyperliquid's `candleSnapshot` has no count
     * parameter — it returns candles in `[startTime, endTime]` (capped to the most
     * recent ~5000). We translate a bar `limit` into a start offset; a `from` range
     * (the cache's tail refresh) is used directly. The newest candle is the forming one.
     */
    private async fetchCandles(coin: string, interval: string, intervalMs: number, range: BarRange): Promise<RawCandle[]> {
        const end = range.to ?? Date.now();
        const start = range.from != null ? range.from : end - (((range.limit ?? 500) + 2) * intervalMs);
        const candles = await this.candleSnapshot(coin, interval, start, end);
        // Count-bounded (no explicit `from`): keep the most-recent `limit` bars.
        if (range.from == null && range.limit != null && candles.length > range.limit) return candles.slice(-range.limit);
        return candles;
    }

    private async candleSnapshot(coin: string, interval: string, startTime: number, endTime: number): Promise<RawCandle[]> {
        const data = await this.post({ type: 'candleSnapshot', req: { coin, interval, startTime: Math.floor(startTime), endTime: Math.floor(endTime) } });
        return Array.isArray(data) ? (data as RawCandle[]) : [];
    }

    /**
     * Open a WebSocket candle stream; reconnects on unexpected close until unsubscribed.
     * A stall watchdog falls the subscription back to polling if the socket opens but
     * never delivers a candle (a blocked/silent stream) — so live updates never go
     * silently dead. Mirrors the Binance provider's streaming resilience.
     */
    private streamCandles(
        ticker: string, timeframe: string, coin: string, interval: string, onBar: (bar: OHLCV) => void,
    ): Unsubscribe {
        let closed = false;
        let ws: WebSocket | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;
        let reconnect: ReturnType<typeof setTimeout> | null = null;
        let stall: ReturnType<typeof setTimeout> | null = null;
        let polling: Unsubscribe | null = null; // engaged when the stream is declared non-delivering

        const clearStall = (): void => { if (stall) { clearTimeout(stall); stall = null; } };
        const clearPing = (): void => { if (ping) { clearInterval(ping); ping = null; } };

        // Tear down the socket and switch to polling — covers an open-but-silent stream.
        const fallToPolling = (): void => {
            if (closed || polling) return;
            clearStall();
            clearPing();
            if (reconnect) { clearTimeout(reconnect); reconnect = null; }
            try { ws?.close(); } catch { /* ignore */ }
            ws = null;
            console.warn(`[vela] Hyperliquid: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
            polling = this.pollBars(ticker, timeframe, onBar);
        };

        const open = (): void => {
            if (closed || polling) return;
            ws = new WebSocket(WS_URL);
            stall = setTimeout(fallToPolling, STREAM_STALL_MS); // watchdog: data must arrive
            ws.onopen = () => {
                try { ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin, interval } })); }
                catch { /* the watchdog falls back if this never delivers */ }
                // Keep the idle socket alive (HL replies with a pong).
                ping = setInterval(() => { try { ws?.send(JSON.stringify({ method: 'ping' })); } catch { /* closing */ } }, 30_000);
            };
            ws.onmessage = (ev: MessageEvent) => {
                if (closed || polling) return; // unsubscribed, or already fell back to polling
                try {
                    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as { channel?: string; data?: RawCandle };
                    if (msg.channel === 'candle' && msg.data && msg.data.s === coin) { clearStall(); onBar(candleToOHLCV(msg.data)); }
                } catch { /* ignore non-JSON / unrelated frames */ }
            };
            ws.onclose = () => {
                clearPing();
                if (!closed && !polling) reconnect = setTimeout(open, STREAM_RECONNECT_MS); // transient drop — retry
            };
            ws.onerror = () => { try { ws?.close(); } catch { /* already closed → onclose reconnects */ } };
        };
        open();

        return () => {
            closed = true;
            clearStall();
            clearPing();
            if (reconnect) clearTimeout(reconnect);
            polling?.();
            try { ws?.close(); } catch { /* ignore */ }
        };
    }

    /** Poll the forming candle (for aggregated timeframes / environments without WebSocket). */
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

    private fetchMeta(): Promise<PerpMeta> {
        return (this.metaPromise ??= this.post({ type: 'meta' }).then((d) => d as PerpMeta));
    }

    private fetchSpotMeta(): Promise<SpotMeta> {
        return (this.spotMetaPromise ??= this.post({ type: 'spotMeta' }).then((d) => d as SpotMeta));
    }

    /** The HIP-3 dexes: `perpDexs` lists the main dex first, as `null`, which is dropped. */
    private fetchPerpDexs(): Promise<PerpDex[]> {
        return (this.perpDexsPromise ??= this.post({ type: 'perpDexs' }).then((d) =>
            (Array.isArray(d) ? d : []).filter((x): x is PerpDex => x != null && typeof (x as PerpDex).name === 'string' && (x as PerpDex).name !== ''),
        ));
    }

    private fetchDexMeta(dex: string): Promise<PerpMeta> {
        let p = this.dexMetaPromises.get(dex);
        if (!p) {
            p = this.post({ type: 'meta', dex }).then((d) => {
                const meta = (d ?? {}) as PerpMeta;
                for (const u of meta.universe ?? []) this.hip3Coins.set(u.name.toUpperCase(), u.name);
                return meta;
            });
            this.dexMetaPromises.set(dex, p);
        }
        return p;
    }

    private async post(body: unknown): Promise<unknown> {
        const res = await fetch(INFO_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
        return res.json();
    }
}

/** Build a SymbolInfo record (shared by the perp + spot branches of getSymbolInfo). */
function symbolInfo(
    ticker: string, basecurrency: string, currency: string, type: string, description: string, mintick: number,
): SymbolInfo {
    return {
        ticker, // keep the original ticker (as Pine Script expects)
        tickerid: `HYPERLIQUID:${ticker}`,
        prefix: 'HYPERLIQUID',
        description,
        type,
        basecurrency,
        currency,
        mintick,
        pricescale: Math.round(1 / mintick),
        timezone: 'Etc/UTC',
        session: '24x7',
    };
}

/** A HIP-3 market's description: the coin, its quote and the dex that lists it (`TSLA / USD Perpetual (XYZ)`). */
function hip3Description(name: string, quote: string, dexName: string): string {
    return `${name} / ${quote} Perpetual (${dexName})`;
}

/** 10^-decimals as a tick size (e.g. 1 → 0.1, 3 → 0.001). */
function decimalsToTick(decimals: number): number {
    return Math.pow(10, -decimals);
}

/** The subset of Hyperliquid `meta` this provider reads. */
interface PerpMeta {
    universe?: Array<{ name: string; szDecimals?: number; maxLeverage?: number; isDelisted?: boolean }>;
    /** The spot token the dex's perps are margined in (its `index` in `spotMeta.tokens`). */
    collateralToken?: number;
}

/** The subset of one Hyperliquid `perpDexs` entry this provider reads. */
interface PerpDex {
    name: string;
    fullName?: string;
}

/** The subset of Hyperliquid `spotMeta` this provider reads. */
interface SpotMeta {
    universe?: Array<{ name: string; tokens?: number[]; isCanonical?: boolean }>;
    tokens?: Array<{ name: string; szDecimals?: number; index?: number }>;
}
