// The conversions behind a settings field's unit switch: a stored price shown as points,
// percent or ticks from a reference price, and what is typed in a unit read back as a price.
import { describe, it, expect } from 'vitest';
import { priceFromUnit, priceInUnit, priceUnits, type PriceUnit } from '../src/core/drawings';

const UNITS: PriceUnit[] = ['price', 'points', 'percent', 'ticks'];

describe('a price shown in another unit', () => {
    it('reads as the price, the distance from the reference, its percentage and its tick count', () => {
        expect(priceInUnit(110, 100, 'price', 0.01)).toBe(110);
        expect(priceInUnit(110, 100, 'points', 0.01)).toBe(10);
        expect(priceInUnit(110, 100, 'percent', 0.01)).toBe(10);
        expect(priceInUnit(110, 100, 'ticks', 0.01)).toBe(1000);
        expect(priceInUnit(101.5, 100, 'ticks', 0.25)).toBe(6);
    });

    it('a price below the reference reads negative, and types back to the same price', () => {
        expect(priceInUnit(95, 100, 'points', 0.5)).toBe(-5);
        expect(priceInUnit(95, 100, 'percent', 0.5)).toBe(-5);
        expect(priceInUnit(95, 100, 'ticks', 0.5)).toBe(-10);
        expect(priceFromUnit(-5, 100, 'points', 0.5)).toBe(95);
        expect(priceFromUnit(-5, 100, 'percent', 0.5)).toBe(95);
        expect(priceFromUnit(-10, 100, 'ticks', 0.5)).toBe(95);
    });

    it('every unit round-trips a price, whatever its size', () => {
        const cases: Array<[price: number, base: number, tick: number]> = [
            [110, 100, 0.01],
            [95.25, 100, 0.25],
            [64_250.3, 64_250.1, 0.1],
            [0.00001234, 0.000012, 0.00000001],
            [-37.5, -40, 0.01],
        ];
        for (const [price, base, tick] of cases) {
            for (const unit of UNITS) {
                const back = priceFromUnit(priceInUnit(price, base, unit, tick), base, unit, tick);
                expect(Math.abs(back - price), `${price} from ${base} in ${unit}`).toBeLessThanOrEqual(Math.abs(price) * 1e-12);
            }
        }
    });

    it('shows no float noise from the subtraction', () => {
        expect(priceInUnit(100.3, 100.1, 'points')).toBe(0.2);
        expect(priceInUnit(64_250.3, 64_250.1, 'points')).toBe(0.2);
        expect(priceInUnit(0.3, 0.1, 'ticks', 0.1)).toBe(2);
        expect(priceFromUnit(0.2, 100.1, 'points')).toBe(100.3);
    });

    it('offers percent only against a non-zero reference, and ticks only with a tick size', () => {
        expect(priceUnits(100, 0.01)).toEqual(['price', 'points', 'percent', 'ticks']);
        expect(priceUnits(100, null)).toEqual(['price', 'points', 'percent']);
        expect(priceUnits(100)).toEqual(['price', 'points', 'percent']);
        expect(priceUnits(0, 0.01)).toEqual(['price', 'points', 'ticks']);
        expect(priceUnits(100, 0)).toEqual(['price', 'points', 'percent']);
        expect(priceUnits(null, 0.01)).toEqual(['price']);
        expect(priceUnits(Number.NaN, 0.01)).toEqual(['price']);
    });

    it('a unit that cannot be computed reads and writes the price itself, never NaN or Infinity', () => {
        expect(priceInUnit(5, 0, 'percent', 0.01)).toBe(5);
        expect(priceFromUnit(5, 0, 'percent', 0.01)).toBe(5);
        expect(priceInUnit(5, 100, 'ticks')).toBe(5);
        expect(priceInUnit(5, 100, 'ticks', 0)).toBe(5);
        expect(priceInUnit(5, undefined, 'points')).toBe(5);
        for (const unit of UNITS) {
            expect(Number.isFinite(priceInUnit(5, 0, unit, 0))).toBe(true);
            expect(Number.isFinite(priceFromUnit(5, 0, unit, 0))).toBe(true);
        }
    });
});
