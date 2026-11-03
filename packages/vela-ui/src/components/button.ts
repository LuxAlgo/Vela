// Button: a <button> with optional icons before and after its text. `default` is filled with
// the selection color (OK, Apply), `outline` bordered (the dialogs' Cancel), `secondary` a
// sunken fill, `ghost` bare until hovered (toolbar and header icons), `destructive` tinted
// with the danger color, `link` text that underlines on hover. Heights: `xs` 26px, `sm` 30px
// (panels), `default` 34px (dialog footers), `lg` 40px (touch); the `icon*` sizes are the
// same heights, square, for an icon alone, which `label` names.
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const buttonDef = defineComponent({
    name: 'button',
    parts: ['root', 'icon'],
    settings: { radius: t.radius.md },
});

export const buttonVariants = variants({
    variant: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    size: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
});

export type ButtonVariant = (typeof buttonVariants.spec.variant)[number];
export type ButtonSize = (typeof buttonVariants.spec.size)[number];

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
    /** The visible text (the `icon*` sizes show none; `label` names them). */
    text?: string;
    /** Icon id from the kit's registry, before the text (the icon of an `icon*` size). */
    icon?: string;
    /** Icon id after the text (a menu trigger's chevron). */
    iconEnd?: string;
    /** Accessible name; required for the `icon*` sizes, defaults to `text`. */
    label?: string;
    /** A toggle button's state (`aria-pressed`). Omitted: not a toggle. */
    pressed?: boolean;
    disabled?: boolean;
    onClick?: (e: MouseEvent) => void;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ButtonHandle {
    readonly el: HTMLButtonElement;
    readonly pressed: boolean | undefined;
    setPressed(pressed: boolean): void;
    setDisabled(disabled: boolean): void;
    /** New text (or, for an `icon*` size, a new accessible name). */
    setText(text: string): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-button',
    css`
        @layer vela.ui {
            [data-slot='button'] {
                cursor: pointer;
                height: 34px;
                padding: 0 11px;
                border-radius: ${buttonDef.vars.radius};
                border: 1px solid ${t.border.strong};
                background: transparent;
                color: ${t.fg};
                font-weight: 400;
                font-size: 14px;
                font-family: inherit;
                transition:
                    background ${t.dur.fast} ease,
                    color ${t.dur.fast} ease,
                    opacity ${t.dur.fast} ease,
                    border-color ${t.dur.fast} ease;

                &:where(:not([hidden])):has(> [data-icon]) {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }
                & > [data-icon] {
                    width: 16px;
                    height: 16px;
                    flex: none;
                }
                &[data-size='sm'],
                &[data-size='icon-sm'] {
                    height: 30px;
                    font-size: 13px;
                }
                &[data-size='xs'],
                &[data-size='icon-xs'] {
                    height: 26px;
                    padding: 0 8px;
                    font-size: 12px;
                    border-radius: ${t.radius.sm};
                }
                &[data-size='lg'],
                &[data-size='icon-lg'] {
                    height: 40px;
                    padding: 0 14px;
                }
                &[data-size='icon'] {
                    width: 34px;
                    padding: 0;
                }
                &[data-size='icon-sm'] {
                    width: 30px;
                    padding: 0;
                }
                &[data-size='icon-xs'] {
                    width: 26px;
                    padding: 0;
                }
                &[data-size='icon-lg'] {
                    width: 40px;
                    padding: 0;
                }
                &:disabled {
                    cursor: default;
                    opacity: 0.5;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 1px;
                }
                &:not(:disabled):hover,
                &[aria-expanded='true'] {
                    background: ${t.hover};
                    color: ${t.fg.bright};
                    border-color: ${t.fg.muted};
                }
                &[data-variant='default'] {
                    border-color: ${t.selected.bg};
                    background: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[data-variant='default']:not(:disabled):hover,
                &[data-variant='default'][aria-expanded='true'] {
                    background: ${t.selected.bg};
                    color: ${t.selected.fg};
                    opacity: 0.85;
                    border-color: ${t.selected.bg};
                }
                &[data-variant='secondary'] {
                    background: ${t.surface.sunken};
                    border-color: ${t.border};
                }
                &[data-variant='secondary']:not(:disabled):hover,
                &[data-variant='secondary'][aria-expanded='true'] {
                    border-color: ${t.border.strong};
                }
                &[data-variant='ghost'] {
                    border-color: transparent;
                    color: ${t.fg.muted};
                }
                &[data-variant='ghost']:not(:disabled):hover,
                &[data-variant='ghost'][aria-expanded='true'] {
                    border-color: transparent;
                }
                &[data-variant='destructive'] {
                    border-color: transparent;
                    background: color-mix(in srgb, ${t.danger} 14%, transparent);
                    color: ${t.danger};
                }
                &[data-variant='destructive']:not(:disabled):hover {
                    border-color: transparent;
                    background: color-mix(in srgb, ${t.danger} 24%, transparent);
                    color: ${t.danger};
                }
                &[data-variant='link'] {
                    border-color: transparent;
                    background: transparent;
                    color: ${t.accent};
                    padding-inline: 0;
                    text-underline-offset: 4px;
                }
                &[data-variant='link']:not(:disabled):hover {
                    border-color: transparent;
                    background: transparent;
                    color: ${t.accent};
                    text-decoration: underline;
                }
                &[data-pressed] {
                    background: ${t.active};
                    color: ${t.fg.bright};
                }
            }
        }
    `,
);

class ButtonImpl implements ButtonHandle {
    readonly el: HTMLButtonElement;
    private readonly iconOnly: boolean;
    private readonly textNode: Text | null;
    private label: string | undefined;
    private pressedState: boolean | undefined;

    constructor(props: ButtonProps) {
        injectStyles(document);
        const { variant, size } = buttonVariants.resolve(props);
        this.iconOnly = size.startsWith('icon');
        this.label = props.label ?? props.text;
        this.pressedState = props.pressed;
        const icon = (id: string, side: 'inline-start' | 'inline-end'): HTMLElement => {
            const el = iconEl(id, document);
            el.dataset.slot = buttonDef.slot('icon');
            el.dataset.icon = side;
            return el;
        };
        this.textNode = !this.iconOnly && props.text !== undefined ? document.createTextNode(props.text) : null;
        this.el = h(
            'button',
            {
                className: props.className ? `vela-btn ${props.className}` : 'vela-btn',
                slot: buttonDef.slot('root'),
                attrs: { type: 'button', ...buttonVariants({ variant, size }) },
                on: props.onClick ? { click: props.onClick } : undefined,
            },
            props.icon ? icon(props.icon, 'inline-start') : null,
            this.textNode,
            props.iconEnd && !this.iconOnly ? icon(props.iconEnd, 'inline-end') : null,
        );
        this.el.disabled = props.disabled ?? false;
        this.paint();
    }

    get pressed(): boolean | undefined {
        return this.pressedState;
    }

    setPressed(pressed: boolean): void {
        this.pressedState = pressed;
        this.paint();
    }

    setDisabled(disabled: boolean): void {
        this.el.disabled = disabled;
    }

    setText(text: string): void {
        this.label = text;
        if (this.textNode) this.textNode.data = text;
        this.paint();
    }

    destroy(): void {}

    private paint(): void {
        const el = this.el;
        el.toggleAttribute('data-pressed', this.pressedState === true);
        if (this.pressedState === undefined) el.removeAttribute('aria-pressed');
        else el.setAttribute('aria-pressed', String(this.pressedState));
        if (this.iconOnly && this.label !== undefined) el.setAttribute('aria-label', this.label);
        else el.removeAttribute('aria-label');
    }
}

export function createButton(props: ButtonProps = {}): ButtonHandle {
    return new ButtonImpl(props);
}
