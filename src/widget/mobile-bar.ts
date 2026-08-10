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
    onIndicatorsClick: () => void;
    onDrawingsClick: () => void;
    onMoreClick: () => void;
    onSettingsClick: () => void;
}

export class MobileBar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly tfEl: HTMLElement;

    constructor(host: HTMLElement, opts: MobileBarOptions) {
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
        const indicators = item('vela-mb-indicators', 'Indicators', opts.onIndicatorsClick, 'indicators');
        const drawings = item('vela-mb-drawings', 'Drawings', opts.onDrawingsClick, 'pen');
        const more = item('vela-mb-more', 'More', opts.onMoreClick, 'kebab');
        const settings = item('vela-mb-settings', 'Chart settings', opts.onSettingsClick, 'gear');

        this.el.append(this.symbolEl, this.tfEl, indicators, drawings, more, settings);
        host.appendChild(this.el);
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
