// Topbar — symbol label, timeframe dropdown, and the price-style dropdown (built-ins +
// every chart type registered through the plugin SDK, labels from the registry).
import { priceStyleMessage } from '../chart-types/labels';
import { textOf } from '../core/i18n/text';
import { msg } from '../core/i18n/message';
import type { MessageArgs, MessageLike, Translator } from '../core/i18n/types';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { LayoutPicker, type LayoutPickerShape } from './layout-picker';
import { iconEl, iconMarkup, registerIcon } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { chartType } from '../chart-types/registry';
import { topbarActionOverride, widgetActions, type SidePanelButton, type WidgetContext } from './contributions';
import { resolveTopbarComposition, topbarHas, TOPBAR_BUILTIN_IDS, type ResolvedTopbarComposition, type TopbarComposition } from './topbar-composition';
import { BUILTIN_PRICE_STYLES, priceStyleIds } from '../renderers/native/core/chartConfig';
import { favoriteTimeframeChips, timeframeLabel } from './timeframe';
import { parseSymbol } from '../data/ProviderRegistry';

// The component owns its stylesheet (id-guarded, injected at construction) so EVERY
// host that mounts a Topbar — the widget, a multi-chart workspace — gets the same look.
const STYLE_ID = 'vela-topbar';
const CSS = `
.vela-widget-topbar [data-topbar-hidden] { display: none !important; }
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
/* The right side of the bar — whatever the composition puts there rides this one
   auto-margin push (the flow-actions host used to carry it; composition can omit it). */
.vela-topbar-right { margin-left: auto; display: inline-flex; align-items: center; gap: var(--vela-space-1); }
.vela-widget-actions { display: inline-flex; gap: var(--vela-space-1); }
/* Left-aligned contributed actions — the primary-chrome cluster after the dropdowns. */
.vela-widget-actions-left { display: inline-flex; align-items: center; gap: var(--vela-space-1); }
/* One PINNED contributed action's slot (a composition entry naming the action's id). */
.vela-widget-action-pin { display: inline-flex; align-items: center; }
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

/** A price style's name, in `i18n`'s language (English without one). */
export function priceStyleLabel(id: string, i18n?: Translator | null): string {
    return textOf(i18n, priceStyleMessage(id));
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
        /** The current layout's 16px glyph (`<svg>` markup) for the button, re-read on
         *  every {@link Topbar.setLayout}. Omitted ⇒ the registered `'layout'` icon. */
        glyph?: () => string;
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
    /** The host's declarative composition (see {@link TopbarComposition}) — which
     *  entries render, per side, in list order. An undeclared side keeps its default.
     *  The shell that owns this bar also gates the matching mobile entries and
     *  keyboard chords on the same composition — the bar only handles its own DOM. */
    composition?: TopbarComposition;
    /** The shell's translator (labels, tooltips, menus). Absent: English. */
    i18n?: Translator;
}

const TEXT = {
    timeframes: msg('widget.topbar.timeframes', 'Timeframes'),
    indicators: msg('widget.topbar.indicators', 'Indicators'),
    undo: msg('widget.topbar.undo', 'Undo'),
    redo: msg('widget.topbar.redo', 'Redo'),
    screenshot: msg('widget.topbar.screenshot', 'Download screenshot'),
    alerts: msg('widget.topbar.alerts', 'Alerts'),
    timeframe: msg('widget.topbar.timeframe', 'Timeframe'),
    chartStyle: msg('widget.topbar.chartStyle', 'Chart style'),
    layout: msg('widget.topbar.layout', 'Layout'),
    switchTimeframe: msg('widget.topbar.switchTimeframe', 'Switch timeframe to {timeframe}'),
    currentTimeframe: msg('widget.topbar.currentTimeframe', 'Timeframe — {timeframe}'),
    currentLayout: msg('widget.topbar.currentLayout', 'Layout — {layout}'),
    currentStyle: msg('widget.topbar.currentStyle', 'Chart style — {style}'),
};

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
    /** The resolved composition (defaults applied) — what renders, where, in order. */
    private readonly comp: ResolvedTopbarComposition;
    /** Each rendered built-in item's elements (its trailing hairline included), for runtime hiding. */
    private readonly itemEls = new Map<string, HTMLElement[]>();
    /** Pinned contributed-action slots, by action id (composition entries that name one,
     *  plus built-in slots taken over by an override). */
    private readonly pinned = new Map<string, { host: HTMLElement; left: boolean }>();
    /** Overrides that LEFT their native slot (default side + a declared `order`) — they
     *  render through the flow cluster like ordinary actions. */
    private readonly flowingOverrides = new Set<string>();
    /** Tooltips of the CURRENT icon-only action buttons — rebuilt with every
     *  renderActions pass (contributed buttons are replaceChildren'd away). */
    private actionTooltips: Tooltip[] = [];
    /** `iconOnly` misuse warned once per action id (renderActions re-runs freely). */
    private readonly warnedIconless = new Set<string>();
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
    /** Re-apply each fixed label in the current language (see {@link relocalize}). */
    private readonly relabels: Array<() => void> = [];

    private get i18n(): Translator | null {
        return this.opts.i18n ?? null;
    }

    private t(m: MessageLike, values?: MessageArgs): string {
        return textOf(this.i18n, m, values);
    }

    constructor(host: HTMLElement, opts: TopbarOptions) {
        this.opts = opts;
        this.host = host;
        this.timeframe = opts.timeframe;
        this.priceStyle = opts.priceStyle;
        this.comp = resolveTopbarComposition(opts.composition);
        const vis = (id: string): boolean => topbarHas(this.comp, id);
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
        this.tfCaret.setAttribute('aria-label', this.t(TEXT.timeframes));
        const tfGroup = doc.createElement('span');
        tfGroup.className = 'vela-widget-tf-group';
        tfGroup.append(this.tfChipsHost, this.tfCaret);
        this.styleButton = doc.createElement('button');
        this.styleButton.className = 'vela-widget-style';
        this.renderStyleButton(doc);
        // No callback ⇒ no button: a host hiding the built-in picker (composition
        // without 'indicators', or the deprecated `indicatorPicker: false`) must not
        // show a dead entry point. An OVERRIDE of the slot renders through
        // renderActions instead.
        let indicatorsBtn: HTMLButtonElement | null = null;
        if (opts.onIndicatorsClick && !topbarActionOverride('indicators')) {
            indicatorsBtn = doc.createElement('button');
            indicatorsBtn.className = 'vela-widget-indicators';
            const label = doc.createTextNode(this.t(TEXT.indicators));
            indicatorsBtn.append(iconEl('indicators', doc), label);
            this.relabels.push(() => (label.textContent = this.t(TEXT.indicators)));
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
        const tool = (cls: string, icon: string, tip: MessageLike, onClick?: () => void): HTMLButtonElement =>
            this.toolButton(cls, icon, tip, onClick, this.tooltips);
        // Hidden tools get a DETACHED bare button instead: the state setters
        // (setHistoryState, setAlertCount) stay safe no-ops, and no tooltip machine
        // ever binds to chrome the composition removed.
        // Undo/redo sit beside Indicators (same icon-tool chrome as the right cluster).
        if (vis('undo-redo')) {
            this.undoBtn = tool('vela-widget-undo', 'undo', TEXT.undo, opts.onUndoClick);
            this.redoBtn = tool('vela-widget-redo', 'redo', TEXT.redo, opts.onRedoClick);
        } else {
            this.undoBtn = doc.createElement('button');
            this.redoBtn = doc.createElement('button');
        }
        this.setHistoryState(false, false);
        const screenshotBtn = vis('screenshot') && !topbarActionOverride('screenshot') ? tool('vela-widget-screenshot', 'camera', TEXT.screenshot, opts.onScreenshotClick) : null;
        this.alertsBtn = vis('alerts') ? tool('vela-widget-alerts', 'bell', TEXT.alerts) : doc.createElement('button');
        this.alertsBtn.style.position = 'relative';
        if (opts.onAlertsClick) this.alertsBtn.addEventListener('click', () => opts.onAlertsClick!(this.alertsBtn));
        this.alertsBadge = doc.createElement('span');
        this.alertsBadge.className = 'vela-alerts-badge';
        this.alertsBadge.style.display = 'none';
        this.alertsBtn.appendChild(this.alertsBadge);

        // Workspace layout dropdown — present only when the host supplies the option
        // (and the composition keeps it).
        if (opts.layout && vis('layout')) {
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
        // The left action cluster's trailing hairline shows only while the cluster is
        // non-empty (renderActions).
        this.leftActionsSep = sep();
        this.leftActionsSep.hidden = true;
        // ── assemble per the composition: each side is its list, in order. Primary
        // controls carry a trailing hairline (except as a side's last entry); `actions`
        // is the FLOW slot for unlisted contributed actions; any other unknown id is a
        // PINNED slot for the contributed action with that id (filled by renderActions).
        const primaries = new Set(['symbol', 'timeframes', 'style', 'layout', 'indicators']);
        const pinSlot = (id: string, left: boolean): HTMLElement[] => {
            const slot = doc.createElement('span');
            slot.className = 'vela-widget-action-pin';
            this.pinned.set(id, { host: slot, left });
            return [slot];
        };
        // A built-in slot taken over by an OVERRIDE (an action registered under the
        // built-in id) renders the contributed action instead of the native button, at
        // the slot's position. One exception: on a side the host left on DEFAULTS, an
        // override that declares `order` opts back into ordinary flow placement — the
        // host's explicit list, when there is one, always has the last word.
        const overridden = (id: string, left: boolean): HTMLElement[] | null => {
            const ov = topbarActionOverride(id);
            if (!ov) return null;
            const sideDeclared = left ? opts.composition?.left != null : opts.composition?.right != null;
            if (!sideDeclared && ov.order !== undefined) {
                this.flowingOverrides.add(id);
                return [];
            }
            return pinSlot(id, left);
        };
        const elementsFor = (id: string, left: boolean): HTMLElement[] => {
            switch (id) {
                case 'symbol':
                    return [this.symbolEl];
                case 'timeframes':
                    return [tfGroup];
                case 'style':
                    return [this.styleButton];
                case 'layout':
                    return this.layoutButton ? [this.layoutButton] : [];
                case 'indicators':
                    return overridden(id, left) ?? (indicatorsBtn ? [indicatorsBtn] : []);
                case 'actions':
                    return left ? [this.leftActionsHost, this.leftActionsSep] : [this.actionsHost];
                case 'undo-redo':
                    return [this.undoBtn, this.redoBtn];
                case 'alerts':
                    return [this.alertsBtn];
                case 'panels':
                    return [this.panelsHost];
                case 'screenshot':
                    return overridden(id, left) ?? (screenshotBtn ? [screenshotBtn] : []);
                default:
                    return pinSlot(id, left);
            }
        };
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        const sideEls = (list: readonly string[], left: boolean): HTMLElement[] => {
            const out: HTMLElement[] = [];
            for (const [i, id] of list.entries()) {
                const els = elementsFor(id, left);
                if (els.length === 0) continue;
                const item = [...els];
                if (primaries.has(id) && i < list.length - 1) item.push(sep());
                out.push(...item);
                if (builtin.has(id) && id !== 'actions') this.itemEls.set(id, item);
            }
            return out;
        };
        const right = doc.createElement('span');
        right.className = 'vela-topbar-right';
        right.append(...sideEls(this.comp.right, false));
        this.el.append(...sideEls(this.comp.left, true), right);
        host.appendChild(this.el);
        this.renderTfChips();
        // Snap after layout; RO catches later reflows (symbol / timeframe length).
        this.onHairlineSync();
        this.hairlineRo = new ResizeObserver(this.onHairlineSync);
        this.hairlineRo.observe(this.el);
        doc.defaultView?.addEventListener('resize', this.onHairlineSync);
        this.renderActions();

        this.labeledTooltip(this.tfCaret, TEXT.timeframe, 'vela-topbar-tf', this.tooltips);
        this.labeledTooltip(this.styleButton, TEXT.chartStyle, 'vela-topbar-style', this.tooltips);
        if (this.layoutButton && opts.layout) {
            this.labeledTooltip(this.layoutButton, TEXT.layout, 'vela-topbar-layout', this.tooltips);
            const layout = opts.layout;
            this.layoutPicker = new LayoutPicker({
                trigger: this.layoutButton,
                host,
                ...(opts.i18n ? { i18n: opts.i18n } : {}),
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
            i18n: opts.i18n ?? null,
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
            iconBadges: true,
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
            const label = timeframeLabel(tf, this.i18n);
            b.textContent = label;
            if (tf === this.timeframe) {
                b.dataset.current = '1';
                b.setAttribute('aria-current', 'true');
            } else {
                b.setAttribute('aria-label', this.t(TEXT.switchTimeframe, { timeframe: label }));
                b.addEventListener('click', () => this.opts.onTimeframe(tf));
            }
            this.tfChipsHost.appendChild(b);
        }
        this.tfCaret.replaceChildren();
        if (chips.length === 0) {
            this.tfCaret.dataset.solo = '1';
            this.tfCaret.append(doc.createTextNode(timeframeLabel(this.timeframe, this.i18n)), iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', this.t(TEXT.currentTimeframe, { timeframe: timeframeLabel(this.timeframe, this.i18n) }));
        } else {
            delete this.tfCaret.dataset.solo;
            this.tfCaret.appendChild(iconEl('chevron-down', doc));
            this.tfCaret.setAttribute('aria-label', this.t(TEXT.timeframes));
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
        // The host's glyph of the current layout, else the registered 'layout' icon;
        // with neither, the current layout id as text.
        const glyph = this.opts.layout?.glyph?.();
        if (glyph || iconMarkup('layout')) {
            const icon = iconEl('layout', doc);
            if (glyph) icon.innerHTML = glyph;
            this.layoutButton.appendChild(icon);
        } else {
            this.layoutButton.appendChild(doc.createTextNode(this.layoutId ?? ''));
        }
        this.layoutButton.setAttribute('aria-label', this.t(TEXT.currentLayout, { layout: this.layoutId ?? '' }));
    }

    private renderStyleButton(doc: Document): void {
        this.styleButton.replaceChildren();
        const icon = priceStyleIcon(this.priceStyle);
        // Icon-only entry (like the reference app); the label lives in the tooltip and the
        // dropdown rows. Unknown plugin styles without an icon fall back to their label.
        if (icon) this.styleButton.appendChild(iconEl(icon, doc));
        else this.styleButton.appendChild(doc.createTextNode(priceStyleLabel(this.priceStyle, this.i18n)));
        this.styleButton.setAttribute('aria-label', this.t(TEXT.currentStyle, { style: priceStyleLabel(this.priceStyle, this.i18n) }));
    }

    /** Re-project the contributed topbar actions (call after registrations change).
     *  An action PINNED by the composition renders into its named slot (list position
     *  wins over `align`/`order`); the rest flow into the side's `actions` slot — or
     *  not at all when an explicit list omits it (the list is the side's contract). */
    renderActions(): void {
        const ctx = this.opts.getContext?.();
        this.actionsHost.replaceChildren();
        this.leftActionsHost.replaceChildren();
        for (const pin of this.pinned.values()) pin.host.replaceChildren();
        // Icon-only action buttons carry kit tooltips — dispose the previous render's
        // machines before the buttons they were bound to are discarded.
        for (const t of this.actionTooltips) t.destroy();
        this.actionTooltips = [];
        const doc = this.actionsHost.ownerDocument;
        const flowLeft = this.comp.left.includes('actions');
        const flowRight = this.comp.right.includes('actions');
        const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
        for (const action of widgetActions('topbar', ctx)) {
            const pin = this.pinned.get(action.id);
            // A built-in-id action renders only through its slot pin, or through the
            // flow when the override opted back into it (default side + `order`) —
            // never as an ordinary extra button beside a still-native slot.
            if (!pin && builtin.has(action.id) && !this.flowingOverrides.has(action.id)) continue;
            const left = pin ? pin.left : action.align === 'left';
            if (!pin && !(left ? flowLeft : flowRight)) continue;
            const iconOnly = action.iconOnly === true && !!action.icon;
            if (action.iconOnly === true && !action.icon && !this.warnedIconless.has(action.id)) {
                this.warnedIconless.add(action.id);
                console.warn(`[vela] widget action "${action.id}": iconOnly needs an \`icon\` — rendering the label instead.`);
            }
            const b = doc.createElement('button');
            // Left actions wear the primary-chrome styling (the built-in Indicators
            // button's own class list); right actions keep the compact tool look — and
            // icon-only ones on the right take the native 32px TOOL chrome outright,
            // so a slot override is pixel-faithful to the button it replaces.
            b.className = left ? 'vela-widget-action-left' : iconOnly ? 'vela-widget-tool' : 'vela-widget-action';
            b.dataset.actionId = action.id;
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            const label = textOf(ctx?.i18n ?? this.i18n, action.label);
            if (iconOnly) {
                // The label still speaks — as the accessible name and the hover tooltip.
                b.setAttribute('aria-label', label);
                this.actionTooltips.push(new Tooltip(b, { content: label, triggerId: `vela-action-${action.id}`, host: this.host }));
            } else {
                b.appendChild(doc.createTextNode(label));
            }
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            (pin ? pin.host : left ? this.leftActionsHost : this.actionsHost).appendChild(b);
        }
        this.leftActionsSep.hidden = this.leftActionsHost.childElementCount === 0;
        this.onHairlineSync(); // the visible hairline set may have changed
    }

    setIndicatorCount(_n: number): void {
        // Count badge intentionally hidden — kept as a no-op so hosts can keep calling it.
    }

    /** Hide or show a rendered built-in item (and its trailing hairline). An item the
     *  composition left out has nothing to show; the call is a no-op for it. */
    setItemVisible(id: string, visible: boolean): void {
        for (const el of this.itemEls.get(id) ?? []) {
            if (visible) delete el.dataset.topbarHidden;
            else el.dataset.topbarHidden = '1';
        }
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
        for (const t of [...this.tooltips, ...this.panelTooltips, ...this.actionTooltips]) t.destroy();
        this.el.remove();
    }

    /** One icon-only tool button with its kit tooltip, parked in `sink` for disposal. */
    private toolButton(cls: string, icon: string, tip: MessageLike, onClick: (() => void) | undefined, sink: Tooltip[]): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.className = `vela-widget-tool ${cls}`;
        b.appendChild(iconEl(icon, doc));
        b.setAttribute('aria-label', this.t(tip));
        // Kit tooltip only — a native `title` on top of it double-tooltips. Explicit host: at
        // construction the topbar is NOT in the DOM yet, so the closest('.vela-ui') fallback
        // would portal to <body> — outside the theme vars.
        const tooltip = new Tooltip(b, { content: this.t(tip), triggerId: `vela-tool-${cls}`, host: this.host });
        sink.push(tooltip);
        this.relabels.push(() => {
            b.setAttribute('aria-label', this.t(tip));
            tooltip.setContent(this.t(tip));
        });
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    /** A kit tooltip whose text follows the language. */
    private labeledTooltip(el: HTMLElement, text: MessageLike, triggerId: string, sink: Tooltip[]): void {
        const tooltip = new Tooltip(el, { content: this.t(text), triggerId, host: this.host });
        sink.push(tooltip);
        this.relabels.push(() => tooltip.setContent(this.t(text)));
    }

    /** Re-read every label, tooltip and menu in the current language. */
    relocalize(): void {
        for (const relabel of this.relabels) relabel();
        this.renderTfChips();
        this.renderStyleButton(this.styleButton.ownerDocument);
        if (this.layoutButton) this.renderLayoutButton(this.layoutButton.ownerDocument);
        this.tfMenu.setItems(this.tfItems());
        this.styleMenu.setItems(this.styleItems());
        this.layoutPicker?.relabel();
        this.renderActions();
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
            label: timeframeLabel(tf, this.i18n),
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
            label: priceStyleLabel(id, this.i18n),
            icon: priceStyleIcon(id),
            checked: id === this.priceStyle,
            separatorBefore: i === BUILTIN_PRICE_STYLES.length,
        }));
    }
}
