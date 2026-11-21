// Card: a surface for one subject (a panel of figures, a chart, a summary): a header with an
// eyebrow over the title and a description under it, an action at its end (buttons, a toggle
// group), then the content and a footer past a line. `default` is a bordered surface, `inset` a
// sunken tile for figures inside another card; `sm` is tighter. The title is a heading, so a
// screen reader can move from card to card. With `onSelect` the whole card is clickable while a
// press on a control inside it stays that control's: to the keyboard and screen readers its
// title is the button (the card itself when it has no title), as a card often holds buttons of
// its own and a button cannot hold other buttons.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { append, h, type Child } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const cardDef = defineComponent({
    name: 'card',
    parts: ['root', 'header', 'heading', 'eyebrow', 'title', 'trigger', 'description', 'action', 'content', 'footer'],
    settings: {
        radius: t.radius.lg,
        padding: '16px',
        'padding-sm': '10px 12px',
        gap: '12px',
        'gap-sm': '8px',
        background: t.surface,
        border: t.border,
        'inset-background': `color-mix(in srgb, ${t.fg.bright} 2.5%, ${t.surface})`,
    },
});

export const cardVariants = variants({ variant: ['default', 'inset'], size: ['default', 'sm'] });

export type CardVariant = (typeof cardVariants.spec.variant)[number];
export type CardSize = (typeof cardVariants.spec.size)[number];

export interface CardProps extends VariantProps<typeof cardVariants> {
    /** Small capitals over the title: what kind of card it is ("Market pulse"). */
    eyebrow?: string | Node;
    /** The heading: text, or an element (a name with a badge after it). */
    title?: string | Node;
    /** The muted line under the title. */
    description?: string | Node;
    /** At the header's end: its buttons, a toggle group. */
    action?: Child;
    /** The body. More can be appended to the handle's `content` later. */
    content?: Child;
    /** Under the body, past a line: notes, a source, a time. */
    footer?: Child;
    /** The title's heading level (default 3). */
    headingLevel?: 2 | 3 | 4 | 5 | 6;
    /** The current card (the one a detail view shows). */
    selected?: boolean;
    disabled?: boolean;
    /** Makes the card clickable: a click on it, or Enter or Space on its title, runs it. */
    onSelect?: (e: MouseEvent | KeyboardEvent) => void;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface CardHandle {
    readonly el: HTMLElement;
    /** The body: append the card's content here. */
    readonly content: HTMLElement;
    /** A new title; null removes it. */
    setTitle(title: string | Node | null): void;
    /** A new description; null removes it. */
    setDescription(description: string | Node | null): void;
    /** A new footer; null removes it. */
    setFooter(footer: Child | null): void;
    setSelected(selected: boolean): void;
    setDisabled(disabled: boolean): void;
    destroy(): void;
}

/** A press on one of these inside a card belongs to it, not to the card. */
const CONTROL = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="link"], [role="tab"], [role="radio"], [contenteditable]:not([contenteditable="false"])';

const injectStyles = defineStyles(
    'vela-ui-card',
    css`
        @layer vela.ui {
            [data-slot='card'] {
                position: relative;
                box-sizing: border-box;
                min-width: 0;
                padding: ${cardDef.vars.padding};
                border: 1px solid ${cardDef.vars.border};
                border-radius: ${cardDef.vars.radius};
                background: ${cardDef.vars.background};
                color: ${t.fg};
                font-size: 13px;
                text-align: start;
                transition:
                    background ${t.dur.fast} ease,
                    border-color ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: ${cardDef.vars.gap};
                }
                &[data-size='sm'] {
                    gap: ${cardDef.vars['gap-sm']};
                    padding: ${cardDef.vars['padding-sm']};
                    font-size: 12px;
                }
                &[data-variant='inset'] {
                    background: ${cardDef.vars['inset-background']};
                }
                &[data-clickable] {
                    cursor: pointer;
                    -webkit-tap-highlight-color: transparent;
                }
                &[data-clickable]:not([data-disabled]):hover {
                    border-color: ${t.border.strong};
                }
                &[data-selected],
                &[data-selected][data-clickable]:hover {
                    border-color: ${t.fg.bright};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 2px;
                }
                &[data-disabled] {
                    cursor: default;
                    opacity: 0.5;
                }
            }
            [data-slot='card-header'] {
                gap: 12px;
                min-width: 0;

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: flex-start;
                }
            }
            [data-slot='card-heading'] {
                flex: 1 1 auto;
                min-width: 0;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
            }
            [data-slot='card-eyebrow'] {
                color: ${t.fg.muted};
                font-size: 10px;
                font-weight: 500;
                letter-spacing: 0.08em;
                line-height: 14px;
                text-transform: uppercase;
            }
            [data-slot='card-title'] {
                margin: 0;
                color: ${t.fg.bright};
                font-size: 15px;
                font-weight: 600;
                line-height: 1.3;
                overflow-wrap: anywhere;

                &:is([data-size='sm'] *) {
                    font-size: 13px;
                }
            }
            [data-slot='card-trigger'] {
                all: unset;
                border-radius: ${t.radius.sm};
                cursor: pointer;

                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 2px;
                }
                &:disabled {
                    cursor: default;
                }
            }
            [data-slot='card-description'] {
                margin: 0;
                color: ${t.fg.muted};
                font-size: 12px;
                line-height: 1.45;
            }
            [data-slot='card-action'] {
                flex: none;
                gap: 6px;
                margin-inline-start: auto;

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                }
            }
            [data-slot='card-content'] {
                flex: 1 1 auto;
                min-width: 0;
            }
            [data-slot='card-footer'] {
                flex-wrap: wrap;
                gap: 8px 16px;
                padding-top: 10px;
                border-top: 1px solid ${cardDef.vars.border};
                color: ${t.fg.muted};
                font-size: 11px;
                line-height: 1.5;

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
            }
        }
    `,
);

class CardImpl implements CardHandle {
    readonly el: HTMLElement;
    readonly content: HTMLElement;
    private header: HTMLElement | null = null;
    private heading: HTMLElement | null = null;
    private titleEl: HTMLElement | null = null;
    private trigger: HTMLButtonElement | null = null;
    private descriptionEl: HTMLElement | null = null;
    private footerEl: HTMLElement | null = null;
    private disabled = false;
    private selected = false;
    private readonly onClick = (e: MouseEvent): void => {
        if (this.disabled) return;
        const control = e.target instanceof Element ? e.target.closest(CONTROL) : null;
        if (control && control !== this.trigger && control !== this.el && this.el.contains(control)) return;
        this.props.onSelect?.(e);
    };
    private readonly onKey = (e: KeyboardEvent): void => {
        if (this.disabled || e.target !== this.el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        this.props.onSelect?.(e);
    };

    constructor(private readonly props: CardProps) {
        injectStyles(document);
        this.content = h('div', { slot: cardDef.slot('content') });
        append(this.content, [props.content]);
        this.el = h(
            'div',
            { className: props.className, slot: cardDef.slot('root'), attrs: cardVariants(props), data: { clickable: props.onSelect ? true : null } },
            this.content,
        );
        if (props.eyebrow !== undefined) this.ensureHeading().prepend(h('div', { slot: cardDef.slot('eyebrow') }, props.eyebrow));
        if (props.title !== undefined) this.setTitle(props.title);
        if (props.description !== undefined) this.setDescription(props.description);
        if (props.action !== undefined && props.action !== null) {
            const action = h('div', { slot: cardDef.slot('action') });
            append(action, [props.action]);
            this.ensureHeader().append(action);
        }
        if (props.footer !== undefined) this.setFooter(props.footer);
        if (props.onSelect) this.el.addEventListener('click', this.onClick);
        this.disabled = props.disabled ?? false;
        this.selected = props.selected ?? false;
        this.syncControl();
        this.setDisabled(this.disabled);
        this.setSelected(this.selected);
    }

    setTitle(title: string | Node | null): void {
        if (title === null) {
            this.titleEl?.remove();
            this.titleEl = null;
            this.trigger = null;
            this.syncControl();
            return;
        }
        if (!this.titleEl) {
            this.titleEl = h(`h${this.props.headingLevel ?? 3}` as 'h3', { slot: cardDef.slot('title') });
            const heading = this.ensureHeading();
            const eyebrow = heading.querySelector(`:scope > [data-slot="${cardDef.slot('eyebrow')}"]`);
            if (eyebrow) eyebrow.after(this.titleEl);
            else heading.prepend(this.titleEl);
            if (this.props.onSelect) {
                this.trigger = h('button', { slot: cardDef.slot('trigger'), attrs: { type: 'button' } });
                this.titleEl.append(this.trigger);
            }
            this.syncControl();
        }
        (this.trigger ?? this.titleEl).replaceChildren(title);
    }

    setDescription(description: string | Node | null): void {
        if (description === null) {
            this.descriptionEl?.remove();
            this.descriptionEl = null;
            return;
        }
        this.descriptionEl ??= this.ensureHeading().appendChild(h('p', { slot: cardDef.slot('description') }));
        this.descriptionEl.replaceChildren(description);
    }

    setFooter(footer: Child | null): void {
        if (footer === null) {
            this.footerEl?.remove();
            this.footerEl = null;
            return;
        }
        this.footerEl ??= this.el.appendChild(h('div', { slot: cardDef.slot('footer') }));
        this.footerEl.replaceChildren();
        append(this.footerEl, [footer]);
    }

    setSelected(selected: boolean): void {
        this.selected = selected;
        this.el.toggleAttribute('data-selected', selected);
        this.el.removeAttribute('aria-current');
        this.trigger?.removeAttribute('aria-current');
        if (selected) this.control()?.setAttribute('aria-current', 'true');
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        this.el.toggleAttribute('data-disabled', disabled);
        if (this.trigger) this.trigger.disabled = disabled;
        else if (this.props.onSelect) {
            this.el.tabIndex = disabled ? -1 : 0;
            if (disabled) this.el.setAttribute('aria-disabled', 'true');
            else this.el.removeAttribute('aria-disabled');
        }
    }

    destroy(): void {
        this.el.removeEventListener('click', this.onClick);
        this.el.removeEventListener('keydown', this.onKey);
        this.el.remove();
    }

    /** What the keyboard and screen readers press: the title's button, or the card itself without a title. */
    private control(): HTMLElement | null {
        if (!this.props.onSelect) return null;
        return this.trigger ?? this.el;
    }

    /** Give the card the button's role while it has no title to carry it, and take it back once it has one. */
    private syncControl(): void {
        if (!this.props.onSelect) return;
        if (this.trigger === null) {
            this.el.setAttribute('role', 'button');
            this.el.addEventListener('keydown', this.onKey);
        } else {
            this.el.removeAttribute('role');
            this.el.removeAttribute('tabindex');
            this.el.removeAttribute('aria-disabled');
            this.el.removeEventListener('keydown', this.onKey);
        }
        this.setDisabled(this.disabled);
        this.setSelected(this.selected);
    }

    private ensureHeader(): HTMLElement {
        if (!this.header) {
            this.header = h('div', { slot: cardDef.slot('header') });
            this.el.prepend(this.header);
        }
        return this.header;
    }

    private ensureHeading(): HTMLElement {
        if (!this.heading) {
            this.heading = h('div', { slot: cardDef.slot('heading') });
            this.ensureHeader().prepend(this.heading);
        }
        return this.heading;
    }
}

export function createCard(props: CardProps = {}): CardHandle {
    return new CardImpl(props);
}
