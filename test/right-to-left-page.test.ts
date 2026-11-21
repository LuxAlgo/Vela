// @vitest-environment jsdom
// A chart inside a right-to-left page (`<html dir="rtl">`, an Arabic or Hebrew host app).
// The plot never mirrors: time runs left to right and the price scale stays on the right, so
// the numbers it paints keep their left-to-right reading order too. Left to the page's
// direction, the bidi algorithm moves a sign or a percent sign to the far end of its number
// ("7.14%-", "(0.08%+) 44.71+"). The chrome around the plot still follows the page; only the
// numbers inside it are isolated.
//
// jsdom paints nothing, so the canvas half drives the real renderer against a stand-in 2D
// context that resolves `direction` the way a browser's does (`./support/canvas-stand-in`).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { registerRendererLayer, unregisterRendererLayer } from '../src/renderers/native/layers';
import { InputsUI } from '../src/renderers/shared/InputsUI';
import { Statusline } from '../src/widget/statusline';
import { DataWindow } from '../src/widget/data-window';
import { DARK_THEME } from '../src/core/theme';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import { createDrawing, type SerializedDrawing } from '../src/core/drawings';
import type { Vela } from '../src/Vela';
import type { DataWindowReadout } from '../src/core/ports/IChartRenderer';
import { installCanvasStandIn, painted, type Direction } from './support/canvas-stand-in';

let restoreCanvas: () => void = () => {};

beforeAll(() => {
    restoreCanvas = installCanvasStandIn();
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
});

afterAll(() => {
    restoreCanvas();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
});

afterEach(() => {
    painted.length = 0;
    document.body.replaceChildren();
});

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

/** A falling market: on a percent scale its labels run from +0.00% down into negatives. */
function bars(): OHLCV[] {
    return Array.from({ length: 120 }, (_, i) => {
        const open = 60_000 - i * 40;
        const close = open - 25;
        return { time: T0 + i * HOUR, open, high: open + 30, low: close - 30, close, volume: 1_000 + i * 10 };
    });
}

interface RendererInternals {
    plot: HTMLElement;
    syncSize(): void;
    handlePointerMove(x: number | null, y: number | null): void;
    scheduler: { flushNow(level: number): void };
    userDrawings: {
        syncDrawings(docs: readonly SerializedDrawing[]): void;
        beginMeasureAt(x: number, y: number): boolean;
        pointerMove(x: number, y: number): void;
        render(): void;
    };
}

/** Mount a renderer in the page, give it a falling market on a percent scale, and paint. */
function mountChart(): { renderer: NativeRenderer; internals: RendererInternals } {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new NativeRenderer();
    renderer.applyFeature('intro', false);
    renderer.mount(host, DARK_THEME);
    renderer.setBars(bars());
    renderer.applyConfig({ priceScale: { mode: 'percent' } });
    const internals = renderer as unknown as RendererInternals;
    internals.scheduler.flushNow(4);
    return { renderer, internals };
}

/** A script indicator on the price pane carrying a label and a table with signed numbers. */
function scriptWithLabelAndTable(): IndicatorModel {
    const time = T0 + 60 * HOUR;
    return {
        id: 'script',
        title: 'Script',
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
        labels: [
            {
                id: 'l1',
                paneId: 'price',
                xloc: 'bar_time',
                x: time,
                y: 57_500,
                yloc: 'price',
                text: '-1.20%',
                style: 'label_down',
                size: 'normal',
                textAlign: 'center',
                fontFamily: 'default',
            },
        ],
        tables: [
            {
                id: 't1',
                paneId: 'price',
                position: 'top_right',
                columns: 1,
                rows: 1,
                frameWidth: 0,
                borderWidth: 0,
                cells: [[{ text: '+5.00%', hAlign: 'center', vAlign: 'center', textSize: 'normal', fontFamily: 'default', bold: false, italic: false }]],
                merges: [],
            },
        ],
    } as unknown as IndicatorModel;
}

/** A text drawing reading `value`, stacked in front of the candles or under them. */
function textDrawing(id: string, value: string, zIndex: number): SerializedDrawing {
    const doc = createDrawing('text', {
        id,
        paneId: 'price',
        anchors: [{ time: T0 + 40 * HOUR, price: 58_000 }],
        text: { value, size: 'normal', hAlign: 'left', vAlign: 'top' },
    })!.serialize();
    return { ...doc, zIndex };
}

const SIGNED = /^[+\-−]\d|\d%?[+\-−]$/;

describe('a chart inside a right-to-left page', () => {
    it('paints its axis labels and crosshair chips left to right, so signed numbers keep their reading order', () => {
        const { renderer, internals } = mountChart();
        internals.handlePointerMove(300, 200); // the crosshair's price chip on the percent scale
        internals.scheduler.flushNow(4);

        const texts = painted.map((p) => p.text);
        expect(texts.some((t) => /^[+\-−]\d[\d.,]*%$/.test(t))).toBe(true); // signed percent labels were painted
        const reversed = painted.filter((p) => p.direction !== 'ltr');
        expect(reversed.map((p) => p.text)).toEqual([]);
        renderer.destroy();
    });

    it('paints script labels and tables, drawing text and the measuring ruler left to right', () => {
        const { renderer, internals } = mountChart();
        renderer.mountIndicator(scriptWithLabelAndTable());
        internals.userDrawings.syncDrawings([textDrawing('front', '+2.50%', 1_000), textDrawing('behind', '-3.75%', -1_000)]);
        internals.userDrawings.beginMeasureAt(200, 100);
        internals.userDrawings.pointerMove(420, 260);
        internals.scheduler.flushNow(4);
        internals.userDrawings.render();

        const texts = painted.map((p) => p.text);
        for (const shown of ['-1.20%', '+5.00%', '+2.50%', '-3.75%']) expect(texts).toContain(shown);
        expect(painted.some((p) => !p.canvas.isConnected)).toBe(true); // the slices composited under the candles
        expect(painted.filter((p) => p.direction !== 'ltr').map((p) => p.text)).toEqual([]);
        renderer.destroy();
    });

    it('keeps painting left to right after a resize resets the canvases', () => {
        const { renderer, internals } = mountChart();
        painted.length = 0;
        internals.syncSize(); // sizes every canvas again, which resets each context, then repaints
        expect(painted.some((p) => SIGNED.test(p.text))).toBe(true);
        expect(painted.filter((p) => p.direction !== 'ltr').map((p) => p.text)).toEqual([]);
        renderer.destroy();
    });

    it('lays every plot canvas out left to right, so a plugin layer that paints its own text does too', () => {
        let layerDirection: Direction | null = null;
        let layerCanvas: HTMLCanvasElement | null = null;
        registerRendererLayer({
            id: 'rtl-probe-layer',
            create: () => ({
                mount(canvas) {
                    layerCanvas = canvas;
                },
                render() {
                    const ctx = layerCanvas!.getContext('2d')!;
                    ctx.fillText('-1.20%', 10, 10);
                    layerDirection = painted[painted.length - 1]!.direction;
                },
            }),
        });
        try {
            const { renderer, internals } = mountChart();
            expect(layerDirection).toBe('ltr');
            const canvases = [...internals.plot.querySelectorAll('canvas')];
            expect(canvases.length).toBeGreaterThan(0);
            expect(canvases.filter((c) => c.dir !== 'ltr')).toEqual([]);
            renderer.destroy();
        } finally {
            unregisterRendererLayer('rtl-probe-layer');
        }
    });

    it('leaves the chrome around the plot following the page, so it can mirror', () => {
        const { renderer, internals } = mountChart();
        expect(internals.plot.closest('[dir="ltr"]')).toBeNull();
        expect(getComputedStyle(internals.plot).direction).toBe('rtl');
        renderer.destroy();
    });
});

/** True when `text` is shown inside a left-to-right isolate: its own element reads left to
 *  right and is isolated from the surrounding right-to-left text. */
function readsLeftToRight(root: Element, text: string): boolean {
    const holder = [...root.querySelectorAll('*')].find((el) => el.childElementCount === 0 && el.textContent === text);
    if (!holder) throw new Error(`no element shows "${text}"`);
    const cs = getComputedStyle(holder);
    return cs.direction === 'ltr' && cs.unicodeBidi === 'isolate';
}

describe('numeric readouts inside a right-to-left page', () => {
    it('the status line shows prices and the signed change in reading order', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const line = new Statusline(host, 'BINANCE:BTCUSDT');
        let move: (e: { ohlc: { open: number; high: number; low: number; close: number } | null }) => void = () => {};
        line.onChart({
            on: () => () => {},
            symbolFacts: () => null,
            renderer: {
                onCrosshairMove: (cb: typeof move) => {
                    move = cb;
                    return () => {};
                },
            },
            replay: { state: { active: false } },
        } as unknown as Vela);
        move({ ohlc: { open: 59_152.22, high: 59_236.93, low: 59_112.22, close: 59_196.93 } });

        expect(readsLeftToRight(line.el, '59,152.22')).toBe(true);
        expect(readsLeftToRight(line.el, '59,196.93')).toBe(true);
        expect(readsLeftToRight(line.el, '+44.71 (+0.08%)')).toBe(true);
        // The row itself still follows the page, so its order mirrors.
        expect(getComputedStyle(line.el).direction).toBe('rtl');
        line.destroy();
    });

    it('the data window shows each value in reading order', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const panel = new DataWindow(host);
        const readout: DataWindowReadout = {
            date: 'Tue 13 Jan ’26',
            time: '19:00',
            ohlc: { o: '59,152.22', h: '59,236.93', l: '59,112.22', c: '59,196.93', vol: '3.50K', up: true },
            groups: [{ name: 'MACD', rows: [{ label: 'Histogram', value: '-12.34', color: '#f00' }] }],
        };
        panel.onChart({ on: () => () => {}, renderer: { onCrosshairMove: () => () => {}, dataWindowReadout: () => readout } } as unknown as Vela);
        panel.toggle(true, true);

        expect(readsLeftToRight(panel.el, '-12.34')).toBe(true);
        expect(readsLeftToRight(panel.el, '59,196.93')).toBe(true);
        expect(readsLeftToRight(panel.el, '3.50K')).toBe(true);
        panel.destroy();
    });

    it('the legend keeps "Volume 3.50K" apart and in reading order, with each value isolated', () => {
        const container = document.createElement('div');
        document.body.append(container);
        const ui = new InputsUI(container, DARK_THEME, () => ({ top: 0, height: 300, rightAxis: 64 }));
        ui.upsert('vol', 'Volume', [], {});
        ui.upsert('macd', 'MACD', [], {});
        ui.setPlotValues(
            new Map([
                ['vol', [{ value: '3.50K', color: '#26a69a' }]],
                [
                    'macd',
                    [
                        { value: '-12.34', color: '#2962ff' },
                        { value: '+5.60', color: '#ff6d00' },
                    ],
                ],
            ]),
        );

        expect(readsLeftToRight(container, '3.50K')).toBe(true);
        expect(readsLeftToRight(container, '-12.34')).toBe(true);
        expect(readsLeftToRight(container, '+5.60')).toBe(true);

        // The gaps sit between the title and its values, and between values, on whichever
        // side the page's direction puts them: logical margins, never a physical left one.
        const readout = [...container.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '3.50K' && el.style.display === 'block')!;
        expect(readout.style.marginInlineStart).toBe('6px');
        expect(readout.style.marginLeft).toBe('');
        expect(getComputedStyle(readout).direction).toBe('rtl');
        const macd = [...container.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '-12.34+5.60' && el.style.display === 'block')!;
        const second = macd.children[1] as HTMLElement;
        expect(second.style.marginInlineStart).toBe('5px');
        expect(second.style.marginLeft).toBe('');
        expect(getComputedStyle(second).direction).toBe('rtl');
        ui.destroy();
    });
});
