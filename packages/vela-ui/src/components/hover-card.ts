// HoverCard: a card beside a control while the pointer rests on it, richer than a tooltip: a
// title with an icon tile and a shortcut drawn as keycaps, a description, rich content (figures,
// a sparkline) and a hint line. `attachHoverCard` wires a trigger; the card mounts on the host
// it is given (a themed shell root) and never takes the pointer.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { iconEl } from '../lib/icons';
import { t } from '../lib/t';
import { intersectRects, placePopover, viewportRect, type PlacementProps, type Side } from '../lib/placement';
import { shortcutKeys } from './kbd';

export const hoverCardDef = defineComponent({
    name: 'hover-card',
    parts: ['root', 'heading', 'icon', 'title', 'description', 'body', 'hint'],
    settings: { radius: t.radius.md, width: '240px', 'wide-width': '280px', 'icon-radius': '5px', shadow: t.shadow.toString() },
});

export interface HoverCardContent {
    title: string;
    description?: string;
    /** Icon id from the kit's registry, in a tile beside the title. */
    icon?: string;
    /** A shortcut drawn as keycaps (`Alt+A`). */
    shortcut?: string;
    /** A secondary line at the bottom ("Shift-click to open alongside"). */
    hint?: string;
    /** Rich content under the description (figures, a sparkline). */
    body?: Node;
    /** A wider card, for rich content. */
    wide?: boolean;
}

export type HoverCardSide = Side;

/** Where the card opens beside its trigger: on the right, centered, 8px away by default. */
export type HoverCardPlacement = PlacementProps;

export interface HoverCardHandle {
    readonly el: HTMLElement;
    /** Place the card beside `anchor`, kept inside its collision area. `gap` overrides the
     *  placement's `sideOffset`. */
    place(anchor: DOMRect, gap?: number): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-hover-card',
    css`
        @layer vela.ui {
            [data-slot='hover-card'] {
                position: fixed;
                z-index: ${t.z.tooltip};
                width: max-content;
                max-width: ${hoverCardDef.vars.width};
                padding: 8px 10px;
                border-radius: ${hoverCardDef.vars.radius};
                border: 1px solid ${t.border};
                background: ${t.surface.elev};
                color: ${t.fg};
                box-shadow: ${hoverCardDef.vars.shadow};
                font-family: ${t.font};
                font-size: 12px;
                line-height: 1.4;
                pointer-events: none;
                animation: vela-hover-card-in ${t.dur.med} ${t.ease};

                &[data-wide] {
                    width: ${hoverCardDef.vars['wide-width']};
                    max-width: ${hoverCardDef.vars['wide-width']};
                }
                &[data-side='left'] {
                    --_from: 4px;
                }
                &[data-side='right'] {
                    --_from: -4px;
                }
            }
            [data-slot='hover-card-heading']:where(:not([hidden])) {
                display: flex;
                align-items: center;
                gap: 7px;

                & > [data-slot='kbd']:first-of-type {
                    margin-inline-start: auto;
                }
            }
            [data-slot='hover-card-icon'] {
                justify-content: center;
                flex: 0 0 20px;
                width: 20px;
                height: 20px;
                border: 1px solid ${t.border};
                border-radius: ${hoverCardDef.vars['icon-radius']};
                background: ${t.hover};
                color: ${t.fg.bright};

                & > svg {
                    width: 12px;
                    height: 12px;
                }
            }
            [data-slot='hover-card-title'] {
                font-size: 11.5px;
                font-weight: 600;
                color: ${t.fg.bright};
            }
            [data-slot='hover-card-description'] {
                margin: 6px 0 0;
                padding-top: 6px;
                border-top: 1px solid ${t.border};
                color: ${t.fg.muted};
                font-size: 12px;
            }
            [data-slot='hover-card-hint']:where(:not([hidden])) {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 6px;
                color: ${t.fg.muted};
                font-size: 11px;
            }
            @keyframes vela-hover-card-in {
                from {
                    opacity: 0;
                    transform: translateX(var(--_from, 0));
                }
                to {
                    opacity: 1;
                    transform: none;
                }
            }
        }
    `,
);

export function createHoverCard(content: HoverCardContent, placement: HoverCardSide | HoverCardPlacement = 'right'): HoverCardHandle {
    const p: HoverCardPlacement = typeof placement === 'string' ? { side: placement } : placement;
    const side = p.side ?? 'right';
    injectStyles(document);
    let icon: HTMLElement | null = null;
    if (content.icon) {
        icon = iconEl(content.icon, document);
        icon.dataset.slot = hoverCardDef.slot('icon');
    }
    const heading = h('div', { slot: hoverCardDef.slot('heading') }, icon, h('strong', { slot: hoverCardDef.slot('title'), text: content.title }), content.shortcut ? shortcutKeys(content.shortcut) : null);
    const body = content.body ? h('div', { slot: hoverCardDef.slot('body') }, content.body) : null;
    const el = h(
        'div',
        { slot: hoverCardDef.slot('root'), data: { side, wide: content.wide ?? false }, attrs: { role: 'tooltip' } },
        heading,
        content.description ? h('p', { slot: hoverCardDef.slot('description'), text: content.description }) : null,
        body,
        content.hint ? h('div', { slot: hoverCardDef.slot('hint'), text: content.hint }) : null,
    );
    return {
        el,
        place(anchor, gap) {
            const view = viewportRect(window.innerWidth, window.innerHeight, p.collisionPadding ?? 6);
            const b = p.collisionBoundary;
            const bound = !b || b === 'viewport' ? null : typeof b === 'function' ? b() : b.getBoundingClientRect();
            const pos = placePopover({
                trigger: anchor,
                pop: { width: el.offsetWidth, height: el.offsetHeight },
                gap: gap ?? p.sideOffset ?? 8,
                align: p.align ?? 'center',
                side,
                alignOffset: p.alignOffset,
                avoidCollisions: p.avoidCollisions,
                clamp: bound ? intersectRects(view, bound) : view,
                originX: 0,
                originY: 0,
            });
            el.style.left = `${pos.left}px`;
            el.style.top = `${pos.top}px`;
            el.dataset.side = pos.side;
        },
        destroy: () => el.remove(),
    };
}

export interface AttachHoverCardOptions extends HoverCardPlacement {
    /** ms the pointer rests before the card opens (default 300). */
    openDelay?: number;
    /** @deprecated Use `openDelay`. */
    delay?: number;
    /** Where the card mounts: the themed shell root, so the card takes its theme. */
    host: HTMLElement;
}

/** Show a hover card for `trigger` while the pointer rests on it; `content` is read at each
 *  open (null: no card this time). Returns the detach. */
export function attachHoverCard(trigger: HTMLElement, content: () => HoverCardContent | null, opts: AttachHoverCardOptions): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let card: HoverCardHandle | null = null;
    const hide = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        card?.destroy();
        card = null;
    };
    const show = (): void => {
        const c = content();
        if (!c || !trigger.isConnected) return;
        card = createHoverCard(c, opts);
        opts.host.appendChild(card.el);
        card.place(trigger.getBoundingClientRect());
    };
    const enter = (): void => {
        hide();
        timer = setTimeout(show, opts.openDelay ?? opts.delay ?? 300);
    };
    trigger.addEventListener('pointerenter', enter);
    trigger.addEventListener('pointerleave', hide);
    trigger.addEventListener('pointerdown', hide);
    return () => {
        hide();
        trigger.removeEventListener('pointerenter', enter);
        trigger.removeEventListener('pointerleave', hide);
        trigger.removeEventListener('pointerdown', hide);
    };
}
