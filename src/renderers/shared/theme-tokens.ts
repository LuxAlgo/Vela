// Token plumbing for RENDERER chrome. The renderer must be usable without the widget or the
// UI kit, so it writes the shared token vocabulary onto its own hosts instead of relying on
// a kit host being an ancestor. Values come from `core/tokens`, so renderer chrome, kit
// components and widget chrome resolve every color/space/radius to the same thing.

import type { VelaTheme } from '../../core/options';
import { STATIC_TOKENS, themeTokens } from '../../core/tokens';

/** Write the static + theme tokens onto a chrome host as inline custom properties. Floating
 *  chrome that portals out of the chart container must call this on its own root. */
export function applyChromeTokens(el: HTMLElement, theme: VelaTheme): void {
    const write = (tokens: Record<string, string>) => {
        for (const key in tokens) el.style.setProperty(key, tokens[key]!);
    };
    write(STATIC_TOKENS);
    write(themeTokens(theme));
}
