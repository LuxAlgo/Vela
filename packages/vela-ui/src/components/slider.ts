// Slider: a value on a track, dragged by its thumb or moved with the arrow keys, Page Up/Down
// and Home/End, over Zag's slider machine. It reports every move through `onValueChange`, and
// through `onValueCommit` once a move settles (the pointer lifted, a key pressed): the moment
// for work too heavy to run while dragging, such as a replay's seek. `setValue` moves it from
// code without reporting.
import * as zagSlider from '@zag-js/slider';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { ownTeardown } from '../lib/dispose';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

export const sliderDef = defineComponent({
    name: 'slider',
    parts: ['root', 'control', 'track', 'range', 'thumb'],
    settings: { 'track-height': '4px', 'thumb-size': '14px', radius: '999px', 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export interface SliderProps {
    /** The value it starts with (default `min`). */
    defaultValue?: number;
    /** Default 0. */
    min?: number;
    /** Default 100. */
    max?: number;
    /** Default 1. */
    step?: number;
    /** Every move: while dragging, and on each key. */
    onValueChange?: (value: number) => void;
    /** Once a move settles: the pointer lifted, or a key pressed. */
    onValueCommit?: (value: number) => void;
    /** Its accessible name, when no `<label>` names it. */
    label?: string;
    /** What a screen reader says for a value (`11 Jun 2024`, `35%`). Default: the number. */
    valueText?: (value: number) => string;
    /** Default `horizontal`. A vertical slider takes its height from its parent. */
    orientation?: 'horizontal' | 'vertical';
    /** The text direction the keys and the track follow (default `ltr`). */
    dir?: 'ltr' | 'rtl';
    disabled?: boolean;
    /** Submitted with its form under this name. */
    name?: string;
    /** The id of its thumb, so a `<label for>` reaches it. */
    id?: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface SliderHandle {
    readonly el: HTMLElement;
    readonly value: number;
    /** While the thumb is held. */
    readonly dragging: boolean;
    /** Move it without reporting. */
    setValue(value: number): void;
    setDisabled(disabled: boolean): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-slider',
    css`
        @layer vela.ui {
            /* The thumb centers on its value, so at either end half of it passes the track: the
               root keeps that half inside its box. */
            [data-slot='slider'] {
                --_thumb: ${sliderDef.vars['thumb-size']};
                --_track: ${sliderDef.vars['track-height']};
                position: relative;
                box-sizing: border-box;
                width: 100%;
                min-width: 0;
                padding-inline: calc(var(--_thumb) / 2);

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                }
                &[data-orientation='vertical'] {
                    flex-direction: column;
                    width: auto;
                    height: 100%;
                    padding-inline: 0;
                    padding-block: calc(var(--_thumb) / 2);
                }
                &[data-disabled] {
                    opacity: 0.5;
                }
            }
            /* The machine positions the range and the thumb inside the control. */
            [data-slot='slider-control'] {
                display: flex;
                flex: 1;
                align-items: center;
                min-height: var(--_thumb);
                cursor: pointer;

                &[data-orientation='vertical'] {
                    flex-direction: column;
                    min-width: var(--_thumb);
                    min-height: 0;
                }
                &[data-disabled] {
                    cursor: default;
                }
            }
            [data-slot='slider-track'] {
                position: relative;
                flex: 1;
                height: var(--_track);
                border-radius: ${sliderDef.vars.radius};
                background: ${t.border};
                overflow: hidden;

                &[data-orientation='vertical'] {
                    width: var(--_track);
                    height: auto;
                }
            }
            [data-slot='slider-range'] {
                height: 100%;
                border-radius: inherit;
                background: ${t.accent};

                &[data-orientation='vertical'] {
                    width: 100%;
                    height: auto;
                }
            }
            [data-slot='slider-thumb'] {
                width: var(--_thumb);
                height: var(--_thumb);
                border: 2px solid ${t.bg};
                border-radius: 50%;
                background: ${t.accent};
                outline: 2px solid transparent;
                transition: box-shadow ${t.dur.fast} ease;

                &:focus-visible {
                    box-shadow: ${sliderDef.vars['focus-ring']};
                }
            }
        }
    `,
);

class SliderImpl implements SliderHandle {
    readonly el: HTMLElement;
    private readonly control: HTMLElement;
    private readonly track: HTMLElement;
    private readonly range: HTMLElement;
    private readonly thumb: HTMLElement;
    private readonly input: HTMLInputElement | null;
    private readonly machine: HandleOf<typeof zagSlider.machine>;
    private readonly mid: string;
    private readonly release: () => void;
    private readonly min: number;
    private readonly max: number;
    /** The value as of the last write or report: the machine applies events on a microtask. */
    private current: number;
    /** A write from code is in the machine: its reports, down to the end of the change that
     *  always closes a write, are not the user's. */
    private silent = false;
    private disabled: boolean;

    constructor(props: SliderProps) {
        injectStyles(document);
        const min = (this.min = props.min ?? 0);
        const max = (this.max = props.max ?? 100);
        this.current = Math.min(max, Math.max(min, props.defaultValue ?? min));
        this.disabled = props.disabled ?? false;
        this.mid = nextUid('vela-slider');
        this.thumb = h('div', { slot: sliderDef.slot('thumb') });
        this.range = h('div', { slot: sliderDef.slot('range') });
        this.track = h('div', { slot: sliderDef.slot('track') }, this.range);
        this.control = h('div', { slot: sliderDef.slot('control') }, this.track, this.thumb);
        this.input = props.name !== undefined ? h('input', {}) : null;
        this.el = h('div', { className: props.className ? `vela-slider ${props.className}` : 'vela-slider', slot: sliderDef.slot('root') }, this.control, this.input);
        this.machine = runMachine(
            zagSlider.machine,
            () => ({
                id: this.mid,
                ...(props.id ? { ids: { thumb: () => props.id! } } : {}),
                min,
                max,
                step: props.step ?? 1,
                defaultValue: [this.current],
                orientation: props.orientation ?? 'horizontal',
                dir: props.dir ?? 'ltr',
                disabled: this.disabled,
                // `contain` would measure the thumb, which a slider built before it is on the
                // page cannot do.
                thumbAlignment: 'center',
                ...(props.name !== undefined ? { name: props.name } : {}),
                ...(props.label ? { 'aria-label': [props.label] } : {}),
                ...(props.valueText ? { getAriaValueText: ({ value }: { value: number }) => props.valueText!(value) } : {}),
                onValueChange: ({ value: [value] }) => {
                    if (value === undefined) return;
                    this.current = value;
                    if (!this.silent) props.onValueChange?.(value);
                },
                onValueChangeEnd: ({ value: [value] }) => {
                    if (this.silent) {
                        this.silent = false;
                        return;
                    }
                    if (value !== undefined) props.onValueCommit?.(value);
                },
            }),
            (service) => this.render(service),
        );
        this.release = ownTeardown(this.el, () => this.machine.stop());
    }

    get value(): number {
        return this.current;
    }

    get dragging(): boolean {
        return this.api().dragging;
    }

    setValue(value: number): void {
        const next = Math.min(this.max, Math.max(this.min, value));
        if (next === this.current) return;
        this.current = next;
        this.silent = true;
        this.api().setValue([next]);
    }

    setDisabled(disabled: boolean): void {
        if (disabled === this.disabled) return;
        this.disabled = disabled;
        this.machine.flush();
    }

    destroy(): void {
        this.release();
    }

    private api(): zagSlider.Api {
        return zagSlider.connect(this.machine.service, normalizeProps);
    }

    private render(service: zagSlider.Service): void {
        const api = zagSlider.connect(service, normalizeProps);
        spreadProps(this.el, api.getRootProps(), this.mid);
        spreadProps(this.control, api.getControlProps(), this.mid);
        spreadProps(this.track, api.getTrackProps(), this.mid);
        spreadProps(this.range, api.getRangeProps(), this.mid);
        spreadProps(this.thumb, api.getThumbProps({ index: 0 }), this.mid);
        if (this.input) spreadProps(this.input, api.getHiddenInputProps({ index: 0 }), this.mid);
    }
}

export function createSlider(props: SliderProps = {}): SliderHandle {
    return new SliderImpl(props);
}
