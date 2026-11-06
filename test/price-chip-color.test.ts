import { afterEach, describe, expect, it } from 'vitest';
import { priceElementColor } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { candleOverrideFor } from '../src/renderers/native/core/chartConfig';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';
import { DARK_THEME } from '../src/core/theme';
import type { OHLCV } from '../src/core/model/ohlcv';

// ── the current-price line, label and countdown wear the color of the last candle as it
// is actually painted — including a candle-based plugin style's own candle colors ──

const THEME = { ...DARK_THEME, upColor: '#089981', downColor: '#f23645' };
const UP: OHLCV = { time: 0, open: 100, high: 110, low: 95, close: 105, volume: 1 };
const DOWN: OHLCV = { time: 0, open: 105, high: 110, low: 95, close: 100, volume: 1 };
const PLUGIN = 'candle-plugin-style';

const noEngine = () => ({ start() {}, suspend() {}, resume() {}, stop() {} });

function colorOf(scene: SceneGraph, last: OHLCV): string {
    return priceElementColor(scene, new CoordinateSystem(), THEME, last);
}

function pluginScene(bag: Record<string, unknown>): SceneGraph {
    registerChartType({ id: PLUGIN, dataEngine: noEngine });
    const s = new SceneGraph();
    s.priceStyle = PLUGIN;
    s.candleOverride = candleOverrideFor(PLUGIN, { [PLUGIN]: bag });
    return s;
}

afterEach(() => unregisterChartType(PLUGIN));

describe('current-price color follows the candles', () => {
    it('uses the chart candle colors on plain candles', () => {
        const s = new SceneGraph();
        expect(colorOf(s, UP)).toBe('#089981');
        expect(colorOf(s, DOWN)).toBe('#f23645');
    });

    it('uses a chart type’s own candle colors (Footprint, TPO) instead of the default green and red', () => {
        const s = pluginScene({ candleUpColor: '#2962ff', candleDownColor: '#787b86' });
        expect(colorOf(s, UP)).toBe('#2962ff');
        expect(colorOf(s, DOWN)).toBe('#787b86');
    });

    it('falls back to the chart candle colors when a chart type has none of its own', () => {
        const s = pluginScene({});
        expect(colorOf(s, UP)).toBe('#089981');
        expect(colorOf(s, DOWN)).toBe('#f23645');
    });

    it('uses the candle outline color when candle bodies are hidden', () => {
        const s = pluginScene({ candleBodyVisible: false, candleBorderVisible: true, candleBorderUpColor: '#00bcd4', candleBorderDownColor: '#ff9800' });
        expect(colorOf(s, UP)).toBe('#00bcd4');
        expect(colorOf(s, DOWN)).toBe('#ff9800');
    });
});
