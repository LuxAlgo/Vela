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
 * A contributed SIDE PANEL — a docked column in the shell's panel dock, alongside the object
 * tree and the data window, with a toggle button in the topbar's panel group.
 *
 * The shell owns the chrome (header, close button, dock exclusivity, the button and its pressed
 * state) and hands `mount` the panel's BODY element to fill; the contribution never reaches into
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
    mount(ctx: WidgetContext, body: HTMLElement): SidePanelHandle | void;
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
