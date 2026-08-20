// Shared ticker icon — the reference badge. The icon URL comes from the OWNING
// PROVIDER (`resolveSymbolIcon` on the DataProvider port — the shells never guess an
// asset's icon source anymore); no URL, or an image that errors, falls back to a
// colored-initials badge. The failure cache is keyed by URL and shared, so a missing
// icon degrades to initials everywhere at once (and everything keeps working fully
// offline).
import { categoricalColor } from '../core/palette';
import { baseOf } from '../data/symbol-base';

// Re-exported from its historical home — the extraction now lives with the data layer
// so the bundled crypto providers share it without importing the widget.
export { baseOf };

const iconFailed = new Set<string>();

function initialsOf(name: string): string {
    return (name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
}

/**
 * A round ticker icon element: the provider-resolved icon when `iconUrl` is given and
 * loads, a colored initials badge otherwise. `className` styles the badge (size/shape
 * come from CSS).
 */
export function tickerIconEl(doc: Document, base: string, name: string, className: string, iconUrl?: string): HTMLElement {
    const wrap = doc.createElement('span');
    wrap.className = className;
    const fallback = (): void => {
        wrap.replaceChildren();
        wrap.style.background = categoricalColor(name);
        wrap.textContent = initialsOf(base || name);
    };
    if (!iconUrl || iconFailed.has(iconUrl)) {
        fallback();
        return wrap;
    }
    const img = doc.createElement('img');
    img.alt = '';
    // CORS-clean (the bundled sources serve `Access-Control-Allow-Origin: *`): a plain
    // <img> would TAINT any canvas it is drawn onto, so the PNG export had to leave the
    // logo out. If a provider resolves to a CDN without CORS, the load errors into the
    // initials badge — which exports fine — instead of silently poisoning screenshots.
    img.crossOrigin = 'anonymous';
    img.src = iconUrl;
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;display:block;object-fit:cover;';
    img.addEventListener(
        'error',
        () => {
            iconFailed.add(iconUrl);
            fallback();
        },
        { once: true },
    );
    wrap.appendChild(img);
    return wrap;
}
