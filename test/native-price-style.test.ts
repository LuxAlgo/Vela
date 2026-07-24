import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

describe('NativeRenderer priceStyle feature (item 13)', () => {
    it('exposes priceStyle/priceBaseline with candle defaults', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('priceStyle');
        expect(r.features).toContain('priceBaseline');
        expect(r.readFeature('priceStyle')).toBe('candles');
        expect(r.readFeature('priceBaseline')).toBeNull();
    });

    it('accepts every supported style and rejects unknown ones (→ candles)', () => {
        const r = new NativeRenderer();
        for (const style of ['candles', 'bars', 'line', 'area', 'baseline']) {
            r.applyFeature('priceStyle', style);
            expect(r.readFeature('priceStyle')).toBe(style);
        }
        r.applyFeature('priceStyle', 'nope');
        expect(r.readFeature('priceStyle')).toBe('candles');
    });

    it('priceBaseline coerces to a number or null', () => {
        const r = new NativeRenderer();
        r.applyFeature('priceBaseline', 100);
        expect(r.readFeature('priceBaseline')).toBe(100);
        r.applyFeature('priceBaseline', null);
        expect(r.readFeature('priceBaseline')).toBeNull();
    });
});
