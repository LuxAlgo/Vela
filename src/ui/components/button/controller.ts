// Button CONTROLLER — variant, size, pressed and disabled state, and the root part's
// attributes. No DOM.
import type { PartProps } from '../../headless';

/** `default` = filled with the selection color (OK, Apply); `outline` = bordered (the
 *  dialogs' Cancel); `secondary` = a sunken fill (settings actions); `ghost` = no border or
 *  fill until hovered (toolbar and header icons); `destructive` = tinted with the danger
 *  color (Remove, Delete); `link` = text that underlines on hover. */
export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
/** Heights: `xs` 26px, `sm` 30px (panels), `default` 34px (dialog footers), `lg` 40px
 *  (touch). The `icon*` sizes are the same heights, square, for a button that shows only
 *  an icon (its `label` names it). */
export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

export interface ButtonControllerOptions {
    /** Default `default`. */
    variant?: ButtonVariant;
    /** Default `default`. */
    size?: ButtonSize;
    /** Accessible name — required for the `icon*` sizes. */
    label?: string;
    /** A toggle button's state (`aria-pressed`). Omitted: not a toggle. */
    pressed?: boolean;
    disabled?: boolean;
}

export interface ButtonController {
    readonly variant: ButtonVariant;
    readonly size: ButtonSize;
    /** The size shows only an icon. */
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
    const variant = opts.variant ?? 'default';
    const size = opts.size ?? 'default';
    const iconOnly = size.startsWith('icon');
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
            'data-slot': 'button',
            'data-variant': variant,
            'data-size': size,
            'data-pressed': pressed === true,
            'aria-pressed': pressed === undefined ? undefined : String(pressed),
            'aria-label': iconOnly ? label : undefined,
            disabled,
        }),
    };
}
