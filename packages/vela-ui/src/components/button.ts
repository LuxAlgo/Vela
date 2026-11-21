// Button: a <button> with optional icons and key caps before and after its text (`↵ Open`,
// `Esc Close` in a picker's footer). `default` is filled with the selection color (OK, Apply),
// `outline` bordered (the dialogs' Cancel), `secondary` a sunken fill, `ghost` bare until
// hovered (toolbar and header icons), `destructive` tinted with the danger color, `link` text
// that underlines on hover, `up` and `down` filled with the market's colors (buy and sell),
// `favorite` a bare star whose pressed state takes the favorites color. Heights: `xs` 26px,
// `sm` 30px (panels), `default` 34px (dialog footers), `lg` 40px (touch); the `icon*` sizes
// are the same heights, square, for an icon alone, which `label` names. A toggle button
// (`pressed`, `defaultPressed` or `onPressedChange`) says its state through `aria-pressed`;
// uncontrolled it flips on a press, given `pressed` it only asks, until `setPressed` moves it.
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';
import { createKbd } from './kbd';

export const buttonDef = defineComponent({
    name: 'button',
    parts: ['root', 'icon', 'keys'],
    settings: {
        radius: t.radius.md,
        height: '34px',
        'height-xs': '26px',
        'height-sm': '30px',
        'height-lg': '40px',
        'font-size': '14px',
        'font-size-xs': '12px',
        'font-size-sm': '13px',
    },
});

export const buttonVariants = variants({
    variant: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link', 'up', 'down', 'favorite'],
    size: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
});

export type ButtonVariant = (typeof buttonVariants.spec.variant)[number];
export type ButtonSize = (typeof buttonVariants.spec.size)[number];

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
    /** The visible text (the `icon*` sizes show none; `label` names them). */
    text?: string;
    /** Icon id from the kit's registry, before the text (the icon of an `icon*` size).
     *  `favorite` defaults to `star`. */
    icon?: string;
    /** The icon while pressed (`star-filled` for `star`). `favorite` defaults to `star-filled`. */
    iconPressed?: string;
    /** Icon id after the text (a menu trigger's chevron). */
    iconEnd?: string;
    /** Key caps before the text, one per key (`['↑', '↓']`). */
    keys?: readonly string[];
    /** Key caps after the text. */
    keysEnd?: readonly string[];
    /** Accessible name; required for the `icon*` sizes, defaults to `text`. */
    label?: string;
    /** A controlled toggle's state (`aria-pressed`): a press only calls `onPressedChange`, and
     *  `setPressed` moves it. Omitted with `defaultPressed` and `onPressedChange`: not a toggle. */
    pressed?: boolean;
    /** An uncontrolled toggle's first state: a press flips it and calls `onPressedChange`. */
    defaultPressed?: boolean;
    /** A press asked for this state (a toggle without `pressed` or `defaultPressed` starts
     *  unpressed). */
    onPressedChange?: (pressed: boolean) => void;
    disabled?: boolean;
    onClick?: (e: MouseEvent) => void;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ButtonHandle {
    readonly el: HTMLButtonElement;
    readonly pressed: boolean | undefined;
    /** Show a toggle's state, without calling `onPressedChange`. */
    setPressed(pressed: boolean): void;
    setDisabled(disabled: boolean): void;
    /** New text (or, for an `icon*` size, a new accessible name). */
    setText(text: string): void;
    destroy(): void;
}

export const BUTTON_STYLE_ID = 'vela-ui-button';

export const BUTTON_CSS = css`
        @layer vela.ui {
            [data-slot='button'] {
                cursor: pointer;
                height: ${buttonDef.vars.height};
                padding: 0 11px;
                border-radius: ${buttonDef.vars.radius};
                border: 1px solid ${t.border.strong};
                background: transparent;
                color: ${t.fg};
                font-weight: 400;
                font-size: ${buttonDef.vars['font-size']};
                font-family: inherit;
                white-space: nowrap;
                transition:
                    background ${t.dur.fast} ease,
                    color ${t.dur.fast} ease,
                    opacity ${t.dur.fast} ease,
                    border-color ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }
                /* Icons draw at 1em: one size for every button size but the smallest. The slot
                   is sized too, so an icon registered without width and height fills it. */
                & > [data-icon] {
                    font-size: 16px;
                    width: 1em;
                    height: 1em;
                    flex: none;

                    & > svg {
                        width: 100%;
                        height: 100%;
                    }
                }
                &[data-size='xs'] > [data-icon],
                &[data-size='icon-xs'] > [data-icon] {
                    font-size: 12px;
                }
                & > [data-keys] {
                    flex: none;
                    gap: 2px;
                }
                & > [data-keys]:where(:not([hidden])) {
                    display: inline-flex;
                }
                /* A key cap's own colors vanish on a fill that matches them (the solid
                   variants): inside a button it takes the button's text and draws only its outline. */
                & > [data-keys] > [data-slot='kbd'] {
                    border-color: ${t.border};
                    background: transparent;
                    color: inherit;
                    box-shadow: none;
                }
                &[data-size='sm'],
                &[data-size='icon-sm'] {
                    height: ${buttonDef.vars['height-sm']};
                    font-size: ${buttonDef.vars['font-size-sm']};
                }
                &[data-size='xs'],
                &[data-size='icon-xs'] {
                    height: ${buttonDef.vars['height-xs']};
                    padding: 0 8px;
                    font-size: ${buttonDef.vars['font-size-xs']};
                    border-radius: ${t.radius.sm};
                }
                &[data-size='lg'],
                &[data-size='icon-lg'] {
                    height: ${buttonDef.vars['height-lg']};
                    padding: 0 14px;
                }
                &[data-size='icon'] {
                    width: ${buttonDef.vars.height};
                    padding: 0;
                }
                &[data-size='icon-sm'] {
                    width: ${buttonDef.vars['height-sm']};
                    padding: 0;
                }
                &[data-size='icon-xs'] {
                    width: ${buttonDef.vars['height-xs']};
                    padding: 0;
                }
                &[data-size='icon-lg'] {
                    width: ${buttonDef.vars['height-lg']};
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
                &[data-variant='up'],
                &[data-variant='up']:not(:disabled):hover {
                    border-color: transparent;
                    background: ${t.up};
                    color: ${t.fg.onFill};
                }
                &[data-variant='down'],
                &[data-variant='down']:not(:disabled):hover {
                    border-color: transparent;
                    background: ${t.down};
                    color: ${t.fg.onFill};
                }
                &[data-variant='up']:not(:disabled):hover,
                &[data-variant='down']:not(:disabled):hover {
                    opacity: 0.88;
                }
                &[data-pressed] {
                    background: ${t.active};
                    color: ${t.fg.bright};
                }
                &[data-variant='favorite'] {
                    border-color: transparent;
                    color: ${t.fg.muted};
                }
                &[data-variant='favorite']:not(:disabled):hover {
                    border-color: transparent;
                }
                &[data-variant='favorite'][data-pressed] {
                    background: transparent;
                    color: ${t.highlight};
                }
                &[data-variant='favorite'][data-pressed]:where(:not(:disabled)):hover {
                    background: ${t.hover};
                    color: ${t.highlight};
                }
            }
        }
    `;

const injectStyles = defineStyles(BUTTON_STYLE_ID, BUTTON_CSS);

const iconPart = (id: string, side: 'inline-start' | 'inline-end'): HTMLElement => {
    const el = iconEl(id, document);
    el.dataset.slot = buttonDef.slot('icon');
    el.dataset.icon = side;
    return el;
};

const keysPart = (keys: readonly string[] | undefined, side: 'inline-start' | 'inline-end'): HTMLElement | null =>
    keys?.length ? h('span', { slot: buttonDef.slot('keys'), data: { keys: side } }, ...keys.map((key) => createKbd({ text: key }).el)) : null;

class ButtonImpl implements ButtonHandle {
    readonly el: HTMLButtonElement;
    private readonly iconOnly: boolean;
    private readonly textNode: Text | null;
    private readonly toggle: boolean;
    private readonly controlled: boolean;
    private readonly icon: string | undefined;
    private readonly iconPressed: string | undefined;
    private iconStart: HTMLElement | null;
    private shownIcon: string | undefined;
    private label: string | undefined;
    private pressedState: boolean | undefined;

    constructor(props: ButtonProps) {
        injectStyles(document);
        const { variant, size } = buttonVariants.resolve(props);
        const favorite = variant === 'favorite';
        this.iconOnly = size.startsWith('icon');
        this.label = props.label ?? props.text;
        this.controlled = props.pressed !== undefined;
        this.toggle = this.controlled || props.defaultPressed !== undefined || props.onPressedChange !== undefined;
        this.pressedState = props.pressed ?? props.defaultPressed ?? (this.toggle ? false : undefined);
        this.icon = props.icon ?? (favorite ? 'star' : undefined);
        this.iconPressed = props.iconPressed ?? (favorite ? 'star-filled' : undefined);
        this.iconStart = this.icon ? iconPart(this.icon, 'inline-start') : null;
        this.shownIcon = this.icon;
        this.textNode = !this.iconOnly && props.text !== undefined ? document.createTextNode(props.text) : null;
        const onClick = (e: MouseEvent): void => {
            if (this.toggle) {
                const next = !this.pressedState;
                if (!this.controlled) this.setPressed(next);
                props.onPressedChange?.(next);
            }
            props.onClick?.(e);
        };
        this.el = h(
            'button',
            {
                className: props.className ? `vela-btn ${props.className}` : 'vela-btn',
                slot: buttonDef.slot('root'),
                attrs: { type: 'button', ...buttonVariants({ variant, size }) },
                on: this.toggle || props.onClick ? { click: onClick } : undefined,
            },
            this.iconStart,
            this.iconOnly ? null : keysPart(props.keys, 'inline-start'),
            this.textNode,
            this.iconOnly ? null : keysPart(props.keysEnd, 'inline-end'),
            props.iconEnd && !this.iconOnly ? iconPart(props.iconEnd, 'inline-end') : null,
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
        if (this.iconStart && this.iconPressed) {
            const icon = this.pressedState ? this.iconPressed : this.icon!;
            if (icon !== this.shownIcon) {
                const next = iconPart(icon, 'inline-start');
                this.iconStart.replaceWith(next);
                this.iconStart = next;
                this.shownIcon = icon;
            }
        }
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
