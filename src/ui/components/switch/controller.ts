// Switch CONTROLLER — checked state + option mapping. No DOM.

export type SwitchSize = 'sm' | 'md';
/** `bright` = indicator-dialog fill (`--vela-fg-bright`); `selected` = chart-settings fill. */
export type SwitchTone = 'bright' | 'selected';

export interface SwitchControllerOptions {
    checked?: boolean;
    disabled?: boolean;
    size?: SwitchSize;
    tone?: SwitchTone;
    onChange?: (checked: boolean) => void;
}

export interface SwitchController {
    checked: boolean;
    disabled: boolean;
    size: SwitchSize;
    tone: SwitchTone;
    setChecked(v: boolean): void;
    toggle(): boolean;
}

export function switchController(opts: SwitchControllerOptions = {}): SwitchController {
    let checked = opts.checked ?? false;
    const disabled = opts.disabled ?? false;
    return {
        get checked() { return checked; },
        disabled,
        size: opts.size ?? 'md',
        tone: opts.tone ?? 'bright',
        setChecked(v: boolean) { checked = v; },
        toggle() {
            if (disabled) return checked;
            checked = !checked;
            opts.onChange?.(checked);
            return checked;
        },
    };
}
