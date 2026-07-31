/**
 * A data-driven settings schema. Each {@link SettingsField} names a dot-path into
 * a drawing (`'style.lineColor'`, `'text.value'`) plus a control `kind`, so the
 * renderer's settings popup builds controls generically — adding a new drawing
 * type is a schema entry, not new UI code.
 */

export type FieldKind = 'color' | 'number' | 'select' | 'lineStyle' | 'boolean' | 'text' | 'opacity';

export interface SettingsField {
    /** Dot-path into the drawing, e.g. `'style.lineColor'`, `'text.value'`, `'locked'`. */
    path: string;
    label: string;
    kind: FieldKind;
    /** number/opacity bounds. */
    min?: number;
    max?: number;
    step?: number;
    /** select options. */
    options?: ReadonlyArray<{ value: string; label: string }>;
    /** Cosmetic grouping in the popup. */
    group?: 'line' | 'fill' | 'text' | 'behavior';
}

export interface SettingsSchema {
    fields: SettingsField[];
    /**
     * The text **is** the drawing (a text label, a note, a callout) rather than an optional label on
     * a shape. The settings popup then puts the text controls — color, size, bold, italic — on the
     * bar itself instead of tucking them under the text field.
     */
    textIsContent?: boolean;
}

/** The line-style choices most tools expose (drives a `lineStyle` control). */
export const LINE_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
];

/** Reusable line-cosmetics fields shared by most drawings. */
export const LINE_FIELDS: SettingsField[] = [
    { path: 'style.lineColor', label: 'Line color', kind: 'color', group: 'line' },
    { path: 'style.lineWidth', label: 'Line width', kind: 'number', min: 1, max: 10, step: 1, group: 'line' },
    { path: 'style.lineStyle', label: 'Line style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
];

/** Reusable fill fields shared by filled shapes (channels, boxes). The fill's opacity lives in
 *  the fill color's own alpha (the color picker controls it) — no separate opacity field. */
export const FILL_FIELDS: SettingsField[] = [{ path: 'style.fillColor', label: 'Fill color', kind: 'color', group: 'fill' }];

/** Text-size choices (drives the size `select`). */
export const TEXT_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'small', label: 'Small' },
    { value: 'normal', label: 'Normal' },
    { value: 'large', label: 'Large' },
    { value: 'huge', label: 'Huge' },
];

/** Reusable text fields — every drawing can carry an optional label (value/color/size/style). */
export const TEXT_FIELDS: SettingsField[] = [
    { path: 'text.value', label: 'Text', kind: 'text', group: 'text' },
    { path: 'text.color', label: 'Text color', kind: 'color', group: 'text' },
    { path: 'text.size', label: 'Text size', kind: 'select', options: TEXT_SIZE_OPTIONS, group: 'text' },
    { path: 'text.bold', label: 'Bold', kind: 'boolean', group: 'text' },
    { path: 'text.italic', label: 'Italic', kind: 'boolean', group: 'text' },
];
