// Drawer CONTROLLER — a bottom sheet is a dialog with a different presentation, so it
// rides the Zag dialog machine (focus trap, dismiss, ARIA) with drawer defaults: a
// backdrop tap dismisses (the touch idiom the component exists for).
import * as dialog from '@zag-js/dialog';
import { nextUid, normalizeProps } from '../../zag';

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
