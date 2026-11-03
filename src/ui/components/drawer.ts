// Drawer: a bottom sheet. A dimmed backdrop, a panel that slides up from the host's bottom
// edge, and a grab handle with drag-to-dismiss; the body is the caller's. It rides Zag's
// dialog machine (focus trap, dismissal, ARIA) with drawer defaults: a backdrop tap
// dismisses. Built for the mobile chrome, but host-agnostic like every kit component.
import * as dialog from '@zag-js/dialog';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';
import { announceSurface } from '../surface-events';
import { holdForExit, type SurfaceExit } from '../surface-exit';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../zag';

export interface DrawerControllerOptions {
    closeOnEscape?: boolean;
    /** Tap outside (on the backdrop) dismisses — default true. */
    closeOnInteractOutside?: boolean;
    /** Element to focus on open (default: the machine's first-tabbable pick). The view
     *  points this at the sheet itself so opening never focuses an input — on touch
     *  devices that would pop the on-screen keyboard over the sheet. */
    initialFocusEl?: () => HTMLElement | null;
    onOpenChange?: (open: boolean) => void;
}

export type DrawerService = dialog.Service;
export type DrawerApi = dialog.Api;

export interface DrawerController {
    machine: typeof dialog.machine;
    props: Partial<dialog.Props>;
    connect(service: DrawerService): DrawerApi;
}

/** Zag's dialog machine with the drawer's defaults, for any view layer. */
export function drawerController(opts: DrawerControllerOptions = {}): DrawerController {
    return {
        machine: dialog.machine,
        props: {
            id: nextUid('vela-drawer'),
            modal: true,
            closeOnEscape: opts.closeOnEscape ?? true,
            closeOnInteractOutside: opts.closeOnInteractOutside ?? true,
            initialFocusEl: opts.initialFocusEl,
            onOpenChange: (d: dialog.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<dialog.Props>,
        connect: (service: DrawerService): DrawerApi => dialog.connect(service, normalizeProps),
    };
}

export const drawerDef = defineComponent({
    name: 'drawer',
    parts: ['backdrop', 'positioner', 'content', 'grab', 'title', 'body'],
    settings: { radius: '14px 14px 0 0', 'grab-radius': '2px' },
});

const injectStyles = defineStyles(
    'vela-ui-drawer',
    css`
        @layer vela.ui {
            [data-slot='drawer-backdrop'] {
                position: fixed;
                inset: 0;
                background: ${t.backdrop};
                z-index: ${t.z.dialog};

                /* Inside a shell that declares a size class, the sheet scopes to the SHELL's
                   bounds (the widget root is position:relative) instead of the whole viewport:
                   an embedded chart must not curtain the host page. */
                &:is([data-layout] *) {
                    position: absolute;
                }
            }
            [data-slot='drawer-positioner'] {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: flex-end;
                justify-content: center;
                z-index: ${t.z.dialog};

                &:is([data-layout] *) {
                    position: absolute;
                }
            }
            [data-slot='drawer-content'] {
                background: ${t.surface};
                color: ${t.fg};
                border: 1px solid ${t.border.strong};
                border-bottom: none;
                border-radius: ${drawerDef.vars.radius};
                box-shadow: ${t.shadow.dialog};
                font-size: 13px;
                width: 100%;
                max-height: 85%;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                outline: 2px solid transparent;

                &[data-state='open'] {
                    animation: vela-drawer-in ${t.dur.med} ${t.ease};
                }
            }
            @keyframes vela-drawer-in {
                from {
                    transform: translateY(100%);
                }
                to {
                    transform: translateY(0);
                }
            }
            /* The grab zone owns its touches (drag-to-dismiss), so the browser must not scroll it. */
            [data-slot='drawer-grab'] {
                flex: none;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 10px 0 6px;
                cursor: grab;
                touch-action: none;
                user-select: none;

                &::before {
                    content: '';
                    width: 36px;
                    height: 4px;
                    border-radius: ${drawerDef.vars['grab-radius']};
                    background: ${t.border.strong};
                }
            }
            [data-slot='drawer-title'] {
                flex: none;
                padding: 0 16px 10px;
                font-size: 15px;
                font-weight: 600;
                letter-spacing: 0.2px;
                color: ${t.fg.bright};
                user-select: none;

                &:empty {
                    display: none;
                }
            }
            [data-slot='drawer-body'] {
                flex: 1 1 auto;
                min-height: 0;
                overflow-y: auto;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                /* Vertical pans stay native scrolling; horizontal moves reach the sheet's
                   gesture recognizer as pointer events (tab swipes). Without this the browser
                   claims a sideways touch as a scroll attempt and CANCELS the pointer stream,
                   so swipes never registered on real touch devices. Sideways-scrolling strips
                   inside the body opt back in with their own touch-action: pan-x. */
                touch-action: pan-y;
                padding: 0 ${t.space[3]} calc(${t.space[3]} + env(safe-area-inset-bottom, 0px));

                &::-webkit-scrollbar {
                    width: 8px;
                }
                &::-webkit-scrollbar-thumb {
                    background: ${t.scroll};
                    border-radius: ${t.radius.sm};
                    border: 2px solid transparent;
                    background-clip: padding-box;
                }
            }
        }
    `,
);
/** Drag past this fraction of the sheet's height (or this many px, whichever is
 *  smaller) and the release dismisses; anything less springs back. */
const DISMISS_FRACTION = 0.33;
const DISMISS_PX = 96;
/** Movement below this is a tap; past it the gesture commits to a direction. */
const SLOP_PX = 8;
/** A horizontal swipe must travel at least this far to fire `onSwipe`. */
const HSWIPE_MIN_PX = 48;

export type DrawerProps = DrawerOptions;

export interface DrawerOptions extends DrawerControllerOptions {
    title?: string;
    content?: Node | ((body: HTMLElement) => void);
    host?: HTMLElement;
    /** Horizontal swipe across the sheet (fires on release; `'left'` = the finger moved
     *  left). Gestures that start inside a horizontally scrollable strip (tabs, chip
     *  rows) keep their native scroll instead. */
    onSwipe?: (dir: 'left' | 'right') => void;
}

/** What the active pointer gesture has committed to (decided once past the slop). */
type GestureMode = 'idle' | 'pending' | 'drag' | 'hswipe' | 'scroll';

/**
 * Classify a pointer gesture over the sheet — PURE. `'pending'` until the movement
 * clears the slop; then a decidedly vertical downward pull becomes the dismiss `'drag'`
 * (only while every scroller under the finger is at rest — a scrolled list keeps native
 * scrolling), a decidedly horizontal move becomes an `'hswipe'` (when the sheet has a
 * swipe handler and the finger is not on a strip that scrolls sideways itself), and
 * everything else stays native `'scroll'`.
 */
export function classifyGesture(dx: number, dy: number, ctx: { canSwipe: boolean; scrolled: boolean; hScrollable: boolean }): 'pending' | 'drag' | 'hswipe' | 'scroll' {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return 'pending';
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 && !ctx.scrolled ? 'drag' : 'scroll';
    return ctx.canSwipe && !ctx.hScrollable ? 'hswipe' : 'scroll';
}

/** Whether releasing a dismiss drag at `dy` px closes the sheet — PURE. */
export function dragDismisses(dy: number, panelHeightPx: number): boolean {
    return dy >= Math.min(DISMISS_PX, panelHeightPx * DISMISS_FRACTION);
}

/** The direction a released horizontal swipe fires, or null when it was too short
 *  (or more vertical than horizontal after all) — PURE. */
export function swipeDirection(dx: number, dy: number): 'left' | 'right' | null {
    if (Math.abs(dx) < HSWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return null;
    return dx < 0 ? 'left' : 'right';
}

export class Drawer {
    /** Caller-owned content area — append your rows/lists here. */
    readonly body: HTMLElement;
    private readonly backdrop: HTMLElement;
    private readonly positioner: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly titleEl: HTMLElement;
    private readonly handle: HandleOf<typeof dialog.machine>;
    private readonly ctrl: DrawerController;

    constructor(opts: DrawerOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(doc);
        const host = opts.host ?? doc.body;

        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'vela-drawer-backdrop vela-ui-layer';
        this.backdrop.dataset.slot = drawerDef.slot('backdrop');
        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-drawer-positioner vela-ui-layer';
        this.positioner.dataset.slot = drawerDef.slot('positioner');
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-drawer';
        this.panel.dataset.slot = drawerDef.slot('content');
        // Programmatically focusable: the sheet itself takes the dialog machine's initial
        // focus — focusing the first tabbable (often a search input) would pop the
        // on-screen keyboard over a surface that just slid in.
        this.panel.tabIndex = -1;

        const grab = doc.createElement('div');
        grab.className = 'vela-drawer-grab';
        grab.dataset.slot = drawerDef.slot('grab');
        this.titleEl = doc.createElement('div');
        this.titleEl.className = 'vela-drawer-title';
        this.titleEl.dataset.slot = drawerDef.slot('title');
        this.titleEl.textContent = opts.title ?? '';

        this.body = doc.createElement('div');
        this.body.className = 'vela-drawer-body';
        this.body.dataset.slot = drawerDef.slot('body');
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        this.panel.append(grab, this.titleEl, this.body);
        this.positioner.appendChild(this.panel);
        host.append(this.backdrop, this.positioner);
        this.wireGestures(grab, opts.onSwipe);

        this.ctrl = drawerController({ ...opts, initialFocusEl: () => this.panel });
        const mid = String(this.ctrl.props.id);
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            // Close announces while the panel still shows (before the close props land), open once it does.
            const closing = this.wasOpen && !api.open;
            if (closing) this.announce(false);
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            spreadProps(this.titleEl, api.getTitleProps(), mid);
            // Dialog-family machines expect conditional rendering (their `hidden` reaches the
            // panel and backdrop only, and the sheet's authored display beats it) — the view
            // toggles visibility from `api.open` itself, once the exit animation of a close has run.
            if (api.open) {
                this.exit?.cancel();
                this.exit = null;
                this.setShown(true);
            } else if (closing) {
                this.holdExit();
            } else if (!this.exit) {
                this.setShown(false);
            }
            if (api.open && !this.wasOpen) this.announce(true);
            if (this.wasOpen && !api.open) this.restoreOpener();
            this.wasOpen = api.open;
        });
    }

    /** Any element between `from` and the panel that has already been scrolled down —
     *  a downward pull there must scroll it back up, never drag the sheet. */
    private scrolledAncestor(from: EventTarget | null): boolean {
        let el = from instanceof Element ? from : null;
        while (el && el !== this.panel) {
            if (el.scrollTop > 0) return true;
            el = el.parentElement;
        }
        return false;
    }

    /** Any element between `from` and the panel that scrolls horizontally on its own
     *  (the tab strip, chip rows) — a sideways move there is ITS scroll, not a swipe. */
    private hScrollableAncestor(from: EventTarget | null): boolean {
        let el = from instanceof Element ? from : null;
        while (el && el !== this.panel) {
            if (el.scrollWidth > el.clientWidth + 1) return true;
            el = el.parentElement;
        }
        return false;
    }

    /**
     * One gesture recognizer for the whole sheet. A downward pull dismisses from
     * anywhere — the grab handle immediately, the content once it is decidedly vertical
     * and its scroller is at rest (a scrolled list keeps native scrolling). A decidedly
     * horizontal move becomes an `onSwipe` (tabbed drawers flip pages with it). The
     * non-passive touchmove hook is what keeps the browser from claiming the pull as a
     * scroll once the sheet is (or may become) the drag target.
     */
    private wireGestures(grab: HTMLElement, onSwipe?: (dir: 'left' | 'right') => void): void {
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let dy = 0;
        let mode: GestureMode = 'idle';

        const beginDrag = (e: PointerEvent): void => {
            mode = 'drag';
            // Rebase so the sheet tracks from the commit point instead of jumping by the slop.
            startY = e.clientY;
            this.panel.style.transition = 'none';
            try {
                this.panel.setPointerCapture(e.pointerId);
            } catch {
                /* detached target or a test double without capture support */
            }
        };

        this.panel.addEventListener('pointerdown', (e) => {
            if (e.isPrimary === false) return;
            startX = e.clientX;
            startY = e.clientY;
            dx = 0;
            dy = 0;
            // The handle is a dedicated dismiss affordance (touch-action:none) — no slop.
            if (grab.contains(e.target as Node)) beginDrag(e);
            else mode = 'pending';
        });

        this.panel.addEventListener('pointermove', (e) => {
            if (mode === 'idle' || mode === 'scroll') return;
            dx = e.clientX - startX;
            dy = e.clientY - startY;
            if (mode === 'pending') {
                const intent = classifyGesture(dx, dy, {
                    canSwipe: !!onSwipe,
                    scrolled: this.scrolledAncestor(e.target),
                    hScrollable: this.hScrollableAncestor(e.target),
                });
                if (intent === 'pending') return;
                if (intent === 'drag') beginDrag(e);
                else mode = intent;
            }
            if (mode === 'drag') {
                dy = Math.max(0, e.clientY - startY);
                this.panel.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
            }
        });

        // Keep the browser's scroll logic off a pull the sheet owns (or may still claim):
        // without preventDefault here, the scroller grabs the touch and cancels the
        // pointer stream before the drag can commit. Only downward pulls on an at-rest
        // scroller are blocked — everything else keeps native behavior.
        this.panel.addEventListener(
            'touchmove',
            (e) => {
                if (mode === 'drag' || mode === 'hswipe') {
                    e.preventDefault();
                    return;
                }
                if (mode !== 'pending') return;
                const t = e.touches[0];
                if (!t) return;
                const mdx = t.clientX - startX;
                const mdy = t.clientY - startY;
                if (mdy > Math.abs(mdx) && !this.scrolledAncestor(e.target)) e.preventDefault();
            },
            { passive: false },
        );

        const settle = (): void => {
            if (mode === 'idle') return;
            const finished = mode;
            mode = 'idle';
            if (finished === 'drag') {
                this.panel.style.transition = '';
                this.panel.style.transform = '';
                if (dragDismisses(dy, this.panel.getBoundingClientRect().height)) this.hide();
            } else if (finished === 'hswipe') {
                const dir = swipeDirection(dx, dy);
                if (dir) onSwipe?.(dir);
            }
        };
        this.panel.addEventListener('pointerup', settle);
        this.panel.addEventListener('pointercancel', settle);
    }

    setTitle(title: string): void {
        this.titleEl.textContent = title;
    }

    private opener: HTMLElement | null = null;
    private wasOpen = false;
    /** The sheet and scrim's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private destroyed = false;

    private setShown(shown: boolean): void {
        this.backdrop.style.display = shown ? '' : 'none';
        this.positioner.style.display = shown ? '' : 'none';
    }

    /** Keep the just-closed sheet up through its exit animation, then hide it — or
     *  remove it, when it was destroyed meanwhile. `spreadProps` re-applies the close
     *  props' `hidden` only when its value changes, so lifting it keeps the sheet and
     *  scrim up until the exit ends. The positioner spans the host: inert, it lets
     *  clicks through to the page while the sheet animates out. */
    private holdExit(): void {
        const held = [this.panel, this.backdrop];
        for (const el of held) el.hidden = false;
        this.exit = holdForExit(
            held,
            () => {
                this.exit = null;
                if (this.destroyed) {
                    this.detach();
                } else if (!this.open) {
                    for (const el of held) el.hidden = true;
                    this.setShown(false);
                }
            },
            { inert: [this.positioner] },
        );
    }

    private detach(): void {
        this.backdrop.remove();
        this.positioner.remove();
    }

    /** Closing hands focus back to whatever opened it (Escape, the ✕, hide(), or a
     *  teardown that outruns the machine's close notification). */
    private restoreOpener(): void {
        const opener = this.opener;
        this.opener = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    private announce(open: boolean): void {
        const opener = this.opener === this.panel.ownerDocument.body ? null : this.opener;
        announceSurface(this.panel, open, 'drawer', opener);
    }

    get open(): boolean {
        return this.ctrl.connect(this.handle.service).open;
    }

    show(): void {
        this.opener = this.panel.ownerDocument.activeElement as HTMLElement | null;
        this.ctrl.connect(this.handle.service).setOpen(true);
    }

    hide(): void {
        this.ctrl.connect(this.handle.service).setOpen(false);
    }

    destroy(): void {
        // Closed but not projected yet — an owner disposing of the sheet as it reports
        // closing: project the close now, so it animates out like any other close and
        // leaves the DOM when its exit ends. A teardown while open leaves at once.
        if (this.wasOpen && !this.open) this.handle.flush();
        this.handle.stop();
        this.destroyed = true;
        // Torn down while open: the stopped machine never projects the close.
        if (this.wasOpen) {
            this.wasOpen = false;
            this.announce(false);
        }
        this.restoreOpener();
        if (!this.exit) this.detach();
    }
}

export function createDrawer(props: DrawerProps = {}): Drawer {
    return new Drawer(props);
}
