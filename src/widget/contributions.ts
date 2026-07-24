// Widget CONTRIBUTIONS — the descriptor-based customization seam. Plugins (and host
// apps) contribute ACTIONS as data (never DOM): the widget projects them into its own
// chrome — topbar buttons, context-menu items — so any future view layer (React) can
// project the same descriptors. Register at import time, before widgets are constructed.
import type { Vela } from '../Vela';

/** The runtime surface an action's `when`/`run` receives. */
export interface WidgetContext {
    /** The CURRENT inner chart (a new instance after each symbol/timeframe rebuild). */
    chart: Vela;
    symbol: string;
    timeframe: string;
    priceStyle: string;
    setSymbol(symbol: string): void;
    setTimeframe(tf: string): void;
    setPriceStyle(style: string): void;
    openSymbolSearch(query?: string): void;
    /** The widget's root element — pass it as `host` when mounting kit components
     *  (Dialog/Menu/Tooltip) from an action; without an explicit host they portal to
     *  the body, OUTSIDE the theme variables. A multi-chart shell hands its own root. */
    host: HTMLElement;
    /** The widget's feedback pill (bottom-center, auto-hides). */
    toast(message: string, kind?: 'info' | 'success' | 'error'): void;
}

/** Where an action is projected. */
export type WidgetActionTarget = 'topbar' | 'context:body' | 'context:price-axis' | 'context:time-axis';

export interface WidgetActionDescriptor {
    /** Stable id — re-registering an id replaces it. */
    id: string;
    target: WidgetActionTarget;
    label: string;
    /** Icon id from the `vela/ui` icon registry (register yours with `registerIcon`). */
    icon?: string;
    /** Sort key within the contributed group (ascending; default 0). */
    order?: number;
    /** Runtime gate — omitted ⇒ always shown. */
    when?: (ctx: WidgetContext) => boolean;
    run: (ctx: WidgetContext) => void;
}

const registry = new Map<string, WidgetActionDescriptor>();

/** Register (or replace) a widget action. Widgets read the registry live. */
export function registerWidgetAction(desc: WidgetActionDescriptor): () => void {
    registry.set(desc.id, desc);
    return () => {
        if (registry.get(desc.id) === desc) registry.delete(desc.id);
    };
}

export function unregisterWidgetAction(id: string): void {
    registry.delete(id);
}

/** Actions for one target, `order`-sorted, `when`-filtered when a context is given. */
export function widgetActions(target: WidgetActionTarget, ctx?: WidgetContext): WidgetActionDescriptor[] {
    const list = [...registry.values()].filter((d) => d.target === target);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return ctx ? list.filter((d) => !d.when || d.when(ctx)) : list;
}
