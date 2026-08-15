// Text-field CONTROLLER — last-committed string. No DOM.

export type TextFieldSize = 'sm' | 'md';

export interface TextFieldControllerOptions {
    value?: string;
    size?: TextFieldSize;
    fill?: boolean;
    disabled?: boolean;
    onChange?: (value: string) => void;
}

export interface TextFieldController {
    value: string;
    size: TextFieldSize;
    fill: boolean;
    disabled: boolean;
    commit(next: string): string | null;
    /** Write without emitting (external refresh). */
    sync(next: string): void;
}

export function textFieldController(opts: TextFieldControllerOptions = {}): TextFieldController {
    let value = opts.value ?? '';
    const size = opts.size ?? 'md';
    return {
        get value() { return value; },
        size,
        fill: opts.fill ?? size !== 'sm',
        disabled: opts.disabled ?? false,
        commit(next: string) {
            if (next === value) return null;
            value = next;
            opts.onChange?.(next);
            return next;
        },
        sync(next: string) { value = next; },
    };
}
