// Which price styles can draw the chart's symbol. A style drawn from open, high and low has
// nothing to show on a series with one value per bar (`SymbolInfo.ohlc === false`): the
// chart then shows a close-based style in its place, without touching the chosen one, and
// the style pickers grey it out. Unknown facts grey nothing.
import type { SymbolFacts } from '../core/ports/MarketDataFeed';
import { chartType } from './registry';

/** The built-in styles drawn from open, high and low. Every other built-in draws the close
 *  and applies to any symbol; a registered type states its own rule (`supports`). */
const OHLC_BUILTINS: ReadonlySet<string> = new Set(['candles', 'bars']);

/** The styles shown in place of one the symbol cannot draw, in order of preference: the
 *  first that exists and applies wins. */
export const PRICE_STYLE_FALLBACKS: readonly string[] = ['linemarkers', 'line'];

/**
 * Whether `style` can draw the symbol `facts` describe. `null`/`undefined` facts (not known
 * yet, or a source that states none) ⇒ every style applies. A registered type answers
 * through its `supports` predicate (a throwing one counts as supporting).
 */
export function priceStyleApplies(style: string, facts: Readonly<SymbolFacts> | null | undefined): boolean {
    if (!facts) return true;
    const supports = chartType(style)?.supports;
    if (supports) {
        try {
            return supports(facts) !== false;
        } catch {
            return true;
        }
    }
    return !(facts.ohlc === false && OHLC_BUILTINS.has(style));
}

/**
 * The style a chart set to `style` draws for the symbol `facts` describe: `style` itself
 * when it applies, else the first of {@link PRICE_STYLE_FALLBACKS} among `known` (the style
 * ids that exist right now) that applies, else `style` (nothing better to offer).
 */
export function shownPriceStyle(style: string, facts: Readonly<SymbolFacts> | null | undefined, known: readonly string[]): string {
    if (priceStyleApplies(style, facts)) return style;
    for (const id of PRICE_STYLE_FALLBACKS) if (known.includes(id) && priceStyleApplies(id, facts)) return id;
    return style;
}
