import { describe, expect, it } from 'vitest';
import { countColor } from './browser/pixels';

describe('browser candle pixel classification', () => {
    it('counts candle colors but excludes the gold indicator and transparent pixels', () => {
        const pixels = new Uint8ClampedArray([
            242, 54, 69, 255,
            241, 55, 68, 128,
            247, 201, 72, 255,
            242, 54, 69, 0,
            8, 153, 129, 255,
        ]);
        expect(countColor(pixels, [242, 54, 69])).toBe(2);
        expect(countColor(pixels, [8, 153, 129])).toBe(1);
        expect(countColor(pixels, [247, 201, 72])).toBe(1);
    });
});
