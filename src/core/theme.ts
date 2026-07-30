import type { VelaTheme, ThemeName } from './options';
import { BEARISH, BULLISH } from './palette';

// The reference dark palette (the design spec's first-run chart cosmetics: surface,
// axis text, subtle grid, candle green/red).
export const DARK_THEME: VelaTheme = {
    background: '#151619',
    textColor: '#b2b5be',
    gridColor: '#20222c',
    borderColor: '#2a2b30',
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

export const LIGHT_THEME: VelaTheme = {
    background: '#ffffff',
    textColor: '#1e293b',
    gridColor: '#e2e8f0',
    borderColor: '#cbd5e1',
    upColor: '#26a69a',
    downColor: '#ef5350',
    fontFamily: 'sans-serif',
};

export function resolveTheme(theme?: ThemeName | VelaTheme): VelaTheme {
    if (!theme || theme === 'dark') return DARK_THEME;
    if (theme === 'light') return LIGHT_THEME;
    return theme;
}
