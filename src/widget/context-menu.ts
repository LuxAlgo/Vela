// Chart context menu — right-click on the chart area. Items depend on the zone
// (price axis / time axis / chart body) and current renderer feature states; the menu
// itself is the kit Menu anchored at the pointer.
import type { Vela } from '../Vela';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { widgetActions, type WidgetContext } from './contributions';
import {
    bodyItems,
    invertWrite,
    paneScaleAt,
    priceAxisItems,
    scaleChoiceOf,
    scaleWrites,
    settingsSectionOf,
    timeAxisItems,
    type PaneScaleInfo,
    type ScaleChoice,
    type Zone,
} from './context-menu-model';

/** Approximate chrome insets used only to classify the right-clicked zone. */
const PRICE_AXIS_W = 60;
const TIME_AXIS_H = 26;

export interface ContextMenuCallbacks {
    /** Reset the view (all history, autoscale back on). */
    resetView: () => void;
    /** The display timezone the host holds (the time-axis menu checks it). */
    timezone?: () => string;
    /** Switch the display timezone through the host, so its own chrome follows. */
    setTimezone?: (zone: string) => void;
    /** Live widget context for contributed `context:*` actions. */
    getContext?: () => WidgetContext;
}

export class ChartContextMenu {
    private readonly menu: Menu;
    private readonly host: HTMLElement;
    private chart: Vela | null = null;
    private lastZone: Zone = 'body';
    /** The pane whose scale the open price-axis menu targets (null ⇒ the main scale). */
    private lastPane: PaneScaleInfo | null = null;
    private readonly onContextMenu = (e: MouseEvent): void => {
        e.preventDefault();
        if (!this.chart) return;
        this.lastZone = this.zoneOf(e);
        this.lastPane = this.lastZone === 'price-axis' ? this.paneAt(e) : null;
        this.menu.setItems(this.itemsFor(this.lastZone));
        this.menu.openAt(e.clientX, e.clientY);
    };

    constructor(host: HTMLElement, private readonly cbs: ContextMenuCallbacks) {
        this.host = host;
        this.menu = new Menu({
            host,
            items: [],
            placement: 'bottom-start',
            // Pointer-anchored action menu: checked state reads as a leading ✓, not a
            // washed row (which would read as hover in a menu with no trigger button).
            checkmarks: true,
            onSelect: (id) => this.run(id),
        });
        host.addEventListener('contextmenu', this.onContextMenu);
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.chart = chart;
    }

    destroy(): void {
        this.host.removeEventListener('contextmenu', this.onContextMenu);
        this.menu.destroy();
    }

    private zoneOf(e: MouseEvent): Zone {
        const rect = this.host.getBoundingClientRect();
        if (e.clientX - rect.left > rect.width - PRICE_AXIS_W) return 'price-axis';
        if (e.clientY - rect.top > rect.height - TIME_AXIS_H) return 'time-axis';
        return 'body';
    }

    /** The pane under the pointer, so every pane's price scale has its own menu. */
    private paneAt(e: MouseEvent): PaneScaleInfo | null {
        const panes = this.chart?.renderer.get('paneScales');
        if (!Array.isArray(panes)) return null;
        return paneScaleAt(panes as PaneScaleInfo[], e.clientY - this.host.getBoundingClientRect().top);
    }

    private flag(feature: string): boolean {
        return Boolean(this.chart?.renderer.get(feature));
    }

    private contributed(zone: Zone): MenuItemDescriptor[] {
        const ctx = this.cbs.getContext?.();
        return widgetActions(`context:${zone}`, ctx).map((a, i) => ({
            id: `action:${a.id}`,
            label: a.label,
            icon: a.icon,
            separatorBefore: i === 0,
        }));
    }

    private itemsFor(zone: Zone): MenuItemDescriptor[] {
        if (zone === 'price-axis') {
            const pane = this.lastPane;
            return [
                ...priceAxisItems({
                    auto: this.chart?.renderer.get('autoScale') !== false,
                    invert: pane ? pane.invert : this.flag('invertScale'),
                    choice: scaleChoiceOf(pane ?? { mode: String(this.chart?.renderer.get('scaleMode') ?? 'price'), log: this.flag('logScale') }),
                    axisLabels: this.flag('axisLabels'),
                    priceLabel: this.flag('priceLabel'),
                    countdown: this.flag('countdown'),
                    priceLine: this.flag('currentPriceLine'),
                }),
                ...this.contributed(zone),
            ];
        }
        if (zone === 'time-axis') {
            const tz = this.cbs.timezone?.() ?? String(this.chart?.renderer.get('timezone') ?? 'Etc/UTC');
            return [...timeAxisItems(tz), ...this.contributed('time-axis')];
        }
        const chart = this.chart;
        return [
            ...bodyItems({
                drawings: chart?.drawings.supported ? chart.drawings.all().length : 0,
                indicators: chart?.indicators().length ?? 0,
            }),
            ...this.contributed('body'),
        ];
    }

    private run(id: string): void {
        const chart = this.chart;
        if (!chart) return;
        if (id.startsWith('action:')) {
            const ctx = this.cbs.getContext?.();
            if (ctx) widgetActions(`context:${this.lastZone}`, ctx).find((a) => a.id === id.slice('action:'.length))?.run(ctx);
            return;
        }
        if (id.startsWith('toggle:')) {
            const feature = id.slice('toggle:'.length);
            chart.renderer.set(feature, !this.flag(feature));
        } else if (id.startsWith('scale:')) {
            for (const [feature, value] of scaleWrites(id.slice('scale:'.length) as ScaleChoice, this.lastPane)) chart.renderer.set(feature, value);
        } else if (id.startsWith('tz:')) {
            const zone = id.slice('tz:'.length);
            if (this.cbs.setTimezone) this.cbs.setTimezone(zone);
            else chart.renderer.set('timezone', zone);
        } else if (id === 'auto') {
            chart.renderer.set('autoScale', chart.renderer.get('autoScale') === false);
        } else if (id === 'invert') {
            const pane = this.lastPane;
            const [feature, value] = invertWrite(!(pane ? pane.invert : this.flag('invertScale')), pane);
            chart.renderer.set(feature, value);
        } else if (id.startsWith('settings')) {
            chart.renderer.openSettings(settingsSectionOf(id));
        } else if (id === 'reset-view') {
            this.cbs.resetView();
        } else if (id === 'remove-drawings') {
            if (chart.drawings.supported) for (const d of chart.drawings.all()) chart.drawings.remove(d.id);
        } else if (id === 'remove-indicators') {
            for (const handle of chart.indicators()) handle.remove();
        }
    }
}
