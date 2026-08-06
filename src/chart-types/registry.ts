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
    /**
     * What the renderer paints for the PRICE SERIES while this style is active.
     * `'candles'` (default) keeps the base candle painting under the type's layers;
     * `'none'` suppresses it — for types whose renderer layer fully REPLACES the
     * price representation (an order-flow grid, bricks, …). Axes, grid, volume,
     * indicators and drawings are unaffected.
     */
    basePainting?: 'candles' | 'none';
}

/**
 * A declarative visibility condition on another row's CURRENT value (stored value,
 * or that row's `defval` while unset). Pure data — the dialog evaluates it live as
 * the user edits, so dependent rows appear/disappear without a rebuild.
 * `anyOf` wins over `equals` when both are given.
 */
export interface SettingsRowCondition {
    key: string;
    equals?: boolean | string | number;
    anyOf?: readonly (boolean | string | number)[];
}

/** A row's visibility gate: one condition, or several AND-ed together. */
export type SettingsRowWhen = SettingsRowCondition | readonly SettingsRowCondition[];

/**
 * An inline color swatch on a toggle row — the color(s) the toggle governs, edited
 * right on the toggle's row (dimmed while the toggle is off) instead of a
 * conditionally revealed row below. Each swatch stores under its own bag key.
 */
export interface SettingsRowSwatch {
    key: string;
    /** Names the color for the swatch's tooltip (`'Highlight color'`). */
    label: string;
    defval: string;
}

/**
 * One declarative settings row. To add a NEW kind, see docs/architecture/settings-rows.md.
 *
 * `heading` titles a GROUP of rows: the heading plus everything after it up to the next
 * heading. In a flat `rows` section headings render as inline group titles; inside
 * `instances`/`subsections` they become entries of the pane's group TOC (see
 * {@link ChartTypeSettingsSection}). Any row may carry `when` — it is shown only while
 * the condition holds.
 *
 * `range` is a min–max pair on one row (two number inputs storing under `minKey` /
 * `maxKey`, both seeded from the shared `defval`). When `placeholder` is given, an
 * input holding the default value renders EMPTY showing the placeholder, and clearing
 * an input stores the default back — so the placeholder names the "unset" state
 * (`'Off'` for a 0-disables filter bound).
 */
/**
 * A select option: a bare string (value = label) or a `[value, label]` pair when the
 * stored id differs from the human-readable text (`['bidAskProfile', 'Bid × Ask Profile']`).
 */
export type SettingsSelectOption = string | readonly [value: string, label: string];

export type SettingsRowDescriptor =
    | { kind: 'heading'; label: string; when?: SettingsRowWhen }
    | { kind: 'toggle'; key: string; label: string; defval: boolean; colors?: readonly SettingsRowSwatch[]; when?: SettingsRowWhen }
    | { kind: 'number'; key: string; label: string; defval: number; min?: number; max?: number; step?: number; when?: SettingsRowWhen }
    | { kind: 'color'; key: string; label: string; defval: string; when?: SettingsRowWhen }
    | { kind: 'select'; key: string; label: string; options: readonly SettingsSelectOption[]; defval: string; when?: SettingsRowWhen }
    | { kind: 'range'; label: string; minKey: string; maxKey: string; defval: number; min?: number; max?: number; step?: number; placeholder?: string; when?: SettingsRowWhen };

/** Whether a row's `when` gate passes against the current values bag. */
export function settingsRowVisible(when: SettingsRowWhen | undefined, bag: Record<string, unknown>): boolean {
    if (!when) return true;
    const conds: readonly SettingsRowCondition[] = Array.isArray(when) ? when : [when as SettingsRowCondition];
    return conds.every((c) => (c.anyOf ? c.anyOf.some((x) => x === bag[c.key]) : bag[c.key] === c.equals));
}

/**
 * One tab of a section's INSTANCE STRIP — a repeated block of settings (e.g. one of
 * several overlays a style can paint). The dialog shows a tab per PRESENT instance,
 * a dashed `+` that turns on the next absent one, and an `×` on the active removable
 * tab that turns it off. Presence is the boolean at `enableKey` (stored in the same
 * per-type bag as every other value); an instance without `enableKey` is always
 * present and not removable — the base instance.
 */
export interface ChartTypeSettingsInstance {
    label: string;
    /** Boolean bag key controlling presence; omitted = always present, not removable. */
    enableKey?: string;
    rows: readonly SettingsRowDescriptor[];
}

/** An indented sub-entry under the section's rail tab, with its own pane of rows. */
export interface ChartTypeSettingsSubsection {
    title: string;
    rows: readonly SettingsRowDescriptor[];
    /**
     * Boolean bag key that masters this pane. While it is false, every row EXCEPT the
     * one whose `key` matches stays visible but grayed out (not hidden) — so users can
     * still browse and preview settings with the feature off. The matching toggle is
     * typically the first row of the Display group.
     */
    enableKey?: string;
}

/**
 * A chart type's settings tab. Two forms:
 *
 * - **Flat**: `rows` only — rendered as one scrollable pane, `heading` rows as inline
 *   group titles (the historical form).
 * - **Structured**: `instances` (and optionally `subsections`) — the pane opens with an
 *   instance TAB STRIP, and each instance's rows are organized by a GROUP TOC on the
 *   left built from its `heading` rows (rows before the first heading always show above
 *   the groups; selecting a TOC entry shows only that group's rows). `subsections` add
 *   indented rail entries under the section's tab, each a pane with the same TOC
 *   treatment. A TOC entry hides itself while every row of its group is hidden by
 *   `when` gates.
 *
 * All values — every instance and subsection included — live in the ONE per-type bag
 * (`config.chartTypes[<id>]`), so consumers keep receiving a single flat object.
 */
export interface ChartTypeSettingsSection {
    /** Section heading in the settings dialog. */
    title: string;
    /** Flat form. Ignored when `instances` is declared. */
    rows?: readonly SettingsRowDescriptor[];
    /** Structured form: the pane's instance tab strip. */
    instances?: readonly ChartTypeSettingsInstance[];
    /** Indented sub-entries under this section's rail tab. */
    subsections?: readonly ChartTypeSettingsSubsection[];
    /** `'active'` (default): shown only while this chart type is the active price style;
     *  `'always'`: shown whenever the type is registered. */
    visibility?: 'always' | 'active';
    /** Rail position: `'end'` (default, after the built-in tabs) or `'after-symbol'`
     *  (directly under the Symbol tab). Subsections follow their parent. */
    placement?: 'after-symbol' | 'end';
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
