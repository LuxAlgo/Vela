// Number-input CONTROLLER — clamp, integer rounding, commit helpers. No DOM.

export type NumberSize = 'sm' | 'md';
export type NumberCommit = 'blur' | 'live';

export interface NumberInputControllerOptions {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    size?: NumberSize;
    /** `blur` (indicator dialog: clamp + steppers) vs `live` (chart settings: no clamp). */
    commit?: NumberCommit;
    steppers?: boolean;
    clamp?: boolean;
    disabled?: boolean;
    onChange?: (value: number) => void;
}

export function clampNumber(n: number, opts: { min?: number; max?: number; integer?: boolean }): number {
    let v = n;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    if (opts.integer) v = Math.round(v);
    return v;
}

export interface NumberInputController {
    value: number;
    min?: number;
    max?: number;
    step: number;
    integer: boolean;
    size: NumberSize;
    commit: NumberCommit;
    steppers: boolean;
    clamp: boolean;
    disabled: boolean;
    apply(raw: number): number | null;
    /** Write the displayed value without emitting (vela-sync / external refresh). */
    sync(raw: number): number;
    nudge(dir: 1 | -1): number | null;
}

export function numberInputController(opts: NumberInputControllerOptions): NumberInputController {
    let value = opts.value;
    const integer = opts.integer ?? false;
    const commit = opts.commit ?? 'blur';
    const clamp = opts.clamp ?? commit === 'blur';
    const step = opts.step ?? (integer ? 1 : 0.1);
    const onChange = opts.onChange;
    const normalize = (raw: number): number => (clamp ? clampNumber(raw, { min: opts.min, max: opts.max, integer }) : raw);
    const apply = (raw: number): number | null => {
        if (!Number.isFinite(raw)) return null;
        const n = normalize(raw);
        if (n !== value) {
            value = n;
            onChange?.(n);
        }
        return n;
    };
    return {
        get value() { return value; },
        min: opts.min,
        max: opts.max,
        step,
        integer,
        size: opts.size ?? 'md',
        commit,
        steppers: opts.steppers ?? commit === 'blur',
        clamp,
        disabled: opts.disabled ?? false,
        apply,
        sync(raw: number) {
            const n = Number.isFinite(raw) ? normalize(raw) : value;
            value = n;
            return n;
        },
        nudge(dir) { return apply(value + dir * step); },
    };
}
