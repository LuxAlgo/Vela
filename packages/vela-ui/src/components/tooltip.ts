// Tooltip: a floating label over Zag's tooltip machine (floating-ui placement). The floating
// layer mounts into `host` (default: the trigger's nearest `.vela-ui` ancestor, else <body>)
// so the design tokens inherit. The trigger is the host's own element and keeps its slot.
import * as tooltip from '@zag-js/tooltip';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { ownTeardown } from '../lib/dispose';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';
import { splitPlacement, zagPositioning, type PlacementProps } from '../lib/placement';

export interface TooltipControllerOptions extends PlacementProps {
    /** @deprecated Use `side` and `align`. */
    placement?: tooltip.Placement;
    /** ms before opening on hover (default 0 — the reference tooltips are instant). */
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

/** Zag's tooltip machine with the options mapped onto it, for any view layer. */
export function tooltipController(opts: TooltipControllerOptions = {}): TooltipController {
    return {
        machine: tooltip.machine,
        props: {
            id: nextUid('vela-tooltip'),
            openDelay: opts.openDelay ?? 0,
            closeDelay: opts.closeDelay ?? 0,
            interactive: opts.interactive ?? false,
            ids: opts.triggerId ? { trigger: opts.triggerId } : undefined,
            positioning: zagPositioning(opts, opts.placement ? splitPlacement(opts.placement) : { side: 'top', align: 'center' }),
        } satisfies Partial<tooltip.Props>,
        connect: (service: TooltipService): TooltipApi => tooltip.connect(service, normalizeProps),
    };
}

export const tooltipDef = defineComponent({
    name: 'tooltip',
    parts: ['positioner', 'content'],
    settings: { radius: t.radius.md },
});

export interface TooltipOptions extends TooltipControllerOptions {
    content: string | Node | (() => Node);
    host?: HTMLElement;
}

export interface TooltipProps extends TooltipOptions {
    trigger: HTMLElement;
}

const injectStyles = defineStyles(
    'vela-ui-tooltip',
    css`
        @layer vela.ui {
            [data-slot='tooltip-content'] {
                background: ${t.bg};
                color: ${t.fg};
                border: 1px solid ${t.border.soft};
                border-radius: ${tooltipDef.vars.radius};
                box-shadow: ${t.shadow};
                font-size: ${t.fontSize.md};
                line-height: 1.4;
                padding: ${t.space[1]} ${t.space[2]};
                max-width: 280px;
                pointer-events: none;
                z-index: ${t.z.tooltip};

                &[data-interactive] {
                    pointer-events: auto;
                }
                &[data-state='open'] {
                    animation: vela-tooltip-in ${t.dur.fast} ease;
                }
            }
            @keyframes vela-tooltip-in {
                from {
                    opacity: 0;
                    transform: scale(0.97);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
        }
    `,
);

function resolveHost(trigger: HTMLElement, host?: HTMLElement): HTMLElement {
    return host ?? (trigger.closest('.vela-ui') as HTMLElement | null) ?? trigger.ownerDocument.body;
}

export class Tooltip {
    private readonly positioner: HTMLElement;
    private readonly content: HTMLElement;
    private readonly handle: HandleOf<typeof tooltip.machine>;
    private readonly trigger: HTMLElement;
    private readonly release: () => void;

    constructor(trigger: HTMLElement, opts: TooltipOptions) {
        this.trigger = trigger;
        const doc = trigger.ownerDocument;
        injectStyles(doc);
        this.content = h('div', { className: 'vela-tooltip', slot: tooltipDef.slot('content') });
        this.positioner = h('div', { className: 'vela-ui-layer', slot: tooltipDef.slot('positioner') }, this.content);
        resolveHost(trigger, opts.host).appendChild(this.positioner);
        this.setContent(opts.content);

        const ctrl = tooltipController(opts);
        // Scope every spread by this machine's id so several kit components can share a
        // node (e.g. tooltip + menu on one button) without wiping each other's listeners.
        const mid = String(ctrl.props.id);
        if (opts.triggerId) trigger.id = opts.triggerId;
        this.handle = runMachine(ctrl.machine, ctrl.props, (service) => {
            const api = ctrl.connect(service);
            spreadProps(trigger, api.getTriggerProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.content, api.getContentProps(), mid);
        });
        // On the trigger: discarding the trigger's subtree takes the tooltip, and the layer it
        // mounted elsewhere, with it.
        this.release = ownTeardown(trigger, () => {
            this.handle.stop();
            this.positioner.remove();
            // Zag leaves aria-describedby etc. on the trigger; harmless, but drop the hook.
            this.trigger.removeAttribute('data-scope');
        });
    }

    setContent(content: string | Node | (() => Node)): void {
        this.content.replaceChildren(typeof content === 'function' ? content() : content);
    }

    destroy(): void {
        this.release();
    }
}

export function createTooltip(props: TooltipProps): Tooltip {
    return new Tooltip(props.trigger, props);
}
