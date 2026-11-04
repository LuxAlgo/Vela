// CalloutBubble: a small tinted circle with a centered icon. When a panel is declared,
// clicking it deploys a popover of text and action buttons (below the bubble, flipping above
// near the bottom edge). Content is data, so contribution seams route it without handing
// over DOM. The bubble is a single element the caller places and decorates (tooltips stay
// the caller's: renderer chrome attaches its bare-chart tips, widget chrome the kit's).
import { iconAt } from '../lib/icons';
import type { ChartTheme } from '../lib/tokens';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';
import { Popover, type PlacementProps, type PopoverBoundary } from './popover';

/** One block of a deployed callout panel — plain text, or a button running a caller action. */
export type CalloutPanelItem =
    | { type: 'text'; text: string }
    | {
          type: 'button';
          label: string;
          /** Emphasized (selection-colored) button — the panel's main action. */
          primary?: boolean;
          /** Close the panel after `run` (default true — an action answers the panel). */
          close?: boolean;
          run(): void;
      };

/** The deployed panel: an optional heading over ordered text/button blocks. */
export interface CalloutPanel {
    title?: string;
    items: CalloutPanelItem[];
}

/** What dresses the bubble itself (the panel is what the click deploys). */
export interface CalloutBubbleSpec {
    /** Icon id in the icon registry (`registerIcon`), centered in the bubble. */
    icon: string;
    /** Bubble fill — any CSS color, token expressions included. */
    background: string;
    /** Icon ink (default: `currentColor` inherited from the slot). */
    color?: string;
    /** Accessible name. Callers typically show the same text in their own tooltip. */
    label: string;
    /** Deployed panel — presence makes the bubble clickable. */
    panel?: CalloutPanel;
}

/** Whether activating a panel button also closes the panel (defaults to yes). */
export function closesPanel(item: Extract<CalloutPanelItem, { type: 'button' }>): boolean {
    return item.close !== false;
}

/** A panel row as the view lays it out: one text block, or a run of adjacent buttons. */
export type CalloutPanelRow = { type: 'text'; text: string } | { type: 'buttons'; buttons: Array<Extract<CalloutPanelItem, { type: 'button' }>> };

/**
 * Group a panel's ordered items into layout rows: consecutive buttons share one row
 * (the common "text above, actions below" shape falls out naturally), text blocks
 * stand alone. Pure — unit-tested apart from the DOM.
 */
export function calloutPanelRows(items: CalloutPanelItem[]): CalloutPanelRow[] {
    const rows: CalloutPanelRow[] = [];
    for (const item of items) {
        if (item.type === 'text') {
            rows.push({ type: 'text', text: item.text });
            continue;
        }
        const last = rows[rows.length - 1];
        if (last && last.type === 'buttons') last.buttons.push(item);
        else rows.push({ type: 'buttons', buttons: [item] });
    }
    return rows;
}

export const calloutBubbleDef = defineComponent({
    name: 'callout-bubble',
    parts: ['root', 'panel', 'title', 'text', 'actions', 'button'],
    settings: { 'panel-radius': t.radius.md, 'button-radius': '5px' },
});

/** The panel opens where the placement props say (default below and start-aligned, 6px away,
 *  flipping above near the bottom edge). */
export interface CalloutBubbleOptions extends CalloutBubbleSpec, PlacementProps {
    /** Bubble diameter in px (default 16; the icon renders 4px smaller). */
    size?: number;
    /** Where the deployed panel portals (default: the document body). Pass the chart
     *  or widget root so the panel lives inside the host's DOM. */
    host?: HTMLElement;
    /** Live theme, for a panel deployed OUTSIDE a `.vela-ui` token host (renderer
     *  chrome on a bare chart passes its theme getter; widget chrome may omit it). */
    theme?: () => ChartTheme;
    /** @deprecated Use `collisionBoundary`. */
    boundary?: PopoverBoundary;
}

export type CalloutBubbleProps = CalloutBubbleOptions;

export const CALLOUT_STYLE_ID = 'vela-ui-callout-bubble';

export const CALLOUT_CSS = css`
    @layer vela.ui {
        [data-slot='callout-bubble'] {
            place-items: center;
            border-radius: 50%;
            flex: none;
            line-height: 0;
            box-sizing: border-box;
            cursor: default;
            user-select: none;
            -webkit-user-select: none;

            &:where(:not([hidden])) {
                display: inline-grid;
            }
            &[role='button'] {
                cursor: pointer;
            }
            & svg {
                display: block;
            }
        }
        /* The deployed panel carries the kit's elevated-card look itself (the popover shell
           is bare positioning chrome). */
        [data-slot='callout-bubble-panel'] {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px 12px;
            max-width: 280px;
            box-sizing: border-box;
            background: ${t.surface.elev};
            border: 1px solid ${t.border.strong};
            border-radius: ${calloutBubbleDef.vars['panel-radius']};
            box-shadow: ${t.shadow};
            color: ${t.fg};
            font: ${t.fontSize.md} ${t.font};
        }
        [data-slot='callout-bubble-title'] {
            font-weight: 600;
            color: ${t.fg.bright};
        }
        [data-slot='callout-bubble-text'] {
            color: ${t.fg.muted};
            line-height: 1.45;
            white-space: pre-line;
        }
        [data-slot='callout-bubble-actions'] {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        [data-slot='callout-bubble-button'] {
            cursor: pointer;
            height: 26px;
            padding: 0 10px;
            border-radius: ${calloutBubbleDef.vars['button-radius']};
            border: 1px solid ${t.border};
            background: transparent;
            color: ${t.fg};
            font-size: ${t.fontSize.md};
            font-family: inherit;
            transition:
                background ${t.dur.fast} ease,
                color ${t.dur.fast} ease,
                opacity ${t.dur.fast} ease,
                border-color ${t.dur.fast} ease;

            &:where([data-primary]) {
                border-color: ${t.selected.bg};
                background: ${t.selected.bg};
                color: ${t.selected.fg};
            }
            &:hover {
                background: ${t.hover};
                color: ${t.fg.bright};
                border-color: ${t.fg.muted};
            }
            &:where([data-primary]):hover {
                background: ${t.selected.bg};
                color: ${t.selected.fg};
                opacity: 0.85;
                border-color: ${t.selected.bg};
            }
        }
    }
`;

const injectStyles = defineStyles(CALLOUT_STYLE_ID, CALLOUT_CSS);

export class CalloutBubble {
    readonly el: HTMLElement;
    private spec: CalloutBubbleSpec;
    private readonly size: number;
    private readonly host: HTMLElement | undefined;
    private readonly theme: (() => ChartTheme) | undefined;
    private readonly placement: PlacementProps;
    private pop: Popover | null = null;

    constructor(opts: CalloutBubbleOptions) {
        this.spec = { icon: opts.icon, background: opts.background, label: opts.label };
        if (opts.color !== undefined) this.spec.color = opts.color;
        if (opts.panel !== undefined) this.spec.panel = opts.panel;
        this.size = opts.size ?? 16;
        this.host = opts.host;
        this.theme = opts.theme;
        this.placement = { ...opts, collisionBoundary: opts.collisionBoundary ?? opts.boundary };
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(doc);
        this.el = doc.createElement('span');
        this.el.className = 'vela-callout';
        this.el.dataset.slot = calloutBubbleDef.slot('root');
        this.el.style.width = `${this.size}px`;
        this.el.style.height = `${this.size}px`;
        // A click's job is the panel — never the row/chip underneath (selection,
        // settings dialogs); a dblclick on the bubble must stay the bubble's too.
        this.el.addEventListener('click', (e) => {
            if (!this.spec.panel) return;
            e.stopPropagation();
            this.toggle();
        });
        this.el.addEventListener('dblclick', (e) => {
            if (this.spec.panel) e.stopPropagation();
        });
        this.el.addEventListener('keydown', (e) => {
            if (!this.spec.panel || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            this.toggle();
        });
        this.dress();
    }

    /** Re-dress the bubble (a status change: new icon, tint, label, panel). */
    set(spec: Partial<CalloutBubbleSpec>): void {
        this.spec = { ...this.spec, ...spec };
        // The open panel (if any) belongs to the previous state — retire it.
        if ('panel' in spec) this.pop?.hide();
        this.dress();
    }

    /** Whether the deployed panel is currently open. */
    get open(): boolean {
        return this.pop?.open ?? false;
    }

    /** Close the deployed panel, if any. The bubble itself stays. */
    hidePanel(): void {
        this.pop?.hide();
    }

    destroy(): void {
        this.pop?.destroy();
        this.pop = null;
        this.el.remove();
    }

    private dress(): void {
        const clickable = this.spec.panel !== undefined;
        this.el.style.background = this.spec.background;
        this.el.style.color = this.spec.color ?? '';
        this.el.innerHTML = iconAt(this.spec.icon, this.size - 4);
        this.el.setAttribute('aria-label', this.spec.label);
        if (clickable) {
            this.el.setAttribute('role', 'button');
            this.el.tabIndex = 0;
        } else {
            this.el.removeAttribute('role');
            this.el.removeAttribute('tabindex');
        }
    }

    private toggle(): void {
        if (this.pop?.open) {
            this.pop.hide();
            return;
        }
        const panel = this.spec.panel;
        if (!panel) return;
        // A fresh popover per deploy: the content projects the CURRENT panel data,
        // and the theme is read at open time (never a stale capture).
        this.pop?.destroy();
        this.pop = new Popover({
            trigger: this.el,
            side: this.placement.side,
            align: this.placement.align,
            sideOffset: this.placement.sideOffset ?? 6,
            alignOffset: this.placement.alignOffset,
            avoidCollisions: this.placement.avoidCollisions,
            collisionPadding: this.placement.collisionPadding,
            content: (body) => this.buildPanel(body, panel),
            ...(this.host ? { host: this.host } : {}),
            ...(this.theme ? { theme: this.theme() } : {}),
            ...(this.placement.collisionBoundary ? { collisionBoundary: this.placement.collisionBoundary } : {}),
        });
        this.pop.show();
    }

    private buildPanel(body: HTMLElement, panel: CalloutPanel): void {
        const doc = body.ownerDocument;
        const part = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, name: (typeof calloutBubbleDef.parts)[number]): HTMLElementTagNameMap[K] => {
            const el = doc.createElement(tag);
            el.className = className;
            el.dataset.slot = calloutBubbleDef.slot(name);
            return el;
        };
        const root = part('div', 'vela-callout-panel', 'panel');
        if (panel.title) {
            const title = part('div', 'vela-callout-title', 'title');
            title.textContent = panel.title;
            root.appendChild(title);
        }
        for (const row of calloutPanelRows(panel.items)) {
            if (row.type === 'text') {
                const text = part('div', 'vela-callout-text', 'text');
                text.textContent = row.text;
                root.appendChild(text);
                continue;
            }
            const actions = part('div', 'vela-callout-actions', 'actions');
            for (const item of row.buttons) {
                const btn = part('button', 'vela-callout-btn' + (item.primary ? ' vela-callout-btn-primary' : ''), 'button');
                btn.type = 'button';
                if (item.primary) btn.dataset.primary = '';
                btn.textContent = item.label;
                btn.addEventListener('click', () => {
                    item.run();
                    if (closesPanel(item)) this.pop?.hide();
                });
                actions.appendChild(btn);
            }
            root.appendChild(actions);
        }
        body.appendChild(root);
    }
}

export function createCalloutBubble(props: CalloutBubbleProps): CalloutBubble {
    return new CalloutBubble(props);
}
