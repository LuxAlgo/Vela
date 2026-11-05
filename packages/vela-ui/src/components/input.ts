// Input: a one-line text input that commits on blur or Enter. `md` fills its parent and
// matches the settings dialogs' inputs; `sm` is a compact 100px field.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';

export type InputSize = 'sm' | 'md';

export interface InputControllerOptions {
    value?: string;
    /** The text it starts with when `value` is not given. */
    defaultValue?: string;
    size?: InputSize;
    fill?: boolean;
    disabled?: boolean;
    onChange?: (value: string) => void;
}

export interface InputController {
    value: string;
    size: InputSize;
    fill: boolean;
    disabled: boolean;
    commit(next: string): string | null;
    /** Write without emitting (external refresh). */
    sync(next: string): void;
}

/** The field's last committed string, without DOM. */
export function inputController(opts: InputControllerOptions = {}): InputController {
    let value = opts.value ?? opts.defaultValue ?? '';
    const size = opts.size ?? 'md';
    return {
        get value() {
            return value;
        },
        size,
        fill: opts.fill ?? size !== 'sm',
        disabled: opts.disabled ?? false,
        commit(next: string) {
            if (next === value) return null;
            value = next;
            opts.onChange?.(next);
            return next;
        },
        sync(next: string) {
            value = next;
        },
    };
}

export const inputDef = defineComponent({
    name: 'input',
    parts: ['root', 'control'],
    settings: { radius: t.radius.md, 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export const inputVariants = variants({ size: ['md', 'sm'] });

export type InputType = 'text' | 'search' | 'email' | 'password' | 'url' | 'tel';

export interface InputOptions extends InputControllerOptions {
    /** The kind of text it takes (default `text`). */
    type?: InputType;
    placeholder?: string;
    /** Submitted with its form under this name. */
    name?: string;
    required?: boolean;
    id?: string;
}

export type InputProps = InputOptions;

export const TEXT_STYLE_ID = 'vela-ui-text-2';

export const TEXT_CSS = css`
        @layer vela.ui {
            [data-slot='input-control'] {
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
                height: 34px;
                background: transparent;
                border: 1px solid ${t.border.strong};
                border-radius: ${inputDef.vars.radius};
                color: ${t.fg.bright};
                padding: 0 8px;
                font-size: 14px;
                font-family: inherit;
                outline: 2px solid transparent;
                overflow: hidden;
                text-overflow: ellipsis;
                transition:
                    border-color ${t.dur.fast} ease,
                    box-shadow ${t.dur.fast} ease;
                /* Selectable even under a user-select:none host (chart wrapper, .vela-ui). */
                user-select: text;
                -webkit-user-select: text;

                &:hover {
                    border-color: ${t.fg.muted};
                }
                &:focus {
                    border-color: ${t.focus};
                    box-shadow: ${inputDef.vars['focus-ring']};
                }
                &::placeholder {
                    color: currentColor;
                    opacity: 0.4;
                }
            }
            [data-slot='input'] {
                min-width: 0;

                &:where(:not([hidden])) {
                    display: inline-block;
                }
                &[data-fill] {
                    width: 100%;
                }
                &:not([data-fill]) {
                    width: 100px;
                    flex: none;
                    justify-self: start;
                }
                &[data-size='sm'] [data-slot='input-control'] {
                    height: 28px;
                    background: ${t.surface.elev};
                    border-radius: ${t.radius.sm};
                    color: ${t.fg};
                    font-size: 13px;
                }
            }
        }
    `;

const injectStyles = defineStyles(TEXT_STYLE_ID, TEXT_CSS);

export class Input {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;
    private readonly ctrl: InputController;

    constructor(opts: InputOptions = {}) {
        injectStyles(document);
        this.ctrl = inputController(opts);
        // `size = 1` drops the UA's ~20ch minimum, so a 100px (or filling) wrapper holds.
        const ti = h('input', { className: 'vela-text-field', slot: inputDef.slot('control'), attrs: { type: opts.type ?? 'text', size: 1, id: opts.id, placeholder: opts.placeholder, name: opts.name } });
        ti.required = opts.required === true;
        ti.value = this.ctrl.value;
        ti.disabled = this.ctrl.disabled;
        ti.addEventListener('blur', () => {
            this.ctrl.commit(ti.value);
        });
        ti.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                ti.blur();
            }
        });
        this.el = h('div', { className: 'vela-text', slot: inputDef.slot('root'), attrs: inputVariants({ size: this.ctrl.size }), data: { fill: this.ctrl.fill } }, ti);
        this.input = ti;
    }

    get value(): string {
        return this.ctrl.value;
    }

    setValue(v: string): void {
        this.ctrl.sync(v);
        this.input.value = v;
    }

    destroy(): void {}
}

export function createInput(props: InputProps = {}): Input {
    return new Input(props);
}
