// The workspace's WidgetContext — the same contract contributed actions/attachments
// already build against (`ctx.chart` resolves lazily to the ACTIVE cell's chart, as
// the contribution system anticipated), plus additive multi-chart extensions. Existing
// plugins keep working unchanged; grid-aware ones narrow to WorkspaceWidgetContext.
import type { Vela } from '../Vela';
import type { WidgetContext } from '../widget/contributions';
import type { ChartCell } from './ChartCell';

/** The extended context a workspace hands to contributed actions/attachments. */
export interface WorkspaceWidgetContext extends WidgetContext {
    /** Every live cell (layout order) — id + LIVE chart + market snapshot. */
    cells: ReadonlyArray<{ id: string; chart: Vela; symbol: string; timeframe: string }>;
    activeCellId: string;
    setActiveCell(id: string): void;
}

/** What the context builder reads from the workspace (an interface, not the class —
 *  keeps this module import-cycle-free and the context rebuilt per invocation). */
export interface ContextHost {
    /** The active cell, or null during early construction (chrome renders before cells). */
    active(): ChartCell | null;
    cells(): ChartCell[];
    setActiveCell(id: string): void;
    openSymbolSearch(query?: string): void;
    togglePanel(id: string, open?: boolean): void;
    root: HTMLElement;
    toast(message: string, kind?: 'info' | 'success' | 'error'): void;
}

/** Build a fresh context bound to the CURRENT active cell (rebuilt per invocation —
 *  nothing here may be cached by a plugin across calls). `chart` resolves LAZILY: the
 *  context is also built during early construction, before any cell exists — reading
 *  `.chart` then throws, and only if an action's `when()` actually touches it. */
export function buildContext(host: ContextHost): WorkspaceWidgetContext {
    const active = host.active();
    return {
        get chart() {
            const cell = host.active();
            if (!cell) throw new Error('VelaWorkspace has no active cell yet');
            return cell.chart;
        },
        symbol: active?.symbol ?? '',
        timeframe: active?.timeframe ?? '60',
        priceStyle: active?.priceStyle ?? 'candles',
        setSymbol: (symbol) => host.active()?.setSymbol(symbol),
        setTimeframe: (tf) => host.active()?.setTimeframe(tf),
        setPriceStyle: (style) => host.active()?.setPriceStyle(style),
        openSymbolSearch: (query) => host.openSymbolSearch(query),
        togglePanel: (id, open) => host.togglePanel(id, open),
        host: host.root,
        toast: (message, kind) => host.toast(message, kind),
        cells: host.cells().map((c) => ({ id: c.id, chart: c.chart, symbol: c.symbol, timeframe: c.timeframe })),
        activeCellId: active?.id ?? '',
        setActiveCell: (id) => host.setActiveCell(id),
    };
}
