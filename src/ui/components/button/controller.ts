// Button CONTROLLER — variant, size, pressed and disabled state, and the root part's
// attributes. No DOM.
import type { PartProps } from '../../headless';

/** `secondary` = outlined (the dialogs' Cancel); `primary` = filled with the selection color
 *  (OK, Apply); `ghost` = no border or fill until hovered (toolbar and header icons);
 *  `subtle` = a sunken fill (settings actions). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle';
/** `md` = 34px / 14px (dialog footers); `sm` = 30px / 13px (panels, compact dialogs);
 *  `xs` = 26px / 12px (header and row actions). */
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonControllerOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** A square icon button: the label becomes its accessible name. */
    iconOnly?: boolean;
    /** Accessible name — required for an icon-only button. */
    label?: string;
    /** A toggle button's state (`aria-pressed`). Omitted: not a toggle. */
    pressed?: boolean;
    disabled?: boolean;
}

export interface ButtonController {
    readonly variant: ButtonVariant;
    readonly size: ButtonSize;
    readonly iconOnly: boolean;
    readonly pressed: boolean | undefined;
    readonly disabled: boolean;
    setPressed(pressed: boolean): void;
    setDisabled(disabled: boolean): void;
    setLabel(label: string): void;
    /** The button element's attributes. */
    rootProps(): PartProps;
}

export function buttonController(opts: ButtonControllerOptions = {}): ButtonController {
    let pressed = opts.pressed;
    let disabled = opts.disabled ?? false;
    let label = opts.label;
    const variant = opts.variant ?? 'secondary';
    const size = opts.size ?? 'md';
    const iconOnly = opts.iconOnly ?? false;
    return {
        variant,
        size,
        iconOnly,
        get pressed() {
            return pressed;
        },
        get disabled() {
            return disabled;
        },
        setPressed(v) {
            pressed = v;
        },
        setDisabled(v) {
            disabled = v;
        },
        setLabel(v) {
            label = v;
        },
        rootProps: () => ({
            type: 'button',
            'data-variant': variant,
            'data-size': size,
            'data-icon-only': iconOnly,
            'data-pressed': pressed === true,
            'aria-pressed': pressed === undefined ? undefined : String(pressed),
            'aria-label': iconOnly ? label : undefined,
            disabled,
        }),
    };
}
