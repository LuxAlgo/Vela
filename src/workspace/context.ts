// The workspace's WidgetContext — the same contract contributed actions/attachments
// already build against (`ctx.chart` resolves lazily to the ACTIVE cell's chart, as
// the contribution system anticipated), plus additive multi-chart extensions. Existing
// plugins keep working unchanged; grid-aware ones narrow to WorkspaceWidgetContext.
import type { Vela } from '../Vela';
import type { DockedStrip, DockStripOptions, PanelDockView, TopbarItems, WidgetContext } from '../widget/contributions';
import type { ChartCell } from './ChartCell';
import type { WorkspaceReplay } from './WorkspaceReplay';
import type { Translator } from '../core/i18n/types';

/** The extended context a workspace hands to contributed actions/attachments. */
export interface WorkspaceWidgetContext extends WidgetContext {
    /** Every live cell (layout order) — id + LIVE chart + its market. A LIVE getter
     *  (fresh array per read): read it at the point of use, never keep the array. */
    cells: ReadonlyArray<{ id: string; chart: Vela; symbol: string; timeframe: string }>;
    /** LIVE getter — follows every active-cell switch. */
    activeCellId: string;
    setActiveCell(id: string): void;
    /** Bar replay across every cell on one clock (`workspace.replay`) — drive this rather
     *  than one cell's `chart.replay`, so every chart replays together. */
    replay: WorkspaceReplay;
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
    dockStrip(el: HTMLElement, opts?: DockStripOptions): DockedStrip;
    dockEdge(el: HTMLElement, side: 'right'): () => void;
    root: HTMLElement;
    /** The workspace's translator (one object for its lifetime). */
    i18n: Translator;
    toast(message: string, kind?: 'info' | 'success' | 'error'): void;
    /** Debounced dirty mark — third-party persistable state changed (`ctx.stateChanged()`). */
    stateDirty(): void;
    replay: WorkspaceReplay;
    topbar: TopbarItems;
    /** The dock's view — a function: the context is built before the dock exists. */
    panels(): PanelDockView;
}

/** Build a fresh context bound to the CURRENT active cell. EVERY read resolves live —
 *  `chart` lazily (the context is also built during early construction, before any
 *  cell exists: reading `.chart` then throws, and only if an action's `when()`
 *  actually touches it), and the market fields (`symbol`/`timeframe`/`priceStyle`,
 *  `activeCellId`, `cells`) through getters, so an ATTACHMENT that holds its mount
 *  context for the shell's whole life keeps reading the truth after every symbol or
 *  active-cell switch — a snapshot here once named screenshot files after the
 *  mount-time market. */
export function buildContext(host: ContextHost): WorkspaceWidgetContext {
    return {
        get chart() {
            const cell = host.active();
            if (!cell) throw new Error('VelaWorkspace has no active cell yet');
            return cell.chart;
        },
        get symbol() {
            return host.active()?.symbol ?? '';
        },
        get timeframe() {
            return host.active()?.timeframe ?? '60';
        },
        get priceStyle() {
            return host.active()?.priceStyle ?? 'candles';
        },
        setSymbol: (symbol) => host.active()?.setSymbol(symbol),
        setTimeframe: (tf) => host.active()?.setTimeframe(tf),
        setPriceStyle: (style) => host.active()?.setPriceStyle(style),
        openSymbolSearch: (query) => host.openSymbolSearch(query),
        togglePanel: (id, open) => host.togglePanel(id, open),
        dockStrip: (el, opts) => host.dockStrip(el, opts),
        dockEdge: (el, side) => host.dockEdge(el, side),
        host: host.root,
        i18n: host.i18n,
        toast: (message, kind) => host.toast(message, kind),
        addIndicator: (entry) => host.active()?.addExternalIndicator(entry),
        addNativeIndicator: (type) => host.active()?.addNative(type),
        stateChanged: () => host.stateDirty(),
        get cells() {
            return host.cells().map((c) => ({ id: c.id, chart: c.chart, symbol: c.symbol, timeframe: c.timeframe }));
        },
        get activeCellId() {
            return host.active()?.id ?? '';
        },
        setActiveCell: (id) => host.setActiveCell(id),
        replay: host.replay,
        topbar: host.topbar,
        get panels() {
            return host.panels();
        },
    };
}
