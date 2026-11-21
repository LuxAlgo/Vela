// InputGroup: an input with addons inside its border: an icon, a short text or a button, at its
// start or end, or in a row above or below it (a search field with its magnifier, an amount
// with its unit). It reports every keystroke (`onValueChange`); its element is `input`, for a
// host's own keys. `md` matches Input; `sm` is the compact field.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { iconEl } from '../lib/icons';
import { t } from '../lib/t';
import { variants } from '../lib/variants';
import { createButton } from './button';

export type InputGroupSize = 'sm' | 'md';
export type InputGroupAlign = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';
export type InputGroupType = 'text' | 'search' | 'email' | 'password' | 'url' | 'tel';

export interface InputGroupAddon {
    /** Where it sits (default `inline-start`). */
    align?: InputGroupAlign;
    /** An icon from the kit's registry. */
    icon?: string;
    /** A short text: a unit, a prefix. */
    text?: string;
    /** A button: its accessible name, its icon or text, and what a press does. */
    button?: { label: string; icon?: string; text?: string; onClick: (e: MouseEvent) => void };
}

export const inputGroupDef = defineComponent({
    name: 'input-group',
    parts: ['root', 'control', 'addon', 'text'],
    settings: { radius: t.radius.md, height: '34px', 'height-sm': '28px', 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export const inputGroupVariants = variants({ size: ['md', 'sm'] });

export interface InputGroupProps {
    addons?: readonly InputGroupAddon[];
    type?: InputGroupType;
    value?: string;
    /** The text it starts with when `value` is not given. */
    defaultValue?: string;
    placeholder?: string;
    /** Submitted with its form under this name. */
    name?: string;
    required?: boolean;
    disabled?: boolean;
    /** The id of its input, so a `<label for>` reaches it. */
    id?: string;
    size?: InputGroupSize;
    /** Its accessible name, when no `<label>` names it. */
    label?: string;
    /** Called on every keystroke. */
    onValueChange?: (value: string) => void;
}

const injectStyles = defineStyles(
    'vela-ui-input-group',
    css`
        @layer vela.ui {
            [data-slot='input-group'] {
                --_h: ${inputGroupDef.vars.height};
                box-sizing: border-box;
                width: 100%;
                min-width: 0;
                align-items: center;
                border: 1px solid ${t.border.strong};
                border-radius: ${inputGroupDef.vars.radius};
                background: transparent;
                color: ${t.fg.bright};
                font-size: 14px;
                transition:
                    border-color ${t.dur.fast} ease,
                    box-shadow ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: flex;
                }
                &:hover {
                    border-color: ${t.fg.muted};
                }
                &:focus-within {
                    border-color: ${t.focus};
                    box-shadow: ${inputGroupDef.vars['focus-ring']};
                }
                &[data-size='sm'] {
                    --_h: ${inputGroupDef.vars['height-sm']};
                    background: ${t.surface.elev};
                    border-radius: ${t.radius.sm};
                    color: ${t.fg};
                    font-size: 13px;
                }
                &[data-block] {
                    flex-wrap: wrap;
                }
                &[data-disabled] {
                    opacity: 0.5;
                }
            }
            [data-slot='input-group-control'] {
                flex: 1 1 auto;
                min-width: 0;
                height: var(--_h);
                box-sizing: border-box;
                padding: 0 8px;
                border: 0;
                background: transparent;
                color: inherit;
                font: inherit;
                outline: 2px solid transparent;
                /* Selectable even under a user-select:none host (chart wrapper, .vela-ui). */
                user-select: text;
                -webkit-user-select: text;

                &::placeholder {
                    color: currentColor;
                    opacity: 0.4;
                }
            }
            [data-slot='input-group'][data-start] [data-slot='input-group-control'] {
                padding-inline-start: 6px;
            }
            [data-slot='input-group'][data-end] [data-slot='input-group-control'] {
                padding-inline-end: 4px;
            }
            [data-slot='input-group-addon'] {
                flex: none;
                align-items: center;
                gap: 4px;
                color: ${t.fg.muted};
                /* Icons are 1em. */
                font-size: 14px;

                &:where(:not([hidden])) {
                    display: inline-flex;
                }
                &[data-align='inline-start'] {
                    padding-inline-start: 8px;
                }
                &[data-align='inline-end'] {
                    padding-inline-end: 4px;
                }
                &[data-align='block-start'] {
                    flex-basis: 100%;
                    padding: 6px 8px 0;
                }
                &[data-align='block-end'] {
                    flex-basis: 100%;
                    padding: 0 8px 6px;
                }
            }
            [data-slot='input-group-text'] {
                font-size: 12px;
                white-space: nowrap;
            }
        }
    `,
);

export class InputGroup {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;

    constructor(props: InputGroupProps = {}) {
        injectStyles(document);
        const addons = props.addons ?? [];
        const alignOf = (a: InputGroupAddon): InputGroupAlign => a.align ?? 'inline-start';
        const addon = (a: InputGroupAddon): HTMLElement => {
            const el = h('div', { slot: inputGroupDef.slot('addon'), data: { align: alignOf(a) } });
            if (a.icon) el.append(iconEl(a.icon, document));
            if (a.text) el.append(h('span', { slot: inputGroupDef.slot('text'), text: a.text }));
            if (a.button) {
                const iconOnly = !!a.button.icon && !a.button.text;
                el.append(createButton({ variant: 'ghost', size: iconOnly ? 'icon-xs' : 'xs', icon: a.button.icon, text: a.button.text, label: a.button.label, onClick: a.button.onClick }).el);
            }
            return el;
        };
        const at = (align: InputGroupAlign): HTMLElement[] => addons.filter((a) => alignOf(a) === align).map(addon);
        // `size = 1` drops the UA's ~20ch minimum, so the group's width holds.
        this.input = h('input', { slot: inputGroupDef.slot('control'), attrs: { type: props.type ?? 'text', size: 1, id: props.id, placeholder: props.placeholder, name: props.name, 'aria-label': props.label } });
        this.input.value = props.value ?? props.defaultValue ?? '';
        this.input.required = props.required === true;
        this.input.disabled = props.disabled === true;
        this.input.addEventListener('input', () => props.onValueChange?.(this.input.value));
        this.el = h(
            'div',
            {
                className: 'vela-input-group',
                slot: inputGroupDef.slot('root'),
                attrs: inputGroupVariants({ size: props.size ?? 'md' }),
                data: {
                    block: addons.some((a) => alignOf(a).startsWith('block')),
                    start: addons.some((a) => alignOf(a) === 'inline-start'),
                    end: addons.some((a) => alignOf(a) === 'inline-end'),
                    disabled: props.disabled === true,
                },
            },
            ...at('block-start'),
            ...at('inline-start'),
            this.input,
            ...at('inline-end'),
            ...at('block-end'),
        );
        // A press on the group's padding or an addon's icon or text types into the input.
        this.el.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement;
            if (target === this.input || target.closest('button')) return;
            e.preventDefault();
            this.input.focus();
        });
    }

    get value(): string {
        return this.input.value;
    }

    setValue(v: string): void {
        this.input.value = v;
    }

    focus(): void {
        this.input.focus();
    }

    destroy(): void {}
}

export function createInputGroup(props: InputGroupProps = {}): InputGroup {
    return new InputGroup(props);
}
