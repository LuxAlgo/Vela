// Design tokens — the single visual vocabulary every kit component (and widget chrome)
// consumes. Two layers:
//   • STATIC tokens (spacing, radii, z-index, motion, type scale): one shared sheet on
//     `.vela-ui` hosts — theme-independent.
//   • THEME tokens (surfaces, text, borders, states): computed from the chart's `VelaTheme`
//     by `themeTokens` (shared with the renderer's own chrome) and written as inline custom
//     properties on the host — the chart theme stays the single source of truth.
import type { VelaTheme } from '../core/options';
import { STATIC_TOKENS, themeTokens } from '../core/tokens';
import { injectStyles } from './styles';

const STATIC_ID = 'vela-ui-tokens';

const STATIC_DECLS = Object.entries(STATIC_TOKENS)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');

const STATIC_CSS = `
.vela-ui, .vela-ui-layer {
${STATIC_DECLS}
    font-family: var(--vela-font, -apple-system, system-ui, sans-serif);
    box-sizing: border-box;
    /* Chrome text (titles, buttons, menus, readouts) is UI, not copy — never selectable. */
    user-select: none;
    -webkit-user-select: none;
}
.vela-ui *, .vela-ui-layer * { box-sizing: border-box; }
/* Text ENTRY is the one exception: selection is part of editing. */
.vela-ui :is(input, textarea), .vela-ui-layer :is(input, textarea) { user-select: text; -webkit-user-select: text; }
.vela-icon { display: inline-flex; align-items: center; flex: none; }
.vela-icon svg { display: block; }
`;

/** Write the theme-derived custom properties onto a host element (the widget root and
 *  every floating layer — menus/tooltips portal outside the root, so layers re-apply). */
export function applyThemeTokens(el: HTMLElement, t: VelaTheme): void {
    const tokens = themeTokens(t);
    for (const key in tokens) el.style.setProperty(key, tokens[key]!);
}

/** Re-token a chart-overlay host (statusline, watermark, toast, context menu — chrome
 *  floating OVER the plot) from the LIVE plot surface: a config edit can recolor the
 *  plot background independently of the app theme (a white plot typed into settings on
 *  the dark theme), and the overlay ink must stay readable either way. `config` is the
 *  renderer's `getConfig()` snapshot; a missing/shapeless one falls back to the base
 *  app theme. */
export function applyPlotOverlayTokens(host: HTMLElement, base: VelaTheme, config: unknown): void {
    const layout = (config as { layout?: { background?: string; textColor?: string } } | null)?.layout;
    const t = layout?.background && layout.textColor ? { ...base, background: layout.background, textColor: layout.textColor } : base;
    applyThemeTokens(host, t);
}

/** Mark an element as a kit host: static token sheet + the `.vela-ui` class. */
export function ensureUIHost(el: HTMLElement, theme?: VelaTheme): void {
    injectStyles(STATIC_ID, STATIC_CSS, el.getRootNode() as Document | ShadowRoot);
    el.classList.add('vela-ui');
    if (theme) applyThemeTokens(el, theme);
}
