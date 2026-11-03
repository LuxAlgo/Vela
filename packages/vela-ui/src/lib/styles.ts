// Style delivery for the UI kit — JS-injected constructed sheets, same idiom as the
// renderer chrome (id-guarded <style> tags; no bundler CSS pipeline, works in Shadow DOM).

export { withAlpha } from './color';

/** Overlay scrollbar used by settings panes, dialog bodies, and similar chrome. */
export function overlayScrollbarCss(selector: string, width = 8): string {
    return (
        `${selector}::-webkit-scrollbar{width:${width}px;height:${width}px;}` +
        `${selector}::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}` +
        `${selector}::-webkit-scrollbar-track{background:transparent;}` +
        `${selector}::-webkit-scrollbar-button{display:none;width:0;height:0;}`
    );
}

/** Focus ring shared by typeable fields (combo inputs, textareas). */
export const FIELD_FOCUS_CSS =
    'outline:none;transition:border-color .12s ease,box-shadow .12s ease;';
export const FIELD_FOCUS_RING =
    'border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);';

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
