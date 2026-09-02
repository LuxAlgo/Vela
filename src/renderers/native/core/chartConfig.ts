import type { LineStyle } from '../../../core/model/series';
import { chartTypes, settingsRowValueKeys, type SettingsRowDescriptor } from '../../../chart-types/registry';
import { withAlpha } from '../../../core/color';
import { ACCENT, BEARISH, BULLISH, CHIP_PLATE, CROSSHAIR, SERIES_LINE, WARNING } from '../../../core/palette';
import type { PriceStyle } from '../../../core/options';
import type { ScaleMode } from './SceneGraph';

/**
 * Comprehensive, **serializable** native-renderer style/config (item 15).
 *
 * Two shapes live here:
 *  - `ChartStyle` — the renderer's LIVE store of the granular cosmetic knobs that
 *    were previously hard-coded or theme-derived (grid colors, crosshair, candle
 *    border/wick, fonts, separators). A `null` color means "inherit from the theme".
 *  - `ChartConfig` — the FLAT, versioned JSON the user persists / templates with.
 *    It aggregates the theme cosmetics + the scene's display flags + `ChartStyle`
 *    into one self-contained document (`getConfig()` resolves every inherited value
 *    to a concrete one so an exported template stands alone).
 *
 * `mergeConfig` is the single validating reducer: it deep-merges an untrusted
 * partial config onto a known-good base, dropping any malformed field. This keeps
 * `applyConfig(json)` total — it never throws on bad input and never half-applies.
 */
export const CHART_CONFIG_VERSION = 1;

/**
 * Baseline style defaults — the baseline chart type owns its palette and does NOT
 * follow the candle up/down colors. Above-baseline draws in `BASELINE_TOP_LINE`,
 * below-baseline in `BASELINE_BOTTOM_LINE`. Each area is a two-stop gradient of the
 * line color: a stronger `BASELINE_FILL_ALPHA` wash near the line fading to a fainter
 * `BASELINE_FILL_ALPHA_FAR` (still visible, not fully clear) at the baseline.
 * `BASELINE_LEVEL_DEFAULT` places the baseline as a percentage of the visible pane
 * range (0 = pane low, 100 = pane high).
 */
export const BASELINE_TOP_LINE = BULLISH;
export const BASELINE_BOTTOM_LINE = BEARISH;
export const BASELINE_FILL_ALPHA = 0.25;
export const BASELINE_FILL_ALPHA_FAR = 0.05;
export const BASELINE_LEVEL_DEFAULT = 50;

export { withAlpha } from '../../../core/color';

// ── live style store (renderer-owned; null color ⇒ inherit theme) ──
export interface GridLineStyle {
    visible: boolean;
    /** `null` ⇒ inherit `theme.gridColor`. */
    color: string | null;
}

export interface CrosshairStyle {
    /** `null` ⇒ inherit `theme.textColor`. */
    color: string | null;
    width: number;
    style: LineStyle;
    /** Line opacity (0–1); reference charting crosshairs are translucent. */
    opacity: number;
    /** Axis-chip background; `null` ⇒ inherit `theme.textColor`. */
    labelBackground: string | null;
}

export interface CandleStyle {
    /** Whether the filled candle body is drawn (off ⇒ wicks/borders only). */
    bodyVisible: boolean;
    borderVisible: boolean;
    /** `null` ⇒ inherit the body color. */
    borderUpColor: string | null;
    borderDownColor: string | null;
    wickVisible: boolean;
    wickUpColor: string | null;
    wickDownColor: string | null;
}

/**
 * Per-price-style cosmetics — each chart type carries its OWN colors and does NOT
 * inherit from another style. A `null` color is the style's "use the chart's
 * up/down default" sentinel (so an untouched style still matches the candle palette
 * and the prior rendering); set it and that style becomes independent. The candle
 * BODY colors stay the renderer's `upColor`/`downColor` (the `candles` block adds
 * border/wick on top); these four blocks cover the non-candle styles.
 */
export interface BarsStyle {
    /** `null` ⇒ inherit the chart up color. */
    upColor: string | null;
    /** `null` ⇒ inherit the chart down color. */
    downColor: string | null;
}

export interface LineSeriesStyle {
    /** `null` ⇒ inherit the chart up color. */
    color: string | null;
    width: number;
}

export interface AreaSeriesStyle {
    /** `null` ⇒ inherit the chart up color. */
    lineColor: string | null;
    width: number;
    /** Gradient top (near the line); `null` ⇒ the resolved line color. */
    topColor: string | null;
    /** Gradient bottom (at the baseline); `null` ⇒ transparent. */
    bottomColor: string | null;
}

export interface BaselineSeriesStyle {
    /** `null` ⇒ the baseline up default (`BASELINE_TOP_LINE`). */
    topLineColor: string | null;
    /** `null` ⇒ the baseline down default (`BASELINE_BOTTOM_LINE`). */
    bottomLineColor: string | null;
    /** Top area fill near the up line; `null` ⇒ a wash of the top line color at `BASELINE_FILL_ALPHA`. */
    topFillColor: string | null;
    /** Top area fill near the baseline (the lower end of the top area); `null` ⇒ a fainter
     *  wash of the top line color at `BASELINE_FILL_ALPHA_FAR`. */
    topFillColor2: string | null;
    /** Bottom area fill near the down line; `null` ⇒ a wash of the bottom line color at `BASELINE_FILL_ALPHA`. */
    bottomFillColor: string | null;
    /** Bottom area fill near the baseline (the upper end of the bottom area); `null` ⇒ a fainter
     *  wash of the bottom line color at `BASELINE_FILL_ALPHA_FAR`. */
    bottomFillColor2: string | null;
    width: number;
    /** Baseline position as a percent of the visible pane price range (0 = low, 100 = high). */
    baselineLevel: number;
}

/** Session-zone shading (the `sessionZones` feature): the washes painted over
 *  pre-market and post-market time bands on day-split tapes, and the single
 *  extended-hours band on overnight roll tapes. Alpha belongs in the
 *  color itself. */
export interface SessionShadeStyle {
    premarketColor: string;
    postmarketColor: string;
    extendedColor: string;
}

/** Default session washes — faint enough to sit behind candles and gridlines. The
 *  extended-hours wash (overnight roll tapes) defaults to the after-hours blue. */
export const PREMARKET_SHADE = withAlpha(WARNING, 0.08);
export const POSTMARKET_SHADE = withAlpha(ACCENT, 0.08);
export const EXTENDED_SHADE = POSTMARKET_SHADE;

export interface ChartStyle {
    /** Per-chart-type settings (plugin SDK sections), keyed by type id then row key. */
    chartTypes: Record<string, Record<string, unknown>>;
    /** Axis/label font size in CSS px (the family stays on the theme). */
    fontSize: number;
    gridVert: GridLineStyle;
    gridHorz: GridLineStyle;
    /** Axis frame lines (the right price-axis border); `null` ⇒ inherit `theme.borderColor`. */
    borderColor: string | null;
    /** The draggable line between stacked panes; `null` ⇒ inherit `theme.borderColor`. */
    separatorColor: string | null;
    crosshair: CrosshairStyle;
    candle: CandleStyle;
    bars: BarsStyle;
    line: LineSeriesStyle;
    area: AreaSeriesStyle;
    baseline: BaselineSeriesStyle;
    sessions: SessionShadeStyle;
}

/** A fresh live style store with every value at its "inherit / current behavior" default. */
export function defaultChartStyle(): ChartStyle {
    return {
        chartTypes: {},
        fontSize: 11,
        gridVert: { visible: true, color: null },
        gridHorz: { visible: true, color: null },
        borderColor: null,
        separatorColor: null,
        crosshair: { color: CROSSHAIR, width: 1, style: 'dashed', opacity: 0.4, labelBackground: CHIP_PLATE },
        candle: {
            bodyVisible: true,
            borderVisible: false,
            borderUpColor: null,
            borderDownColor: null,
            wickVisible: true,
            wickUpColor: null,
            wickDownColor: null,
        },
        bars: { upColor: null, downColor: null },
        line: { color: SERIES_LINE, width: 2 },
        area: { lineColor: SERIES_LINE, width: 2, topColor: withAlpha(SERIES_LINE, 0.28), bottomColor: withAlpha(SERIES_LINE, 0.02) },
        baseline: {
            topLineColor: null,
            bottomLineColor: null,
            topFillColor: null,
            topFillColor2: null,
            bottomFillColor: null,
            bottomFillColor2: null,
            width: 2,
            baselineLevel: BASELINE_LEVEL_DEFAULT,
        },
        sessions: { premarketColor: PREMARKET_SHADE, postmarketColor: POSTMARKET_SHADE, extendedColor: EXTENDED_SHADE },
    };
}

// ── serialized config document (persistence / templating) ──
export interface ChartConfig {
    version: number;
    layout: {
        background: string;
        textColor: string;
        fontFamily: string;
        fontSize: number;
    };
    grid: {
        vertLines: { visible: boolean; color: string };
        horzLines: { visible: boolean; color: string };
    };
    crosshair: {
        color: string;
        width: number;
        style: LineStyle;
        opacity: number;
        labelBackground: string;
    };
    priceScale: {
        mode: ScaleMode;
        log: boolean;
        /** Inverted price axis (high at the bottom). */
        invert: boolean;
        borderColor: string;
        labelsVisible: boolean;
        currentPriceLine: boolean;
        priceLabel: boolean;
        countdown: boolean;
    };
    /** Stacked-pane chrome — the draggable line between an indicator's pane and the one above it. */
    panes: {
        separatorColor: string;
    };
    /** Strategy trade markers (the `tradeMarkers` feature): the order-fill units on the price pane. */
    trades: {
        visible: boolean;
        /** The order-id/comment text line. */
        labels: boolean;
        /** The signed-quantity text line. */
        qty: boolean;
        longColor: string;
        shortColor: string;
        exitColor: string;
    };
    timeScale: {
        timezone: string;
    };
    /** Per-chart-type settings (plugin SDK sections), keyed by type id then row key. */
    chartTypes: Record<string, Record<string, unknown>>;
    candles: {
        upColor: string;
        downColor: string;
        bodyVisible: boolean;
        borderVisible: boolean;
        borderUpColor: string;
        borderDownColor: string;
        wickVisible: boolean;
        wickUpColor: string;
        wickDownColor: string;
    };
    /** OHLC-bars style — its own up/down (independent of the candle body colors). */
    bars: {
        upColor: string;
        downColor: string;
    };
    /** Line style — its own color + width. */
    line: {
        color: string;
        width: number;
    };
    /** Area style — its own line + gradient-fill colors + width. */
    area: {
        lineColor: string;
        width: number;
        topColor: string;
        bottomColor: string;
    };
    /** Baseline style — its own above/below line + two-stop fill colors + width + level. */
    baseline: {
        topLineColor: string;
        bottomLineColor: string;
        topFillColor: string;
        topFillColor2: string;
        bottomFillColor: string;
        bottomFillColor2: string;
        width: number;
        baselineLevel: number;
    };
    series: {
        style: PriceStyle;
        baseline: number | null;
        /** Spacing multiplier for non-connecting styles (candles/bars/HA/plugin types): scales the
         *  center-to-center pitch (and the crosshair step) without changing body width. 1 = default. */
        spacing: number;
    };
    /** Session-zone shading — the washes painted over the session bands a host pushes
     *  through the `sessionZones` feature: pre/post-market on day-split tapes, the
     *  single extended-hours phase on overnight roll tapes (no bands ⇒ the colors are
     *  dormant). */
    sessions: {
        premarketColor: string;
        postmarketColor: string;
        extendedColor: string;
    };
    /** Draw-order keys — what paints in front of what. The candles' own key plus one per
     *  indicator id; user drawings persist their keys in the drawings document, in the same
     *  space, so a saved chart keeps a drawing under the candles or between two indicators. */
    stacking: {
        candles: number;
        series: Record<string, number>;
    };
}

// ── validators (loose but safe: a chart consumes arbitrary CSS color strings) ──
const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
/** The library's own price styles, in picker order — {@link priceStyleIds} appends the
 *  SDK-registered chart types after these, so UIs can group the two families. */
export const BUILTIN_PRICE_STYLES: readonly PriceStyle[] = ['candles', 'bars', 'line', 'area', 'baseline', 'heikinashi'];

/** Base price-series painting for a style: built-ins paint themselves; a plugin type
 *  may declare `basePainting: 'none'` to suppress candles under its layer. */
export function basePaintingOf(style: PriceStyle): 'candles' | 'none' {
    for (const t of chartTypes()) if (t.id === style) return t.basePainting ?? 'candles';
    return 'candles';
}

/**
 * Candle cosmetics a candle-based PLUGIN style stores in its own per-type bag
 * (`chartTypes.<id>.candle*` — reserved keys, edited by the Symbol tab's Candles
 * group while that style is active). Per-key: `null` inherits the shared `candles`
 * block, so an untouched plugin style paints exactly like before — and edits never
 * leak back into the candles/heikin-ashi styles.
 */
export interface CandlePaintOverride {
    upColor: string | null;
    downColor: string | null;
    bodyVisible: boolean | null;
    borderVisible: boolean | null;
    borderUpColor: string | null;
    borderDownColor: string | null;
    wickVisible: boolean | null;
    wickUpColor: string | null;
    wickDownColor: string | null;
}

/** Whether a style carries its OWN candle cosmetics: a registered plugin type whose
 *  base painting is candles. Built-ins — heikin-ashi included — share the `candles`
 *  block instead. */
export function hasOwnCandlePaint(style: PriceStyle): boolean {
    if ((BUILTIN_PRICE_STYLES as readonly string[]).includes(style)) return false;
    for (const t of chartTypes()) if (t.id === style) return (t.basePainting ?? 'candles') === 'candles';
    return false;
}

/** The candle override for a style, read from the per-type bags — null for built-ins
 *  and for `basePainting: 'none'` types (nothing of theirs is candle-painted). */
export function candleOverrideFor(style: PriceStyle, bags: Record<string, Record<string, unknown>>): CandlePaintOverride | null {
    if (!hasOwnCandlePaint(style)) return null;
    const bag = bags[style] ?? {};
    const color = (v: unknown): string | null => (isColor(v) ? v : null);
    const bool = (v: unknown): boolean | null => (isBool(v) ? v : null);
    return {
        upColor: color(bag.candleUpColor),
        downColor: color(bag.candleDownColor),
        bodyVisible: bool(bag.candleBodyVisible),
        borderVisible: bool(bag.candleBorderVisible),
        borderUpColor: color(bag.candleBorderUpColor),
        borderDownColor: color(bag.candleBorderDownColor),
        wickVisible: bool(bag.candleWickVisible),
        wickUpColor: color(bag.candleWickUpColor),
        wickDownColor: color(bag.candleWickDownColor),
    };
}

/** The candle cosmetics to PAINT: the shared block overridden per-key by the active
 *  style's override; body colors default to the theme's up/down (shared by both
 *  backends, so their candle paths stay pixel-identical). */
export function effectiveCandlePaint(
    base: CandleStyle,
    override: CandlePaintOverride | null,
    themeUp: string,
    themeDown: string,
): { up: string; down: string; candle: CandleStyle } {
    if (!override) return { up: themeUp, down: themeDown, candle: base };
    return {
        up: override.upColor ?? themeUp,
        down: override.downColor ?? themeDown,
        candle: {
            bodyVisible: override.bodyVisible ?? base.bodyVisible,
            borderVisible: override.borderVisible ?? base.borderVisible,
            borderUpColor: override.borderUpColor ?? base.borderUpColor,
            borderDownColor: override.borderDownColor ?? base.borderDownColor,
            wickVisible: override.wickVisible ?? base.wickVisible,
            wickUpColor: override.wickUpColor ?? base.wickUpColor,
            wickDownColor: override.wickDownColor ?? base.wickDownColor,
        },
    };
}

/** Every valid price-style id RIGHT NOW: the built-ins plus SDK-registered chart types. */
export function priceStyleIds(): PriceStyle[] {
    const out: PriceStyle[] = [...BUILTIN_PRICE_STYLES];
    for (const t of chartTypes()) if (!out.includes(t.id)) out.push(t.id);
    return out;
}
const STAT_POSITIONS = ['above', 'below'] as const;

function isColor(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}
function isBool(v: unknown): v is boolean {
    return typeof v === 'boolean';
}
function isNum(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}
function isLineStyle(v: unknown): v is LineStyle {
    return typeof v === 'string' && (LINE_STYLES as readonly string[]).includes(v);
}
function isPriceStyle(v: unknown): v is PriceStyle {
    return typeof v === 'string' && priceStyleIds().includes(v);
}
function isScaleMode(v: unknown): v is ScaleMode {
    return v === 'price' || v === 'percent' || v === 'indexed';
}
function asObject(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function clampOpacity(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clampWidth(v: number): number {
    return v < 1 ? 1 : v > 10 ? 10 : v;
}
function clampLevel(v: number): number {
    return v < 0 ? 0 : v > 100 ? 100 : v;
}
/** Bar-spacing multiplier: 1 = default, values below 1 tighten and above 1 widen the pitch.
 *  Floored just above 0 (a 0 pitch would collapse every bar onto one pixel). */
function clampSpacing(v: number): number {
    return v < 0.1 ? 0.1 : v > 10 ? 10 : v;
}
function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
    return typeof v === 'string' && (list as readonly string[]).includes(v);
}
/** Ticks-per-row: a positive integer, capped so a manual grid can't blow up the row budget. */
function clampRowTicks(v: number): number {
    return Math.round(v < 1 ? 1 : v > 1000 ? 1000 : v);
}
/** Imbalance ratio percent: at least 100 (1×), capped at 2000 (20×). */
function clampRatio(v: number): number {
    return v < 100 ? 100 : v > 2000 ? 2000 : v;
}
/** Value-area percent: 1–100. */
function clampPercent(v: number): number {
    return v < 1 ? 1 : v > 100 ? 100 : v;
}
/** Value-text font px: 6–40. */
function clampFontPx(v: number): number {
    return v < 6 ? 6 : v > 40 ? 40 : v;
}
/** A filter bound: explicit `null` clears it; a finite non-negative number sets it; else keep base. */
function nullableBound(v: unknown, base: number | null): number | null {
    if (v === null) return null;
    return isNum(v) ? (v < 0 ? 0 : v) : base;
}


/**
 * The document "Reset defaults" applies. `mergeConfig` is deliberately ADDITIVE for
 * `chartTypes` (a patch only touches the type ids it names), so the factory snapshot
 * alone cannot undo SDK settings edited after mount — the reset document must name
 * every registered type at its registry-declared row defaults, covering EVERY key the
 * section can store (instances, subsections, range min/max, toggle swatches). The
 * registry is read at call time (types may register after mount), and values the
 * snapshot itself pinned win over the defvals — they ARE the first-run state.
 */
export function factoryResetConfig(factory: ChartConfig): ChartConfig {
    const bag: Record<string, Record<string, unknown>> = {};
    for (const t of chartTypes()) {
        const section = t.settings;
        if (!section) continue;
        const defaults: Record<string, unknown> = {};
        // Registry-enumerated: every key a row stores (toggle, inline controls, range
        // bounds) — no kind-specific walk that can miss a key the dialog seeds.
        const addRows = (rows: readonly SettingsRowDescriptor[] | undefined): void => {
            for (const r of rows ?? []) {
                for (const k of settingsRowValueKeys(r)) defaults[k.key] = k.defval;
            }
        };
        // An absent enable key means OFF — seed it explicitly so an instance the user
        // turned on cannot survive the additive merge; a row that declares the same key
        // (a subsection's master toggle) overrides it with its own defval via addRows.
        for (const inst of section.instances ?? []) {
            if (inst.enableKey) defaults[inst.enableKey] = false;
            addRows(inst.rows);
        }
        for (const sub of section.subsections ?? []) {
            if (sub.enableKey) defaults[sub.enableKey] = false;
            addRows(sub.rows);
        }
        if (!section.instances) addRows(section.rows);
        bag[t.id] = defaults;
    }
    for (const [typeId, vals] of Object.entries(factory.chartTypes)) {
        bag[typeId] = { ...(bag[typeId] ?? {}), ...vals };
    }
    return { ...factory, chartTypes: bag };
}

/**
 * Deep-merge an untrusted partial `patch` onto a known-good `base`, validating every
 * field and silently dropping malformed ones. Pure (returns a fresh config, mutates
 * nothing) — the single reducer behind `applyConfig(json)` and the import path.
 */
export function mergeConfig(base: ChartConfig, patch: unknown): ChartConfig {
    const p = asObject(patch);
    const ctPatch = asObject(p.chartTypes);
    const chartTypesBag: Record<string, Record<string, unknown>> = { ...base.chartTypes };
    for (const [typeId, vals] of Object.entries(ctPatch)) {
        chartTypesBag[typeId] = { ...(chartTypesBag[typeId] ?? {}), ...asObject(vals) };
    }
    const layout = asObject(p.layout);
    const grid = asObject(p.grid);
    const gv = asObject(grid.vertLines);
    const gh = asObject(grid.horzLines);
    const cross = asObject(p.crosshair);
    const ps = asObject(p.priceScale);
    const panes = asObject(p.panes);
    const trades = asObject(p.trades);
    const ts = asObject(p.timeScale);
    const candles = asObject(p.candles);
    const bars = asObject(p.bars);
    const line = asObject(p.line);
    const area = asObject(p.area);
    const baseline = asObject(p.baseline);
    const series = asObject(p.series);
    const sessions = asObject(p.sessions);
    const stacking = asObject(p.stacking);
    const stackSeries = asObject(stacking.series);

    return {
        version: CHART_CONFIG_VERSION,
        chartTypes: chartTypesBag,
        layout: {
            background: isColor(layout.background) ? layout.background : base.layout.background,
            textColor: isColor(layout.textColor) ? layout.textColor : base.layout.textColor,
            fontFamily: isColor(layout.fontFamily) ? layout.fontFamily : base.layout.fontFamily,
            fontSize: isNum(layout.fontSize) ? Math.max(6, Math.min(32, layout.fontSize)) : base.layout.fontSize,
        },
        grid: {
            vertLines: {
                visible: isBool(gv.visible) ? gv.visible : base.grid.vertLines.visible,
                color: isColor(gv.color) ? gv.color : base.grid.vertLines.color,
            },
            horzLines: {
                visible: isBool(gh.visible) ? gh.visible : base.grid.horzLines.visible,
                color: isColor(gh.color) ? gh.color : base.grid.horzLines.color,
            },
        },
        crosshair: {
            color: isColor(cross.color) ? cross.color : base.crosshair.color,
            width: isNum(cross.width) ? Math.max(0.5, Math.min(8, cross.width)) : base.crosshair.width,
            style: isLineStyle(cross.style) ? cross.style : base.crosshair.style,
            opacity: isNum(cross.opacity) ? clampOpacity(cross.opacity) : base.crosshair.opacity,
            labelBackground: isColor(cross.labelBackground) ? cross.labelBackground : base.crosshair.labelBackground,
        },
        priceScale: {
            mode: isScaleMode(ps.mode) ? ps.mode : base.priceScale.mode,
            log: isBool(ps.log) ? ps.log : base.priceScale.log,
            invert: isBool(ps.invert) ? ps.invert : base.priceScale.invert,
            borderColor: isColor(ps.borderColor) ? ps.borderColor : base.priceScale.borderColor,
            labelsVisible: isBool(ps.labelsVisible) ? ps.labelsVisible : base.priceScale.labelsVisible,
            currentPriceLine: isBool(ps.currentPriceLine) ? ps.currentPriceLine : base.priceScale.currentPriceLine,
            priceLabel: isBool(ps.priceLabel) ? ps.priceLabel : base.priceScale.priceLabel,
            countdown: isBool(ps.countdown) ? ps.countdown : base.priceScale.countdown,
        },
        panes: {
            separatorColor: isColor(panes.separatorColor) ? panes.separatorColor : base.panes.separatorColor,
        },
        trades: {
            visible: isBool(trades.visible) ? trades.visible : base.trades.visible,
            labels: isBool(trades.labels) ? trades.labels : base.trades.labels,
            qty: isBool(trades.qty) ? trades.qty : base.trades.qty,
            longColor: isColor(trades.longColor) ? trades.longColor : base.trades.longColor,
            shortColor: isColor(trades.shortColor) ? trades.shortColor : base.trades.shortColor,
            exitColor: isColor(trades.exitColor) ? trades.exitColor : base.trades.exitColor,
        },
        timeScale: {
            timezone: typeof ts.timezone === 'string' && ts.timezone ? ts.timezone : base.timeScale.timezone,
        },
        candles: {
            upColor: isColor(candles.upColor) ? candles.upColor : base.candles.upColor,
            downColor: isColor(candles.downColor) ? candles.downColor : base.candles.downColor,
            bodyVisible: isBool(candles.bodyVisible) ? candles.bodyVisible : base.candles.bodyVisible,
            borderVisible: isBool(candles.borderVisible) ? candles.borderVisible : base.candles.borderVisible,
            borderUpColor: isColor(candles.borderUpColor) ? candles.borderUpColor : base.candles.borderUpColor,
            borderDownColor: isColor(candles.borderDownColor) ? candles.borderDownColor : base.candles.borderDownColor,
            wickVisible: isBool(candles.wickVisible) ? candles.wickVisible : base.candles.wickVisible,
            wickUpColor: isColor(candles.wickUpColor) ? candles.wickUpColor : base.candles.wickUpColor,
            wickDownColor: isColor(candles.wickDownColor) ? candles.wickDownColor : base.candles.wickDownColor,
        },
        bars: {
            upColor: isColor(bars.upColor) ? bars.upColor : base.bars.upColor,
            downColor: isColor(bars.downColor) ? bars.downColor : base.bars.downColor,
        },
        line: {
            color: isColor(line.color) ? line.color : base.line.color,
            width: isNum(line.width) ? clampWidth(line.width) : base.line.width,
        },
        area: {
            lineColor: isColor(area.lineColor) ? area.lineColor : base.area.lineColor,
            width: isNum(area.width) ? clampWidth(area.width) : base.area.width,
            topColor: isColor(area.topColor) ? area.topColor : base.area.topColor,
            bottomColor: isColor(area.bottomColor) ? area.bottomColor : base.area.bottomColor,
        },
        baseline: {
            topLineColor: isColor(baseline.topLineColor) ? baseline.topLineColor : base.baseline.topLineColor,
            bottomLineColor: isColor(baseline.bottomLineColor) ? baseline.bottomLineColor : base.baseline.bottomLineColor,
            topFillColor: isColor(baseline.topFillColor) ? baseline.topFillColor : base.baseline.topFillColor,
            topFillColor2: isColor(baseline.topFillColor2) ? baseline.topFillColor2 : base.baseline.topFillColor2,
            bottomFillColor: isColor(baseline.bottomFillColor) ? baseline.bottomFillColor : base.baseline.bottomFillColor,
            bottomFillColor2: isColor(baseline.bottomFillColor2) ? baseline.bottomFillColor2 : base.baseline.bottomFillColor2,
            width: isNum(baseline.width) ? clampWidth(baseline.width) : base.baseline.width,
            baselineLevel: isNum(baseline.baselineLevel) ? clampLevel(baseline.baselineLevel) : base.baseline.baselineLevel,
        },
        series: {
            style: isPriceStyle(series.style) ? series.style : base.series.style,
            baseline: series.baseline === null ? null : isNum(series.baseline) ? series.baseline : base.series.baseline,
            spacing: isNum(series.spacing) ? clampSpacing(series.spacing) : base.series.spacing,
        },
        sessions: {
            premarketColor: isColor(sessions.premarketColor) ? sessions.premarketColor : base.sessions.premarketColor,
            postmarketColor: isColor(sessions.postmarketColor) ? sessions.postmarketColor : base.sessions.postmarketColor,
            extendedColor: isColor(sessions.extendedColor) ? sessions.extendedColor : base.sessions.extendedColor,
        },
        stacking: {
            candles: isNum(stacking.candles) ? stacking.candles : base.stacking.candles,
            // Additive like `chartTypes`: a patch names only the ids it carries; the rest keep
            // their current keys (ids belong to the session's indicators, not the template).
            series: {
                ...base.stacking.series,
                ...Object.fromEntries(Object.entries(stackSeries).filter(([, z]) => isNum(z)) as Array<[string, number]>),
            },
        },
    };
}
