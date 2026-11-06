// Item: one row of a list (a watchlist, a list of alerts, search results): media (an icon, a
// logo, an avatar, a star), a title over a description, then at its end the meta (figures,
// badges) and the actions (buttons). With `onSelect` the whole row is clickable, a button to
// the keyboard (Enter, Space) and to screen readers, while a press on a control inside it
// stays that control's. `selected` marks the current row; `revealActions` keeps the actions
// out of sight until the row is hovered or holds focus, while the meta stays. `default` is
// bare until hovered, `outline` bordered, `muted` on a sunken fill; `sm` is the compact row of
// dense panels. ItemGroup stacks rows, with a line between them when `separated`.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { append, h, type Child } from '../lib/h';
import { iconEl } from '../lib/icons';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const itemDef = defineComponent({
    name: 'item',
    parts: ['root', 'media', 'content', 'title', 'description', 'meta', 'actions', 'group'],
    settings: { radius: t.radius.md, gap: '10px' },
});

export const itemVariants = variants({ variant: ['default', 'outline', 'muted'], size: ['default', 'sm'] });

export type ItemVariant = (typeof itemVariants.spec.variant)[number];
export type ItemSize = (typeof itemVariants.spec.size)[number];

export interface ItemProps extends VariantProps<typeof itemVariants> {
    /** The first line: text, or an element (a ticker with a chip after it). */
    title: string | Node;
    /** The muted line under the title. */
    description?: string | Node;
    /** Before the text: an icon id from the kit's registry, or an element (a logo, an
     *  avatar, a favorite star). */
    media?: string | Node;
    /** After the text, always shown: figures and badges (a price and its change). */
    meta?: Child;
    /** At the row's end: its buttons. */
    actions?: Child;
    /** Show the actions only while the row is hovered or holds focus (on touch screens they
     *  always show). The meta stays. */
    revealActions?: boolean;
    /** The current row (the open symbol, the highlighted result). */
    selected?: boolean;
    disabled?: boolean;
    /** Makes the row clickable: a click, Enter or Space runs it. */
    onSelect?: (e: MouseEvent | KeyboardEvent) => void;
    /** The row's role (default `button` when it has `onSelect`); `option` in a listbox, where
     *  `selected` is `aria-selected`. */
    role?: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ItemHandle {
    readonly el: HTMLElement;
    setSelected(selected: boolean): void;
    setDisabled(disabled: boolean): void;
    setTitle(title: string | Node): void;
    /** A new description; null removes it. */
    setDescription(description: string | Node | null): void;
    destroy(): void;
}

export interface ItemGroupProps {
    /** The rows, as elements or as the handles `createItem` returns. */
    items?: ReadonlyArray<HTMLElement | ItemHandle>;
    /** A line between the rows, edge to edge (default: separate rounded rows). */
    separated?: boolean;
    /** The list's accessible name. */
    label?: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ItemGroupHandle {
    readonly el: HTMLElement;
    /** Replace the rows. */
    setItems(items: ReadonlyArray<HTMLElement | ItemHandle>): void;
    destroy(): void;
}

/** A press on one of these inside a row belongs to it, not to the row. */
const CONTROL = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="link"], [contenteditable]:not([contenteditable="false"])';

const injectStyles = defineStyles(
    'vela-ui-item',
    css`
        @layer vela.ui {
            [data-slot='item'] {
                position: relative;
                box-sizing: border-box;
                min-width: 0;
                padding: 8px 10px;
                border: 1px solid transparent;
                border-radius: ${itemDef.vars.radius};
                color: ${t.fg};
                font-size: 13px;
                text-align: start;
                transition:
                    background ${t.dur.fast} ease,
                    border-color ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                    gap: ${itemDef.vars.gap};
                }
                &[data-size='sm'] {
                    gap: 8px;
                    padding: 4px 8px;
                    font-size: 12px;
                }
                &[data-variant='outline'] {
                    border-color: ${t.border};
                }
                &[data-variant='muted'] {
                    background: ${t.surface.sunken};
                }
                &[data-clickable] {
                    cursor: pointer;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                }
                &[data-clickable]:not([aria-disabled='true']):hover {
                    background: ${t.hover};
                }
                &[data-selected],
                &[data-selected][data-clickable]:hover {
                    background: ${t.active};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: -2px;
                }
                &[aria-disabled='true'] {
                    cursor: default;
                    opacity: 0.5;
                }
            }
            [data-slot='item-media'] {
                flex: none;
                color: ${t.fg.muted};

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                & > [data-icon] {
                    width: 1em;
                    height: 1em;
                    font-size: 16px;
                    line-height: 0;
                }
                & > [data-icon] > svg {
                    width: 100%;
                    height: 100%;
                }
            }
            [data-slot='item-content'] {
                flex: 1 1 auto;
                min-width: 0;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
            }
            [data-slot='item-title'],
            [data-slot='item-description'] {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            [data-slot='item-title'] {
                color: ${t.fg.bright};
                font-weight: 500;
                line-height: 18px;
            }
            [data-slot='item-description'] {
                color: ${t.fg.muted};
                font-size: 12px;
                line-height: 16px;

                &:is([data-size='sm'] *) {
                    font-size: 11px;
                    line-height: 14px;
                }
            }
            [data-slot='item-meta'] {
                flex: none;
                gap: 8px;
                color: ${t.fg};
                font-variant-numeric: tabular-nums;
                text-align: end;
                white-space: nowrap;

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                }
            }
            [data-slot='item-actions'] {
                flex: none;
                gap: 4px;

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                }
                &:is([data-reveal-actions] > *) {
                    opacity: 0;
                    transition: opacity ${t.dur.fast} ease;
                }
                &:is([data-reveal-actions]:hover > *, [data-reveal-actions]:focus-within > *) {
                    opacity: 1;
                }
                @media (hover: none) {
                    &:is([data-reveal-actions] > *) {
                        opacity: 1;
                    }
                }
            }
            [data-slot='item-group'] {
                min-width: 0;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                &[data-separated] {
                    gap: 0;
                }
                &[data-separated] > [data-slot='item'] {
                    border-radius: 0;
                    border-bottom-color: ${t.border.faint};
                }
            }
        }
    `,
);

class ItemImpl implements ItemHandle {
    readonly el: HTMLElement;
    private readonly content: HTMLElement;
    private readonly titleEl: HTMLElement;
    private descriptionEl: HTMLElement | null = null;
    private readonly option: boolean;
    private disabled = false;
    private readonly onClick = (e: MouseEvent): void => {
        if (this.disabled) return;
        const control = e.target instanceof Element ? e.target.closest(CONTROL) : null;
        if (control && control !== this.el && this.el.contains(control)) return;
        this.props.onSelect?.(e);
    };
    private readonly onKey = (e: KeyboardEvent): void => {
        if (this.disabled || e.target !== this.el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        this.props.onSelect?.(e);
    };

    constructor(private readonly props: ItemProps) {
        injectStyles(document);
        const clickable = !!props.onSelect;
        const role = props.role ?? (clickable ? 'button' : null);
        this.option = role === 'option';
        let media: HTMLElement | null = null;
        if (props.media !== undefined) {
            media = h('div', { slot: itemDef.slot('media') });
            if (typeof props.media === 'string') {
                const icon = iconEl(props.media, document);
                icon.dataset.icon = '';
                media.appendChild(icon);
            } else media.appendChild(props.media);
        }
        this.titleEl = h('div', { slot: itemDef.slot('title') }, props.title);
        this.content = h('div', { slot: itemDef.slot('content') }, this.titleEl);
        const trailing = (part: 'meta' | 'actions', children: Child): HTMLElement | null => {
            if (children === undefined || children === null) return null;
            const el = h('div', { slot: itemDef.slot(part) });
            append(el, [children]);
            return el;
        };
        this.el = h(
            'div',
            {
                className: props.className,
                slot: itemDef.slot('root'),
                attrs: { ...itemVariants(props), role, tabindex: clickable ? '0' : null },
                data: { clickable: clickable || null, 'reveal-actions': props.revealActions || null },
            },
            media,
            this.content,
            trailing('meta', props.meta),
            trailing('actions', props.actions),
        );
        if (props.description !== undefined) this.setDescription(props.description);
        if (clickable) {
            this.el.addEventListener('click', this.onClick);
            this.el.addEventListener('keydown', this.onKey);
        }
        this.setSelected(props.selected ?? false);
        this.setDisabled(props.disabled ?? false);
    }

    setSelected(selected: boolean): void {
        this.el.toggleAttribute('data-selected', selected);
        if (this.option) this.el.setAttribute('aria-selected', String(selected));
        else if (selected) this.el.setAttribute('aria-current', 'true');
        else this.el.removeAttribute('aria-current');
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        if (disabled) this.el.setAttribute('aria-disabled', 'true');
        else this.el.removeAttribute('aria-disabled');
        if (this.props.onSelect) this.el.tabIndex = disabled ? -1 : 0;
    }

    setTitle(title: string | Node): void {
        this.titleEl.replaceChildren(title);
    }

    setDescription(description: string | Node | null): void {
        if (description === null) {
            this.descriptionEl?.remove();
            this.descriptionEl = null;
            return;
        }
        this.descriptionEl ??= this.content.appendChild(h('div', { slot: itemDef.slot('description') }));
        this.descriptionEl.replaceChildren(description);
    }

    destroy(): void {
        this.el.removeEventListener('click', this.onClick);
        this.el.removeEventListener('keydown', this.onKey);
    }
}

export function createItem(props: ItemProps): ItemHandle {
    return new ItemImpl(props);
}

/** Rows stacked as one list. */
export function createItemGroup(props: ItemGroupProps = {}): ItemGroupHandle {
    injectStyles(document);
    const el = h('div', {
        className: props.className,
        slot: itemDef.slot('group'),
        attrs: { 'aria-label': props.label ?? null },
        data: { separated: props.separated || null },
    });
    const setItems = (items: ReadonlyArray<HTMLElement | ItemHandle>): void => {
        el.replaceChildren(...items.map((item) => (item instanceof HTMLElement ? item : item.el)));
    };
    setItems(props.items ?? []);
    return { el, setItems, destroy: () => el.remove() };
}
