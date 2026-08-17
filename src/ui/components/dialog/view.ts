// Dialog VIEW — backdrop + centered panel with header/body, driven by the Zag dialog
// machine. The body is caller-owned: pass a Node or populate via `body` after creation.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { closeOpenPopovers, eventDismissedPopover, isPopoverOpen } from '../popover';
import { dialogController, type DialogControllerOptions } from './controller';
import { DIALOG_CSS, DIALOG_STYLE_ID } from './styles';
import * as zagDialog from '@zag-js/dialog';

export interface DialogOptions extends DialogControllerOptions {
    title?: string;
    content?: Node | ((body: HTMLElement) => void);
    host?: HTMLElement;
    /** Drag the dialog by its header (the reference dialogs move; search stays fixed). */
    draggable?: boolean;
    /** Darken the page behind the dialog (default false — the chart stays readable while
     *  dialogs edit live content). Pass true for a dimming scrim; the backdrop still
     *  catches interact-outside dismissal either way. */
    dimBackdrop?: boolean;
    /** Vertical placement of the card. Default `top` (current 10vh pad). */
    align?: 'top' | 'center';
    /** Pin the overlay to `host` (absolute) instead of the viewport (fixed). */
    contained?: boolean;
    /** Footer pinned below the scrollable body. */
    footer?: Node | ((el: HTMLElement) => void);
    /** Extra nodes before the title (e.g. a mobile section burger). */
    headerStart?: Node;
    /** Skip default body padding — the caller owns the body layout. */
    flush?: boolean;
    /** Extra class on the panel. */
    className?: string;
    /** Close when the backdrop itself is pressed (not when a portaled popover is). */
    closeOnBackdrop?: boolean;
}

export class Dialog {
    /** Caller-owned content area — append your form/panel here. */
    readonly body: HTMLElement;
    readonly panel: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly positioner: HTMLElement;
    readonly backdrop: HTMLElement;
    readonly footer: HTMLElement | null;
    private readonly handle: HandleOf<typeof zagDialog.machine>;
    private readonly ctrl: ReturnType<typeof dialogController>;

    constructor(opts: DialogOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(DIALOG_STYLE_ID, DIALOG_CSS, doc);
        const host = opts.host ?? doc.body;

        this.backdrop = doc.createElement('div');
        this.backdrop.className = 'vela-dialog-backdrop vela-ui-layer';
        if (opts.dimBackdrop !== true) this.backdrop.classList.add('vela-dialog-backdrop--clear');
        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-dialog-positioner vela-ui-layer';
        if (opts.contained) {
            this.backdrop.dataset.contained = '';
            this.positioner.dataset.contained = '';
        }
        this.positioner.dataset.align = opts.align ?? 'top';
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-dialog';
        if (opts.className) {
            for (const cls of opts.className.split(/\s+/)) if (cls) this.panel.classList.add(cls);
        }
        // Programmatically focusable — the mobile chrome routes the machine's initial
        // focus here (see the controller wiring below).
        this.panel.tabIndex = -1;
        this.panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
        });

        const header = doc.createElement('div');
        header.className = 'vela-dialog-header';
        if (opts.draggable) {
            header.style.cursor = 'move';
            let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
            header.addEventListener('pointerdown', (e) => {
                if ((e.target as HTMLElement).closest('.vela-dialog-close')) return;
                dragging = true;
                sx = e.clientX - ox;
                sy = e.clientY - oy;
                header.setPointerCapture(e.pointerId);
            });
            header.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                ox = e.clientX - sx;
                oy = e.clientY - sy;
                this.panel.style.transform = `translate(${ox}px, ${oy}px)`;
            });
            header.addEventListener('pointerup', () => (dragging = false));
        }
        if (opts.headerStart) header.appendChild(opts.headerStart);
        const title = doc.createElement('div');
        title.className = 'vela-dialog-title';
        title.textContent = opts.title ?? '';
        this.titleEl = title;
        const close = doc.createElement('button');
        close.className = 'vela-dialog-close';
        close.appendChild(iconEl('close', doc));
        header.append(title, close);

        this.body = doc.createElement('div');
        this.body.className = 'vela-dialog-body';
        if (opts.flush) this.body.dataset.flush = '';
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        this.panel.append(header, this.body);
        if (opts.footer) {
            const foot = doc.createElement('div');
            foot.className = 'vela-dialog-footer';
            if (opts.footer instanceof Node) foot.appendChild(opts.footer);
            else opts.footer(foot);
            this.panel.appendChild(foot);
            this.footer = foot;
        } else {
            this.footer = null;
        }
        this.positioner.appendChild(this.panel);
        host.append(this.backdrop, this.positioner);
        if (opts.closeOnBackdrop) {
            const closeOn = (e: Event): void => {
                if (e.target !== this.backdrop && e.target !== this.positioner) return;
                // A portaled popover (color picker, select list) is logically INSIDE the
                // dialog: the first outside click dismisses it, not the dialog itself.
                if (isPopoverOpen() || eventDismissedPopover(e)) {
                    closeOpenPopovers();
                    return;
                }
                this.hide();
            };
            this.backdrop.addEventListener('pointerdown', closeOn);
            this.positioner.addEventListener('pointerdown', closeOn);
        }

        this.ctrl = dialogController({
            ...opts,
            // Mobile chrome (fullscreen presentation): opening must never land focus on
            // an input — that pops the on-screen keyboard over the just-opened dialog.
            // Focus goes to the panel; a caller that WANTS the keyboard focuses its
            // input explicitly. Desktop keeps the caller's pick, else the machine's
            // first-tabbable default.
            initialFocusEl: () => {
                if (this.positioner.closest('[data-layout="mobile"]')) return this.panel;
                return opts.initialFocusEl?.() ?? null;
            },
        });
        const mid = String(this.ctrl.props.id);
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            spreadProps(title, api.getTitleProps(), mid);
            spreadProps(close, api.getCloseTriggerProps(), mid);
            // Zag dialogs expect CONDITIONAL rendering (their props carry no `hidden`,
            // unlike tooltip/menu) — the view toggles visibility from `api.open` itself.
            this.backdrop.style.display = api.open ? '' : 'none';
            this.positioner.style.display = api.open ? '' : 'none';
        });
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

    contains(node: Node | null): boolean {
        if (node == null) return false;
        if (this.panel.contains(node) || this.backdrop.contains(node) || this.positioner.contains(node)) return true;
        const el = node instanceof Element ? node : node.parentElement;
        // Portaled select lists / color chips / menus live on the document, not in the panel.
        return el?.closest('.vela-popover, .vela-menu') != null;
    }

    destroy(): void {
        // Exit the open state before stopping so the machine unwinds its open-time
        // effects (focus restore, and the body pointer-events lock of modal dialogs)
        // instead of leaving them behind.
        if (this.open) this.hide();
        this.handle.stop();
        this.backdrop.remove();
        this.positioner.remove();
    }
}
