import { describe, expect, it } from 'vitest';
import { mix, parseRgb } from '../src/core/color';
import { ACCENT } from '../src/core/palette';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';
import { STATIC_TOKENS, themeTokens } from '../src/core/tokens';

const opaque = (value: string) => !/rgba|hsla|transparent/.test(value) && parseRgb(value) !== null;

describe('mix', () => {
    it('flattens a wash onto the base as an opaque color', () => {
        expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
        expect(mix('#ffffff', '#000000', 0)).toBe('rgb(255,255,255)');
        expect(mix('#ffffff', '#000000', 1)).toBe('rgb(0,0,0)');
    });

    it('returns the base when either color is unparseable', () => {
        expect(mix('currentColor', '#ffffff', 0.5)).toBe('currentColor');
        expect(mix('#ffffff', 'currentColor', 0.5)).toBe('#ffffff');
    });
});

describe('themeTokens', () => {
    it('derives the chart surface and font from the theme', () => {
        const dark = themeTokens(DARK_THEME);
        expect(dark['--vela-bg']).toBe(DARK_THEME.background);
        expect(dark['--vela-font']).toBe(DARK_THEME.fontFamily);
        expect(dark['--vela-border']).toBe(DARK_THEME.borderColor);
        expect(dark['--vela-up']).toBe(DARK_THEME.upColor);
        expect(dark['--vela-down']).toBe(DARK_THEME.downColor);
    });

    it('keeps floating surfaces opaque so panels never show the chart through them', () => {
        for (const theme of [DARK_THEME, LIGHT_THEME]) {
            const t = themeTokens(theme);
            expect(opaque(t['--vela-surface-elev']!)).toBe(true);
            expect(opaque(t['--vela-surface-overlay']!)).toBe(true);
        }
    });

    it('separates a floating surface from the chart surface it sits on', () => {
        for (const theme of [DARK_THEME, LIGHT_THEME]) {
            const t = themeTokens(theme);
            expect(t['--vela-surface-elev']).not.toBe(t['--vela-surface']);
        }
    });

    it('inverts the selected chip pair with the theme', () => {
        const dark = themeTokens(DARK_THEME);
        const light = themeTokens(LIGHT_THEME);
        // A filled selected state: light ink on a dark fill, and the reverse.
        expect(dark['--vela-selected-bg']).not.toBe(light['--vela-selected-bg']);
        expect(dark['--vela-selected-fg']).toBe(DARK_THEME.background);
        expect(light['--vela-selected-fg']).toBe('#ffffff');
    });

    it('keeps the brand accent theme-independent', () => {
        expect(themeTokens(DARK_THEME)['--vela-accent']).toBe(ACCENT);
        expect(themeTokens(LIGHT_THEME)['--vela-accent']).toBe(ACCENT);
    });

    it('emits every token in both themes so no chrome falls back to an unset variable', () => {
        const dark = Object.keys(themeTokens(DARK_THEME)).sort();
        const light = Object.keys(themeTokens(LIGHT_THEME)).sort();
        expect(light).toEqual(dark);
        expect(dark.every((k) => k.startsWith('--vela-'))).toBe(true);
    });

    it('does not restate a static token as a theme token', () => {
        const theme = Object.keys(themeTokens(DARK_THEME));
        for (const key of Object.keys(STATIC_TOKENS)) expect(theme).not.toContain(key);
    });
});
