// The design tokens, as PURE DATA (no DOM) so every layer can share one vocabulary: the UI
// kit writes them onto its hosts, and the renderer's own chrome writes them onto the chart
// container. The chart's `VelaTheme` stays the single source of truth — there is no second
// UI palette to drift from it.
//
// STATIC tokens (spacing, radii, z-index, motion, type scale) are theme-independent;
// THEME tokens are computed per `VelaTheme`.

import type { VelaTheme } from './options';
import { isDarkColor, mix, withAlpha } from './color';
import { ACCENT, ACCENT_BRIGHT, HIGHLIGHT } from './palette';

/** Theme-independent tokens — the shared spacing/shape/motion/type scale. */
export const STATIC_TOKENS: Record<string, string> = {
    '--vela-space-1': '4px',
    '--vela-space-2': '8px',
    '--vela-space-3': '12px',
    '--vela-space-4': '16px',
    '--vela-radius-sm': '4px',
    '--vela-radius-md': '6px',
    '--vela-radius-lg': '10px',
    '--vela-z-tooltip': '60',
    '--vela-z-menu': '50',
    '--vela-z-dialog': '40',
    '--vela-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
    '--vela-dur-fast': '90ms',
    '--vela-dur-med': '160ms',
    '--vela-font-size-sm': '11px',
    '--vela-font-size-md': '12px',
    '--vela-font-size-lg': '14px',
};

/** Compute every theme token as a `--vela-*` → value map for one theme. */
export function themeTokens(t: VelaTheme): Record<string, string> {
    // Elevation and hover are washes of the foreground over the chart surface, so panels
    // and menus always sit in the same color family as the chart they annotate.
    const dark = isDarkColor(t.background);
    const wash = (a: number) => (dark ? `rgba(255,255,255,${a})` : withAlpha(t.textColor, a + 0.02));
    const elevated = mix(t.background, dark ? '#ffffff' : t.textColor, dark ? 0.03 : 0.05);
    return {
        '--vela-font': t.fontFamily,
        '--vela-bg': t.background,
        // Chrome text is slightly brighter than the chart's own axis text, which is
        // deliberately recessive; the chart keeps using `t.textColor` directly.
        '--vela-fg': dark ? '#d1d4dc' : t.textColor,
        '--vela-fg-muted': dark ? '#868a96' : withAlpha(t.textColor, 0.62),
        '--vela-fg-faint': withAlpha(t.textColor, 0.35),
        '--vela-fg-bright': dark ? '#f0f3fa' : '#000000',
        '--vela-surface': t.background,
        // Panels and menus float ABOVE the chart, so their surface is the wash flattened onto
        // the chart background — opaque, or candles read through the panel.
        '--vela-surface-elev': elevated,
        '--vela-surface-overlay': elevated,
        // Recessed fields (inputs, selects) read as cut INTO their panel, so they fall back
        // to the chart surface and are separated from the panel by their border alone.
        '--vela-surface-sunken': t.background,
        '--vela-border': t.borderColor,
        '--vela-border-strong': dark ? '#34353b' : withAlpha(t.textColor, 0.28),
        '--vela-border-soft': t.borderColor,
        // Barely-there rules INSIDE a panel (row separators), where a full border would
        // chop the list into boxes.
        '--vela-border-faint': withAlpha(t.textColor, 0.08),
        '--vela-hover': wash(0.06),
        '--vela-active': wash(0.1),
        // A deliberately stronger hover for rows inside an already-tinted surface (menu
        // items in an active flyout), where the normal wash would not separate from it.
        '--vela-hover-strong': wash(0.16),
        '--vela-focus': withAlpha(t.textColor, 0.5),
        '--vela-focus-soft': withAlpha(t.textColor, 0.12),
        '--vela-scroll': withAlpha(t.textColor, 0.3),
        '--vela-accent': ACCENT,
        '--vela-accent-bright': ACCENT_BRIGHT,
        '--vela-highlight': HIGHLIGHT,
        // The inverse chip: a filled selected state (active tab, ticked checkbox). Its ink
        // must contrast the fill, so the pair flips together with the theme.
        '--vela-selected-bg': dark ? '#f0f3fa' : t.textColor,
        '--vela-selected-fg': dark ? t.background : '#ffffff',
        // Fixed ink for saturated fills (accent buttons, categorical avatars) — those fills
        // are theme-independent, so their ink is too.
        '--vela-fg-on-fill': '#ffffff',
        '--vela-up': t.upColor,
        '--vela-down': t.downColor,
        '--vela-danger': t.downColor,
        '--vela-shadow': '0 8px 30px rgba(0,0,0,0.5)',
        '--vela-shadow-dialog': '0 20px 60px rgba(0,0,0,0.5)',
        '--vela-backdrop': 'rgba(0,0,0,0.45)',
    };
}