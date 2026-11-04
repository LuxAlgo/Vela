// Dialog: a backdrop and a panel with a header and a body, over Zag's dialog machine (focus
// trap, dismissal, ARIA). The body is the caller's: pass a Node, or fill `body` after
// creation. `settings` and `form` are the chart settings and the indicator / drawing
// settings looks. In a shell in the mobile layout every dialog fills the shell.
import * as dialog from '@zag-js/dialog';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';
import { injectStyles as injectSheet } from '../lib/styles';
import { announceSurface } from '../lib/surface-events';
import { holdForExit, type SurfaceExit } from '../lib/surface-exit';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';
import { closeOpenPopovers, eventDismissedPopover, isPopoverOpen } from './popover';

export interface DialogControllerOptions {
    /** Trap focus + backdrop (default true). Non-modal = floating panel. */
    modal?: boolean;
    closeOnEscape?: boolean;
    closeOnInteractOutside?: boolean;
    /** Element to focus on open (default: the machine's first-tabbable pick). */
    initialFocusEl?: () => HTMLElement | null;
    onOpenChange?: (open: boolean) => void;
}

export type DialogService = dialog.Service;
export type DialogApi = dialog.Api;

export interface DialogController {
    machine: typeof dialog.machine;
    props: Partial<dialog.Props>;
    connect(service: DialogService): DialogApi;
}

/** Zag's dialog machine with the options mapped onto it, for any view layer. */
export function dialogController(opts: DialogControllerOptions = {}): DialogController {
    return {
        machine: dialog.machine,
        props: {
            id: nextUid('vela-dialog'),
            modal: opts.modal ?? true,
            closeOnEscape: opts.closeOnEscape ?? true,
            closeOnInteractOutside: opts.closeOnInteractOutside ?? false,
            initialFocusEl: opts.initialFocusEl,
            onOpenChange: (d: dialog.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<dialog.Props>,
        connect: (service: DialogService): DialogApi => dialog.connect(service, normalizeProps),
    };
}

export const dialogDef = defineComponent({
    name: 'dialog',
    parts: ['backdrop', 'positioner', 'content', 'header', 'title', 'close', 'body', 'footer'],
    settings: { radius: t.radius.lg },
});

export type DialogVariant = 'default' | 'settings' | 'form';

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
    /** `settings`: the chart settings card; `form`: the indicator and drawing settings card. */
    variant?: DialogVariant;
    /** Extra class on the panel. */
    className?: string;
    /** Close when the backdrop itself is pressed (not when a portaled popover is). */
    closeOnBackdrop?: boolean;
}

export type DialogProps = DialogOptions;

const injectStyles = defineStyles(
    'vela-ui-dialog-5',
    css`
        @layer vela.ui {
            [data-slot='dialog-backdrop'] {
                position: fixed;
                inset: 0;
                background: ${t.backdrop};
                z-index: ${t.z.dialog};

                /* Non-dimming variant: still catches outside clicks, but the page stays readable. */
                &[data-clear] {
                    background: transparent;
                }
                &[data-contained] {
                    position: absolute;
                }
                &:is([data-layout='mobile'] *) {
                    position: absolute;
                }
            }
            [data-slot='dialog-positioner'] {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: flex-start;
                justify-content: center;
                padding-top: 10vh;
                z-index: ${t.z.dialog};

                &[data-contained] {
                    position: absolute;
                }
                &[data-align='center'] {
                    align-items: center;
                    padding-top: 0;
                }
                /* In a shell in the mobile size class every dialog fills the shell: desktop
                   cards are unusable at phone widths, and the shell's bounds, not the
                   viewport, are the honest "screen" for an embedded chart. */
                &:is([data-layout='mobile'] *) {
                    position: absolute;
                    padding: 0;
                    align-items: stretch;
                }
            }
            [data-slot='dialog-header'] {
                display: flex;
                align-items: center;
                padding-block: 9px;
                padding-inline: 16px 9px;
                border-bottom: 1px solid ${t.border};
                user-select: none;
            }
            [data-slot='dialog-title'] {
                flex: 1;
                font-size: 17px;
                font-weight: 600;
                letter-spacing: 0.2px;
                color: ${t.fg.bright};
            }
            [data-slot='dialog-close'] {
                all: unset;
                cursor: pointer;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: ${t.radius.sm};
                color: ${t.fg.muted};
                line-height: 1;
                font-size: 15px;

                &:hover {
                    background: ${t.hover};
                    color: ${t.fg.bright};
                }
                &:is([data-layout='mobile'] *) {
                    width: 40px;
                    height: 40px;
                }
            }
            [data-slot='dialog-body'] {
                padding: ${t.space[4]};
                overflow: auto;
                min-height: 0;
                flex: 1 1 auto;

                &[data-flush] {
                    padding: 0;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                &::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                &::-webkit-scrollbar-thumb {
                    background: ${t.scroll};
                    border-radius: ${t.radius.sm};
                    border: 2px solid transparent;
                    background-clip: padding-box;
                }
                &::-webkit-scrollbar-track {
                    background: transparent;
                }
                &::-webkit-scrollbar-button {
                    display: none;
                    width: 0;
                    height: 0;
                }
                &:is([data-layout='mobile'] *) {
                    padding-bottom: calc(${t.space[4]} + env(safe-area-inset-bottom, 0px));
                }
            }
            [data-slot='dialog-footer'] {
                flex: 0 0 auto;
            }
            [data-slot='dialog-content'] {
                background: ${t.surface};
                color: ${t.fg};
                border: 1px solid ${t.border.strong};
                border-radius: ${dialogDef.vars.radius};
                box-shadow: ${t.shadow.dialog};
                font-size: 13px;
                min-width: 300px;
                max-width: min(92vw, 560px);
                max-height: 70vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                outline: 2px solid transparent;

                &[data-state='open'] {
                    animation: vela-dialog-in ${t.dur.med} ${t.ease};
                }
                /* A plain dialog's footer: its buttons at the end, padded like the body above it.
                   The settings and form variants lay theirs out themselves. */
                &[data-variant='default'] [data-slot='dialog-footer'] {
                    display: flex;
                    justify-content: flex-end;
                    gap: ${t.space[2]};
                    padding: 0 ${t.space[4]} ${t.space[4]};
                }
                &[data-variant='settings'] {
                    width: fit-content;
                    min-width: min(560px, 94vw);
                    max-width: min(720px, 94vw);
                    max-height: 70vh;
                    font-size: 13px;
                    cursor: default;
                }
                &[data-variant='form'] {
                    width: fit-content;
                    min-width: min(380px, 90%);
                    max-width: min(640px, 94%);
                    max-height: 82%;
                    font-size: 14px;
                }
                /* Form dialogs (indicator inputs, drawing settings): the tab strip or the body
                   owns the line under the header, and the footer carries its own top line. */
                &[data-variant='form'] [data-slot='dialog-header'] {
                    align-items: flex-start;
                    padding: 16px 20px 20px;
                    border-bottom: none;
                }
                &[data-variant='form'] [data-slot='dialog-title'] {
                    font-size: 20px;
                    line-height: 28px;
                }
                &[data-variant='form'] [data-slot='dialog-footer'] {
                    padding: 16px 20px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    border-top: 1px solid ${t.border};
                }
                &:is([data-layout='mobile'] *) {
                    width: 100%;
                    min-width: 0;
                    max-width: none;
                    max-height: none;
                    flex: 1 1 auto;
                    border: none;
                    border-radius: 0;
                }
                /* Scrollers nested in a dialog (a flush body's grid, a tab pane) get the same
                   thin overlay bars; a dialog's own sheet can restyle them. */
                & *::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                & *::-webkit-scrollbar-thumb {
                    background: ${t.scroll};
                    border-radius: ${t.radius.sm};
                    border: 2px solid transparent;
                    background-clip: padding-box;
                }
                & *::-webkit-scrollbar-track {
                    background: transparent;
                }
                & *::-webkit-scrollbar-button {
                    display: none;
                    width: 0;
                    height: 0;
                }
            }
            @keyframes vela-dialog-in {
                from {
                    opacity: 0;
                    transform: translateY(6px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
        }
    `,
);

/* A desktop drag offset (an inline transform) must not survive the flip to the mobile
   layout, so this one rule stays outside the layers and important. */
const MOBILE_DRAG_CSS = "[data-layout='mobile'] .vela-dialog { transform: none !important; }";

const VARIANT_CLASSES: Record<string, DialogVariant> = { 'vela-dialog--settings': 'settings', 'vela-dialog--form': 'form' };

export class Dialog {
    /** Caller-owned content area — append your form/panel here. */
    readonly body: HTMLElement;
    readonly panel: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly positioner: HTMLElement;
    readonly backdrop: HTMLElement;
    readonly footer: HTMLElement | null;
    private readonly handle: HandleOf<typeof dialog.machine>;
    private readonly ctrl: DialogController;

    constructor(opts: DialogOptions = {}) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(doc);
        injectSheet('vela-ui-dialog-mobile', MOBILE_DRAG_CSS, doc);
        const host = opts.host ?? doc.body;
        const part = (el: HTMLElement, name: (typeof dialogDef.parts)[number]): HTMLElement => {
            el.dataset.slot = dialogDef.slot(name);
            return el;
        };

        this.backdrop = part(doc.createElement('div'), 'backdrop');
        this.backdrop.className = 'vela-dialog-backdrop vela-ui-layer';
        if (opts.dimBackdrop !== true) {
            this.backdrop.classList.add('vela-dialog-backdrop--clear');
            this.backdrop.dataset.clear = '';
        }
        this.positioner = part(doc.createElement('div'), 'positioner');
        this.positioner.className = 'vela-dialog-positioner vela-ui-layer';
        if (opts.contained) {
            this.backdrop.dataset.contained = '';
            this.positioner.dataset.contained = '';
        }
        this.positioner.dataset.align = opts.align ?? 'top';
        this.panel = part(doc.createElement('div'), 'content');
        this.panel.className = 'vela-dialog';
        const classes = (opts.className ?? '').split(/\s+/).filter(Boolean);
        const variant = opts.variant ?? classes.map((c) => VARIANT_CLASSES[c]).find((v) => v !== undefined) ?? 'default';
        this.panel.dataset.variant = variant;
        if (variant !== 'default') this.panel.classList.add(`vela-dialog--${variant}`);
        for (const c of classes) this.panel.classList.add(c);
        // Programmatically focusable — the mobile chrome routes the machine's initial
        // focus here (see the controller wiring below).
        this.panel.tabIndex = -1;
        this.panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
        });

        const header = part(doc.createElement('div'), 'header');
        header.className = 'vela-dialog-header';
        if (opts.draggable) {
            header.style.cursor = 'move';
            let sx = 0;
            let sy = 0;
            let ox = 0;
            let oy = 0;
            let dragging = false;
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
        const title = part(doc.createElement('div'), 'title');
        title.className = 'vela-dialog-title';
        title.textContent = opts.title ?? '';
        this.titleEl = title;
        const close = part(doc.createElement('button'), 'close');
        close.className = 'vela-dialog-close';
        close.appendChild(iconEl('close', doc));
        header.append(title, close);

        this.body = part(doc.createElement('div'), 'body');
        this.body.className = 'vela-dialog-body';
        if (opts.flush) this.body.dataset.flush = '';
        if (opts.content instanceof Node) this.body.appendChild(opts.content);
        else if (typeof opts.content === 'function') opts.content(this.body);

        this.panel.append(header, this.body);
        if (opts.footer) {
            const foot = part(doc.createElement('div'), 'footer');
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
            // Close announces while the panel still shows (before the close props land), open once it does.
            const closing = this.wasOpen && !api.open;
            if (closing) this.announce(false);
            spreadProps(this.backdrop, api.getBackdropProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.panel, api.getContentProps(), mid);
            spreadProps(title, api.getTitleProps(), mid);
            spreadProps(close, api.getCloseTriggerProps(), mid);
            // Zag dialogs expect CONDITIONAL rendering (their `hidden` reaches the panel and
            // backdrop only, and the panel's authored display beats it) — the view toggles
            // visibility from `api.open` itself, once the exit animation of a close has run.
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

    private opener: HTMLElement | null = null;
    private wasOpen = false;
    /** The panel and scrim's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private destroyed = false;

    private setShown(shown: boolean): void {
        this.backdrop.style.display = shown ? '' : 'none';
        this.positioner.style.display = shown ? '' : 'none';
    }

    /** Keep the just-closed dialog up through its exit animation, then hide it — or
     *  remove it, when it was destroyed meanwhile. `spreadProps` re-applies the close
     *  props' `hidden` only when its value changes, so lifting it keeps the panel and
     *  scrim up until the exit ends. The positioner spans the viewport: inert, it lets
     *  clicks through to the page while the panel animates out. */
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
        announceSurface(this.panel, open, 'dialog', opener);
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

    contains(node: Node | null): boolean {
        if (node == null) return false;
        if (this.panel.contains(node) || this.backdrop.contains(node) || this.positioner.contains(node)) return true;
        const el = node instanceof Element ? node : node.parentElement;
        // Portaled select lists / color chips / menus live on the document, not in the panel.
        return el?.closest('.vela-popover, .vela-menu') != null;
    }

    destroy(): void {
        // Closed but not projected yet — an owner disposing of the dialog as it reports
        // closing: project the close now, so it animates out like any other close and
        // leaves the DOM when its exit ends. A teardown while open leaves at once.
        if (this.wasOpen && !this.open) this.handle.flush();
        // Exit the open state before stopping so the machine unwinds its open-time
        // effects (focus restore, and the body pointer-events lock of modal dialogs)
        // instead of leaving them behind.
        if (this.open) this.hide();
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

export function createDialog(props: DialogProps = {}): Dialog {
    return new Dialog(props);
}
