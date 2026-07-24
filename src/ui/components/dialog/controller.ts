// Dialog CONTROLLER — Zag dialog machine (focus trap, dismiss, ARIA) + option mapping.
import * as dialog from '@zag-js/dialog';
import { nextUid, normalizeProps } from '../../zag';

export interface DialogControllerOptions {
    /** Trap focus + backdrop (default true). Non-modal = floating panel. */
    modal?: boolean;
    closeOnEscape?: boolean;
    closeOnInteractOutside?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export type DialogService = dialog.Service;
export type DialogApi = dialog.Api;

export interface DialogController {
    machine: typeof dialog.machine;
    props: Partial<dialog.Props>;
    connect(service: DialogService): DialogApi;
}

export function dialogController(opts: DialogControllerOptions = {}): DialogController {
    return {
        machine: dialog.machine,
        props: {
            id: nextUid('vela-dialog'),
            modal: opts.modal ?? true,
            closeOnEscape: opts.closeOnEscape ?? true,
            closeOnInteractOutside: opts.closeOnInteractOutside ?? false,
            onOpenChange: (d: dialog.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<dialog.Props>,
        connect: (service: DialogService): DialogApi => dialog.connect(service, normalizeProps),
    };
}
