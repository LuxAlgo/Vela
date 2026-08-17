// Glyph-select CONTROLLER — option list + current value. No DOM.

export interface GlyphOption<T extends string | number = string | number> {
    value: T;
    label: string;
    /** Inner HTML of the preview glyph (currentColor stroke). */
    glyph: string;
}

export interface GlyphSelectControllerOptions<T extends string | number = string | number> {
    options: readonly GlyphOption<T>[];
    value: T;
    onChange?: (value: T) => void;
}

export interface GlyphSelectController<T extends string | number = string | number> {
    options: readonly GlyphOption<T>[];
    value: T;
    setValue(v: T): void;
    optionOf(value: T): GlyphOption<T> | undefined;
    pick(value: T): T;
}

export function glyphSelectController<T extends string | number>(
    opts: GlyphSelectControllerOptions<T>,
): GlyphSelectController<T> {
    let value = opts.value;
    return {
        options: opts.options,
        get value() { return value; },
        setValue(v) { value = v; },
        optionOf(v) { return opts.options.find((o) => o.value === v); },
        pick(v) {
            value = v;
            opts.onChange?.(v);
            return v;
        },
    };
}

/** The classic 1–5 px line-width ladder. */
export const WIDTH_FIELD_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];

/** A horizontal line glyph whose stroke IS the previewed weight. */
export function lineWidthGlyph(width: number): string {
    return `<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"/></svg>`;
}

export function widthFieldOptions(): readonly GlyphOption<number>[] {
    return WIDTH_FIELD_OPTIONS.map((w) => ({ value: w, label: `${w}px`, glyph: lineWidthGlyph(w) }));
}
