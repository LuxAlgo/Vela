// Style delivery for the UI kit — JS-injected constructed sheets, same idiom as the
// renderer chrome (id-guarded <style> tags; no bundler CSS pipeline, works in Shadow DOM).

export { withAlpha } from '../core/color';

/** Inject a stylesheet once per root (document or shadow root). Idempotent by id. */
export function injectStyles(id: string, css: string, root: Document | ShadowRoot = document): void {
    if (typeof document === 'undefined') return;
    const host = root instanceof Document ? root.head : root;
    if (root.getElementById?.(id) ?? host.querySelector(`#${CSS.escape(id)}`)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    host.appendChild(s);
}
