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

/** One visibility condition on another input's current value: `equals` matches a single
 *  value (a toggle, one dropdown choice), `anyOf` matches a set (several choices). */
export interface InputCondition {
    key: string;
    equals?: InputValue;
    anyOf?: readonly InputValue[];
}

/** An input's visibility gate: one condition, or several AND-ed together. */
export type InputWhen = InputCondition | readonly InputCondition[];

/**
 * Evaluate a visibility gate against the dialog's resolved current values (an input's
 * stored value, else its `defval`). No gate ⇒ visible. Mirrors the chart-settings row
 * gate (`settingsRowVisible`) so both dialogs share one condition vocabulary.
 */
export function inputVisible(when: InputWhen | undefined, values: Record<string, InputValue>): boolean {
    if (!when) return true;
    const conds: readonly InputCondition[] = Array.isArray(when) ? when : [when as InputCondition];
    return conds.every((c) => (c.anyOf ? c.anyOf.some((x) => x === values[c.key]) : values[c.key] === c.equals));
}

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
    /** Settings-dialog tab hosting this input; unset ⇒ the default "Inputs" tab. */
    tab?: string;
    /** Visibility gate: the input's row shows only while the condition(s) pass against
     *  the dialog's current values — re-evaluated live on every edit. Inputs sharing an
     *  `inline=` row show while ANY member's gate passes. A hidden input keeps its value. */
    when?: InputWhen;
    tooltip?: string;
}
