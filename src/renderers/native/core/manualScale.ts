import type { PriceScale } from './CoordinateSystem';

/**
 * Pure price-window transforms for manual vertical scaling (price-axis drag +
 * vertical price pan). Kept separate from the renderer so the math is unit-testable
 * without a DOM. Both operate in log space when the window is logarithmic so the
 * gesture feels uniform on screen (the pane renders through `Math.log`).
 */

/** Scale a window's SPAN by `factor` about its center (drag down ⇒ factor>1 ⇒ zoom out). */
export function rescaleAround(start: PriceScale, factor: number): PriceScale {
    if (start.log && start.min > 0 && start.max > start.min) {
        const lmin = Math.log(start.min);
        const lmax = Math.log(start.max);
        const c = (lmin + lmax) / 2;
        const h = ((lmax - lmin) / 2) * factor;
        return { min: Math.exp(c - h), max: Math.exp(c + h), log: true };
    }
    const c = (start.min + start.max) / 2;
    const h = ((start.max - start.min) / 2) * factor;
    return { min: c - h, max: c + h, log: start.log };
}

/** Shift a window by `dy` pixels of pane height (down ⇒ both bounds move UP in price). */
export function shiftScale(start: PriceScale, dy: number, height: number): PriceScale {
    if (height <= 0) return { ...start };
    if (start.log && start.min > 0 && start.max > start.min) {
        const lmin = Math.log(start.min);
        const lmax = Math.log(start.max);
        const d = ((lmax - lmin) * dy) / height;
        return { min: Math.exp(lmin + d), max: Math.exp(lmax + d), log: true };
    }
    const d = ((start.max - start.min) * dy) / height;
    return { min: start.min + d, max: start.max + d, log: start.log };
}
