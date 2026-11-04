// Switch: a sliding on/off toggle, a track with a round thumb, for a setting that applies at
// once. `destructive` turns the track red while on (a kill switch); `sm` is a compact track.
// Given `checked`, it is controlled: a toggle only reports through `onCheckedChange`, and
// `setChecked` moves it. Behavior, keyboard and ARIA come from Zag's switch machine: a label
// holding a hidden checkbox.
import * as zagSwitch from '@zag-js/switch';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { ownTeardown } from '../lib/dispose';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

export type SwitchSize = 'default' | 'sm';
export type SwitchVariant = 'default' | 'destructive';

export const switchDef = defineComponent({
    name: 'switch',
    parts: ['root', 'control', 'thumb'],
    settings: { width: '32px', height: '18px', 'thumb-size': '14px', 'width-sm': '24px', 'height-sm': '14px', 'thumb-size-sm': '10px' },
});

export const switchVariants = variants({ size: ['default', 'sm'], variant: ['default', 'destructive'] });

export interface SwitchProps {
    /** On or off. Given, the switch is controlled: it moves only through `setChecked`. */
    checked?: boolean;
    /** The state it starts in when `checked` is not given. */
    defaultChecked?: boolean;
    /** Called when the user toggles it, with the state asked for. */
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    /** Submitted with its form under this name while on. */
    name?: string;
    /** What it submits while on (default `on`). */
    value?: string;
    /** A form does not submit while it is off. */
    required?: boolean;
    /** The id of its focusable control, so a `<label for>` reaches it. */
    id?: string;
    /** Its accessible name, when no `<label>` names it. */
    label?: string;
    size?: SwitchSize;
    variant?: SwitchVariant;
}

const injectStyles = defineStyles(
    'vela-ui-switch',
    css`
        @layer vela.ui {
            [data-slot='switch'] {
                --_w: ${switchDef.vars.width};
                --_h: ${switchDef.vars.height};
                --_thumb: ${switchDef.vars['thumb-size']};
                /* Holds the hidden native input, which is absolutely positioned: anchored
                   anywhere higher, it escapes a scrolling pane and stretches the page. */
                position: relative;
                flex: 0 0 auto;
                align-items: center;
                cursor: pointer;
                line-height: 0;

                &:where(:not([hidden])) {
                    display: inline-flex;
                }
                &[data-size='sm'] {
                    --_w: ${switchDef.vars['width-sm']};
                    --_h: ${switchDef.vars['height-sm']};
                    --_thumb: ${switchDef.vars['thumb-size-sm']};
                }
                &[data-disabled] {
                    opacity: 0.5;
                    cursor: default;
                }
            }
            [data-slot='switch-control'] {
                position: relative;
                flex: none;
                width: var(--_w);
                height: var(--_h);
                border-radius: 999px;
                background: color-mix(in srgb, ${t.fg.bright} 15%, transparent);
                transition: background ${t.dur.med} ease;
            }
            [data-slot='switch-thumb'] {
                position: absolute;
                top: calc((var(--_h) - var(--_thumb)) / 2);
                inset-inline-start: calc((var(--_h) - var(--_thumb)) / 2);
                width: var(--_thumb);
                height: var(--_thumb);
                border-radius: 50%;
                background: ${t.fg.onFill};
                transition:
                    inset-inline-start ${t.dur.med} ease,
                    background ${t.dur.med} ease;
            }
            [data-slot='switch'][data-focus-visible] [data-slot='switch-control'] {
                outline: 2px solid ${t.focus};
                outline-offset: 2px;
            }
            [data-slot='switch'][data-state='checked'] [data-slot='switch-control'] {
                background: ${t.selected.bg};
            }
            [data-slot='switch'][data-state='checked'] [data-slot='switch-thumb'] {
                inset-inline-start: calc(var(--_w) - var(--_thumb) - (var(--_h) - var(--_thumb)) / 2);
                background: ${t.selected.fg};
            }
            [data-slot='switch'][data-variant='destructive'][data-state='checked'] [data-slot='switch-control'] {
                background: ${t.danger};
            }
            [data-slot='switch'][data-variant='destructive'][data-state='checked'] [data-slot='switch-thumb'] {
                background: ${t.fg.onFill};
            }
        }
    `,
);

export class Switch {
    readonly el: HTMLLabelElement;
    private readonly input: HTMLInputElement;
    private readonly machine: HandleOf<typeof zagSwitch.machine>;
    private readonly mid: string;
    private readonly release: () => void;
    private readonly control: HTMLElement;
    private readonly thumb: HTMLElement;
    /** The state as the switch's users see it, at once: the machine settles a beat later. */
    private current: boolean;
    private disabled: boolean;

    constructor(opts: SwitchProps = {}) {
        injectStyles(document);
        this.mid = nextUid('vela-switch');
        this.current = opts.checked ?? opts.defaultChecked ?? false;
        this.disabled = opts.disabled ?? false;
        const controlled = opts.checked !== undefined;
        this.input = h('input', {});
        this.thumb = h('span', { slot: switchDef.slot('thumb') });
        this.control = h('span', { slot: switchDef.slot('control') }, this.thumb);
        this.el = h('label', { className: 'vela-toggle-switch', slot: switchDef.slot('root'), attrs: switchVariants({ size: opts.size ?? 'default', variant: opts.variant ?? 'default' }) }, this.input, this.control);
        this.machine = runMachine(
            zagSwitch.machine,
            () => ({
                id: this.mid,
                ...(opts.id ? { ids: { hiddenInput: opts.id } } : {}),
                defaultChecked: this.current,
                disabled: this.disabled,
                ...(opts.name !== undefined ? { name: opts.name } : {}),
                ...(opts.value !== undefined ? { value: opts.value } : {}),
                ...(opts.required !== undefined ? { required: opts.required } : {}),
            }),
            (service) => this.render(service, opts.label),
        );
        this.release = ownTeardown(this.el, () => this.machine.stop());
        this.input.addEventListener('change', () => {
            const asked = this.input.checked;
            if (controlled) this.api().setChecked(this.current);
            else this.current = asked;
            opts.onCheckedChange?.(asked);
        });
        // A press must not focus by scrolling (it may outside-dismiss an open popover).
        this.el.addEventListener('pointerdown', (e) => {
            if (this.disabled) return;
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

    setDisabled(disabled: boolean): void {
        if (disabled === this.disabled) return;
        this.disabled = disabled;
        this.machine.flush();
    }

    destroy(): void {
        this.release();
    }

    private api(): zagSwitch.Api {
        return zagSwitch.connect(this.machine.service, normalizeProps);
    }

    private render(service: zagSwitch.Service, label: string | undefined): void {
        const api = zagSwitch.connect(service, normalizeProps);
        spreadProps(this.el, api.getRootProps(), this.mid);
        spreadProps(this.control, api.getControlProps(), this.mid);
        spreadProps(this.thumb, api.getThumbProps(), this.mid);
        spreadProps(this.input, api.getHiddenInputProps(), this.mid);
        if (label) this.input.setAttribute('aria-label', label);
    }
}

export function createSwitch(props: SwitchProps = {}): Switch {
    return new Switch(props);
}
