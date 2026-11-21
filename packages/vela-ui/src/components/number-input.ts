// NumberInput: a typed number field with optional steppers that show on hover and repeat
// while pressed. `blur` commit clamps on commit (the indicator dialog); `live` emits on
// every keystroke (chart settings). `md` fills its parent; `sm` is a compact field. The
// spinbutton (ARIA, arrow keys, the steppers' repeat) is Zag's number-input machine; the
// commit rules stay the field's own.
import * as zagNumber from '@zag-js/number-input';
import { msg } from '../lib/i18n';
import { textOf } from '../lib/i18n';
import type { Translator } from '../lib/i18n';
import { iconEl } from '../lib/icons';
import { kitTranslator } from '../lib/kit-text';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { ownTeardown } from '../lib/dispose';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

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
    /** Submitted with its form under this name. */
    name?: string;
    required?: boolean;
    compact?: boolean;
    /** Stretch to the parent. Defaults to on for `md`, off for `sm`. Chart settings
     *  passes `false` so the field stays a 100px kit column instead of filling the pane. */
    fill?: boolean;
    /** The translator of the steppers' names (default: the kit build's, else English). */
    i18n?: Translator | null;
}

export type NumberInputProps = NumberInputOptions;

export const NUMBER_STYLE_ID = 'vela-ui-number-3';

/** How the field shows a number: no grouping, every decimal (what the machine formats too). */
const PLAIN = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 20 });

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
    private readonly placeholderMode: boolean;
    private readonly emptyValue: number;
    private readonly i18n: Translator | null;
    private readonly machine: HandleOf<typeof zagNumber.machine>;
    private readonly mid: string;
    private readonly release: () => void;
    /** The user is typing a value the field commits on blur: the machine's reports of it
     *  are not commits. */
    private typing = false;

    constructor(opts: NumberInputOptions) {
        injectStyles(document);
        this.i18n = opts.i18n ?? kitTranslator();
        this.ctrl = numberInputController(opts);
        this.placeholderMode = opts.placeholder !== undefined;
        this.emptyValue = opts.emptyValue ?? opts.value;
        this.mid = nextUid('vela-number-input');

        const ni = h('input', { slot: numberInputDef.slot('input'), attrs: { title: opts.title } });
        if (this.placeholderMode) ni.placeholder = opts.placeholder ?? '';
        this.input = ni;

        // The field's own rules commit at once, reading what the field holds; they listen
        // before the machine does, so its handlers see the committed value.
        const commitRaw = (raw: number): void => {
            this.typing = false;
            const n = this.ctrl.apply(raw);
            this.show(n === null ? this.ctrl.value : n);
        };
        ni.addEventListener('input', () => {
            if (this.ctrl.commit === 'live' && !this.placeholderMode) {
                const v = Number(ni.value);
                if (ni.value.trim() !== '' && Number.isFinite(v)) this.ctrl.apply(v);
            } else this.typing = true;
        });
        if (this.placeholderMode) {
            ni.addEventListener('change', () => {
                const raw = ni.value.trim() === '' ? this.emptyValue : Number(ni.value);
                commitRaw(Number.isFinite(raw) ? raw : this.emptyValue);
            });
        } else if (this.ctrl.commit !== 'live') {
            ni.addEventListener('blur', () => commitRaw(Number(ni.value)));
            ni.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    ni.blur();
                }
            });
        }
        // An arrow key steps the value: what the user typed so far is no longer pending.
        ni.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') this.typing = false;
        });

        const steppers = this.ctrl.steppers ? this.buildSteppers(document) : null;
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

        const clamp = this.ctrl.clamp;
        this.machine = runMachine(
            zagNumber.machine,
            {
                id: this.mid,
                ...(opts.id ? { ids: { input: opts.id } } : {}),
                defaultValue: this.placeholderMode && opts.value === this.emptyValue ? '' : String(opts.value),
                step: this.ctrl.step,
                ...(clamp && this.ctrl.min !== undefined ? { min: this.ctrl.min } : {}),
                ...(clamp && this.ctrl.max !== undefined ? { max: this.ctrl.max } : {}),
                clampValueOnBlur: clamp,
                allowOverflow: !clamp,
                disabled: this.ctrl.disabled,
                ...(opts.name !== undefined ? { name: opts.name } : {}),
                ...(opts.required !== undefined ? { required: opts.required } : {}),
                // Plain numbers, as the field has always shown them: no grouping, every decimal.
                locale: 'en-US',
                formatOptions: { useGrouping: false, maximumFractionDigits: 20 },
                // A press on a stepper keeps the focus where it is, and repeats while held.
                focusInputOnChange: false,
                spinOnPress: true,
                translations: { incrementLabel: textOf(this.i18n, TEXT.increase), decrementLabel: textOf(this.i18n, TEXT.decrease) },
                // The steppers' and the arrow keys' steps arrive here, a beat after the press.
                onValueChange: ({ valueAsNumber }) => {
                    if (this.typing || !Number.isFinite(valueAsNumber) || valueAsNumber === this.ctrl.value) return;
                    commitRaw(valueAsNumber);
                },
            },
            (service) => this.render(service),
        );
        this.release = ownTeardown(this.el, () => this.machine.stop());
    }

    get value(): number {
        return this.ctrl.value;
    }

    setValue(v: number): void {
        this.typing = false;
        this.show(this.ctrl.sync(v));
    }

    destroy(): void {
        this.release();
    }

    /** Show `n` in the field: through the machine, so its next render keeps it. */
    private show(n: number): void {
        const api = zagNumber.connect(this.machine.service, normalizeProps);
        if (this.placeholderMode && n === this.emptyValue) {
            if (!api.empty) api.clearValue();
            this.input.value = '';
        } else {
            if (api.valueAsNumber !== n) api.setValue(n);
            this.input.value = PLAIN.format(n);
        }
    }

    private render(service: zagNumber.Service): void {
        const api = zagNumber.connect(service, normalizeProps);
        spreadProps(this.el, api.getRootProps(), this.mid);
        spreadProps(this.input, api.getInputProps(), this.mid);
        if (this.up) spreadProps(this.up, api.getIncrementTriggerProps(), this.mid);
        if (this.down) spreadProps(this.down, api.getDecrementTriggerProps(), this.mid);
    }

    private up: HTMLButtonElement | null = null;
    private down: HTMLButtonElement | null = null;

    private buildSteppers(doc: Document): HTMLElement {
        const mk = (icon: string): HTMLButtonElement => {
            const b = h('button', { slot: numberInputDef.slot('step'), attrs: { type: 'button', tabindex: -1 } }, iconEl(icon, doc));
            // The press belongs to the field: an open popover or dialog must not read it as a
            // press outside.
            b.addEventListener('pointerdown', (e) => e.stopPropagation());
            return b;
        };
        this.up = mk('chevron-up');
        this.down = mk('chevron-down');
        return h('div', { className: 'vela-num-step', slot: numberInputDef.slot('steps') }, this.up, this.down);
    }
}

export function createNumberInput(props: NumberInputProps): NumberInput {
    return new NumberInput(props);
}
