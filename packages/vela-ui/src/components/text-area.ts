// TextArea: a multi-line text input that commits on blur, and can grow with its content up to
// a number of lines before it scrolls.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';

export type TextAreaSize = 'sm' | 'md';

export interface TextAreaControllerOptions {
    value?: string;
    /** The text it starts with when `value` is not given. */
    defaultValue?: string;
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

/** The text area's last committed string, without DOM. */
export function textAreaController(opts: TextAreaControllerOptions = {}): TextAreaController {
    let value = opts.value ?? opts.defaultValue ?? '';
    return {
        get value() {
            return value;
        },
        size: opts.size ?? 'md',
        rows: opts.rows ?? 3,
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

export const textAreaDef = defineComponent({
    name: 'text-area',
    parts: ['root', 'input'],
    settings: { radius: t.radius.md, 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export const textAreaVariants = variants({ size: ['md', 'sm'] });

export interface TextAreaOptions extends TextAreaControllerOptions {
    /** Submitted with its form under this name. */
    name?: string;
    required?: boolean;
    id?: string;
    placeholder?: string;
    /** Grow with content up to `maxLines`, then scroll. */
    autoGrow?: boolean;
    maxLines?: number;
}

export type TextAreaProps = TextAreaOptions;

const injectStyles = defineStyles(
    'vela-ui-textarea',
    css`
        @layer vela.ui {
            [data-slot='text-area-input'] {
                display: block;
                width: 100%;
                box-sizing: border-box;
                min-height: 64px;
                background: transparent;
                border: 1px solid ${t.border.strong};
                border-radius: ${textAreaDef.vars.radius};
                color: ${t.fg.bright};
                padding: 8px;
                font-size: 14px;
                font-family: inherit;
                line-height: 1.4;
                resize: vertical;
                outline: 2px solid transparent;
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
                    box-shadow: ${textAreaDef.vars['focus-ring']};
                }
                &::placeholder {
                    color: currentColor;
                    opacity: 0.4;
                }
            }
            [data-slot='text-area'] {
                width: 100%;
                min-width: 0;

                &:where(:not([hidden])) {
                    display: block;
                }
                &[data-autogrow] [data-slot='text-area-input'] {
                    resize: none;
                    overflow-y: hidden;
                    min-height: 46px;
                }
                &[data-size='sm'] [data-slot='text-area-input'] {
                    font-size: 13px;
                    min-height: 46px;
                    padding: 6px 9px;
                    line-height: 18px;
                }
            }
        }
    `,
);

export class TextArea {
    readonly el: HTMLElement;
    readonly input: HTMLTextAreaElement;
    private readonly ctrl: TextAreaController;
    private readonly autoGrow: boolean;
    private readonly maxLines: number;

    constructor(opts: TextAreaOptions = {}) {
        injectStyles(document);
        this.ctrl = textAreaController(opts);
        this.autoGrow = opts.autoGrow === true;
        this.maxLines = opts.maxLines ?? 4;

        const ta = h('textarea', { className: 'vela-textarea-field', slot: textAreaDef.slot('input'), attrs: { id: opts.id, placeholder: opts.placeholder, name: opts.name } });
        ta.required = opts.required === true;
        ta.rows = this.ctrl.rows;
        ta.value = this.ctrl.value;
        ta.disabled = this.ctrl.disabled;
        ta.addEventListener('blur', () => {
            this.ctrl.commit(ta.value);
        });
        if (this.autoGrow) ta.addEventListener('input', () => this.grow());
        this.el = h('div', { className: 'vela-textarea', slot: textAreaDef.slot('root'), attrs: textAreaVariants({ size: this.ctrl.size }), data: { autogrow: this.autoGrow } }, ta);
        this.input = ta;
        if (this.autoGrow) this.grow();
    }

    get value(): string {
        return this.ctrl.value;
    }

    setValue(v: string): void {
        this.ctrl.sync(v);
        this.input.value = v;
        if (this.autoGrow) this.grow();
    }

    destroy(): void {}

    private grow(): void {
        const ta = this.input;
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
        const pad = ta.clientHeight - (ta.offsetHeight ? lh * (ta.rows || 1) : 0);
        const max = lh * this.maxLines + (Number.isFinite(pad) && pad > 0 ? pad : 12);
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
        ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
    }
}

export function createTextArea(props: TextAreaProps = {}): TextArea {
    return new TextArea(props);
}
