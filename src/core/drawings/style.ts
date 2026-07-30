import type { LineStyle } from '../model/series';
import { ACCENT_BRIGHT } from '../palette';

/**
 * The cosmetic payload shared by every drawing (the "settings" a user edits).
 * Reuses the Pine {@link LineStyle} so dash patterns resolve through the same
 * `dashPattern()` helper the renderer already uses.
 */
export interface DrawingStyle {
    lineColor: string;
    lineWidth: number;
    lineStyle: LineStyle;
    /** Fill (box / closed path); `undefined` ⇒ no fill. */
    fillColor?: string;
    /** Fill opacity 0..1 (applied over `fillColor`). */
    fillOpacity?: number;
    arrowLeft?: boolean;
    arrowRight?: boolean;
}

/** A drawing's editable text/annotation block. */
export interface DrawingText {
    value: string;
    /** `undefined` ⇒ auto-contrast against the fill/background. */
    color?: string;
    size: 'tiny' | 'small' | 'normal' | 'large' | 'huge' | 'auto';
    hAlign: 'left' | 'center' | 'right';
    vAlign: 'top' | 'center' | 'bottom';
    bold?: boolean;
    italic?: boolean;
}

/** The default drawing accent — the Vela logo blue. */
export const DEFAULT_DRAWING_COLOR = ACCENT_BRIGHT;

/** A neutral default style — concrete tools override via their `defaultStyle`. */
export function defaultStyle(): DrawingStyle {
    return { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' };
}

/** A neutral default text block (used when a drawing first gains text). */
export function defaultText(value = ''): DrawingText {
    return { value, size: 'normal', hAlign: 'left', vAlign: 'top' };
}
