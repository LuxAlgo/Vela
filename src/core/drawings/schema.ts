/**
 * A data-driven settings schema. Each {@link SettingsField} names a dot-path into
 * a drawing (`'style.lineColor'`, `'text.value'`) plus a control `kind`, so the
 * renderer's settings popup builds controls generically — adding a new drawing
 * type is a schema entry, not new UI code.
 */

import { msg } from '../i18n/message';
import type { MessageLike } from '../i18n/types';

export type FieldKind = 'color' | 'number' | 'select' | 'lineStyle' | 'boolean' | 'text' | 'opacity';

export interface SettingsField {
    /** Dot-path into the drawing, e.g. `'style.lineColor'`, `'text.value'`, `'locked'`. */
    path: string;
    /** What the settings show; a message reads in the chart's language. */
    label: MessageLike;
    kind: FieldKind;
    /** number/opacity bounds. */
    min?: number;
    max?: number;
    step?: number;
    /** select options. */
    options?: ReadonlyArray<{ value: string; label: MessageLike }>;
    /** Cosmetic grouping in the popup. */
    group?: 'line' | 'fill' | 'text' | 'behavior';
    /** Only offered while another setting holds one of these values (an option that matters
     *  only in some modes). */
    when?: { path: string; in: readonly unknown[] };
    /** A color that follows another setting until one is picked (a rectangle's midline takes
     *  the border color): the path whose value the control shows while this one is unset. */
    fallback?: string;
    /** The label of the one row this field shares with the next one: a color and its line
     *  style ("Midline" for "Midline color" + "Midline style"), or an upper and a lower color
     *  ("Bands"). */
    rowLabel?: MessageLike;
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
export const LINE_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: MessageLike }> = [
    { value: 'solid', label: msg('drawing.option.solid', 'Solid') },
    { value: 'dashed', label: msg('drawing.option.dashed', 'Dashed') },
    { value: 'dotted', label: msg('drawing.option.dotted', 'Dotted') },
];

/** Reusable line-cosmetics fields shared by most drawings. */
export const LINE_FIELDS: SettingsField[] = [
    { path: 'style.lineColor', label: msg('drawing.field.lineColor', 'Line color'), kind: 'color', group: 'line' },
    { path: 'style.lineWidth', label: msg('drawing.field.lineWidth', 'Line width'), kind: 'number', min: 1, max: 10, step: 1, group: 'line' },
    { path: 'style.lineStyle', label: msg('drawing.field.lineStyle', 'Line style'), kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
];

/** The line fields of a closed shape, where the line is its border. */
export const BORDER_FIELDS: SettingsField[] = [
    { path: 'style.lineColor', label: msg('drawing.field.borderColor', 'Border color'), kind: 'color', group: 'line' },
    { path: 'style.lineWidth', label: msg('drawing.field.borderWidth', 'Border width'), kind: 'number', min: 1, max: 10, step: 1, group: 'line' },
    { path: 'style.lineStyle', label: msg('drawing.field.borderStyle', 'Border style'), kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
];

/** Reusable fill fields shared by filled shapes (channels, boxes). The fill's opacity lives in
 *  the fill color's own alpha (the color picker controls it) — no separate opacity field. */
export const FILL_FIELDS: SettingsField[] = [{ path: 'style.fillColor', label: msg('drawing.field.fillColor', 'Fill color'), kind: 'color', group: 'fill' }];

/** Text-size choices (drives the size `select`). */
export const TEXT_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: MessageLike }> = [
    { value: 'small', label: msg('drawing.option.small', 'Small') },
    { value: 'normal', label: msg('drawing.option.normal', 'Normal') },
    { value: 'large', label: msg('drawing.option.large', 'Large') },
    { value: 'huge', label: msg('drawing.option.huge', 'Huge') },
];

/** Reusable text fields — every drawing can carry an optional label (value/color/size/style). */
export const TEXT_FIELDS: SettingsField[] = [
    { path: 'text.value', label: msg('drawing.field.text', 'Text'), kind: 'text', group: 'text' },
    { path: 'text.color', label: msg('drawing.field.textColor', 'Text color'), kind: 'color', group: 'text' },
    { path: 'text.size', label: msg('drawing.field.textSize', 'Text size'), kind: 'select', options: TEXT_SIZE_OPTIONS, group: 'text' },
    { path: 'text.bold', label: msg('drawing.field.bold', 'Bold'), kind: 'boolean', group: 'text' },
    { path: 'text.italic', label: msg('drawing.field.italic', 'Italic'), kind: 'boolean', group: 'text' },
];

