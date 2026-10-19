// Native indicators across a history load that is still arriving. The renderer paints a
// model's dense point array index-aligned from its `anchorTime` bar (bar 0 when absent),
// so a model computed over one bar array and painted over another must say where it
// starts — otherwise a prepend slides the whole plot into the past (a deep one pushes it
// off-screen: the plot "disappears"). On top of that, the classic studies follow the
// script engines' history policy: no compute over a partial history, one compute when it
// completes, so a value never repaints as older bars land under it.
import { describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    IndicatorStatus,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig, PriceStyle, VelaTheme } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import { isLineLikeSeries, type LineLikeSeries } from '../src/core/model/series';
import type { Unsubscribe } from '../src/core/util/types';
import { classicSpecs } from '../src/core/native-indicators/classics';
import { heikinAshiFull } from '../src/core/price-styles/heikin-ashi';
import { registerNativeIndicator, unregisterNativeIndicator, type NativeIndicator, type NativeIndicatorContext, type NativeIndicatorDescriptor } from '../src/core/native-indicators/NativeIndicator';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** `total` hourly bars whose close is a non-repeating wave, so every bar is distinguishable. */
function universe(total: number): OHLCV[] {
    return Array.from({ length: total }, (_, i) => {
        const close = 100 + 10 * Math.sin(i / 7) + i / 50;
        const open = close - 2 * Math.cos(i / 5); // a real body, so Heikin Ashi candles differ from these
        return { time: T0 + i * HOUR, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1 };
    });
}

/** Keeps every indicator's CURRENT model the way the renderer would: mounts replace it, value patches update it. */
class RecordingRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'recording';
    readonly features: readonly string[] = [];
    bars: OHLCV[] = [];
    models = new Map<string, IndicatorModel>();
    /** Every model as mounted, in order (remounts included). */
    mounts: IndicatorModel[] = [];
    status = new Map<string, IndicatorStatus>();
    private visibleRange: VisibleRange | null = null;
    private viewportCb: ((range: VisibleRange) => void) | null = null;
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[]): void { this.bars = [...bars]; }
    updateBar(bar: OHLCV): void {
        const last = this.bars[this.bars.length - 1];
        if (last && last.time === bar.time) this.bars[this.bars.length - 1] = bar;
        else this.bars.push(bar);
    }
    setNativeData(): void {}
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        this.models.set(model.id, { ...model, series: model.series.map((s) => ({ ...s })) });
        this.mounts.push(model);
        return { id: model.id };
    }
    updateIndicator(h: IndicatorRenderHandle, patch: ScenePatch): void {
        const model = this.models.get(h.id);
        if (!model || patch.kind !== 'value') return;
        if (patch.anchorTime !== undefined) model.anchorTime = patch.anchorTime ?? undefined;
        for (const delta of patch.series) {
            const spec = model.series.find((s) => s.id === delta.seriesId);
            if (spec && delta.kind === 'points' && isLineLikeSeries(spec)) spec.points = delta.points;
        }
    }
    removeIndicator(h: IndicatorRenderHandle): void { this.models.delete(h.id); }
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
    setIndicatorStatus(h: IndicatorRenderHandle, status: IndicatorStatus): void { this.status.set(h.id, status); }
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return this.visibleRange; }
    setVisibleRange(range: VisibleRange): void { this.visibleRange = range; }
    onViewportChange(cb: (r: VisibleRange) => void): Unsubscribe { this.viewportCb = cb; return () => (this.viewportCb = null); }
    fireViewport(range: VisibleRange): void { this.visibleRange = range; this.viewportCb?.(range); }
    private priceStyleCb: ((style: PriceStyle) => void) | null = null;
    onPriceStyleChange(cb: (style: PriceStyle) => void): Unsubscribe { this.priceStyleCb = cb; return () => (this.priceStyleCb = null); }
    /** Simulate the user picking a price style. */
    firePriceStyle(style: PriceStyle): void { this.priceStyleCb?.(style); }
}

/** A source that heals the symbol while answering: snapshots are pushed by the test, `finish` resolves the load. */
class HealingFeed implements MarketDataFeed {
    readonly all: OHLCV[];
    private onBatch: ((bars: OHLCV[]) => void) | null = null;
    private resolveFinal: ((bars: OHLCV[]) => void) | null = null;
    onBar: ((bar: OHLCV) => void) | null = null;

    constructor(total: number) {
        this.all = universe(total);
    }

    load(cfg: MarketConfig): Promise<OHLCV[]> {
        return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)));
    }

    loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        let out = this.all.filter((b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to));
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out);
    }

    loadProgressive(_cfg: MarketConfig, onBatch: (bars: OHLCV[]) => void): Promise<OHLCV[] | null> {
        this.onBatch = onBatch;
        return new Promise((resolve) => (this.resolveFinal = resolve));
    }

    /** Emit the newest `n` bars as the next confirmed snapshot. */
    snapshot(n: number): void {
        this.onBatch?.(this.all.slice(-n));
    }

    finish(): void {
        this.resolveFinal?.(this.all);
    }

    subscribe(_cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        this.onBar = onBar;
        return () => (this.onBar = null);
    }
}

function lineOf(model: IndicatorModel | undefined): LineLikeSeries | undefined {
    return model?.series.find(isLineLikeSeries);
}

/** The chart bar the renderer paints point 0 of `model` on — the `IndicatorModel.anchorTime` contract. */
function paintOffset(model: IndicatorModel, bars: readonly OHLCV[]): number {
    const anchor = model.anchorTime;
    if (anchor == null || bars.length === 0) return 0;
    const head = bars[0]!.time;
    if (anchor < head) return -(lineOf(model)?.points.filter((p) => p != null && p.time < head).length ?? 0);
    const at = bars.findIndex((b) => b.time === anchor);
    return at < 0 ? 0 : at;
}

/** Points that would be painted on a candle other than their own (or past the newest one). */
function misplaced(model: IndicatorModel | undefined, bars: readonly OHLCV[]): number {
    const points = lineOf(model)?.points ?? [];
    if (!model) return 0;
    const off = paintOffset(model, bars);
    let wrong = 0;
    points.forEach((p, j) => {
        const i = j + off;
        if (i < 0) return; // before the chart's first bar — skipped by the renderer, not misdrawn
        if (bars[i]?.time !== p.time) wrong += 1;
    });
    return wrong;
}

/** The value the renderer paints on chart bar `i`. */
function paintedAt(model: IndicatorModel | undefined, bars: readonly OHLCV[], i: number): number | null {
    if (!model) return null;
    return lineOf(model)?.points[i - paintOffset(model, bars)]?.value ?? null;
}

const emaSpec = classicSpecs.find((s) => s.type === 'ema')!;
const emaDefaults = Object.fromEntries(emaSpec.inputs.map((i) => [i.key, i.defval]));
const emaOver = (bars: readonly OHLCV[]): readonly number[] => emaSpec.compute(bars, emaDefaults).plots[0]!.values;

/** A native that plots each bar's close and recomputes on every bar change — today's default policy. */
const closeNative: NativeIndicatorDescriptor = {
    type: 'test-close-line',
    title: 'Close line',
    paneHint: 'price',
    overlay: true,
    inputsSchema: () => [],
    defaultInputs: () => ({}),
    create: (): NativeIndicator => {
        let ctx: NativeIndicatorContext | null = null;
        const emit = (): void => {
            const bars = ctx!.bars();
            ctx!.emit({ series: [{ id: 'close', title: 'Close', paneId: '', kind: 'line', points: bars.map((b) => ({ time: b.time, value: b.close })), style: { color: '#fff', width: 1, lineStyle: 'solid' } }] });
        };
        return {
            start: (c) => {
                ctx = c;
                emit();
            },
            onBars: () => emit(),
            onViewport: () => {},
            setInputs: () => emit(),
            suspend: () => {},
            resume: () => emit(),
            stop: () => {},
        };
    },
};

describe('native indicators over a progressive history load', () => {
    it('the EMA never paints on the wrong candle while healed history lands, and covers the full history once it completes', async () => {
        const feed = new HealingFeed(600);
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 600, live: false }, { renderer, engines: [], dataFeed: feed });
        await Promise.resolve();
        feed.snapshot(60); // the first confirmed stretch paints — the chart is interactive
        await chart.ready();
        const ema = chart.addNativeIndicator('ema');
        await flush();

        feed.snapshot(250); // older bars healed in behind the visible ones
        await flush();
        expect(misplaced(renderer.models.get(ema.id), renderer.bars)).toBe(0);
        feed.snapshot(500);
        await flush();
        expect(misplaced(renderer.models.get(ema.id), renderer.bars)).toBe(0);

        feed.finish();
        await chart.historyComplete();
        await flush();
        const model = renderer.models.get(ema.id);
        const bars = renderer.bars;
        expect(bars).toHaveLength(600);
        expect(misplaced(model, bars)).toBe(0);
        // The plot reaches the newest candle and carries the FULL-history values.
        const truth = emaOver(bars);
        for (const i of [bars.length - 1, bars.length - 200, 30]) expect(paintedAt(model, bars, i)).toBeCloseTo(truth[i]!, 9);
    });

    it('the EMA waits for the complete history, like a script indicator: loading row first, one compute over every bar', async () => {
        const feed = new HealingFeed(600);
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 600, live: false }, { renderer, engines: [], dataFeed: feed });
        await Promise.resolve();
        feed.snapshot(60);
        await chart.ready();
        const ema = chart.addNativeIndicator('ema');
        let ready = false;
        ema.on('ready', () => (ready = true));
        await flush();

        // Held: the legend row is up with a spinner, nothing is plotted yet, `ready` has not fired.
        expect(renderer.models.has(ema.id)).toBe(true);
        expect(renderer.status.get(ema.id)).toBe('loading');
        expect(lineOf(renderer.models.get(ema.id))?.points.length ?? 0).toBe(0);
        expect(ready).toBe(false);
        expect(chart.inspect().indicators.find((s) => s.id === ema.id)).toBeUndefined();

        feed.snapshot(300);
        await flush();
        expect(lineOf(renderer.models.get(ema.id))?.points.length ?? 0).toBe(0);

        feed.finish();
        await chart.historyComplete();
        await flush();
        expect(ready).toBe(true);
        expect(renderer.status.get(ema.id)).toBe('idle');
        expect(lineOf(renderer.models.get(ema.id))?.points).toHaveLength(600);
    });

    it('volume paints from the first candles — only the computed studies wait', async () => {
        const feed = new HealingFeed(600);
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 600, live: false }, { renderer, engines: [], dataFeed: feed });
        await Promise.resolve();
        feed.snapshot(60);
        await chart.ready();
        const ema = chart.addNativeIndicator('ema');
        await flush();
        const shown = chart.inspect().indicators;
        expect(shown.some((s) => s.nativeType === 'volume')).toBe(true);
        expect(shown.some((s) => s.id === ema.id)).toBe(false);
    });

    it('a tick during the wait is not computed on its own; after completion every tick updates the EMA', async () => {
        const feed = new HealingFeed(600);
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 600, live: true }, { renderer, engines: [], dataFeed: feed });
        await Promise.resolve();
        feed.snapshot(60);
        await chart.ready();
        const ema = chart.addNativeIndicator('ema');
        await flush();
        const forming = feed.all[feed.all.length - 1]!;
        feed.onBar?.({ ...forming, close: forming.close + 5 }); // the forming candle refines mid-load
        await flush();
        expect(lineOf(renderer.models.get(ema.id))?.points.length ?? 0).toBe(0);

        feed.finish();
        await chart.historyComplete();
        await flush();
        expect(lineOf(renderer.models.get(ema.id))?.points).toHaveLength(600);

        const next = { ...forming, time: forming.time + HOUR, close: forming.close + 3 };
        feed.onBar?.(next);
        await flush();
        const model = renderer.models.get(ema.id);
        expect(misplaced(model, renderer.bars)).toBe(0);
        expect(paintedAt(model, renderer.bars, renderer.bars.length - 1)).toBeCloseTo(emaOver(renderer.bars)[renderer.bars.length - 1]!, 9);
    });

    it('a native with the default policy follows each snapshot and stays on its candles', async () => {
        registerNativeIndicator(closeNative);
        try {
            const feed = new HealingFeed(400);
            const renderer = new RecordingRenderer();
            const chart = new Vela({} as unknown as HTMLElement, { bars: 400, live: false }, { renderer, engines: [], dataFeed: feed });
            await Promise.resolve();
            feed.snapshot(40);
            await chart.ready();
            const line = chart.addNativeIndicator('test-close-line');
            await flush();
            expect(lineOf(renderer.models.get(line.id))?.points).toHaveLength(40);

            feed.snapshot(150);
            await flush();
            const model = renderer.models.get(line.id);
            expect(misplaced(model, renderer.bars)).toBe(0);
            // It re-ran over the deeper snapshot: the healed bars carry values too.
            expect(paintedAt(model, renderer.bars, 0)).toBe(renderer.bars[0]!.close);
            expect(paintedAt(model, renderer.bars, 149)).toBe(renderer.bars[149]!.close);
        } finally {
            unregisterNativeIndicator('test-close-line');
        }
    });

    it('delivers the latest viewport once after a history-held viewport-aware native starts', async () => {
        const events: Array<{ type: 'start' } | { type: 'viewport'; range: VisibleRange }> = [];
        const descriptor: NativeIndicatorDescriptor = {
            type: 'test-held-viewport',
            title: 'Held viewport',
            paneHint: 'price',
            overlay: true,
            waitsForHistory: true,
            reactsToViewport: true,
            inputsSchema: () => [],
            defaultInputs: () => ({}),
            create: () => ({
                start: () => events.push({ type: 'start' }),
                onBars: () => {},
                onViewport: (range) => events.push({ type: 'viewport', range }),
                setInputs: () => {},
                suspend: () => {},
                resume: () => {},
                stop: () => {},
            }),
        };
        registerNativeIndicator(descriptor);
        try {
            const feed = new HealingFeed(400);
            const renderer = new RecordingRenderer();
            renderer.setVisibleRange({ from: T0 + 340 * HOUR, to: T0 + 399 * HOUR });
            const chart = new Vela({} as unknown as HTMLElement, { bars: 400, live: false }, { renderer, engines: [], dataFeed: feed });
            await Promise.resolve();
            feed.snapshot(40);
            await chart.ready();
            chart.addNativeIndicator('test-held-viewport');
            await flush();
            expect(events).toEqual([]);

            renderer.fireViewport({ from: T0 + 350 * HOUR, to: T0 + 390 * HOUR });
            await new Promise((resolve) => setTimeout(resolve, 180));
            expect(events).toEqual([]);

            const latest = { from: T0 + 360 * HOUR, to: T0 + 399 * HOUR };
            renderer.fireViewport(latest);
            feed.finish();
            await chart.historyComplete();
            await flush();
            expect(events).toEqual([{ type: 'start' }, { type: 'viewport', range: latest }]);

            await new Promise((resolve) => setTimeout(resolve, 180));
            expect(events).toEqual([{ type: 'start' }, { type: 'viewport', range: latest }]);
        } finally {
            unregisterNativeIndicator('test-held-viewport');
        }
    });
});

describe('native indicators over a depth change', () => {
    it('trimming the history keeps the EMA on its candles', async () => {
        const feed = new HealingFeed(300);
        const renderer = new RecordingRenderer();
        // No progressive capability on this chart: a plain single load.
        (feed as Partial<HealingFeed>).loadProgressive = undefined;
        const chart = new Vela({} as unknown as HTMLElement, { bars: 300, live: false }, { renderer, engines: [], dataFeed: feed });
        const ema = chart.addNativeIndicator('ema');
        await chart.ready();
        await chart.historyComplete();
        await flush();
        expect(lineOf(renderer.models.get(ema.id))?.points).toHaveLength(300);

        await chart.setMarket({ bars: 100 }); // a shallower depth trims the oldest bars in place
        await flush();
        expect(renderer.bars).toHaveLength(100);
        expect(misplaced(renderer.models.get(ema.id), renderer.bars)).toBe(0);
    });

    it('a shallower depth picked while the history is still loading releases the waiting EMA', async () => {
        const feed = new HealingFeed(600);
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 600, live: false }, { renderer, engines: [], dataFeed: feed });
        await Promise.resolve();
        feed.snapshot(60);
        await chart.ready();
        const ema = chart.addNativeIndicator('ema');
        await flush();
        expect(renderer.status.get(ema.id)).toBe('loading');

        await chart.setMarket({ bars: 50 }); // trims what loaded; the history is complete at that depth
        await flush();
        expect(renderer.bars).toHaveLength(50);
        expect(renderer.status.get(ema.id)).toBe('idle');
        const model = renderer.models.get(ema.id);
        expect(lineOf(model)?.points).toHaveLength(50);
        expect(misplaced(model, renderer.bars)).toBe(0);
    });

    it('a deeper history holds the EMA (still aligned) until the backfill completes, then recomputes over it', async () => {
        const feed = new HealingFeed(400);
        (feed as Partial<HealingFeed>).loadProgressive = undefined;
        const ranged = feed.loadRange.bind(feed);
        feed.loadRange = (cfg, range) => ranged(cfg, { ...range, limit: Math.min(range.limit ?? 101, 101) }); // 100 older bars per chunk
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 100, live: false }, { renderer, engines: [], dataFeed: feed });
        const ema = chart.addNativeIndicator('ema');
        await chart.ready();
        await chart.historyComplete();
        await flush();
        const before = lineOf(renderer.models.get(ema.id))!.points;

        // Sampled as each chunk lands: the plot computed over the first 100 bars stays put.
        const midway: Array<{ bars: number; points: number; misplaced: number }> = [];
        chart.on('history:progress', () => {
            const model = renderer.models.get(ema.id);
            midway.push({ bars: renderer.bars.length, points: lineOf(model)?.points.length ?? 0, misplaced: misplaced(model, renderer.bars) });
        });
        await chart.setMarket({ bars: 400 });
        await chart.historyComplete();
        await flush();
        expect(midway.map((m) => m.bars)).toEqual([200, 300, 400]);
        for (const m of midway) expect(m).toEqual({ bars: m.bars, points: before.length, misplaced: 0 });

        const model = renderer.models.get(ema.id);
        const bars = renderer.bars;
        expect(bars).toHaveLength(400);
        expect(misplaced(model, bars)).toBe(0);
        const truth = emaOver(bars);
        expect(paintedAt(model, bars, 30)).toBeCloseTo(truth[30]!, 9); // an extended bar, past the warm-up
        expect(paintedAt(model, bars, 399)).toBeCloseTo(truth[399]!, 9);
    });
});

describe('native indicators across market and price-style changes', () => {
    it('a market switch blanks the EMA without an anchor — the old market has no bar on the new axis', async () => {
        const feed = new HealingFeed(200);
        (feed as Partial<HealingFeed>).loadProgressive = undefined;
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 200, live: false }, { renderer, engines: [], dataFeed: feed });
        const ema = chart.addNativeIndicator('ema');
        await chart.ready();
        await chart.historyComplete();
        await flush();
        expect(renderer.models.get(ema.id)?.anchorTime).toBe(renderer.bars[0]!.time);

        const mountsBefore = renderer.mounts.length;
        await chart.setMarket({ symbol: 'OTHER' });
        await chart.historyComplete();
        await flush();
        const blank = renderer.mounts.slice(mountsBefore).find((m) => m.id === ema.id && (lineOf(m)?.points.length ?? 0) === 0);
        expect(blank).toBeDefined();
        expect(blank!.anchorTime).toBeUndefined();
        expect(lineOf(renderer.models.get(ema.id))?.points).toHaveLength(200);
        expect(misplaced(renderer.models.get(ema.id), renderer.bars)).toBe(0);
    });

    it('switching to Heikin Ashi re-computes the EMA over the synthetic candles at once, and back', async () => {
        const feed = new HealingFeed(200);
        (feed as Partial<HealingFeed>).loadProgressive = undefined;
        const renderer = new RecordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { bars: 200, live: false }, { renderer, engines: [], dataFeed: feed });
        const ema = chart.addNativeIndicator('ema');
        await chart.ready();
        await chart.historyComplete();
        await flush();
        const last = 199;

        renderer.firePriceStyle('heikinashi');
        await flush();
        const ha = heikinAshiFull(feed.all);
        expect(renderer.bars).toEqual(ha);
        expect(paintedAt(renderer.models.get(ema.id), renderer.bars, last)).toBeCloseTo(emaOver(ha)[last]!, 9);
        expect(emaOver(ha)[last]).not.toBeCloseTo(emaOver(feed.all)[last]!, 3); // the two sources really differ

        renderer.firePriceStyle('candles');
        await flush();
        expect(paintedAt(renderer.models.get(ema.id), renderer.bars, last)).toBeCloseTo(emaOver(feed.all)[last]!, 9);
    });
});
