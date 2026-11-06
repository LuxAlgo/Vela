// Component CSS: written in `css` templates (editors highlight them, stylelint checks them
// through the postcss-lit syntax) and injected once per document or shadow root.
import { pageState } from './page';
import { scopeToKit } from './scope';
import { injectLayerOrder, injectStyles } from './styles';

export { injectLayerOrder, LAYER_ORDER } from './styles';

// The texts the tag produced: CSS written in code. A theme loaded from data (a saved JSON, a
// shared file) holds strings no code wrote, so its CSS is told apart and left out by default.
// Page-wide: a theme written with one copy of the kit is applied by another.
const written = pageState('written-css@1', () => new Set<string>());

/** Joins a template into its CSS text. Interpolations are tokens (`t.*`) and component
 *  settings, which print as `var(--vela-…)`. */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
    let out = strings[0] ?? '';
    for (let i = 0; i < values.length; i += 1) out += String(values[i]) + (strings[i + 1] ?? '');
    written.add(out);
    return out;
}

/** Whether a CSS text was written with the {@link css} tag, or accepted as if it were. */
export function isWrittenCss(text: string): boolean {
    return written.has(text);
}

/** Accept a CSS text from data as if code wrote it (a host's explicit `allowCss`). */
export function acceptCss(text: string): void {
    written.add(text);
}

/** A component's stylesheet: call the result with the root it renders in, at creation, never
 *  at import (a component nobody creates injects nothing). Its rules apply inside kit hosts,
 *  their floating layers and themed hosts only: the page's own elements may carry the same
 *  part names. */
export function defineStyles(id: string, text: string): (root?: Document | ShadowRoot) => void {
    // The sheet each root got, so later creations skip the lookup while it stays in place.
    const injected = new WeakMap<Document | ShadowRoot, Element>();
    let scoped: string | undefined;
    return (root = document) => {
        if (injected.get(root)?.isConnected) return;
        injectLayerOrder(root);
        injectStyles(id, (scoped ??= scopeToKit(text)), root);
        const sheet = root.getElementById?.(id) ?? (root instanceof Document ? null : root.querySelector(`#${CSS.escape(id)}`));
        if (sheet) injected.set(root, sheet);
    };
}
