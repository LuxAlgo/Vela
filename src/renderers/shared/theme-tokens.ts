// Token plumbing for RENDERER chrome. The renderer must be usable without the widget or the
// UI kit, so it themes its own hosts instead of relying on a kit host being an ancestor. The
// theme carries every token, so renderer chrome, kit components and widget chrome resolve
// every color/space/radius to the same thing.

import { applyTheme } from '@luxalgo/vela-ui/theme';
import type { VelaTheme } from '../../core/options';

/** Theme a chrome host with every token. Floating chrome that portals out of the chart
 *  container must call this on its own root. */
export function applyChromeTokens(el: HTMLElement, theme: VelaTheme): void {
    applyTheme(el, theme);
}
