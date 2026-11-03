// Select: a trigger button and a themed option list on a popover, with an overlay scrollbar
// for long lists. `md` is the shared 100px kit column and ellipsizes the trigger; `sm` is a
// compact toolbar select that hugs its widest option. The open list shows full labels.
import type { ChartTheme } from '../lib/tokens';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { addSlot, h } from '../lib/h';
import { t } from '../lib/t';
import { variants } from '../lib/variants';
import { Popover, closeOpenPopovers, openPopoverTrigger, type PopoverBoundary, type PopoverOptions } from './popover';

export type SelectSize = 'sm' | 'md';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectControllerOptions {
    options: readonly SelectOption[];
    value?: string;
    size?: SelectSize;
    /** Stretch the trigger to its parent. Off: the shared 100px kit column (ellipsis). */
    fill?: boolean;
    disabled?: boolean;
    onChange?: (value: string, label: string) => void;
}

export interface SelectController {
    options: readonly SelectOption[];
    value: string;
    size: SelectSize;
    fill: boolean;
    disabled: boolean;
    setValue(v: string): void;
    labelOf(value: string): string;
    pick(value: string): { value: string; label: string };
}

/** The select's options and current value, without DOM. */
export function selectController(opts: SelectControllerOptions): SelectController {
    const options = opts.options;
    let value = opts.value ?? options[0]?.value ?? '';
    const size = opts.size ?? 'md';
    return {
        options,
        get value() {
            return value;
        },
        size,
        fill: opts.fill ?? size !== 'sm',
        disabled: opts.disabled ?? false,
        setValue(v: string) {
            value = v;
        },
        labelOf(v: string) {
            return options.find((o) => o.value === v)?.label ?? v;
        },
        pick(v: string) {
            value = v;
            const label = options.find((o) => o.value === v)?.label ?? v;
            opts.onChange?.(v, label);
            return { value: v, label };
        },
    };
}

export const selectDef = defineComponent({
    name: 'select',
    parts: ['root', 'trigger', 'value', 'icon', 'sizer', 'content', 'viewport', 'item', 'rail', 'thumb'],
    settings: { radius: t.radius.md, 'content-radius': t.radius.md, 'thumb-radius': '2px', 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

export const selectVariants = variants({ size: ['md', 'sm'] });

export interface SelectListPopoverOpts {
    theme?: ChartTheme;
    matchWidth?: boolean;
    boundary?: PopoverBoundary;
    boundaryInset?: number;
    gap?: number;
    align?: PopoverOptions['align'];
    host?: HTMLElement;
    position?: PopoverOptions['position'];
    zIndex?: string | number;
    size?: SelectSize;
    onClose?: () => void;
}

export interface SelectOptions extends SelectControllerOptions {
    id?: string;
    theme?: ChartTheme;
    /** Placement for the open list (dialog-rect clamp, etc.). */
    list?: SelectListPopoverOpts;
}

export type SelectProps = SelectOptions;

export const SELECT_STYLE_ID = 'vela-ui-select-3';

export const SELECT_CSS = css`
    @layer vela.ui {
        [data-slot='select-trigger'] {
            display: flex;
            align-items: center;
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            height: 34px;
            padding-block: 0;
            padding-inline: 8px 26px;
            background: transparent;
            border: 1px solid ${t.border.strong};
            border-radius: ${selectDef.vars.radius};
            color: ${t.fg.bright};
            font-size: 14px;
            font-family: inherit;
            cursor: pointer;
            text-align: start;
            outline: 2px solid transparent;
            transition:
                border-color ${t.dur.fast} ease,
                box-shadow ${t.dur.fast} ease;

            &:hover {
                border-color: ${t.fg.muted};
            }
            &:focus {
                border-color: ${t.focus};
                box-shadow: ${selectDef.vars['focus-ring']};
            }
        }
        [data-slot='select-value'] {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        [data-slot='select-icon'] {
            position: absolute;
            inset-inline-end: 8px;
            top: 50%;
            transform: translateY(-50%);
            pointer-events: none;
            display: flex;
            opacity: 0.55;
            line-height: 0;
            color: inherit;

            & > span,
            & svg {
                width: 12px;
                height: 12px;
                display: block;
            }
        }
        [data-slot='select-sizer'] {
            visibility: hidden;
            height: 0;
            overflow: hidden;
            font-size: 13px;

            & span {
                display: block;
                height: 0;
                white-space: nowrap;
                padding-block: 0;
                padding-inline: 8px 26px;
                border-inline: 1px solid transparent;
            }
        }
        [data-slot='select-viewport'] {
            width: max-content;
            min-width: 100%;
            max-height: none;
            overflow: hidden;
        }
        [data-slot='select-rail'] {
            position: relative;
            flex: none;
            width: 3px;
            margin-block: 2px;
            margin-inline: 0 1px;
            pointer-events: none;
        }
        [data-slot='select-thumb'] {
            width: 3px;
            border-radius: ${selectDef.vars['thumb-radius']};
            background: ${t.scroll};
        }
        [data-slot='select-item'] {
            display: block;
            width: auto;
            min-width: 100%;
            white-space: nowrap;
            text-align: start;
            padding: 7px 10px;
            border: none;
            border-radius: ${t.radius.sm};
            background: transparent;
            color: inherit;
            cursor: pointer;
            font: inherit;
            font-weight: 400;

            &:hover {
                background: ${t.hover};
            }
            &[data-checked] {
                background: ${t.hover.strong};
                color: ${t.fg.bright};
            }
            &[data-checked]:hover {
                background: ${t.hover.strong};
            }
        }
        [data-slot='select'] {
            position: relative;
            min-width: 0;

            &:where(:not([hidden])) {
                display: inline-block;
            }
            &[data-fill] {
                width: 100%;
            }
            /* The closed trigger matches NumberInput and TextField (100px); long labels
               ellipsize, and the open list still sizes to the longest item. */
            &:not([data-fill]) {
                width: 100px;
                flex: none;
                justify-self: start;
            }
            &[data-size='sm'] [data-slot='select-trigger'] {
                height: 28px;
                background: ${t.surface.elev};
                border-radius: ${t.radius.sm};
                color: ${t.fg};
                font-size: 13px;
                box-shadow: none;
            }
            &[data-size='sm'] [data-slot='select-trigger']:focus {
                box-shadow: none;
                border-color: ${t.fg.muted};
            }
            /* Compact toolbar selects still hug the widest option (no 100px kit column). */
            &[data-size='sm']:not([data-fill]) {
                width: auto;
                max-width: 200px;
            }
        }
        [data-slot~='select-content'] {
            width: max-content;
            background: ${t.bg};
            color: ${t.fg};
            border: none;
            border-radius: ${selectDef.vars['content-radius']};
            box-shadow: ${t.shadow};
            font: 14px ${t.font};
            padding: 4px;
            overflow: hidden;

            &[data-size='sm'] {
                font-size: 13px;
                background: ${t.surface.overlay};
            }
            &[data-scroll] {
                display: flex;
                align-items: stretch;
                gap: 2px;
            }
            &[data-scroll] [data-slot='select-viewport'] {
                flex: 1 1 auto;
                min-width: min-content;
                max-height: 240px;
                overflow-y: auto;
                scrollbar-width: none;
            }
            &[data-scroll] [data-slot='select-viewport']::-webkit-scrollbar {
                display: none;
                width: 0;
                height: 0;
            }
        }
    }
`;

const injectStyles = defineStyles(SELECT_STYLE_ID, SELECT_CSS);

function syncThumb(list: HTMLElement, thumb: HTMLElement): void {
    const view = list.clientHeight;
    const total = list.scrollHeight;
    if (total <= view) {
        thumb.style.height = '0';
        return;
    }
    const thumbH = Math.max(20, (view / total) * view);
    const top = (list.scrollTop / (total - view)) * (view - thumbH);
    thumb.style.height = `${Math.round(thumbH)}px`;
    thumb.style.transform = `translateY(${Math.round(top)}px`;
}

/** Fill `menu` with option buttons. Call {@link decorateSelectScroll} after the menu is on screen. */
export function fillSelectList(menu: HTMLElement, options: readonly SelectOption[], current: string, onPick: (value: string, label: string) => void): void {
    injectStyles(menu.ownerDocument);
    addSlot(menu, selectDef.slot('content'));
    menu.replaceChildren(
        h(
            'div',
            { className: 'vela-select-items', slot: selectDef.slot('viewport') },
            options.map((p) =>
                h('button', {
                    className: 'vela-select-item',
                    slot: selectDef.slot('item'),
                    attrs: { type: 'button' },
                    data: { checked: p.value === current ? '1' : null },
                    text: p.label,
                    on: {
                        click: (e) => {
                            e.stopPropagation();
                            onPick(p.value, p.label);
                        },
                    },
                }),
            ),
        ),
    );
}

/** Overlay scrollbar + scroll-into-view — needs a laid-out list (after the popover is shown). */
export function decorateSelectScroll(menu: HTMLElement): void {
    const list = menu.querySelector<HTMLElement>(`[data-slot='${selectDef.slot('viewport')}']`);
    if (!list) return;
    if (list.scrollHeight > 240) {
        menu.classList.add('is-scroll');
        menu.dataset.scroll = '';
        const thumb = h('div', { className: 'vela-select-thumb', slot: selectDef.slot('thumb') });
        menu.appendChild(h('div', { className: 'vela-select-rail', slot: selectDef.slot('rail') }, thumb));
        list.addEventListener('scroll', () => syncThumb(list, thumb));
        syncThumb(list, thumb);
    }
    menu.querySelector<HTMLElement>(`[data-slot='${selectDef.slot('item')}'][data-checked]`)?.scrollIntoView({ block: 'nearest' });
    list.dispatchEvent(new Event('scroll'));
}

/** Open (or re-click close) a themed option list under `trigger`. */
export function toggleSelectList(
    trigger: HTMLElement,
    options: readonly SelectOption[],
    current: string,
    onPick: (value: string, label: string) => void,
    opts: SelectListPopoverOpts = {},
): Popover | null {
    if (openPopoverTrigger() === trigger) {
        closeOpenPopovers();
        return null;
    }
    return openSelectList(trigger, options, current, onPick, opts);
}

export function openSelectList(
    trigger: HTMLElement,
    options: readonly SelectOption[],
    current: string,
    onPick: (value: string, label: string) => void,
    opts: SelectListPopoverOpts = {},
): Popover {
    injectStyles(trigger.ownerDocument);
    closeOpenPopovers();
    const pop = new Popover({
        trigger,
        theme: opts.theme,
        matchWidth: opts.matchWidth ?? true,
        boundary: opts.boundary,
        boundaryInset: opts.boundaryInset,
        gap: opts.gap ?? 4,
        align: opts.align ?? 'start',
        host: opts.host,
        position: opts.position,
        zIndex: opts.zIndex,
        className: 'vela-select-list',
        slot: selectDef.slot('content'),
        onClose: opts.onClose,
        content: (el) => {
            if (opts.size) el.dataset.size = opts.size;
            fillSelectList(el, options, current, (value, label) => {
                pop.hide();
                onPick(value, label);
            });
        },
    });
    pop.show();
    decorateSelectScroll(pop.el);
    pop.reposition();
    return pop;
}

export class Select {
    readonly el: HTMLElement;
    private readonly trigger: HTMLButtonElement;
    private readonly labelEl: HTMLElement;
    private readonly ctrl: SelectController;
    private readonly listOpts: SelectListPopoverOpts;
    private list: Popover | null = null;

    constructor(opts: SelectOptions) {
        const doc = opts.list?.host?.ownerDocument ?? document;
        injectStyles(doc);
        this.ctrl = selectController(opts);
        this.listOpts = { ...opts.list, theme: opts.theme ?? opts.list?.theme, size: this.ctrl.size };

        const label = h('span', { className: 'vela-select-label', slot: selectDef.slot('value'), text: this.ctrl.labelOf(this.ctrl.value) });
        const btn = h(
            'button',
            { className: 'vela-select-trigger', slot: selectDef.slot('trigger'), attrs: { type: 'button', id: opts.id } },
            label,
            h('span', { className: 'vela-select-chevron', slot: selectDef.slot('icon') }, iconEl('chevron-down', doc)),
        );
        btn.disabled = this.ctrl.disabled;
        // Compact toolbar selects hug the widest option. md uses a fixed 100px
        // column and ellipsizes the trigger; the open list still shows full labels.
        const sizer =
            this.ctrl.size === 'sm'
                ? h(
                      'div',
                      { className: 'vela-select-sizer', slot: selectDef.slot('sizer'), attrs: { 'aria-hidden': 'true' } },
                      this.ctrl.options.map((o) => h('span', { text: o.label })),
                  )
                : null;
        this.el = h('div', { className: 'vela-select', slot: selectDef.slot('root'), attrs: selectVariants({ size: this.ctrl.size }), data: { fill: this.ctrl.fill } }, btn, sizer);

        // Suppress the default mousedown focus: when this press outside-dismisses an open
        // popover, Chrome's focus action can scroll the dialog body under the pointer.
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            btn.focus({ preventScroll: true });
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.trigger = btn;
        this.labelEl = label;
    }

    get value(): string {
        return this.ctrl.value;
    }

    setValue(v: string): void {
        this.ctrl.setValue(v);
        this.labelEl.textContent = this.ctrl.labelOf(v);
    }

    toggle(): void {
        this.list = toggleSelectList(
            this.trigger,
            this.ctrl.options,
            this.ctrl.value,
            (value, label) => {
                this.ctrl.pick(value);
                this.labelEl.textContent = label;
                this.list = null;
            },
            {
                ...this.listOpts,
                onClose: () => {
                    this.list = null;
                    this.listOpts.onClose?.();
                },
            },
        );
    }

    destroy(): void {
        this.list?.hide();
        this.list = null;
    }
}

export function createSelect(props: SelectProps): Select {
    return new Select(props);
}
