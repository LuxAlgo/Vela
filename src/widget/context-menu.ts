// Chart context menu — right-click on the chart area. Items depend on the zone
// (price axis / time axis / chart body) and current renderer feature states; the menu
// itself is the kit Menu anchored at the pointer.
import type { Vela } from '../Vela';
import type { CrosshairEvent } from '../core/ports/IChartRenderer';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { fmtPrice } from './format';
import { widgetActions, type WidgetContext } from './contributions';

/** Approximate chrome insets used only to classify the right-clicked zone. */
const PRICE_AXIS_W = 60;
const TIME_AXIS_H = 26;

type Zone = 'body' | 'price-axis' | 'time-axis';

export interface ContextMenuCallbacks {
    screenshot: () => void;
    /** Reset the view (autoscale back on). */
    resetView: () => void;
    /** Live widget context for contributed `context:*` actions. */
    getContext?: () => WidgetContext;
}

export class ChartContextMenu {
    private readonly menu: Menu;
    private readonly host: HTMLElement;
    private chart: Vela | null = null;
    private lastCross: CrosshairEvent | null = null;
    private unsub: (() => void) | null = null;
    private lastZone: Zone = 'body';
    private readonly onContextMenu = (e: MouseEvent): void => {
        e.preventDefault();
        if (!this.chart) return;
        this.lastZone = this.zoneOf(e);
        this.menu.setItems(this.itemsFor(this.lastZone));
        this.menu.openAt(e.clientX, e.clientY);
    };

    constructor(host: HTMLElement, private readonly cbs: ContextMenuCallbacks) {
        this.host = host;
        this.menu = new Menu({
            host,
            items: [],
            placement: 'bottom-start',
            onSelect: (id) => this.run(id),
        });
        host.addEventListener('contextmenu', this.onContextMenu);
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.unsub?.();
        this.chart = chart;
        this.unsub = chart.renderer.onCrosshairMove((e) => {
            this.lastCross = e;
        });
    }

    destroy(): void {
        this.unsub?.();
        this.host.removeEventListener('contextmenu', this.onContextMenu);
        this.menu.destroy();
    }

    private zoneOf(e: MouseEvent): Zone {
        const rect = this.host.getBoundingClientRect();
        if (e.clientX - rect.left > rect.width - PRICE_AXIS_W) return 'price-axis';
        if (e.clientY - rect.top > rect.height - TIME_AXIS_H) return 'time-axis';
        return 'body';
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
        const price = this.lastCross?.price ?? null;
        const scaleItems: MenuItemDescriptor[] = [
            { id: 'reset-scale', label: 'Reset price scale' },
            { id: 'toggle:logScale', label: 'Logarithmic scale', checked: this.flag('logScale'), separatorBefore: true },
            { id: 'toggle:invertScale', label: 'Invert scale', checked: this.flag('invertScale') },
        ];
        if (zone === 'price-axis') return [...scaleItems, ...this.contributed(zone)];
        if (zone === 'time-axis') {
            return [{ id: 'reset-view', label: 'Reset view' }, ...this.contributed(zone)];
        }
        return [
            { id: 'copy-price', label: price !== null ? `Copy price ${fmtPrice(price)}` : 'Copy price', disabled: price === null },
            { id: 'reset-view', label: 'Reset view', separatorBefore: true },
            { id: 'screenshot', label: 'Download screenshot' },
            { id: 'toggle:currentPriceLine', label: 'Current price line', checked: this.flag('currentPriceLine'), separatorBefore: true },
            { id: 'toggle:countdown', label: 'Bar countdown', checked: this.flag('countdown') },
            { id: 'toggle:gridlines', label: 'Gridlines', checked: this.flag('gridlines') },
            ...scaleItems.slice(1).map((i, n) => ({ ...i, separatorBefore: n === 0 })),
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
        } else if (id === 'copy-price') {
            const price = this.lastCross?.price;
            if (price != null) void navigator.clipboard?.writeText(String(price)).catch(() => {});
        } else if (id === 'screenshot') {
            this.cbs.screenshot();
        } else if (id === 'reset-view' || id === 'reset-scale') {
            this.cbs.resetView();
        }
    }
}
