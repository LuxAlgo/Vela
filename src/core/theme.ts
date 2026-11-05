import { DARK_CHART, LIGHT_CHART, type UiTheme } from '@luxalgo/vela-ui/theme';
import type { VelaTheme, ThemeId } from './options';

// The reference dark palette (the design spec's first-run chart cosmetics: surface,
// axis text, subtle grid, candle green/red).
export const DARK_THEME: VelaTheme = DARK_CHART;

export const LIGHT_THEME: VelaTheme = LIGHT_CHART;

/** A theme offered by id, next to Dark and Light, in the chart settings' theme choice. */
export interface RegisteredTheme {
    id: string;
    label: string;
    theme: VelaTheme | UiTheme;
}

const registry = new Map<string, RegisteredTheme>();

/** Offer a theme by id: `theme: '<id>'`, `setTheme('<id>')` and the chart settings' theme
 *  choice. Registering an id again replaces it. Returns the unregister function. */
export function registerTheme(entry: RegisteredTheme): () => void {
    if (entry.id === 'dark' || entry.id === 'light') throw new Error(`registerTheme: "${entry.id}" is a built-in theme`);
    registry.set(entry.id, entry);
    return () => {
        if (registry.get(entry.id) === entry) registry.delete(entry.id);
    };
}

/** The registered themes, in registration order. */
export function registeredThemes(): readonly RegisteredTheme[] {
    return [...registry.values()];
}

const resolved = new WeakMap<UiTheme, VelaTheme>();

/** The chart theme for a theme option. A `createTheme` result resolves to its chart colors
 *  with its settings (one object per theme, so re-resolving it is not a theme change); an
 *  unknown id resolves to the dark theme. */
export function resolveTheme(theme?: ThemeId | VelaTheme | UiTheme): VelaTheme {
    if (!theme || theme === 'dark') return DARK_THEME;
    if (theme === 'light') return LIGHT_THEME;
    if (typeof theme === 'string') {
        const entry = registry.get(theme);
        return entry ? resolveTheme(entry.theme) : DARK_THEME;
    }
    if ('tokens' in theme) {
        let t = resolved.get(theme);
        if (!t) resolved.set(theme, (t = { ...theme.chart, ui: theme.settings }));
        return t;
    }
    return theme;
}

const themeKey = (t: VelaTheme) => JSON.stringify([t.background, t.textColor, t.gridColor, t.borderColor, t.upColor, t.downColor, t.fontFamily, t.ui ?? null]);

/** The id of the registered theme a chart theme is, if any. */
export function registeredThemeIdOf(theme: VelaTheme): string | null {
    const key = themeKey(theme);
    for (const entry of registry.values()) if (themeKey(resolveTheme(entry.theme)) === key) return entry.id;
    return null;
}
