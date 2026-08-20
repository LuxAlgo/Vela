// The BASE-asset heuristic shared by the shells (initials badges) and the bundled
// crypto providers (icon-URL resolvers) — DOM-free on purpose, so a provider can
// import it without touching the widget layer.
import type { SymbolDescriptor } from '../core/ports/DataProvider';

/** The BASE asset of a descriptor — the description's first segment ("BTC / USDT"),
 *  else the ticker with common quote suffixes stripped. */
export function baseOf(d: Pick<SymbolDescriptor, 'ticker' | 'description'>): string {
    const fromDesc = d.description?.split('/')[0]?.trim();
    if (fromDesc) return fromDesc.replace(/\s+Perpetual$/i, '');
    return d.ticker.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || d.ticker;
}

/** The Ledger crypto-icon CDN URL for a BASE asset (CORS-clean, PNG) — what the
 *  bundled crypto providers predefine their `resolveSymbolIcon` with. Empty base ⇒
 *  undefined (the shells' initials badge takes over). */
export function ledgerCryptoIconUrl(base: string): string | undefined {
    const key = base.trim().toUpperCase();
    return key ? `https://crypto-icons.ledger.com/${encodeURIComponent(key)}.png` : undefined;
}
