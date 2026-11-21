/**
 * Renderer-neutral indicator input schema — Vela's own shape, owned here so no
 * scripting language's own input model leaks into core (each engine maps its
 * declarations onto this at its boundary). Drives the renderer's settings dialog
 * (the gear settings UI).
 */
import type { MessageLike } from '../i18n/types';

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
 * The display side of an input: what the settings dialog and the legend SHOW, in the
 * chart's language. The input's own `title`, `group` and `options` stay what they are
 * (a script reads them, layouts persist the option values), and this side-car only
 * changes how they read. Each field is optional and falls back to the identity field.
 */
export interface InputDisplay {
    /** Shown instead of `title`. */
    title?: MessageLike;
    /** Shown instead of `tooltip`. */
    tooltip?: MessageLike;
    /** Shown instead of `group` as the section heading. */
    group?: MessageLike;
    /** Shown label per stored option value (`'Close'` → a translated "Close"). Values
     *  without an entry show as themselves. */
    options?: Readonly<Record<string, MessageLike>>;
}

/**
 * A multi-select string input: the settings dialog shows its `options` as checkboxes in one
 * dropdown. The stored value stays ONE string, the checked options joined by `separator` in
 * `options` order (`'On bar close, On order fill'`), so layouts, `setInputs` and saved state
 * handle it like any string input.
 */
export interface InputMultiple {
    /** Joins the checked options in the stored value, such as `', '`. */
    separator: string;
    /** Options that are always checked: their checkboxes are disabled, and the value always
     *  holds them. */
    locked?: readonly string[];
}

/** A help mark on a group's section heading (see {@link InputSchema.groupHelp}). */
export interface InputGroupHelp {
    /** The mark's tooltip and accessible name. */
    text?: MessageLike;
    /** Opened in a new tab when the mark is clicked. Only `http:` and `https:` URLs are
     *  honoured; any other URL leaves the mark a tooltip only. */
    url?: string;
}

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
    /** Translatable display text for this input (see {@link InputDisplay}). */
    display?: InputDisplay;
    /** Check several `options` at once (see {@link InputMultiple}). Read on a `string` input
     *  with `options` only. */
    multiple?: InputMultiple;
    /** A help mark beside this input's `group` heading (see {@link InputGroupHelp}). The first
     *  input of a group that carries one sets it; an input without a `group` shows none. */
    groupHelp?: InputGroupHelp;
}

/** The distinct options of an input, as strings (an engine may hand over other scalars). */
function optionList(inp: Pick<InputSchema, 'options'>): string[] {
    return [...new Set((inp.options ?? []).map(String))];
}

/**
 * The options a multi-select value checks, in `options` order: the value split by the
 * separator, fragments that name no option dropped, `locked` options always in. An empty
 * value checks only the locked options.
 */
export function parseMultiValue(inp: Pick<InputSchema, 'options' | 'multiple'>, value: InputValue): string[] {
    const options = optionList(inp);
    const known = new Set(options);
    const raw = String(value);
    const sep = inp.multiple?.separator ?? '';
    const checked = new Set<string>(inp.multiple?.locked ?? []);
    for (const part of raw === '' ? [] : sep === '' ? [raw] : raw.split(sep)) {
        // Trimmed as a fallback: a `','` separator over `'A, B'` still names B.
        if (known.has(part)) checked.add(part);
        else if (known.has(part.trim())) checked.add(part.trim());
    }
    return options.filter((o) => checked.has(o));
}

/** The stored value for a set of checked options: the locked options added, unknown ones
 *  dropped, joined by the separator in `options` order. */
export function joinMultiValue(inp: Pick<InputSchema, 'options' | 'multiple'>, checked: Iterable<string>): string {
    const picked = new Set<string>([...checked, ...(inp.multiple?.locked ?? [])]);
    return optionList(inp)
        .filter((o) => picked.has(o))
        .join(inp.multiple?.separator ?? '');
}

/**
 * The DELTAS of a value bag against its schema's declaration defaults — what state
 * persistence stores (a default that later changes in the script must not stay frozen
 * in every saved document). Structural comparison (arrays/objects by JSON); keys the
 * schema does not declare are ignored. `undefined` = nothing deviates.
 */
export function inputDeltas(schema: readonly InputSchema[], values: Record<string, InputValue>): Record<string, InputValue> | undefined {
    const out: Record<string, InputValue> = {};
    for (const s of schema) {
        const v = values[s.key];
        if (v !== undefined && JSON.stringify(v) !== JSON.stringify(s.defval)) out[s.key] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
