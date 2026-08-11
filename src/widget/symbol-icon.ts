// Shared ticker icon — the reference badge: the asset's real icon from the Ledger
// crypto-icon CDN, falling back to a colored-initials badge when there is no base or
// the image 404s. The 404 cache is shared, so a missing icon degrades to initials
// everywhere at once (and everything keeps working fully offline).
import type { SymbolDescriptor } from '../core/ports/DataProvider';
import { categoricalColor } from '../core/palette';

const iconFailed = new Set<string>();

function initialsOf(name: string): string {
    return (name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
}

function cryptoIconUrl(base: string): string {
    return `https://crypto-icons.ledger.com/${encodeURIComponent(base.toUpperCase())}.png`;
}

/** The BASE asset of a descriptor — the description's first segment ("BTC / USDT"),
 *  else the ticker with common quote suffixes stripped. */
export function baseOf(d: Pick<SymbolDescriptor, 'ticker' | 'description'>): string {
    const fromDesc = d.description?.split('/')[0]?.trim();
    if (fromDesc) return fromDesc.replace(/\s+Perpetual$/i, '');
    return d.ticker.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || d.ticker;
}

/**
 * A round ticker icon element: the real asset icon when the CDN serves it, a colored
 * initials badge otherwise. `className` styles the badge (size/shape come from CSS).
 */
export function tickerIconEl(doc: Document, base: string, name: string, className: string): HTMLElement {
    const wrap = doc.createElement('span');
    wrap.className = className;
    const key = base.toUpperCase();
    const fallback = (): void => {
        wrap.replaceChildren();
        wrap.style.background = categoricalColor(name);
        wrap.textContent = initialsOf(base || name);
    };
    if (!key || iconFailed.has(key)) {
        fallback();
        return wrap;
    }
    const img = doc.createElement('img');
    img.alt = '';
    // CORS-clean (the CDN serves `Access-Control-Allow-Origin: *`): a plain <img> would
    // TAINT any canvas it is drawn onto, so the PNG export had to leave the logo out.
    // If a host swaps in a CDN without CORS, the load errors into the initials badge —
    // which exports fine — instead of silently poisoning screenshots.
    img.crossOrigin = 'anonymous';
    img.src = cryptoIconUrl(key);
    img.style.cssText = 'width:100%;height:100%;border-radius:50%;display:block;object-fit:cover;';
    img.addEventListener(
        'error',
        () => {
            iconFailed.add(key);
            fallback();
        },
        { once: true },
    );
    wrap.appendChild(img);
    return wrap;
}
