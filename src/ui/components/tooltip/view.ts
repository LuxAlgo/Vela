// Tooltip VIEW — thin vanilla DOM projection over the controller. Floating layer mounts
// into `host` (default: the trigger's nearest `.vela-ui` ancestor, else <body>) so the
// design tokens inherit; positioning is handled by the machine (floating-ui) regardless.
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { tooltipController, type TooltipControllerOptions } from './controller';
import { TOOLTIP_CSS, TOOLTIP_STYLE_ID } from './styles';
import * as zagTooltip from '@zag-js/tooltip';

export interface TooltipOptions extends TooltipControllerOptions {
    content: string | Node | (() => Node);
    host?: HTMLElement;
}

function resolveHost(trigger: HTMLElement, host?: HTMLElement): HTMLElement {
    return host ?? (trigger.closest('.vela-ui') as HTMLElement | null) ?? trigger.ownerDocument.body;
}

export class Tooltip {
    private readonly positioner: HTMLElement;
    private readonly content: HTMLElement;
    private readonly handle: HandleOf<typeof zagTooltip.machine>;
    private readonly trigger: HTMLElement;

    constructor(trigger: HTMLElement, opts: TooltipOptions) {
        this.trigger = trigger;
        const doc = trigger.ownerDocument;
        injectStyles(TOOLTIP_STYLE_ID, TOOLTIP_CSS, doc);

        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-ui-layer';
        this.content = doc.createElement('div');
        this.content.className = 'vela-tooltip';
        this.positioner.appendChild(this.content);
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
    }

    setContent(content: string | Node | (() => Node)): void {
        this.content.replaceChildren(typeof content === 'function' ? content() : content);
    }

    destroy(): void {
        this.handle.stop();
        this.positioner.remove();
        // Zag leaves aria-describedby etc. on the trigger; harmless, but drop the hook.
        this.trigger.removeAttribute('data-scope');
    }
}
