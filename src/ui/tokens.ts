// Design tokens — the single visual vocabulary every kit component (and widget chrome)
// consumes. Two layers:
//   • STATIC tokens (spacing, radii, z-index, motion, type scale): one shared sheet on
//     `.vela-ui` hosts — theme-independent.
//   • THEME tokens (surfaces, text, borders, states): derived from the chart's `VelaTheme`
//     and written as inline custom properties on the host by `applyThemeTokens` — the chart
//     theme stays the single source of truth (no separate UI palette to drift).
import type { VelaTheme } from '../core/options';
import { injectStyles, withAlpha } from './styles';

const STATIC_ID = 'vela-ui-tokens';

const STATIC_CSS = `
.vela-ui, .vela-ui-layer {
    --vela-space-1: 4px;
    --vela-space-2: 8px;
    --vela-space-3: 12px;
    --vela-space-4: 16px;
    --vela-radius-sm: 4px;
    --vela-radius-md: 6px;
    --vela-radius-lg: 10px;
    --vela-z-tooltip: 60;
    --vela-z-menu: 50;
    --vela-z-dialog: 40;
    --vela-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --vela-dur-fast: 90ms;
    --vela-dur-med: 160ms;
    --vela-font-size-sm: 11px;
    --vela-font-size-md: 12px;
    --vela-font-size-lg: 14px;
    font-family: var(--vela-font, -apple-system, system-ui, sans-serif);
    box-sizing: border-box;
}
.vela-ui *, .vela-ui-layer * { box-sizing: border-box; }
.vela-icon { display: inline-flex; align-items: center; flex: none; }
.vela-icon svg { display: block; }
`;

/** Write the theme-derived custom properties onto a host element (the widget root and
 *  every floating layer — menus/tooltips portal outside the root, so layers re-apply). */
export function applyThemeTokens(el: HTMLElement, t: VelaTheme): void {
    const set = (k: string, v: string) => el.style.setProperty(k, v);
    // Values mirror the reference design system: chart surface + panels share one
    // background; elevation/hover are white washes; the accent is the blue used by
    // active menu entries and selected controls (not the candle up-color).
    const dark = isDark(t.background);
    const wash = (a: number) => (dark ? `rgba(255, 255, 255, ${a})` : withAlpha(t.textColor, a + 0.02));
    set('--vela-font', t.fontFamily);
    set('--vela-bg', t.background);
    set('--vela-fg', dark ? '#d1d4dc' : t.textColor); // chrome text (the chart's own text stays t.textColor)
    set('--vela-fg-muted', dark ? '#868a96' : withAlpha(t.textColor, 0.62));
    set('--vela-fg-faint', withAlpha(t.textColor, 0.35));
    set('--vela-fg-bright', dark ? '#f0f3fa' : '#000000');
    set('--vela-surface', t.background);
    set('--vela-surface-elev', dark ? '#1c1d20' : withAlpha(t.textColor, 0.05));
    set('--vela-surface-overlay', dark ? '#1c1d20' : withAlpha(t.textColor, 0.05));
    set('--vela-border', t.borderColor);
    set('--vela-border-strong', dark ? '#34353b' : withAlpha(t.textColor, 0.28));
    set('--vela-border-soft', t.borderColor);
    set('--vela-hover', wash(0.06));
    set('--vela-active', wash(0.1));
    set('--vela-focus', withAlpha(t.textColor, 0.5));
    set('--vela-focus-soft', withAlpha(t.textColor, 0.12));
    set('--vela-scroll', withAlpha(t.textColor, 0.3));
    set('--vela-accent', '#2962ff');
    // The LuxAlgo-flavored LIGHT blue (also the default drawing-tool color): switches
    // and other "on" affordances that should read brighter than the menu accent.
    set('--vela-accent-bright', '#38c0fd');
    set('--vela-up', t.upColor);
    set('--vela-down', t.downColor);
    set('--vela-danger', t.downColor);
    set('--vela-shadow', '0 8px 30px rgba(0, 0, 0, 0.5)');
    set('--vela-shadow-dialog', '0 20px 60px rgba(0, 0, 0, 0.5)');
    set('--vela-backdrop', 'rgba(0, 0, 0, 0.45)');
}

/** Perceived-dark check on a hex/rgb background (drives the wash direction). */
function isDark(color: string): boolean {
    const c = color.trim();
    let r = 0, g = 0, b = 0;
    if (c.startsWith('#')) {
        const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join('') : c.slice(1, 7);
        const n = parseInt(h, 16);
        r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (m?.[1]) {
            const parts = m[1].split(',').map((x) => parseFloat(x));
            r = parts[0] ?? 0;
            g = parts[1] ?? 0;
            b = parts[2] ?? 0;
        }
    }
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Mark an element as a kit host: static token sheet + the `.vela-ui` class. */
export function ensureUIHost(el: HTMLElement, theme?: VelaTheme): void {
    injectStyles(STATIC_ID, STATIC_CSS, el.getRootNode() as Document | ShadowRoot);
    el.classList.add('vela-ui');
    if (theme) applyThemeTokens(el, theme);
}
