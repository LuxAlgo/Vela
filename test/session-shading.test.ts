import { describe, expect, it } from 'vitest';
import { deriveSessionZones } from '../src/widget/session-shading';

// One synthetic trading day, hour-granular epoch ms (readable offsets).
const H = 3_600_000;

describe('deriveSessionZones', () => {
    it('splits an extended window into pre and post around the regular hours', () => {
        // ETH 4:00–20:00, RTH 9:30–16:00 (the US-equities shape).
        const zones = deriveSessionZones([[9.5 * H, 16 * H]], [[4 * H, 20 * H]]);
        expect(zones.pre).toEqual([[4 * H, 9.5 * H]]);
        expect(zones.post).toEqual([[16 * H, 20 * H]]);
    });

    it('emits no pre band when the extended tape opens with regular hours', () => {
        const zones = deriveSessionZones([[4 * H, 16 * H]], [[4 * H, 20 * H]]);
        expect(zones.pre).toEqual([]);
        expect(zones.post).toEqual([[16 * H, 20 * H]]);
    });

    it('emits no post band on an early-close day whose extended window ends at the bell', () => {
        const zones = deriveSessionZones([[9.5 * H, 13 * H]], [[4 * H, 13 * H]]);
        expect(zones.pre).toEqual([[4 * H, 9.5 * H]]);
        expect(zones.post).toEqual([]);
    });

    it('classifies a mid-session gap as pre (the session resumes ahead)', () => {
        // A lunch-break market: two regular windows inside one extended window.
        const zones = deriveSessionZones(
            [[9 * H, 11.5 * H], [12.5 * H, 15 * H]],
            [[8 * H, 17 * H]],
        );
        expect(zones.pre).toEqual([[8 * H, 9 * H], [11.5 * H, 12.5 * H]]);
        expect(zones.post).toEqual([[15 * H, 17 * H]]);
    });

    it('treats an extended window with no regular hours as post', () => {
        const zones = deriveSessionZones([], [[4 * H, 20 * H]]);
        expect(zones.pre).toEqual([]);
        expect(zones.post).toEqual([[4 * H, 20 * H]]);
    });

    it('handles multiple days independently', () => {
        const day = 24 * H;
        const zones = deriveSessionZones(
            [[9.5 * H, 16 * H], [day + 9.5 * H, day + 16 * H]],
            [[4 * H, 20 * H], [day + 4 * H, day + 20 * H]],
        );
        expect(zones.pre).toEqual([[4 * H, 9.5 * H], [day + 4 * H, day + 9.5 * H]]);
        expect(zones.post).toEqual([[16 * H, 20 * H], [day + 16 * H, day + 20 * H]]);
    });
});
