// Checkbox: a square check toggle, filled with a check mark when on. `bright` fills with the
// bright foreground (the settings dialogs), `selected` with the selection color. Behavior,
// keyboard and ARIA come from Zag's switch machine: a label holding a hidden checkbox.
import * as zagSwitch from '@zag-js/switch';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

export type CheckboxSize = 'sm' | 'md';
/** `bright` = settings-dialog fill (`--vela-fg-bright`); `selected` = `--vela-selected-bg`. */
export type CheckboxTone = 'bright' | 'selected';

export interface CheckboxControllerOptions {
    checked?: boolean;
    /** The state it starts in when `checked` is not given. */
    defaultChecked?: boolean;
    disabled?: boolean;
    size?: CheckboxSize;
    tone?: CheckboxTone;
    /** Called when the user toggles it. */
    onCheckedChange?: (checked: boolean) => void;
    /** @deprecated Use `onCheckedChange`. */
    onChange?: (checked: boolean) => void;
}

export interface CheckboxController {
    checked: boolean;
    disabled: boolean;
    size: CheckboxSize;
    tone: CheckboxTone;
    setChecked(v: boolean): void;
    toggle(): boolean;
}

/** The switch's state without DOM: checked, and the option mapping. */
export function checkboxController(opts: CheckboxControllerOptions = {}): CheckboxController {
    let checked = opts.checked ?? opts.defaultChecked ?? false;
    const disabled = opts.disabled ?? false;
    return {
        get checked() {
            return checked;
        },
        disabled,
        size: opts.size ?? 'md',
        tone: opts.tone ?? 'bright',
        setChecked(v: boolean) {
            checked = v;
        },
        toggle() {
            if (disabled) return checked;
            checked = !checked;
            opts.onCheckedChange?.(checked);
            opts.onChange?.(checked);
            return checked;
        },
    };
}

export const checkboxDef = defineComponent({
    name: 'checkbox',
    parts: ['root', 'icon'],
    settings: { radius: '5px' },
});

export const checkboxVariants = variants({ size: ['md', 'sm'], tone: ['bright', 'selected'] });

export interface CheckboxOptions extends CheckboxControllerOptions {
    id?: string;
    /** Submitted with its form under this name (`on` when checked). */
    name?: string;
    /** A form does not submit while it is off. */
    required?: boolean;
}

export type CheckboxProps = CheckboxOptions;

const injectStyles = defineStyles(
    'vela-ui-checkbox',
    css`
        @layer vela.ui {
            [data-slot='checkbox'] {
                width: 20px;
                height: 20px;
                flex: 0 0 auto;
                align-items: center;
                justify-content: center;
                padding: 0;
                border: 1px solid ${t.border};
                border-radius: ${checkboxDef.vars.radius};
                background: transparent;
                color: transparent;
                cursor: pointer;
                line-height: 0;
                transition:
                    background ${t.dur.fast} ease,
                    border-color ${t.dur.fast} ease,
                    color ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: inline-flex;
                }
                & [data-slot='checkbox-icon'],
                & svg {
                    display: block;
                    width: 12px;
                    height: 12px;
                }
                &[data-size='sm'] [data-slot='checkbox-icon'],
                &[data-size='sm'] svg {
                    width: 11px;
                    height: 11px;
                }
                &:hover {
                    border-color: ${t.fg.muted};
                }
                &[data-focus-visible] {
                    outline: 2px solid ${t.focus};
                    outline-offset: 1px;
                }
                &[data-state='checked'] {
                    background: ${t.fg.bright};
                    border-color: ${t.fg.bright};
                    color: ${t.bg};
                }
                &[data-size='sm'] {
                    width: 18px;
                    height: 18px;
                    border-color: ${t.border.strong};
                }
                &[data-size='sm']:hover {
                    border-color: ${t.fg.muted};
                }
                &[data-size='sm'][data-state='checked'] {
                    background: ${t.selected.bg};
                    border-color: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[data-tone='selected'][data-state='checked'] {
                    background: ${t.selected.bg};
                    border-color: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[data-disabled] {
                    opacity: 0.4;
                    cursor: default;
                }
            }
        }
    `,
);

export class Checkbox {
    readonly el: HTMLLabelElement;
    private readonly input: HTMLInputElement;
    private readonly machine: HandleOf<typeof zagSwitch.machine>;
    private readonly mid: string;
    /** The state as the switch's users see it, at once: the machine settles a beat later. */
    private current: boolean;

    constructor(opts: CheckboxOptions = {}) {
        injectStyles(document);
        this.mid = nextUid('vela-checkbox');
        this.current = opts.checked ?? opts.defaultChecked ?? false;
        const icon = iconEl('check', document);
        icon.dataset.slot = checkboxDef.slot('icon');
        this.input = h('input', {});
        this.el = h('label', { className: 'vela-switch', slot: checkboxDef.slot('root'), attrs: checkboxVariants({ size: opts.size ?? 'md', tone: opts.tone ?? 'bright' }) }, this.input, icon);
        this.machine = runMachine(
            zagSwitch.machine,
            {
                id: this.mid,
                // The host's id names the focusable control, so its own `<label for>` reaches it.
                ...(opts.id ? { ids: { hiddenInput: opts.id } } : {}),
                defaultChecked: this.current,
                disabled: opts.disabled ?? false,
                ...(opts.name !== undefined ? { name: opts.name } : {}),
                ...(opts.required !== undefined ? { required: opts.required } : {}),
            },
            (service) => this.render(service),
        );
        // Only the user's toggles change the checkbox with an event, and they report at once,
        // as callers expect; `setChecked` never reaches here.
        this.input.addEventListener('change', () => {
            this.current = this.input.checked;
            opts.onCheckedChange?.(this.current);
            opts.onChange?.(this.current);
        });
        // A press must not focus by scrolling: when it outside-dismisses an open popover,
        // Chrome's focus action can scroll the dialog body under the pointer.
        this.el.addEventListener('pointerdown', (e) => {
            if (opts.disabled) return;
            e.preventDefault();
            this.input.focus({ preventScroll: true });
        });
    }

    get checked(): boolean {
        return this.current;
    }

    setChecked(v: boolean): void {
        if (v === this.current) return;
        this.current = v;
        this.api().setChecked(v);
    }

    destroy(): void {
        this.machine.stop();
    }

    private api(): zagSwitch.Api {
        return zagSwitch.connect(this.machine.service, normalizeProps);
    }

    private render(service: zagSwitch.Service): void {
        const api = zagSwitch.connect(service, normalizeProps);
        spreadProps(this.el, api.getRootProps(), this.mid);
        spreadProps(this.input, api.getHiddenInputProps(), this.mid);
    }
}

export function createCheckbox(props: CheckboxProps = {}): Checkbox {
    return new Checkbox(props);
}
