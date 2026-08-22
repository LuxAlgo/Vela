// Widget CONTRIBUTIONS — the descriptor-based customization seam. Plugins (and host
// apps) contribute ACTIONS as data (never DOM): the widget projects them into its own
// chrome — topbar buttons, context-menu items — so any future view layer (React) can
// project the same descriptors. Register at import time, before widgets are constructed.
import type { Vela } from '../Vela';
import type { LegendActionView, LegendCalloutView } from '../core/ports/IChartRenderer';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { SymbolDescriptor } from '../core/ports/DataProvider';
import { TOPBAR_BUILTIN_IDS } from './topbar-composition';

/** The runtime surface an action's `when`/`run` receives. */
export interface WidgetContext {
    /** The CURRENT inner chart. Read it through this getter rather than capturing it:
     *  a shell may replace its chart instance, and a captured one would be destroyed.
     *  (Symbol and timeframe switches are applied IN PLACE — the instance survives them.) */
    chart: Vela;
    /** LIVE getters, like `chart` — they resolve the ACTIVE cell's market at every
     *  read, so an attachment that holds its mount context keeps reading the truth
     *  after a symbol/timeframe switch. Read them at the point of use; never copy
     *  them into long-lived state. */
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
    /** Add a SCRIPT indicator to the active chart THROUGH THE SHELL — unlike the raw
     *  `chart.addIndicator`, the addition enters the unified undo/redo timeline, the
     *  topbar indicator count, and the shell's bookkeeping. The entry's source rides the
     *  recorded action, so redo re-adds it even after the original handle died. The
     *  shell does NOT persist these across reloads (they are not manifest entries) —
     *  a plugin that wants them back owns that via {@link registerStatePersistence}. */
    addIndicator(entry: ExternalIndicatorEntry): void;
    /** Add a native (core-computed) indicator to the active chart through the shell —
     *  recorded in the undo/redo timeline, unlike the raw `chart.addNativeIndicator`. */
    addNativeIndicator(type: string): void;
    /** Tell the shell some PERSISTABLE third-party state changed (a debounced
     *  `state:changed` + storage write follows). Only needed for state with no shell
     *  event of its own — indicator adds/removals already trigger the save cycle. */
    stateChanged(): void;
}

/** What {@link WidgetContext.addIndicator} takes: a named script, ready to run. */
export interface ExternalIndicatorEntry {
    name: string;
    /** The script source (the recorded undo/redo action re-adds from it). */
    script: string;
    /** Engine language (default: the chart's default engine). */
    language?: string;
}

/** Where an action is projected. */
export type WidgetActionTarget = 'topbar' | 'context:body' | 'context:price-axis' | 'context:time-axis';

export interface WidgetActionDescriptor {
    /** Stable id — re-registering an id replaces it. */
    id: string;
    target: WidgetActionTarget;
    /** Always required, even icon-only: it is the button's aria-label and tooltip, the
     *  mobile drawer row's text, and the context-menu item's label. */
    label: string;
    /** Icon id from the `vela/ui` icon registry (register yours with `registerIcon`). */
    icon?: string;
    /** Topbar only: render the DESKTOP button icon-only, like the built-in tools — the
     *  `label` moves to the aria-label and a kit tooltip instead of button text (mobile
     *  surfaces keep their text). The right cluster gets the native 32px tool look; the
     *  left cluster keeps the primary chrome, minus the text. Requires `icon` — without
     *  one the flag is ignored (with a console warning) and the label renders. The piece
     *  that makes a `'screenshot'` slot override pixel-faithful to the native button. */
    iconOnly?: boolean;
    /** Sort key within the contributed group (ascending; default 0). */
    order?: number;
    /** Topbar only: which cluster the button joins. `'right'` (default) is the
     *  right-hand tools cluster; `'left'` puts it with the PRIMARY chrome buttons —
     *  right after the style/layout dropdowns, styled like them (the spot and look of
     *  the built-in Indicators button, for actions that replace it). */
    align?: 'left' | 'right';
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

/** The built-in topbar slots a contributed action may TAKE OVER by registering under
 *  their id — the "simple button" slots. The composites (symbol, timeframes, style,
 *  layout, undo-redo, alerts, panels) are stateful controls the shell pushes state
 *  into; a plain `{label, icon, run}` descriptor cannot stand in for them. */
export const OVERRIDABLE_TOPBAR_IDS = ['indicators', 'screenshot'] as const;

const overridableSet = new Set<string>(OVERRIDABLE_TOPBAR_IDS);
const builtinTopbarSet = new Set<string>(TOPBAR_BUILTIN_IDS);

/**
 * The action OVERRIDING a built-in topbar slot, if one is registered — an action whose
 * `id` IS the built-in id. An override takes the slot's WHOLE surface: the desktop
 * button (at the slot's position), the mobile counterpart, and the keyboard chord all
 * route to `run`, and the native machinery behind the slot (the built-in indicator
 * picker) is not constructed. Shells resolve this at construction — register at import
 * time, like every contribution.
 */
export function topbarActionOverride(id: string): WidgetActionDescriptor | undefined {
    if (!overridableSet.has(id)) return undefined;
    return registry.get(id);
}

/** Register (or replace) a widget action. Widgets read the registry live.
 *  Registering under a RESERVED built-in topbar id (`'indicators'`, `'screenshot'`)
 *  OVERRIDES that slot — see {@link topbarActionOverride}. Built-in ids that are
 *  stateful composites cannot be overridden and the registration is refused. */
export function registerWidgetAction(desc: WidgetActionDescriptor): () => void {
    if (builtinTopbarSet.has(desc.id) && !overridableSet.has(desc.id)) {
        console.warn(`[vela] widget action "${desc.id}": this built-in topbar slot is a stateful control and cannot be overridden — ignored. Overridable slots: ${OVERRIDABLE_TOPBAR_IDS.join(', ')}.`);
        return () => undefined;
    }
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

// ── Legend callouts ────────────────────────────────────────────────────────────────

/** One block of a legend callout's deployed panel, descriptor-side: plain text, or a
 *  button whose `run` receives the shell's {@link WidgetContext} and the row's
 *  indicator — the same signature as a legend action's `run`. */
export type LegendCalloutItem =
    | { type: 'text'; text: string }
    | {
          type: 'button';
          label: string;
          /** Emphasized (selection-colored) button — the panel's main action. */
          primary?: boolean;
          /** Close the panel after `run` (default true). */
          close?: boolean;
          run(ctx: WidgetContext, indicator: LegendIndicatorInfo): void;
      };

/** The panel a clickable callout deploys: an optional heading over ordered blocks. */
export interface LegendCalloutContent {
    title?: string;
    items: LegendCalloutItem[];
}

/** A callout's resolved presentation for one row — what {@link LegendCalloutDescriptor.callout} returns. */
export interface LegendCalloutSpec {
    /** Icon id from the `vela/ui` icon registry (register yours with `registerIcon`). */
    icon: string;
    /** Bubble fill — any CSS color (`color-mix` token washes match the built-in badges). */
    background: string;
    /** Icon ink (default: the legend row's text color). */
    color?: string;
    /** Hover text; also the bubble's accessible name. */
    tooltip: string;
    /** Deployed panel — presence makes the bubble clickable. */
    content?: LegendCalloutContent;
}

/**
 * A contributed LEGEND CALLOUT: a small tinted bubble with a centered icon, always
 * visible right of the indicator's legend title (trailing the whole row while its
 * hover controls are out). When the spec carries `content`, clicking the bubble
 * deploys that panel — below it, flipping above near the bottom screen edge.
 *
 * Unlike a legend action's static icon, a callout's whole presentation is resolved
 * per row through `callout` — return `null` to show none (the per-indicator gate),
 * or a spec whose icon/tint/panel follow your own state (a market-status bubble
 * changes dress as sessions roll). Late state changes re-project through the shells'
 * `refreshActions()`, like every contribution.
 */
export interface LegendCalloutDescriptor {
    /** Stable id — re-registering an id replaces it. */
    id: string;
    /** Sort key within the contributed group (ascending; default 0). */
    order?: number;
    /** Resolve the row's bubble — `null`/`undefined` shows none. */
    callout(indicator: LegendIndicatorInfo): LegendCalloutSpec | null | undefined;
}

const calloutRegistry = new Map<string, LegendCalloutDescriptor>();

/** Register (or replace) a legend callout. Returns an unregister disposer. */
export function registerLegendCallout(desc: LegendCalloutDescriptor): () => void {
    calloutRegistry.set(desc.id, desc);
    return () => {
        if (calloutRegistry.get(desc.id) === desc) calloutRegistry.delete(desc.id);
    };
}

export function unregisterLegendCallout(id: string): void {
    calloutRegistry.delete(id);
}

/** Every registered legend callout, `order`-sorted (registration order breaks ties). */
export function legendCallouts(): LegendCalloutDescriptor[] {
    return [...calloutRegistry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * The provider a shell hands to `chart.renderer.setLegendCallouts` — resolves the row's
 * indicator on THAT chart, lets each descriptor dress (or skip) the row, and binds every
 * panel button to a fresh context per click (never a cached one; the widget context
 * rule). Both shells wire exactly this, beside {@link legendActionsProviderFor}.
 */
export function legendCalloutsProviderFor(chart: Vela, context: () => WidgetContext): (indicatorId: string) => LegendCalloutView[] {
    return (indicatorId) => {
        const handle = chart.indicators().find((h) => h.id === indicatorId);
        if (!handle) return [];
        const info: LegendIndicatorInfo = { id: handle.id, title: handle.title, ...(handle.source !== undefined ? { source: handle.source } : {}) };
        const views: LegendCalloutView[] = [];
        for (const d of legendCallouts()) {
            const spec = d.callout(info);
            if (!spec) continue;
            views.push({
                id: d.id,
                icon: spec.icon,
                background: spec.background,
                ...(spec.color !== undefined ? { color: spec.color } : {}),
                tooltip: spec.tooltip,
                ...(spec.content !== undefined
                    ? {
                          content: {
                              ...(spec.content.title !== undefined ? { title: spec.content.title } : {}),
                              items: spec.content.items.map((item) =>
                                  item.type === 'text'
                                      ? item
                                      : {
                                            type: 'button' as const,
                                            label: item.label,
                                            ...(item.primary !== undefined ? { primary: item.primary } : {}),
                                            ...(item.close !== undefined ? { close: item.close } : {}),
                                            run: () => item.run(context(), info),
                                        },
                              ),
                          },
                      }
                    : {}),
            });
        }
        return views;
    };
}

// ── State persistence (the `ext` seam) ─────────────────────────────────────────────

/**
 * The surface a `scope: 'cell'` persistence handler works against — bound to ONE cell
 * (never the active one by proxy), because serialize/restore run per cell, including
 * cells that are not active. `addIndicator`/`addNativeIndicator` target THIS cell and
 * are ALWAYS muted — unlike their {@link WidgetContext} namesakes they never enter the
 * undo timeline, even from an async `restore` continuation (fetch, then add): applying
 * a document is state application, not a user edit.
 */
export interface CellStateContext {
    /** The cell's durable identity (`'c1'`, a declared name). */
    cellId: string;
    /** The cell's LIVE chart. */
    chart: Vela;
    /** Add a script indicator to THIS cell through the shell (see {@link WidgetContext.addIndicator}). */
    addIndicator(entry: ExternalIndicatorEntry): void;
    /** Add a native indicator to THIS cell through the shell. */
    addNativeIndicator(type: string): void;
}

/**
 * A third-party STATE PERSISTENCE handler — how a plugin puts its own state into the
 * shell's persisted document (the `ext` bag of `WorkspaceState` / per-chart state)
 * instead of running a parallel store. `key` is namespaced (`'vendor.feature'`) and
 * flat — one entry per handler. `serialize` runs on every shell snapshot (`getState`,
 * the persist write) and returns a JSON-serializable payload, or `undefined` for "no
 * entry". `restore` runs when a document carrying the key is applied (boot restore,
 * `applyState`) — AFTER the core state (chart alive, engines registered, indicator
 * ledger converged) and, for cell scope, inside the cell's history-mute, so nothing it
 * does enters undo/redo. The payload is UNTRUSTED (the codec passes `ext` through
 * opaquely): validate it. `restore` is only called for keys present in the document.
 *
 * Register at import time, before shells are constructed — the rule every contribution
 * registry shares. A key with no registered handler still round-trips verbatim, so a
 * session without the plugin never loses its state.
 */
export type StatePersistenceHandler =
    | {
          /** Namespaced entry key (`'velapro.indicators'`) — re-registering a key replaces it. */
          key: string;
          /** Where the entry lives: per chart (`charts[i].ext`) — follows the cell through pool/layout moves. */
          scope: 'cell';
          serialize(ctx: CellStateContext): unknown;
          restore(payload: unknown, ctx: CellStateContext): void;
      }
    | {
          key: string;
          /** Document root (`state.ext`) — one entry per document, whatever the grid. */
          scope: 'global';
          serialize(ctx: WidgetContext): unknown;
          restore(payload: unknown, ctx: WidgetContext): void;
      };

const stateHandlers = new Map<string, StatePersistenceHandler>();

/** Register (or replace) a state-persistence handler. Returns an unregister disposer. */
export function registerStatePersistence(handler: StatePersistenceHandler): () => void {
    stateHandlers.set(handler.key, handler);
    return () => {
        if (stateHandlers.get(handler.key) === handler) stateHandlers.delete(handler.key);
    };
}

export function unregisterStatePersistence(key: string): void {
    stateHandlers.delete(key);
}

/** The registered handlers of one scope (registration order). */
export function statePersistenceHandlers<S extends StatePersistenceHandler['scope']>(scope: S): Array<Extract<StatePersistenceHandler, { scope: S }>> {
    return [...stateHandlers.values()].filter((h): h is Extract<StatePersistenceHandler, { scope: S }> => h.scope === scope);
}

// ── Symbol ranking (the picker's display order) ────────────────────────────────────

/**
 * Reorder the symbol picker's AGGREGATED pool — every source combined, exactly what
 * the search dialog displays. Called when the pool changes (a provider's index lands
 * or refreshes), NOT per keystroke: the picker caches the result. May be async (a
 * server-fetched top list) — the picker shows the current order and refreshes when
 * the promise resolves.
 *
 * The returned list may INJECT descriptors absent from the pool (they must carry
 * their `provider` and be genuinely servable, or selecting them parks the load) and
 * may OMIT entries (hiding them). The picker dedupes by venue+ticker, FIRST
 * occurrence winning — injecting at the head fixes both position and display data.
 *
 * While a ranking is registered, the picker's built-in empty-query pin (the hardcoded
 * majors) stands down: the head of YOUR list is the dialog's opening screen. Under a
 * typed query the relevance tiers still lead — the ranking orders within each tier.
 */
export type SymbolRankingHook = (pool: SymbolDescriptor[]) => SymbolDescriptor[] | Promise<SymbolDescriptor[]>;

let symbolRankingHook: SymbolRankingHook | undefined;

/** Register (or replace — ONE ranking at a time, last wins) the symbol ranking.
 *  Returns an unregister disposer. Register at import time, like every contribution. */
export function registerSymbolRanking(hook: SymbolRankingHook): () => void {
    symbolRankingHook = hook;
    return () => {
        if (symbolRankingHook === hook) symbolRankingHook = undefined;
    };
}

/** The registered ranking, if any — what the shells' symbol picker consults. */
export function symbolRanking(): SymbolRankingHook | undefined {
    return symbolRankingHook;
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
