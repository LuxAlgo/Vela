import type { Drawing } from './Drawing';
import { PatternDrawing } from './types/PatternDrawing';
import { CalloutBase } from './types/CalloutBase';
import { INVALID, VALID } from '../palette';

/** Semantic validity-tint colors, shared by the painter (body wash, name badge, leg ratios). */
export const VALID_FILL = VALID;
export const INVALID_FILL = INVALID;

/** The minimal theme slice the color resolution needs. */
export interface EffectiveColorTheme {
    background: string;
}

/**
 * The color a drawing's body is ACTUALLY filled with — the single source of truth shared by the
 * renderer (so it paints it) and the settings popup (so the Fill swatch reflects it, never a stale
 * default). Returns null when no single user-editable body fill applies: plain unfilled shapes, or
 * direction/zone-tinted and per-level-filled tools (their fill isn't a single editable color, and
 * they omit the Fill swatch anyway).
 *
 * Precedence mirrors the painter: an explicit `style.fillColor` always wins; otherwise a pattern
 * falls back to the harmonic validity tint (green valid / red invalid) or, for non-validated
 * patterns, the line-color wash; a callout falls back to the chart background.
 *
 * NOTE: this returns the COLOR only. The renderer's per-type opacity (the 0.1 pattern wash, etc.)
 * is a separate painter concern and must NOT be baked in here, or repeated round-trips through the
 * picker would compound it.
 */
export function effectiveFillColor(d: Drawing, theme: EffectiveColorTheme): string | null {
    if (d instanceof PatternDrawing) {
        if (!d.fillTriangles().length) return null; // plain ABCD / Elliott / Head & Shoulders paint no body
        const valid = d.valid();
        return d.style.fillColor ?? (valid == null ? d.style.lineColor : valid ? VALID_FILL : INVALID_FILL);
    }
    if (d instanceof CalloutBase) return d.style.fillColor ?? theme.background;
    return d.style.fillColor ?? null;
}
