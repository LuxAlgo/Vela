/**
 * Renderer-neutral indicator input schema — Vela's own shape, owned here so no
 * scripting language's own input model leaks into core (each engine maps its
 * declarations onto this at its boundary). Drives the renderer's settings dialog
 * (the gear settings UI).
 */
export type InputType =
    | 'int'
    | 'float'
    | 'bool'
    | 'string'
    | 'source'
    | 'color'
    | 'price'
    | 'time'
    | 'session'
    | 'timeframe'
    | 'symbol'
    | 'text_area';

export type InputValue = number | string | boolean;

/**
 * Host-provided symbol picker for the settings dialog's `input.symbol` control. Called when the
 * user activates the field: the host opens its own symbol-selection UI (e.g. the app's ticker
 * menu) seeded with the `current` symbol, and reports the chosen one back through `onPick`. When
 * no picker is wired, `input.symbol` falls back to a plain text field.
 */
export type SymbolPickerFn = (current: string, onPick: (symbol: string) => void) => void;

export interface InputSchema {
    /** Stable key used by `setInput()` — the engine's own variable id, falling back to `title`. */
    key: string;
    /** Display label shown in the settings dialog. */
    title: string;
    type: InputType;
    defval: InputValue;
    min?: number;
    max?: number;
    step?: number;
    /** Choices for a dropdown (`input.string(..., options=[...])`). */
    options?: readonly string[];
    /** Grouping label for the dialog layout. */
    group?: string;
    /** Inline grouping label (controls placed on one row). */
    inline?: string;
    tooltip?: string;
}
