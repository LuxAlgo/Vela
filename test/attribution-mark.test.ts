import { describe, expect, it } from 'vitest';
import { attributionMarkColor } from '../src/renderers/native/chrome/AttributionMark';
import { LUXALGO_SYMBOL_SVG, LUXALGO_WORDMARK_SVG } from '../src/renderers/native/chrome/luxalgo-logos';

describe('attributionMarkColor', () => {
    it('is white on dark chart backgrounds', () => {
        expect(attributionMarkColor('#151619')).toBe('#ffffff');
        expect(attributionMarkColor('#000000')).toBe('#ffffff');
        expect(attributionMarkColor('rgb(30, 32, 38)')).toBe('#ffffff');
    });

    it('is black on light chart backgrounds', () => {
        expect(attributionMarkColor('#ffffff')).toBe('#000000');
        expect(attributionMarkColor('#f8fafc')).toBe('#000000');
        expect(attributionMarkColor('#fff')).toBe('#000000');
        expect(attributionMarkColor('rgb(240, 240, 240)')).toBe('#000000');
    });

    it('switches with no mid-tone in between as the background brightens', () => {
        const ramp = ['#101010', '#404040', '#606060', '#a0a0a0', '#d0d0d0', '#ffffff'];
        const inks = ramp.map((bg) => attributionMarkColor(bg));
        expect(new Set(inks)).toEqual(new Set(['#ffffff', '#000000']));
        expect(inks[0]).toBe('#ffffff');
        expect(inks[inks.length - 1]).toBe('#000000');
        // one crossover only — never white → gray → black
        const flips = inks.filter((ink, i) => i > 0 && ink !== inks[i - 1]).length;
        expect(flips).toBe(1);
    });
});

describe('luxalgo logos', () => {
    it('exports inline SVGs that paint via currentColor (not fixed white PNGs)', () => {
        expect(LUXALGO_SYMBOL_SVG).toContain('<svg');
        expect(LUXALGO_SYMBOL_SVG).toContain('currentColor');
        expect(LUXALGO_SYMBOL_SVG).not.toContain('data:image/png');
        expect(LUXALGO_WORDMARK_SVG).toContain('<svg');
        expect(LUXALGO_WORDMARK_SVG).toContain('currentColor');
        expect(LUXALGO_WORDMARK_SVG).not.toContain('data:image/png');
    });
});
