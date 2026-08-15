// Popover VIEW — a positioned floating shell. Content is caller-owned; this class
// owns portal, placement, capture-phase outside-dismiss, and the single-open registry.
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../styles';
import { ensureUIHost } from '../../tokens';
import {
    insetRect,
    intersectRects,
    placePopover,
    popoverController,
    viewportRect,
    type PopoverAlign,
    type PopoverControllerOptions,
    type PopoverPosition,
    type Rect,
} from './controller';
import { POPOVER_CSS, POPOVER_STYLE_ID } from './styles';

export type PopoverBoundary = 'viewport' | HTMLElement | (() => DOMRect | null);

export interface PopoverOptions extends PopoverControllerOptions {
    trigger: HTMLElement;
    content?: Node | ((body: HTMLElement) => void);
    /** Portal target. Defaults to `document.body`. Drawing chrome passes the chart host. */
    host?: HTMLElement;
    theme?: VelaTheme;
    className?: string;
    zIndex?: string | number;
    /** Clamp rectangle. `'viewport'` (default) or an element (dialog / chart host). */
    boundary?: PopoverBoundary;
}

let open: Popover | null = null;

/** Close whichever kit popover is showing (dialog teardown, a second trigger). */
export function closeOpenPopovers(): void {
    open?.hide();
}

export function isPopoverOpen(): boolean {
    return open !== null;
}

export function openPopoverTrigger(): HTMLElement | null {
    return open?.trigger ?? null;
}

function toRect(r: DOMRect): Rect {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

export class Popover {
    readonly el: HTMLElement;
    readonly trigger: HTMLElement;
    private readonly host: HTMLElement;
    private readonly ctrl: ReturnType<typeof popoverController>;
    private readonly boundary: PopoverBoundary;
    private readonly theme?: VelaTheme;
    private onOutside: ((e: Event) => void) | null = null;
    private onKey: ((e: KeyboardEvent) => void) | null = null;
    private onReflow: (() => void) | null = null;
    private shown = false;

    constructor(opts: PopoverOptions) {
        const doc = opts.trigger.ownerDocument;
        injectStyles(POPOVER_STYLE_ID, POPOVER_CSS, doc);
        this.trigger = opts.trigger;
        this.host = opts.host ?? doc.body;
        this.ctrl = popoverController(opts);
        this.boundary = opts.boundary ?? 'viewport';
        this.theme = opts.theme;

        this.el = doc.createElement('div');
        this.el.className = 'vela-popover vela-ui-layer' + (opts.className ? ` ${opts.className}` : '');
        this.el.dataset.position = this.ctrl.position;
        if (opts.zIndex !== undefined) this.el.style.zIndex = String(opts.zIndex);
        // Clicks inside must not bubble to a dialog's outside-dismiss.
        this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
        if (opts.content instanceof Node) this.el.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.el);
    }

    get open(): boolean {
        return this.shown;
    }

    get position(): PopoverPosition {
        return this.ctrl.position;
    }

    get align(): PopoverAlign {
        return this.ctrl.align;
    }

    show(): void {
        if (this.shown) {
            this.place();
            return;
        }
        if (open && open !== this) open.hide();
        ensureUIHost(this.el, this.theme);
        this.host.appendChild(this.el);
        this.shown = true;
        open = this;
        this.place();
        const onOutside = (ev: Event): void => {
            const t = ev.target as Node;
            if (this.el.contains(t) || this.trigger.contains(t)) return;
            this.hide();
        };
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            this.hide();
        };
        const onReflow = (): void => this.place();
        // Capture phase, deferred so the opening click does not immediately dismiss.
        setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onReflow, true);
        this.onOutside = onOutside;
        this.onKey = onKey;
        this.onReflow = onReflow;
    }

    hide(): void {
        if (!this.shown) return;
        if (this.onOutside) document.removeEventListener('pointerdown', this.onOutside, true);
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        if (this.onReflow) window.removeEventListener('resize', this.onReflow, true);
        this.onOutside = null;
        this.onKey = null;
        this.onReflow = null;
        this.el.remove();
        this.shown = false;
        if (open === this) open = null;
        this.ctrl.onClose?.();
    }

    /** Show if closed, hide if this instance is the open popover. */
    toggle(): void {
        if (this.shown) this.hide();
        else this.show();
    }

    destroy(): void {
        this.hide();
    }

    reposition(): void {
        if (this.shown) this.place();
    }

    private clampRect(): Rect {
        const view = viewportRect(window.innerWidth, window.innerHeight, this.ctrl.viewportInset);
        const bound = this.readBoundary();
        if (!bound) return view;
        const inset = insetRect(bound, this.ctrl.boundaryInset);
        return intersectRects(view, inset);
    }

    private readBoundary(): Rect | null {
        const b = this.boundary;
        if (b === 'viewport') return null;
        const raw = typeof b === 'function' ? b() : b.getBoundingClientRect();
        return raw ? toRect(raw) : null;
    }

    private place(): void {
        const ar = this.trigger.getBoundingClientRect();
        if (this.ctrl.matchWidth) {
            this.el.style.minWidth = `${Math.round(Math.max(this.el.offsetWidth, ar.width))}px`;
        }
        const origin = this.ctrl.position === 'absolute' ? this.host.getBoundingClientRect() : { left: 0, top: 0 };
        const pos = placePopover({
            trigger: toRect(ar),
            pop: { width: this.el.offsetWidth, height: this.el.offsetHeight },
            gap: this.ctrl.gap,
            align: this.ctrl.align,
            clamp: this.clampRect(),
            originX: origin.left,
            originY: origin.top,
        });
        this.el.style.left = `${pos.left}px`;
        this.el.style.top = `${pos.top}px`;
    }
}
