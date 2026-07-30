// Dialog VIEW — backdrop + centered panel with header/body, driven by the Zag dialog
// machine. The body is caller-owned: pass a Node or populate via `body` after creation.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
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
}

export class Dialog {
    /** Caller-owned content area — append your form/panel here. */
    readonly body: HTMLElement;
    private readonly backdrop: HTMLElement;
    private readonly positioner: HTMLElement;
    private readonly panel: HTMLElement;
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
        this.panel = doc.createElement('div');
        this.panel.className = 'vela-dialog';

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
        const title = doc.createElement('div');
        title.className = 'vela-dialog-title';
        title.textContent = opts.title ?? '';
        const close = doc.createElement('button');
        close.className = 'vela-dialog-close';
        close.textContent = '✕';
        header.append(title, close);

        this.body = doc.createElement('div');
        this.body.className = 'vela-dialog-body';
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        this.panel.append(header, this.body);
        this.positioner.appendChild(this.panel);
        host.append(this.backdrop, this.positioner);

        this.ctrl = dialogController(opts);
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

    destroy(): void {
        this.handle.stop();
        this.backdrop.remove();
        this.positioner.remove();
    }
}
