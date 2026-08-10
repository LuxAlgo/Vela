// Price-scale drawer (mobile) — opened by a long-press on the price axis. Mirrors the
// desktop right-click price-axis menu: auto / invert / scale modes / label & level
// toggles, plus a hop into the full Scales settings tab.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import {
    invertWrite,
    paneScaleAt,
    priceAxisItems,
    scaleChoiceOf,
    scaleWrites,
    settingsSectionOf,
    type PaneScaleInfo,
    type ScaleChoice,
} from './context-menu-model';
import type { Vela } from '../Vela';

const STYLE_ID = 'vela-widget-price-scale-drawer';
const CSS = `
.vela-psd-list { padding: 2px 0 4px; }
.vela-psd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-psd-row:active { background: var(--vela-hover); }
.vela-psd-row[data-sep='1'] { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--vela-border); border-radius: 0 0 8px 8px; }
.vela-psd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-psd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
.vela-psd-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
`;

export interface PriceScaleDrawerOptions {
    host: HTMLElement;
    /** Live chart (reads/writes scale features). */
    chart: () => Vela | null;
    /** Plot-local y of the long-press — picks which pane's scale the sheet targets. */
    pressY: () => number;
    onOpenChange?: (open: boolean) => void;
}

export class PriceScaleDrawer {
    private readonly drawer: Drawer;
    private pane: PaneScaleInfo | null = null;

    constructor(private readonly opts: PriceScaleDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, title: 'Price scale', onOpenChange: opts.onOpenChange });
    }

    open(): void {
        const chart = this.opts.chart();
        const panes = chart?.renderer.get('paneScales');
        this.pane = Array.isArray(panes) ? paneScaleAt(panes as PaneScaleInfo[], this.opts.pressY()) : null;
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private flag(feature: string): boolean {
        return Boolean(this.opts.chart()?.renderer.get(feature));
    }

    private render(): void {
        const chart = this.opts.chart();
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();
        if (!chart) return;

        const pane = this.pane;
        const items = priceAxisItems({
            auto: chart.renderer.get('autoScale') !== false,
            invert: pane ? pane.invert : this.flag('invertScale'),
            choice: scaleChoiceOf(pane ?? { mode: String(chart.renderer.get('scaleMode') ?? 'price'), log: this.flag('logScale') }),
            axisLabels: this.flag('axisLabels'),
            priceLabel: this.flag('priceLabel'),
            countdown: this.flag('countdown'),
            priceLine: this.flag('currentPriceLine'),
        });

        const list = doc.createElement('div');
        list.className = 'vela-psd-list';

        const row = (label: string, opts: { checked?: boolean; sep?: boolean; onClick: () => void }): void => {
            const el = doc.createElement('div');
            el.className = 'vela-psd-row';
            if (opts.sep) el.dataset.sep = '1';
            const text = doc.createElement('span');
            text.className = 'vela-psd-row-label';
            text.textContent = label;
            el.appendChild(text);
            if (opts.checked) el.appendChild(iconEl('check', doc));
            el.addEventListener('click', opts.onClick);
            list.appendChild(el);
        };
        const section = (label: string): void => {
            const el = doc.createElement('div');
            el.className = 'vela-psd-section';
            el.textContent = label;
            list.appendChild(el);
        };

        for (const item of items) {
            if (item.id === 'labels' && item.submenu) {
                section('Labels');
                for (const sub of item.submenu) {
                    row(sub.label, {
                        checked: sub.checked,
                        onClick: () => {
                            const feature = sub.id.slice('toggle:'.length);
                            chart.renderer.set(feature, !this.flag(feature));
                            this.render();
                        },
                    });
                }
                continue;
            }
            if (item.id === 'levels' && item.submenu) {
                section('Levels');
                for (const sub of item.submenu) {
                    row(sub.label, {
                        checked: sub.checked,
                        onClick: () => {
                            const feature = sub.id.slice('toggle:'.length);
                            chart.renderer.set(feature, !this.flag(feature));
                            this.render();
                        },
                    });
                }
                continue;
            }
            if (item.id.startsWith('settings')) {
                row(item.label, {
                    sep: true,
                    onClick: () => {
                        chart.renderer.openSettings(settingsSectionOf(item.id));
                        this.drawer.hide();
                    },
                });
                continue;
            }
            if (item.id === 'auto') {
                row(item.label, {
                    checked: item.checked,
                    onClick: () => {
                        chart.renderer.set('autoScale', chart.renderer.get('autoScale') === false);
                        this.render();
                    },
                });
                continue;
            }
            if (item.id === 'invert') {
                row(item.label, {
                    checked: item.checked,
                    onClick: () => {
                        const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag('invertScale')), pane);
                        chart.renderer.set(feature, value);
                        // Refresh pane snapshot so the next invert flip uses the new state.
                        const panes = chart.renderer.get('paneScales');
                        this.pane = Array.isArray(panes) ? paneScaleAt(panes as PaneScaleInfo[], this.opts.pressY()) : pane;
                        this.render();
                    },
                });
                continue;
            }
            if (item.id.startsWith('scale:')) {
                row(item.label, {
                    checked: item.checked,
                    sep: item.separatorBefore,
                    onClick: () => {
                        for (const [feature, value] of scaleWrites(item.id.slice('scale:'.length) as ScaleChoice, pane)) {
                            chart.renderer.set(feature, value);
                        }
                        const panes = chart.renderer.get('paneScales');
                        this.pane = Array.isArray(panes) ? paneScaleAt(panes as PaneScaleInfo[], this.opts.pressY()) : pane;
                        this.render();
                    },
                });
            }
        }

        this.drawer.body.appendChild(list);
    }
}
