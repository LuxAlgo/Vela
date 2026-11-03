// Tabs: a tab list over Zag's tabs machine (WAI-ARIA tabs: roving focus, the arrow keys along
// the orientation, Home/End, automatic or manual activation). Clicks and the arrow keys
// select; the caller shows what the selected tab stands for, through panels it attaches or as
// a filter of one view. `default` puts the tabs on one tinted track, `line` underlines the
// selected one (the indicator dialog), `filled` is the symbol picker's market strip, `soft`
// the drawings drawer's category strip, `nav` a vertical settings rail.
import * as tabs from '@zag-js/tabs';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';

export const tabsDef = defineComponent({
    name: 'tabs',
    parts: ['list', 'trigger', 'content'],
    settings: { 'track-radius': '8px', 'trigger-radius': t.radius.md, 'filled-radius': '5px', 'soft-radius': '8px' },
});

export const tabsVariants = variants({ variant: ['default', 'line', 'filled', 'soft', 'nav'] });

export type TabsVariant = (typeof tabsVariants.spec.variant)[number];

export interface TabItem {
    value: string;
    label: string;
    disabled?: boolean;
    /** Out of the strip for now (its content does not apply); the arrow keys skip it. */
    hidden?: boolean;
}

export interface TabsProps extends VariantProps<typeof tabsVariants> {
    items: readonly TabItem[];
    /** The selected tab (default: the first available one). */
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    /** Default `horizontal` (`nav` reads best vertical). */
    orientation?: 'horizontal' | 'vertical';
    /** `automatic` (default): moving focus with the arrow keys selects. `manual`: Enter or
     *  Space selects the focused tab. */
    activationMode?: 'automatic' | 'manual';
    /** The text direction the arrow keys follow (default `ltr`). */
    dir?: 'ltr' | 'rtl';
    /** Extra class names on the list (the host's layout of the strip). */
    className?: string;
    /** Extra class names on every trigger. */
    triggerClassName?: string;
}

export interface TabsHandle {
    readonly el: HTMLElement;
    /** The selected tab. */
    readonly value: string | null;
    /** Show a tab as selected without calling `onValueChange`. */
    setValue(value: string | null): void;
    setItems(items: readonly TabItem[]): void;
    /** Hide or show a tab. Hiding the selected tab selects the first available one (and
     *  calls `onValueChange`). */
    setHidden(value: string, hidden: boolean): void;
    /** The trigger of a tab (null: unknown value). */
    trigger(value: string): HTMLButtonElement | null;
    /** Make `el` the panel of tab `value`: it gets the tabpanel role, its link to the trigger,
     *  and `hidden` while another tab is selected. */
    panel(value: string, el: HTMLElement): void;
    destroy(): void;
}

/** A tab a user can reach: neither disabled nor hidden. */
export const tabAvailable = (item: TabItem): boolean => !item.disabled && !item.hidden;

const injectStyles = defineStyles(
    'vela-ui-tabs',
    css`
        @layer vela.ui {
            [data-slot='tabs-list'] {
                display: flex;

                &[data-orientation='vertical'] {
                    flex-direction: column;
                }
                &[data-variant='default'] {
                    display: inline-flex;
                    gap: 2px;
                    padding: 3px;
                    box-sizing: border-box;
                    border-radius: ${tabsDef.vars['track-radius']};
                    background: color-mix(in srgb, ${t.fg.bright} 6%, transparent);
                }
                &[data-variant='default'][data-orientation='horizontal'] {
                    height: 32px;
                    align-items: stretch;
                }
                &[data-variant='line'] {
                    gap: 12px;
                    border-bottom: 1px solid ${t.border};
                }
                &[data-variant='nav'] {
                    gap: 2px;
                }
            }
            [data-slot='tabs-trigger']:where(:not([hidden])) {
                all: unset;
                cursor: pointer;
                white-space: nowrap;
                -webkit-tap-highlight-color: transparent;

                &[data-disabled] {
                    cursor: default;
                    opacity: 0.45;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: -2px;
                }
                &[data-variant='default'] {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0 10px;
                    border-radius: ${tabsDef.vars['trigger-radius']};
                    color: ${t.fg.muted};
                    font-size: 13px;
                    font-weight: 500;
                    transition:
                        background ${t.dur.fast} ease,
                        color ${t.dur.fast} ease;
                }
                &[data-variant='default'][data-orientation='vertical'] {
                    justify-content: flex-start;
                    padding: 6px 10px;
                }
                &[data-variant='default']:not([data-selected], [data-disabled]):hover {
                    color: ${t.fg.bright};
                }
                &[data-variant='default'][data-selected] {
                    background: color-mix(in srgb, ${t.fg.bright} 12%, transparent);
                    color: ${t.fg.bright};
                }
                &[data-variant='line'] {
                    padding-bottom: 8px;
                    margin-bottom: -1px;
                    border-bottom: 2px solid transparent;
                    font-size: 13px;
                    font-weight: 600;
                    line-height: 20px;
                    color: ${t.fg.muted};
                    transition:
                        color ${t.dur.fast} ease,
                        border-color ${t.dur.fast} ease;
                }
                &[data-variant='line']:not([data-selected], [data-disabled]):hover {
                    color: ${t.fg};
                }
                &[data-variant='line'][data-selected] {
                    color: ${t.fg};
                    border-bottom-color: ${t.fg.bright};
                }
                &[data-variant='filled'] {
                    padding: 3px 10px;
                    border-radius: ${tabsDef.vars['filled-radius']};
                    color: ${t.fg.muted};
                    font-size: 13px;
                    font-weight: 600;
                }
                &[data-variant='filled']:not([data-selected], [data-disabled]):hover {
                    color: ${t.fg};
                }
                &[data-variant='filled'][data-selected] {
                    background: ${t.selected.bg};
                    color: ${t.selected.fg};
                }
                &[data-variant='soft'] {
                    flex: none;
                    min-height: 36px;
                    padding: 0 12px;
                    display: inline-flex;
                    align-items: center;
                    border-radius: ${tabsDef.vars['soft-radius']};
                    font-size: 13px;
                    font-weight: 600;
                    color: ${t.fg.muted};
                }
                &[data-variant='soft'][data-selected] {
                    color: ${t.fg.bright};
                    background: ${t.hover};
                }
                &[data-variant='nav'] {
                    padding: 9px 12px;
                    border-radius: ${t.radius.md};
                    color: ${t.fg.muted};
                    font-size: 13px;
                    font-weight: 600;
                    transition:
                        background ${t.dur.fast} ease,
                        color ${t.dur.fast} ease;
                }
                &[data-variant='nav']:not([data-selected], [data-disabled]):hover {
                    background: ${t.hover};
                    color: ${t.fg.bright};
                }
                &[data-variant='nav'][data-selected] {
                    background: ${t.active};
                    color: ${t.fg.bright};
                }
            }
        }
    `,
);

class TabsImpl implements TabsHandle {
    readonly el: HTMLElement;
    private readonly machine: HandleOf<typeof tabs.machine>;
    private readonly mid: string;
    private readonly variant: TabsVariant;
    private readonly triggerClassName: string | undefined;
    private items: TabItem[];
    private readonly triggers = new Map<string, HTMLButtonElement>();
    private readonly panels = new Map<string, HTMLElement>();
    /** The selection as of the last write or report: the machine applies events on a
     *  microtask, so its own value lags a write. */
    private current: string | null;
    /** A host write the machine has yet to report: that report is not the user's change. */
    private silentNext: string | undefined;

    constructor(props: TabsProps) {
        injectStyles(document);
        this.variant = tabsVariants.resolve(props).variant;
        this.triggerClassName = props.triggerClassName;
        this.items = [...props.items];
        this.current = props.defaultValue ?? this.items.find(tabAvailable)?.value ?? null;
        this.mid = nextUid('vela-tabs');
        this.el = h('div', {
            className: props.className ? `vela-tabs ${props.className}` : 'vela-tabs',
            slot: tabsDef.slot('list'),
            data: { variant: this.variant },
        });
        this.build();
        this.machine = runMachine(
            tabs.machine,
            {
                id: this.mid,
                defaultValue: this.current,
                orientation: props.orientation ?? 'horizontal',
                activationMode: props.activationMode ?? 'automatic',
                dir: props.dir ?? 'ltr',
                loopFocus: true,
                onValueChange: ({ value }) => {
                    if (value == null) return;
                    this.current = value;
                    if (this.silentNext === value) {
                        this.silentNext = undefined;
                        return;
                    }
                    props.onValueChange?.(value);
                },
            },
            (service) => this.render(service),
        );
    }

    get value(): string | null {
        return this.current;
    }

    setValue(value: string | null): void {
        if (value === this.current) return;
        this.current = value;
        if (value === null) {
            this.api().clearValue();
            return;
        }
        this.silentNext = value;
        this.api().setValue(value);
    }

    setItems(items: readonly TabItem[]): void {
        this.items = [...items];
        this.build();
        if (this.current === null || !this.items.some((i) => i.value === this.current)) this.setValue(this.items.find(tabAvailable)?.value ?? null);
        this.machine.flush();
    }

    setHidden(value: string, hidden: boolean): void {
        this.items = this.items.map((i) => (i.value === value ? { ...i, hidden } : i));
        if (hidden && this.current === value) {
            const next = this.items.find(tabAvailable)?.value;
            if (next !== undefined) {
                this.current = next;
                this.api().setValue(next);
            }
        }
        this.machine.flush();
    }

    trigger(value: string): HTMLButtonElement | null {
        return this.triggers.get(value) ?? null;
    }

    panel(value: string, el: HTMLElement): void {
        el.dataset.slot = tabsDef.slot('content');
        this.panels.set(value, el);
        this.machine.flush();
    }

    destroy(): void {
        this.machine.stop();
    }

    private api(): tabs.Api {
        return tabs.connect(this.machine.service, normalizeProps);
    }

    private build(): void {
        this.triggers.clear();
        const className = this.triggerClassName ? `vela-tab ${this.triggerClassName}` : 'vela-tab';
        this.el.replaceChildren(
            ...this.items.map((item) => {
                const b = h('button', { className, slot: tabsDef.slot('trigger'), data: { variant: this.variant }, text: item.label });
                this.triggers.set(item.value, b);
                return b;
            }),
        );
    }

    private render(service: tabs.Service): void {
        const api = tabs.connect(service, normalizeProps);
        spreadProps(this.el, api.getListProps(), this.mid);
        for (const item of this.items) {
            const b = this.triggers.get(item.value);
            if (!b) continue;
            // A hidden tab is a disabled trigger to the machine, so the arrow keys skip it.
            const props = api.getTriggerProps({ value: item.value, disabled: !tabAvailable(item) }) as Record<string, unknown>;
            if (!this.panels.has(item.value)) delete props['aria-controls'];
            spreadProps(b, props, this.mid);
            b.hidden = item.hidden === true;
        }
        for (const [value, el] of this.panels) spreadProps(el, api.getContentProps({ value }), this.mid);
    }
}

export function createTabs(props: TabsProps): TabsHandle {
    return new TabsImpl(props);
}
