// Select CONTROLLER — option list + current value. No DOM.

export type SelectSize = 'sm' | 'md';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectControllerOptions {
    options: readonly SelectOption[];
    value?: string;
    size?: SelectSize;
    /** Stretch the trigger to its parent. Off: the shared 100px kit column (ellipsis). */
    fill?: boolean;
    disabled?: boolean;
    onChange?: (value: string, label: string) => void;
}

export interface SelectController {
    options: readonly SelectOption[];
    value: string;
    size: SelectSize;
    fill: boolean;
    disabled: boolean;
    setValue(v: string): void;
    labelOf(value: string): string;
    pick(value: string): { value: string; label: string };
}

export function selectController(opts: SelectControllerOptions): SelectController {
    const options = opts.options;
    let value = opts.value ?? options[0]?.value ?? '';
    const size = opts.size ?? 'md';
    return {
        options,
        get value() { return value; },
        size,
        fill: opts.fill ?? size !== 'sm',
        disabled: opts.disabled ?? false,
        setValue(v: string) { value = v; },
        labelOf(v: string) { return options.find((o) => o.value === v)?.label ?? v; },
        pick(v: string) {
            value = v;
            const label = options.find((o) => o.value === v)?.label ?? v;
            opts.onChange?.(v, label);
            return { value: v, label };
        },
    };
}
