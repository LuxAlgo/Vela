// Symbol watermark — large faded "SYMBOL · TF" centered behind the chart chrome.
import { injectStyles } from '../ui/styles';
import { timeframeLabel } from './timeframe';
import { parseSymbol } from '../data/ProviderRegistry';

/** The watermark's largest type size — a lone full-size chart renders at this cap. */
const MAX_FONT_PX = 72;
/** Floor for tiny cells — the mark is a 5%-opacity background, small is fine. */
const MIN_FONT_PX = 12;
/** Share of the chart width the text may occupy (breathing room at both edges). */
const FILL = 0.9;

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
    font-size: ${MAX_FONT_PX}px;
    font-weight: 700;
    letter-spacing: 0.04em;
    user-select: none;
    white-space: nowrap;
}
`;

/**
 * The font size that fits `textPxAtMax` (the text's width measured AT the cap) into
 * `availPx` of chart width — PURE. Text width scales linearly with font size, so one
 * measurement at the cap decides the whole fit; the size is bounded to
 * [{@link MIN_FONT_PX}, {@link MAX_FONT_PX}]. The chart's OWN width is what bounds the
 * mark — a viewport-relative size overflows small cells in a multi-chart grid.
 */
export function watermarkFontPx(availPx: number, textPxAtMax: number): number {
    if (textPxAtMax <= 0) return MAX_FONT_PX;
    return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.floor((MAX_FONT_PX * availPx * FILL) / textPxAtMax)));
}

export class Watermark {
    readonly el: HTMLElement;
    private readonly text: HTMLElement;
    private readonly resizeObserver: ResizeObserver | null = null;

    constructor(host: HTMLElement, symbol: string, timeframe: string) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.el = host.ownerDocument.createElement('div');
        this.el.className = 'vela-watermark';
        this.text = host.ownerDocument.createElement('span');
        this.el.appendChild(this.text);
        host.appendChild(this.el);
        // The el is inset:0, so observing it tracks the chart's size (splitter drags,
        // layout changes) — refit whenever the space changes.
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.fit());
            this.resizeObserver.observe(this.el);
        }
        this.update(symbol, timeframe);
    }

    setVisible(visible: boolean): void {
        this.el.style.display = visible ? '' : 'none';
    }

    update(symbol: string, timeframe: string): void {
        // Bare ticker — the venue prefix is routing identity, not something to watermark.
        this.text.textContent = symbol ? `${parseSymbol(symbol).ticker} · ${timeframeLabel(timeframe)}` : '';
        this.fit();
    }

    /** Measure the text at the cap and shrink it to the chart's own width. */
    private fit(): void {
        if (this.el.clientWidth <= 0 || !this.text.textContent) return;
        this.el.style.fontSize = `${MAX_FONT_PX}px`;
        const px = watermarkFontPx(this.el.clientWidth, this.text.getBoundingClientRect().width);
        if (px !== MAX_FONT_PX) this.el.style.fontSize = `${px}px`;
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        this.el.remove();
    }
}
