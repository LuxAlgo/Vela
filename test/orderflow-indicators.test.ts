import { describe, it, expect } from 'vitest';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { DataControl } from '../src/core/DataControl';
import { BarStore } from '../src/data/BarStore';
import { acquireTapeSource, leasedTapeSources } from '../src/data/tape/shared';
import { deltaDescriptor } from '../src/core/native-indicators/orderflow/DeltaIndicator';
import { cvdDescriptor } from '../src/core/native-indicators/orderflow/CvdIndicator';
import { ANCHOR_OPTIONS, anchorStart, crossesAnchor, parseAnchor } from '../src/core/native-indicators/orderflow/anchors';
import type { NativeIndicatorContext, NativeIndicatorOutput } from '../src/core/native-indicators/NativeIndicator';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { Trade } from '../src/core/model/tape';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorStatus } from '../src/core/ports/IChartRenderer';
import type { CandleSeries, LineLikeSeries } from '../src/core/model/series';
import type { Unsubscribe } from '../src/core/util/types';

const MIN = 60_000;
const DAY = 86_400_000;

const settle = async (turns = 30): Promise<void> => {
    for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

function bars(start: number, count: number): OHLCV[] {
    return Array.from({ length: count }, (_, i) => ({
        time: start + i * MIN, open: 100, high: 101, low: 99, close: 100, volume: 1,
    }));
}

const trade = (time: number, price: number, size: number, side: 'buy' | 'sell', id: string): Trade =>
    ({ time, price, size, side, id });

/**
 * A provider whose tape is scripted per window. `failBefore` makes windows older than a
 * cutoff throw, which is how a real gap in coverage is produced.
 */
function provider(opts: { tape?: (from: number, to: number) => Trade[]; failBefore?: number; stream?: boolean } = {}) {
    let emit: ((t: readonly Trade[]) => void) | null = null;
    let subscriptions = 0;
    const p: DataProvider = {
        getBars: () => Promise.resolve([]),
        listSymbols: () => Promise.resolve([{ ticker: 'BTCUSDT' }]),
        info: () => ({
            name: 'fake',
            capabilities: { enumerate: true, stream: false, symbolInfo: false, trades: 'full', tradeStream: opts.stream !== false },
        }),
        getTrades: (_t, range) => {
            const from = range.from ?? 0;
            if (opts.failBefore != null && from < opts.failBefore) return Promise.reject(new Error('out of reach'));
            return Promise.resolve(opts.tape?.(from, range.to ?? 0) ?? []);
        },
    };
    if (opts.stream !== false) {
        p.subscribeTrades = (_t, cb): Unsubscribe => {
            subscriptions += 1;
            emit = cb;
            return () => { emit = null; };
        };
    }
    return { provider: p, push: (t: readonly Trade[]) => emit?.(t), subscriptions: (): number => subscriptions };
}

/** A context standing in for the orchestrator's, capturing what the indicator emits. */
function context(data: DataControl, barsOf: () => readonly OHLCV[], live = true) {
    const emitted: NativeIndicatorOutput[] = [];
    const statuses: IndicatorStatus[] = [];
    const ctx: NativeIndicatorContext = {
        id: 'test-instance',
        symbol: 'fake:BTCUSDT',
        timeframe: '1',
        live,
        bars: barsOf,
        data,
        emit: (out) => emitted.push(out),
        pushData: () => {},
        setStatus: (s) => statuses.push(s),
    };
    return { ctx, emitted, statuses, last: (): NativeIndicatorOutput | undefined => emitted[emitted.length - 1] };
}

async function harness(opts: Parameters<typeof provider>[0] = {}) {
    const feed = new MultiProviderFeed(new BarStore());
    const data = new DataControl(feed);
    const fake = provider(opts);
    await feed.registerProvider('fake', fake.provider);
    return { data, fake };
}

describe('anchors', () => {
    it('offers the four reset periods and parses stored labels', () => {
        expect([...ANCHOR_OPTIONS]).toEqual(['None', 'Day', 'Week', 'Month']);
        expect(parseAnchor('Day')).toBe('day');
        expect(parseAnchor('week')).toBe('week');
        expect(parseAnchor('Month')).toBe('month');
        expect(parseAnchor('None')).toBe('none');
        expect(parseAnchor(undefined)).toBe('none');
        expect(parseAnchor('nonsense')).toBe('none');
    });

    it('crosses a UTC day boundary but not within one', () => {
        const noon = Date.UTC(2026, 0, 15, 12);
        expect(crossesAnchor('day', noon, noon - MIN)).toBe(false);
        const midnight = Date.UTC(2026, 0, 16);
        expect(crossesAnchor('day', midnight, midnight - MIN)).toBe(true);
        expect(crossesAnchor('none', midnight, midnight - MIN)).toBe(false);
    });

    it('starts weeks on Monday UTC', () => {
        // 2026-01-15 is a Thursday; its week starts Monday 2026-01-12.
        expect(anchorStart('week', Date.UTC(2026, 0, 15, 12))).toBe(Date.UTC(2026, 0, 12));
        // Monday itself is its own week start, and Sunday belongs to the week before.
        expect(anchorStart('week', Date.UTC(2026, 0, 12))).toBe(Date.UTC(2026, 0, 12));
        expect(anchorStart('week', Date.UTC(2026, 0, 18, 23))).toBe(Date.UTC(2026, 0, 12));
        expect(crossesAnchor('week', Date.UTC(2026, 0, 19), Date.UTC(2026, 0, 18, 23))).toBe(true);
    });

    it('starts days and months on their UTC boundary, and has no start without an anchor', () => {
        expect(anchorStart('day', Date.UTC(2026, 0, 15, 12, 34))).toBe(Date.UTC(2026, 0, 15));
        expect(anchorStart('month', Date.UTC(2026, 2, 15))).toBe(Date.UTC(2026, 2, 1));
        expect(anchorStart('none', Date.now())).toBeNull();
        expect(crossesAnchor('month', Date.UTC(2026, 3, 1), Date.UTC(2026, 2, 31))).toBe(true);
    });
});

describe('Delta indicator', () => {
    it('emits one column per bar, signed and coloured by which side was the aggressor', async () => {
        const b = bars(0, 3);
        const { data, fake } = await harness({ tape: () => [] });
        const { ctx, last } = context(data, () => b);
        const ind = deltaDescriptor.create();
        ind.start(ctx, deltaDescriptor.defaultInputs());
        fake.push([
            trade(0, 100, 5, 'buy', 'a'),
            trade(MIN, 100, 2, 'sell', 'b'),
            trade(MIN, 100, 7, 'sell', 'c'),
        ]);
        await settle();

        const series = last()!.series![0] as LineLikeSeries;
        expect(series.kind).toBe('columns');
        expect(series.style.base).toBe(0);
        expect(series.points).toHaveLength(3);
        expect(series.points[0]!.value).toBe(5);
        expect(series.points[1]!.value).toBe(-9);
        expect(series.points[0]!.color).toBe(series.style.color); // buying takes the up colour
        expect(series.points[1]!.color).not.toBe(series.points[0]!.color);
        // The third bar has no prints AND no coverage — it must not read as balanced.
        expect(series.points[2]!.value).toBeNull();
        ind.stop();
    });

    it('is offered only where a tape exists', async () => {
        const withTape = await harness();
        expect(deltaDescriptor.isSupported!('fake:BTCUSDT', withTape.data)).toBe(true);

        const feed = new MultiProviderFeed(new BarStore());
        const bare = new DataControl(feed);
        await feed.registerProvider('bare', {
            getBars: () => Promise.resolve([]),
            info: () => ({ name: 'bare', capabilities: { enumerate: false, stream: false, symbolInfo: false } }),
        });
        expect(deltaDescriptor.isSupported!('bare:X', bare)).toBe(false);
        expect(cvdDescriptor.isSupported!('bare:X', bare)).toBe(false);
    });

    it('reports loading while windows are in flight and live once they land', async () => {
        const b = bars(0, 2);
        const { data } = await harness({ tape: () => [] });
        const { ctx, statuses } = context(data, () => b);
        const ind = deltaDescriptor.create();
        ind.start(ctx, deltaDescriptor.defaultInputs());
        await settle();
        expect(statuses).toContain('loading');
        expect(statuses[statuses.length - 1]).toBe('live');
        ind.stop();
    });
});

describe('CVD indicator', () => {
    it('carries the running total through candle open and close', async () => {
        const b = bars(0, 3);
        const { data, fake } = await harness({ tape: () => [] });
        const { ctx, last } = context(data, () => b);
        const ind = cvdDescriptor.create();
        ind.start(ctx, cvdDescriptor.defaultInputs());
        fake.push([
            trade(0, 100, 10, 'buy', 'a'),
            trade(MIN, 100, 4, 'sell', 'b'),
            trade(2 * MIN, 100, 6, 'buy', 'c'),
        ]);
        await settle();

        const series = last()!.series![0] as CandleSeries;
        expect(series.kind).toBe('candle');
        expect(series.bars.map((x) => [x.open, x.close])).toEqual([[0, 10], [10, 6], [6, 12]]);
        // A zero line anchors the pane — a cumulative reading is read against it.
        expect(last()!.priceLines![0]!.price).toBe(0);
        ind.stop();
    });

    it('draws a line instead of candles when asked', async () => {
        const b = bars(0, 2);
        const { data, fake } = await harness({ tape: () => [] });
        const { ctx, last } = context(data, () => b);
        const ind = cvdDescriptor.create();
        ind.start(ctx, { ...cvdDescriptor.defaultInputs(), style: 'Line' });
        fake.push([trade(0, 100, 3, 'buy', 'a')]);
        await settle();
        const series = last()!.series![0] as LineLikeSeries;
        expect(series.kind).toBe('line');
        expect(series.points[0]!.value).toBe(3);
        ind.stop();
    });

    it('restarts the total at a UTC day boundary when anchored', async () => {
        // Two bars either side of midnight.
        const b: OHLCV[] = [
            { time: DAY - MIN, open: 1, high: 1, low: 1, close: 1 },
            { time: DAY, open: 1, high: 1, low: 1, close: 1 },
        ];
        const { data, fake } = await harness({ tape: () => [] });
        const { ctx, last } = context(data, () => b);
        const ind = cvdDescriptor.create();
        ind.start(ctx, { ...cvdDescriptor.defaultInputs(), anchor: 'Day' });
        fake.push([trade(DAY - MIN, 100, 5, 'buy', 'a'), trade(DAY, 100, 2, 'buy', 'b')]);
        await settle();

        const series = last()!.series![0] as CandleSeries;
        expect(series.bars.map((x) => [x.open, x.close])).toEqual([[0, 5], [0, 2]]);
        ind.stop();
    });

    it('refuses to sum across a window it could not read', async () => {
        const b = bars(10 * MIN, 6);
        // Windows starting before the 13th minute fail, so those bars never become covered.
        const { data, fake } = await harness({ failBefore: 13 * MIN, tape: () => [] });
        const lease = acquireTapeSource(data, { symbol: 'fake:BTCUSDT', timeframe: '1', bars: () => b, live: true });
        lease.source.request(10 * MIN, 12 * MIN); // the doomed stretch
        await settle();

        const { ctx, last } = context(data, () => b);
        const ind = cvdDescriptor.create();
        ind.start(ctx, cvdDescriptor.defaultInputs());
        fake.push([trade(10 * MIN, 100, 99, 'buy', 'old'), trade(14 * MIN, 100, 3, 'buy', 'new')]);
        await settle();

        const series = last()!.series![0] as CandleSeries;
        // The unread stretch is excluded rather than summed over: the series starts after it,
        // and the 99 that printed in an unread bar never enters the total.
        expect(series.bars.length).toBeGreaterThan(0);
        expect(series.bars[0]!.time).toBeGreaterThanOrEqual(13 * MIN);
        expect(series.bars.every((x) => Math.abs(x.close) <= 3)).toBe(true);
        ind.stop();
        lease.release();
    });
});

describe('shared tape', () => {
    it('two readings of one chart share a single subscription and book', async () => {
        const b = bars(0, 2);
        const { data, fake } = await harness({ tape: () => [] });
        const delta = deltaDescriptor.create();
        const cvd = cvdDescriptor.create();
        const a = context(data, () => b);
        const c = context(data, () => b);
        delta.start(a.ctx, deltaDescriptor.defaultInputs());
        cvd.start(c.ctx, cvdDescriptor.defaultInputs());
        await settle();

        expect(fake.subscriptions()).toBe(1); // one tape, not one per indicator
        expect(leasedTapeSources(data)).toBe(1);

        fake.push([trade(0, 100, 4, 'buy', 'a')]);
        await settle();
        // Both readings see the same print.
        expect((a.last()!.series![0] as LineLikeSeries).points[0]!.value).toBe(4);
        expect((c.last()!.series![0] as CandleSeries).bars[0]!.close).toBe(4);

        delta.stop();
        expect(leasedTapeSources(data)).toBe(1); // still held by the other reading
        cvd.stop();
        expect(leasedTapeSources(data)).toBe(0); // last lease released → the tape is freed
    });

    it('hiding a reading releases its lease; showing it again takes a fresh one', async () => {
        const b = bars(0, 2);
        const { data } = await harness({ tape: () => [] });
        const { ctx } = context(data, () => b);
        const ind = deltaDescriptor.create();
        ind.start(ctx, deltaDescriptor.defaultInputs());
        expect(leasedTapeSources(data)).toBe(1);
        ind.suspend();
        expect(leasedTapeSources(data)).toBe(0);
        ind.resume();
        expect(leasedTapeSources(data)).toBe(1);
        ind.stop();
        expect(leasedTapeSources(data)).toBe(0);
    });
});
