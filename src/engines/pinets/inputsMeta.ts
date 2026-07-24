import type { InputSchema, InputType, InputValue } from '../../core/model/inputs';

/** The subset of PineTS `IPineInput` we read (kept loose to absorb drift). */
export interface RawPineInput {
    type?: string;
    defval?: unknown;
    varId?: string;
    title?: string;
    options?: unknown[];
    minval?: number;
    maxval?: number;
    step?: number;
    group?: string;
    inline?: string;
    tooltip?: string;
}

function mapType(type: string | undefined): InputType {
    switch (type) {
        case 'int':
            return 'int';
        case 'float':
            return 'float';
        case 'bool':
            return 'bool';
        case 'source':
            return 'source';
        case 'color':
            return 'color';
        case 'price':
            return 'price';
        case 'time':
            return 'time';
        case 'session':
            return 'session';
        case 'timeframe':
            return 'timeframe';
        case 'symbol':
            return 'symbol';
        case 'text_area':
            return 'text_area';
        default:
            // enum + anything unrecognized → a plain string field.
            return 'string';
    }
}

/** Types whose value is numeric (drive number-style controls); the rest are strings. */
function isNumericType(type: InputType): boolean {
    return type === 'int' || type === 'float' || type === 'price' || type === 'time';
}

/**
 * Pine's named color constants (the standard Pine palette, as emitted by PineTS's
 * `color.*` namespace). A bare constant used as an `input.color` DEFAULT reaches
 * us as the unresolved qualified path (`"color.teal"`) — PineTS's input scanner
 * only pre-evaluates `color.new()`/`color.rgb()` calls to hex. Feeding that
 * string back as the input's value would poison every color derived from it
 * (labels, barcolor gradients, plots), so resolve it to hex at the mapping seam.
 */
const PINE_COLOR_CONSTANTS: Record<string, string> = {
    aqua: '#00BCD4',
    black: '#363A45',
    blue: '#2196F3',
    fuchsia: '#E040FB',
    gray: '#787B86',
    green: '#4CAF50',
    lime: '#00E676',
    maroon: '#880E4F',
    navy: '#311B92',
    olive: '#808000',
    orange: '#FF9800',
    purple: '#9C27B0',
    red: '#F23645',
    silver: '#B2B5BE',
    teal: '#089981',
    white: '#FFFFFF',
    yellow: '#FDD835',
};

/** Resolve a color input's value: `color.teal`/`teal` → hex; hex/rgb(a) pass through. */
function resolvePineColor(value: string): string {
    const name = value.trim().toLowerCase().replace(/^color\./, '');
    return PINE_COLOR_CONSTANTS[name] ?? value;
}

/** The hex for an exact `color.<constant>` string (any case), else undefined. */
function qualifiedColorConstant(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const m = /^color\.([a-z]+)$/i.exec(v.trim());
    return m ? PINE_COLOR_CONSTANTS[m[1]!.toLowerCase()] : undefined;
}

/**
 * The untyped `input(color.red, …)` form reaches us as type 'string' carrying the
 * unresolved qualified path — in Pine it IS a color input (type inferred from the
 * default), so promote it. Only the unambiguous `color.<constant>` path promotes;
 * a bare name ('red') stays a string, since it could be a genuine string default.
 */
function isDegradedColorInput(r: RawPineInput): boolean {
    return (r.type === 'string' || r.type == null) && qualifiedColorConstant(r.defval) !== undefined;
}

function asInputValue(value: unknown, type: InputType): InputValue {
    if (type === 'bool') return Boolean(value);
    if (isNumericType(type)) return typeof value === 'number' ? value : Number(value) || 0;
    const s = typeof value === 'string' ? value : value == null ? '' : String(value);
    return type === 'color' ? resolvePineColor(s) : s;
}

/** Map PineTS input metadata → the renderer-neutral `InputSchema[]`. */
export function mapInputs(raw: RawPineInput[]): InputSchema[] {
    return raw.map((r, i) => {
        const type = isDegradedColorInput(r) ? 'color' : mapType(r.type);
        return {
            key: r.varId ?? r.title ?? `input${i}`,
            title: r.title ?? r.varId ?? `Input ${i + 1}`,
            type,
            defval: asInputValue(r.defval, type),
            min: r.minval,
            max: r.maxval,
            step: r.step,
            options: Array.isArray(r.options) ? r.options.map((o) => String(o)) : undefined,
            group: r.group,
            inline: r.inline,
            tooltip: r.tooltip,
        };
    });
}
