// Collapsible: a section that shows or hides its content. Its own trigger is a header (a title,
// an optional count, a chevron) that toggles it on a click, Enter or Space; or the host hands
// it a trigger of its own, such as a row's chevron button, and places the content where it
// likes. `default` is a section header with the chevron at its end (a panel's drawers),
// `label` a small uppercase group label with the chevron before it (a list's groups). The
// content is `hidden` while closed.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { iconEl } from '../lib/icons';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';
import { nextUid } from '../lib/zag';

export const collapsibleDef = defineComponent({
    name: 'collapsible',
    parts: ['root', 'trigger', 'icon', 'title', 'count', 'chevron', 'content'],
    settings: { 'trigger-height': '36px', radius: t.radius.md },
});

export const collapsibleVariants = variants({ variant: ['default', 'label'] });

export type CollapsibleVariant = (typeof collapsibleVariants.spec.variant)[number];

export interface CollapsibleProps extends VariantProps<typeof collapsibleVariants> {
    /** The header's text. Without `trigger`, the collapsible draws its header with it. */
    title?: string;
    /** After the title, muted: a count, a total. Null shows none. */
    count?: string | number | null;
    /** Icon id from the kit's registry, before the title. */
    icon?: string;
    /** A host element that toggles the content instead of the header (a row's chevron
     *  button): it gets `aria-expanded`, `aria-controls` and `data-state`, and a click on it
     *  toggles. The root then holds only the content. */
    trigger?: HTMLElement;
    /** The content, or a function that fills the content element. */
    content?: Node | ((content: HTMLElement) => void);
    /** Open when created (default closed). */
    defaultOpen?: boolean;
    /** Opened or closed by the user. */
    onOpenChange?: (open: boolean) => void;
    disabled?: boolean;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface CollapsibleHandle {
    readonly el: HTMLElement;
    /** What toggles it: its header, or the host's `trigger`. */
    readonly trigger: HTMLElement;
    /** The element that holds the content. */
    readonly content: HTMLElement;
    readonly open: boolean;
    /** Open or close it without calling `onOpenChange`. */
    setOpen(open: boolean): void;
    /** A new header text (its own header only). */
    setTitle(title: string): void;
    /** A new count (its own header only); null hides it. */
    setCount(count: string | number | null): void;
    setDisabled(disabled: boolean): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-collapsible',
    css`
        @layer vela.ui {
            [data-slot='collapsible'] {
                min-width: 0;
            }
            [data-slot='collapsible-trigger']:where(:not([hidden])) {
                all: unset;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                cursor: pointer;
                user-select: none;
                -webkit-tap-highlight-color: transparent;

                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: -2px;
                }
                &[data-disabled] {
                    cursor: default;
                    opacity: 0.5;
                }
                &[data-variant='default'] {
                    min-height: ${collapsibleDef.vars['trigger-height']};
                    padding: 0 12px;
                    border-radius: ${collapsibleDef.vars.radius};
                    color: ${t.fg.bright};
                    font-size: 13px;
                    font-weight: 600;
                    transition: background ${t.dur.fast} ease;
                }
                &[data-variant='default']:not([data-disabled]):hover {
                    background: ${t.hover};
                }
                &[data-variant='label'] {
                    gap: 6px;
                    padding: 10px 4px 4px;
                    color: ${t.fg.muted};
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    transition: color ${t.dur.fast} ease;
                }
                &[data-variant='label']:not([data-disabled]):hover {
                    color: ${t.fg};
                }
            }
            [data-slot='collapsible-title'] {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            [data-slot='collapsible-count'] {
                flex: none;
                color: ${t.fg.muted};
                font-size: 12px;
                font-weight: 400;
                font-variant-numeric: tabular-nums;

                &:is([data-variant='label'] > *) {
                    color: ${t.fg.faint};
                    font-size: inherit;
                    font-weight: 600;
                    letter-spacing: 0;
                }
            }
            [data-slot~='collapsible-icon'],
            [data-slot~='collapsible-chevron'] {
                flex: none;
                width: 1em;
                height: 1em;
                font-size: 16px;
                line-height: 0;

                & > svg {
                    width: 100%;
                    height: 100%;
                }
            }
            [data-slot='collapsible-chevron'] {
                font-size: 14px;
                color: ${t.fg.muted};
                transition: transform ${t.dur.med} ease;

                &:is([data-variant='default'] > *) {
                    margin-inline-start: auto;
                }
                &:is([data-variant='label'] > *) {
                    font-size: 12px;
                    color: inherit;
                }
                &:is([data-variant='default'][data-state='open'] > *) {
                    transform: rotate(180deg);
                }
                &:is([data-variant='label'][data-state='closed'] > *) {
                    transform: rotate(-90deg);
                }
                &:is([data-variant='label'][data-state='closed'] > *):dir(rtl) {
                    transform: rotate(90deg);
                }
            }
        }
    `,
);

class CollapsibleImpl implements CollapsibleHandle {
    readonly el: HTMLElement;
    readonly trigger: HTMLElement;
    readonly content: HTMLElement;
    private readonly own: boolean;
    private readonly titleEl: HTMLElement | null;
    private countEl: HTMLElement | null = null;
    private isOpen: boolean;
    private disabled: boolean;
    private readonly onClick = (): void => {
        if (this.disabled) return;
        this.paint(!this.isOpen);
        this.props.onOpenChange?.(this.isOpen);
    };

    constructor(private readonly props: CollapsibleProps) {
        injectStyles(document);
        const variant = collapsibleVariants.resolve(props).variant;
        this.isOpen = props.defaultOpen ?? false;
        this.disabled = props.disabled ?? false;
        const id = nextUid('vela-collapsible');
        this.content = h('div', { slot: collapsibleDef.slot('content'), attrs: { id } });
        if (props.content instanceof Node) this.content.appendChild(props.content);
        else props.content?.(this.content);
        this.own = !props.trigger;
        if (props.trigger) {
            this.trigger = props.trigger;
            this.titleEl = null;
        } else {
            let icon: HTMLElement | null = null;
            if (props.icon) {
                icon = iconEl(props.icon, document);
                icon.dataset.slot = collapsibleDef.slot('icon');
            }
            const chevron = iconEl('chevron-down', document);
            chevron.dataset.slot = collapsibleDef.slot('chevron');
            this.titleEl = h('span', { slot: collapsibleDef.slot('title'), text: props.title ?? '' });
            this.trigger = h(
                'button',
                { slot: collapsibleDef.slot('trigger'), data: { variant }, attrs: { type: 'button' } },
                variant === 'label' ? chevron : null,
                icon,
                this.titleEl,
                variant === 'label' ? null : chevron,
            );
            this.setCount(props.count ?? null);
        }
        this.trigger.setAttribute('aria-controls', id);
        this.trigger.addEventListener('click', this.onClick);
        this.el = h('div', { className: props.className, slot: collapsibleDef.slot('root'), data: { variant } }, this.own ? this.trigger : null, this.content);
        this.paint(this.isOpen);
        this.setDisabled(this.disabled);
    }

    get open(): boolean {
        return this.isOpen;
    }

    setOpen(open: boolean): void {
        this.paint(open);
    }

    setTitle(title: string): void {
        if (this.titleEl) this.titleEl.textContent = title;
    }

    setCount(count: string | number | null): void {
        if (!this.own) return;
        this.countEl?.remove();
        this.countEl = count === null || count === '' ? null : h('span', { slot: collapsibleDef.slot('count'), text: String(count) });
        if (this.countEl) this.titleEl!.after(this.countEl);
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.trigger.toggleAttribute('data-disabled', disabled);
        if (this.trigger instanceof HTMLButtonElement) this.trigger.disabled = disabled;
        else if (disabled) this.trigger.setAttribute('aria-disabled', 'true');
        else this.trigger.removeAttribute('aria-disabled');
    }

    destroy(): void {
        this.trigger.removeEventListener('click', this.onClick);
    }

    private paint(open: boolean): void {
        this.isOpen = open;
        const state = open ? 'open' : 'closed';
        this.trigger.setAttribute('aria-expanded', String(open));
        for (const el of [this.trigger, this.content, this.el]) el?.setAttribute('data-state', state);
        this.content.hidden = !open;
    }
}

export function createCollapsible(props: CollapsibleProps = {}): CollapsibleHandle {
    return new CollapsibleImpl(props);
}
