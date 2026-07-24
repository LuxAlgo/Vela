// The CHART-TYPE registry — the public extension seam for price styles beyond the built-in
// five (candles, bars, line, area, baseline). A chart type may contribute:
//   - a BAR TRANSFORM: a 1:1 time-preserving view over the raw bar stream (Heikin Ashi);
//   - a DATA ENGINE: a per-chart engine that supplies the style's secondary per-bar data
//     to the renderer's native-layer channels (started/suspended as the style is
//     entered/left — the seam an order-flow style plugs into);
//   - an extended-ticker MODIFIER: `"SYM;id"` requests the transformed series from the
//     data plane (`ticker.<id>()` in scripts).
// Registration is global and idempotent-by-id (last registration wins) — plugins register
// once at import time, before or after charts are constructed.
import type { OHLCV } from '../core/model/ohlcv';
import type { BarTransform } from '../core/price-styles/BarTransform';
import type { DataControl } from '../core/DataControl';

/** The environment a chart hands to a style's data engine when the style activates. */
export interface SeriesDataEngineHost {
    /** The chart's symbol (as configured, provider prefix stripped by the data layer). */
    symbol: string;
    /** The chart's timeframe (canonical string, e.g. `'60'`). */
    timeframe: string;
    /** Whether the chart runs live (streaming forming bar) or static history. */
    live: boolean;
    /** The chart's CURRENT view bars (post-transform) — read fresh, never cache. */
    bars: () => readonly OHLCV[];
    /** The chart's data control surface (`chart.data`) — providers, capabilities, resolution. */
    data: DataControl;
    /** Push the style's per-bar layer data to the renderer (the `<id>` native channel). */
    pushData: (data: unknown) => void;
    /** Push the ranges still loading (the `<id>-pending` channel — skeleton/reveal UIs). */
    pushPending: (ranges: ReadonlyArray<readonly [number, number]>) => void;
}

/**
 * A per-chart data engine behind a chart type: created on first entry into the style,
 * suspended/resumed as the user switches styles, stopped when the chart is destroyed.
 * All methods are fire-and-forget from the chart's point of view — the engine owns its
 * own scheduling and pushes results through the host channels.
 */
export interface SeriesDataEngine {
    start(host: SeriesDataEngineHost): void;
    /** The style was left — stop fetching/pushing, keep state for a cheap resume. */
    suspend(): void;
    /** The style was re-entered. */
    resume(): void;
    /** The chart is going away — release everything. */
    stop(): void;
    /** The visible range changed (pan/zoom) while the style is active. */
    onViewport?(range: { from: number; to: number }): void;
    /** New settings values from the chart-settings dialog (the type's SDK section). */
    onSettings?(values: Record<string, unknown>): void;
}

/** One registered chart type. */
export interface ChartTypeDefinition {
    /** The price-style id (`'heikinashi'`; a plugin might register `'footprint'`, `'renko'`…). */
    id: string;
    /** Human-readable label for style pickers. Defaults to the id. */
    label?: string;
    /** Raw `<svg>` markup for style pickers (surfaced as icon id `style-<id>`). */
    icon?: string;
    /** Optional SETTINGS SECTION rendered inside the chart-settings dialog — declarative
     *  rows (never DOM). Values persist in the renderer config under `chartTypes.<id>`
     *  and are pushed to the type's `<id>-settings` native-data channel on change. */
    settings?: ChartTypeSettingsSection;
    /** View-bar transform applied at the chart's outbound bar seam (1:1, time-preserving). */
    barTransform?: BarTransform;
    /**
     * Whether the type participates in extended tickers (`"SYM;id"` — scripts request the
     * transformed series via `ticker.*`). Defaults to `true` when `barTransform` is set:
     * a transform-based type is exactly what the data plane can re-derive server-side.
     */
    tickerModifier?: boolean;
    /** Factory for the style's per-chart data engine (created lazily on first activation). */
    dataEngine?: () => SeriesDataEngine;
}

/** One declarative settings row. To add a NEW kind, see docs/architecture/settings-rows.md. */
export type SettingsRowDescriptor =
    | { kind: 'toggle'; key: string; label: string; defval: boolean }
    | { kind: 'number'; key: string; label: string; defval: number; min?: number; max?: number; step?: number }
    | { kind: 'color'; key: string; label: string; defval: string }
    | { kind: 'select'; key: string; label: string; options: readonly string[]; defval: string };

export interface ChartTypeSettingsSection {
    /** Section heading in the settings dialog. */
    title: string;
    rows: readonly SettingsRowDescriptor[];
    /** `'active'` (default): shown only while this chart type is the active price style;
     *  `'always'`: shown whenever the type is registered. */
    visibility?: 'always' | 'active';
}

const registry = new Map<string, ChartTypeDefinition>();

/** Register (or replace) a chart type. */
export function registerChartType(def: ChartTypeDefinition): void {
    registry.set(def.id, def);
}

/** Remove a registered chart type (built-ins can be re-registered via their register fn). */
export function unregisterChartType(id: string): void {
    registry.delete(id);
}

/** The definition behind a price-style id, or undefined for built-ins/unknown ids. */
export function chartType(id: unknown): ChartTypeDefinition | undefined {
    return typeof id === 'string' ? registry.get(id) : undefined;
}

/** Every registered chart type (registration order). */
export function chartTypes(): ChartTypeDefinition[] {
    return [...registry.values()];
}

/** Ids that act as extended-ticker modifiers (`"SYM;id"`). */
export function tickerModifierIds(): string[] {
    return [...registry.values()].filter((d) => d.tickerModifier ?? d.barTransform != null).map((d) => d.id);
}
