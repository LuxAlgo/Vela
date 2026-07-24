import { describe, it, expect } from 'vitest';
import {
    barTimeToLogical,
    medianInterval,
    dashPattern,
    extendEndpoints,
    parseColor,
    contrastColor,
} from '../src/renderers/shared/drawing-geometry';

const TIMES = [0, 100, 200, 300, 400];

describe('drawing-geometry / barTimeToLogical', () => {
    it('maps exact bar times to integer logicals', () => {
        expect(barTimeToLogical(0, TIMES, 100)).toBe(0);
        expect(barTimeToLogical(200, TIMES, 100)).toBe(2);
        expect(barTimeToLogical(400, TIMES, 100)).toBe(4);
    });
    it('interpolates between bars', () => {
        expect(barTimeToLogical(250, TIMES, 100)).toBe(2.5);
        expect(barTimeToLogical(150, TIMES, 100)).toBe(1.5);
    });
    it('extrapolates before the first bar (negative logical)', () => {
        expect(barTimeToLogical(-100, TIMES, 100)).toBe(-1);
    });
    it('extrapolates past the last bar (future)', () => {
        expect(barTimeToLogical(600, TIMES, 100)).toBe(6);
    });
    it('handles empty/degenerate inputs', () => {
        expect(barTimeToLogical(5, [], 0)).toBe(0); // no bars
        expect(barTimeToLogical(10, [10], 0)).toBe(0); // single bar, exact
        expect(barTimeToLogical(5, [10], 0)).toBe(-5); // single bar, extrapolate with unit interval
    });
});

describe('drawing-geometry / medianInterval', () => {
    it('returns the median consecutive diff', () => {
        expect(medianInterval([0, 100, 200, 300])).toBe(100);
        expect(medianInterval([0, 100, 200, 10_000])).toBe(100); // robust to one gap
    });
    it('returns 0 for <2 points', () => {
        expect(medianInterval([5])).toBe(0);
    });
});

describe('drawing-geometry / dashPattern', () => {
    it('solid → no dash; dotted/dashed scale with width', () => {
        expect(dashPattern('solid', 2)).toEqual([]);
        expect(dashPattern('dotted', 2)).toEqual([2, 4]);
        expect(dashPattern('dashed', 2)).toEqual([8, 6]);
    });
});

describe('drawing-geometry / extendEndpoints', () => {
    it('extend none returns the original segment', () => {
        expect(extendEndpoints(10, 50, 20, 50, 'none', 100, 200)).toEqual([10, 50, 20, 50]);
    });
    it('extend right runs to the right edge; left to the left edge', () => {
        expect(extendEndpoints(10, 50, 20, 50, 'right', 100, 200)).toEqual([10, 50, 102, 50]);
        expect(extendEndpoints(10, 50, 20, 50, 'left', 100, 200)).toEqual([-2, 50, 20, 50]);
    });
    it('extend both follows the slope across the whole pane', () => {
        expect(extendEndpoints(0, 0, 10, 10, 'both', 100, 200)).toEqual([-2, -2, 102, 102]);
    });
    it('a vertical line with extend.both spans the full pane height', () => {
        expect(extendEndpoints(5, 30, 5, 80, 'both', 100, 200)).toEqual([5, 0, 5, 200]);
    });
    it('a vertical line with one-sided extend is a half-ray along its direction', () => {
        // downward line (y2 > y1): right ray runs from y1 to the bottom edge
        expect(extendEndpoints(5, 30, 5, 80, 'right', 100, 200)).toEqual([5, 30, 5, 200]);
        // downward line: left ray runs from the top edge through to y2
        expect(extendEndpoints(5, 30, 5, 80, 'left', 100, 200)).toEqual([5, 0, 5, 80]);
        // upward line (y2 < y1): right ray runs from y1 up to the top edge
        expect(extendEndpoints(5, 80, 5, 30, 'right', 100, 200)).toEqual([5, 80, 5, 0]);
        // upward line: left ray runs from the bottom edge to y2
        expect(extendEndpoints(5, 80, 5, 30, 'left', 100, 200)).toEqual([5, 200, 5, 30]);
    });
});

describe('drawing-geometry / colour', () => {
    it('parses #RGB, #RRGGBB, #RRGGBBAA and rgba()', () => {
        expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor('#4caf50')).toEqual({ r: 76, g: 175, b: 80, a: 1 });
        const c = parseColor('#4CAF5033')!;
        expect([c.r, c.g, c.b]).toEqual([76, 175, 80]);
        expect(c.a).toBeCloseTo(0x33 / 255, 3);
        expect(parseColor('rgba(1,2,3,0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
        expect(parseColor('not-a-color')).toBeNull();
    });
    it('auto-contrast picks black on light, white on dark', () => {
        expect(contrastColor('#ffffff')).toBe('#000000');
        expect(contrastColor('#000000')).toBe('#ffffff');
        expect(contrastColor(undefined)).toBe('#000000');
    });
});
