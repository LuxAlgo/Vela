// Mobile bottom bar — the ONE navigation surface of the mobile chrome. Six stops, left
// to right: symbol (fullscreen search), timeframe (drawer), indicators (fullscreen
// picker), drawings (drawer), the three-dots drawer (everything else), and chart
// settings. It replaces BOTH desktop bars: this stylesheet also carries the mobile
// visibility flips for the topbar and the desktop bottombar, so the whole swap lives
// in one place and follows the root's `data-layout` attribute with no JS.
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { parseSymbol } from '../data/ProviderRegistry';
import { timeframeLabel } from './timeframe';
import { widgetActions, type WidgetContext } from './contributions';

const STYLE_ID = 'vela-widget-mobilebar';
const CSS = `
.vela-mobilebar {
    display: none;
    align-items: stretch;
    gap: 2px;
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    flex: none;
}
[data-layout='mobile'] .vela-mobilebar { display: flex; }
[data-layout='mobile'] .vela-widget-topbar { display: none; }
[data-layout='mobile'] .vela-widget-bottombar { display: none; }
.vela-mb-item {
    all: unset;
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 600;
    -webkit-tap-highlight-color: transparent;
}
.vela-mb-item:active { background: var(--vela-hover); }
.vela-mb-item .vela-icon { font-size: 18px; width: 18px; height: 18px; }
/* Left-aligned contributed actions get their own stops (the built-in indicators
   slot) — the wrapper is layout-transparent so each stop flexes like a sibling. */
.vela-mb-actions { display: contents; }
.vela-mb-symbol {
    flex: 1.6 1 0;
    font-size: 14px;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    line-height: 44px;
    text-align: center;
}
`;

export interface MobileBarOptions {
    symbol: string;
    timeframe: string;
    onSymbolClick: () => void;
    onTimeframeClick: () => void;
    /** Omitted ⇒ no indicators stop (the host replaced the picker — see the
     *  `indicatorPicker` shell option). */
    onIndicatorsClick?: () => void;
    onDrawingsClick: () => void;
    onMoreClick: () => void;
    onSettingsClick: () => void;
    /** Live widget context — left-aligned contributed actions (`align: 'left'`)
     *  project as icon-only stops in the indicators slot. */
    getContext?: () => WidgetContext;
}

export class MobileBar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly tfEl: HTMLElement;
    /** Left-aligned contributed actions — filled by {@link renderActions}. */
    private readonly actionsHost: HTMLElement;
    private readonly opts: MobileBarOptions;

    constructor(host: HTMLElement, opts: MobileBarOptions) {
        this.opts = opts;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-mobilebar';

        const item = (cls: string, label: string, onClick: () => void, icon?: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = `vela-mb-item ${cls}`;
            b.setAttribute('aria-label', label);
            if (icon) b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.symbolEl = item('vela-mb-symbol', 'Symbol search', opts.onSymbolClick);
        this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
        this.tfEl = item('vela-mb-tf', 'Timeframe', opts.onTimeframeClick);
        this.tfEl.textContent = timeframeLabel(opts.timeframe);
        const onIndicators = opts.onIndicatorsClick;
        const indicators = onIndicators ? item('vela-mb-indicators', 'Indicators', onIndicators, 'indicators') : null;
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-mb-actions';
        const drawings = item('vela-mb-drawings', 'Drawings', opts.onDrawingsClick, 'pen');
        const more = item('vela-mb-more', 'More', opts.onMoreClick, 'kebab');
        const settings = item('vela-mb-settings', 'Chart settings', opts.onSettingsClick, 'gear');

        this.el.append(this.symbolEl, this.tfEl, ...(indicators ? [indicators] : []), this.actionsHost, drawings, more, settings);
        host.appendChild(this.el);
        this.renderActions();
    }

    /** Re-project the left-aligned contributed actions as icon-only stops in the
     *  indicators slot (call after registrations change). Right-aligned actions stay
     *  in the three-dots drawer — a primary stop is what `align: 'left'` opts into. */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        if (!ctx) return;
        const doc = this.el.ownerDocument;
        this.actionsHost.replaceChildren();
        for (const action of widgetActions('topbar', ctx).filter((a) => a.align === 'left')) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item';
            b.setAttribute('aria-label', action.label);
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            else b.appendChild(doc.createTextNode(action.label));
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            this.actionsHost.appendChild(b);
        }
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = parseSymbol(symbol).ticker;
    }

    setTimeframe(tf: string): void {
        this.tfEl.textContent = timeframeLabel(tf);
    }

    destroy(): void {
        this.el.remove();
    }
}
