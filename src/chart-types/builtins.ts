// Built-in chart types registered through the SAME public registry a plugin would use —
// Heikin Ashi is the reference bar-transform type. (Volume/VPVR go through the native
// indicator registry instead: they are layers over any style, not styles themselves.)
import { msg } from '../core/i18n/message';
import { registerChartType } from './registry';
import { heikinAshiFull, heikinAshiNext } from '../core/price-styles/heikin-ashi';
import type { BarTransform } from '../core/price-styles/BarTransform';

/** Singleton so the orchestrator can compare transforms by identity across style flips. */
const HEIKIN_ASHI: BarTransform = { full: heikinAshiFull, next: heikinAshiNext };

/** Register the built-in chart types (idempotent — called by the Vela constructor). */
export function registerBuiltinChartTypes(): void {
    registerChartType({
        id: 'heikinashi',
        label: msg('chart.priceStyle.heikinashi', 'Heikin Ashi'),
        barTransform: HEIKIN_ASHI,
        // Averages open, high and low: one value per bar leaves nothing to average.
        supports: (facts) => facts.ohlc !== false,
    });
}
