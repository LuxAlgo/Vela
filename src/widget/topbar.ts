// Topbar — symbol label, timeframe dropdown, and the price-style dropdown (built-ins +
// every chart type registered through the plugin SDK, labels from the registry).
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { LayoutPicker, type LayoutPickerShape } from './layout-picker';
import { iconEl, iconMarkup, registerIcon } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { chartType } from '../chart-types/registry';
import { widgetActions, type SidePanelButton, type WidgetContext } from './contributions';
import { BUILTIN_PRICE_STYLES, priceStyleIds } from '../renderers/native/core/chartConfig';
import { favoriteTimeframeChips, timeframeLabel } from './timeframe';
import { parseSymbol } from '../data/ProviderRegistry';

// The component owns its stylesheet (id-guarded, injected at construction) so EVERY
// host that mounts a Topbar — the widget, a multi-chart workspace — gets the same look.
const STYLE_ID = 'vela-topbar';
const CSS = `
.vela-widget-topbar {
    display: flex;
    align-items: center;
    gap: var(--vela-space-1);
    padding: var(--vela-space-1) var(--vela-space-2);
    border-bottom: 1px solid var(--vela-border-soft);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    flex: none;
}
.vela-widget-symbol, .vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-action-left {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-symbol {
    color: var(--vela-fg-bright);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 0 10px;
    gap: 7px;
}
.vela-widget-tf, .vela-widget-style, .vela-widget-indicators, .vela-widget-action-left {
    color: var(--vela-fg-bright);
}
.vela-widget-symbol:hover, .vela-widget-tf:hover, .vela-widget-style:hover, .vela-widget-indicators:hover, .vela-widget-action-left:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* Timeframe cluster: duration-sorted favorite chips, highlight in place, caret
   opening the full dropdown. With no favorites the caret is the merged trigger
   (label + chevron). An unstarred current value sits as an extra chip by the caret. */
.vela-widget-tf-group { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips { display: inline-flex; align-items: center; gap: 2px; }
.vela-widget-tf-chips:empty { display: none; }
.vela-widget-tf[data-current='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-widget-tf-caret {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
}
.vela-widget-tf-caret:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
/* The merged trigger is a plain button (hover feedback only) — the highlight
   background marks the CURRENT chip among favorites, and a lone trigger with a
   permanent highlight would read as stuck-pressed. */
.vela-widget-tf-caret[data-solo='1'] {
    width: auto;
    padding: 0 6px 0 9px;
    gap: 4px;
    color: var(--vela-fg-bright);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
}
.vela-widget-topbar .vela-widget-tf-caret .vela-icon { font-size: 14px; width: 14px; height: 14px; }
.vela-widget-topbar .vela-icon { color: inherit; font-size: 16px; width: 16px; height: 16px; }
/* Width is set in syncHairlines() to exactly one device pixel — a CSS 1px at
   fractional DPR (1.25, 1.5…) straddles two physical pixels and siblings end
   up looking like different thicknesses depending on subpixel placement. */
.vela-sep { height: 22px; margin: 0 2px; flex: none; background: var(--vela-border-strong); }
.vela-alerts-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 9px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.vela-widget-actions { margin-left: auto; display: inline-flex; gap: var(--vela-space-1); }
/* Left-aligned contributed actions — the primary-chrome cluster after the dropdowns. */
.vela-widget-actions-left { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
/* The side-panel toggles, one per docked panel — a group so the dock can rebuild them
   without disturbing the tools around it. */
.vela-widget-panels { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-tool {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-widget-tool:hover:not(:disabled) { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-tool:disabled { opacity: 0.35; cursor: default; }
.vela-widget-tool[data-active='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-widget-action {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
    color: var(--vela-fg);
}
.vela-widget-action:hover { background: var(--vela-hover); }
`;

const BUILTIN_STYLE_LABELS: Record<string, string> = {
    candles: 'Candles',
    bars: 'Bars',
    line: 'Line',
    area: 'Area',
    baseline: 'Baseline',
};

export function priceStyleLabel(id: string): string {
    return chartType(id)?.label ?? BUILTIN_STYLE_LABELS[id] ?? id;
}

/** Icon id for a price style — registers a plugin type's `icon` markup on first use. */
export function priceStyleIcon(id: string): string | undefined {
    const iconId = `style-${id}`;
    if (iconMarkup(iconId)) return iconId;
    const svg = chartType(id)?.icon;
    if (svg) {
        registerIcon(iconId, svg);
        return iconId;
    }
    return undefined;
}

export interface TopbarOptions {
    symbol: string;
    onSymbolClick?: () => void;
    timeframe: string;
    timeframes: readonly string[];
    /** Favorite timeframes — duration-sorted quick-switch chips, stars in the
     *  dropdown rows. Push later changes with {@link Topbar.setTimeframeFavorites}. */
    timeframeFavorites?: readonly string[];
    priceStyle: string;
    onTimeframe: (tf: string) => void;
    /** A dropdown star was toggled. Omitted, the dropdown carries no stars and the
     *  chips never render — the host owns (and persists) the favorite set. */
    onTimeframeFavorite?: (tf: string, on: boolean) => void;
    onPriceStyle: (style: string) => void;
    /** Optional workspace LAYOUT dropdown (rendered after the style dropdown when
     *  given) — the grid-canvas picker composing uniform grids, with the workspace
     *  SYNC switches beside it. Everything is read live, so plugin-registered
     *  layouts and setting flips appear automatically. */
    layout?: {
        current: string;
        /** Current layout's picker-canvas shape (null = not canvas-expressible). */
        shape: () => LayoutPickerShape | null;
        /** Registered layouts the canvas cannot express — rendered as labeled rows. */
        presets: () => Array<{ id: string; label: string }>;
        onSelectGrid: (rows: number, cols: number) => void;
        onSelectPreset: (id: string) => void;
        /** SYNC switch rows (re-read on every open and after each toggle). */
        syncs: () => Array<{ id: string; label: string; checked: boolean }>;
        onToggleSync: (id: string) => void;
    };
    onIndicatorsClick?: () => void;
    /** Unified undo/redo (same stack as Ctrl+Z / Ctrl+Y). Enabled state is pushed with
     *  {@link Topbar.setHistoryState}. */
    onUndoClick?: () => void;
    onRedoClick?: () => void;
    onScreenshotClick?: () => void;
    onAlertsClick?: (anchor: HTMLElement) => void;
    /** Live widget context for contributed actions (topbar target). */
    getContext?: () => WidgetContext;
}

export class Topbar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    /** Duration-sorted favorite chips (plus an unstarred current, when needed). */
    private readonly tfChipsHost: HTMLElement;
    private readonly tfCaret: HTMLButtonElement;
    private tfFavs: string[];
    private readonly styleButton: HTMLElement;
    private layoutButton: HTMLElement | null = null;
    private layoutPicker: LayoutPicker | null = null;
    private layoutId: string | null = null;
    private readonly tfMenu: Menu;
    private readonly styleMenu: Menu;
    private readonly tooltips: Tooltip[] = [];
    private readonly actionsHost: HTMLElement;
    /** Left-aligned contributed actions (`align: 'left'`) — right after the dropdowns. */
    private readonly leftActionsHost: HTMLElement;
    /** The hairline after the left cluster — hidden while the cluster is empty. */
    private readonly leftActionsSep: HTMLElement;
    /** The side-panel toggle group — filled by the dock through {@link setPanelButtons}. */
    private readonly panelsHost: HTMLElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private alertsBtn!: HTMLButtonElement;
    private panelBtns = new Map<string, HTMLButtonElement>();
    private panelTooltips: Tooltip[] = [];
    private readonly host: HTMLElement;
    private alertsBadge!: HTMLElement;
    private readonly opts: TopbarOptions;
    private timeframe: string;
    private priceStyle: string;
    private readonly onHairlineSync = (): void => {
        if (this.hairlineRaf) return;
        const win = this.el.ownerDocument.defaultView;
        this.hairlineRaf = win?.requestAnimationFrame(() => {
            this.hairlineRaf = 0;
            this.syncHairlines();
        }) ?? 0;
    };
    private hairlineRo: ResizeObserver | null = null;
    private hairlineRaf = 0;

    constructor(host: HTMLElement, opts: TopbarOptions) {
        this.opts = opts;
        this.host = host;
        this.timeframe = opts.timeframe;
        this.priceStyle = opts.priceStyle;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        this.el = doc.createElement('div');
        this.el.className = 'vela-widget-topbar';
        this.symbolEl = doc.createElement('button');
        this.symbolEl.className = 'vela-widget-symbol';
        // The button DISPLAYS the bare ticker; the venue-prefixed identity stays in the
        // shell's state (the statusline meta and the picker badges name the venue).
        this.symbolEl.textContent = parseSymbol(opts.symbol).ticker;
        if (opts.onSymbolClick) this.symbolEl.addEventListener('click', opts.onSymbolClick);
        // Duration-sorted chips with highlight in place; the caret is the dropdown
        // trigger (merged with the current label when there are no favorites).
        this.tfFavs = [...(opts.timeframeFavorites ?? [])];
        this.tfChipsHost = doc.createElement('span');
        this.tfChipsHost.className = 'vela-widget-tf-chips';
        this.tfCaret = doc.createElement('button');
        this.tfCaret.className = 'vela-widget-tf-caret';
        this.tfCaret.appendChild(iconEl('chevron-down', doc));
        this.tfCaret.setAttribute('aria-label', 'Timeframes');
        const tfGroup = doc.createElement('span');
        tfGroup.className = 'vela-widget-tf-group';
        tfGroup.append(this.tfChipsHost, this.tfCaret);
        this.styleButton = doc.createElement('button');
        this.styleButton.className = 'vela-widget-style';
        this.renderStyleButton(doc);
        // No callback ⇒ no button: a host replacing the indicator picker with its own
        // UI (shell option `indicatorPicker: false`) must not show a dead entry point.
        let indicatorsBtn: HTMLButtonElement | null = null;
        if (opts.onIndicatorsClick) {
            indicatorsBtn = doc.createElement('button');
            indicatorsBtn.className = 'vela-widget-indicators';
            indicatorsBtn.append(iconEl('indicators', doc), doc.createTextNode('Indicators'));
            indicatorsBtn.addEventListener('click', opts.onIndicatorsClick);
        }

        // Right-hand cluster: contributed actions, then icon-only tools — the side-panel
        // toggles (filled by the dock) and screenshot. Labels live in their tooltips.
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-widget-actions';
        this.leftActionsHost = doc.createElement('span');
        this.leftActionsHost.className = 'vela-widget-actions-left';
        this.panelsHost = doc.createElement('span');
        this.panelsHost.className = 'vela-widget-panels';
        const tool = (cls: string, icon: string, tip: string, onClick?: () => void): HTMLButtonElement =>
            this.toolButton(cls, icon, tip, onClick, this.tooltips);
        // Undo/redo sit beside Indicators (same icon-tool chrome as the right cluster).
        this.undoBtn = tool('vela-widget-undo', 'undo', 'Undo', opts.onUndoClick);
        this.redoBtn = tool('vela-widget-redo', 'redo', 'Redo', opts.onRedoClick);
        this.setHistoryState(false, false);
        const screenshotBtn = tool('vela-widget-screenshot', 'camera', 'Download screenshot', opts.onScreenshotClick);
        this.alertsBtn = tool('vela-widget-alerts', 'bell', 'Alerts');
        this.alertsBtn.style.position = 'relative';
        if (opts.onAlertsClick) this.alertsBtn.addEventListener('click', () => opts.onAlertsClick!(this.alertsBtn));
        this.alertsBadge = doc.createElement('span');
        this.alertsBadge.className = 'vela-alerts-badge';
        this.alertsBadge.style.display = 'none';
        this.alertsBtn.appendChild(this.alertsBadge);

        // Workspace layout dropdown — present only when the host supplies the option.
        if (opts.layout) {
            this.layoutId = opts.layout.current;
            this.layoutButton = doc.createElement('button');
            this.layoutButton.className = 'vela-widget-style';
            this.renderLayoutButton(doc);
        }

        const sep = (): HTMLElement => {
            const d = doc.createElement('span');
            d.className = 'vela-sep';
            return d;
        };
        const leading: Array<HTMLElement> = [this.symbolEl, sep(), tfGroup, sep(), this.styleButton, sep()];
        if (this.layoutButton) leading.push(this.layoutButton, sep());
        if (indicatorsBtn) leading.push(indicatorsBtn, sep());
        // The left action cluster sits where the built-in Indicators button lives; its
        // trailing hairline shows only while the cluster is non-empty (renderActions).
        this.leftActionsSep = sep();
        this.leftActionsSep.hidden = true;
        this.el.append(...leading, this.leftActionsHost, this.leftActionsSep, this.undoBtn, this.redoBtn, this.actionsHost, this.alertsBtn, this.panelsHost, screenshotBtn);
        host.appendChild(this.el);
        this.renderTfChips();
        // Snap after layout; RO catches later reflows (symbol / timeframe length).
        this.onHairlineSync();
        this.hairlineRo = new ResizeObserver(this.onHairlineSync);
        this.hairlineRo.observe(this.el);
        doc.defaultView?.addEventListener('resize', this.onHairlineSync);
        this.renderActions();

        this.tooltips.push(new Tooltip(this.tfCaret, { content: 'Timeframe', triggerId: 'vela-topbar-tf', host }));
        this.tooltips.push(new Tooltip(this.styleButton, { content: 'Chart style', triggerId: 'vela-topbar-style', host }));
        if (this.layoutButton && opts.layout) {
            this.tooltips.push(new Tooltip(this.layoutButton, { content: 'Layout', triggerId: 'vela-topbar-layout', host }));
            const layout = opts.layout;
            this.layoutPicker = new LayoutPicker({
                trigger: this.layoutButton,
                host,
                shape: () => layout.shape(),
                presets: () => layout.presets().map((p) => ({ ...p, checked: p.id === this.layoutId })),
                onSelectGrid: (rows, cols) => layout.onSelectGrid(rows, cols),
                onSelectPreset: (id) => layout.onSelectPreset(id),
                syncs: () => layout.syncs(),
                onToggleSync: (id) => layout.onToggleSync(id),
            });
        }
        this.tfMenu = new Menu({
            trigger: this.tfCaret,
            triggerId: 'vela-topbar-tf',
            host,
            items: this.tfItems(),
            onSelect: (id) => opts.onTimeframe(id),
            onFavorite: (id, on) => opts.onTimeframeFavorite?.(id, on),
            // Timeframe labels are two-or-three characters ("1m", "4h", "1D") — the
            // stylesheet's default min-width would leave the list mostly empty.
            minWidth: '84px',
        });
        this.styleMenu = new Menu({
            trigger: this.styleButton,
            triggerId: 'vela-topbar-style',
            host,
            items: this.styleItems(),
            onSelect: (id) => opts.onPriceStyle(id),
        });
    }

    setSymbol(symbol: string): void {
        this.symbolEl.textContent = parseSymbol(symbol).ticker;
    }

    setTimeframe(tf: string): void {
        this.timeframe = tf;
        this.tfMenu.setItems(this.tfItems());
        this.renderTfChips();
    }

    /** Reflect the favorite-timeframe set — the quick-switch chips and the dropdown stars. */
    setTimeframeFavorites(favs: readonly string[]): void {
        this.tfFavs = [...favs];
        this.renderTfChips();
        this.tfMenu.setItems(this.tfItems());
    }

    /** Rebuild the quick-switch chips (current value changed, or the favorite set did). */
    private renderTfChips(): void {
        const doc = this.el.ownerDocument;
        this.tfChipsHost.replaceChildren();
        const stars = this.opts.onTimeframeFavorite !== undefined;
        const chips = stars ? favoriteTimeframeChips(this.tfFavs) : [];
        const currentIsFav = chips.includes(this.timeframe);
        // Unstarred current sits next to the caret so the favorite row never jumps.
        const shown = currentIsFav || chips.length === 0 ? chips : [...chips, this.timeframe];
        for (const tf of shown) {
            const b = doc.createElement('button');
            b.className = 'vela-widget-tf';
            const label = timeframeLabel(tf);
            b.textContent = label;
            if (tf === this.timeframe) {
                b.dataset.current = '1';
                b.setAttribute('aria-current', 'true');
            } else {
                b.setAttribute('aria-label', `Switch timeframe to ${label}`);
                b.addEventListener('click', () => this.opts.onTimeframe(tf));
            }
            this.tfChipsHost.appendChild(b);
        }
        this.tfCaret.replaceChildren();
        if (chips.length === 0) {
            this.tfCaret.dataset.solo = '1';
            this.tfCaret.append(doc.createTextNode(timeframeLabel(this.timeframe)), iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', `Timeframe — ${timeframeLabel(this.timeframe)}`);
        } else {
            delete this.tfCaret.dataset.solo;
            this.tfCaret.appendChild(iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', 'Timeframes');
        }
        this.onHairlineSync(); // the cluster width changed
    }

    setPriceStyle(style: string): void {
        this.priceStyle = style;
        this.renderStyleButton(this.styleButton.ownerDocument);
        this.styleMenu.setItems(this.styleItems());
    }

    /** Reflect the current workspace layout (no-op without the layout dropdown). */
    setLayout(id: string): void {
        if (!this.layoutButton) return;
        this.layoutId = id;
        this.renderLayoutButton(this.layoutButton.ownerDocument);
        this.layoutPicker?.refresh();
    }

    private renderLayoutButton(doc: Document): void {
        if (!this.layoutButton) return;
        this.layoutButton.replaceChildren();
        // Icon when a 'layout' icon is registered (the workspace registers one);
        // otherwise fall back to the current layout id as text.
        if (iconMarkup('layout')) this.layoutButton.appendChild(iconEl('layout', doc));
        else this.layoutButton.appendChild(doc.createTextNode(this.layoutId ?? ''));
        this.layoutButton.setAttribute('aria-label', `Layout — ${this.layoutId ?? ''}`);
    }

    private renderStyleButton(doc: Document): void {
        this.styleButton.replaceChildren();
        const icon = priceStyleIcon(this.priceStyle);
        // Icon-only entry (like the reference app); the label lives in the tooltip and the
        // dropdown rows. Unknown plugin styles without an icon fall back to their label.
        if (icon) this.styleButton.appendChild(iconEl(icon, doc));
        else this.styleButton.appendChild(doc.createTextNode(priceStyleLabel(this.priceStyle)));
        this.styleButton.setAttribute('aria-label', `Chart style — ${priceStyleLabel(this.priceStyle)}`);
    }

    /** Re-project the contributed topbar actions (call after registrations change). */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        this.actionsHost.replaceChildren();
        this.leftActionsHost.replaceChildren();
        const doc = this.actionsHost.ownerDocument;
        for (const action of widgetActions('topbar', ctx)) {
            const left = action.align === 'left';
            const b = doc.createElement('button');
            // Left actions wear the primary-chrome styling (the built-in Indicators
            // button's own class list); right actions keep the compact tool look.
            b.className = left ? 'vela-widget-action-left' : 'vela-widget-action';
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            b.appendChild(doc.createTextNode(action.label));
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            (left ? this.leftActionsHost : this.actionsHost).appendChild(b);
        }
        this.leftActionsSep.hidden = this.leftActionsHost.childElementCount === 0;
        this.onHairlineSync(); // the visible hairline set may have changed
    }

    setIndicatorCount(_n: number): void {
        // Count badge intentionally hidden — kept as a no-op so hosts can keep calling it.
    }

    /** Enable/disable the undo and redo tools from the host's unified history. */
    setHistoryState(canUndo: boolean, canRedo: boolean): void {
        this.undoBtn.disabled = !canUndo;
        this.redoBtn.disabled = !canRedo;
    }

    setAlertCount(n: number): void {
        this.alertsBadge.textContent = n > 9 ? '9+' : String(n);
        this.alertsBadge.style.display = n > 0 ? '' : 'none';
    }

    /**
     * Replace the side-panel toggle group — one icon button per docked panel, in the dock's own
     * order. The dock calls this whenever its panel set changes (built-ins at construction,
     * contributed panels on every `refreshActions()`), then pushes each pressed state.
     */
    setPanelButtons(buttons: readonly SidePanelButton[], onClick: (id: string) => void): void {
        for (const t of this.panelTooltips) t.destroy();
        this.panelTooltips = [];
        this.panelBtns.clear();
        this.panelsHost.replaceChildren();
        for (const b of buttons) {
            const el = this.toolButton(`vela-widget-panel-${b.id}`, b.icon, b.title, () => onClick(b.id), this.panelTooltips);
            this.panelBtns.set(b.id, el);
            this.panelsHost.appendChild(el);
        }
    }

    /** Reflect a docked side panel's open state on its button — the panels toggle each other,
     *  so the dock pushes the state rather than the button assuming it. */
    setPanelActive(id: string, open: boolean): void {
        const btn = this.panelBtns.get(id);
        if (btn) btn.dataset.active = open ? '1' : '';
    }

    destroy(): void {
        this.hairlineRo?.disconnect();
        const win = this.el.ownerDocument.defaultView;
        win?.removeEventListener('resize', this.onHairlineSync);
        if (this.hairlineRaf) win?.cancelAnimationFrame(this.hairlineRaf);
        this.tfMenu.destroy();
        this.styleMenu.destroy();
        this.layoutPicker?.destroy();
        for (const t of [...this.tooltips, ...this.panelTooltips]) t.destroy();
        this.el.remove();
    }

    /** One icon-only tool button with its kit tooltip, parked in `sink` for disposal. */
    private toolButton(cls: string, icon: string, tip: string, onClick: (() => void) | undefined, sink: Tooltip[]): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.className = `vela-widget-tool ${cls}`;
        b.appendChild(iconEl(icon, doc));
        b.setAttribute('aria-label', tip);
        // Kit tooltip only — a native `title` on top of it double-tooltips. Explicit host: at
        // construction the topbar is NOT in the DOM yet, so the closest('.vela-ui') fallback
        // would portal to <body> — outside the theme vars.
        sink.push(new Tooltip(b, { content: tip, triggerId: `vela-tool-${cls}`, host: this.host }));
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    /** Paint each `.vela-sep` as exactly one device pixel, snapped to the pixel grid. */
    private syncHairlines(): void {
        const win = this.el.ownerDocument.defaultView;
        if (!win) return;
        const dpr = win.devicePixelRatio || 1;
        for (const el of this.el.querySelectorAll<HTMLElement>('.vela-sep')) {
            el.style.width = `${1 / dpr}px`;
            el.style.transform = '';
            const left = el.getBoundingClientRect().left;
            const dx = Math.round(left * dpr) / dpr - left;
            if (dx) el.style.transform = `translateX(${dx}px)`;
        }
    }

    private tfItems(): MenuItemDescriptor[] {
        // Stars only when the host handles the toggle — a starless dropdown otherwise.
        const stars = this.opts.onTimeframeFavorite !== undefined;
        return this.opts.timeframes.map((tf) => ({
            id: tf,
            label: timeframeLabel(tf),
            checked: tf === this.timeframe,
            ...(stars ? { favorite: this.tfFavs.includes(tf) } : {}),
        }));
    }

    private styleItems(): MenuItemDescriptor[] {
        // Live list: built-ins ∪ plugin-registered chart types (a registered type shows
        // up here automatically — the SDK's style-picker contribution). Registered types
        // sit BELOW a separator: the built-in price styles and the plugin chart types
        // read as two distinct families.
        return priceStyleIds().map((id, i) => ({
            id,
            label: priceStyleLabel(id),
            icon: priceStyleIcon(id),
            checked: id === this.priceStyle,
            separatorBefore: i === BUILTIN_PRICE_STYLES.length,
        }));
    }
}
