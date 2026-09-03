import { registerNativeIndicator } from '../NativeIndicator';
import { classicDescriptor } from './define';
import type { ClassicIndicatorSpec } from './define';
import { averageSpecs } from './averages';
import { bandSpecs } from './bands';
import { oscillatorSpecs } from './oscillators';
import { trendSpecs } from './trend';
import { volatilitySpecs } from './volatility';
import { volumeSpecs } from './volume';
import { overlaySpecs } from './overlays';

/**
 * The classic indicator catalog — the standard technical-analysis studies every
 * charting host expects (moving averages, oscillators, bands, volume studies),
 * each a pure compute over the chart's own bars riding the native-indicator
 * pipeline (picker, legend, panes, settings, persistence).
 */
export const classicSpecs: ClassicIndicatorSpec[] = [
    ...averageSpecs,
    ...bandSpecs,
    ...oscillatorSpecs,
    ...trendSpecs,
    ...volatilitySpecs,
    ...volumeSpecs,
    ...overlaySpecs,
];

/** Register the classic indicator catalog (idempotent). Called by the composition root. */
export function registerClassicIndicators(): void {
    for (const spec of classicSpecs) registerNativeIndicator(classicDescriptor(spec));
}

export { classicDescriptor } from './define';
export type { ClassicIndicatorSpec, ClassicOutput, ClassicPlot, ClassicBand, ClassicLevel } from './define';
