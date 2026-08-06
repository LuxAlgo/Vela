// Per-type candle cosmetics for candle-based PLUGIN styles (chartTypes.<id>.candle*):
// the resolution helpers plus the renderer wiring that keeps scene.candleOverride in
// sync with the active style and its bag. The painted pixels are exercised in the
// browser/oracle suites; the unit-testable part is the override resolution.
import { describe, it, expect, afterEach } from 'vitest';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';
import {
    candleOverrideFor,
    effectiveCandlePaint,
    hasOwnCandlePaint,
    type CandleStyle,
} from '../src/renderers/native/core/chartConfig';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { SceneGraph } from '../src/renderers/native/core/SceneGraph';

afterEach(() => {
    unregisterChartType('fauxflow');
    unregisterChartType('bricks');
});

describe('hasOwnCandlePaint', () => {
    it('is false for every built-in (heikin-ashi shares the candles block)', () => {
        for (const s of ['candles', 'bars', 'line', 'area', 'baseline', 'heikinashi']) {
            expect(hasOwnCandlePaint(s)).toBe(false);
        }
    });

    it('is true for a registered candle-based plugin type, false for basePainting none', () => {
        registerChartType({ id: 'fauxflow' }); // basePainting defaults to 'candles'
        registerChartType({ id: 'bricks', basePainting: 'none' });
        expect(hasOwnCandlePaint('fauxflow')).toBe(true);
        expect(hasOwnCandlePaint('bricks')).toBe(false);
        expect(hasOwnCandlePaint('unregistered')).toBe(false);
    });
});

describe('candleOverrideFor', () => {
    it('reads the candle* keys from the type bag, dropping malformed values to null', () => {
        registerChartType({ id: 'fauxflow' });
        const ov = candleOverrideFor('fauxflow', {
            fauxflow: {
                candleUpColor: '#112233',
                candleDownColor: 42, // wrong type → inherit
                candleBodyVisible: false,
                candleWickVisible: 'yes', // wrong type → inherit
            },
        });
        expect(ov).not.toBeNull();
        expect(ov!.upColor).toBe('#112233');
        expect(ov!.downColor).toBeNull();
        expect(ov!.bodyVisible).toBe(false);
        expect(ov!.wickVisible).toBeNull();
        expect(ov!.borderVisible).toBeNull();
    });

    it('is null for built-ins even when their id has a bag entry', () => {
        expect(candleOverrideFor('heikinashi', { heikinashi: { candleUpColor: '#fff' } })).toBeNull();
        expect(candleOverrideFor('candles', {})).toBeNull();
    });
});

describe('effectiveCandlePaint', () => {
    const base: CandleStyle = {
        bodyVisible: true,
        borderVisible: false,
        borderUpColor: null,
        borderDownColor: null,
        wickVisible: true,
        wickUpColor: '#aaa',
        wickDownColor: '#bbb',
    };

    it('passes the shared cosmetics through when there is no override', () => {
        const p = effectiveCandlePaint(base, null, '#up', '#down');
        expect(p.up).toBe('#up');
        expect(p.down).toBe('#down');
        expect(p.candle).toBe(base);
    });

    it('wins per-key, inheriting the shared value for unset keys', () => {
        const p = effectiveCandlePaint(
            base,
            {
                upColor: '#123',
                downColor: null,
                bodyVisible: null,
                borderVisible: true,
                borderUpColor: null,
                borderDownColor: null,
                wickVisible: false,
                wickUpColor: null,
                wickDownColor: '#ccc',
            },
            '#up',
            '#down',
        );
        expect(p.up).toBe('#123'); // overridden
        expect(p.down).toBe('#down'); // inherited
        expect(p.candle.bodyVisible).toBe(true); // inherited
        expect(p.candle.borderVisible).toBe(true); // overridden
        expect(p.candle.wickVisible).toBe(false); // overridden
        expect(p.candle.wickUpColor).toBe('#aaa'); // inherited
        expect(p.candle.wickDownColor).toBe('#ccc'); // overridden
    });
});

describe('NativeRenderer wiring', () => {
    it('tracks the active style and its bag; built-ins never carry an override', () => {
        registerChartType({ id: 'fauxflow' });
        const r = new NativeRenderer();
        const scene = (r as unknown as { scene: SceneGraph }).scene;
        expect(scene.candleOverride).toBeNull(); // candles

        r.applyConfig({ series: { style: 'fauxflow' }, chartTypes: { fauxflow: { candleUpColor: '#123456' } } });
        expect(scene.candleOverride?.upColor).toBe('#123456');

        // A bag edit WITHOUT a style change (the Symbol tab's live path) re-resolves.
        r.applyConfig({ chartTypes: { fauxflow: { candleDownColor: '#654321' } } });
        expect(scene.candleOverride?.downColor).toBe('#654321');

        // Back to a built-in: the override drops, the shared candles block paints again.
        r.applyConfig({ series: { style: 'heikinashi' } });
        expect(scene.candleOverride).toBeNull();
    });
});
