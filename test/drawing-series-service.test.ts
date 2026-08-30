import { describe, it, expect, vi } from 'vitest';
import { DrawingSeriesService, type DrawingSeriesDeps } from '../src/core/engine/DrawingSeriesService';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { BarRange } from '../src/core/ports/MarketDataFeed';

const MIN = 60_000;

/** Flat 5m bars covering `[from, to]` (open time inclusive). */
function bars5m(from: number, to: number): OHLCV[] {
    const out: OHLCV[] = [];
    const step = 5 * MIN;
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
        out.push({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    }
    return out;
}

interface Harness {
    svc: DrawingSeriesService;
    fetches: Array<{ timeframe: string; range: BarRange }>;
    /** Resolve the oldest unresolved fetch with bars covering its requested range. */
    flush(): Promise<void>;
    deps: { chartTimeframe: string; marketKey: string; canFetch: boolean };
}

function harness(): Harness {
    const fetches: Array<{ timeframe: string; range: BarRange }> = [];
    const pending: Array<{ range: BarRange; resolve: (bars: OHLCV[]) => void }> = [];
    const state = { chartTimeframe: '60', marketKey: 'BTCUSDT|', canFetch: true };
    const deps: DrawingSeriesDeps = {
        fetchBars: (timeframe, range) => {
            fetches.push({ timeframe, range });
            return new Promise<OHLCV[]>((resolve) => pending.push({ range, resolve }));
        },
        canFetch: () => state.canFetch,
        chartTimeframe: () => state.chartTimeframe,
        marketKey: () => state.marketKey,
    };
    return {
        svc: new DrawingSeriesService(deps),
        fetches,
        flush: async () => {
            const p = pending.shift();
            p?.resolve(bars5m(p.range.from ?? 0, p.range.to ?? 0));
            await Promise.resolve();
            await Promise.resolve();
        },
        deps: state,
    };
}

describe('engine/DrawingSeriesService', () => {
    it('reports no-source when the market has no ranged feed', () => {
        const h = harness();
        h.deps.canFetch = false;
        expect(h.svc.seriesInRange('5', 0, MIN * 60)).toEqual({ state: 'unavailable', reason: 'no-source' });
        expect(h.fetches).toHaveLength(0);
    });

    it('refuses timeframes not strictly below the chart', () => {
        const h = harness(); // chart = 60
        expect(h.svc.seriesInRange('60', 0, MIN * 600)).toEqual({ state: 'unavailable', reason: 'not-lower' });
        expect(h.svc.seriesInRange('240', 0, MIN * 600)).toEqual({ state: 'unavailable', reason: 'not-lower' });
        expect(h.fetches).toHaveLength(0);
    });

    it("resolves 'auto' to the largest standard step at least 4x finer than the chart", async () => {
        const h = harness(); // chart = 60 → 15m
        expect(h.svc.seriesInRange('auto', 0, MIN * 600)).toMatchObject({ state: 'loading', timeframe: '15', barMs: 15 * MIN });
        expect(h.fetches[0]!.timeframe).toBe('15');
        h.deps.chartTimeframe = 'D'; // 1440m / 4 = 360m → '240'
        h.svc.seriesInRange('auto', 0, MIN * 1440 * 3);
        expect(h.fetches[1]!.timeframe).toBe('240');
        h.deps.chartTimeframe = '1'; // nothing lower exists — a distinct reason from a bad explicit pick
        expect(h.svc.seriesInRange('auto', 0, MIN * 30)).toEqual({ state: 'unavailable', reason: 'none-lower' });
        expect(h.svc.seriesInRange('5', 0, MIN * 30)).toEqual({ state: 'unavailable', reason: 'none-lower' });
        h.deps.chartTimeframe = '2'; // no step subdivides 4× — auto still magnifies with the finest lower step
        h.svc.seriesInRange('auto', 0, MIN * 60);
        expect(h.fetches[h.fetches.length - 1]!.timeframe).toBe('1');
    });

    it('caps a request that would need more bars than the limit', () => {
        const h = harness();
        // 5001 one-minute bars on a 60-minute chart… needs a > MAX_BARS span at tf '1'.
        expect(h.svc.seriesInRange('1', 0, MIN * 5001)).toEqual({ state: 'unavailable', reason: 'too-wide' });
        expect(h.fetches).toHaveLength(0);
    });

    it('answers loading on a miss, fetches a padded window once, then serves from cache', async () => {
        const h = harness();
        const from = MIN * 1000;
        const to = MIN * 1600; // 600 min → 120 five-minute bars
        expect(h.svc.seriesInRange('5', from, to)).toMatchObject({ state: 'loading' });
        expect(h.svc.seriesInRange('5', from, to)).toMatchObject({ state: 'loading' }); // no duplicate fetch
        expect(h.fetches).toHaveLength(1);
        // The fetched window is padded a quarter-span each side.
        const pad = (to - from) * 0.25;
        expect(h.fetches[0]!.range.from).toBe(from - pad);
        expect(h.fetches[0]!.range.to).toBe(to + pad);

        const updates = vi.fn();
        h.svc.onUpdate(updates);
        await h.flush();
        expect(updates).toHaveBeenCalledTimes(1);

        const res = h.svc.seriesInRange('5', from, to);
        expect(res.state).toBe('ready');
        if (res.state === 'ready') {
            expect(res.timeframe).toBe('5');
            expect(res.barMs).toBe(5 * MIN);
            expect(res.bars[0]!.time).toBeGreaterThanOrEqual(from);
            expect(res.bars[res.bars.length - 1]!.time).toBeLessThanOrEqual(to);
            expect(res.bars).toHaveLength(121); // inclusive bounds
        }
        // A narrower read inside the cached window is a pure cache hit.
        expect(h.svc.seriesInRange('5', from + MIN * 50, to - MIN * 50).state).toBe('ready');
        expect(h.fetches).toHaveLength(1);
    });

    it('misses the cache when the market identity changes', async () => {
        const h = harness();
        h.svc.seriesInRange('5', 0, MIN * 600);
        await h.flush();
        expect(h.svc.seriesInRange('5', 0, MIN * 600).state).toBe('ready');
        h.deps.marketKey = 'ETHUSDT|';
        expect(h.svc.seriesInRange('5', 0, MIN * 600)).toMatchObject({ state: 'loading' });
        expect(h.fetches).toHaveLength(2);
    });

    it('serves best-effort partial bars while a widened window fetches', async () => {
        const h = harness();
        const from = MIN * 1000;
        const to = MIN * 1600;
        h.svc.seriesInRange('5', from, to);
        await h.flush(); // the narrow window is now settled
        // Widen the read past the cached window: it must go loading (a fetch kicks) but
        // still carry the bars the settled window already holds for the overlap.
        const res = h.svc.seriesInRange('5', from, to + MIN * 1000);
        expect(res.state).toBe('loading');
        if (res.state === 'loading') {
            expect(res.timeframe).toBe('5');
            expect(res.bars!.length).toBeGreaterThan(100); // the overlap, not nothing
            expect(res.bars![0]!.time).toBeGreaterThanOrEqual(from);
        }
        expect(h.fetches).toHaveLength(2);
    });

    it('defers a widened request while an overlapping fetch is in flight', () => {
        const h = harness();
        h.svc.seriesInRange('5', MIN * 1000, MIN * 1600); // fetch #1 in flight
        // Overlapping wider reads (a corner drag repaints per pointer move) must not
        // stack more fetches while #1 runs.
        h.svc.seriesInRange('5', MIN * 900, MIN * 1700);
        h.svc.seriesInRange('5', MIN * 800, MIN * 1800);
        expect(h.fetches).toHaveLength(1);
    });

    it('parks a failed window instead of hot-looping retries', async () => {
        const fetches: Array<{ timeframe: string }> = [];
        const svc = new DrawingSeriesService({
            fetchBars: (timeframe) => {
                fetches.push({ timeframe });
                return Promise.reject(new Error('offline'));
            },
            canFetch: () => true,
            chartTimeframe: () => '60',
            marketKey: () => 'BTCUSDT|',
        });
        expect(svc.seriesInRange('5', 0, MIN * 600)).toMatchObject({ state: 'loading' });
        await Promise.resolve();
        await Promise.resolve();
        // The failure parks the window: further reads stay `loading` without new fetches.
        expect(svc.seriesInRange('5', 0, MIN * 600)).toMatchObject({ state: 'loading' });
        expect(svc.seriesInRange('5', 0, MIN * 600)).toMatchObject({ state: 'loading' });
        expect(fetches).toHaveLength(1);
    });

    it('unsubscribing an update listener stops its notifications', async () => {
        const h = harness();
        const listener = vi.fn();
        const unsub = h.svc.onUpdate(listener);
        unsub();
        h.svc.seriesInRange('5', 0, MIN * 600);
        await h.flush();
        expect(listener).not.toHaveBeenCalled();
    });
});
