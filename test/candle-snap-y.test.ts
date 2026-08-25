import { describe, it, expect } from 'vitest';
import { snapY, candleGeometry } from '../src/renderers/native/backend/candle-lod';

/**
 * Vertical device-grid snapping for candle geometry — the counterpart of
 * candleGeometry's X snapping. Body tops/bottoms and wick ends must land on whole
 * device pixels at ANY dpr, or the rasterizer leaves a blended anti-aliasing row
 * that reads as a darker rim along the candle body.
 */

describe('snapY lands CSS-px Y coordinates on the device-pixel grid', () => {
    it('produces whole device pixels at fractional dpr', () => {
        for (const y of [311.3, 38.8, 0.49, 662.01, 99.999]) {
            for (const dpr of [1, 1.25, 1.5, 2, 2.625]) {
                const dev = snapY(y, dpr) * dpr;
                expect(dev, `y=${y} dpr=${dpr}`).toBeCloseTo(Math.round(dev), 9);
            }
        }
    });

    it('moves a coordinate by at most half a device pixel', () => {
        for (const y of [311.3, 38.8, 0.49, 662.01]) {
            for (const dpr of [1, 1.25, 1.5, 2]) {
                expect(Math.abs(snapY(y, dpr) - y)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
            }
        }
    });

    it('keeps an already-snapped coordinate unchanged', () => {
        expect(snapY(311.2, 1.25)).toBe(311.2); // 311.2 × 1.25 = 389 exactly
        expect(snapY(48, 1.25)).toBe(48); // 60 device px
    });

    it('agrees with candleGeometry: snapped edges share the same 1/dpr lattice', () => {
        // A wick rect spanning snapY(hY)..snapY(lY) at candleGeometry's wickX must be
        // an exact integer-device rect — the invariant both backends rely on.
        const dpr = 1.25;
        const g = candleGeometry(415.37, 9, dpr);
        const topDev = snapY(123.456, dpr) * dpr;
        const leftDev = g.wickX * dpr;
        expect(topDev).toBeCloseTo(Math.round(topDev), 9);
        expect(leftDev).toBeCloseTo(Math.round(leftDev), 9);
    });
});
