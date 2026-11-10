// @vitest-environment jsdom
// A symbol whose source has one value per bar (`SymbolInfo.ohlc: false`) cannot be drawn by
// the styles made of open, high and low. The chart draws a close-based fallback instead while
// keeping the chosen style (what a save keeps, what comes back on the next symbol), and the
// style pickers grey those styles out. Unknown facts grey nothing; a plugin chart type gates
// itself through `supports`.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Vela } from '../src/index';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { BarStore } from '../src/data/BarStore';
import { priceStyleApplies, shownPriceStyle } from '../src/chart-types/applicability';
import { registerBuiltinChartTypes } from '../src/chart-types/builtins';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { SymbolFacts, SymbolInfo } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
    registerBuiltinChartTypes();
});

/** A plugin style that needs volume — greyed on a symbol without any. */
const NEEDS_VOLUME = 'needsvolume';

const live: Array<{ destroy(): void }> = [];
afterEach(() => {
    for (const x of live.splice(0)) x.destroy();
    unregisterChartType(NEEDS_VOLUME);
});

const DAY = 86_400_000;

function bars(n: number, flat: boolean): OHLCV[] {
    const start = Date.now() - n * DAY;
    return Array.from({ length: n }, (_, i) => {
        const v = 100 + i;
        return flat ? { time: start + i * DAY, open: v, high: v, low: v, close: v, volume: 0 } : { time: start + i * DAY, open: v, high: v + 2, low: v - 2, close: v + 1, volume: 5 };
    });
}

/**
 * One venue: `CPI` has one value per bar and no volume, `BTC` is a normal market, `RAW`
 * states nothing. `holdFacts` keeps every symbol's facts in flight until released.
 */
function venue(opts: { holdFacts?: boolean } = {}) {
    let release: () => void = () => {};
    const gate = opts.holdFacts ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    const provider: DataProvider = {
        getBars: async (ticker, _tf, range) => {
            await new Promise((r) => setTimeout(r, 0));
            return bars(Math.min(range.limit ?? 60, 60), ticker === 'CPI');
        },
        listSymbols: () => Promise.resolve(['CPI', 'BTC', 'RAW'].map((ticker) => ({ ticker }))),
        getSymbolInfo: async (ticker): Promise<SymbolInfo | undefined> => {
            await gate;
            if (ticker === 'CPI') return { ticker, ohlc: false, volume: false, timeframes: { finest: '1M', default: '1M' } };
            if (ticker === 'BTC') return { ticker };
            return undefined;
        },
    };
    return { provider, releaseFacts: () => release() };
}

/** Wait until `cond` holds (async loads, index builds, facts landing). */
async function until(cond: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 300; i += 1) {
        if (cond()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
}

const settle = () => new Promise((r) => setTimeout(r, 40));

describe('which styles can draw a symbol', () => {
    const single: SymbolFacts = { ohlc: false };

    it('unknown facts grey nothing', () => {
        for (const id of ['candles', 'bars', 'heikinashi', 'line', 'area', 'baseline']) {
            expect(priceStyleApplies(id, null)).toBe(true);
            expect(priceStyleApplies(id, undefined)).toBe(true);
            expect(priceStyleApplies(id, {})).toBe(true);
        }
    });

    it('one value per bar rules out the open/high/low styles and keeps the close-based ones', () => {
        expect(['candles', 'bars', 'heikinashi'].filter((id) => priceStyleApplies(id, single))).toEqual([]);
        // A close-based built-in needs no rule: any style the rule does not name applies.
        expect(['line', 'area', 'baseline', 'linemarkers', 'stepline', 'columns'].every((id) => priceStyleApplies(id, single))).toBe(true);
        expect(priceStyleApplies('candles', { ohlc: true })).toBe(true);
    });

    it('a registered type decides through supports; a throwing one counts as supporting', () => {
        registerChartType({ id: NEEDS_VOLUME, supports: (f) => f.volume !== false });
        expect(priceStyleApplies(NEEDS_VOLUME, { volume: false })).toBe(false);
        expect(priceStyleApplies(NEEDS_VOLUME, { ohlc: false })).toBe(true);
        registerChartType({
            id: NEEDS_VOLUME,
            supports: () => {
                throw new Error('boom');
            },
        });
        expect(priceStyleApplies(NEEDS_VOLUME, { volume: false })).toBe(true);
    });

    it('shows the first fallback that exists, else the chosen style', () => {
        expect(shownPriceStyle('candles', single, ['candles', 'line'])).toBe('line');
        expect(shownPriceStyle('candles', single, ['candles', 'line', 'linemarkers'])).toBe('linemarkers');
        expect(shownPriceStyle('area', single, ['candles', 'line', 'area'])).toBe('area');
        expect(shownPriceStyle('candles', null, ['candles', 'line'])).toBe('candles');
        expect(shownPriceStyle('candles', single, ['candles'])).toBe('candles');
    });
});

describe('NativeRenderer — the chosen style and the style it draws', () => {
    it('draws the fallback while the facts rule the chosen style out, and keeps the chosen one as its own', () => {
        const r = new NativeRenderer();
        const log: string[] = [];
        r.onPriceStyleWillChange((from, to) => log.push(`${from}>${to}`));
        r.applyFeature('priceStyle', 'candles');

        r.setSymbolFacts({ ohlc: false, volume: false });
        expect(r.readFeature('shownPriceStyle')).toBe('line');
        expect(r.readFeature('priceStyle')).toBe('candles');
        expect(r.getConfig().series.style).toBe('candles');

        // A pick the facts allow draws as picked; one they rule out is kept but not drawn.
        r.applyFeature('priceStyle', 'area');
        expect(r.readFeature('shownPriceStyle')).toBe('area');
        r.applyConfig({ series: { style: 'bars' } });
        expect(r.readFeature('shownPriceStyle')).toBe('line');
        expect(r.getConfig().series.style).toBe('bars');

        // Unknown facts (a switch) draw the chosen style again.
        r.setSymbolFacts(null);
        expect(r.readFeature('shownPriceStyle')).toBe('bars');
        expect(log).toEqual(['candles>line', 'line>area', 'area>line', 'line>bars']);
    });

    it('a plugin type that does not support the symbol falls back too', () => {
        registerChartType({ id: NEEDS_VOLUME, supports: (f) => f.volume !== false });
        const r = new NativeRenderer();
        r.applyFeature('priceStyle', NEEDS_VOLUME);
        r.setSymbolFacts({ volume: false });
        expect(r.readFeature('shownPriceStyle')).toBe('line');
        expect(r.readFeature('priceStyle')).toBe(NEEDS_VOLUME);
        r.setSymbolFacts({ volume: true });
        expect(r.readFeature('shownPriceStyle')).toBe(NEEDS_VOLUME);
    });
});

describe('a bare chart on a symbol with one value per bar', () => {
    function chartOn(symbol: string, v: ReturnType<typeof venue>, priceStyle = 'candles'): Vela {
        const feed = new MultiProviderFeed(new BarStore());
        void feed.registerProvider('macro', v.provider);
        const host = document.createElement('div');
        document.body.append(host);
        const chart = new Vela(host, { symbol, priceStyle, live: false, volume: false }, { dataFeed: feed });
        live.push(chart);
        return chart;
    }

    it('never draws candles: it draws a line, keeps candles as its style, and draws candles again on a normal symbol', async () => {
        const v = venue();
        const chart = chartOn('CPI', v);
        const facts: Array<SymbolFacts | null> = [];
        chart.on('symbol:facts', (e) => facts.push(e.facts));
        await chart.ready();
        await until(() => chart.symbolFacts() !== null, 'the CPI facts');

        expect(chart.symbolFacts()).toEqual({ ohlc: false, volume: false });
        expect(chart.renderer.get('shownPriceStyle')).toBe('line');
        expect(chart.renderer.get('priceStyle')).toBe('candles');
        expect((chart.renderer.getConfig() as { series: { style: string } }).series.style).toBe('candles');

        await chart.setMarket({ symbol: 'BTC' });
        await until(() => chart.symbolFacts() !== null && chart.symbolFacts()!.ohlc === undefined, 'the BTC facts');
        expect(chart.renderer.get('shownPriceStyle')).toBe('candles');
        expect(facts[facts.length - 1]).toEqual({});
    });

    it('unknown facts draw the chosen style; the fallback follows once they land', async () => {
        const v = venue({ holdFacts: true });
        const chart = chartOn('CPI', v);
        await chart.ready();
        await settle();
        expect(chart.symbolFacts()).toBeNull();
        expect(chart.renderer.get('shownPriceStyle')).toBe('candles');

        v.releaseFacts();
        await until(() => chart.renderer.get('shownPriceStyle') === 'line', 'the fallback');
        expect(chart.renderer.get('priceStyle')).toBe('candles');
    });

    it('a source that states nothing leaves every style drawn as chosen', async () => {
        const v = venue();
        const chart = chartOn('RAW', v, 'bars');
        await chart.ready();
        await settle();
        expect(chart.symbolFacts()).toBeNull();
        expect(chart.renderer.get('shownPriceStyle')).toBe('bars');
    });
});

describe('workspace — the style picker on a symbol with one value per bar', () => {
    function mount(opts: Record<string, unknown>, provider: DataProvider): VelaWorkspace {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { volume: false, persist: false, ...opts, providers: { macro: () => provider } } as never);
        live.push(ws);
        return ws;
    }

    /** The topbar style menu's row for `id`, as the user meets it. */
    function styleRow(id: string): HTMLElement {
        const rows = [...document.querySelectorAll<HTMLElement>(`li[data-vei-id="${id}"]`)].filter((li) => li.closest('ul')?.querySelector('li[data-vei-id="baseline"]'));
        expect(rows).toHaveLength(1);
        return rows[0]!;
    }
    const greyed = (id: string): boolean => styleRow(id).hasAttribute('data-disabled');

    it('greys the open/high/low styles, draws a line, saves candles, and brings candles back on a normal symbol', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'CPI', timeframe: 'D', priceStyle: 'candles' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.priceStyle === 'line', 'the line fallback');

        expect(cell.requestedPriceStyle).toBe('candles');
        expect(ws.getState().charts[0]!.priceStyle).toBe('candles');
        expect((ws.getState().charts[0]!.rendererConfig as { series: { style: string } }).series.style).toBe('candles');
        expect(cell.unavailablePriceStyles()).toEqual(['candles', 'bars', 'heikinashi']);
        expect(['candles', 'bars', 'heikinashi'].map(greyed)).toEqual([true, true, true]);
        expect(['line', 'area', 'baseline'].map(greyed)).toEqual([false, false, false]);
        expect(styleRow('candles').title).toBe("Not available for this symbol's data");
        expect(styleRow('line').hasAttribute('data-checked')).toBe(true); // the style drawn

        cell.setSymbol('BTC');
        await until(() => cell.priceStyle === 'candles', 'candles on BTC');
        expect(cell.unavailablePriceStyles()).toEqual([]);
        expect(['candles', 'bars', 'heikinashi'].map(greyed)).toEqual([false, false, false]);
        expect(styleRow('candles').hasAttribute('data-checked')).toBe(true);
    });

    it('an explicit pick on such a symbol is the cell\'s style from then on', async () => {
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'CPI', timeframe: 'D', priceStyle: 'candles' }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.priceStyle === 'line', 'the line fallback');

        cell.setPriceStyle('area');
        expect(cell.priceStyle).toBe('area');
        expect(ws.getState().charts[0]!.priceStyle).toBe('area');

        cell.setSymbol('BTC');
        await until(() => cell.chart.symbolFacts()?.ohlc === undefined && cell.chart.symbolFacts() !== null, 'the BTC facts');
        expect(cell.priceStyle).toBe('area');
    });

    it('greys nothing while the facts are unknown', async () => {
        const v = venue({ holdFacts: true });
        const ws = mount({ layout: '1', symbol: 'CPI', timeframe: 'D', priceStyle: 'candles' }, v.provider);
        const cell = ws.cell('c1')!;
        await cell.chart.ready();
        await settle();
        expect(cell.priceStyle).toBe('candles');
        expect(cell.unavailablePriceStyles()).toEqual([]);
        expect(['candles', 'bars', 'heikinashi'].map(greyed)).toEqual([false, false, false]);

        v.releaseFacts();
        await until(() => greyed('candles'), 'the greyed candles');
        expect(cell.priceStyle).toBe('line');
    });

    it('facts landing re-project the chrome without reading as an edit', async () => {
        const v = venue({ holdFacts: true });
        const ws = mount({ layout: '1', symbol: 'CPI', timeframe: 'D', priceStyle: 'candles' }, v.provider);
        const cell = ws.cell('c1')!;
        await cell.chart.ready();
        await new Promise((r) => setTimeout(r, 700)); // let the boot's own saves go out
        let saves = 0;
        ws.on('state:changed', () => (saves += 1));

        v.releaseFacts();
        await until(() => greyed('candles'), 'the greyed candles');
        await new Promise((r) => setTimeout(r, 700));
        expect(saves).toBe(0);
    });

    it('a plugin type that does not support the symbol is greyed and falls back', async () => {
        registerChartType({ id: NEEDS_VOLUME, supports: (f) => f.volume !== false });
        const v = venue();
        const ws = mount({ layout: '1', symbol: 'BTC', timeframe: 'D', priceStyle: NEEDS_VOLUME }, v.provider);
        const cell = ws.cell('c1')!;
        await until(() => cell.chart.symbolFacts() !== null, 'the BTC facts');
        expect(cell.priceStyle).toBe(NEEDS_VOLUME);
        expect(greyed(NEEDS_VOLUME)).toBe(false);

        cell.setSymbol('CPI');
        await until(() => cell.priceStyle === 'line', 'the fallback');
        expect(greyed(NEEDS_VOLUME)).toBe(true);
        expect(cell.requestedPriceStyle).toBe(NEEDS_VOLUME);
        expect(ws.getState().charts[0]!.priceStyle).toBe(NEEDS_VOLUME);
    });
});
