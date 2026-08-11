// Widget CONTRIBUTIONS — the descriptor-based customization seam. Plugins (and host
// apps) contribute ACTIONS as data (never DOM): the widget projects them into its own
// chrome — topbar buttons, context-menu items — so any future view layer (React) can
// project the same descriptors. Register at import time, before widgets are constructed.
import type { Vela } from '../Vela';
import type { LegendActionView } from '../core/ports/IChartRenderer';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';

/** The runtime surface an action's `when`/`run` receives. */
export interface WidgetContext {
    /** The CURRENT inner chart. Read it through this getter rather than capturing it:
     *  a shell may replace its chart instance, and a captured one would be destroyed.
     *  (Symbol and timeframe switches are applied IN PLACE — the instance survives them.) */
    chart: Vela;
    symbol: string;
    timeframe: string;
    priceStyle: string;
    setSymbol(symbol: string): void;
    setTimeframe(tf: string): void;
    setPriceStyle(style: string): void;
    openSymbolSearch(query?: string): void;
    /** Open/close a docked side panel by id (built-in or contributed) — a bare call flips
     *  it. The dock stays exclusive: opening one closes whichever was showing. Unknown ids
     *  are ignored. The seam a plugin uses to open ITS OWN panel programmatically. */
    togglePanel(id: string, open?: boolean): void;
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

/**
 * A widget ATTACHMENT — a contributed unit of per-widget behavior/UI beyond a single
 * button: overlays, gesture handlers, custom key handling. `mount` runs once per
 * widget (at construction, or on `refreshActions()` for late registrations) with the
 * widget's {@link WidgetContext}; the returned disposer runs at widget destroy.
 * Everything the attachment touches must come from `ctx` (never module globals).
 */
export interface WidgetAttachment {
    /** Stable id — re-registering an id replaces it (mounted widgets keep the old one until destroy). */
    id: string;
    mount(ctx: WidgetContext): () => void;
}

/**
 * A contributed side panel's runtime handle — what `mount` hands back. Every member is
 * optional: a panel that only paints its body once needs none of them.
 */
export interface SidePanelHandle {
    /** (Re)bind to a chart instance: on mount, after every widget rebuild, and — in a
     *  workspace — whenever the active cell changes. */
    onChart?(chart: Vela): void;
    /** The panel just became visible. Panels that render lazily do it here. */
    onOpen?(): void;
    /** Released when the panel is dropped (widget destroy, or a re-registration). */
    destroy?(): void;
}

/**
 * The header surface a contributed panel may use: a SLOT between the title and the close
 * button for compact controls (a document name, action icons), and the title text itself.
 * Everything else in the header (the close button, the row) stays the shell's.
 */
export interface SidePanelHeader {
    /** Lay out inline controls here; the close button stays pinned right of it. */
    slot: HTMLElement;
    /** Replace the header title (an empty string hides it). The topbar toggle keeps the
     *  DECLARED `title` as its tooltip. */
    setTitle(title: string): void;
}

/**
 * A contributed SIDE PANEL — a docked column in the shell's panel dock, alongside the object
 * tree and the data window, with a toggle button in the topbar's panel group.
 *
 * The shell owns the chrome (header, close button, dock exclusivity, the button and its pressed
 * state) and hands `mount` the panel's BODY element to fill — plus a {@link SidePanelHeader}
 * for panels that dock controls in their header; the contribution never reaches into
 * the shell's DOM. Register at import time, before widgets are constructed (`refreshActions()`
 * picks up later registrations on an already-built widget).
 */
export interface SidePanelDescriptor {
    /** Stable id — re-registering an id replaces it. Also the key its width persists under. */
    id: string;
    /** Header title, and the tooltip of its topbar button. */
    title: string;
    /** Icon id from the `vela/ui` icon registry (register yours with `registerIcon`). */
    icon: string;
    /** Sort key among the panel buttons (ascending; default 100 — after the built-ins). */
    order?: number;
    /** Declared width in px (default 280). */
    width?: number;
    /** Let the user drag the panel's inner edge (default false — a fixed column). */
    resizable?: boolean;
    minWidth?: number;
    maxWidth?: number;
    mount(ctx: WidgetContext, body: HTMLElement, header: SidePanelHeader): SidePanelHandle | void;
}

/** One panel toggle, as the shell's chrome consumes it (data, never DOM). */
export interface SidePanelButton {
    id: string;
    title: string;
    icon: string;
}

const registry = new Map<string, WidgetActionDescriptor>();
const attachments = new Map<string, WidgetAttachment>();
const panels = new Map<string, SidePanelDescriptor>();

/** Register (or replace) a widget attachment. Returns an unregister disposer. */
export function registerWidgetAttachment(att: WidgetAttachment): () => void {
    attachments.set(att.id, att);
    return () => {
        if (attachments.get(att.id) === att) attachments.delete(att.id);
    };
}

export function unregisterWidgetAttachment(id: string): void {
    attachments.delete(id);
}

/** Every registered attachment (registration order). */
export function widgetAttachments(): WidgetAttachment[] {
    return [...attachments.values()];
}

/** Sort key of a panel that declares none — after the shell's own panels. */
export const DEFAULT_PANEL_ORDER = 100;

/** Register (or replace) a side panel. Returns an unregister disposer. */
export function registerSidePanel(desc: SidePanelDescriptor): () => void {
    panels.set(desc.id, desc);
    return () => {
        if (panels.get(desc.id) === desc) panels.delete(desc.id);
    };
}

export function unregisterSidePanel(id: string): void {
    panels.delete(id);
}

/** Every registered side panel, `order`-sorted (registration order breaks ties). */
export function sidePanels(): SidePanelDescriptor[] {
    return [...panels.values()].sort((a, b) => (a.order ?? DEFAULT_PANEL_ORDER) - (b.order ?? DEFAULT_PANEL_ORDER));
}

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

// ── Legend actions ─────────────────────────────────────────────────────────────────

/** What a legend action sees about the indicator whose row it sits on. */
export interface LegendIndicatorInfo {
    id: string;
    title: string;
    /** The script source the indicator was added with; undefined for a NATIVE
     *  (core-computed) indicator. The usual `when` gate for source-centric actions. */
    source?: string;
}

/**
 * A contributed LEGEND-ROW action: an icon button on every indicator's legend row,
 * revealed with the built-in controls (hover/selection), between them and the ✕.
 * `when` gates per indicator (e.g. `(ind) => ind.source !== undefined` for actions
 * that need the script). `run` receives the shell's {@link WidgetContext} and the row's
 * {@link LegendIndicatorInfo}.
 */
export interface LegendActionDescriptor {
    /** Stable id — re-registering an id replaces it. */
    id: string;
    /** Icon id from the `vela/ui` icon registry (register yours with `registerIcon`). */
    icon: string;
    tooltip: string;
    /** Sort key within the contributed group (ascending; default 0). */
    order?: number;
    /** Per-indicator gate — omitted ⇒ shown on every row. */
    when?: (indicator: LegendIndicatorInfo) => boolean;
    run(ctx: WidgetContext, indicator: LegendIndicatorInfo): void;
}

const legendRegistry = new Map<string, LegendActionDescriptor>();

/** Register (or replace) a legend action. Returns an unregister disposer. */
export function registerLegendAction(desc: LegendActionDescriptor): () => void {
    legendRegistry.set(desc.id, desc);
    return () => {
        if (legendRegistry.get(desc.id) === desc) legendRegistry.delete(desc.id);
    };
}

export function unregisterLegendAction(id: string): void {
    legendRegistry.delete(id);
}

/** Every registered legend action, `order`-sorted (registration order breaks ties). */
export function legendActions(): LegendActionDescriptor[] {
    return [...legendRegistry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * The provider a shell hands to `chart.renderer.setLegendActions` — resolves the row's
 * indicator on THAT chart, gates each descriptor, and binds `run` to a fresh context per
 * click (never a cached one; the widget context rule). Both shells wire exactly this.
 */
export function legendActionsProviderFor(chart: Vela, context: () => WidgetContext): (indicatorId: string) => LegendActionView[] {
    return (indicatorId) => {
        const handle = chart.indicators().find((h) => h.id === indicatorId);
        if (!handle) return [];
        const info: LegendIndicatorInfo = { id: handle.id, title: handle.title, ...(handle.source !== undefined ? { source: handle.source } : {}) };
        return legendActions()
            .filter((d) => !d.when || d.when(info))
            .map((d) => ({ id: d.id, icon: d.icon, tooltip: d.tooltip, run: () => d.run(context(), info) }));
    };
}

// ── Default scripting engines ──────────────────────────────────────────────────────

/** Makes ONE engine instance for ONE chart — engines hold per-chart sessions (and
 *  possibly a worker), so the shell calls the factory per chart build, never shares. */
export type EngineFactory = () => ScriptingEngine;

const defaultEngines = new Map<string, EngineFactory>();

/**
 * Register (or replace) a DEFAULT scripting engine for a language: every widget and
 * workspace cell built afterwards registers `make()` on its chart automatically — the
 * app-level wiring for hosts that pair Vela with an engine package, same shape as the
 * other contribution registries. A per-instance `engines` option still wins for the
 * same language, and the bare `Vela` chart is untouched: with nothing registered here,
 * nothing changes anywhere (there is still no bundled default engine).
 */
export function registerDefaultEngine(language: string, make: EngineFactory): () => void {
    defaultEngines.set(language, make);
    return () => {
        if (defaultEngines.get(language) === make) defaultEngines.delete(language);
    };
}

export function unregisterDefaultEngine(language: string): void {
    defaultEngines.delete(language);
}

/** The registered defaults merged UNDER `overrides` — per-instance factories win per
 *  language. The shell layers (widget, workspace cell) register exactly this result. */
export function resolveEngines(overrides?: Record<string, EngineFactory>): Record<string, EngineFactory> {
    return { ...Object.fromEntries(defaultEngines), ...overrides };
}
