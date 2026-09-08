// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { ChartCell, type CellBoot, type CellDeps } from '../src/workspace/ChartCell';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    VisibleRange,
    InputChangeEvent,
    ClickEvent,
    CrosshairEvent,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { InputValue } from '../src/core/model/inputs';
import type { IndicatorModel, Pane, ScenePatch } from '../src/core/model';
import type { PriceStyle } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';
import { DARK_THEME } from '../src/core/theme';

/**
 * The ChartCell persistence round-trip — the layer the unit suite never covered
 * (dehydrate reads LIVE handles, applyIndicatorLedger converges them): the
 * regression net for the native settings/visibility persistence work (#146,
 * #149). The chart runs for real (classic natives compute in-process); only the
 * renderer and the data feed are fakes, per the orchestrator tests' pattern.
 */

const FIVE_MIN = 300_000;
const makeBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({
        time: 1_700_000_000_000 + i * FIVE_MIN,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10 + i,
    }));

class MockDataFeed implements MarketDataFeed {
    load(): Promise<OHLCV[]> {
        return Promise.resolve(makeBars(60));
    }
    subscribe(): Unsubscribe {
        return () => {};
    }
}

/** Minimal renderer: records mounts/visibility, honors nothing visual. */
class FakeRenderer implements IChartRenderer {
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
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    applyFeature(): void {}
    readFeature(): unknown {
        return undefined;
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
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
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

function makeDeps(over: Partial<CellDeps> = {}): CellDeps {
    return {
        feed: new MockDataFeed(),
        engines: {},
        chartDefaults: { renderer: FakeRenderer, drawings: false } as CellDeps['chartDefaults'],
        theme: DARK_THEME,
        live: false,
        volume: true,
        statusline: false,
        watermark: false,
        nativeBackend: 'canvas2d',
        dialogHost: document.body,
        timezone: () => 'Etc/UTC',
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

const SEED: CellBoot = {
    symbol: 'BINANCE:BTCUSDT',
    timeframe: '60',
    priceStyle: 'candles',
} as CellBoot;

function makeCell(seed: Partial<CellBoot> = {}, deps: Partial<CellDeps> = {}): ChartCell {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new ChartCell('c1', host, { ...SEED, ...seed } as CellBoot, makeDeps(deps));
}

const settle = () => new Promise((r) => setTimeout(r, 20));

const aroonOf = (cell: ChartCell) => cell.chart.indicators().find((h) => h.nativeType === 'aroon');
const volumeOf = (cell: ChartCell) => cell.chart.indicators().find((h) => h.nativeType === 'volume');

describe('ChartCell native persistence round-trip (#146/#149)', () => {
    it('a stored-input seed boots WITHOUT computing against unloaded bars (the #149 crash) and applies values + hidden', async () => {
        // Pre-#149 this threw inside the constructor: applyNativeLedgerEntry called
        // setInputs before start(), and ClassicIndicator.recompute read bars off a
        // null context — killing workspace boot.
        const cell = makeCell({
            indicators: { natives: [{ type: 'volume', hidden: true }, { type: 'aroon', inputs: { length: 50 } }], manifest: [] },
        } as Partial<CellBoot>);
        await settle();
        const aroon = aroonOf(cell)!;
        expect(aroon.inputValues().length).toBe(50);
        expect(aroon.visible).toBe(true);
        expect(volumeOf(cell)!.visible).toBe(false);
        cell.destroy();
    });

    it('dehydrate captures the live deltas and hidden flags; defaults collapse to bare types', async () => {
        const cell = makeCell({ indicators: { natives: ['volume', 'aroon'], manifest: [] } } as Partial<CellBoot>);
        await settle();
        aroonOf(cell)!.setInput('length', 50);
        volumeOf(cell)!.setVisible(false);
        const led = cell.dehydrate().indicators!;
        expect(led.natives).toEqual([{ type: 'volume', hidden: true }, { type: 'aroon', inputs: { length: 50 } }]);
        cell.destroy();
    });

    it('rehydrate converges a DRIFTED chart back to the document', async () => {
        const cell = makeCell({ indicators: { natives: ['volume', 'aroon'], manifest: [] } } as Partial<CellBoot>);
        await settle();
        const saved = {
            ...SEED,
            indicators: { natives: [{ type: 'volume', hidden: true }, { type: 'aroon', inputs: { length: 50 } }], manifest: [] },
        };
        // Drift the live chart away from the document…
        aroonOf(cell)!.setInput('length', 21);
        volumeOf(cell)!.setVisible(true);
        // …and the document wins on rehydrate.
        cell.rehydrate(saved as never);
        await settle();
        expect(aroonOf(cell)!.inputValues().length).toBe(50);
        expect(volumeOf(cell)!.visible).toBe(false);
        cell.destroy();
    });

    it('a LEGACY bare-string ledger resets to declaration defaults, visible, without duplicating', async () => {
        const cell = makeCell({
            indicators: { natives: [{ type: 'volume', hidden: true }, { type: 'aroon', inputs: { length: 50 } }], manifest: [] },
        } as Partial<CellBoot>);
        await settle();
        cell.rehydrate({ ...SEED, indicators: { natives: ['volume', 'aroon'], manifest: [] } } as never);
        await settle();
        const natives = cell.chart.indicators().filter((h) => h.nativeType !== undefined);
        expect(natives).toHaveLength(2);
        expect(aroonOf(cell)!.inputValues().length).toBe(14); // declaration default
        expect(volumeOf(cell)!.visible).toBe(true);
        cell.destroy();
    });

    it('the legend eye marks the cell state dirty (the save trigger for visibility)', async () => {
        const onStateDirty = vi.fn();
        const cell = makeCell({ indicators: { natives: ['aroon'], manifest: [] } } as Partial<CellBoot>, { onStateDirty });
        await settle();
        onStateDirty.mockClear();
        aroonOf(cell)!.setVisible(false);
        await settle();
        expect(onStateDirty).toHaveBeenCalled();
        cell.destroy();
    });
});
