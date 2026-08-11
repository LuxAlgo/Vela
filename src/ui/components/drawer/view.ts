// Drawer VIEW — a bottom sheet: dimmed backdrop, a panel that slides up from the host's
// bottom edge, a grab handle with drag-to-dismiss. The body is caller-owned. Built for
// the mobile chrome, but host-agnostic like every kit component.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { drawerController, type DrawerControllerOptions } from './controller';
import { DRAWER_CSS, DRAWER_STYLE_ID } from './styles';
import * as zagDialog from '@zag-js/dialog';

/** Drag past this fraction of the sheet's height (or this many px, whichever is
 *  smaller) and the release dismisses; anything less springs back. */
const DISMISS_FRACTION = 0.33;
const DISMISS_PX = 96;
/** Movement below this is a tap; past it the gesture commits to a direction. */
const SLOP_PX = 8;
/** A horizontal swipe must travel at least this far to fire `onSwipe`. */
const HSWIPE_MIN_PX = 48;

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
    private readonly handle: HandleOf<typeof zagDialog.machine>;
    private readonly ctrl: ReturnType<typeof drawerController>;

    constructor(opts: DrawerOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(DRAWER_STYLE_ID, DRAWER_CSS, doc);
        const host = opts.host ?? doc.body;

        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'vela-drawer-backdrop vela-ui-layer';
        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-drawer-positioner vela-ui-layer';
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-drawer';
        // Programmatically focusable: the sheet itself takes the dialog machine's initial
        // focus — focusing the first tabbable (often a search input) would pop the
        // on-screen keyboard over a surface that just slid in.
        this.panel.tabIndex = -1;

        const grab = doc.createElement('div');
        grab.className = 'vela-drawer-grab';
        this.titleEl = doc.createElement('div');
        this.titleEl.className = 'vela-drawer-title';
        this.titleEl.textContent = opts.title ?? '';

        this.body = doc.createElement('div');
        this.body.className = 'vela-drawer-body';
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
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            spreadProps(this.titleEl, api.getTitleProps(), mid);
            // Dialog-family machines expect conditional rendering (no `hidden` in the
            // props) — the view toggles visibility from `api.open` itself.
            this.backdrop.style.display = api.open ? '' : 'none';
            this.positioner.style.display = api.open ? '' : 'none';
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

    get open(): boolean {
        return this.ctrl.connect(this.handle.service).open;
    }

    show(): void {
        this.ctrl.connect(this.handle.service).setOpen(true);
    }

    hide(): void {
        this.ctrl.connect(this.handle.service).setOpen(false);
    }

    destroy(): void {
        this.handle.stop();
        this.backdrop.remove();
        this.positioner.remove();
    }
}
