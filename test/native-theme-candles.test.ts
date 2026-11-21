// @vitest-environment jsdom
// A theme's up and down colors are the candles' defaults: a chart starts on them, a theme
// switch carries the candles to the next theme's colors, and a color a host or user chose
// stays. Real charts on the native renderer, painting into the canvas stand-in.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DARK_THEME, Vela } from '../src/index';
import { BEARISH, BULLISH } from '../src/core/palette';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const OCEAN = { ...DARK_THEME, upColor: '#00aaff', downColor: '#ff00aa' };
const bars: OHLCV[] = Array.from({ length: 50 }, (_, i) => ({ time: 1_700_000_000_000 + i * 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

let restoreCanvas: () => void;
beforeAll(() => {
    restoreCanvas = installCanvasStandIn();
});
afterAll(() => restoreCanvas());

const charts: Vela[] = [];
afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    document.body.replaceChildren();
});

function chart(options: ConstructorParameters<typeof Vela>[1]): Vela {
    const host = document.createElement('div');
    document.body.append(host);
    const c = new Vela(host, { data: bars, live: false, ...options });
    charts.push(c);
    return c;
}

const config = (c: Vela) => c.renderer.getConfig() as ChartConfig;
const candles = (c: Vela) => config(c).candles;

describe('a theme’s candle colors', () => {
    it('color the candles of a chart that names no candle colors', () => {
        expect(candles(chart({ theme: OCEAN }))).toMatchObject({ upColor: '#00aaff', downColor: '#ff00aa', wickUpColor: '#00aaff' });
        expect(candles(chart({}))).toMatchObject({ upColor: BULLISH, downColor: BEARISH });
    });

    it('give way to the upColor and downColor options', () => {
        expect(candles(chart({ theme: OCEAN, upColor: '#111111' }))).toMatchObject({ upColor: '#111111', downColor: '#ff00aa' });
    });

    it('follow a theme switch, borders and wicks included, after the config went through a round trip', () => {
        const c = chart({});
        c.renderer.applyConfig(config(c));
        c.setTheme(OCEAN);
        const { borderUpColor, wickDownColor, upColor, downColor } = candles(c);
        expect([upColor, borderUpColor, downColor, wickDownColor]).toEqual(['#00aaff', '#00aaff', '#ff00aa', '#ff00aa']);
        expect(config(c).bars).toEqual({ upColor: '#00aaff', downColor: '#ff00aa' });
        c.setTheme('dark');
        expect(candles(c)).toMatchObject({ upColor: BULLISH, downColor: BEARISH });
    });

    it('leave a candle color someone chose', () => {
        const c = chart({});
        c.renderer.applyConfig({ candles: { upColor: '#123456' } });
        c.setTheme(OCEAN);
        expect(candles(c)).toMatchObject({ upColor: '#123456', downColor: '#ff00aa' });
        c.setTheme('dark');
        expect(candles(c)).toMatchObject({ upColor: '#123456', downColor: BEARISH });
    });
});
