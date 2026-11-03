// NumberInput: a typed number field with optional steppers that show on hover and repeat
// while pressed. `blur` commit clamps on commit (the indicator dialog); `live` emits on
// every keystroke (chart settings). `md` fills its parent; `sm` is a compact field.
import { msg } from '../../core/i18n/message';
import { textOf } from '../../core/i18n/text';
import type { Translator } from '../../core/i18n/types';
import { iconEl } from '../icons';
import { kitTranslator } from '../kit-text';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';

export type NumberSize = 'sm' | 'md';
export type NumberCommit = 'blur' | 'live';

export interface NumberInputControllerOptions {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    size?: NumberSize;
    /** `blur` clamps on commit (indicator dialog). `live` emits on every keystroke
     *  (chart settings). Steppers default on for `blur`; pass `steppers: true` to
     *  keep them with live commit. */
    commit?: NumberCommit;
    steppers?: boolean;
    clamp?: boolean;
    disabled?: boolean;
    onChange?: (value: number) => void;
}

export function clampNumber(n: number, opts: { min?: number; max?: number; integer?: boolean }): number {
    let v = n;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    if (opts.integer) v = Math.round(v);
    return v;
}

function decimalsOf(n: number): number {
    const s = String(n);
    const e = s.search(/[eE]/);
    if (e >= 0) {
        const frac = s.slice(0, e).split('.')[1]?.length ?? 0;
        return Math.max(0, Math.min(20, frac - Number(s.slice(e + 1))));
    }
    return s.split('.')[1]?.length ?? 0;
}

/** Trim binary-float noise after stepper arithmetic (`1.7 + 0.1` → `1.8`, not
 *  `1.7999999999999998`): round to the decimals the base value and step imply. */
export function snapToStep(n: number, base: number, step: number): number {
    const d = Math.min(20, Math.max(decimalsOf(base), decimalsOf(step)));
    return Number(n.toFixed(d));
}

export interface NumberInputController {
    value: number;
    min?: number;
    max?: number;
    step: number;
    integer: boolean;
    size: NumberSize;
    commit: NumberCommit;
    steppers: boolean;
    clamp: boolean;
    disabled: boolean;
    apply(raw: number): number | null;
    /** Write the displayed value without emitting (vela-sync / external refresh). */
    sync(raw: number): number;
    nudge(dir: 1 | -1): number | null;
}

/** The field's clamping, rounding and commit rules, without DOM. */
export function numberInputController(opts: NumberInputControllerOptions): NumberInputController {
    let value = opts.value;
    const integer = opts.integer ?? false;
    const commit = opts.commit ?? 'blur';
    const clamp = opts.clamp ?? commit === 'blur';
    const step = opts.step ?? (integer ? 1 : 0.1);
    const onChange = opts.onChange;
    const normalize = (raw: number): number => (clamp ? clampNumber(raw, { min: opts.min, max: opts.max, integer }) : raw);
    const apply = (raw: number): number | null => {
        if (!Number.isFinite(raw)) return null;
        const n = normalize(raw);
        if (n !== value) {
            value = n;
            onChange?.(n);
        }
        return n;
    };
    return {
        get value() {
            return value;
        },
        min: opts.min,
        max: opts.max,
        step,
        integer,
        size: opts.size ?? 'md',
        commit,
        steppers: opts.steppers ?? commit === 'blur',
        clamp,
        disabled: opts.disabled ?? false,
        apply,
        sync(raw: number) {
            const n = Number.isFinite(raw) ? normalize(raw) : value;
            value = n;
            return n;
        },
        nudge(dir) {
            return apply(snapToStep(value + dir * step, value, step));
        },
    };
}

export const numberInputDef = defineComponent({
    name: 'number-input',
    parts: ['root', 'input', 'steps', 'step'],
    settings: { radius: t.radius.md, 'step-radius': '3px', 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export const numberInputVariants = variants({ size: ['md', 'sm'] });

const TEXT = {
    increase: msg('ui.numberInput.increase', 'Increase'),
    decrease: msg('ui.numberInput.decrease', 'Decrease'),
};

export interface NumberInputOptions extends NumberInputControllerOptions {
    id?: string;
    title?: string;
    /** Chart-settings placeholder mode: empty field means `emptyValue` (the default). */
    placeholder?: string;
    emptyValue?: number;
    compact?: boolean;
    /** Stretch to the parent. Defaults to on for `md`, off for `sm`. Chart settings
     *  passes `false` so the field stays a 100px kit column instead of filling the pane. */
    fill?: boolean;
    /** The translator of the steppers' names (default: the kit build's, else English). */
    i18n?: Translator | null;
}

export type NumberInputProps = NumberInputOptions;

export const NUMBER_STYLE_ID = 'vela-ui-number-3';

export const NUMBER_CSS = css`
    @layer vela.ui {
        [data-slot='number-input-input'] {
            width: 100%;
            box-sizing: border-box;
            height: 34px;
            background: transparent;
            border: 1px solid ${t.border.strong};
            border-radius: ${numberInputDef.vars.radius};
            color: ${t.fg.bright};
            padding: 0 8px;
            font-size: 14px;
            font-family: inherit;
            outline: 2px solid transparent;
            transition:
                border-color ${t.dur.fast} ease,
                box-shadow ${t.dur.fast} ease;
            -moz-appearance: textfield;
            appearance: textfield;
            /* Selectable even under a user-select:none host (chart wrapper, .vela-ui). */
            user-select: text;
            -webkit-user-select: text;

            &::-webkit-inner-spin-button,
            &::-webkit-outer-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            &:hover {
                border-color: ${t.fg.muted};
            }
            &:focus {
                border-color: ${t.focus};
                box-shadow: ${numberInputDef.vars['focus-ring']};
            }
        }
        [data-slot='number-input-steps'] {
            position: absolute;
            inset-inline-end: 0;
            top: 0;
            bottom: 0;
            width: 22px;
            display: none;
            flex-direction: column;
            justify-content: center;
            box-sizing: border-box;
            padding-block: 2px;
            padding-inline: 0 6px;
            line-height: 0;
        }
        [data-slot='number-input-step'] {
            flex: 1;
            width: 100%;
            min-height: 0;
            border: none;
            background: transparent;
            color: ${t.fg.muted};
            border-radius: ${numberInputDef.vars['step-radius']};
            padding: 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;

            &:hover {
                background: ${t.hover};
                color: ${t.fg.bright};
            }
            & > span,
            & svg {
                width: 12px;
                height: 12px;
                display: block;
            }
        }
        [data-slot='number-input'] {
            position: relative;
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
            &:not([data-fill])[data-compact] {
                width: 80px;
            }
            &[data-size='sm'] {
                width: 64px;
                flex: none;
            }
            &[data-size='sm'][data-compact] {
                width: 56px;
            }
            &[data-size='sm'] [data-slot='number-input-input'] {
                height: 28px;
                background: ${t.surface.elev};
                border-radius: ${t.radius.sm};
                color: ${t.fg};
                font-size: 13px;
                box-shadow: none;
            }
            &[data-size='sm'] [data-slot='number-input-input']:focus {
                box-shadow: none;
            }
            /* The stepper gutter exists only while the steppers do (hover): an idle field
               keeps its full width, so long values aren't cut under an invisible arrow column. */
            &[data-steppers]:hover [data-slot='number-input-input'] {
                padding-inline-end: 26px;
            }
            &[data-steppers]:hover [data-slot='number-input-steps'] {
                display: flex;
            }
        }
    }
`;

const injectStyles = defineStyles(NUMBER_STYLE_ID, NUMBER_CSS);

export class NumberInput {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;
    private readonly ctrl: NumberInputController;
    private last: string;
    private readonly placeholderMode: boolean;
    private readonly emptyValue: number;
    private readonly i18n: Translator | null;

    constructor(opts: NumberInputOptions) {
        injectStyles(document);
        this.i18n = opts.i18n ?? kitTranslator();
        this.ctrl = numberInputController(opts);
        this.placeholderMode = opts.placeholder !== undefined;
        this.emptyValue = opts.emptyValue ?? opts.value;
        this.last = String(opts.value);

        const ni = h('input', {
            slot: numberInputDef.slot('input'),
            attrs: {
                type: 'number',
                id: opts.id,
                title: opts.title,
                min: opts.min !== undefined ? String(opts.min) : undefined,
                max: opts.max !== undefined ? String(opts.max) : undefined,
                step: String(this.ctrl.step),
            },
        });
        ni.disabled = this.ctrl.disabled;
        if (this.placeholderMode) {
            ni.placeholder = opts.placeholder ?? '';
            ni.value = opts.value !== this.emptyValue ? String(opts.value) : '';
        } else {
            ni.value = String(opts.value);
        }

        const commitRaw = (raw: number): void => {
            const n = this.ctrl.apply(raw);
            if (n === null) {
                ni.value = this.placeholderMode && this.ctrl.value === this.emptyValue ? '' : this.last;
                return;
            }
            this.last = String(n);
            if (this.placeholderMode && n === this.emptyValue) ni.value = '';
            else ni.value = String(n);
        };

        if (this.placeholderMode) {
            ni.addEventListener('change', () => {
                const raw = ni.value.trim() === '' ? this.emptyValue : Number(ni.value);
                commitRaw(Number.isFinite(raw) ? raw : this.emptyValue);
            });
        } else if (this.ctrl.commit === 'live') {
            ni.addEventListener('input', () => {
                const v = Number(ni.value);
                if (Number.isFinite(v)) this.ctrl.apply(v);
            });
        } else {
            ni.addEventListener('blur', () => commitRaw(Number(ni.value)));
            ni.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    ni.blur();
                }
            });
        }

        const steppers = this.ctrl.steppers
            ? this.buildSteppers(document, (dir) => {
                  const cur = Number(ni.value);
                  const base = Number.isFinite(cur) ? cur : this.ctrl.value;
                  commitRaw(snapToStep(base + dir * this.ctrl.step, base, this.ctrl.step));
              })
            : null;
        this.el = h(
            'div',
            {
                className: 'vela-num',
                slot: numberInputDef.slot('root'),
                attrs: numberInputVariants({ size: this.ctrl.size }),
                data: { fill: opts.fill ?? this.ctrl.size !== 'sm', compact: opts.compact === true, steppers: this.ctrl.steppers },
            },
            ni,
            steppers,
        );
        this.input = ni;
    }

    get value(): number {
        return this.ctrl.value;
    }

    setValue(v: number): void {
        const n = this.ctrl.sync(v);
        this.last = String(n);
        if (this.placeholderMode && n === this.emptyValue) this.input.value = '';
        else this.input.value = String(n);
    }

    destroy(): void {}

    private buildSteppers(doc: Document, applyDir: (dir: 1 | -1) => void): HTMLElement {
        const mk = (dir: 1 | -1, icon: string, label: string): HTMLButtonElement => {
            const b = h('button', { slot: numberInputDef.slot('step'), attrs: { type: 'button', tabindex: -1, 'aria-label': label } }, iconEl(icon, doc));
            let timer = 0;
            const apply = (): void => applyDir(dir);
            const stop = (): void => {
                if (timer) {
                    window.clearTimeout(timer);
                    timer = 0;
                }
            };
            b.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                apply();
                timer = window.setTimeout(function tick() {
                    apply();
                    timer = window.setTimeout(tick, 60);
                }, 400);
            });
            b.addEventListener('pointerup', stop);
            b.addEventListener('pointerleave', stop);
            b.addEventListener('pointercancel', stop);
            return b;
        };
        return h('div', { className: 'vela-num-step', slot: numberInputDef.slot('steps') }, mk(1, 'chevron-up', textOf(this.i18n, TEXT.increase)), mk(-1, 'chevron-down', textOf(this.i18n, TEXT.decrease)));
    }
}

export function createNumberInput(props: NumberInputProps): NumberInput {
    return new NumberInput(props);
}
