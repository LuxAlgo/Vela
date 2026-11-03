// Tooltip CONTROLLER — the framework-agnostic half: the Zag tooltip machine plus Vela's
// option mapping. No DOM here; any view layer (vanilla today, React later) consumes it.
import * as tooltip from '@zag-js/tooltip';
import { nextUid, normalizeProps } from '../../zag';
import { tooltipOpenDelay } from '../../tooltip-config';

export interface TooltipControllerOptions {
    placement?: tooltip.Placement;
    /** ms before opening on hover. Default: the `configureTooltips` delay, else 0 (instant). */
    openDelay?: number;
    closeDelay?: number;
    /** Keep open while the pointer is over the content (rich tooltips). */
    interactive?: boolean;
    /** Share the trigger's DOM id with other machines composed on the SAME element
     *  (each Zag machine otherwise stamps its own id — last one wins and breaks the rest). */
    triggerId?: string;
}

export type TooltipService = tooltip.Service;
export type TooltipApi = tooltip.Api;

export interface TooltipController {
    machine: typeof tooltip.machine;
    props: Partial<tooltip.Props>;
    connect(service: TooltipService): TooltipApi;
}

export function tooltipController(opts: TooltipControllerOptions = {}): TooltipController {
    return {
        machine: tooltip.machine,
        props: {
            id: nextUid('vela-tooltip'),
            openDelay: opts.openDelay ?? tooltipOpenDelay(0),
            closeDelay: opts.closeDelay ?? 0,
            interactive: opts.interactive ?? false,
            ids: opts.triggerId ? { trigger: opts.triggerId } : undefined,
            positioning: { placement: opts.placement ?? 'top' },
        } satisfies Partial<tooltip.Props>,
        connect: (service: TooltipService): TooltipApi => tooltip.connect(service, normalizeProps),
    };
}
