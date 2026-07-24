// Style delivery for the UI kit — JS-injected constructed sheets, same idiom as the
// renderer chrome (id-guarded <style> tags; no bundler CSS pipeline, works in Shadow DOM).

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

/** `rgba()` from a hex/rgb color string + alpha — kit-local (the kit never reaches into
 *  renderer internals). Understands `#rgb`, `#rrggbb`, `rgb()`/`rgba()`. */
export function withAlpha(color: string, alpha: number): string {
    const c = color.trim();
    if (c.startsWith('#')) {
        const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join('') : c.slice(1, 7);
        const n = parseInt(h, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m?.[1]) {
        const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return c;
}
