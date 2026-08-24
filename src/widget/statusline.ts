// In-chart status line (top-left overlay): symbol + the OHLC/change of the bar under the
// crosshair, falling back to the latest live bar. Resting values come from the chart's
// `bar` event; hover values from the renderer crosshair seam (RendererControl.onCrosshairMove).
import type { Vela } from '../Vela';
import type { OHLCV } from '../core/model/ohlcv';
import { injectStyles } from '../ui/styles';
import { Tooltip } from '../ui/components/tooltip';
import { CalloutBubble } from '../ui/components/callout-bubble';
import { SESSION_PRE, SESSION_POST, SESSION_OFF } from '../core/palette';
import { fmtPrice, fmtChange, decimalsFor } from './format';
import { timeframeLabel } from './timeframe';
import { tickerIconEl } from './symbol-icon';
import { parseSymbol } from '../data/ProviderRegistry';
import { LEGEND_AT_TOP_ATTR } from '../renderers/shared/InputsUI';

const STYLE_ID = 'vela-widget-statusline';
const CSS = `
.vela-statusline {
    position: absolute;
    top: var(--vela-space-2);
    /* Track the indicator legend's left edge: the renderer publishes its toolbar gutter
     * on the mount container, and the legend sits 10px into the plot to its right —
     * so the two columns stay aligned whether the toolbar is docked (44px), collapsed
     * (16px), or absent entirely (a workspace cell: 0). */
    left: calc(var(--vela-toolbar-gutter, 0px) + 10px);
    z-index: 10;
    display: flex;
    align-items: baseline;
    gap: var(--vela-space-2);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    /* Same chip treatment as the indicator legend rows (InputsUI): a translucent wash of
     * the chart background when idle — enough to keep the readout legible when candles
     * reach it — and the solid chart background on hover. Symmetric 7px padding with a
     * compensating negative margin (mirroring the legend rows) keeps the avatar's left
     * edge on the legend column's left edge (both at left:10px) while the chip itself
     * extends 7px further left, so both columns' chips share the same left edge. */
    pointer-events: auto;
    background: color-mix(in srgb, var(--vela-bg) 60%, transparent);
    border-radius: 4px;
    padding: 2px 7px;
    margin-left: -7px;
}
.vela-statusline:hover { background: var(--vela-bg); }
.vela-statusline .vela-sl-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: 10px;
    font-weight: 700;
}
.vela-statusline .vela-sl-symbol { font-weight: 600; font-size: var(--vela-font-size-lg); }
.vela-statusline .vela-sl-meta { color: var(--vela-fg-muted); font-size: var(--vela-font-size-md); font-weight: 600; }
/* Market status badge — a kit callout bubble (icon-only 16px circle, label on hover
 * via the kit tooltip); the session tint is applied per status in setMarketStatus. */
.vela-statusline .vela-sl-market { align-self: center; }
.vela-statusline .vela-sl-ohlc { display: flex; gap: var(--vela-space-1); color: var(--vela-fg-muted); }
.vela-statusline .vela-sl-ohlc b { color: var(--vela-fg); font-weight: 500; }
/* The change value wears the SAME ink as the OHLC values (set inline per render) —
 * these are the pre-ink fallbacks only. */
.vela-statusline .vela-sl-change[data-dir='up'] { color: var(--vela-up); }
.vela-statusline .vela-sl-change[data-dir='down'] { color: var(--vela-down); }
/* Stack the TOP pane's legend below the status line (lower study panes stay put).
 * The renderer marks whichever legend sits at the plot's top edge — the price pane
 * normally, or a maximized study pane filling the plot — so the legend never merges
 * with the status line whichever pane owns the top. The renderer sets the legend's
 * inline top — shift with a transform, don't fight it. Scoped to hosts that actually
 * CARRY a status line (the marker class set by the Statusline constructor) — the
 * stylesheet is document-global, so a bare attribute selector here would shift every
 * chart on the page, including statusline-less ones. */
.vela-has-statusline [${LEGEND_AT_TOP_ATTR}] { transform: translateY(26px); }
/* Mobile: two-line chip — logo / symbol / meta / market status on one aligned row, the
 * bar change on the next. Full O/H/L/C stays hidden (too dense on a phone-width plot).
 * GRID, not a wrapping flexbox: an absolutely positioned wrapping flex container sizes
 * to the one-line sum of ALL segments (max-content), so its background used to stretch
 * far past the market badge; a grid hugs the widest actual row. The meta column may
 * shrink (it carries the ellipsis), the others wrap their content. */
[data-layout='mobile'] .vela-statusline {
    display: grid;
    grid-template-columns: auto auto minmax(0, auto) auto;
    justify-content: start;
    align-items: center;
    row-gap: 1px;
    max-width: calc(100% - var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px) - 24px);
    font-size: var(--vela-font-size-sm);
}
[data-layout='mobile'] .vela-statusline .vela-sl-symbol {
    font-size: var(--vela-font-size-md);
    line-height: 1;
}
[data-layout='mobile'] .vela-statusline .vela-sl-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
}
[data-layout='mobile'] .vela-statusline .vela-sl-avatar,
[data-layout='mobile'] .vela-statusline .vela-sl-market { align-self: center; }
[data-layout='mobile'] .vela-statusline .vela-sl-ohlc { display: none !important; }
[data-layout='mobile'] .vela-statusline .vela-sl-change {
    /* Second row, under the text column — the avatar keeps the first column. */
    grid-column: 2 / -1;
    font-size: var(--vela-font-size-sm);
    line-height: 1.2;
}
[data-layout='mobile'] .vela-has-statusline [${LEGEND_AT_TOP_ATTR}] { transform: translateY(40px); }
/* FIT mode (multi-chart cells — see setFitMode): the line never wraps; segments that
 * don't fit are HIDDEN by fit() (change first, then meta, then the market badge), so
 * overflow:hidden only guards the transient between a resize and the next measure.
 * Placed after the mobile block on purpose: same specificity, later wins. */
.vela-statusline.vela-sl-fit {
    display: flex; /* undo the mobile grid — fit mode is one flex row again */
    flex-wrap: nowrap;
    align-items: center;
    max-width: calc(100% - var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px) - 24px);
    overflow: hidden;
}
.vela-statusline.vela-sl-fit .vela-sl-change {
    flex-basis: auto;
    padding-left: 0;
}
/* One row again — the mobile two-line shift doesn't apply in fit mode. */
[data-layout='mobile'] .vela-sl-fit-host.vela-has-statusline [${LEGEND_AT_TOP_ATTR}] { transform: translateY(26px); }
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

/** The renderer reads the ink derivation needs — `chart.renderer` satisfies it. */
interface RendererReads {
    getConfig(): unknown;
    get(key: string): unknown;
}

/** How the status line reads a bar out: the four O/H/L/C values (bar-shaped styles),
 *  or the single plotted value — the close — for one-line styles (line/area/baseline). */
export type StatuslineReadout = 'ohlc' | 'value';

/** The market session states the status badge can wear. Crypto venues trade
 *  continuously and stay 'open'; the full vocabulary is ready for providers that
 *  carry a session model (equities RTH/ETH, exchange holidays). */
export type MarketStatus = 'open' | 'pre' | 'post' | 'closed' | 'holiday';

const MARKET_LABELS: Record<MarketStatus, string> = {
    open: 'Market Open',
    pre: 'Pre-Market',
    post: 'Post-Market',
    closed: 'Market Closed',
    holiday: 'Market Holiday',
};

/** Session ink: open wears the theme's up color; the other sessions are meaning
 *  constants from the palette (amber pre, sky post, gray closed/holiday). The badge
 *  circle is the same ink at a 20% wash. */
const MARKET_INKS: Record<MarketStatus, string> = {
    open: 'var(--vela-up)',
    pre: SESSION_PRE,
    post: SESSION_POST,
    closed: SESSION_OFF,
    holiday: SESSION_OFF,
};

/**
 * The active price style's value readout for the status line, read live from the
 * renderer: the up/down COLORS from the cosmetic config (candle bodies for candles/HA —
 * and plugin styles, which paint candles as their base — bar ticks for bars, the single
 * plot color for line/area, the two baseline line colors for baseline), the DIRECTION
 * rule that decides which of the two a bar wears, and the readout SHAPE. Candles/bars
 * compare close to open and show O/H/L/C; single-line styles show just the plotted
 * value; baseline compares close to the LIVE baseline reference price (the paint splits
 * by position, not by bar direction — a bar that closed down can still sit in the green
 * region). Null colors fall back to the theme tokens.
 */
export function statuslineInkOf(renderer: RendererReads, priceStyle: string): [string | null, string | null, ((bar: { open: number; close: number }) => boolean) | null, StatuslineReadout] {
    const cfg = renderer.getConfig() as
        | {
              candles?: { upColor?: unknown; downColor?: unknown };
              bars?: { upColor?: unknown; downColor?: unknown };
              line?: { color?: unknown };
              area?: { lineColor?: unknown };
              baseline?: { topLineColor?: unknown; bottomLineColor?: unknown };
          }
        | null
        | undefined;
    const c = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    switch (priceStyle) {
        case 'bars':
            return [c(cfg?.bars?.upColor), c(cfg?.bars?.downColor), null, 'ohlc'];
        case 'line': {
            const v = c(cfg?.line?.color);
            return [v, v, null, 'value'];
        }
        case 'area': {
            const v = c(cfg?.area?.lineColor);
            return [v, v, null, 'value'];
        }
        case 'baseline': {
            // Resolved per render: the percent-level baseline moves with the visible range.
            const isUp = (bar: { open: number; close: number }): boolean => {
                const level = Number(renderer.get('baselinePrice'));
                return Number.isFinite(level) ? bar.close >= level : bar.close >= bar.open;
            };
            return [c(cfg?.baseline?.topLineColor), c(cfg?.baseline?.bottomLineColor), isUp, 'value'];
        }
        default:
            return [c(cfg?.candles?.upColor), c(cfg?.candles?.downColor), null, 'ohlc'];
    }
}

/** The status line's toggleable segments (the settings dialog's Status line tab). */
export type StatuslinePart = 'name' | 'market' | 'ohlc' | 'change';

export class Statusline {
    readonly el: HTMLElement;
    private readonly ohlcEl: HTMLElement;
    private readonly changeEl: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly marketEl: HTMLElement;
    /** The badge itself — a kit callout bubble (the same element as {@link marketEl}). */
    private readonly marketBubble: CalloutBubble;
    private marketTip!: Tooltip;
    private avatarEl: HTMLElement;
    private metaEl!: HTMLElement;
    private readonly parts = { name: true, market: true, ohlc: true, change: true };
    private lastBar: BarLike | null = null;
    private hoverBar: BarLike | null = null;
    private unsubs: Array<() => void> = [];
    /** Up/down ink for the OHLC + change values — the ACTIVE price style's configured
     *  colors (candle bodies, bar ticks, the line color, …); null falls back to the theme
     *  tokens. `isUp` overrides the close-vs-open direction rule where the style paints by
     *  something else (baseline: position against the baseline price). */
    private upColor: string | null = null;
    private downColor: string | null = null;
    private isUp: ((bar: { open: number; close: number }) => boolean) | null = null;
    /** 'ohlc' for bar-shaped styles; 'value' (the single plotted close) for line styles. */
    private readout: StatuslineReadout = 'ohlc';
    /** Fit mode (multi-chart cells): one row, overflowing segments hidden — see {@link setFitMode}. */
    private fitMode = false;
    private fitRO: ResizeObserver | null = null;

    constructor(
        private readonly host: HTMLElement,
        symbol: string,
        /** The avatar's icon URL for a raw symbol — the shell routes it to the owning
         *  provider's `resolveSymbolIcon`. Absent ⇒ the initials badge. */
        private readonly iconFor?: (symbol: string) => string | undefined,
    ) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        host.classList.add('vela-has-statusline'); // scopes the price-legend shift to THIS host
        this.el = doc.createElement('div');
        this.el.className = 'vela-statusline';
        // Opt into the renderer's PNG export — the status line is part of what's on screen.
        this.el.dataset.velaScreenshot = '1';
        // Display the bare ticker — the venue prefix is identity, not label; the venue
        // itself shows in the meta segment ("· BINANCE · 1h") beside it.
        const ticker = parseSymbol(symbol).ticker;
        this.avatarEl = tickerIconEl(doc, baseOfTicker(ticker), ticker, 'vela-sl-avatar', this.iconFor?.(symbol));
        this.symbolEl = doc.createElement('span');
        this.symbolEl.className = 'vela-sl-symbol';
        this.symbolEl.textContent = ticker;
        this.metaEl = doc.createElement('span');
        this.metaEl.className = 'vela-sl-meta';
        // The badge is the shared kit callout bubble — no panel, so it stays a plain
        // (non-clickable) tinted circle; setMarketStatus re-dresses it per session.
        this.marketBubble = new CalloutBubble({
            icon: 'market-open',
            background: `color-mix(in srgb, ${MARKET_INKS.open} 20%, transparent)`,
            color: MARKET_INKS.open,
            label: MARKET_LABELS.open,
            host,
        });
        this.marketEl = this.marketBubble.el;
        this.marketEl.classList.add('vela-sl-market');
        this.ohlcEl = doc.createElement('span');
        this.ohlcEl.className = 'vela-sl-ohlc';
        this.changeEl = doc.createElement('span');
        this.changeEl.className = 'vela-sl-change';
        this.el.append(this.avatarEl, this.symbolEl, this.metaEl, this.marketEl, this.ohlcEl, this.changeEl);
        host.appendChild(this.el);
        // The tooltip portals to the nearest `.vela-ui` ancestor for theme tokens — resolve
        // it AFTER the statusline is in the DOM. Content follows setMarketStatus.
        this.marketTip = new Tooltip(this.marketEl, { content: MARKET_LABELS.open, placement: 'bottom' });
        this.setMarketStatus('open'); // crypto trades continuously (no session model yet)
        this.render();
    }

    setSymbol(symbol: string): void {
        const ticker = parseSymbol(symbol).ticker;
        this.symbolEl.textContent = ticker;
        const fresh = tickerIconEl(this.el.ownerDocument, baseOfTicker(ticker), ticker, 'vela-sl-avatar', this.iconFor?.(symbol));
        this.avatarEl.replaceWith(fresh);
        this.avatarEl = fresh;
        this.fit();
    }

    /**
     * Multi-chart cells: keep the line on ONE row whatever the cell width — never wrap.
     * Segments that don't fit are hidden outright rather than clipped mid-glyph, least
     * important first: OHLC, then the bar change, the venue/timeframe meta, and the
     * market badge; the logo + ticker always stay. Re-fits live on host resizes.
     */
    setFitMode(on: boolean): void {
        if (on === this.fitMode) return;
        this.fitMode = on;
        this.el.classList.toggle('vela-sl-fit', on);
        this.host.classList.toggle('vela-sl-fit-host', on);
        if (on) {
            if (typeof ResizeObserver !== 'undefined' && !this.fitRO) {
                this.fitRO = new ResizeObserver(() => this.fit());
                this.fitRO.observe(this.host);
            }
            this.fit();
        } else {
            this.fitRO?.disconnect();
            this.fitRO = null;
            this.syncParts(); // restore whatever fit() had hidden
        }
    }

    /** Project the parts config onto the segments (the baseline fit() prunes from). */
    private syncParts(): void {
        this.symbolEl.style.display = this.parts.name ? '' : 'none';
        this.marketEl.style.display = this.parts.market ? '' : 'none';
        this.ohlcEl.style.display = this.parts.ohlc ? '' : 'none';
        this.changeEl.style.display = this.parts.change ? '' : 'none';
    }

    /** Hide overflowing segments until the row fits its max-width (fit mode only). */
    private fit(): void {
        if (!this.fitMode) return;
        this.syncParts(); // start from the full (parts-allowed) row, then prune
        const order: Array<[HTMLElement, boolean]> = [
            [this.ohlcEl, this.parts.ohlc],
            [this.changeEl, this.parts.change],
            [this.metaEl, true],
            [this.marketEl, this.parts.market],
        ];
        for (const [el, shown] of order) {
            if (this.el.scrollWidth <= this.el.clientWidth) break;
            if (shown) el.style.display = 'none';
        }
    }

    /** Shape + color the value readout after the active price style: its own up/down
     *  colors (candle bodies, bar ticks, the line color, …), the direction rule that
     *  picks between them (`isUp` replaces close-vs-open where the style paints by
     *  something else — baseline by position), and whether the readout is the four
     *  O/H/L/C values or the single plotted value (one-line styles). Null colors fall
     *  back to the theme's up/down tokens. See {@link statuslineInkOf}, which derives
     *  all of it from the live renderer. */
    setDirectionColors(up: string | null, down: string | null, isUp: ((bar: { open: number; close: number }) => boolean) | null = null, readout: StatuslineReadout = 'ohlc'): void {
        this.upColor = up;
        this.downColor = down;
        this.isUp = isUp;
        this.readout = readout;
        this.render();
    }

    /** Show/hide one part (the settings dialog's Status line tab drives these). */
    /** The "· BINANCE · 1h" segment after the symbol — venue first, then resolution. */
    setMeta(timeframe: string, provider: string): void {
        this.metaEl.textContent = `${provider ? `· ${provider.toUpperCase()} ` : ''}· ${timeframeLabel(timeframe)}`;
        this.fit();
    }

    /** Dress the market badge for a session state: its icon, tinted circle, and the
     *  hover label. Callers with no session model leave the constructor's 'open'. */
    setMarketStatus(status: MarketStatus): void {
        this.marketEl.dataset.status = status;
        const ink = MARKET_INKS[status];
        this.marketBubble.set({
            icon: `market-${status}`,
            background: `color-mix(in srgb, ${ink} 20%, transparent)`,
            color: ink,
            label: MARKET_LABELS[status],
        });
        this.marketTip.setContent(MARKET_LABELS[status]);
    }

    setPartVisible(part: StatuslinePart, visible: boolean): void {
        this.parts[part] = visible;
        this.syncParts();
        this.fit();
    }

    partVisible(part: StatuslinePart): boolean {
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
        this.fitRO?.disconnect();
        this.fitRO = null;
        this.marketTip.destroy();
        this.marketBubble.destroy();
        this.host.classList.remove('vela-has-statusline', 'vela-sl-fit-host'); // the legend shift leaves with the line
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
        const up = this.isUp ? this.isUp(bar) : bar.close >= bar.open;
        // ONE ink for the whole readout — OHLC values and the change share it, so the
        // row always reads in the color the plot wears at this bar.
        const ink = up ? (this.upColor ?? 'var(--vela-up)') : (this.downColor ?? 'var(--vela-down)');
        const cell = (k: string, v: number) => {
            const s = doc.createElement('span');
            if (k) s.append(`${k} `);
            const b = doc.createElement('b');
            b.textContent = fmtPrice(v, dp);
            b.style.color = ink;
            s.appendChild(b);
            return s;
        };
        // Bar-shaped styles read out all four values; a one-line style (line/area/baseline)
        // plots a single series, so its readout is just that value — the close.
        if (this.readout === 'value') this.ohlcEl.replaceChildren(cell('', bar.close));
        else this.ohlcEl.replaceChildren(cell('O', bar.open), cell('H', bar.high), cell('L', bar.low), cell('C', bar.close));
        this.changeEl.textContent = fmtChange(bar.open, bar.close);
        this.changeEl.dataset.dir = up ? 'up' : 'down';
        this.changeEl.style.color = ink;
        this.fit(); // the readout's width just changed — cheap no-op outside fit mode
    }
}
