// In-chart status line (top-left overlay): symbol + the OHLC/change of the bar under the
// crosshair, falling back to the latest live bar. Resting values come from the chart's
// `bar` event; hover values from the renderer crosshair seam (RendererControl.onCrosshairMove).
import type { Vela } from '../Vela';
import type { OHLCV } from '../core/model/ohlcv';
import { injectStyles } from '../ui/styles';
import { fmtPrice, fmtChange, decimalsFor } from './format';
import { timeframeLabel } from './timeframe';
import { tickerIconEl } from './symbol-icon';

const STYLE_ID = 'vela-widget-statusline';
const CSS = `
.vela-statusline {
    position: absolute;
    top: var(--vela-space-2);
    left: 54px; /* clear of the drawing toolbar (40px) */
    z-index: 10;
    display: flex;
    align-items: baseline;
    gap: var(--vela-space-2);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.vela-statusline .vela-sl-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
}
.vela-statusline .vela-sl-symbol { font-weight: 600; font-size: var(--vela-font-size-lg); }
.vela-statusline .vela-sl-meta { color: var(--vela-fg-muted); font-size: var(--vela-font-size-md); font-weight: 600; }
.vela-statusline .vela-sl-market { color: var(--vela-up); font-size: var(--vela-font-size-sm); font-weight: 600; }
.vela-statusline .vela-sl-ohlc { display: flex; gap: var(--vela-space-1); color: var(--vela-fg-muted); }
.vela-statusline .vela-sl-ohlc b { color: var(--vela-fg); font-weight: 500; }
.vela-statusline .vela-sl-change[data-dir='up'] { color: var(--vela-accent); }
.vela-statusline .vela-sl-change[data-dir='down'] { color: var(--vela-danger); }
/* Stack the renderer's PRICE-pane legend below the status line (study panes stay put).
 * The renderer sets the legend's inline top — shift with a transform, don't fight it.
 * Scoped to hosts that actually CARRY a status line (the marker class set by the
 * Statusline constructor) — the stylesheet is document-global, so a bare container
 * class here would shift every chart on the page, including statusline-less ones. */
.vela-has-statusline [data-vela-pane='price'] { transform: translateY(26px); }
`;

interface BarLike {
    open: number;
    high: number;
    low: number;
    close: number;
}

function baseOfTicker(ticker: string): string {
    return ticker.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || ticker;
}

export class Statusline {
    readonly el: HTMLElement;
    private readonly ohlcEl: HTMLElement;
    private readonly changeEl: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly marketEl: HTMLElement;
    private avatarEl: HTMLElement;
    private metaEl!: HTMLElement;
    private readonly parts = { name: true, market: true, ohlc: true, change: true };
    private lastBar: BarLike | null = null;
    private hoverBar: BarLike | null = null;
    private unsubs: Array<() => void> = [];

    constructor(private readonly host: HTMLElement, symbol: string) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        host.classList.add('vela-has-statusline'); // scopes the price-legend shift to THIS host
        this.el = doc.createElement('div');
        this.el.className = 'vela-statusline';
        this.avatarEl = tickerIconEl(doc, baseOfTicker(symbol), symbol, 'vela-sl-avatar');
        this.symbolEl = doc.createElement('span');
        this.symbolEl.className = 'vela-sl-symbol';
        this.symbolEl.textContent = symbol;
        this.metaEl = doc.createElement('span');
        this.metaEl.className = 'vela-sl-meta';
        this.marketEl = doc.createElement('span');
        this.marketEl.className = 'vela-sl-market';
        this.marketEl.textContent = 'Open'; // crypto trades continuously (no session model)
        this.ohlcEl = doc.createElement('span');
        this.ohlcEl.className = 'vela-sl-ohlc';
        this.changeEl = doc.createElement('span');
        this.changeEl.className = 'vela-sl-change';
        this.el.append(this.avatarEl, this.symbolEl, this.metaEl, this.marketEl, this.ohlcEl, this.changeEl);
        host.appendChild(this.el);
        this.render();
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = symbol;
        const fresh = tickerIconEl(this.el.ownerDocument, baseOfTicker(symbol), symbol, 'vela-sl-avatar');
        this.avatarEl.replaceWith(fresh);
        this.avatarEl = fresh;
    }

    /** Show/hide one part (the settings dialog's Status line tab drives these). */
    /** The "· 1h · BINANCE" segment after the symbol. */
    setMeta(timeframe: string, provider: string): void {
        this.metaEl.textContent = `· ${timeframeLabel(timeframe)}${provider ? ` · ${provider.toUpperCase()}` : ''}`;
    }

    setPartVisible(part: 'name' | 'market' | 'ohlc' | 'change', visible: boolean): void {
        this.parts[part] = visible;
        this.symbolEl.style.display = this.parts.name ? '' : 'none';
        this.marketEl.style.display = this.parts.market ? '' : 'none';
        this.ohlcEl.style.display = this.parts.ohlc ? '' : 'none';
        this.changeEl.style.display = this.parts.change ? '' : 'none';
    }

    partVisible(part: 'name' | 'market' | 'ohlc' | 'change'): boolean {
        return this.parts[part];
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.detach();
        this.lastBar = null;
        this.hoverBar = null;
        this.unsubs.push(
            chart.on('bar', (b: OHLCV) => {
                this.lastBar = b;
                if (!this.hoverBar) this.render();
            }),
            chart.renderer.onCrosshairMove((e) => {
                this.hoverBar = e.ohlc;
                this.render();
            }),
        );
        this.render();
    }

    destroy(): void {
        this.detach();
        this.host.classList.remove('vela-has-statusline'); // the legend shift leaves with the line
        this.el.remove();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
    }

    private render(): void {
        const bar = this.hoverBar ?? this.lastBar;
        if (!bar) {
            this.ohlcEl.replaceChildren();
            this.changeEl.textContent = '';
            return;
        }
        const dp = decimalsFor(bar.close);
        const doc = this.el.ownerDocument;
        const up = bar.close >= bar.open;
        const cell = (k: string, v: number) => {
            const s = doc.createElement('span');
            s.append(`${k} `);
            const b = doc.createElement('b');
            b.textContent = fmtPrice(v, dp);
            b.style.color = up ? 'var(--vela-up)' : 'var(--vela-down)';
            s.appendChild(b);
            return s;
        };
        this.ohlcEl.replaceChildren(cell('O', bar.open), cell('H', bar.high), cell('L', bar.low), cell('C', bar.close));
        this.changeEl.textContent = fmtChange(bar.open, bar.close);
        this.changeEl.dataset.dir = bar.close >= bar.open ? 'up' : 'down';
    }
}
