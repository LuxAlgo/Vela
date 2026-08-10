import { describe, it, expect } from 'vitest';
import { resolveLayoutMode, MOBILE_BREAKPOINT_PX, COARSE_BREAKPOINT_PX } from '../src/widget/layout-mode';

describe('resolveLayoutMode', () => {
    it('pins the mode when the option is explicit, regardless of measurements', () => {
        expect(resolveLayoutMode('mobile', 1920, false)).toBe('mobile');
        expect(resolveLayoutMode('desktop', 320, true)).toBe('desktop');
    });

    it('auto: narrow containers are mobile, wide ones desktop', () => {
        expect(resolveLayoutMode('auto', MOBILE_BREAKPOINT_PX - 1, false)).toBe('mobile');
        expect(resolveLayoutMode('auto', MOBILE_BREAKPOINT_PX, false)).toBe('desktop');
        expect(resolveLayoutMode('auto', 1920, false)).toBe('desktop');
    });

    it('auto: a coarse pointer widens the mobile band (tablets), but not indefinitely', () => {
        expect(resolveLayoutMode('auto', COARSE_BREAKPOINT_PX - 1, true)).toBe('mobile');
        expect(resolveLayoutMode('auto', COARSE_BREAKPOINT_PX, true)).toBe('desktop');
        // The same width with a fine pointer stays desktop.
        expect(resolveLayoutMode('auto', COARSE_BREAKPOINT_PX - 1, false)).toBe('desktop');
    });

    it('auto: an unmeasured container (width 0) stays desktop until observed', () => {
        expect(resolveLayoutMode('auto', 0, true)).toBe('desktop');
        expect(resolveLayoutMode('auto', -1, true)).toBe('desktop');
    });
});
