import { describe, it, expect } from 'vitest';
import { makeLiveProvider } from '../src/engines/pinets/runtime';
import type { ExecutionMarket } from '../src/core/ports/ScriptingEngine';
import type { OHLCV } from '../src/core/model/ohlcv';

/**
 * The streaming-provider contract a live PineTS session polls (shared by the
 * in-process engine and the worker's streaming session): `sDate == null` = the
 * initial full-history load; non-null = a tail poll where an EMPTY result means
 * "no change — skip execution"; `markDirty()` forces the next poll through.
 */

const MARKET: ExecutionMarket = { symbol: 'TEST', timeframe: '60' };

function bar(i: number, close = 100 + i): OHLCV {
    return { time: 1_700_000_000_000 + i * 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

describe('makeLiveProvider (streaming provider contract)', () => {
    it('serves the full history on the initial load (sDate == null)', async () => {
        const bars = [bar(0), bar(1), bar(2)];
        const p = makeLiveProvider(() => bars, () => MARKET, undefined);
        const klines = (await p.getMarketData('TEST', '60')) as Array<{ openTime: number }>;
        expect(klines).toHaveLength(3);
        expect(klines[0]!.openTime).toBe(bars[0]!.time);
    });

    it('serves the tail per poll, then EMPTY while nothing changed, then the tail again on a change', async () => {
        const bars = [bar(0), bar(1), bar(2)];
        const p = makeLiveProvider(() => bars, () => MARKET, undefined);
        const sDate = bars[2]!.time;

        const first = (await p.getMarketData('TEST', '60', undefined, sDate)) as unknown[];
        expect(first).toHaveLength(1); // the forming bar

        const unchanged = await p.getMarketData('TEST', '60', undefined, sDate);
        expect(unchanged).toEqual([]); // no change → the stream skips execution

        bars[2] = { ...bars[2]!, close: 999, high: 999 }; // a tick
        const changed = (await p.getMarketData('TEST', '60', undefined, sDate)) as Array<{ close: number }>;
        expect(changed).toHaveLength(1);
        expect(changed[0]!.close).toBe(999);

        bars.push(bar(3)); // a new bar
        const grown = await p.getMarketData('TEST', '60', undefined, sDate);
        expect(grown).toHaveLength(2); // previous + new
    });

    it('markDirty forces the next poll through even when the signature is unchanged', async () => {
        const bars = [bar(0), bar(1)];
        const p = makeLiveProvider(() => bars, () => MARKET, undefined);
        const sDate = bars[1]!.time;
        await p.getMarketData('TEST', '60', undefined, sDate); // prime the signature
        expect(await p.getMarketData('TEST', '60', undefined, sDate)).toEqual([]);
        p.markDirty();
        expect(await p.getMarketData('TEST', '60', undefined, sDate)).toHaveLength(1);
    });

    it('routes non-chart series to the fetchSeries gateway', async () => {
        const bars = [bar(0)];
        let asked: { sym: string; tf: string } | null = null;
        const p = makeLiveProvider(() => bars, () => MARKET, async (sym, tf) => ((asked = { sym, tf }), [bar(5)]));
        const sec = (await p.getMarketData('ETHUSDT', '240', 100)) as unknown[];
        expect(asked).toEqual({ sym: 'ETHUSDT', tf: '240' });
        expect(sec).toHaveLength(1);
    });
});
