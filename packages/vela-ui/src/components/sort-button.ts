// SortButton: the header of a column that sorts a list which is not a table (a watchlist's
// Last and Day %). A press steps the sort: `firstDirection`, the other direction, then none
// when `clearable`. An arrow shows the direction, and a screen reader hears it after the
// label. Several of them sort one list: the host keeps one sorted and clears the others with
// `setDirection(null)`.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { msg, textOf, type Translator } from '../lib/i18n';
import { h } from '../lib/h';
import { iconEl } from '../lib/icons';
import { kitTranslator } from '../lib/kit-text';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';
import { nextUid } from '../lib/zag';

export const sortButtonDef = defineComponent({
    name: 'sort-button',
    parts: ['root', 'icon', 'state'],
    settings: { radius: t.radius.sm },
});

export const sortButtonVariants = variants({ align: ['start', 'end'] });

export type SortDirection = 'asc' | 'desc';

export interface SortButtonProps extends VariantProps<typeof sortButtonVariants> {
    /** The column's name. */
    label: string;
    /** The sort it starts with (default none). */
    direction?: SortDirection | null;
    /** What the first press sorts by (default `desc`: the largest first). */
    firstDirection?: SortDirection;
    /** A press after both directions clears the sort (default true). */
    clearable?: boolean;
    /** A press changed the sort; null: unsorted. */
    onSortChange?: (direction: SortDirection | null) => void;
    /** A tooltip (`Sort by Last`). */
    title?: string;
    disabled?: boolean;
    /** The translator of the words a screen reader hears ("sorted ascending"). Default: the
     *  kit build's, else English. */
    i18n?: Translator;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface SortButtonHandle {
    readonly el: HTMLButtonElement;
    readonly direction: SortDirection | null;
    /** Show a sort without calling `onSortChange`. */
    setDirection(direction: SortDirection | null): void;
    setDisabled(disabled: boolean): void;
    destroy(): void;
}

const TEXT = {
    asc: msg('ui.sortButton.ascending', 'sorted ascending'),
    desc: msg('ui.sortButton.descending', 'sorted descending'),
};

const injectStyles = defineStyles(
    'vela-ui-sort-button',
    css`
        @layer vela.ui {
            [data-slot='sort-button']:where(:not([hidden])) {
                all: unset;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                max-width: 100%;
                border-radius: ${sortButtonDef.vars.radius};
                color: ${t.fg.muted};
                font-size: 11px;
                font-weight: 500;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
                transition: color ${t.dur.fast} ease;

                &[data-align='end'] {
                    justify-content: flex-end;
                    text-align: end;
                }
                &:disabled {
                    cursor: default;
                    opacity: 0.5;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 1px;
                }
                &:not(:disabled):hover,
                &[data-direction] {
                    color: ${t.fg.bright};
                }
            }
            [data-slot='sort-button-icon'] {
                flex: none;
                width: 1em;
                height: 1em;
                font-size: 11px;
                line-height: 0;

                & > svg {
                    width: 100%;
                    height: 100%;
                }
            }
            [data-slot='sort-button-state'] {
                position: absolute;
                width: 1px;
                height: 1px;
                overflow: hidden;
                clip-path: inset(50%);
                white-space: nowrap;
            }
        }
    `,
);

class SortButtonImpl implements SortButtonHandle {
    readonly el: HTMLButtonElement;
    private readonly state: HTMLElement;
    private readonly i18n: Translator | null;
    private current: SortDirection | null;

    constructor(private readonly props: SortButtonProps) {
        injectStyles(document);
        this.i18n = props.i18n ?? kitTranslator();
        this.current = props.direction ?? null;
        const stateId = nextUid('vela-sort');
        this.state = h('span', { slot: sortButtonDef.slot('state'), attrs: { id: stateId } });
        this.el = h(
            'button',
            {
                className: props.className,
                slot: sortButtonDef.slot('root'),
                attrs: { type: 'button', title: props.title ?? null, 'aria-label': props.label, 'aria-describedby': stateId, ...sortButtonVariants(props) },
                on: { click: () => this.step() },
            },
            props.label,
            this.state,
        );
        this.el.disabled = props.disabled ?? false;
        this.paint();
    }

    get direction(): SortDirection | null {
        return this.current;
    }

    setDirection(direction: SortDirection | null): void {
        this.current = direction;
        this.paint();
    }

    setDisabled(disabled: boolean): void {
        this.el.disabled = disabled;
    }

    destroy(): void {}

    private step(): void {
        const first = this.props.firstDirection ?? 'desc';
        const second: SortDirection = first === 'desc' ? 'asc' : 'desc';
        const clearable = this.props.clearable ?? true;
        this.current = this.current === null ? first : this.current === first ? second : clearable ? null : first;
        this.paint();
        this.props.onSortChange?.(this.current);
    }

    private paint(): void {
        const dir = this.current;
        this.el.querySelector(`[data-slot="${sortButtonDef.slot('icon')}"]`)?.remove();
        if (dir) {
            const icon = iconEl(dir === 'asc' ? 'arrow-up' : 'arrow-down', document);
            icon.dataset.slot = sortButtonDef.slot('icon');
            this.state.before(icon);
        }
        this.el.toggleAttribute('data-direction', dir !== null);
        if (dir) this.el.dataset.direction = dir;
        this.state.textContent = dir ? textOf(this.i18n, TEXT[dir]) : '';
    }
}

export function createSortButton(props: SortButtonProps): SortButtonHandle {
    return new SortButtonImpl(props);
}
