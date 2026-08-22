import { describe, expect, it } from 'vitest';
import { expandSessionZones, parseSessionSpec, SessionShadingTracker, type SessionZonesUpdate } from '../src/widget/session-shading';
import { clipHighlightRect } from '../src/renderers/native/backdrop/BackdropRenderer';
import type { DataControl } from '../src/core/DataControl';
import type { SymbolInfo } from '../src/core/ports/MarketDataFeed';

const H = 3_600_000;
const DAY = 24 * H;

/** The US-equities shape as LuxProvider publishes it. */
const US_EQUITIES = {
    ticker: 'AAPL',
    session: '0930-1600',
    session_extended: '0400-2000',
    timezone: 'America/New_York',
};

describe('parseSessionSpec', () => {
    it('reads the regular + extended vocabulary and the market timezone', () => {
        expect(parseSessionSpec(US_EQUITIES)).toEqual({
            regular: { start: 9 * 60 + 30, end: 16 * 60 },
            extended: { start: 4 * 60, end: 20 * 60 },
            timezone: 'America/New_York',
        });
    });

    it('reports no session structure for continuous markets and missing metadata', () => {
        expect(parseSessionSpec(undefined)).toBeNull();
        expect(parseSessionSpec({ ticker: 'BTC/USDT', session: '24x7' })).toBeNull();
        expect(parseSessionSpec({ ticker: 'X', session: '' })).toBeNull();
    });

    it('bounds the bands by the full civil day when no extended vocabulary is declared', () => {
        const spec = parseSessionSpec({ ticker: 'AAPL', session: '0930-1600', timezone: 'America/New_York' });
        expect(spec?.extended).toEqual({ start: 0, end: 1440 });
    });

    it('ignores an extended vocabulary that does not contain the regular window', () => {
        const spec = parseSessionSpec({ ...US_EQUITIES, session_extended: '1000-1200' });
        expect(spec?.extended).toEqual({ start: 0, end: 1440 });
    });

    it('rejects overnight windows — they do not describe a same-day pre/post split', () => {
        expect(parseSessionSpec({ ticker: 'GC', session: '1700-1600' })).toBeNull();
    });
});

describe('expandSessionZones', () => {
    const spec = parseSessionSpec(US_EQUITIES)!;

    it('emits one pre and one post band per weekday at the exact market-time edges', () => {
        // Mon 2024-03-04, EST (UTC-5): 04:00 ET = 09:00 UTC.
        const monday0400 = Date.UTC(2024, 2, 4, 9);
        const zones = expandSessionZones(spec, monday0400, monday0400 + 12 * H);
        expect(zones.pre).toContainEqual([monday0400, monday0400 + 5.5 * H]); // 04:00–09:30
        expect(zones.post).toContainEqual([monday0400 + 12 * H, monday0400 + 16 * H]); // 16:00–20:00
    });

    it('skips weekends', () => {
        // Sat 2024-03-09 00:00 UTC → Sun 2024-03-10 24:00 UTC covers no trading day
        // once the surrounding Friday/Monday bands are filtered out.
        const zones = expandSessionZones(spec, Date.UTC(2024, 2, 9), Date.UTC(2024, 2, 11));
        const saturday = Date.UTC(2024, 2, 9);
        const sunday = Date.UTC(2024, 2, 10);
        const insideWeekend = (b: readonly [number, number]): boolean => b[0] >= saturday && b[1] <= sunday + DAY;
        expect(zones.pre.some(insideWeekend)).toBe(false);
        expect(zones.post.some(insideWeekend)).toBe(false);
    });

    it('tracks the DST offset change across a transition week', () => {
        // Fri 2024-03-08 is EST (UTC-5), Mon 2024-03-11 is EDT (UTC-4).
        const friday = Date.UTC(2024, 2, 8, 12);
        const monday = Date.UTC(2024, 2, 11, 12);
        const zones = expandSessionZones(spec, friday - DAY, monday + DAY);
        expect(zones.pre).toContainEqual([Date.UTC(2024, 2, 8, 9), Date.UTC(2024, 2, 8, 14, 30)]);
        expect(zones.pre).toContainEqual([Date.UTC(2024, 2, 11, 8), Date.UTC(2024, 2, 11, 13, 30)]);
    });

    it('covers arbitrarily deep ranges without a lookback cutoff', () => {
        const to = Date.UTC(2024, 0, 5);
        const from = to - 1_100 * DAY; // ~3 years
        const zones = expandSessionZones(spec, from, to);
        expect(zones.pre.length).toBeGreaterThan(700);
        expect(zones.pre[0]![0]).toBeLessThan(from + 4 * DAY);
        expect(zones.pre[zones.pre.length - 1]![1]).toBeGreaterThan(to - 4 * DAY);
        for (let i = 1; i < zones.pre.length; i += 1) {
            expect(zones.pre[i]![0]).toBeGreaterThan(zones.pre[i - 1]![1]);
        }
    });

    it('emits nothing for a bogus timezone rather than misplacing bands', () => {
        const zones = expandSessionZones({ ...spec, timezone: 'Not/AZone' }, 0, 7 * DAY);
        expect(zones).toEqual({ pre: [], post: [] });
    });
});

describe('SessionShadingTracker', () => {
    it('expands the NEWEST range when the viewport moves while metadata resolves', async () => {
        let resolveSi!: (si: SymbolInfo) => void;
        const data = { symbolInfo: () => new Promise<SymbolInfo>((r) => { resolveSi = r; }) } as unknown as DataControl;
        const updates: Array<SessionZonesUpdate | null> = [];
        const tracker = new SessionShadingTracker((zones) => updates.push(zones));
        const monday = Date.UTC(2024, 2, 4);
        tracker.track(data, 'AAPL', { session: 'extended', timeframe: '60', range: { from: monday, to: monday + DAY } });
        // A load's fit animation settles the viewport two weeks earlier before metadata lands.
        tracker.updateRange({ from: monday - 14 * DAY, to: monday - 13 * DAY });
        resolveSi(US_EQUITIES);
        await new Promise((r) => setTimeout(r, 0));
        const zones = updates[updates.length - 1]!;
        expect(zones.pre.some(([start]) => start < monday - 13 * DAY)).toBe(true);
        tracker.stop();
    });

    it('shades nothing on daily and higher timeframes — the bars aggregate whole sessions', async () => {
        const data = { symbolInfo: () => Promise.resolve<SymbolInfo>(US_EQUITIES) } as unknown as DataControl;
        const monday = Date.UTC(2024, 2, 4);
        for (const timeframe of ['1440', 'D', 'W', '43200']) {
            const updates: Array<SessionZonesUpdate | null> = [];
            const tracker = new SessionShadingTracker((zones) => updates.push(zones));
            tracker.track(data, 'AAPL', { session: 'extended', timeframe, range: { from: monday, to: monday + 30 * DAY } });
            await new Promise((r) => setTimeout(r, 0));
            expect(updates[updates.length - 1]).toEqual({ pre: [], post: [] });
            tracker.stop();
        }
    });

    it('keeps shading intraday extended-session timeframes', async () => {
        const data = { symbolInfo: () => Promise.resolve<SymbolInfo>(US_EQUITIES) } as unknown as DataControl;
        const monday = Date.UTC(2024, 2, 4);
        for (const timeframe of ['1', '60', '240']) {
            const updates: Array<SessionZonesUpdate | null> = [];
            const tracker = new SessionShadingTracker((zones) => updates.push(zones));
            tracker.track(data, 'AAPL', { session: 'extended', timeframe, range: { from: monday, to: monday + DAY } });
            await new Promise((r) => setTimeout(r, 0));
            const zones = updates[updates.length - 1]!;
            expect(zones.pre.length).toBeGreaterThan(0);
            tracker.stop();
        }
    });
});

describe('session highlight history bounds', () => {
    it('clips shading before the first loaded bar and after the current bar', () => {
        expect(clipHighlightRect(-100, 80, 20, 200)).toEqual({ x: 20, width: 60 });
        expect(clipHighlightRect(150, 300, 20, 200)).toEqual({ x: 150, width: 50 });
        expect(clipHighlightRect(-100, 10, 20, 200)).toBeNull();
        expect(clipHighlightRect(210, 300, 20, 200)).toBeNull();
    });
});
