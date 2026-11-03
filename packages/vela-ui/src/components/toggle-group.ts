// ToggleGroup: a few options side by side on one track, over Zag's toggle-group machine.
// `single` (default): one option is always chosen (a radio group, a segmented control);
// `multiple`: each option toggles on its own. The arrow keys move focus; Space and Enter
// press. The track and the chosen option are tints of the foreground, so both read on a dark
// and a light theme.
import * as toggleGroup from '@zag-js/toggle-group';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

export const toggleGroupDef = defineComponent({
    name: 'toggle-group',
    parts: ['root', 'item', 'icon'],
    settings: { radius: '8px', 'radius-sm': '7px', 'item-radius': t.radius.md, 'item-radius-sm': '5px' },
});

/** `default` = 32px; `sm` = 28px. */
export const toggleGroupVariants = variants({ size: ['default', 'sm'] });

export interface ToggleGroupItem {
    value: string;
    /** Visible text, or the accessible name of an icon-only option. */
    label: string;
    icon?: string;
    disabled?: boolean;
}

interface ToggleGroupCommonProps extends VariantProps<typeof toggleGroupVariants> {
    items: readonly ToggleGroupItem[];
    /** Accessible name of the group. */
    label?: string;
    /** Options show their icon only; each label becomes its option's accessible name. */
    iconOnly?: boolean;
    dir?: 'ltr' | 'rtl';
    /** Stretch across the parent, options sharing the width. */
    fill?: boolean;
    className?: string;
}

export interface ToggleGroupSingleProps extends ToggleGroupCommonProps {
    type?: 'single';
    /** The chosen option (default: the first enabled one). */
    defaultValue?: string;
    onValueChange?: (value: string) => void;
}

export interface ToggleGroupMultipleProps extends ToggleGroupCommonProps {
    type: 'multiple';
    /** The options turned on (default: none). */
    defaultValue?: readonly string[];
    onValueChange?: (value: string[]) => void;
}

export type ToggleGroupProps = ToggleGroupSingleProps | ToggleGroupMultipleProps;

export interface ToggleGroupHandle {
    readonly el: HTMLElement;
    /** The options turned on. */
    readonly values: readonly string[];
    /** Show options as on without calling `onValueChange`. */
    setValue(value: string | readonly string[] | null): void;
    setItems(items: readonly ToggleGroupItem[]): void;
    destroy(): void;
}

export const TOGGLE_GROUP_STYLE_ID = 'vela-ui-toggle-group';

export const TOGGLE_GROUP_CSS = css`
    @layer vela.ui {
        [data-slot='toggle-group-item'] {
            all: unset;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            min-width: 0;
            padding: 0 10px;
            border-radius: ${toggleGroupDef.vars['item-radius']};
            color: ${t.fg.muted};
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition:
                background ${t.dur.fast} ease,
                color ${t.dur.fast} ease;

            & > [data-slot='toggle-group-icon'] {
                width: 16px;
                height: 16px;
                flex: none;
            }
            &[data-icon-only] {
                padding: 0 8px;
            }
            &[data-state='off']:not([data-disabled]):hover {
                color: ${t.fg.bright};
            }
            &[data-state='on'] {
                background: color-mix(in srgb, ${t.fg.bright} 12%, transparent);
                color: ${t.fg.bright};
            }
            &[data-disabled] {
                cursor: default;
                opacity: 0.45;
            }
            &:focus-visible {
                outline: 2px solid ${t.focus};
                outline-offset: -2px;
            }
        }
        [data-slot='toggle-group'] {
            align-items: stretch;
            gap: 2px;
            padding: 3px;
            box-sizing: border-box;
            height: 32px;
            border-radius: ${toggleGroupDef.vars.radius};
            background: color-mix(in srgb, ${t.fg.bright} 6%, transparent);

            &:where(:not([hidden])) {
                display: inline-flex;
            }
            &[data-size='sm'] {
                height: 28px;
                padding: 2px;
                border-radius: ${toggleGroupDef.vars['radius-sm']};
            }
            &[data-fill] {
                width: 100%;
            }
            &[data-fill]:where(:not([hidden])) {
                display: flex;
            }
            &[data-fill] > [data-slot='toggle-group-item'] {
                flex: 1 1 0;
            }
            &[data-size='sm'] > [data-slot='toggle-group-item'] {
                padding: 0 8px;
                border-radius: ${toggleGroupDef.vars['item-radius-sm']};
                font-size: 12px;
            }
        }
    }
`;

const injectStyles = defineStyles(TOGGLE_GROUP_STYLE_ID, TOGGLE_GROUP_CSS);

const keyOf = (values: readonly string[]): string => values.join('\u0000');

class ToggleGroupImpl implements ToggleGroupHandle {
    readonly el: HTMLElement;
    private readonly machine: HandleOf<typeof toggleGroup.machine>;
    private readonly mid: string;
    private readonly iconOnly: boolean;
    private readonly label: string | undefined;
    private items: ToggleGroupItem[];
    private readonly buttons = new Map<string, HTMLButtonElement>();
    /** The options on as of the last write or report: the machine applies events on a
     *  microtask, so its own value lags a write. */
    private current: string[];
    /** A host write the machine has yet to report: that report is not the user's change. */
    private silentNext: string | undefined;

    constructor(props: ToggleGroupProps) {
        injectStyles(document);
        this.iconOnly = props.iconOnly ?? false;
        this.label = props.label;
        this.items = [...props.items];
        const multiple = props.type === 'multiple';
        this.current =
            props.type === 'multiple' ? [...(props.defaultValue ?? [])] : [props.defaultValue ?? props.items.find((i) => !i.disabled)?.value].filter((v): v is string => v !== undefined);
        this.mid = nextUid('vela-toggle-group');
        this.el = h('div', {
            className: props.className ? `vela-toggle-group ${props.className}` : 'vela-toggle-group',
            slot: toggleGroupDef.slot('root'),
            attrs: toggleGroupVariants(props),
            data: { fill: props.fill === true },
        });
        this.build();
        const onValueChange = props.onValueChange as ((v: string | string[]) => void) | undefined;
        this.machine = runMachine(
            toggleGroup.machine,
            {
                id: this.mid,
                multiple,
                // A single group never empties: pressing the chosen option keeps it chosen.
                deselectable: false,
                defaultValue: [...this.current],
                dir: props.dir ?? 'ltr',
                loopFocus: true,
                rovingFocus: true,
                onValueChange: ({ value }) => {
                    if (!multiple && value[0] === undefined) return;
                    const next = multiple ? [...value] : [value[0]!];
                    const key = keyOf(next);
                    // The machine compares arrays by identity: a press that changes nothing reports too.
                    if (key === keyOf(this.current)) {
                        if (this.silentNext === key) this.silentNext = undefined;
                        return;
                    }
                    this.current = next;
                    if (this.silentNext === key) {
                        this.silentNext = undefined;
                        return;
                    }
                    onValueChange?.(multiple ? [...next] : next[0]!);
                },
            },
            (service) => this.render(service),
        );
    }

    get values(): readonly string[] {
        return this.current;
    }

    setValue(value: string | readonly string[] | null): void {
        const next = value === null ? [] : typeof value === 'string' ? [value] : [...value];
        const key = keyOf(next);
        if (key === keyOf(this.current)) return;
        this.current = next;
        this.silentNext = key;
        this.api().setValue(next);
    }

    setItems(items: readonly ToggleGroupItem[]): void {
        this.items = [...items];
        this.build();
        const kept = this.current.filter((v) => this.items.some((i) => i.value === v));
        if (kept.length !== this.current.length) this.setValue(kept);
        this.machine.flush();
    }

    destroy(): void {
        this.machine.stop();
    }

    private api(): toggleGroup.Api {
        return toggleGroup.connect(this.machine.service, normalizeProps);
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.items.map((item) => {
                const icon = item.icon ? iconEl(item.icon, doc) : null;
                if (icon) icon.dataset.slot = toggleGroupDef.slot('icon');
                const iconOnly = this.iconOnly && icon !== null;
                const b = h(
                    'button',
                    { className: 'vela-toggle-group-item', slot: toggleGroupDef.slot('item'), data: { 'icon-only': iconOnly }, attrs: { 'aria-label': iconOnly ? item.label : null } },
                    icon,
                    iconOnly ? null : item.label,
                );
                this.buttons.set(item.value, b);
                return b;
            }),
        );
    }

    private render(service: toggleGroup.Service): void {
        const api = toggleGroup.connect(service, normalizeProps);
        spreadProps(this.el, api.getRootProps(), this.mid);
        if (this.label) this.el.setAttribute('aria-label', this.label);
        for (const item of this.items) {
            const b = this.buttons.get(item.value);
            if (b) spreadProps(b, api.getItemProps({ value: item.value, disabled: item.disabled }), this.mid);
        }
    }
}

export function createToggleGroup(props: ToggleGroupProps): ToggleGroupHandle {
    return new ToggleGroupImpl(props);
}
