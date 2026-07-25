// BarStore multi-symbol retention — the workspace seam that stops one cell's load from
// evicting the other cells' cached history (the two-cell "cache thrash" scenario).
import { describe, it, expect } from 'vitest';
import { BarStore, seriesKey } from '../src/data/BarStore';
import { CachingDataFeed } from '../src/data/CachingDataFeed';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Unsubscribe } from '../src/core/util/types';

const START = 1_700_000_000_000;
const STEP = 3_600_000;

function bars(count: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < count; i += 1) {
        const price = 100 + (i % 7);
        out.push({ time: START + i * STEP, open: price, high: price + 1, low: price - 1, close: price, volume: 1 });
    }
    return out;
}

const KEY_BTC = seriesKey('binance', 'BTCUSDT', '60');
const KEY_ETH = seriesKey('binance', 'ETHUSDT', '60');
const KEY_SOL = seriesKey('binance', 'SOLUSDT', '60');

describe('BarStore.retain (multi-symbol retention)', () => {
    it('legacy default: retainSymbol purges every other symbol when the symbol changes', () => {
        const store = new BarStore();
        store.merge(KEY_BTC, bars(10));
        store.retainSymbol('BTCUSDT');
        store.merge(KEY_ETH, bars(10));
        store.retainSymbol('ETHUSDT');
        expect(store.get(KEY_BTC)).toBeUndefined();
        expect(store.get(KEY_ETH)?.length).toBe(10);
    });

    it('retained symbols survive alternating retainSymbol purges (the workspace scenario)', () => {
        const store = new BarStore();
        store.retain(new Set(['BTCUSDT', 'ETHUSDT']));
        store.merge(KEY_BTC, bars(10));
        store.retainSymbol('BTCUSDT');
        store.merge(KEY_ETH, bars(10));
        store.retainSymbol('ETHUSDT');
        store.retainSymbol('BTCUSDT'); // flip back — ETH must survive too
        expect(store.get(KEY_BTC)?.length).toBe(10);
        expect(store.get(KEY_ETH)?.length).toBe(10);
    });

    it('non-retained (secondary) symbols still drop on a cross-symbol purge', () => {
        const store = new BarStore();
        store.retain(new Set(['BTCUSDT', 'ETHUSDT']));
        store.retainSymbol('BTCUSDT'); // the primary load fixes the current symbol first…
        store.merge(KEY_BTC, bars(10));
        store.merge(KEY_SOL, bars(10)); // …then a request.security secondary fetch lands
        store.retainSymbol('BTCUSDT');
        expect(store.get(KEY_SOL)?.length).toBe(10); // same current symbol — idempotent, no purge
        store.retainSymbol('ETHUSDT'); // the OTHER cell loads — SOL is neither current nor retained
        expect(store.get(KEY_SOL)).toBeUndefined();
        expect(store.get(KEY_BTC)?.length).toBe(10);
    });

    it('shrinking the retained set purges the dropped symbols (and their coverage) immediately', () => {
        const store = new BarStore();
        store.retain(new Set(['BTCUSDT', 'ETHUSDT']));
        store.merge(KEY_BTC, bars(10));
        store.merge(KEY_ETH, bars(10));
        store.markCovered(KEY_ETH, START);
        store.retainSymbol('BTCUSDT');
        store.retain(new Set(['BTCUSDT']));
        expect(store.get(KEY_ETH)).toBeUndefined();
        expect(store.coveredFromOf(KEY_ETH)).toBeUndefined();
        expect(store.get(KEY_BTC)?.length).toBe(10);
    });

    it('an empty set restores the legacy single-chart policy', () => {
        const store = new BarStore();
        store.retain(new Set(['ETHUSDT']));
        store.merge(KEY_ETH, bars(10));
        store.retainSymbol('BTCUSDT');
        expect(store.get(KEY_ETH)?.length).toBe(10); // protected
        store.retain(new Set());
        expect(store.get(KEY_ETH)).toBeUndefined(); // protection dropped → purged (BTC is current)
    });
});

// ── end to end through the caching feed: the two-cell thrash disappears ──

/** Counting fake: one synthetic timeline served for any symbol (store keys keep them apart). */
class CountingFeed implements MarketDataFeed {
    loadCalls = 0;
    rangeCalls = 0;
    private readonly all = bars(600);

    load(cfg: MarketConfig): Promise<OHLCV[]> {
        this.loadCalls += 1;
        return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)).map((b) => ({ ...b })));
    }

    loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls += 1;
        const from = range.from ?? -Infinity;
        const to = range.to ?? Infinity;
        let out = this.all.filter((b) => b.time >= from && b.time <= to);
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out.map((b) => ({ ...b })));
    }

    subscribe(): Unsubscribe {
        return () => {};
    }
}

const CFG_BTC: MarketConfig = { provider: 'binance', symbol: 'BTCUSDT', timeframe: '60', bars: 500 };
const CFG_ETH: MarketConfig = { provider: 'binance', symbol: 'ETHUSDT', timeframe: '60', bars: 500 };

describe('CachingDataFeed with a retained set (two cells, two symbols)', () => {
    it('without retention, alternating loads re-download in full every time (the thrash)', async () => {
        const inner = new CountingFeed();
        const cf = new CachingDataFeed(inner, new BarStore());
        await cf.load(CFG_BTC);
        await cf.load(CFG_ETH);
        await cf.load(CFG_BTC); // BTC was purged by the ETH load → cold again
        expect(inner.loadCalls).toBe(3);
    });

    it('with both symbols retained, the second load of each serves from cache (tail-only refresh)', async () => {
        const inner = new CountingFeed();
        const store = new BarStore();
        store.retain(new Set(['BTCUSDT', 'ETHUSDT']));
        const cf = new CachingDataFeed(inner, store);
        await cf.load(CFG_BTC);
        await cf.load(CFG_ETH);
        const again = await cf.load(CFG_BTC);
        expect(inner.loadCalls).toBe(2); // no third full download
        expect(inner.rangeCalls).toBe(1); // just the uncached tail (newly-closed + forming)
        expect(again.length).toBe(500); // the served window is still complete
    });
});
