// @vitest-environment jsdom
// Zooming out past the loaded bars shows the empty past; it is not a request for more
// history. The depth a chart loads is the `bars` it was given, loaded once: no zoom or
// pan through the empty area reaches the data source, however often the view changes
// and even though the source holds older bars.
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { MIN_BAR_SPACING } from '../src/renderers/native/core/ViewportState';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Unsubscribe } from '../src/core/util/types';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const WIDTH = 1200;
const DAY = 86_400_000;
/** Longer than the chart's viewport debounce (150 ms), so a deferred reaction has run. */
const AFTER_DEBOUNCE_MS = 260;

/** A source holding 1,000 daily bars that counts every request it answers. */
class CountingFeed implements MarketDataFeed {
    readonly all: OHLCV[] = Array.from({ length: 1000 }, (_, i) => ({ time: Date.UTC(2020, 0, 1) + i * DAY, open: 10, high: 12, low: 9, close: 11, volume: 5 }));
    loads = 0;
    ranges = 0;
    load(cfg: MarketConfig): Promise<OHLCV[]> {
        this.loads += 1;
        return Promise.resolve(this.all.slice(-(cfg.bars ?? 500)));
    }
    loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.ranges += 1;
        let out = this.all.filter((b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to));
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out);
    }
    subscribe(): Unsubscribe {
        return () => {};
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the gestures are driven through the renderer's own zoom and pan entry points */
describe('zooming out past the loaded bars', () => {
    let restoreCanvas: () => void;
    beforeAll(() => {
        restoreCanvas = installCanvasStandIn();
    });
    afterAll(() => restoreCanvas());
    const disposers: Array<() => void> = [];
    afterEach(() => {
        while (disposers.length) disposers.pop()!();
        document.body.replaceChildren();
    });

    it('fetches nothing, however far and however often the view moves through the empty area', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const feed = new CountingFeed();
        const renderer = new NativeRenderer();
        renderer.applyFeature('intro', false);
        renderer.applyFeature('animZoom', false);
        const chart = new Vela(host, { symbol: 'TEST', timeframe: 'D', bars: 103, live: false }, { renderer, dataFeed: feed });
        disposers.push(() => chart.destroy());
        await chart.ready();
        await chart.historyComplete();
        const anyR = renderer as any;
        anyR.coords.setSize(WIDTH, 300, 1);
        expect(anyR.coords.barCount).toBe(103);
        const after = { loads: feed.loads, ranges: feed.ranges };
        expect(after.loads).toBe(1);

        let viewportEvents = 0;
        chart.on('viewport:changed', () => (viewportEvents += 1));

        // Wheel out to the minimum spacing, right edge pinned: the empty past fills the plot.
        for (let i = 0; i < 40; i += 1) anyR.zoomTo(anyR.coords.getViewport().barSpacing * 0.8, anyR.coords.rightEdgeLogical, WIDTH);
        expect(anyR.coords.getViewport().barSpacing).toBe(MIN_BAR_SPACING);
        expect(anyR.coords.visibleTimeRange().from).toBeLessThan(feed.all[feed.all.length - 103]!.time);
        await new Promise((r) => setTimeout(r, AFTER_DEBOUNCE_MS));

        // Pan back and forth through the empty past and future, then zoom in and out again.
        for (const rightOffset of [600, 1500, 2300, -50, 900]) {
            anyR.applyViewport({ barSpacing: MIN_BAR_SPACING, rightOffset });
            await new Promise((r) => setTimeout(r, AFTER_DEBOUNCE_MS));
        }
        for (let round = 0; round < 3; round += 1) {
            for (let i = 0; i < 12; i += 1) anyR.zoomTo(anyR.coords.getViewport().barSpacing * 1.3, anyR.coords.rightEdgeLogical, WIDTH);
            for (let i = 0; i < 12; i += 1) anyR.zoomTo(anyR.coords.getViewport().barSpacing / 1.3, anyR.coords.rightEdgeLogical, WIDTH);
            await new Promise((r) => setTimeout(r, AFTER_DEBOUNCE_MS));
        }

        expect(viewportEvents).toBeGreaterThan(50); // the view really moved
        expect({ loads: feed.loads, ranges: feed.ranges }).toEqual(after);
        expect(anyR.coords.barCount).toBe(103);
        // What the chart reports as visible never leaves the loaded bars.
        const range = chart.getVisibleRange()!;
        expect(range.from).toBeGreaterThanOrEqual(feed.all[feed.all.length - 103]!.time);
        expect(range.to).toBeLessThanOrEqual(feed.all[feed.all.length - 1]!.time);
    });
});
