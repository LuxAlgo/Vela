// Some data sources confirm a candle's final values a few seconds after the next candle has
// opened. The chart replaces that candle with them, so a live chart ends up showing what a
// reload of the same history shows, not the values the candle had when the next one opened.
import { describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { resolveAnimations } from '../src/core/options';
import { heikinAshiFull } from '../src/core/price-styles/heikin-ashi';
import { registerNativeIndicator, unregisterNativeIndicator } from '../src/core/native-indicators/NativeIndicator';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../src/core/native-indicators/NativeIndicator';
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
import type { IndicatorModel } from '../src/core/model/indicator';
import type { Pane } from '../src/core/model/scene';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { PriceStyle } from '../src/core/options';
import type { Unsubscribe } from '../src/core/util/types';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 26, 16, 0);

const candle = (i: number, open: number, high: number, low: number, close: number, volume = 10): OHLCV => ({
    time: T0 + i * MINUTE,
    open,
    high,
    low,
    close,
    volume,
});

/** Five closed one-minute candles, the last one still forming when the chart opens. */
const history = (): OHLCV[] => [
    candle(0, 100, 102, 99, 101),
    candle(1, 101, 103, 100, 102),
    candle(2, 102, 104, 101, 103),
    candle(3, 103, 105, 102, 104),
    candle(4, 104, 106, 103, 105),
];

/** A live feed the test drives by hand. */
class LiveFeed implements MarketDataFeed {
    push: ((bar: OHLCV) => void) | null = null;
    constructor(private readonly bars: OHLCV[]) {}
    load(): Promise<OHLCV[]> {
        return Promise.resolve(this.bars.map((b) => ({ ...b })));
    }
    subscribe(_cfg: unknown, onBar: (bar: OHLCV) => void): Unsubscribe {
        this.push = onBar;
        return () => {
            this.push = null;
        };
    }
}

/** Records what the chart hands its renderer. */
class RecordingRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'recording';
    readonly features: readonly string[] = [];
    bars: OHLCV[] = [];
    updates: OHLCV[] = [];
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    mount(): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[]): void { this.bars = bars; }
    updateBar(bar: OHLCV): void { this.updates.push(bar); }
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
    private priceStyleCb: ((style: PriceStyle) => void) | null = null;
    onPriceStyleChange(cb: (style: PriceStyle) => void): Unsubscribe {
        this.priceStyleCb = cb;
        return () => {
            this.priceStyleCb = null;
        };
    }
    firePriceStyle(style: PriceStyle): void { this.priceStyleCb?.(style); }
}

async function openLiveChart() {
    const feed = new LiveFeed(history());
    const renderer = new RecordingRenderer();
    const chart = new Vela({} as unknown as HTMLElement, { live: true, volume: false }, { renderer, engines: [], dataFeed: feed });
    const barEvents: OHLCV[] = [];
    chart.on('bar', (b) => barEvents.push(b));
    await chart.ready();
    await flush();
    return { chart, feed, renderer, barEvents };
}

describe('a candle whose final values arrive after the next candle opened', () => {
    it('is replaced on the chart with its final values', async () => {
        const { feed, renderer } = await openLiveChart();
        // The 16:05 candle opens; the 16:04 one still reads what it last showed while forming.
        feed.push!(candle(5, 105, 105.5, 104.5, 105));
        // Ten seconds later the source confirms 16:04: it fell further before it closed.
        const final = candle(4, 104, 106, 101.5, 102, 14);
        feed.push!(final);
        await flush();

        expect(renderer.updates[renderer.updates.length - 1]).toEqual(final);
    });

    it('is what indicators compute on from their next update, and the forming candle keeps updating', async () => {
        let ctx: NativeIndicatorContext | null = null;
        const seen: OHLCV[][] = [];
        class BarsProbe implements NativeIndicator {
            start(c: NativeIndicatorContext): void { ctx = c; c.emit({}); }
            onBars(): void { seen.push(ctx!.bars().map((b) => ({ ...b }))); }
            onViewport(): void {}
            setInputs(): void {}
            suspend(): void {}
            resume(): void {}
            stop(): void {}
        }
        const descriptor: NativeIndicatorDescriptor = {
            type: 'late-candle-probe', title: 'Probe', paneHint: 'price', overlay: true, reactsToViewport: false,
            inputsSchema: () => [], defaultInputs: () => ({}), create: () => new BarsProbe(),
        };
        registerNativeIndicator(descriptor);
        try {
            const { chart, feed } = await openLiveChart();
            chart.addNativeIndicator('late-candle-probe');
            await flush();
            feed.push!(candle(5, 105, 105.5, 104.5, 105));
            const final = candle(4, 104, 106, 101.5, 102, 14);
            feed.push!(final);
            const tick = candle(5, 105, 105.5, 103, 103.5);
            feed.push!(tick);
            await flush();

            const bars = seen[seen.length - 1]!;
            expect(bars).toHaveLength(6);
            expect(bars[4]).toEqual(final);
            expect(bars[5]).toEqual(tick);
        } finally {
            unregisterNativeIndicator('late-candle-probe');
        }
    });

    it('does not fire the bar event, which keeps reporting the forming candle only', async () => {
        const { feed, barEvents } = await openLiveChart();
        const opening = candle(5, 105, 105.5, 104.5, 105);
        feed.push!(opening);
        feed.push!(candle(4, 104, 106, 101.5, 102, 14));
        await flush();

        expect(barEvents).toEqual([opening]);
    });

    it('changes nothing when it matches what the chart holds, or matches no candle on the chart', async () => {
        const { feed, renderer } = await openLiveChart();
        feed.push!(candle(5, 105, 105.5, 104.5, 105));
        await flush();
        const before = renderer.updates.length;

        feed.push!(candle(4, 104, 106, 103, 105)); // the same values the chart already holds
        feed.push!({ ...candle(4, 104, 106, 101.5, 102), time: T0 + 4 * MINUTE + 30_000 }); // no candle opens at 16:04:30
        feed.push!(candle(-3, 99, 99, 99, 99)); // older than the loaded history
        await flush();

        expect(renderer.updates.length).toBe(before);
    });

    it('re-derives the candles after it on a Heikin Ashi chart', async () => {
        const { feed, renderer } = await openLiveChart();
        renderer.firePriceStyle('heikinashi');
        await flush();
        const opening = candle(5, 105, 105.5, 104.5, 105);
        feed.push!(opening);
        const final = candle(4, 104, 106, 101.5, 102, 14);
        feed.push!(final);
        await flush();

        // Each Heikin Ashi candle opens from the one before it, so both are drawn again.
        const expected = heikinAshiFull([...history().slice(0, 4), final, opening]);
        expect(renderer.updates.slice(-2)).toEqual([expected[4], expected[5]]);
    });
});

describe('the chart renderer, given a candle that opens at the same time as an earlier one', () => {
    /* eslint-disable @typescript-eslint/no-explicit-any -- the painted bars are private by design; the test reads them */
    function makeRenderer() {
        const r = new NativeRenderer({
            currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', ...resolveAnimations({ liveBar: 90 }),
            glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'candles',
        });
        const anyR = r as any;
        anyR.coords.setSize(800, 200, 1);
        let repaints = 0;
        anyR.scheduler = { invalidate: () => { repaints += 1; } };
        anyR.animator = { active: false, start: () => {}, stop: () => {} };
        anyR.introPlayed = true;
        return { r, anyR, repaints: () => repaints };
    }

    it('draws that earlier candle with the new values and leaves the forming candle as it was', () => {
        const { r, anyR, repaints } = makeRenderer();
        r.setBars(history());
        r.updateBar(candle(5, 105, 105.5, 104.5, 105));
        const before = repaints();
        const easedClose = anyR.liveEaseClose;

        const final = candle(4, 104, 106, 101.5, 102, 14);
        r.updateBar(final);

        expect(anyR.scene.bars).toHaveLength(6);
        expect(anyR.scene.bars[4]).toEqual(final);
        expect(anyR.scene.bars[5]).toEqual(candle(5, 105, 105.5, 104.5, 105));
        expect(anyR.liveEaseClose).toBe(easedClose);
        expect(repaints()).toBeGreaterThan(before);
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
});
