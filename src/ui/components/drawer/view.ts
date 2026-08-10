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

export interface DrawerOptions extends DrawerControllerOptions {
    title?: string;
    content?: Node | ((body: HTMLElement) => void);
    host?: HTMLElement;
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
        this.wireDragToDismiss(grab);

        this.ctrl = drawerController(opts);
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

    /** Pull the sheet down by its handle; past the threshold the release dismisses. */
    private wireDragToDismiss(grab: HTMLElement): void {
        let startY = 0;
        let dy = 0;
        let dragging = false;
        grab.addEventListener('pointerdown', (e) => {
            dragging = true;
            startY = e.clientY;
            dy = 0;
            this.panel.style.transition = 'none';
            grab.setPointerCapture(e.pointerId);
        });
        grab.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            dy = Math.max(0, e.clientY - startY);
            this.panel.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
        });
        const settle = (): void => {
            if (!dragging) return;
            dragging = false;
            this.panel.style.transition = '';
            this.panel.style.transform = '';
            const threshold = Math.min(DISMISS_PX, this.panel.getBoundingClientRect().height * DISMISS_FRACTION);
            if (dy >= threshold) this.hide();
        };
        grab.addEventListener('pointerup', settle);
        grab.addEventListener('pointercancel', settle);
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
