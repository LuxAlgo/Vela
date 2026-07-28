// Topbar — symbol label, timeframe dropdown, and the price-style dropdown (built-ins +
// every chart type registered through the plugin SDK, labels from the registry).
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { iconEl, iconMarkup, registerIcon } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { chartType } from '../chart-types/registry';
import { widgetActions, type WidgetContext } from './contributions';
import { priceStyleIds } from '../renderers/native/core/chartConfig';
import { timeframeLabel } from './timeframe';

// The component owns its stylesheet (id-guarded, injected at construction) so EVERY
// host that mounts a Topbar — the widget, a multi-chart workspace — gets the same look.
const STYLE_ID = 'vela-topbar';
const CSS = `
.vela-widget-topbar {
    display: flex;
    align-items: center;
    gap: var(--vela-space-2);
    padding: var(--vela-space-1) var(--vela-space-2);
    border-bottom: 1px solid var(--vela-border-soft);
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    flex: none;
}
.vela-widget-symbol, .vela-widget-tf, .vela-widget-style, .vela-widget-indicators {
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
.vela-widget-symbol:hover, .vela-widget-tf:hover, .vela-widget-style:hover, .vela-widget-indicators:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-widget-symbol:hover { color: var(--vela-fg-bright); }
.vela-widget-topbar .vela-icon { color: inherit; font-size: 14px; }
.vela-sep { width: 1px; height: 22px; margin: 0 4px; flex: none; background: rgba(255, 255, 255, 0.22); }
.vela-ind-count {
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 0 6px;
    font-size: 10px;
    font-weight: 700;
    color: var(--vela-fg);
}
.vela-alerts-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--vela-accent);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.vela-widget-actions { margin-left: auto; display: inline-flex; gap: var(--vela-space-1); }
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
.vela-widget-tool:hover { background: var(--vela-hover); color: var(--vela-fg); }
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
    priceStyle: string;
    onTimeframe: (tf: string) => void;
    onPriceStyle: (style: string) => void;
    /** Optional workspace LAYOUT dropdown (rendered after the style dropdown when given).
     *  `options` is read live, so plugin-registered layouts appear automatically. */
    layout?: {
        current: string;
        options: () => Array<{ id: string; label: string }>;
        onSelect: (id: string) => void;
        /** Optional TOGGLE rows appended under the layout presets (e.g. the workspace's
         *  "Sync crosshair"). Re-read on every open/refresh; `onToggle` flips one. */
        toggles?: () => Array<{ id: string; label: string; checked: boolean }>;
        onToggle?: (id: string) => void;
    };
    onIndicatorsClick?: () => void;
    onObjectsClick?: () => void;
    onScreenshotClick?: () => void;
    onAlertsClick?: (anchor: HTMLElement) => void;
    onSettingsClick?: () => void;
    onDataWindowClick?: () => boolean | void;
    /** Initial pressed state of the data-window toggle. */
    dataWindowOn?: boolean;
    /** Live widget context for contributed actions (topbar target). */
    getContext?: () => WidgetContext;
}

export class Topbar {
    readonly el: HTMLElement;
    private readonly symbolEl: HTMLElement;
    private readonly tfButton: HTMLElement;
    private readonly styleButton: HTMLElement;
    private layoutButton: HTMLElement | null = null;
    private layoutMenu: Menu | null = null;
    private layoutId: string | null = null;
    private readonly tfMenu: Menu;
    private readonly styleMenu: Menu;
    private readonly tooltips: Tooltip[] = [];
    private readonly actionsHost: HTMLElement;
    private alertsBtn!: HTMLButtonElement;
    private indicatorsCount!: HTMLElement;
    private alertsBadge!: HTMLElement;
    private readonly opts: TopbarOptions;
    private timeframe: string;
    private priceStyle: string;

    constructor(host: HTMLElement, opts: TopbarOptions) {
        this.opts = opts;
        this.timeframe = opts.timeframe;
        this.priceStyle = opts.priceStyle;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        this.el = doc.createElement('div');
        this.el.className = 'vela-widget-topbar';
        this.symbolEl = doc.createElement('button');
        this.symbolEl.className = 'vela-widget-symbol';
        this.symbolEl.textContent = opts.symbol;
        if (opts.onSymbolClick) this.symbolEl.addEventListener('click', opts.onSymbolClick);
        this.tfButton = doc.createElement('button');
        this.tfButton.className = 'vela-widget-tf';
        this.tfButton.textContent = timeframeLabel(this.timeframe);
        this.styleButton = doc.createElement('button');
        this.styleButton.className = 'vela-widget-style';
        this.renderStyleButton(doc);
        const indicatorsBtn = doc.createElement('button');
        indicatorsBtn.className = 'vela-widget-indicators';
        indicatorsBtn.append(iconEl('indicators', doc), doc.createTextNode('Indicators'));
        this.indicatorsCount = doc.createElement('span');
        this.indicatorsCount.className = 'vela-ind-count';
        this.indicatorsCount.style.display = 'none';
        indicatorsBtn.appendChild(this.indicatorsCount);
        if (opts.onIndicatorsClick) indicatorsBtn.addEventListener('click', opts.onIndicatorsClick);

        // Right-hand cluster: contributed actions, then icon-only tools (data window /
        // screenshot / objects / settings) — labels live in their tooltips.
        this.actionsHost = doc.createElement('span');
        this.actionsHost.className = 'vela-widget-actions';
        const tool = (cls: string, icon: string, tip: string, onClick?: () => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = `vela-widget-tool ${cls}`;
            b.appendChild(iconEl(icon, doc));
            b.setAttribute('aria-label', tip);
            // Kit tooltip only — a native `title` on top of it double-tooltips.
            // Explicit host: at tool() time the topbar is NOT in the DOM yet, so the
            // closest('.vela-ui') fallback would portal to <body> — outside the theme vars.
            this.tooltips.push(new Tooltip(b, { content: tip, triggerId: `vela-tool-${cls}`, host }));
            if (onClick) b.addEventListener('click', onClick);
            return b;
        };
        const dataWindowBtn = tool('vela-widget-datawindow', 'datawindow', 'Data window', () => {
            const on = this.opts.onDataWindowClick?.();
            if (typeof on === 'boolean') dataWindowBtn.dataset.active = on ? '1' : '';
        });
        if (opts.dataWindowOn) dataWindowBtn.dataset.active = '1';
        const screenshotBtn = tool('vela-widget-screenshot', 'camera', 'Download screenshot', opts.onScreenshotClick);
        const objectsBtn = tool('vela-widget-objects', 'objects', 'Object tree', opts.onObjectsClick);
        const settingsBtn = tool('vela-widget-settings', 'gear', 'Chart settings', opts.onSettingsClick);
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
        const leading: Array<HTMLElement> = [this.symbolEl, sep(), this.tfButton, sep(), this.styleButton, sep()];
        if (this.layoutButton) leading.push(this.layoutButton, sep());
        this.el.append(...leading, indicatorsBtn, this.actionsHost, this.alertsBtn, dataWindowBtn, screenshotBtn, objectsBtn, settingsBtn);
        host.appendChild(this.el);
        this.renderActions();

        this.tooltips.push(new Tooltip(this.tfButton, { content: 'Timeframe', triggerId: 'vela-topbar-tf', host }));
        this.tooltips.push(new Tooltip(this.styleButton, { content: 'Chart style', triggerId: 'vela-topbar-style', host }));
        if (this.layoutButton && opts.layout) {
            this.tooltips.push(new Tooltip(this.layoutButton, { content: 'Layout', triggerId: 'vela-topbar-layout', host }));
            this.layoutMenu = new Menu({
                trigger: this.layoutButton,
                triggerId: 'vela-topbar-layout',
                host,
                items: this.layoutItems(),
                onSelect: (id) => {
                    // Toggle rows flip their setting and stay reflected on next open;
                    // every other id is a layout preset.
                    if (id.startsWith('toggle:')) {
                        opts.layout!.onToggle?.(id.slice('toggle:'.length));
                        this.layoutMenu?.setItems(this.layoutItems());
                        return;
                    }
                    opts.layout!.onSelect(id);
                },
            });
        }
        this.tfMenu = new Menu({
            trigger: this.tfButton,
            triggerId: 'vela-topbar-tf',
            host,
            items: this.tfItems(),
            onSelect: (id) => opts.onTimeframe(id),
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
        this.symbolEl.textContent = symbol;
    }

    setTimeframe(tf: string): void {
        this.timeframe = tf;
        this.tfButton.textContent = timeframeLabel(tf);
        this.tfMenu.setItems(this.tfItems());
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
        this.layoutMenu?.setItems(this.layoutItems());
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

    private layoutItems(): MenuItemDescriptor[] {
        const presets = (this.opts.layout?.options() ?? []).map((l) => ({ id: l.id, label: l.label, checked: l.id === this.layoutId }));
        const toggles = (this.opts.layout?.toggles?.() ?? []).map((t, i) => ({ id: `toggle:${t.id}`, label: t.label, checked: t.checked, toggle: true, separatorBefore: i === 0 }));
        return [...presets, ...toggles];
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
        const doc = this.actionsHost.ownerDocument;
        for (const action of widgetActions('topbar', ctx)) {
            const b = doc.createElement('button');
            b.className = 'vela-widget-action';
            if (action.icon) b.appendChild(iconEl(action.icon, doc));
            b.appendChild(doc.createTextNode(action.label));
            b.addEventListener('click', () => {
                const c = this.opts.getContext?.();
                if (c) action.run(c);
            });
            this.actionsHost.appendChild(b);
        }
    }

    setIndicatorCount(n: number): void {
        this.indicatorsCount.textContent = String(n);
        this.indicatorsCount.style.display = n > 0 ? '' : 'none';
    }

    setAlertCount(n: number): void {
        this.alertsBadge.textContent = n > 9 ? '9+' : String(n);
        this.alertsBadge.style.display = n > 0 ? '' : 'none';
    }

    destroy(): void {
        this.tfMenu.destroy();
        this.styleMenu.destroy();
        this.layoutMenu?.destroy();
        for (const t of this.tooltips) t.destroy();
        this.el.remove();
    }

    private tfItems(): MenuItemDescriptor[] {
        return this.opts.timeframes.map((tf) => ({ id: tf, label: timeframeLabel(tf), checked: tf === this.timeframe }));
    }

    private styleItems(): MenuItemDescriptor[] {
        // Live list: built-ins ∪ plugin-registered chart types (a registered type shows
        // up here automatically — the SDK's style-picker contribution).
        return priceStyleIds().map((id) => ({
            id,
            label: priceStyleLabel(id),
            icon: priceStyleIcon(id),
            checked: id === this.priceStyle,
        }));
    }
}
