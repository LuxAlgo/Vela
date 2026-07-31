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
}
.vela-ui *, .vela-ui-layer * { box-sizing: border-box; }
.vela-icon { display: inline-flex; align-items: center; flex: none; }
.vela-icon svg { display: block; }
`;

/** Write the theme-derived custom properties onto a host element (the widget root and
 *  every floating layer — menus/tooltips portal outside the root, so layers re-apply). */
export function applyThemeTokens(el: HTMLElement, t: VelaTheme): void {
    const tokens = themeTokens(t);
    for (const key in tokens) el.style.setProperty(key, tokens[key]!);
}

/** Mark an element as a kit host: static token sheet + the `.vela-ui` class. */
export function ensureUIHost(el: HTMLElement, theme?: VelaTheme): void {
    injectStyles(STATIC_ID, STATIC_CSS, el.getRootNode() as Document | ShadowRoot);
    el.classList.add('vela-ui');
    if (theme) applyThemeTokens(el, theme);
}
