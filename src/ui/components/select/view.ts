// Select VIEW — trigger button + portaled themed list (hand-rolled overlay scrollbar).
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { Popover, closeOpenPopovers, openPopoverTrigger, type PopoverBoundary, type PopoverOptions } from '../popover';
import { selectController, type SelectControllerOptions, type SelectOption, type SelectSize } from './controller';
import { SELECT_CSS, SELECT_STYLE_ID } from './styles';

export interface SelectListPopoverOpts {
    theme?: VelaTheme;
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
    theme?: VelaTheme;
    /** Placement for the open list (dialog-rect clamp, etc.). */
    list?: SelectListPopoverOpts;
}

function ensureSelectStyles(doc: Document): void {
    injectStyles(SELECT_STYLE_ID, SELECT_CSS, doc);
}

function syncThumb(list: HTMLElement, thumb: HTMLElement): void {
    const view = list.clientHeight;
    const total = list.scrollHeight;
    if (total <= view) { thumb.style.height = '0'; return; }
    const thumbH = Math.max(20, (view / total) * view);
    const top = (list.scrollTop / (total - view)) * (view - thumbH);
    thumb.style.height = `${Math.round(thumbH)}px`;
    thumb.style.transform = `translateY(${Math.round(top)}px`;
}

/** Fill `menu` with option buttons. Call {@link decorateSelectScroll} after the menu is on screen. */
export function fillSelectList(
    menu: HTMLElement,
    options: readonly SelectOption[],
    current: string,
    onPick: (value: string, label: string) => void,
): void {
    menu.replaceChildren();
    const list = menu.ownerDocument.createElement('div');
    list.className = 'vela-select-items';
    for (const p of options) {
        const item = menu.ownerDocument.createElement('button');
        item.type = 'button';
        item.className = 'vela-select-item';
        item.textContent = p.label;
        if (p.value === current) item.dataset.checked = '1';
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onPick(p.value, p.label);
        });
        list.appendChild(item);
    }
    menu.appendChild(list);
}

/** Overlay scrollbar + scroll-into-view — needs a laid-out list (after the popover is shown). */
export function decorateSelectScroll(menu: HTMLElement): void {
    const list = menu.querySelector('.vela-select-items') as HTMLElement | null;
    if (!list) return;
    if (list.scrollHeight > 240) {
        menu.classList.add('is-scroll');
        const rail = menu.ownerDocument.createElement('div');
        rail.className = 'vela-select-rail';
        const thumb = menu.ownerDocument.createElement('div');
        thumb.className = 'vela-select-thumb';
        rail.appendChild(thumb);
        menu.appendChild(rail);
        list.addEventListener('scroll', () => syncThumb(list, thumb));
        syncThumb(list, thumb);
    }
    menu.querySelector<HTMLElement>('.vela-select-item[data-checked]')?.scrollIntoView({ block: 'nearest' });
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
    ensureSelectStyles(trigger.ownerDocument);
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
    private readonly ctrl: ReturnType<typeof selectController>;
    private readonly listOpts: SelectListPopoverOpts;
    private list: Popover | null = null;

    constructor(opts: SelectOptions) {
        const doc = opts.list?.host?.ownerDocument ?? document;
        ensureSelectStyles(doc);
        this.ctrl = selectController(opts);
        this.listOpts = { ...opts.list, theme: opts.theme ?? opts.list?.theme, size: this.ctrl.size };

        const wrap = doc.createElement('div');
        wrap.className = 'vela-select';
        wrap.dataset.size = this.ctrl.size;
        if (this.ctrl.fill) wrap.dataset.fill = '';

        const btn = doc.createElement('button');
        btn.type = 'button';
        if (opts.id) btn.id = opts.id;
        btn.className = 'vela-select-trigger';
        if (this.ctrl.disabled) btn.disabled = true;
        const label = doc.createElement('span');
        label.className = 'vela-select-label';
        label.textContent = this.ctrl.labelOf(this.ctrl.value);
        const chevron = doc.createElement('span');
        chevron.className = 'vela-select-chevron';
        chevron.appendChild(iconEl('chevron-down', doc));
        btn.append(label, chevron);
        wrap.appendChild(btn);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.el = wrap;
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
            { ...this.listOpts, onClose: () => { this.list = null; this.listOpts.onClose?.(); } },
        );
    }

    destroy(): void {
        this.list?.hide();
        this.list = null;
    }
}
