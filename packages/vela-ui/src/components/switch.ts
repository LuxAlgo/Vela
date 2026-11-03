// Switch: a square check toggle, filled with a check mark when on. `bright` fills with the
// bright foreground (the settings dialogs), `selected` with the selection color.
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';

export type SwitchSize = 'sm' | 'md';
/** `bright` = settings-dialog fill (`--vela-fg-bright`); `selected` = `--vela-selected-bg`. */
export type SwitchTone = 'bright' | 'selected';

export interface SwitchControllerOptions {
    checked?: boolean;
    disabled?: boolean;
    size?: SwitchSize;
    tone?: SwitchTone;
    onChange?: (checked: boolean) => void;
}

export interface SwitchController {
    checked: boolean;
    disabled: boolean;
    size: SwitchSize;
    tone: SwitchTone;
    setChecked(v: boolean): void;
    toggle(): boolean;
}

/** The switch's state without DOM: checked, and the option mapping. */
export function switchController(opts: SwitchControllerOptions = {}): SwitchController {
    let checked = opts.checked ?? false;
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
            opts.onChange?.(checked);
            return checked;
        },
    };
}

export const switchDef = defineComponent({
    name: 'switch',
    parts: ['root', 'icon'],
    settings: { radius: '5px' },
});

export const switchVariants = variants({ size: ['md', 'sm'], tone: ['bright', 'selected'] });

export interface SwitchOptions extends SwitchControllerOptions {
    id?: string;
}

export type SwitchProps = SwitchOptions;

const injectStyles = defineStyles(
    'vela-ui-switch',
    css`
        @layer vela.ui {
            [data-slot='switch'] {
                width: 20px;
                height: 20px;
                flex: 0 0 auto;
                align-items: center;
                justify-content: center;
                padding: 0;
                border: 1px solid ${t.border};
                border-radius: ${switchDef.vars.radius};
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
                & [data-slot='switch-icon'],
                & svg {
                    display: block;
                    width: 12px;
                    height: 12px;
                }
                &[data-size='sm'] [data-slot='switch-icon'],
                &[data-size='sm'] svg {
                    width: 11px;
                    height: 11px;
                }
                &:hover {
                    border-color: ${t.fg.muted};
                }
                &[data-checked] {
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
                &[data-size='sm'][data-checked] {
                    background: ${t.selected.bg};
                    border-color: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[data-tone='selected'][data-checked] {
                    background: ${t.selected.bg};
                    border-color: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[disabled] {
                    opacity: 0.4;
                    cursor: default;
                }
            }
        }
    `,
);

export class Switch {
    readonly el: HTMLButtonElement;
    private readonly ctrl: SwitchController;

    constructor(opts: SwitchOptions = {}) {
        injectStyles(document);
        this.ctrl = switchController(opts);
        const icon = iconEl('check', document);
        icon.dataset.slot = switchDef.slot('icon');
        const b = h('button', { className: 'vela-switch', slot: switchDef.slot('root'), attrs: { type: 'button', id: opts.id, role: 'switch', ...switchVariants({ size: this.ctrl.size, tone: this.ctrl.tone }) } }, icon);
        b.disabled = this.ctrl.disabled;
        this.el = b;
        this.paint();
        // Suppress the default mousedown focus: when this press outside-dismisses an open
        // popover, Chrome's focus action can scroll the dialog body under the pointer.
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            b.focus({ preventScroll: true });
        });
        b.addEventListener('click', () => {
            this.ctrl.toggle();
            this.paint();
        });
    }

    get checked(): boolean {
        return this.ctrl.checked;
    }

    setChecked(v: boolean): void {
        this.ctrl.setChecked(v);
        this.paint();
    }

    destroy(): void {}

    private paint(): void {
        const on = this.ctrl.checked;
        this.el.setAttribute('aria-checked', on ? 'true' : 'false');
        this.el.toggleAttribute('data-checked', on);
    }
}

export function createSwitch(props: SwitchProps = {}): Switch {
    return new Switch(props);
}
