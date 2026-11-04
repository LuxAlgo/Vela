// Empty: what a panel shows when it has nothing to list: an icon in a tile, a title, a
// line saying why or what to do, and an optional action (a button that fills it).
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { iconEl } from '../lib/icons';
import { t } from '../lib/t';

export const emptyDef = defineComponent({
    name: 'empty',
    parts: ['root', 'icon', 'title', 'description'],
    settings: { 'icon-radius': '9px' },
});

export interface EmptyProps {
    /** Icon id from the kit's registry, shown in a tile above the title. */
    icon?: string;
    title: string;
    description?: string;
    /** A control under the text (a button that adds the first item). */
    action?: HTMLElement;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface EmptyHandle {
    readonly el: HTMLElement;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-empty-state',
    css`
        @layer vela.ui {
            [data-slot='empty'] {
                padding: 28px 16px;
                text-align: center;
                color: ${t.fg.muted};

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }
            }
            [data-slot='empty-icon'] {
                width: 32px;
                height: 32px;
                padding: 7px;
                border-radius: ${emptyDef.vars['icon-radius']};
                background: ${t.hover};
                color: ${t.fg};

                & > svg {
                    width: 18px;
                    height: 18px;
                }
            }
            [data-slot='empty-title'] {
                font-size: 12.5px;
                font-weight: 600;
                color: ${t.fg.bright};
            }
            [data-slot='empty-description'] {
                max-width: 260px;
                font-size: 11.5px;
                line-height: 1.45;
            }
        }
    `,
);

export function createEmpty(props: EmptyProps): EmptyHandle {
    injectStyles(document);
    let icon: HTMLElement | null = null;
    if (props.icon) {
        icon = iconEl(props.icon, document);
        icon.dataset.slot = emptyDef.slot('icon');
    }
    const el = h(
        'div',
        { className: props.className, slot: emptyDef.slot('root') },
        icon,
        h('div', { slot: emptyDef.slot('title'), text: props.title }),
        props.description ? h('div', { slot: emptyDef.slot('description'), text: props.description }) : null,
        props.action ?? null,
    );
    return { el, destroy: () => el.remove() };
}
