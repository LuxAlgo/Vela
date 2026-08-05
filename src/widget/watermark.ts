// Symbol watermark — large faded "SYMBOL · TF" centered behind the chart chrome.
import { injectStyles } from '../ui/styles';
import { timeframeLabel } from './timeframe';
import { parseSymbol } from '../data/ProviderRegistry';

const STYLE_ID = 'vela-widget-watermark';
const CSS = `
.vela-watermark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 1;
    color: var(--vela-fg);
    opacity: 0.05;
    font-size: clamp(28px, 7vw, 72px);
    font-weight: 700;
    letter-spacing: 0.04em;
    user-select: none;
    white-space: nowrap;
}
`;

export class Watermark {
    readonly el: HTMLElement;

    constructor(host: HTMLElement, symbol: string, timeframe: string) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.el = host.ownerDocument.createElement('div');
        this.el.className = 'vela-watermark';
        host.appendChild(this.el);
        this.update(symbol, timeframe);
    }

    setVisible(visible: boolean): void {
        this.el.style.display = visible ? '' : 'none';
    }

    update(symbol: string, timeframe: string): void {
        // Bare ticker — the venue prefix is routing identity, not something to watermark.
        this.el.textContent = symbol ? `${parseSymbol(symbol).ticker} · ${timeframeLabel(timeframe)}` : '';
    }

    destroy(): void {
        this.el.remove();
    }
}
