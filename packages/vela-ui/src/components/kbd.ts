// Kbd: one key of a shortcut, drawn as a keycap (`Alt`, `A`). A shortcut is a row of them;
// hover cards and menus show them beside the command they trigger.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';

export const kbdDef = defineComponent({
    name: 'kbd',
    parts: ['root'],
    settings: { radius: '5px', shadow: `inset 0 -1px 0 ${t.border}` },
});

export interface KbdProps {
    /** The key's label (`Alt`, `⌘`, `K`). */
    text: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface KbdHandle {
    readonly el: HTMLElement;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-kbd',
    css`
        @layer vela.ui {
            [data-slot='kbd'] {
                min-width: 18px;
                height: 18px;
                padding: 0 4px;
                border-radius: ${kbdDef.vars.radius};
                border: 1px solid ${t.border};
                border-bottom-color: color-mix(in srgb, ${t.fg.muted} 35%, transparent);
                background: ${t.hover};
                color: ${t.fg.bright};
                font: inherit;
                font-size: 10px;
                font-weight: 500;
                line-height: 1;
                box-shadow: ${kbdDef.vars.shadow};

                &:where(:not([hidden])) {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
            }
        }
    `,
);

export function createKbd(props: KbdProps): KbdHandle {
    injectStyles(document);
    const el = h('kbd', { className: props.className, slot: kbdDef.slot('root'), text: props.text });
    return { el, destroy: () => el.remove() };
}

/** A shortcut (`Alt+A`) as a row of keycaps, one per key. */
export function shortcutKeys(shortcut: string): HTMLElement[] {
    return shortcut.split('+').map((key) => createKbd({ text: key }).el);
}
