import type { OHLCV } from '../../../core/model/ohlcv';
import type { IndicatorModel } from '../../../core/model/indicator';
import { isLineLikeSeries } from '../../../core/model/series';
import type { PriceScale } from './CoordinateSystem';

// LWC's default scaleMargins reserve the top 20% / bottom 10% of pane PIXEL
// height (data fills the middle 70%). Expressed over the price SPAN that is
// span*2/7 above and span*1/7 below.
const MARGIN_TOP = 2 / 7;
const MARGIN_BOTTOM = 1 / 7;

/**
 * Per-pane price window from the data visible in `[i0, i1]` (bar indices).
 * Considers candles (price pane), every value/candle series on the pane, and
 * price lines. Backend-agnostic and cheap (only the visible slice is scanned).
 */
export function computePaneScale(
    models: IndicatorModel[],
    bars: OHLCV[],
    includeCandles: boolean,
    i0: number,
    i1: number,
    drawings?: { min: number; max: number } | null,
    log = false,
    /** Per-model index offset (chart bar index of the model's anchor; 0 = whole-chart). */
    offsetOf: (id: string) => number = () => 0,
): PriceScale {
    let min = Infinity;
    let max = -Infinity;
    const consider = (v: number | null | undefined): void => {
        if (v != null && Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    };

    if (includeCandles) {
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (b) {
                consider(b.high);
                consider(b.low);
            }
        }
    }

    for (const model of models) {
        const off = offsetOf(model.id);
        for (const s of model.series) {
            if (s.kind === 'candle' || s.kind === 'bar') {
                for (let i = i0; i <= i1; i += 1) {
                    const b = s.bars[i - off];
                    if (b) {
                        consider(b.high);
                        consider(b.low);
                    }
                }
            } else if (isLineLikeSeries(s)) {
                // Hidden (display.none / na) series are NOT skipped — like LWC they
                // stay on the price scale so a fill anchored to them stays in view.
                for (let i = i0; i <= i1; i += 1) consider(s.points[i - off]?.value);
                // Histogram/columns grow from their base (default 0) — include it so
                // an all-positive plot autoscales from a visible zero line.
                if (s.kind === 'histogram' || s.kind === 'columns') consider(s.style?.base ?? 0);
                else if (s.style?.base != null) consider(s.style.base);
            }
        }
        for (const pl of model.priceLines) consider(pl.price);
    }

    // Visible Pine drawings (boxes/lines/labels/…) also expand the scale.
    if (drawings) {
        consider(drawings.min);
        consider(drawings.max);
    }

    if (min === Infinity || max === -Infinity) return { min: 0, max: 1 };
    if (min === max) {
        const pad = Math.abs(min) * 0.1 || 1;
        return { min: min - pad, max: max + pad, log: log && min - pad > 0 };
    }
    // Logarithmic: apply the margins in log space (requires a positive range).
    if (log && min > 0) {
        const lmin = Math.log(min);
        const lmax = Math.log(max);
        const lspan = lmax - lmin;
        return { min: Math.exp(lmin - lspan * MARGIN_BOTTOM), max: Math.exp(lmax + lspan * MARGIN_TOP), log: true };
    }
    const span = max - min;
    return { min: min - span * MARGIN_BOTTOM, max: max + span * MARGIN_TOP };
}
