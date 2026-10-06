// The price-style switch is announced BEFORE it happens: the native renderer's one runtime
// write path calls `onPriceStyleWillChange(from, to)` while its scene still holds `from`, and
// the chart relays it as the `priceStyle:change` event — the seam a host animating style
// switches captures the outgoing frame from.
import { describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel, Pane, ScenePatch } from '../src/core/model';
import type { InputValue } from '../src/core/model/inputs';
import { resolveAnimations, type PriceStyle, type VelaTheme } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';

const makeBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000_000 + i * 3_600_000, open: 100, high: 101, low: 99, close: 100.5, volume: 1 }));

class MockDataFeed implements MarketDataFeed {
    load(): Promise<OHLCV[]> {
        return Promise.resolve(makeBars(20));
    }
    subscribe(): Unsubscribe {
        return () => {};
    }
}

/** Honors the native renderer's style-switch order: announce, switch, report. */
class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = ['priceStyle'];
    readonly willChange = new Set<(from: PriceStyle, to: PriceStyle) => void>();
    readonly changed = new Set<(style: PriceStyle) => void>();
    constructor(public style: PriceStyle = 'candles') {}
    applyFeature(key: string, value: unknown): void {
        if (key !== 'priceStyle' || value === this.style) return;
        const from = this.style;
        for (const cb of this.willChange) cb(from, value as PriceStyle);
        this.style = value as PriceStyle;
        for (const cb of this.changed) cb(this.style);
    }
    readFeature(key: string): unknown {
        return key === 'priceStyle' ? this.style : undefined;
    }
    onPriceStyleWillChange(cb: (from: PriceStyle, to: PriceStyle) => void): Unsubscribe {
        this.willChange.add(cb);
        return () => this.willChange.delete(cb);
    }
    onPriceStyleChange(cb: (style: PriceStyle) => void): Unsubscribe {
        this.changed.add(cb);
        return () => this.changed.delete(cb);
    }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
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
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe {
        return () => {};
    }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe {
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
}

function makeChart(style: PriceStyle = 'candles') {
    const renderer = new FakeRenderer(style);
    const chart = new Vela({} as unknown as HTMLElement, { live: false, volume: false, priceStyle: style }, { renderer, engines: [], dataFeed: new MockDataFeed() });
    return { chart, renderer };
}

describe('chart event priceStyle:change', () => {
    it('fires { from, to } before the renderer reports the new style, while the chart still shows `from`', () => {
        const { chart, renderer } = makeChart();
        const order: string[] = [];
        chart.on('priceStyle:change', ({ from, to }) => order.push(`event ${from}>${to} showing ${String(chart.renderer.get('priceStyle'))}`));
        renderer.onPriceStyleChange((style) => order.push(`reported ${style}`));

        chart.renderer.set('priceStyle', 'line');

        expect(order).toEqual(['event candles>line showing candles', 'reported line']);
        chart.destroy();
    });

    it('stays silent for the constructed style and for a set to the style already shown', () => {
        const { chart } = makeChart('area');
        const seen: Array<{ from: string; to: string }> = [];
        chart.on('priceStyle:change', (e) => seen.push(e));

        chart.renderer.set('priceStyle', 'area');
        expect(seen).toEqual([]);

        chart.renderer.set('priceStyle', 'bars');
        chart.renderer.set('priceStyle', 'bars');
        expect(seen).toEqual([{ from: 'area', to: 'bars' }]);
        chart.destroy();
    });

    it('drops its renderer subscription on destroy', () => {
        const { chart, renderer } = makeChart();
        expect(renderer.willChange.size).toBe(1);
        chart.destroy();
        expect(renderer.willChange.size).toBe(0);
    });
});

describe('NativeRenderer onPriceStyleWillChange', () => {
    it('announces every runtime write path before the scene switches, and never a no-op write', () => {
        const r = new NativeRenderer({
            currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', ...resolveAnimations(undefined),
            glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'line',
        });
        const log: string[] = [];
        r.onPriceStyleWillChange((from, to) => log.push(`will ${from}>${to} showing ${String(r.readFeature('priceStyle'))}`));
        r.onPriceStyleChange((style) => log.push(`changed ${style}`));

        r.applyFeature('priceStyle', 'line'); // the constructed style: nothing to announce
        expect(log).toEqual([]);

        r.applyFeature('priceStyle', 'area'); // feature set (topbar menu, ctx.setPriceStyle, renderer.set)
        r.applyConfig({ series: { style: 'bars' } }); // settings dialog / template / restore
        expect(log).toEqual(['will line>area showing line', 'changed area', 'will area>bars showing area', 'changed bars']);

        r.applyConfig({ series: { style: 'bars' } });
        expect(log).toHaveLength(4);
    });

    it('unsubscribes', () => {
        const r = new NativeRenderer();
        const log: string[] = [];
        const off = r.onPriceStyleWillChange((from, to) => log.push(`${from}>${to}`));
        off();
        r.applyFeature('priceStyle', 'line');
        expect(log).toEqual([]);
    });
});
