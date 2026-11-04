// Popover: a positioned floating shell. Content is the caller's; the shell owns the portal,
// the placement (on a side of the trigger, flipping to the other near the clamp edge), the capture-phase
// outside dismissal and the single-open registry. A component built on it (a select list, a
// color picker) adds its own part to the shell's slot: `data-slot="popover-content
// select-content"`, matched with `~=`.
import type { ChartTheme } from '../lib/tokens';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { announceSurface } from '../lib/surface-events';
import { holdForExit, type SurfaceExit } from '../lib/surface-exit';
import { ensureUIHost, floatingLayerHost } from '../lib/theme';
import { insetRect, intersectRects, placePopover, viewportRect, type Align, type CollisionBoundary, type PlacementProps, type Rect, type Side } from '../lib/placement';

export type { Align, CollisionBoundary, PlacementProps, Side } from '../lib/placement';
export type PopoverAlign = Align;
export type PopoverSide = Side;
export type PopoverPosition = 'fixed' | 'absolute';

export { insetRect, intersectRects, placePopover, viewportRect, type PlaceArgs, type PlaceResult, type Rect } from '../lib/placement';

export interface PopoverControllerOptions extends Omit<PlacementProps, 'collisionBoundary'> {
    /** @deprecated Use `sideOffset`. */
    gap?: number;
    matchWidth?: boolean;
    position?: PopoverPosition;
    /** Room kept inside `collisionBoundary` (default 0; `collisionPadding` sets it too). */
    boundaryInset?: number;
    /** Room kept from the viewport's edges (default 6; `collisionPadding` sets it too). */
    viewportInset?: number;
    onClose?: () => void;
}

export interface PopoverController {
    side: PopoverSide;
    /** The distance from the trigger (`sideOffset`). */
    gap: number;
    align: PopoverAlign;
    alignOffset: number;
    avoidCollisions: boolean;
    matchWidth: boolean;
    position: PopoverPosition;
    boundaryInset: number;
    viewportInset: number;
    onClose?: () => void;
}

/** The popover's placement options with their defaults, without DOM. */
export function popoverController(opts: PopoverControllerOptions = {}): PopoverController {
    return {
        side: opts.side ?? 'bottom',
        gap: opts.sideOffset ?? opts.gap ?? 4,
        align: opts.align ?? 'start',
        alignOffset: opts.alignOffset ?? 0,
        avoidCollisions: opts.avoidCollisions ?? true,
        matchWidth: opts.matchWidth ?? false,
        position: opts.position ?? 'fixed',
        boundaryInset: opts.collisionPadding ?? opts.boundaryInset ?? 0,
        viewportInset: opts.collisionPadding ?? opts.viewportInset ?? 6,
        onClose: opts.onClose,
    };
}

export const popoverDef = defineComponent({ name: 'popover', parts: ['content'] });

export type PopoverBoundary = CollisionBoundary;

export interface PopoverOptions extends PopoverControllerOptions {
    trigger: HTMLElement;
    content?: Node | ((body: HTMLElement) => void);
    /** Portal target. Defaults to `document.body`. Drawing chrome passes the chart host. */
    host?: HTMLElement;
    theme?: ChartTheme;
    className?: string;
    /** The part a component built on the popover adds to the shell's slot. */
    slot?: string;
    zIndex?: string | number;
    /** The area it stays inside: `'viewport'` (default), an element (dialog, chart host) or a
     *  rectangle read at each placement. */
    collisionBoundary?: PopoverBoundary;
    /** @deprecated Use `collisionBoundary`. */
    boundary?: PopoverBoundary;
    /** Fade the shell in on show and out on hide over this many ms (default 0 — instant). */
    fadeMs?: number;
}

export type PopoverProps = PopoverOptions;

export const POPOVER_STYLE_ID = 'vela-ui-popover';

export const POPOVER_CSS = css`
    @layer vela.ui {
        [data-slot~='popover-content'] {
            position: fixed;
            z-index: ${t.z.popover};
            box-sizing: border-box;
            /* Never serve as a scroll anchor: the shell is portaled and re-placed between
               gestures, and anchoring against it jumps the scroller underneath. */
            overflow-anchor: none;

            &[data-position='absolute'] {
                position: absolute;
            }
        }
    }
`;

const injectStyles = defineStyles(POPOVER_STYLE_ID, POPOVER_CSS);

let open: Popover | null = null;
/** Closed popovers still playing their exit animation. */
const leaving = new Set<Popover>();

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

/** Flag stamped on a pointer event whose only job was dismissing an open popover. */
const POPOVER_DISMISS_FLAG = '__velaPopoverDismiss';

function markPopoverDismiss(e: Event): void {
    (e as Event & { [POPOVER_DISMISS_FLAG]?: boolean })[POPOVER_DISMISS_FLAG] = true;
}

/**
 * True when this event already dismissed a popover on its way down — a dialog's
 * outside-click close must swallow it instead of closing the dialog too (the popover
 * hides itself on document CAPTURE, so by the time a backdrop listener runs,
 * {@link isPopoverOpen} is already false).
 */
export function eventDismissedPopover(e: Event): boolean {
    return (e as Event & { [POPOVER_DISMISS_FLAG]?: boolean })[POPOVER_DISMISS_FLAG] === true;
}

function toRect(r: DOMRect): Rect {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

export class Popover {
    readonly el: HTMLElement;
    readonly trigger: HTMLElement;
    private readonly host: HTMLElement;
    private readonly ctrl: PopoverController;
    private readonly boundary: PopoverBoundary;
    private readonly theme?: ChartTheme;
    /** Hosted under a `.vela-ui` we resolved ourselves — its tokens win over `theme`. */
    private readonly inheritsTokens: boolean;
    private onOutside: ((e: Event) => void) | null = null;
    private onKey: ((e: KeyboardEvent) => void) | null = null;
    private onReflow: (() => void) | null = null;
    private shown = false;
    private readonly fadeMs: number;
    /** The pending removal of a fading-out shell; a show() that reuses the shell cancels it. */
    private leaveTimer: ReturnType<typeof setTimeout> | null = null;
    /** The shell's exit animation before it leaves the DOM; a show() that reuses the shell cancels it. */
    private exit: SurfaceExit | null = null;

    constructor(opts: PopoverOptions) {
        const doc = opts.trigger.ownerDocument;
        injectStyles(doc);
        this.trigger = opts.trigger;
        // No explicit host: portal to the trigger's `.vela-ui` (app-theme tokens) rather
        // than <body>. Explicit hosts (drawing chrome, mark popups) keep their own tokens.
        this.host = opts.host ?? floatingLayerHost(opts.trigger, doc.body);
        this.inheritsTokens = !opts.host && this.host !== doc.body;
        this.ctrl = popoverController(opts);
        this.boundary = opts.collisionBoundary ?? opts.boundary ?? 'viewport';
        this.theme = opts.theme;
        this.fadeMs = Math.max(0, opts.fadeMs ?? 0);

        this.el = h('div', {
            className: 'vela-popover vela-ui-layer' + (opts.className ? ` ${opts.className}` : ''),
            slot: opts.slot ? `${popoverDef.slot('content')} ${opts.slot}` : popoverDef.slot('content'),
            data: { position: this.ctrl.position },
        });
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
        if (this.leaveTimer !== null) {
            clearTimeout(this.leaveTimer);
            this.leaveTimer = null;
        }
        this.exit?.cancel();
        this.exit = null;
        leaving.delete(this);
        // Owners that build a fresh popover per open (color pickers, select lists): the new
        // one takes the place of the one still leaving from the same trigger.
        for (const p of [...leaving]) if (p.trigger === this.trigger) p.exit?.finish();
        // A caller theme is often the live plot surface (settings dialogs pass
        // `this.theme`); stamping it on a `.vela-ui`-hosted shell would recolor the
        // list to layout.background.
        ensureUIHost(this.el, this.inheritsTokens ? undefined : this.theme);
        if (this.fadeMs > 0) {
            this.el.style.transition = `opacity ${this.fadeMs}ms ease`;
            this.el.style.opacity = '0';
            this.el.style.pointerEvents = '';
        }
        this.host.appendChild(this.el);
        this.shown = true;
        open = this;
        this.place();
        // place() measured the shell (a style flush at opacity 0) — flipping it now runs the transition.
        if (this.fadeMs > 0) this.el.style.opacity = '1';
        const onOutside = (ev: Event): void => {
            const target = ev.target as Node;
            if (this.el.contains(target) || this.trigger.contains(target)) return;
            // Mark the event: it spent itself dismissing this popover, so listeners
            // further down the path (a dialog backdrop) must not ALSO dismiss on it.
            markPopoverDismiss(ev);
            this.hide();
        };
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            this.hide();
        };
        const onReflow = (): void => this.place();
        // Capture phase, deferred so the opening click does not immediately dismiss — and only
        // if this show is still the live one: a hide (or hide + show) in the same tick cleared or
        // replaced the handler, and attaching it then would leave it behind for good.
        setTimeout(() => {
            if (this.onOutside === onOutside) document.addEventListener('pointerdown', onOutside, true);
        }, 0);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onReflow, true);
        // A scroll anywhere (dialog body, chart container) moves the trigger while the
        // popover is fixed — re-place so the shell tracks it instead of detaching.
        document.addEventListener('scroll', onReflow, true);
        this.onOutside = onOutside;
        this.onKey = onKey;
        this.onReflow = onReflow;
        // Last: a listener may hide it again at once, and must find it fully open.
        announceSurface(this.el, true, 'popover', this.trigger);
    }

    hide(): void {
        if (!this.shown) return;
        // Closed before announcing (a listener's own hide() must not re-enter), but still
        // attached — a fade-out or removal follows — so the close bubbles to the host.
        this.shown = false;
        announceSurface(this.el, false, 'popover', this.trigger);
        if (this.onOutside) document.removeEventListener('pointerdown', this.onOutside, true);
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        if (this.onReflow) {
            window.removeEventListener('resize', this.onReflow, true);
            document.removeEventListener('scroll', this.onReflow, true);
        }
        this.onOutside = null;
        this.onKey = null;
        this.onReflow = null;
        if (this.fadeMs > 0) {
            // Fade out, then leave the DOM; the shell is inert meanwhile (no listeners, not `open`, no hits).
            this.el.style.opacity = '0';
            this.el.style.pointerEvents = 'none';
            this.leaveTimer = setTimeout(() => {
                this.leaveTimer = null;
                this.el.remove();
            }, this.fadeMs);
        } else {
            this.exit = holdForExit(this.el, () => {
                this.exit = null;
                leaving.delete(this);
                this.el.remove();
            });
            if (this.exit) leaving.add(this);
        }
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
        this.exit?.finish();
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
            side: this.ctrl.side,
            alignOffset: this.ctrl.alignOffset,
            avoidCollisions: this.ctrl.avoidCollisions,
            clamp: this.clampRect(),
            originX: origin.left,
            originY: origin.top,
        });
        this.el.style.left = `${pos.left}px`;
        this.el.style.top = `${pos.top}px`;
        this.el.dataset.side = pos.side;
        this.el.dataset.align = this.ctrl.align;
    }
}

export function createPopover(props: PopoverProps): Popover {
    return new Popover(props);
}
