import { describe, it, expect, vi } from 'vitest';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { DataControl } from '../src/core/DataControl';
import { BarStore } from '../src/data/BarStore';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { Trade } from '../src/core/model/tape';
import type { Unsubscribe } from '../src/core/util/types';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const trade = (time: number, id: string): Trade => ({ time, price: 100, size: 1, side: 'buy', id });

/** A provider whose tape surface is configurable, recording what it was asked for. */
function tapeProvider(opts: {
    tickers?: string[];
    depth?: 'full' | 'recent' | 'none';
    withTrades?: boolean;
    withStream?: boolean;
    declareInfo?: boolean;
    throws?: boolean;
} = {}) {
    const tickers = opts.tickers ?? ['BTCUSDT'];
    const asked: Array<{ ticker: string; from?: number; to?: number }> = [];
    const streams: string[] = [];
    let emit: ((t: readonly Trade[]) => void) | null = null;

    const provider: DataProvider = {
        getBars: () => Promise.resolve([]),
        listSymbols: () => Promise.resolve(tickers.map((t) => ({ ticker: t }))),
    };
    if (opts.declareInfo !== false) {
        provider.info = () => ({
            name: 'fake',
            capabilities: {
                enumerate: true, stream: false, symbolInfo: false,
                trades: opts.depth ?? 'full',
                tradeStream: opts.withStream !== false,
            },
        });
    }
    if (opts.withTrades !== false) {
        provider.getTrades = (ticker, range) => {
            asked.push({ ticker, from: range.from, to: range.to });
            if (opts.throws) return Promise.reject(new Error('tape down'));
            return Promise.resolve([trade(range.from ?? 0, 'a')]);
        };
    }
    if (opts.withStream !== false) {
        provider.subscribeTrades = (ticker, onTrades): Unsubscribe => {
            streams.push(ticker);
            emit = onTrades;
            return () => { emit = null; };
        };
    }
    return { provider, asked, streams, push: (t: readonly Trade[]) => emit?.(t), streaming: (): boolean => emit != null };
}

function harness() {
    const feed = new MultiProviderFeed(new BarStore());
    return { feed, data: new DataControl(feed) };
}

describe('chart.data tape routing', () => {
    it('routes a fetch to the owning provider with the ticker it expects', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider();
        await feed.registerProvider('fake', fake.provider);

        const trades = await data.trades('fake:BTCUSDT', { from: 1_000, to: 2_000 });
        expect(fake.asked).toEqual([{ ticker: 'BTCUSDT', from: 1_000, to: 2_000 }]);
        expect(trades.map((t) => t.id)).toEqual(['a']);
    });

    it('resolves a BARE symbol through the provider index', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ tickers: ['ETHUSDT'] });
        await feed.registerProvider('fake', fake.provider);
        await data.ready();

        await data.trades('ETHUSDT', { from: 0, to: 1 });
        expect(fake.asked[0]!.ticker).toBe('ETHUSDT');
    });

    it('serves an unresolvable symbol as empty instead of rejecting', async () => {
        const { data } = harness();
        expect(await data.trades('NOPE', { from: 0, to: 1 })).toEqual([]);
        expect(data.tradeDepth('NOPE')).toBe('none');
        expect(data.tradeStream('NOPE')).toBe(false);
    });

    it('serves a provider with no tape as empty', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ withTrades: false, withStream: false, depth: 'none' });
        await feed.registerProvider('fake', fake.provider);
        expect(await data.trades('fake:BTCUSDT')).toEqual([]);
        expect(data.tradeDepth('fake:BTCUSDT')).toBe('none');
    });

    it('a FAILED fetch rejects — it must not look like a quiet window', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ throws: true });
        await feed.registerProvider('fake', fake.provider);

        // Swallowing this into `[]` would let a consumer record the window as read-and-empty
        // and then sum across it, which turns a retryable blip into a permanently wrong total.
        await expect(data.trades('fake:BTCUSDT')).rejects.toThrow('tape down');
    });

    it('reports the declared depth and stream capability', async () => {
        const { feed, data } = harness();
        await feed.registerProvider('shallow', tapeProvider({ depth: 'recent' }).provider);
        expect(data.tradeDepth('shallow:BTCUSDT')).toBe('recent');
        expect(data.tradeStream('shallow:BTCUSDT')).toBe(true);
    });

    it('synthesizes the shallower depth for a provider that declares no info()', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ declareInfo: false });
        await feed.registerProvider('fake', fake.provider);
        // Method presence cannot tell `full` from `recent`, so the registry assumes the
        // reach it can honor rather than promising history the venue may not have.
        expect(data.tradeDepth('fake:BTCUSDT')).toBe('recent');
        expect(data.tradeStream('fake:BTCUSDT')).toBe(true);
    });

    it('synthesizes no tape for a provider that implements neither method', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ declareInfo: false, withTrades: false, withStream: false });
        await feed.registerProvider('fake', fake.provider);
        expect(data.tradeDepth('fake:BTCUSDT')).toBe('none');
        expect(data.tradeStream('fake:BTCUSDT')).toBe(false);
    });
});

describe('chart.data.subscribeTrades', () => {
    it('opens the provider stream and delivers batches', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider();
        await feed.registerProvider('fake', fake.provider);

        const seen: Trade[][] = [];
        const off = data.subscribeTrades('fake:BTCUSDT', (t) => seen.push([...t]));
        fake.push([trade(1, 'x'), trade(2, 'y')]);
        expect(seen).toEqual([[trade(1, 'x'), trade(2, 'y')]]);
        expect(fake.streams).toEqual(['BTCUSDT']);

        off();
        expect(fake.streaming()).toBe(false);
    });

    it('waits for a provider registered AFTER the subscription, then attaches', async () => {
        const { feed, data } = harness();
        const seen: Trade[] = [];
        const off = data.subscribeTrades('LATEUSDT', (t) => seen.push(...t));

        const fake = tapeProvider({ tickers: ['LATEUSDT'] });
        await feed.registerProvider('fake', fake.provider);
        await flush();
        await new Promise((r) => setTimeout(r, 600)); // the retry cadence
        expect(fake.streaming()).toBe(true);

        fake.push([trade(9, 'late')]);
        expect(seen.map((t) => t.id)).toEqual(['late']);
        off();
    });

    it('is a no-op on a resolved provider with no live tape', async () => {
        const { feed, data } = harness();
        const fake = tapeProvider({ withStream: false });
        await feed.registerProvider('fake', fake.provider);
        const off = data.subscribeTrades('fake:BTCUSDT', () => { throw new Error('must not deliver'); });
        expect(fake.streams).toEqual([]);
        expect(() => off()).not.toThrow();
    });
});
