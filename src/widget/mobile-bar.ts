// Mobile bottom bar — the ONE navigation surface of the mobile chrome. Six stops, left
// to right: symbol (fullscreen search), timeframe (drawer), indicators (fullscreen
// picker), drawings (drawer), the three-dots drawer (everything else), and chart
// settings. It replaces BOTH desktop bars: this stylesheet also carries the mobile
// visibility flips for the topbar and the desktop bottombar, so the whole swap lives
// in one place and follows the root's `data-layout` attribute with no JS.
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageLike, Translator } from '../core/i18n/types';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { parseSymbol } from '../data/ProviderRegistry';
import { timeframeLabel } from './timeframe';
import { mobilePlacement, widgetActions, type WidgetContext } from './contributions';
import { TOPBAR_BUILTIN_IDS } from './topbar-composition';

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
.vela-mb-item[hidden] { display: none; }
.vela-mb-item[hidden] { display: none !important; }
.vela-mb-item:active { background: var(--vela-hover); }
.vela-mb-item .vela-icon { font-size: 18px; width: 18px; height: 18px; }
/* A lit stop (the maximize toggle while something is isolated): the inverse
   "selected" chip — white on the dark theme, dark on the light one. */
.vela-mb-item.vela-mb-on, .vela-mb-item.vela-mb-on:active { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
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

const TEXT = {
    symbolSearch: msg('widget.mobileBar.symbolSearch', 'Symbol search'),
    timeframe: msg('widget.mobileBar.timeframe', 'Timeframe'),
    indicators: msg('widget.mobileBar.indicators', 'Indicators'),
    drawings: msg('widget.mobileBar.drawings', 'Drawings'),
    maximizeChart: msg('widget.mobileBar.maximizeChart', 'Maximize chart'),
    restoreLayout: msg('widget.mobileBar.restoreLayout', 'Restore layout'),
    more: msg('widget.mobileBar.more', 'More'),
    chartSettings: msg('widget.mobileBar.chartSettings', 'Chart settings'),
};

export interface MobileBarOptions {
    symbol: string;
    timeframe: string;
    onSymbolClick: () => void;
    onTimeframeClick: () => void;
    /** Omitted ⇒ no indicators stop (the composition hides the 'indicators' slot, or
     *  the deprecated `indicatorPicker: false`). A slot OVERRIDE keeps the stop — the
     *  shell passes a callback routed to the override. */
    onIndicatorsClick?: () => void;
    /** Omitted ⇒ no drawings stop (the shell disabled user drawings — `drawings: false`). */
    onDrawingsClick?: () => void;
    /** Omitted ⇒ no maximize stop (single-chart shells — nothing to isolate). The
     *  workspace passes a toggle that isolates the active chart over the grid;
     *  {@link setMaximizeActive} lights the stop while something is isolated. */
    onMaximizeClick?: () => void;
    onMoreClick: () => void;
    onSettingsClick: () => void;
    /** Live widget context — left-aligned contributed actions (`align: 'left'`)
     *  project as icon-only stops in the indicators slot. */
    getContext?: () => WidgetContext;
    /** The shell's translator. Absent: English. */
    i18n?: Translator;
}

export class MobileBar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly tfEl: HTMLElement;
    /** The maximize toggle stop (null when the shell has nothing to isolate). */
    private readonly maxEl: HTMLButtonElement | null;
    /** Left-aligned contributed actions — filled by {@link renderActions}. */
    private readonly actionsHost: HTMLElement;
    /** The indicators stop (null when the shell has no indicator surface). */
    private readonly indicatorsEl: HTMLButtonElement | null;
    private readonly opts: MobileBarOptions;
    /** Each fixed stop's accessible name, re-read by {@link relocalize}. */
    private readonly labels: Array<{ el: HTMLElement; label: MessageLike }> = [];
    private timeframe: string;
    private maximizeActive = false;

    private t(text: MessageLike): string {
        return textOf(this.opts.i18n, text);
    }

    constructor(host: HTMLElement, opts: MobileBarOptions) {
        this.opts = opts;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-mobilebar';

        this.timeframe = opts.timeframe;
        const item = (cls: string, label: MessageLike, onClick: () => void, icon?: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = `vela-mb-item ${cls}`;
            b.setAttribute('aria-label', this.t(label));
            this.labels.push({ el: b, label });
            if (icon) b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.symbolEl = item('vela-mb-symbol', TEXT.symbolSearch, opts.onSymbolClick);
        this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
        this.tfEl = item('vela-mb-tf', TEXT.timeframe, opts.onTimeframeClick);
        this.tfEl.textContent = timeframeLabel(opts.timeframe, opts.i18n);
        const onIndicators = opts.onIndicatorsClick;
        const indicators = onIndicators ? item('vela-mb-indicators', TEXT.indicators, onIndicators, 'indicators') : null;
        this.indicatorsEl = indicators;
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-mb-actions';
        const onDrawings = opts.onDrawingsClick;
        const drawings = onDrawings ? item('vela-mb-drawings', TEXT.drawings, onDrawings, 'pen') : null;
        const onMaximize = opts.onMaximizeClick;
        this.maxEl = onMaximize ? item('vela-mb-maximize', TEXT.maximizeChart, onMaximize, 'maximize') : null;
        const more = item('vela-mb-more', TEXT.more, opts.onMoreClick, 'kebab');
        const settings = item('vela-mb-settings', TEXT.chartSettings, opts.onSettingsClick, 'gear');

        this.el.append(this.symbolEl, this.tfEl, ...(indicators ? [indicators] : []), this.actionsHost, ...(drawings ? [drawings] : []), ...(this.maxEl ? [this.maxEl] : []), more, settings);
        host.appendChild(this.el);
        this.renderActions();
    }

    /** Re-project the contributed actions placed on the bar (left-aligned by default —
     *  see `mobilePlacement`) as icon-only stops in the indicators slot (call after
     *  registrations change). The rest are three-dots drawer rows. */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        if (!ctx) return;
        const doc = this.el.ownerDocument;
        this.actionsHost.replaceChildren();
        // Built-in-id actions are slot OVERRIDES — they reach mobile through the slot's
        // own stop (the shell routes it), never as an extra flow stop here.
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        for (const action of widgetActions('topbar', ctx).filter((a) => mobilePlacement(a) === 'bar' && !builtin.has(a.id))) {
            const b = doc.createElement('button');
            b.className = 'vela-mb-item';
            b.dataset.actionId = action.id;
            const label = textOf(ctx.i18n ?? this.opts.i18n, action.label);
            b.setAttribute('aria-label', label);
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            else b.appendChild(doc.createTextNode(label));
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            this.actionsHost.appendChild(b);
        }
    }

    /** Show or hide the indicators stop (the topbar's `'indicators'` item hidden at runtime). */
    setIndicatorsVisible(visible: boolean): void {
        if (this.indicatorsEl) this.indicatorsEl.hidden = !visible;
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = parseSymbol(symbol).ticker;
    }

    setTimeframe(tf: string): void {
        this.timeframe = tf;
        this.tfEl.textContent = timeframeLabel(tf, this.opts.i18n);
    }

    /** Re-read every label in the current language. */
    relocalize(): void {
        for (const { el, label } of this.labels) el.setAttribute('aria-label', this.t(label));
        this.setTimeframe(this.timeframe);
        if (this.maxEl) this.setMaximizeActive(this.maximizeActive);
        this.renderActions();
    }

    /** Light the maximize stop while something is isolated (a chart over the grid,
     *  or a maximized pane inside the active chart) — inverse chip + restore glyph. */
    setMaximizeActive(on: boolean): void {
        if (!this.maxEl) return;
        this.maximizeActive = on;
        this.maxEl.classList.toggle('vela-mb-on', on);
        this.maxEl.setAttribute('aria-label', this.t(on ? TEXT.restoreLayout : TEXT.maximizeChart));
        this.maxEl.replaceChildren(iconEl(on ? 'restore' : 'maximize', this.el.ownerDocument));
    }

    /** Show the maximize stop only while the grid holds more than one chart — on a
     *  one-cell layout there is nothing to isolate, so the stop would be a dead press. */
    setMaximizeVisible(visible: boolean): void {
        if (!this.maxEl) return;
        this.maxEl.hidden = !visible;
    }

    destroy(): void {
        this.el.remove();
    }
}
