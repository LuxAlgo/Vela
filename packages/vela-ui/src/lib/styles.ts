// Style delivery for the UI kit — JS-injected constructed sheets, same idiom as the
// renderer chrome (id-guarded <style> tags; no bundler CSS pipeline, works in Shadow DOM).

export { withAlpha } from './color';

/** The kit's scrollbar on `selector`, for a scroller outside a kit host (inside one, every
 *  scroller already has it). `width` overrides the `--vela-scroll-size` token, in px. */
export function overlayScrollbarCss(selector: string, width?: number): string {
    const size = width === undefined ? 'var(--vela-scroll-size, 5px)' : `${width}px`;
    return (
        `${selector}::-webkit-scrollbar{width:${size};height:${size};}` +
        `${selector}::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:${size};}` +
        `${selector}::-webkit-scrollbar-track,${selector}::-webkit-scrollbar-corner{background:transparent;}` +
        `${selector}::-webkit-scrollbar-button{display:none;width:0;height:0;}`
    );
}

/** Focus ring shared by typeable fields (combo inputs, textareas). */
export const FIELD_FOCUS_CSS =
    'outline:none;transition:border-color .12s ease,box-shadow .12s ease;';
export const FIELD_FOCUS_RING =
    'border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);';

/** The kit's cascade layers, lowest first. Declared before any layered sheet, so a host's
 *  own unlayered CSS beats every one of them without `!important`. */
export const LAYER_ORDER = '@layer vela.theme, vela.ui, vela.chrome, vela.pro, vela.custom;';

/**
 * Declare the layer order in a root, ahead of every Vela sheet already there: a layer's rank
 * is its first appearance. It goes before the first `vela…` sheet rather than first in the
 * head, so layers a host declared earlier (a framework's base styles) stay below Vela's.
 */
export function injectLayerOrder(root: Document | ShadowRoot = document): void {
    const sheet = injectStyles('vela-layers', LAYER_ORDER, root);
    const parent = sheet?.parentNode;
    if (!sheet || !parent) return;
    const first = Array.from(parent.children).find((el) => el.tagName === 'STYLE' && el.id.startsWith('vela'));
    if (first && first !== sheet) parent.insertBefore(sheet, first);
}

/** Inject a stylesheet once per root (document or shadow root). Idempotent by id; returns
 *  the sheet's element. */
export function injectStyles(id: string, css: string, root: Document | ShadowRoot = document): HTMLStyleElement | null {
    if (typeof document === 'undefined') return null;
    const host = root instanceof Document ? root.head : root;
    const existing = typeof root.getElementById === 'function' ? root.getElementById(id) : host.querySelector(`#${CSS.escape(id)}`);
    if (existing) return existing as HTMLStyleElement;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    host.appendChild(s);
    return s;
}
