import type { OHLCV } from '../model/ohlcv';
import { chartType, tickerModifierIds } from '../../chart-types/registry';

/**
 * A 1:1, TIME-PRESERVING per-bar transform a price style applies to the chart's bar
 * stream (Heikin Ashi is the first). The orchestrator applies it at its single outbound
 * bar seam, so the renderer, the scripting engines, and the native indicators all see
 * one consistent VIEW while the raw series stays the untouched source of truth (the
 * `'bar'` event and `chart.data` stay on the raw plane).
 *
 * Deliberately NOT a contract for styles that change the bar count or time axis
 * (Renko, Kagi, Point & Figure) — those need a different seam.
 */
export interface BarTransform {
    /** Derive the full view series from the raw series (front-to-back; may be recursive). */
    full(raw: readonly OHLCV[]): OHLCV[];
    /** Derive ONE view bar from a raw bar + the PREVIOUS view bar (live tick / append; O(1)). */
    next(raw: OHLCV, prevView: OHLCV | undefined): OHLCV;
}

/**
 * The bar transform a price style requires (null ≡ raw bars). Resolved through the
 * chart-type REGISTRY — built-ins and plugin-registered types answer identically, and
 * definitions keep their transform singletons so callers can compare by identity.
 */
export function barTransformFor(style: unknown): BarTransform | null {
    return chartType(style)?.barTransform ?? null;
}

/**
 * Parse an EXTENDED TICKER — `"SYMBOL;modifier"` — into its plain symbol + the transform
 * the modifier asks for. This is the format the engine emits: on a Heikin Ashi chart
 * `syminfo.tickerid` carries `";heikinashi"` (and `ticker.heikinashi()` appends it),
 * while `ticker.standard()` strips back to the plain symbol — so a plain symbol IS the
 * standard-data request. `";standard"` is also honored as an explicit raw marker.
 * Unknown modifiers resolve to a raw (null) transform. The recognized set is DYNAMIC:
 * every registered chart type with a ticker modifier participates — anything else stays
 * part of the symbol (a symbol containing a literal `;` is never mangled).
 */
export function parseExtendedTicker(symbol: string): { symbol: string; modifier: string | null; transform: BarTransform | null } {
    const at = symbol.lastIndexOf(';');
    if (at <= 0 || at === symbol.length - 1) return { symbol, modifier: null, transform: null };
    const modifier = symbol.slice(at + 1).toLowerCase();
    if (modifier !== 'standard' && !tickerModifierIds().includes(modifier)) return { symbol, modifier: null, transform: null };
    return { symbol: symbol.slice(0, at), modifier, transform: barTransformFor(modifier) };
}
