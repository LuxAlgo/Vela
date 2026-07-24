// The widget's pure modules: the timeframe grammar (src/widget/timeframe.ts) and the
// indicator-manifest resolution (src/widget/indicators.ts). DOM-free — node env.
import { describe, it, expect, vi } from 'vitest';
import { parseTimeframe, timeframeMs, timeframeLabel } from '../src/widget/timeframe';
import { resolveIndicators } from '../src/widget/indicators';
import { fmtPrice, fmtChange, decimalsFor } from '../src/widget/format';
import { tzMenuLabel, tzButtonLabel } from '../src/widget/timezones';
import { priceStyleLabel } from '../src/widget/topbar';
import { RANGE_PRESETS } from '../src/widget/bottombar';
import { filterSymbols } from '../src/widget/symbol-picker';
import { readUrlState } from '../src/widget/url-state';
import { zoomTarget, panTarget, followStep } from '../src/widget/glide';
import { avatarColor } from '../src/widget/symbol-picker';
import { registerWidgetAction, unregisterWidgetAction, widgetActions } from '../src/widget/contributions';
import { loadPersisted, savePersisted, type WidgetStorage } from '../src/widget/persist';

describe('parseTimeframe', () => {
    it('bare numbers are minutes; canonical collapses to bare minutes', () => {
        expect(parseTimeframe('3')).toMatchObject({ valid: true, count: 3, unit: 'MIN', canonical: '3', label: '3 minutes', short: '3m' });
        expect(parseTimeframe('1h')).toMatchObject({ valid: true, canonical: '60', label: '1 hour', short: '1h' });
        expect(parseTimeframe('4H')).toMatchObject({ valid: true, canonical: '240', short: '4h' });
        expect(parseTimeframe('D')).toMatchObject({ valid: true, count: 1, canonical: '1440', short: '1D' });
        expect(parseTimeframe('3M')).toMatchObject({ valid: true, canonical: String(3 * 43_200), label: '3 months', short: '3M' });
        expect(parseTimeframe('S')).toMatchObject({ valid: true, canonical: '1S', label: '1 second' });
        expect(parseTimeframe('30S')).toMatchObject({ valid: true, canonical: '30S' });
    });

    it('rejects empty, garbage, zero and unknown units', () => {
        for (const bad of ['', '  ', 'x1', '1x', '0', '-5', 'h4', '1.5h']) {
            expect(parseTimeframe(bad).valid, bad).toBe(false);
        }
    });

    it('timeframeMs understands existing option values', () => {
        expect(timeframeMs('60')).toBe(3_600_000);
        expect(timeframeMs('4h')).toBe(4 * 3_600_000);
        expect(timeframeMs('D')).toBe(86_400_000);
        expect(timeframeMs('2W')).toBe(2 * 604_800_000);
        expect(Number.isNaN(timeframeMs('nope'))).toBe(true);
    });

    it('timeframeLabel picks the largest even unit', () => {
        expect(timeframeLabel('60')).toBe('1h');
        expect(timeframeLabel('240')).toBe('4h');
        expect(timeframeLabel('1440')).toBe('1D');
        expect(timeframeLabel('15')).toBe('15m');
        expect(timeframeLabel('D')).toBe('1D');
        expect(timeframeLabel('W')).toBe('1W');
    });
});

describe('resolveIndicators', () => {
    const res = (body: unknown, ok = true, status = 200) =>
        ({
            ok,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(String(body)),
        }) as unknown as Response;

    it('accepts an inline manifest (array or wrapped) and defaults enabled to true', async () => {
        const list = await resolveIndicators([{ name: 'A', script: 'plot(1)' }, { name: 'B', script: 'plot(2)', enabled: false }]);
        expect(list).toEqual([
            { name: 'A', script: 'plot(1)', language: undefined, enabled: true },
            { name: 'B', script: 'plot(2)', language: undefined, enabled: false },
        ]);
        const wrapped = await resolveIndicators({ indicators: [{ name: 'C', script: 's', language: 'pine' }] });
        expect(wrapped[0]).toMatchObject({ name: 'C', language: 'pine' });
    });

    it('fetches a manifest URL and per-entry script urls; broken entries are dropped, not fatal', async () => {
        const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
            const u = String(url);
            if (u.includes('manifest.json'))
                return res([
                    { name: 'inline', script: 'x' },
                    { name: 'remote', url: 'https://scripts.example/ema.pine' },
                    { name: 'broken', url: 'https://scripts.example/missing.pine' },
                    { name: 'empty' },
                ]);
            if (u.includes('ema.pine')) return res('ema source');
            return res('', false, 404);
        }) as unknown as typeof fetch;

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const list = await resolveIndicators('https://cfg.example/manifest.json', fetchImpl);
        warn.mockRestore();

        expect(list.map((i) => i.name)).toEqual(['inline', 'remote']);
        expect(list[1]!.script).toBe('ema source');
    });

    it('throws when the manifest URL itself fails', async () => {
        const fetchImpl = (async () => res('', false, 500)) as unknown as typeof fetch;
        await expect(resolveIndicators('https://cfg.example/manifest.json', fetchImpl)).rejects.toThrow('HTTP 500');
    });
});

describe('widget chrome pure helpers', () => {
    it('price formatting scales decimals with magnitude', () => {
        expect(decimalsFor(12345)).toBe(2);
        expect(decimalsFor(0.5)).toBe(4);
        expect(decimalsFor(0.004)).toBe(6);
        expect(fmtPrice(66433.291)).toBe('66,433.29');
        expect(fmtPrice(null)).toBe('—');
        expect(fmtChange(100, 101)).toBe('+1.00 (+1.00%)');
        expect(fmtChange(100, 98.5)).toBe('-1.50 (-1.50%)');
        expect(fmtChange(0, 5)).toBe('');
    });

    it('timezone labels include the UTC offset except for UTC itself', () => {
        expect(tzMenuLabel('Etc/UTC', 'UTC')).toBe('UTC');
        expect(tzMenuLabel('Europe/Paris', 'Paris')).toMatch(/^\(UTC\+[12]\) Paris$/); // CET/CEST
        expect(tzButtonLabel('Etc/UTC')).toBe('UTC');
        expect(tzButtonLabel('Asia/Tokyo')).toBe('UTC+9 Tokyo');
    });

    it('price-style labels: built-ins + registry labels + raw id fallback', () => {
        expect(priceStyleLabel('candles')).toBe('Candles');
        expect(priceStyleLabel('unknown-style')).toBe('unknown-style');
    });

    it('every range chip maps to a core visible-range preset', () => {
        for (const r of RANGE_PRESETS) {
            expect(['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'ALL']).toContain(r.preset);
            expect(r.tf.length).toBeGreaterThan(0);
        }
    });
});

describe('filterSymbols', () => {
    const list = [
        { ticker: 'BTCUSDT', description: 'Bitcoin / TetherUS' },
        { ticker: 'ETHUSDT', description: 'Ethereum / TetherUS' },
        { ticker: 'WBTCUSDT', description: 'Wrapped Bitcoin' },
        { ticker: 'SOLUSDT', description: 'Solana' },
    ];

    it('ranks ticker prefix above substring above description matches', () => {
        expect(filterSymbols(list, 'BTC').map((s) => s.ticker)).toEqual(['BTCUSDT', 'WBTCUSDT']);
        expect(filterSymbols(list, 'bitcoin').map((s) => s.ticker)).toEqual(['BTCUSDT', 'WBTCUSDT']);
        // BTCUSDT matches via its description ("TetherUS" contains "eth") — ranked after the prefix hit.
        expect(filterSymbols(list, 'ETH').map((s) => s.ticker)).toEqual(['ETHUSDT', 'BTCUSDT']);
    });

    it('empty query returns the head of the list; limit caps results', () => {
        expect(filterSymbols(list, '', 2).map((s) => s.ticker)).toEqual(['BTCUSDT', 'ETHUSDT']);
        expect(filterSymbols(list, 'USDT', 2)).toHaveLength(2);
    });
});

describe('readUrlState', () => {
    it('maps the query params and ignores absent/empty ones', () => {
        expect(readUrlState('?symbol=ETHUSDT&interval=15&style=heikinashi&tz=Europe%2FParis')).toEqual({
            symbol: 'ETHUSDT',
            timeframe: '15',
            priceStyle: 'heikinashi',
            timezone: 'Europe/Paris',
        });
        expect(readUrlState('?interval=240')).toEqual({ timeframe: '240' });
        expect(readUrlState('')).toEqual({});
        expect(readUrlState('?symbol=')).toEqual({});
    });
});

describe('widget action contributions', () => {
    it('registers per target, order-sorts, when-filters, and last-id-wins', () => {
        const ran: string[] = [];
        const d1 = registerWidgetAction({ id: 'a', target: 'topbar', label: 'A', order: 2, run: () => ran.push('a') });
        registerWidgetAction({ id: 'b', target: 'topbar', label: 'B', order: 1, run: () => ran.push('b') });
        registerWidgetAction({ id: 'c', target: 'context:body', label: 'C', when: (ctx) => ctx.priceStyle === 'candles', run: () => {} });

        expect(widgetActions('topbar').map((a) => a.id)).toEqual(['b', 'a']);
        const ctx = { priceStyle: 'heikinashi' } as never;
        expect(widgetActions('context:body', ctx)).toHaveLength(0); // when() gate
        expect(widgetActions('context:body')).toHaveLength(1); // unfiltered without ctx

        registerWidgetAction({ id: 'a', target: 'topbar', label: 'A2', run: () => {} });
        expect(widgetActions('topbar').find((x) => x.id === 'a')?.label).toBe('A2');
        d1(); // stale disposer must NOT remove the replacement
        expect(widgetActions('topbar').some((x) => x.id === 'a')).toBe(true);

        unregisterWidgetAction('a');
        unregisterWidgetAction('b');
        unregisterWidgetAction('c');
        expect(widgetActions('topbar')).toHaveLength(0);
    });
});

describe('glide math (reference port)', () => {
    const base = { from: 0, to: 100 * 60_000 };
    it('zoomTarget anchors the right edge and clamps the span', () => {
        expect(zoomTarget(base, 0.5)).toEqual({ from: 50 * 60_000, to: base.to });
        expect(zoomTarget({ from: 0, to: 60_000 }, 0.1).to - zoomTarget({ from: 0, to: 60_000 }, 0.1).from).toBe(60_000);
    });
    it('panTarget shifts by a fraction of the span', () => {
        expect(panTarget(base, 0.2)).toEqual({ from: 20 * 60_000, to: 120 * 60_000 });
        expect(panTarget(base, -0.2).from).toBe(-20 * 60_000);
    });
    it('followStep eases toward the target and snaps when close', () => {
        const target = zoomTarget(base, 0.5);
        let cur = { ...base };
        let done = false;
        for (let i = 0; i < 100 && !done; i++) ({ cur, done } = followStep(cur, target));
        expect(done).toBe(true);
        expect(cur).toEqual(target);
    });
});

describe('avatarColor', () => {
    it('is deterministic per ticker and a valid hsl()', () => {
        expect(avatarColor('BTCUSDT')).toBe(avatarColor('BTCUSDT'));
        expect(avatarColor('ETHUSDT')).toMatch(/^hsl\(\d+, 42%, 38%\)$/);
        expect(avatarColor('BTCUSDT')).not.toBe(avatarColor('ETHUSDT'));
    });
});

describe('WidgetStorage adapter (pluggable persistence)', () => {
    it('sync adapters resolve synchronously (the localStorage-like path)', () => {
        const store = new Map<string, string>();
        const sync: WidgetStorage = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) };
        savePersisted(sync, 'k', { symbol: 'ETHUSDT', timeframe: '15' });
        const out = loadPersisted(sync, 'k');
        expect(out).not.toBeInstanceOf(Promise); // construction-time restore relies on this
        expect(out).toEqual({ symbol: 'ETHUSDT', timeframe: '15' });
    });

    it('async adapters return a promise with the parsed state (late-apply path)', async () => {
        const store = new Map<string, string>();
        const asyncStore: WidgetStorage = {
            get: async (k) => store.get(k) ?? null,
            set: async (k, v) => void store.set(k, v),
        };
        savePersisted(asyncStore, 'k', { priceStyle: 'heikinashi' });
        await Promise.resolve(); // let the fire-and-forget set land
        const out = loadPersisted(asyncStore, 'k');
        expect(out).toBeInstanceOf(Promise);
        expect(await out).toEqual({ priceStyle: 'heikinashi' });
    });

    it('corrupted payloads and rejecting adapters degrade to an empty state', async () => {
        const bad: WidgetStorage = { get: () => '{not json', set: () => {} };
        expect(loadPersisted(bad, 'k')).toEqual({});
        const rejecting: WidgetStorage = { get: async () => Promise.reject(new Error('offline')), set: () => {} };
        expect(await loadPersisted(rejecting, 'k')).toEqual({});
    });
});
