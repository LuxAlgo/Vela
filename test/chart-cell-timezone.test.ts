// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { ChartCell, type CellBoot, type CellDeps } from '../src/workspace/ChartCell';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { BarStore } from '../src/data/BarStore';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    VisibleRange,
    InputChangeEvent,
    ClickEvent,
    CrosshairEvent,
} from '../src/core/ports/IChartRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { InputValue } from '../src/core/model/inputs';
import type { IndicatorModel, Pane, ScenePatch } from '../src/core/model';
import type { PriceStyle } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import { DARK_THEME } from '../src/core/theme';

/**
 * The exchange time-zone rule at the cell seam: the workspace stores `'exchange'`, and
 * each cell resolves it to ITS market's `SymbolInfo.timezone` — Chicago for a future,
 * UTC for crypto — re-resolving when the symbol changes and never writing the rule
 * itself into the renderer. A real MultiProviderFeed routes two fake providers; only
 * the renderer is a fake that records the `timezone` feature.
 */

const HOUR = 3_600_000;
const makeBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000_000 + i * HOUR, open: 100, high: 101, low: 99, close: 100.5, volume: 1 }));

function fakeProvider(tickers: string[], symInfo: Record<string, unknown> | null): DataProvider {
    return {
        getBars: (_t, _tf, range) => Promise.resolve(makeBars(range.limit ?? 10)),
        listSymbols: () => Promise.resolve(tickers.map((ticker) => ({ ticker }))),
        ...(symInfo ? { getSymbolInfo: (ticker: string) => Promise.resolve({ ticker, ...symInfo }) } : {}),
    };
}

/** Minimal renderer that only remembers the `timezone` feature (the axis zone). */
class ZoneRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true,
        paneManagement: false,
        fills: 'primitive',
        bgcolor: 'primitive',
        hline: 'native',
        markers: true,
        barcolor: 'approximated',
        perPointColor: true,
        drawings: true,
        userDrawings: false,
        tables: true,
        inputsUI: true,
    };
    readonly name = 'zone-fake';
    readonly features: readonly string[] = ['timezone'];
    timezone = 'UTC'; // the native renderer's config default
    writes: string[] = [];
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    applyFeature(feature: string, value: unknown): void {
        if (feature === 'timezone') {
            this.timezone = String(value);
            this.writes.push(this.timezone);
        }
    }
    readFeature(feature: string): unknown {
        return feature === 'timezone' ? this.timezone : undefined;
    }
    destroy(): void {}
    setBars(): void {}
    updateBar(): void {}
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        return { id: model.id };
    }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe {
        return () => {};
    }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe {
        return () => {};
    }
    onToggleIndicatorVisible(_cb: (id: string, visible: boolean) => void): Unsubscribe {
        return () => {};
    }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe {
        return () => {};
    }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe {
        return () => {};
    }
    getVisibleRange(): VisibleRange | null {
        return null;
    }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe {
        return () => {};
    }
    onPriceStyleChange(_cb: (style: PriceStyle) => void): Unsubscribe {
        return () => {};
    }
    setNativeData(): void {}
    setIndicatorStatus(): void {}
}

let lastRenderer: ZoneRenderer | null = null;
class TrackedZoneRenderer extends ZoneRenderer {
    constructor() {
        super();
        lastRenderer = this;
    }
}

function makeFeed(): MultiProviderFeed {
    const feed = new MultiProviderFeed(new BarStore());
    void feed.registerProvider('cme', fakeProvider(['ES1!'], { timezone: 'America/Chicago', session: '1700-1600' }));
    void feed.registerProvider('binance', fakeProvider(['BTCUSDT'], { timezone: 'Etc/UTC', session: '24x7' }));
    void feed.registerProvider('bare', fakeProvider(['XYZ'], null)); // no metadata at all
    return feed;
}

function makeDeps(feed: MultiProviderFeed, timezone: () => string, over: Partial<CellDeps> = {}): CellDeps {
    return {
        feed,
        engines: {},
        chartDefaults: { renderer: TrackedZoneRenderer, drawings: false } as CellDeps['chartDefaults'],
        theme: DARK_THEME,
        live: false,
        volume: false,
        statusline: false,
        watermark: false,
        nativeBackend: 'canvas2d',
        dialogHost: document.body,
        timezone,
        setTimezone: () => {},
        context: () => ({}) as never,
        manifestSettled: () => true,
        activate: () => {},
        multiCell: () => false,
        isMaximized: () => false,
        toggleMaximize: () => {},
        cellDragTarget: () => null,
        previewDropTarget: () => {},
        dropCell: () => {},
        onMarketChanged: () => {},
        onPriceStyleChanged: () => {},
        onIndicatorsChanged: () => {},
        onStatusPrefsChanged: () => {},
        onStateDirty: () => {},
        toast: () => {},
        ...over,
    };
}

function makeCell(symbol: string, deps: CellDeps): ChartCell {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new ChartCell('c1', host, { symbol, timeframe: '60', priceStyle: 'candles' } as CellBoot, deps);
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('ChartCell — the exchange time-zone rule', () => {
    it("resolves 'exchange' to the symbol's own zone once its metadata lands", async () => {
        const onMarketChanged = vi.fn();
        const cell = makeCell('cme:ES1!', makeDeps(makeFeed(), () => 'exchange', { onMarketChanged }));
        const renderer = lastRenderer!;
        expect(renderer.writes).toEqual([]); // unknown yet: UTC (the default) — no write
        await settle();
        expect(cell.exchangeTimezone).toBe('America/Chicago');
        expect(cell.displayTimezone).toBe('America/Chicago');
        expect(renderer.timezone).toBe('America/Chicago');
        expect(renderer.writes).not.toContain('exchange'); // the renderer only ever sees a real zone
        expect(onMarketChanged).toHaveBeenCalled(); // the workspace re-labels the shared bottom bar
        cell.destroy();
    });

    it('re-resolves when the symbol changes market — and falls back to UTC without metadata', async () => {
        const cell = makeCell('cme:ES1!', makeDeps(makeFeed(), () => 'exchange'));
        const renderer = lastRenderer!;
        await settle();
        expect(renderer.timezone).toBe('America/Chicago');

        cell.setSymbol('binance:BTCUSDT');
        await settle();
        expect(cell.exchangeTimezone).toBe('Etc/UTC');
        expect(renderer.timezone).toBe('Etc/UTC');

        cell.setSymbol('bare:XYZ');
        await settle();
        expect(cell.exchangeTimezone).toBeUndefined();
        expect(cell.displayTimezone).toBe('Etc/UTC');
        cell.destroy();
    });

    it('a fixed workspace zone ignores the market zone; switching to the rule adopts it', async () => {
        let zone = 'Europe/Paris';
        const cell = makeCell('cme:ES1!', makeDeps(makeFeed(), () => zone));
        const renderer = lastRenderer!;
        await settle();
        expect(cell.exchangeTimezone).toBe('America/Chicago'); // known…
        expect(renderer.timezone).toBe('Europe/Paris'); // …but not applied under a fixed zone

        zone = 'exchange';
        cell.applyTimezone(); // what VelaWorkspace.setTimezone does per cell
        expect(renderer.timezone).toBe('America/Chicago');

        zone = 'Asia/Tokyo';
        cell.applyTimezone();
        expect(renderer.timezone).toBe('Asia/Tokyo');
        cell.destroy();
    });

    it('applyTimezone skips the write when the renderer already holds the resolved zone', async () => {
        const cell = makeCell('cme:ES1!', makeDeps(makeFeed(), () => 'exchange'));
        const renderer = lastRenderer!;
        await settle();
        const before = renderer.writes.length;
        cell.applyTimezone();
        cell.applyTimezone();
        expect(renderer.writes.length).toBe(before);
        cell.destroy();
    });
});
