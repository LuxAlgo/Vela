// In-chart status line (top-left overlay): symbol + the OHLC/change of the bar under the
// crosshair, falling back to the latest live bar. Resting values come from the chart's
// `bar` event; hover values from the renderer crosshair seam (RendererControl.onCrosshairMove).
import type { Vela } from '../Vela';
import type { OHLCV } from '../core/model/ohlcv';
import { injectStyles } from '../ui/styles';
import { Tooltip } from '../ui/components/tooltip';
import { CalloutBubble } from '../ui/components/callout-bubble';
import { Menu } from '../ui/components/menu';
import { segmentVisibility, statuslineMenuItems, STATUSLINE_LADDER, readoutCells, type StatuslinePart, type StatuslineLayout } from './statusline-model';
import { SESSION_PRE, SESSION_POST, SESSION_OFF } from '../core/palette';
import { iconAt } from '../core/icons';
import { fmtPrice, fmtChange, fmtChangePct, decimalsFor } from './format';
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
    /* The chip never grows past the plot: fit() measures overflow against this width to
     * walk the layout ladder (stack, then shed values), so overflow:hidden only guards
     * the transient between a resize and the next measure. */
    max-width: calc(100% - var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px) - 24px);
    overflow: hidden;
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
/* Hovering opens the chip the same way a legend row opens: solid chart background
 * plus the same inset neutral outline the indicator rows wear (InputsUI's
 * setRowHighlighted) — the two columns read as one family. */
.vela-statusline:hover { background: var(--vela-bg); box-shadow: inset 0 0 0 1px var(--vela-border); }
/* Chart hidden (the price series' eye — renderer 'candleVisible'): the line dims to
 * the same 0.5 wash a hidden indicator's legend row wears. */
.vela-statusline.vela-sl-chart-hidden { opacity: 0.5; }
/* Two rows inside the chip — the identity (logo / symbol / meta / market badge) and the
 * value readout (O/H/L/C + change, or the show-chart eye). In the widest layout they sit
 * side by side on one line; the STACKED layouts (fit() decides, see the ladder in
 * statusline-model) turn the chip into a column so the values drop under the symbol. */
.vela-statusline .vela-sl-row {
    display: flex;
    align-items: baseline;
    gap: var(--vela-space-2);
    white-space: nowrap;
}
.vela-statusline.vela-sl-stacked {
    flex-direction: column;
    align-items: flex-start;
    /* The same air between the two rows as between the values row and the legend row
     * that follows the chip (see the stacked legend shift below). */
    row-gap: var(--vela-space-1);
}
/* Stacked, the identity row may shrink (the meta carries the ellipsis) — the values row
 * never does, so its overflow is what fit() measures to keep descending the ladder. */
.vela-statusline.vela-sl-stacked .vela-sl-identity { max-width: 100%; }
.vela-statusline.vela-sl-stacked .vela-sl-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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
/* The show-chart eye — out only while the chart is hidden (syncParts drives display),
 * replacing the value readout it took away. Same footprint as a legend action button. */
.vela-statusline .vela-sl-eye {
    align-self: center;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--vela-fg-muted);
    cursor: pointer;
    line-height: 0;
    flex: none;
}
.vela-statusline .vela-sl-eye:hover { color: var(--vela-fg); background: color-mix(in srgb, var(--vela-fg) 12%, transparent); }
/* Stack the TOP pane's legend below the status line (lower study panes stay put).
 * The renderer marks whichever legend sits at the plot's top edge — the price pane
 * normally, or a maximized study pane filling the plot — so the legend never merges
 * with the status line whichever pane owns the top. The renderer sets the legend's
 * inline top — shift with a transform, don't fight it. Scoped to hosts that actually
 * CARRY a status line (the marker class set by the Statusline constructor) — the
 * stylesheet is document-global, so a bare attribute selector here would shift every
 * chart on the page, including statusline-less ones. */
.vela-has-statusline [${LEGEND_AT_TOP_ATTR}] { transform: translateY(26px); }
/* A stacked chip is two lines tall — the legend shifts one more line. fit() flags the
 * host whenever the ladder lands on a stacked layout. */
.vela-has-statusline.vela-sl-stacked-host [${LEGEND_AT_TOP_ATTR}] { transform: translateY(40px); }
/* Mobile: the same ladder at the phone's type scale — the width alone decides how much
 * of the readout fits, exactly as on a narrow desktop chart. */
[data-layout='mobile'] .vela-statusline { font-size: var(--vela-font-size-sm); }
[data-layout='mobile'] .vela-statusline .vela-sl-symbol { font-size: var(--vela-font-size-md); }
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
 *  carry a session model (equities RTH/ETH, exchange holidays). Overnight roll
 *  tapes wear the single 'extended' state — they have no pre/post split. */
export type MarketStatus = 'open' | 'pre' | 'post' | 'extended' | 'closed' | 'holiday';

const MARKET_LABELS: Record<MarketStatus, string> = {
    open: 'Market Open',
    pre: 'Pre-Market',
    post: 'Post-Market',
    extended: 'Extended Hours',
    closed: 'Market Closed',
    holiday: 'Market Holiday',
};

/** Session ink: open wears the theme's up color; the other sessions are meaning
 *  constants from the palette (amber pre, sky post and extended, gray closed/holiday).
 *  The badge circle is the same ink at a 20% wash. */
const MARKET_INKS: Record<MarketStatus, string> = {
    open: 'var(--vela-up)',
    pre: SESSION_PRE,
    post: SESSION_POST,
    extended: SESSION_POST,
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

export { segmentVisibility, statuslineMenuItems, type StatuslinePart } from './statusline-model';

/** Host hooks behind the right-click action menu. Part toggles route through the host
 *  (never straight into {@link Statusline.setPartVisible}) so its persistence and
 *  style-link mirroring follow; the chart toggle reaches the renderer the host owns. */
export interface StatuslineMenuHooks {
    setPart: (part: StatuslinePart, visible: boolean) => void;
    /** Whether the main price series is currently painted (the renderer's `candleVisible`). */
    chartVisible: () => boolean;
    setChartVisible: (visible: boolean) => void;
}

export class Statusline {
    readonly el: HTMLElement;
    private readonly ohlcEl: HTMLElement;
    private readonly changeEl: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly marketEl: HTMLElement;
    /** The badge itself — a kit callout bubble (the same element as {@link marketEl}). */
    private readonly marketBubble: CalloutBubble;
    private marketTip!: Tooltip;
    /** The show-chart eye — visible only while the chart is hidden. */
    private readonly eyeEl: HTMLButtonElement;
    private eyeTip!: Tooltip;
    private avatarEl: HTMLElement;
    private metaEl!: HTMLElement;
    private readonly parts: Record<StatuslinePart, boolean> = { logo: true, name: true, market: true, ohlc: true, change: true };
    /** The right-click action menu — present once a host wires it via {@link attachMenu}. */
    private menu: Menu | null = null;
    private menuHooks: StatuslineMenuHooks | null = null;
    /** Mirror of the renderer's `candleVisible` — see {@link setChartHidden}. */
    private chartHidden = false;
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
    /** The identity row (avatar / symbol / meta / market) and the values row (readout /
     *  eye) — one line side by side, or a two-line column once the ladder stacks them. */
    private readonly identityRow: HTMLElement;
    private readonly valuesRow: HTMLElement;
    /** The ladder rung currently applied — see {@link fit}. */
    private layout: StatuslineLayout = { stacked: false, level: 'full' };

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
        // Show-chart eye: takes the value readout's place while the chart is hidden
        // (same glyph the legend rows wear on a hidden indicator). syncParts drives it.
        this.eyeEl = doc.createElement('button');
        this.eyeEl.type = 'button';
        this.eyeEl.className = 'vela-sl-eye';
        this.eyeEl.innerHTML = iconAt('eye-off', 14);
        this.eyeEl.setAttribute('aria-label', 'Show chart');
        this.eyeEl.style.display = 'none';
        this.eyeEl.addEventListener('click', (e) => {
            e.stopPropagation(); // never bubbles into the chip's own handlers
            this.menuHooks?.setChartVisible(true);
            this.setChartHidden(false);
        });
        this.identityRow = doc.createElement('span');
        this.identityRow.className = 'vela-sl-row vela-sl-identity';
        this.identityRow.append(this.avatarEl, this.symbolEl, this.metaEl, this.marketEl);
        this.valuesRow = doc.createElement('span');
        this.valuesRow.className = 'vela-sl-row vela-sl-values';
        this.valuesRow.append(this.ohlcEl, this.changeEl, this.eyeEl);
        this.el.append(this.identityRow, this.valuesRow);
        host.appendChild(this.el);
        // The ladder measures against the plot width — re-fit on every host resize.
        if (typeof ResizeObserver !== 'undefined') {
            this.fitRO = new ResizeObserver(() => this.fit());
            this.fitRO.observe(host);
        }
        // The tooltips portal to the nearest `.vela-ui` ancestor for theme tokens — resolve
        // them AFTER the statusline is in the DOM. The badge's content follows setMarketStatus.
        this.marketTip = new Tooltip(this.marketEl, { content: MARKET_LABELS.open, placement: 'bottom' });
        this.eyeTip = new Tooltip(this.eyeEl, { content: 'Show chart', placement: 'bottom' });
        this.setMarketStatus('open'); // crypto trades continuously (no session model yet)
        this.render();
    }

    setSymbol(symbol: string): void {
        const ticker = parseSymbol(symbol).ticker;
        this.symbolEl.textContent = ticker;
        const fresh = tickerIconEl(this.el.ownerDocument, baseOfTicker(ticker), ticker, 'vela-sl-avatar', this.iconFor?.(symbol));
        this.avatarEl.replaceWith(fresh);
        this.avatarEl = fresh;
        this.syncParts(); // the fresh avatar must inherit a hidden logo part
        this.fit();
    }

    /**
     * Multi-chart cells: the same width ladder as a single chart, plus a last resort for
     * cells too narrow for even its bottom rung — whatever still overflows is hidden
     * outright rather than clipped mid-glyph, least important first: the values, the
     * venue/timeframe meta, then the market badge; the logo + ticker always stay.
     */
    setFitMode(on: boolean): void {
        if (on === this.fitMode) return;
        this.fitMode = on;
        this.fit();
    }

    /** Project the parts config onto the segments (the baseline fit() prunes from). */
    private syncParts(): void {
        const seg = segmentVisibility(this.parts, this.chartHidden);
        this.avatarEl.style.display = seg.avatar ? '' : 'none';
        this.symbolEl.style.display = seg.symbol ? '' : 'none';
        this.metaEl.style.display = seg.meta ? '' : 'none';
        this.marketEl.style.display = seg.market ? '' : 'none';
        this.ohlcEl.style.display = seg.ohlc ? '' : 'none';
        this.changeEl.style.display = seg.change ? '' : 'none';
        this.eyeEl.style.display = seg.eye ? 'inline-flex' : 'none';
        // An empty values row must not hold a gap/padding of its own on the line.
        this.valuesRow.style.display = seg.ohlc || seg.change || seg.eye ? '' : 'none';
    }

    /** Apply one ladder rung: the stacked/inline shape and the readout's level. */
    private applyLayout(layout: StatuslineLayout): void {
        this.layout = layout;
        this.el.classList.toggle('vela-sl-stacked', layout.stacked);
        this.host.classList.toggle('vela-sl-stacked-host', layout.stacked);
        this.renderValues();
    }

    /**
     * Walk the width ladder (see {@link STATUSLINE_LADDER}) until the chip fits its
     * max-width: the full one-line readout, then the values stacked under the symbol
     * line, then O/H/L shed, then the absolute change. In fit mode, when the last rung
     * still overflows, whole segments hide, least important first. Without layout
     * (detached host, node tests) nothing overflows, so the widest rung stays.
     */
    private fit(): void {
        this.syncParts(); // start from the full (parts-allowed) row, then descend
        const seg = segmentVisibility(this.parts, this.chartHidden);
        const overflows = (): boolean => this.el.scrollWidth > this.el.clientWidth;
        // Only a value readout can stack or shed — with none showing the chip stays one line.
        const hasValues = seg.ohlc || seg.change;
        for (const rung of STATUSLINE_LADDER) {
            this.applyLayout(rung);
            if (!hasValues || !overflows()) break;
        }
        if (!this.fitMode) return;
        const order: Array<[HTMLElement, boolean]> = [
            [this.valuesRow, hasValues],
            [this.metaEl, seg.meta],
            [this.marketEl, seg.market],
        ];
        for (const [el, shown] of order) {
            if (!overflows()) break;
            if (shown) el.style.display = 'none';
        }
        // With the values row gone the chip is one line again — un-stack so the legend
        // shift drops back to a single line's.
        if (this.valuesRow.style.display === 'none') this.applyLayout({ ...this.layout, stacked: false });
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

    /** Show/hide one part — the settings dialog's Status line tab and the right-click
     *  menu both drive these. 'name' owns the venue/timeframe meta too (see
     *  {@link segmentVisibility}). */
    setPartVisible(part: StatuslinePart, visible: boolean): void {
        this.parts[part] = visible;
        this.syncParts();
        this.fit();
    }

    partVisible(part: StatuslinePart): boolean {
        return this.parts[part];
    }

    /** Mirror the chart's (price series') visibility: dim the whole line like a hidden
     *  indicator's legend row, drop the value readout (OHLC + bar change — values of a
     *  series that isn't painted), and put the show-chart eye out in its place. The
     *  parts config is untouched, so showing the chart restores the readout exactly as
     *  configured. Idempotent; {@link render} re-syncs it from the live renderer, so
     *  toggles made elsewhere (the object tree's eye) converge too. */
    setChartHidden(hidden: boolean): void {
        if (hidden === this.chartHidden) return;
        this.chartHidden = hidden;
        this.el.classList.toggle('vela-sl-chart-hidden', hidden);
        this.syncParts();
        this.fit();
    }

    /** Wire the right-click action menu: one checkable toggle per part plus hide/show
     *  for the chart itself. The menu is built once; later calls just swap the hooks. */
    attachMenu(hooks: StatuslineMenuHooks): void {
        this.menuHooks = hooks;
        if (this.menu) return;
        this.menu = new Menu({
            host: this.host,
            items: [],
            placement: 'bottom-start',
            // Pointer-anchored action menu — checked state reads as a leading ✓ (the
            // same shape as the chart's own context menu).
            checkmarks: true,
            onSelect: (id) => this.runMenuItem(id),
        });
        this.el.addEventListener('contextmenu', this.onContextMenu);
    }

    private readonly onContextMenu = (e: MouseEvent): void => {
        if (!this.menu || !this.menuHooks) return;
        // This right-click is the status line's — keep the chart's own context menu closed.
        e.preventDefault();
        e.stopPropagation();
        const chartVisible = this.menuHooks.chartVisible();
        this.setChartHidden(!chartVisible); // opportunistic re-sync with the live renderer
        this.menu.setItems(statuslineMenuItems(this.parts, chartVisible));
        this.menu.openAt(e.clientX, e.clientY);
    };

    private runMenuItem(id: string): void {
        const hooks = this.menuHooks;
        if (!hooks) return;
        if (id.startsWith('part:')) {
            const part = id.slice('part:'.length) as StatuslinePart;
            hooks.setPart(part, !this.parts[part]);
        } else if (id === 'chart') {
            const next = !hooks.chartVisible();
            hooks.setChartVisible(next);
            this.setChartHidden(!next);
        }
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
        this.el.removeEventListener('contextmenu', this.onContextMenu);
        this.menu?.destroy();
        this.menu = null;
        this.marketTip.destroy();
        this.eyeTip.destroy();
        this.marketBubble.destroy();
        this.host.classList.remove('vela-has-statusline', 'vela-sl-stacked-host'); // the legend shift leaves with the line
        this.el.remove();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
    }

    private render(): void {
        // Chart visibility has no change event of its own — re-derive it from the live
        // renderer on every readout refresh (bar ticks, crosshair moves), so a toggle
        // made anywhere (the object tree's eye) reaches the status line.
        if (this.menuHooks) this.setChartHidden(!this.menuHooks.chartVisible());
        this.fit(); // re-walks the ladder — the readout's width follows the bar
    }

    /** Write the value readout for the current bar at the current ladder level. */
    private renderValues(): void {
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
        // Bar-shaped styles read out all four values at the full level and just the close
        // below it; a one-line style (line/area/baseline) plots a single series, so its
        // readout is that value — the close — at every level. The minimal level keeps the
        // percent delta alone.
        const { level } = this.layout;
        this.ohlcEl.replaceChildren(...readoutCells(level, this.readout).map((c) => cell(c.label, bar[c.key])));
        this.changeEl.textContent = level === 'minimal' ? fmtChangePct(bar.open, bar.close) : fmtChange(bar.open, bar.close);
        this.changeEl.dataset.dir = up ? 'up' : 'down';
        this.changeEl.style.color = ink;
    }
}
