// @vitest-environment jsdom
// The workspace's answer to a source that refuses a timeframe for good (`data:unavailable`):
// the cell shows the timeframe the source suggests and says so, while the timeframe the user
// asked for stays the cell's own — persisted, shared through the timeframe link, and back on
// the next symbol that serves it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { DataUnavailableError } from '../src/index';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { OHLCV } from '../src/core/model/ohlcv';
import { chartTimeframeOf } from '../src/widget/timeframe';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    vi.restoreAllMocks();
});

const MINUTE = 60_000;
const COARSE = new Set(['D', '1440', 'W', '10080', 'M', '43200']);

function bars(n: number): OHLCV[] {
    const start = Date.now() - n * MINUTE;
    return Array.from({ length: n }, (_, i) => ({ time: start + i * MINUTE, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));
}

/**
 * One venue with symbols that each refuse differently: BTC serves everything; GDP only daily
 * and coarser (default and finest 1D); CPI only monthly (a finest, no default); NONE refuses
 * every timeframe without a hint; LOOP refuses every timeframe, its suggested one included.
 */
function venue() {
    const calls: Array<{ ticker: string; tf: string }> = [];
    const provider: DataProvider = {
        getBars(ticker, tf, range) {
            calls.push({ ticker, tf });
            const refuse = (d: { finest?: string; default?: string }) => Promise.reject(new DataUnavailableError({ reason: 'timeframe', ...d }));
            if (ticker === 'GDP' && !COARSE.has(tf)) return refuse({ finest: '1D', default: '1D' });
            if (ticker === 'CPI' && tf !== 'M' && tf !== '43200') return refuse({ finest: '1M' });
            if (ticker === 'NONE') return refuse({});
            if (ticker === 'LOOP') return refuse({ default: 'W' });
            return Promise.resolve(bars(Math.min(range.limit ?? 50, 50)));
        },
        listSymbols: () => Promise.resolve(['BTC', 'GDP', 'CPI', 'NONE', 'LOOP'].map((ticker) => ({ ticker }))),
    };
    return { provider, calls, asked: (ticker: string, tf?: string) => calls.filter((c) => c.ticker === ticker && (tf === undefined || c.tf === tf)).length };
}

function mount(opts: Record<string, unknown>, provider: DataProvider): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { volume: false, persist: false, ...opts, providers: { macro: () => provider } } as never);
    live.push(ws);
    return ws;
}

/** Wait until `cond` holds (async loads, index builds, the fallback's own switch). */
async function until(cond: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
        if (cond()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
}

const settle = () => new Promise((r) => setTimeout(r, 40));

/** The toast a user sees right now, and its kind. */
function toast(ws: VelaWorkspace): { text: string; kind: string } | null {
    const el = (ws as unknown as { root: HTMLElement }).root.querySelector<HTMLElement>('.vela-toast[data-open]');
    return el ? { text: el.textContent ?? '', kind: el.dataset.type ?? '' } : null;
}

describe('a source hint in the chart\'s timeframe form', () => {
    it('reads one day, week or month as the presets do, other counts as bare minutes', () => {
        expect(chartTimeframeOf('1D')).toBe('D');
        expect(chartTimeframeOf('D')).toBe('D');
        expect(chartTimeframeOf('W')).toBe('W');
        expect(chartTimeframeOf('1M')).toBe('M');
        expect(chartTimeframeOf('3M')).toBe('129600');
        expect(chartTimeframeOf('12M')).toBe('518400');
        expect(chartTimeframeOf('240')).toBe('240');
        expect(chartTimeframeOf('2D')).toBe('2880');
        expect(chartTimeframeOf('30S')).toBe('30S');
        expect(chartTimeframeOf(undefined)).toBeNull();
        expect(chartTimeframeOf('soon')).toBeNull();
    });
});

describe('workspace — a refused timeframe', () => {
    it('shows the source\'s default, says so, keeps the requested timeframe, and brings it back on a symbol that serves it', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'GDP', timeframe: '60' }, v.provider);
        const cell = ws.cell('c1')!;
        const ends: Array<{ symbol: string; timeframe: string; bars: number }> = [];
        cell.chart.on('load:end', (e) => ends.push({ symbol: e.symbol, timeframe: e.timeframe, bars: e.bars }));
        await until(() => cell.chart.market.timeframe === 'D' && ends.some((e) => e.timeframe === 'D' && e.bars > 0), 'the 1D fallback');

        expect(cell.timeframe).toBe('D'); // what the topbar shows
        expect(cell.requestedTimeframe).toBe('60'); // what the user asked for
        expect(toast(ws)).toEqual({ text: 'GDP is not available at 1h. Showing 1D instead.', kind: 'info' });
        expect(ws.getState().charts[0]!.timeframe).toBe('60'); // a reload asks for 1h again
        expect(v.asked('GDP', '60')).toBe(1); // asked once, never polled

        cell.setSymbol('BTC');
        await until(() => ends.some((e) => e.symbol === 'BTC' && e.timeframe === '60' && e.bars > 0), 'BTC at 1h');
        expect(cell.chart.market.timeframe).toBe('60');
        expect(cell.timeframe).toBe('60');
        expect(cell.requestedTimeframe).toBe('60');
        expect(ws.getState().charts[0]!.timeframe).toBe('60');
    });

    it('falls back from the chart\'s default timeframe too (none set)', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'GDP' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.chart.market.timeframe === 'D', 'the 1D fallback');
        expect(cell.requestedTimeframe).toBe('60');
        expect(v.asked('GDP', '60')).toBe(1);
    });

    it('takes the finest timeframe when the source suggests no default', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'CPI', timeframe: '60' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.chart.market.timeframe === 'M', 'the 1M fallback');
        expect(cell.requestedTimeframe).toBe('60');
        await until(() => toast(ws) !== null, 'the toast');
        expect(toast(ws)!.text).toBe('CPI is not available at 1h. Showing 1M instead.');
    });

    it('an explicit timeframe pick becomes the requested one', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'GDP', timeframe: '60' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.chart.market.timeframe === 'D', 'the 1D fallback');

        // Picking the timeframe already shown keeps it — no reload — and makes it the user's.
        const before = v.calls.length;
        cell.setTimeframe('D');
        expect(cell.requestedTimeframe).toBe('D');
        expect(ws.getState().charts[0]!.timeframe).toBe('D');
        await settle();
        expect(v.calls.length).toBe(before);

        // Any other pick switches and is requested from then on.
        cell.setTimeframe('W');
        await until(() => cell.chart.market.timeframe === 'W', 'the weekly pick');
        expect(cell.requestedTimeframe).toBe('W');
        cell.setSymbol('BTC');
        await until(() => cell.chart.market.symbol === 'BTC', 'BTC');
        expect(cell.chart.market.timeframe).toBe('W');
    });

    it('with nothing better to show, says so and leaves the timeframe as set', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'NONE', timeframe: '60' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => toast(ws) !== null, 'the toast');
        expect(toast(ws)).toEqual({ text: 'NONE is not available at 1h.', kind: 'error' });
        expect(cell.chart.market.timeframe).toBe('60');
        expect(cell.timeframe).toBe('60');
    });

    it('never chains switches: a refused fallback is reported, not followed', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'LOOP', timeframe: '60' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => toast(ws)?.kind === 'error', 'the error toast');
        await settle();
        expect(toast(ws)!.text).toBe('LOOP is not available at 1W.');
        expect(v.asked('LOOP')).toBe(2); // the requested timeframe, then the suggested one: no more
        expect(cell.requestedTimeframe).toBe('60');
    });

    it('the timeframe link shares the requested timeframe, never a fallback', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const v = venue();
        const ws = mount(
            { layout: '2h', sync: { timeframe: true }, cells: { a: { symbol: 'GDP', timeframe: '60' }, b: { symbol: 'BTC', timeframe: '60' } } },
            v.provider,
        );
        const a = ws.cell('a')!;
        const b = ws.cell('b')!;
        await until(() => a.chart.market.timeframe === 'D', 'the fallback on a');
        await settle();
        expect(b.chart.market.timeframe).toBe('60'); // the fallback stays on its own cell

        b.setTimeframe('240');
        await until(() => b.chart.market.timeframe === '240' && a.requestedTimeframe === '240', 'the link');
        await settle();
        expect(a.chart.market.timeframe).toBe('D'); // GDP refuses 4h too: still its fallback
        expect(a.timeframe).toBe('D');

        a.setTimeframe('D'); // picked by hand: the link carries it
        await until(() => b.chart.market.timeframe === 'D', 'b following the pick');
        expect(a.requestedTimeframe).toBe('D');
        expect(b.requestedTimeframe).toBe('D');
    });
});
