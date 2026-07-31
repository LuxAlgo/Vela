import type { OHLCV } from '../model/ohlcv';
import type { Pane } from '../model/scene';
import type { IndicatorModel } from '../model/indicator';
import type { ScenePatch } from '../model/patch';
import type { InputValue, SymbolPickerFn } from '../model/inputs';
import type { Millis } from '../model/time';
import type { VelaTheme, MoveTarget, PriceStyle } from '../options';
import type { Unsubscribe } from '../util/types';
import type { IDrawingsRendererPort } from '../drawings/port';

/** What a rendering backend supports — drives graceful degradation + warnings. */
export interface RendererCapabilities {
    panes: boolean;
    /**
     * Full pane management: moving/merging an indicator between panes (with its own
     * scale column), reordering panes, and pane collapse/maximize. A renderer without
     * it keeps one-pane-per-indicator behavior; `chart.panes` mutations warn + no-op.
     */
    paneManagement: boolean;
    fills: 'native' | 'primitive' | 'unsupported';
    bgcolor: 'native' | 'primitive' | 'unsupported';
    hline: 'native' | 'primitive' | 'unsupported';
    markers: boolean;
    barcolor: 'native' | 'approximated' | 'unsupported';
    perPointColor: boolean;
    /** Pine drawing objects (line/box/label/polyline/linefill) via custom primitives. */
    drawings: boolean;
    /** Interactive USER drawing tools (toolbar + hit-test + handles). Distinct from `drawings`. */
    userDrawings: boolean;
    /** Whether user drawings share ONE draw-order space with the pane's series — a drawing's
     *  `zIndex` then places it anywhere in the stack: over everything, under the candles, or
     *  between two indicators. Absent/false: every drawing paints in front, `zIndex` orders
     *  only the drawings among themselves, and a host UI should not offer depth slots. */
    drawingDepth?: boolean;
    /** Pine `table.new` dashboards via a DOM overlay. */
    tables: boolean;
    /** Whether the renderer provides the in-chart inputs/settings UI. */
    inputsUI: boolean;
}

/** Opaque handle to a mounted indicator, returned by `mountIndicator()`. */
export interface IndicatorRenderHandle {
    readonly id: string;
}

/** An indicator's live status, shown in its legend row. */
export type IndicatorStatus = 'idle' | 'loading' | 'live';

/** OHLCV of the price bar under the crosshair (the "data window" source). */
export interface CrosshairOHLC {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export interface CrosshairEvent {
    time: Millis | null;
    price: number | null;
    /** Value at the crosshair per series, keyed by stable series id. */
    values: ReadonlyMap<string, number>;
    /** The hovered price bar's OHLCV (null when the cursor is off any bar). */
    ohlc: CrosshairOHLC | null;
}

export interface ClickEvent {
    time: Millis | null;
    price: number | null;
}

/** One indicator plot's readout line in the data window. */
export interface DataWindowRow {
    label: string;
    value: string;
    color: string;
}

/** The OHLCV block of a data-window readout, formatted on the price pane's scale. */
export interface DataWindowOHLC {
    o: string;
    h: string;
    l: string;
    c: string;
    vol?: string;
    /** Close ≥ open → tint the values with the up color, else the down color. */
    up: boolean;
}

/** One indicator's readout: its title plus a row per plot. */
export interface DataWindowGroup {
    name: string;
    rows: DataWindowRow[];
}

/**
 * A data-window snapshot — the bar's timestamp split into date + time, its OHLCV, and one
 * group per indicator. Every value arrives pre-formatted on the scale of the pane it belongs
 * to, so a host panel lays the readout out without doing any numeric formatting itself.
 */
export interface DataWindowReadout {
    /** Bar date, pre-formatted (e.g. `2026-07-03`); empty when there is no bar. */
    date: string;
    /** Bar time of day, pre-formatted `HH:MM`; empty when there is no bar. */
    time: string;
    ohlc: DataWindowOHLC | null;
    groups: DataWindowGroup[];
}

/** Raised by the renderer when the user edits an input in the settings dialog. */
export interface InputChangeEvent {
    indicatorId: string;
    key: string;
    value: InputValue;
}

export interface VisibleRange {
    from: Millis;
    to: Millis;
}

/** A user-initiated pane action reported by the renderer (hover buttons / double-clicks). */
export type PaneAction =
    | { type: 'move'; paneId: string; dir: 'up' | 'down' }
    | { type: 'remove'; paneId: string }
    | { type: 'collapse'; paneId: string; collapsed: boolean }
    | { type: 'maximize'; paneId: string; maximized: boolean };

/**
 * The rendering backend abstraction. No backend (e.g. lightweight-charts) types
 * cross this boundary — that is what makes the renderer swappable. The only MVP
 * implementation is `src/renderers/lightweight-charts/LwcRenderer.ts`.
 */
export interface IChartRenderer {
    readonly capabilities: RendererCapabilities;

    /** Stable identity of this renderer (e.g. `'native'`, `'lwc'`) — the warn label and `chart.renderer.name`. */
    readonly name: string;
    /** Feature keys this renderer can get/set at runtime via `chart.renderer.set` / `.get`. */
    readonly features: readonly string[];
    /** Apply a supported feature live (the caller has already checked `features`); repaints as needed. */
    applyFeature(key: string, value: unknown): void;
    /** Read a feature's current value (`undefined` if unsupported). */
    readFeature(key: string): unknown;

    mount(container: HTMLElement, theme: VelaTheme): void;
    setTheme(theme: VelaTheme): void;
    resize(): void;
    destroy(): void;

    /**
     * Replace all price bars. By default re-frames the view (a fresh series). Pass
     * `{ preserveView: true }` to keep the current viewport — used when extending the
     * same series in place (e.g. swapping a quick preview for the full history) so
     * candles don't jump.
     */
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void;
    /** Append a new bar or replace the forming (last) bar, decided by time. */
    updateBar(bar: OHLCV): void;

    /**
     * Set the active symbol's tick size (e.g. `0.01`) so the price axis renders the
     * instrument's true precision. Passed as soon as symbol metadata resolves; `undefined`
     * (or absent) ⇒ the renderer falls back to its zoom-derived decimals. Optional.
     */
    setPricePrecision?(mintick: number | undefined): void;

    /**
     * Push a bespoke NATIVE-LAYER render payload, keyed by layer `type`. Visuals that aren't
     * ordinary series/fills draw through a dedicated renderer layer instead of the model; this is
     * the channel. Producers are native indicators (`'volume'`, `'vpvr'` — layer config) and core
     * data engines behind a price style (a plugin chart type pushing per-bar secondary data
     * through its own channel). Optional: a renderer without the
     * layers omits it.
     */
    setNativeData?(type: string, data: unknown): void;

    /**
     * Reflect an indicator's live status in its legend row: `'loading'` (a fetch is in flight —
     * spinner), `'live'` (live-updating — a distinct pulse), or `'idle'` (nothing). Optional.
     */
    setIndicatorStatus?(handle: IndicatorRenderHandle, status: IndicatorStatus): void;

    ensurePane(pane: Pane): void;
    removePane(id: string): void;

    /**
     * Move a mounted indicator to another pane (merge/unmerge). `ownScale` gives the
     * indicator its own scale column within the target pane, rescaled so its visible
     * extent lines up with the pane's; omitted/false shares the pane scale. Present iff
     * `capabilities.paneManagement`.
     */
    setIndicatorPane?(handle: IndicatorRenderHandle, paneId: string, opts?: { ownScale?: boolean }): void;
    /** Set the top-to-bottom pane display order (an array of pane ids). */
    orderPanes?(orderedIds: string[]): void;
    /** Collapse a pane to a thin strip (legend + expand button) or restore it. */
    setPaneCollapsed?(paneId: string, collapsed: boolean): void;
    /** Maximize one pane to fill the plot, or restore the previous split (`null`). */
    setPaneMaximized?(paneId: string | null): void;
    /**
     * The renderer reports a user-initiated pane action (from a pane hover button or a
     * double-click). The host/core reflects it: `'remove'` tears down the pane's
     * indicators; the rest are already applied by the renderer and just keep core's
     * `chart.panes` view in sync. Present iff `capabilities.paneManagement`.
     */
    onPaneAction?(cb: (action: PaneAction) => void): Unsubscribe;
    /**
     * The renderer reports a user request to move/merge an indicator to another pane, made
     * from its own in-chart UI (the legend "Move to" menu or a legend-row drag). Core routes
     * it through `moveIndicator`. Present iff `capabilities.paneManagement`.
     */
    onMoveIndicator?(cb: (id: string, target: MoveTarget) => void): Unsubscribe;

    /** Mount an indicator's series + its in-chart legend/settings UI. */
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle;
    updateIndicator(handle: IndicatorRenderHandle, patch: ScenePatch): void;
    removeIndicator(handle: IndicatorRenderHandle): void;
    /** Reflect a programmatic input change in the renderer's settings UI. */
    setIndicatorInputs(handle: IndicatorRenderHandle, values: Record<string, InputValue>): void;

    /**
     * Supply a symbol picker so the settings dialog's `input.symbol` control opens the host's own
     * ticker-selection UI (the host wires this). Optional — without it, `input.symbol` is a plain
     * text field. Pass `null` to detach.
     */
    setSymbolPicker?(picker: SymbolPickerFn | null): void;

    /**
     * Hide (`false`) or show (`true`) a mounted indicator's visuals while keeping its legend row
     * (marked hidden). Optional — a renderer that can't suppress an indicator omits it (and the
     * core's hide still works for resource suspension; only the in-chart legend eye is unavailable).
     * On show the core re-mounts the indicator, so this need only drop the visuals + flag the row.
     */
    setIndicatorVisible?(handle: IndicatorRenderHandle, visible: boolean): void;

    /**
     * The renderer tells core when the base price style changes — from ANY source (the
     * `priceStyle` feature, the in-chart settings dialog, an applied config template).
     * Display state stays renderer-owned; the core listens because some styles carry a
     * DATA requirement (a plugin style may need its data engine running). Optional —
     * a renderer without runtime style switching omits it.
     */
    onPriceStyleChange?(cb: (style: PriceStyle) => void): Unsubscribe;

    /** The renderer tells core when the user edits an input in-chart. */
    onInputChange(cb: (e: InputChangeEvent) => void): Unsubscribe;
    /** The renderer tells core when the user removes an indicator in-chart (the legend ✕). */
    onRemoveIndicator(cb: (id: string) => void): Unsubscribe;
    /** The renderer tells core when the user toggles an indicator's visibility in-chart (the legend eye). */
    onToggleIndicatorVisible?(cb: (id: string, visible: boolean) => void): Unsubscribe;
    onCrosshairMove(cb: (e: CrosshairEvent) => void): Unsubscribe;
    onClick(cb: (e: ClickEvent) => void): Unsubscribe;

    /**
     * Display an EXTERNAL crosshair at a data-space position — a ghost marker driven by
     * another chart (multi-chart crosshair sync), not by this chart's own pointer.
     * `time` is epoch-ms (`null` clears); `price` optionally adds the horizontal line
     * when the caller knows the scales are comparable (same-symbol groups). The ghost
     * must NEVER re-emit `onCrosshairMove` — that one-way rule is what makes the sync
     * loop-free. OPTIONAL — detect by presence (`RendererControl.supportsExternalCrosshair`);
     * a renderer without the seam simply never shows foreign crosshairs.
     */
    setExternalCrosshair?(time: Millis | null, price?: number | null): void;

    /**
     * A pre-formatted readout of the bar under the crosshair — or of the latest bar when the
     * cursor is off the plot, so the snapshot is always useful. Pull it on crosshair movement
     * to drive a host data-window panel. Optional: a renderer that tracks no hovered bar omits
     * it (`RendererControl.dataWindowReadout()` then returns null).
     */
    getDataWindowReadout?(): DataWindowReadout;

    getVisibleRange(): VisibleRange | null;
    setVisibleRange(range: VisibleRange): void;
    /**
     * Pan by a fraction of the visible width at constant zoom (positive ⇒ toward the
     * latest bars), behaving exactly like a pointer drag: same pan limits (including the
     * bounded whitespace past the newest bar), eased if the renderer animates pans.
     * OPTIONAL — without it the core falls back to an instant `setVisibleRange` shift.
     */
    panBy?(fraction: number): void;
    onViewportChange(cb: (range: VisibleRange) => void): Unsubscribe;

    /**
     * Export the current chart as a PNG data URL (optional — a renderer that can't
     * rasterize its surface omits it). DOM overlays may not be included.
     */
    screenshot?(): string | null;

    /**
     * Snapshot the renderer's full cosmetic configuration as a serializable,
     * versioned document — for persistence (templates, saved user settings).
     * Optional: a renderer without a rich config omits it. The returned value is
     * plain JSON; its concrete shape is renderer-defined.
     */
    getConfig?(): unknown;
    /**
     * Apply a (possibly partial) config document produced by `getConfig()`.
     * Implementations validate untrusted input and ignore unknown/malformed fields,
     * repainting with no indicator re-run.
     */
    applyConfig?(config: unknown): void;

    /**
     * Move keyboard focus onto the chart's interactive surface (the element its keyboard
     * shortcuts key off). Optional — a host UI calls it after its own controls steal focus
     * (e.g. a shared workspace toolbar click) so chart/drawing keys keep working.
     */
    focus?(): void;

    /**
     * Close any in-chart dialogs the renderer owns (the indicator settings dialog, the
     * chart-settings gear dialog). Optional — used by a host to keep its own dialogs mutually
     * exclusive with the renderer's. A no-op when nothing is open.
     */
    closeDialogs?(): void;
    /**
     * Open (or toggle) the renderer's own settings dialog, when it has one. `section` names
     * the tab to land on (matched against the dialog's section titles, unknown ones ignored);
     * with a section an already-open dialog switches tab rather than closing.
     */
    openSettingsDialog?(section?: string): void;
    /** A chart type's SDK settings changed (dialog edit / applyConfig) — the core forwards
     *  them to the type's data engine. */
    onChartTypeSettingsChange?(cb: (typeId: string, values: Record<string, unknown>) => void): Unsubscribe;
    /** Host-app settings tabs (callback rows) shown by the renderer's settings dialog. */
    setSettingsSections?(sections: ReadonlyArray<{ title: string; rows: readonly unknown[] }>): void;

    /**
     * Interactive user-drawings surface. Present iff `capabilities.userDrawings`.
     * The core `DrawingController` drives it (commands down) and listens for
     * intents (up); a renderer without drawing tools simply omits it.
     */
    readonly userDrawingsPort?: IDrawingsRendererPort;
}
