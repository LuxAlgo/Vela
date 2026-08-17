// Text-area CONTROLLER — last-committed string. No DOM.

export type TextAreaSize = 'sm' | 'md';

export interface TextAreaControllerOptions {
    value?: string;
    size?: TextAreaSize;
    rows?: number;
    disabled?: boolean;
    onChange?: (value: string) => void;
}

export interface TextAreaController {
    value: string;
    size: TextAreaSize;
    rows: number;
    disabled: boolean;
    commit(next: string): string | null;
    sync(next: string): void;
}

export function textAreaController(opts: TextAreaControllerOptions = {}): TextAreaController {
    let value = opts.value ?? '';
    return {
        get value() { return value; },
        size: opts.size ?? 'md',
        rows: opts.rows ?? 3,
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
