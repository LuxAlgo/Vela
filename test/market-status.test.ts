// The statusline market badge's brain (src/widget/market-status.ts): the pure status
// derivation over resolved calendar windows (open/pre/post/closed/holiday, market-tz
// day attribution), the boundary picker, and the tracker's lifecycle — calendar-less
// symbols keep the legacy permanent 'open', boundaries re-derive on a timer, and a
// rebind invalidates in-flight work. DOM-free — node env.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveMarketStatus, nextStatusBoundary, MarketStatusTracker, type MarketWindows } from '../src/widget/market-status';
import type { DataControl } from '../src/core/DataControl';

const NY = 'America/New_York';
// A plain August 2026 week (EDT = UTC-4): Mon 10th … Fri 14th. Regular 09:30–16:00 ET,
// extended 04:00–20:00 ET.
const D = (day: number, h: number, m = 0): number => Date.UTC(2026, 7, day, h, m);
const week = (days: number[]): MarketWindows => ({
    regular: days.map((d) => [D(d, 13, 30), D(d, 20, 0)] as const),
    extended: days.map((d) => [D(d, 8, 0), D(d, 24, 0)] as const),
});
const FULL_WEEK = week([10, 11, 12, 13, 14]);

describe('deriveMarketStatus', () => {
    it('inside a regular window → open', () => {
        expect(deriveMarketStatus(D(11, 18), FULL_WEEK, NY)).toBe('open');
    });

    it('extended before the regular open → pre; after the close → post', () => {
        expect(deriveMarketStatus(D(11, 9), FULL_WEEK, NY)).toBe('pre'); // 05:00 ET
        expect(deriveMarketStatus(D(11, 21), FULL_WEEK, NY)).toBe('post'); // 17:00 ET
    });

    it('overnight gap on a trading weekday → closed (the day HAS a window)', () => {
        // Tue 22:00 ET = Wed 02:00 UTC — Tuesday's tape is done, Tuesday traded.
        expect(deriveMarketStatus(D(12, 2), FULL_WEEK, NY)).toBe('closed');
    });

    it('weekend → closed, never holiday', () => {
        expect(deriveMarketStatus(D(15, 16), FULL_WEEK, NY)).toBe('closed'); // Sat noon ET
    });

    it('a weekday with no window at all → holiday', () => {
        const noMonday = week([11, 12, 13, 14]);
        expect(deriveMarketStatus(D(10, 16), noMonday, NY)).toBe('holiday'); // Mon noon ET
    });

    it('a bogus timezone never claims a holiday', () => {
        const noMonday = week([11, 12, 13, 14]);
        expect(deriveMarketStatus(D(10, 16), noMonday, 'Not/AZone')).toBe('closed');
    });

    it('an overnight roll tape reports extended, never pre/post', () => {
        expect(deriveMarketStatus(D(11, 9), FULL_WEEK, NY, true)).toBe('extended');
        expect(deriveMarketStatus(D(11, 21), FULL_WEEK, NY, true)).toBe('extended');
        expect(deriveMarketStatus(D(11, 18), FULL_WEEK, NY, true)).toBe('open');
    });
});

describe('nextStatusBoundary', () => {
    it('picks the nearest FUTURE edge across both window sets', () => {
        // Tue 05:00 ET (pre-market): the next edge is Tuesday's regular open.
        expect(nextStatusBoundary(D(11, 9), FULL_WEEK)).toBe(D(11, 13, 30));
        // Tue 14:00 ET (open): the next edge is the regular close.
        expect(nextStatusBoundary(D(11, 18), FULL_WEEK)).toBe(D(11, 20));
    });

    it('null when no edge lies ahead', () => {
        expect(nextStatusBoundary(D(20, 0), FULL_WEEK)).toBeNull();
    });
});

// ── the tracker ──

interface FakeProvider {
    getCalendar?: (ticker: string, range: { from: number; to: number; session?: string }) => Promise<ReadonlyArray<readonly [number, number]>>;
}

function fakeData(provider: FakeProvider, syminfo: Record<string, unknown> | undefined): DataControl {
    return {
        resolve: (symbol: string) => ({ provider: 'edgx', ticker: symbol }),
        providerInstance: () => provider,
        symbolInfo: () => Promise.resolve(syminfo),
    } as unknown as DataControl;
}

const EQUITY_SI = { ticker: 'AAPL', session: '0930-1600', timezone: NY };

afterEach(() => {
    vi.useRealTimers();
});

describe('MarketStatusTracker', () => {
    it('derives the status from the provider calendar and re-derives at the boundary', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(D(11, 19, 59)); // Tue 15:59 ET — one minute before the close
        const sessions: string[] = [];
        const provider: FakeProvider = {
            getCalendar: (_t, range) => {
                sessions.push(range.session ?? '');
                return Promise.resolve(range.session === 'regular' ? FULL_WEEK.regular : FULL_WEEK.extended);
            },
        };
        const statuses: string[] = [];
        const tracker = new MarketStatusTracker((s) => statuses.push(s));
        tracker.track(fakeData(provider, EQUITY_SI), 'AAPL');
        await vi.advanceTimersByTimeAsync(1);
        expect(statuses).toEqual(['open']);
        expect(sessions.sort()).toEqual(['extended', 'regular']); // both sets fetched
        // The close passes — the armed boundary timer re-derives into post-market.
        await vi.advanceTimersByTimeAsync(120_000);
        expect(statuses).toEqual(['open', 'post']);
        tracker.stop();
    });

    it('a symbol with an overnight extended vocabulary badges extended instead of pre', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(D(11, 9)); // Tue 05:00 ET — inside the extended tape, open ahead
        const provider: FakeProvider = {
            getCalendar: (_t, range) => Promise.resolve(range.session === 'regular' ? FULL_WEEK.regular : FULL_WEEK.extended),
        };
        const statuses: string[] = [];
        const tracker = new MarketStatusTracker((s) => statuses.push(s));
        const rollSi = { ticker: 'ROLL', session: '0930-1600', session_extended: '2000-1900', timezone: NY };
        tracker.track(fakeData(provider, rollSi), 'ROLL');
        await vi.advanceTimersByTimeAsync(1);
        expect(statuses).toEqual(['extended']);
        tracker.stop();
    });

    it('no calendar capability, or a continuous market, reports the legacy permanent open', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(D(15, 12)); // Saturday — irrelevant, these paths never look
        const statuses: string[] = [];
        const tracker = new MarketStatusTracker((s) => statuses.push(s));
        tracker.track(fakeData({}, EQUITY_SI), 'AAPL'); // provider without getCalendar
        await vi.advanceTimersByTimeAsync(1);
        const crypto: FakeProvider = { getCalendar: () => Promise.reject(new Error('never called')) };
        tracker.track(fakeData(crypto, { ticker: 'BTCUSDT', session: '24x7' }), 'BTCUSDT');
        await vi.advanceTimersByTimeAsync(1);
        expect(statuses).toEqual(['open', 'open']);
        tracker.stop();
    });

    it('a failed calendar fetch keeps the badge and retries; stop() ends the loop', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(D(11, 18));
        let calls = 0;
        const provider: FakeProvider = {
            getCalendar: () => {
                calls += 1;
                return Promise.reject(new Error('down'));
            },
        };
        const statuses: string[] = [];
        const tracker = new MarketStatusTracker((s) => statuses.push(s));
        tracker.track(fakeData(provider, EQUITY_SI), 'AAPL');
        await vi.advanceTimersByTimeAsync(1);
        expect(statuses).toEqual([]); // no verdict on bad data
        const before = calls;
        await vi.advanceTimersByTimeAsync(61_000); // the retry fires
        expect(calls).toBeGreaterThan(before);
        tracker.stop();
        const atStop = calls;
        await vi.advanceTimersByTimeAsync(600_000);
        expect(calls).toBe(atStop); // stopped means stopped
    });

    it('a rebind invalidates the in-flight evaluation (no stale status lands)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(D(11, 18));
        let release!: () => void;
        const slow: FakeProvider = {
            getCalendar: () =>
                new Promise((resolve) => {
                    release = (): void => resolve(FULL_WEEK.regular);
                }),
        };
        const statuses: string[] = [];
        const tracker = new MarketStatusTracker((s) => statuses.push(s));
        tracker.track(fakeData(slow, EQUITY_SI), 'AAPL');
        await vi.advanceTimersByTimeAsync(1); // symbolInfo settles; getCalendar hangs
        tracker.track(fakeData({}, { ticker: 'BTCUSDT', session: '24x7' }), 'BTCUSDT'); // rebind
        await vi.advanceTimersByTimeAsync(1);
        release(); // the OLD evaluation finally resolves — must be discarded
        await vi.advanceTimersByTimeAsync(1);
        expect(statuses).toEqual(['open']); // only the rebind's verdict
        tracker.stop();
    });
});
