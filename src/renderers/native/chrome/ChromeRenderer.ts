import type { Translator } from '../../../core/i18n/types';
import type { VelaTheme } from '../../../core/options';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { OHLCV } from '../../../core/model/ohlcv';
import { isLineLikeSeries, seriesShownOn, type LineStyle, type LineLikeSeries } from '../../../core/model/series';
import { textOf } from '../../../core/i18n/text';
import { spreadAxisTags, type AxisTagSlot } from './axisTags';
import { blend, cssRgba, readableInk, rgbaCss, type Rgba } from './tagColors';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { percentScaleFor, percentScaleForModel } from '../core/SceneGraph';
import { effectiveCandlePaint, withAlpha } from '../core/chartConfig';
import { columnIsUp } from '../backend/close-styles';
// Re-exported so existing importers (crosshair) can keep sourcing it from here.
export { percentScaleFor } from '../core/SceneGraph';
import { DrawingSceneRenderer, modelDrawingSet, type DrawingSet } from '../../shared/DrawingSceneRenderer';
import { renderTradeMarkers } from '../../shared/trade-markers';
import type { TradeExecution } from '../../../core/model/trades';
import { paneAxisTicks, formatAxisValue, timeTicks } from './ticks';
import { PriceAxisTickSource } from './priceAxisTicks';
import { axisColumnX, PANE_SEPARATOR_PX } from './axisLayout';
import { DARK_THEME } from '../../../core/theme';
import { displayZone, tzOffsetMs } from './tz';
import { countdownText } from './countdown';
import { clockCorrection } from '../../../core/util/wall-clock';
import { tagTextColor } from './contrast';
import { markGroupVisible } from '../../shared/marks-state';
import { clusterTooltip, layoutMarkLane, markGlyphAt, markStackAt, type MarkLaneLayout, type PlacedGlyph } from './marks/layout';
import { MarkIconRaster, paintMarkLane } from './marks/paint';
import { beginPlotFrame } from '../core/plotDirection';

/** Opacity factor of a price-axis label whose tick is `major: false` (de-emphasized). */
const MINOR_LABEL_ALPHA = 0.5;

/** Height and horizontal padding of an indicator tag chip (the last-price chip's own). */
const TAG_H = 16;
const TAG_PAD = 8;
/** Longest an indicator name chip gets before its name is cut with an ellipsis. */
const NAME_MAX_W = 160;
/** How strongly a name chip is tinted with its plot color, and its outline's opacity. */
const NAME_TINT = 0.18;
const NAME_BORDER_ALPHA = 0.55;

/** One plot that carries a tag: its value and color on the last bar. */
interface TaggedPlot {
    series: LineLikeSeries;
    value: number;
    /** The plot color, opaque. */
    color: Rgba;
}

/** A tag placed on a pane: the scale column, the band it wants, and what it shows. */
interface IndicatorTag {
    column: number;
    slot: AxisTagSlot;
    text: string;
    color: Rgba;
    name: string;
    /** Opt-in axis label (e.g. a compared symbol): renders its value + solid name pill
     *  whenever `showPriceLabel` is on, even while global indicator name labels are off. */
    solidPill?: boolean;
}

/**
 * The plots of `m` that carry a tag at series index `index` (the last bar): value series on the
 * price scale with a value and a visible color there. A transparent series (a fill anchor, or
 * `color = na` on that bar) shows nothing on the chart, so it carries no tag either.
 */
function taggedPlots(m: IndicatorModel, index: number): TaggedPlot[] {
    const out: TaggedPlot[] = [];
    for (const s of m.series) {
        if (!isLineLikeSeries(s) || !seriesShownOn(s, 'priceScale')) continue;
        const p = s.points[index];
        if (!p || p.value === null || !Number.isFinite(p.value)) continue;
        const css = p.color ?? s.style.color;
        if (!css) continue;
        const [r, g, b, a] = cssRgba(css);
        if (!(a > 0)) continue;
        out.push({ series: s, value: p.value, color: [r, g, b, 1] });
    }
    return out;
}

/**
 * Renderer-owned chrome layer (canvas2d) on its own canvas, stacked above the
 * geometry layer (L0) and below the cursor layer (L2). It draws the per-pane price
 * axes + labels, the time axis + labels, the current-price line + chip, and the
 * strategy trade markers. Pine drawings do NOT paint here: they prepaint into
 * interleave slices (IndicatorDrawingSlices) the geometry backend composites at
 * their model's z slot — this layer only keeps the shared DrawingSceneRenderer to
 * compute the drawing price-range that folds into autoscale (`paneDrawingsRange`).
 */
export class ChromeRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    // The color for axis tick labels — the host-passed surface text, set each frame in render().
    private axisTextColor = DARK_THEME.textColor;
    // Shared Pine-drawing renderer, used here for autoscale geometry only; widthCache persists.
    private readonly drawScene = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme: {} as VelaTheme });
    /** The timeline-mark lane as laid out by the last frame — what hover/click hit-test against. */
    private markLayout: MarkLaneLayout = { glyphs: [], stacks: new Map() };
    /** Registry icons rasterized for the lane; the owner is asked for a chrome repaint when one lands. */
    private readonly markIcons = new MarkIconRaster(() => this.onMarkIconReady?.());
    private onMarkIconReady: (() => void) | null = null;
    /** Bar open times of the current series, rebuilt only when the array or its length changes (a live tick keeps both). */
    private barTimesSrc: readonly OHLCV[] | null = null;
    private barTimesCache: number[] = [];
    /** The chart's translator, for the indicator name labels (English when absent). */
    i18n: Translator | null = null;

    /** `axisTicks` is shared with the backdrop layer, so price labels and gridlines agree. */
    constructor(private readonly axisTicks = new PriceAxisTickSource()) {}

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /** Where to ask for a chrome repaint when a lane icon finishes rasterizing. */
    setMarkIconReady(cb: (() => void) | null): void {
        this.onMarkIconReady = cb;
    }

    /** The interactive mark glyph under a plot point (last frame's layout), or null. */
    markGlyphAt(x: number, y: number): PlacedGlyph | null {
        return markGlyphAt(this.markLayout, x, y);
    }

    /** The mark stack (bar index) whose glyphs — or the gaps of its fan — cover a plot point. */
    markStackAt(x: number, y: number): number | null {
        return markStackAt(this.markLayout, x, y);
    }

    /** A glyph of the last frame by its cluster key — how an open popup follows its anchor. */
    markGlyphByKey(key: string): PlacedGlyph | null {
        return this.markLayout.glyphs.find((g) => g.cluster.key === key) ?? null;
    }

    /** Hover text of the mark glyph under a plot point, or null. */
    markTooltipAt(x: number, y: number, groups: ReadonlyArray<{ id: string; label: string }>, i18n?: Translator | null): string | null {
        const g = this.markGlyphAt(x, y);
        return g ? clusterTooltip(g.cluster, groups, i18n) : null;
    }

    /** Wire the drawing coordinate resolvers + theme (call once per frame before use). */
    prepare(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        this.drawScene.setDeps({
            timeToLogical: (ms) => coords.timeToLogical(ms),
            barAt: (logical) => {
                const b = scene.bars[Math.round(logical)];
                return b ? { high: b.high, low: b.low } : null;
            },
            theme,
        });
    }

    /**
     * Visible Pine-drawing price range for a pane (folds into autoscale): the pane's
     * own (non-overlay) drawings, plus force_overlay drawings when it's the price pane.
     * Requires `prepare()` to have wired the resolvers for this frame.
     */
    paneDrawingsRange(ownModels: IndicatorModel[], scene: SceneGraph, isPricePane: boolean, vr: { from: number; to: number }): { min: number; max: number } | null {
        let dr: { min: number; max: number } | null = null;
        for (const m of ownModels) dr = unionRange(dr, this.drawingsRange(modelDrawingSet(m, false), vr, scene.offsetOf(m.id)));
        if (isPricePane) for (const m of scene.indicators.values()) dr = unionRange(dr, this.drawingsRange(modelDrawingSet(m, true), vr, scene.offsetOf(m.id)));
        return dr;
    }

    /** Clear the chrome canvas and draw drawings + axes + current-price line.
     *  `surface` (background + text) paints the axis-scale gutters — the host passes the live
     *  chart background so the scales read as part of the plot, with contrast-corrected text.
     *  Falls back to the theme's own colors when no surface is supplied. */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, surface?: { background: string; textColor: string }): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        const fullW = canvas.width / dpr;
        const fullH = canvas.height / dpr;
        const dataW = coords.width;
        const dataH = coords.height;
        // The gutters (and their labels) use the surface the host passes (the live chart
        // background); everything data-side keeps the live theme.
        this.axisTextColor = surface?.textColor ?? theme.textColor;
        beginPlotFrame(ctx, dpr);
        ctx.clearRect(0, 0, fullW, fullH);
        // Paint the price-axis (right) + time-axis (bottom) gutters opaquely so drawings or
        // series pixels beneath never bleed into the scales. Data/drawings stay clear of
        // these strips, so this only ever covers the axis areas.
        if (surface && (fullW > dataW || fullH > dataH)) {
            ctx.fillStyle = surface.background;
            if (fullW > dataW) ctx.fillRect(dataW, 0, fullW - dataW, fullH);
            if (fullH > dataH) ctx.fillRect(0, dataH, dataW, fullH - dataH);
        }
        ctx.font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        ctx.textBaseline = 'middle';

        const panes = scene.orderedPanes();
        if (coords.barCount === 0) {
            // A market switch (timeframe/symbol) clears the series while the new bars
            // load, and any chrome frame in that window (crosshair move, resize) lands
            // here. The pane SEPARATORS are structural — they depend on pane bounds
            // alone, not bars — so they must survive the empty frame, or the stacked
            // panes read as one undivided plot until the load completes.
            this.drawPaneSeparators(ctx, scene, theme, fullW, panes);
            this.markLayout = { glyphs: [], stacks: new Map() }; // no bars ⇒ nothing to click either
            return;
        }
        const pricePane = panes.find((p) => p.kind === 'price') ?? null;

        // Pine drawings paint through the interleave slices at their model's z slot
        // (IndicatorDrawingSlices), NOT here — the chrome stays axes + markers + chips.

        // ── Strategy trade markers — always the PRICE pane, whatever pane the strategy's
        //    plots landed on (a fill price only means something on the price scale), above
        //    the drawings. Hiding the indicator removes its model, and the markers with it. ──
        if (pricePane && !pricePane.collapsed && scene.tradeMarkers.visible) {
            for (const m of scene.indicators.values()) {
                if (m.trades?.length) this.renderTrades(ctx, coords, scene, theme, m.trades, pricePane, dataW);
            }
        }

        // ── axes + indicator/compare tags + current-price line + countdown ──
        this.drawPriceAxes(ctx, scene, coords, theme, dataW, panes);
        this.drawMergedScaleColumns(ctx, scene, coords, dataW);
        this.drawPaneSeparators(ctx, scene, theme, fullW, panes);
        this.drawIndicatorTags(ctx, scene, coords, theme, dataW, fullW, panes, pricePane);
        this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);
        this.drawTimeAxis(ctx, scene, coords, theme, dataW, dataH, fullH);
        this.drawMarkLane(ctx, scene, coords, theme, dataW, dataH);
    }

    /** The timeline-mark lane — after the axis, so the tokens read over the plot's bottom edge,
     *  but clipped to the data area so a glyph on the edge bar never paints over the price scale. */
    private drawMarkLane(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, dataH: number): void {
        if (!scene.marks.visible || scene.timelineMarks.length === 0) {
            this.markLayout = { glyphs: [], stacks: new Map() };
            return;
        }
        this.markLayout = layoutMarkLane({
            marks: scene.timelineMarks,
            groups: scene.markGroups,
            hidden: (groupId) => !markGroupVisible(scene.marks, groupId, scene.markGroups),
            barTimes: this.barTimes(scene),
            intervalMs: coords.barInterval,
            xOf: (bar) => coords.logicalToX(bar),
            axisY: dataH,
            dataW,
            expanded: scene.marksExpandedStack,
        });
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, dataW, dataH);
        ctx.clip();
        paintMarkLane(ctx, this.markLayout, {
            axisY: dataH,
            background: theme.background,
            stemColor: scene.style.borderColor ?? theme.borderColor,
            fontFamily: theme.fontFamily,
            dpr: coords.dpr,
            icons: this.markIcons,
            hoverKey: scene.marksHoverKey,
            hoverSince: scene.marksHoverSince,
            activeKey: scene.marksActiveKey,
            flashKey: scene.marksFlash && scene.marksFlash.until > nowMs ? scene.marksFlash.key : null,
            nowMs,
        });
        ctx.restore();
    }

    private barTimes(scene: SceneGraph): readonly number[] {
        if (this.barTimesSrc !== scene.bars || this.barTimesCache.length !== scene.bars.length) {
            this.barTimesSrc = scene.bars;
            this.barTimesCache = scene.bars.map((b) => b.time);
        }
        return this.barTimesCache;
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    private drawingsRange(set: DrawingSet, vr: { from: number; to: number }, indexOffset = 0): { min: number; max: number } | null {
        this.drawScene.setSet(set, indexOffset);
        if (this.drawScene.isEmpty()) return null;
        const r = this.drawScene.priceRange(vr.from, vr.to);
        return r ? { min: r.min, max: r.max } : null;
    }

    private renderTrades(
        ctx: CanvasRenderingContext2D,
        coords: CoordinateSystem,
        scene: SceneGraph,
        theme: VelaTheme,
        trades: readonly TradeExecution[],
        pane: PaneNode,
        dataW: number,
    ): void {
        ctx.save();
        ctx.translate(0, pane.bounds.top); // pane-relative space, clipped like the drawings
        ctx.beginPath();
        ctx.rect(0, 0, dataW, pane.bounds.height);
        ctx.clip();
        renderTradeMarkers(
            ctx,
            trades,
            scene.tradeMarkers,
            {
                timeToLogical: (ms) => coords.timeToLogical(ms),
                barAt: (logical) => {
                    const b = scene.bars[Math.round(logical)];
                    return b ? { high: b.high, low: b.low } : null;
                },
            },
            (logical) => coords.logicalToX(logical),
            (price) => coords.priceToY(price, pane.scale, pane.bounds) - pane.bounds.top,
            { fontSize: scene.style.fontSize, fontFamily: theme.fontFamily, color: theme.textColor },
            dataW,
            // Half the candle BODY width (bodies take ~0.8 of the pitch), so the
            // fill-price ticks hug the bar's edges at every zoom.
            Math.max(1.5, coords.bodySpacing() * 0.4),
        );
        ctx.restore();
    }

    // ── axes ──
    private drawPriceAxes(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, panes: PaneNode[]): void {
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dataW + 0.5, 0);
        ctx.lineTo(dataW + 0.5, coords.height);
        ctx.stroke();
        if (!scene.showAxisLabels) return;
        ctx.fillStyle = this.axisTextColor;
        ctx.textAlign = 'left';
        const font = `${scene.style.fontSize}px ${theme.fontFamily}`;
        const majorFont = `600 ${font}`;
        const alpha = ctx.globalAlpha;
        for (const pane of panes) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no scale numbers
            for (const t of this.axisTicks.ticksFor(scene, pane, coords)) {
                const y = coords.priceToY(t.price, pane.scale, pane.bounds);
                if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                if (t.major === true) ctx.font = majorFont;
                else if (t.major === false) ctx.globalAlpha = alpha * MINOR_LABEL_ALPHA;
                ctx.fillText(t.label, dataW + 6, y);
                if (t.major === true) ctx.font = font;
                else if (t.major === false) ctx.globalAlpha = alpha;
            }
            // A paneAxis-overridden pane labels its bands instead of prices (a
            // categorical axis) — same column, same typography as the price ticks.
            if (pane.axisBands) {
                for (const b of pane.axisBands) {
                    const y = pane.bounds.top + b.frac * pane.bounds.height;
                    if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                    ctx.fillText(b.label, dataW + 6, y);
                }
            }
        }
        ctx.textAlign = 'start';
    }

    /**
     * The horizontal divider at each stacked pane's top edge, spanning the FULL width (data area
     * + right-hand scale gutter) as one continuous line. Drawn on the chrome layer, above the data
     * canvas, so series/candles never overpaint it — the line reads at a uniform thickness across
     * the whole width. Its draggable hit-zone (input) and hover highlight (crosshair layer) match
     * this same full span.
     */
    private drawPaneSeparators(ctx: CanvasRenderingContext2D, scene: SceneGraph, theme: VelaTheme, fullW: number, panes: PaneNode[]): void {
        ctx.fillStyle = scene.style.separatorColor ?? theme.borderColor;
        for (const pane of panes) {
            if (pane.order <= 0) continue; // no separator above the topmost (price) pane
            ctx.fillRect(0, Math.round(pane.bounds.top) - 1, fullW, PANE_SEPARATOR_PX);
        }
    }

    /**
     * Draw an axis column per merged (own-scale) indicator, to the right of each pane's
     * master scale — tick labels in the chart's axis text color. Columns are told apart by
     * spacing alone (no divider line), and a collapsed pane's columns are skipped entirely.
     * This is what makes a merged indicator readable on its own values while sharing the pane.
     */
    private drawMergedScaleColumns(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, dataW: number): void {
        if (!scene.showAxisLabels) return;
        ctx.textAlign = 'left';
        // A merged column reads with the same axis text color as the master scale (from the
        // chart's settings) — no per-indicator tint, so the gutter stays uniform.
        ctx.fillStyle = this.axisTextColor;
        for (const pane of scene.orderedPanes()) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no scale numbers
            const merged = scene.ownScaleIndicatorsForPane(pane.id);
            merged.forEach((model, k) => {
                const sc = scene.indicatorScales.get(model.id)?.scale;
                if (!sc) return;
                const x = axisColumnX(dataW, k + 1); // column 0 is the master scale
                for (const t of paneAxisTicks(sc, pane.bounds.height, undefined, scene.priceMintick, undefined, scene.format)) {
                    const y = coords.priceToY(t.price, sc, pane.bounds);
                    if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                    ctx.fillText(t.label, x + 5, y);
                }
            });
        }
        ctx.textAlign = 'start';
    }

    /**
     * Indicator value tags: each indicator plot's value on the last bar, as a chip in its
     * plot color on the scale it draws against (the pane's master scale, or its own merged
     * column), with its name in a tinted chip at the plot's right edge when name labels are on.
     *
     * Chips that would overlap are spread apart; the last-price chip keeps its place and the
     * tags make room around it. Each scale column spreads its own chips, except with name
     * labels on: the names all sit at the plot's edge, whatever column their value is in, so
     * the pane's tags then share one set of rows and every name sits level with its own value.
     * A tag pushed out of its pane (crowded against an edge, or a pane too short for them all)
     * is left off, and each pane draws clipped to its own band.
     *
     * A plot gets no tag when it is off the price scale (`display.priceScale`), has no value or
     * an invisible color on the last bar (`color = na`, a fill anchor), or sits outside its pane.
     */
    private drawIndicatorTags(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, fullW: number, panes: PaneNode[], pricePane: PaneNode | null): void {
        const showValues = scene.showIndicatorValueLabels;
        const showNames = scene.showIndicatorNameLabels;
        const hasOptIn = scene.showPriceLabel && [...scene.indicators.values()].some((m) => m.priceAxisLabel === true);
        if (!showValues && !showNames && !hasOptIn) return;
        const last = scene.bars.length - 1;
        if (last < 0) return;
        const background = cssRgba(theme.background);
        const nameMaxW = Math.min(NAME_MAX_W, dataW * 0.4);
        // The plots each indicator labels — counted once, across all its panes, so a name adds
        // the plot's own name only when its indicator labels more than one.
        const labelled = new Map<string, TaggedPlot[]>();
        for (const m of scene.indicators.values()) labelled.set(m.id, taggedPlots(m, last - scene.offsetOf(m.id)));

        for (const pane of panes) {
            if (pane.collapsed || !(pane.bounds.height > 0)) continue;
            const top = pane.bounds.top;
            const bottom = top + pane.bounds.height;
            // Scale columns on this pane: 0 is the master scale, k + 1 the k-th merged indicator.
            const own = scene.ownScaleIndicatorsForPane(pane.id);
            const tags: IndicatorTag[] = [];
            const add = (m: IndicatorModel, plot: TaggedPlot, column: number, scale: PaneNode['scale'], master: boolean): void => {
                const solidPill = m.priceAxisLabel === true && scene.showPriceLabel;
                if (!showValues && !showNames && !solidPill) return;
                const y = coords.priceToY(plot.value, scale, pane.bounds);
                if (!(y >= top && y <= bottom)) return;
                const mintick = m.percentBaseline === 'own' ? undefined : scene.priceMintick;
                const text = master
                    ? formatAxisValue(scale, pane.bounds.height, plot.value, percentScaleForModel(scene, pane, m), mintick, pane.axisFormat, scene.format, solidPill ? 'lastPrice' : 'priceAxis')
                    : formatAxisValue(scale, pane.bounds.height, plot.value, undefined, mintick, undefined, scene.format, solidPill ? 'lastPrice' : 'priceAxis');
                if (!text) return;
                const name = solidPill ? plot.series.title || this.tagName(m, plot.series, labelled.get(m.id)!.length) : this.tagName(m, plot.series, labelled.get(m.id)!.length);
                tags.push({ column, slot: { top: y - TAG_H / 2, height: TAG_H }, text, color: plot.color, name, ...(solidPill ? { solidPill: true } : {}) });
            };
            for (const m of scene.orderedIndicatorsForPane(pane.id)) {
                const k = m.ownScale === true ? own.indexOf(m) : -1;
                for (const plot of labelled.get(m.id)!) if (plot.series.overlay !== true) add(m, plot, k + 1, scene.scaleFor(m, pane), k < 0);
            }
            if (pane === pricePane) {
                // force_overlay plots land on the price pane's master scale, whatever pane their indicator owns.
                for (const m of scene.indicators.values()) for (const plot of labelled.get(m.id)!) if (plot.series.overlay === true) add(m, plot, 0, pane.scale, true);
            }
            if (tags.length === 0) continue;

            const priceChip = pane === pricePane ? this.priceChipSlot(scene, coords, pane) : null;
            const anyEdgeNames = showNames || tags.some((t) => t.solidPill && t.column === 0);
            const groups = new Map<number, IndicatorTag[]>();
            for (const t of tags) {
                const key = anyEdgeNames ? 0 : t.column;
                const group = groups.get(key);
                if (group) group.push(t);
                else groups.set(key, [t]);
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, top, fullW, bottom - top);
            ctx.clip();
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            for (const [key, group] of groups) {
                // The last-price chip shares the master column, and with names on every row.
                const slots = group.map((t) => t.slot);
                if (priceChip && key === 0) slots.push(priceChip);
                const tops = spreadAxisTags(slots, top, bottom);
                group.forEach((t, i) => {
                    const chipTop = tops[i]!;
                    if (chipTop < top || chipTop + TAG_H > bottom) return; // no room left in the pane
                    const y = chipTop + TAG_H / 2;
                    const fill = rgbaCss(t.color, 1);
                    if (showValues || t.solidPill) {
                        const x = axisColumnX(dataW, t.column) + 1;
                        const w = ctx.measureText(t.text).width + TAG_PAD;
                        ctx.fillStyle = fill;
                        ctx.fillRect(x, chipTop, w, TAG_H);
                        ctx.fillStyle = tagTextColor(fill, theme.background);
                        ctx.fillText(t.text, x + w / 2, y);
                    }
                    if (t.solidPill && t.column === 0 && t.name) {
                        const name = fitText(ctx, t.name, nameMaxW);
                        drawAxisNameTag(ctx, name, dataW, y, fill, tagTextColor(fill, theme.background));
                        ctx.textAlign = 'center';
                    } else if (showNames && t.name) {
                        const name = fitText(ctx, t.name, nameMaxW);
                        const w = ctx.measureText(name).width + TAG_PAD;
                        const x = dataW - w - 2;
                        // An opaque tint of the plot color over the chart background, so the
                        // plot beneath never shows through, with the name in the plot color
                        // made dark or light enough to read on it.
                        const chip = blend(background, t.color, NAME_TINT);
                        ctx.fillStyle = rgbaCss(chip, 1);
                        ctx.fillRect(x, chipTop, w, TAG_H);
                        ctx.strokeStyle = rgbaCss(t.color, NAME_BORDER_ALPHA);
                        ctx.lineWidth = 1;
                        ctx.strokeRect(x + 0.5, chipTop + 0.5, w - 1, TAG_H - 1);
                        ctx.fillStyle = rgbaCss(readableInk(t.color, chip), 1);
                        ctx.fillText(name, x + w / 2, y);
                    }
                });
            }
            ctx.restore();
        }
        ctx.textAlign = 'start';
    }

    /** What a plot's name label reads: the indicator's short name, plus the plot's own name
     *  when the indicator tags more than one plot (`BB Upper`, `BB Basis`). */
    private tagName(m: IndicatorModel, s: LineLikeSeries, plots: number): string {
        const short = m.displayShorttitle ?? m.shorttitle;
        const indicator = textOf(this.i18n, short ?? m.displayTitle ?? m.title);
        if (plots <= 1) return indicator;
        const plot = s.displayTitle ? textOf(this.i18n, s.displayTitle) : s.title;
        return plot && plot !== indicator ? `${indicator} ${plot}` : indicator;
    }

    /** The band the last-price chip (and the countdown merged under it) takes on the price
     *  scale, or null when neither shows — the slot indicator tags make room around. */
    private priceChipSlot(scene: SceneGraph, coords: CoordinateSystem, pricePane: PaneNode): AxisTagSlot | null {
        const n = scene.bars.length;
        if (n === 0 || scene.candlesHidden) return null;
        const last = scene.bars[n - 1]!;
        const y = coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
        if (y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) return null;
        const countdown = scene.showCountdown && !scene.variableDuration && countdownText(last.time, coords.barInterval, clockCorrection.now(), scene.format) !== null;
        if (!scene.showPriceLabel && !countdown) return null;
        return { top: y - 8, height: scene.showPriceLabel && countdown ? 32 : 16, fixed: true };
    }

    /**
     * The latest-price chrome on the price pane, all colored with the price element's own
     * color (candle/bar up-down, line, area, or baseline side) and white text:
     *  - the dashed current-price LINE (`showPriceLine`) — fully independent of the label,
     *  - the last-price LABEL chip (`showPriceLabel`),
     *  - the countdown-to-bar-close chip (`showCountdown`).
     * When the label and countdown are both on they merge into one stacked block (countdown
     * under the label, text flushed left); a lone label or countdown is centered on the
     * price level with centered text. The countdown repaints on the renderer's second pulse
     * and disappears once the bar has closed, until the next bar arrives.
     */
    private drawPriceLineAndCountdown(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, pricePane: PaneNode | null): void {
        const n = scene.bars.length;
        // A hidden price series takes its current-price line/label/countdown down with it —
        // as does a hidden price PANE (collapsed, or zero-height while a study pane is maximized).
        if (!pricePane || n === 0 || scene.candlesHidden || pricePane.collapsed || pricePane.bounds.height <= 0) return;
        const last = scene.bars[n - 1]!;
        const y = coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
        if (y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) return;
        const color = priceElementColor(scene, coords, theme, last);

        // ── dashed line (independent of the label) ──
        if (scene.showPriceLine) {
            const yy = Math.round(y) + 0.5;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            setDash(ctx, 'dotted');
            ctx.beginPath();
            ctx.moveTo(0, yy);
            ctx.lineTo(dataW, yy);
            ctx.stroke();
            setDash(ctx, 'solid');
        }

        // ── axis chips: last-price label and/or countdown ──
        // The corrected clock, not the device's: on a slow device the next candle lands
        // while the device clock still reads before its open, and the chip read `01:04`.
        // Variable-duration series (tick charts) have no wall-clock close, so hide it.
        const cdText = scene.showCountdown && !scene.variableDuration ? countdownText(last.time, coords.barInterval, clockCorrection.now(), scene.format) : null;
        const showCountdown = cdText !== null;
        const showLabel = scene.showPriceLabel;
        if (!showLabel && !showCountdown) return;

        const priceText = formatAxisValue(pricePane.scale, pricePane.bounds.height, last.close, percentScaleFor(scene, pricePane), scene.priceMintick, undefined, scene.format, 'lastPrice');
        const PAD = 8;
        const x = dataW + 1;
        // Text color chosen for contrast against the chip's own color (so a white candle
        // color yields dark text, a dark color yields light text).
        const textColor = tagTextColor(color, theme.background);
        ctx.textBaseline = 'middle';

        // When another shared-scale instrument is labeled on the price pane (symbol comparison),
        // attach the main symbol's short name tag flush-left of the axis divider so every badge is
        // immediately identifiable on one glance.
        const hasLabeledOverlay =
            showLabel &&
            !!scene.symbolName &&
            scene.indicatorsForPane(pricePane.id).some((m) => m.priceAxisLabel === true && m.ownScale !== true && taggedPlots(m, n - 1 - scene.offsetOf(m.id)).length > 0);
        if (hasLabeledOverlay && scene.symbolName) {
            drawAxisNameTag(ctx, scene.symbolName, dataW, y, color, textColor);
        }

        if (showLabel && cdText !== null) {
            // Merged block: label row on top (centered on the price line), countdown row
            // under it. Same width, text flushed left.
            const w = Math.max(ctx.measureText(priceText).width, ctx.measureText(cdText).width) + PAD;
            const top = y - 8;
            const tx = x + PAD / 2;
            ctx.fillStyle = color;
            ctx.fillRect(x, top, w, 32);
            ctx.fillStyle = textColor;
            ctx.textAlign = 'left';
            ctx.fillText(priceText, tx, top + 8);
            ctx.fillText(cdText, tx, top + 24);
            ctx.textAlign = 'start';
            return;
        }

        // Lone label or countdown — centered on the price level, text centered.
        const text = showLabel ? priceText : (cdText ?? '');
        const w = ctx.measureText(text).width + PAD;
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 8, w, 16);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.fillText(text, x + w / 2, y);
        ctx.textAlign = 'start';
    }

    private drawTimeAxis(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, dataH: number, fullH: number): void {
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, dataH + 0.5);
        ctx.lineTo(dataW, dataH + 0.5);
        ctx.stroke();
        if (!scene.showAxisLabels) return;
        ctx.fillStyle = this.axisTextColor;
        ctx.textAlign = 'center';
        const y = dataH + (fullH - dataH) / 2;
        const tr = coords.visibleTimeRange();
        const offset = tzOffsetMs((tr.from + tr.to) / 2, displayZone(scene.timezone, coords.barInterval));
        // Width-adaptive density so a narrow surface — a phone, a multi-chart cell —
        // asks for fewer ticks instead of cramming the default eight. The floor of 3
        // keeps a narrow axis populated (a too-small target snaps the ladder to a huge
        // step whose few ticks can all miss the frame); the collision pass below is
        // what actually prevents overlap.
        const target = Math.max(3, Math.min(8, Math.floor(dataW / 64)));
        const ticks = timeTicks(tr.from, tr.to, target, offset, scene.format, coords.logicalToTime(0))
            .map((tick) => ({ ...tick, x: coords.timeToX(tick.time), half: ctx.measureText(tick.label).width / 2 }))
            .filter((tick) => tick.x >= 20 && tick.x <= dataW - 20);
        // Measured collision pass on top: label pitch in PIXELS isn't uniform (bar-index
        // mapping, session gaps), so overlapping labels are SKIPPED, majors placed first
        // (a date beats the 12:00 beside it).
        const GAP = 12; // min px between neighboring labels
        const placed: Array<{ l: number; r: number }> = [];
        const put = (tick: { x: number; half: number; label: string }): void => {
            const l = tick.x - tick.half;
            const r = tick.x + tick.half;
            if (!placed.every((p) => r + GAP <= p.l || l - GAP >= p.r)) return;
            placed.push({ l, r });
            ctx.fillText(tick.label, tick.x, y);
        };
        for (const tick of ticks) if (tick.major) put(tick);
        for (const tick of ticks) if (!tick.major) put(tick);
        ctx.textAlign = 'start';
    }
}


function unionRange(a: { min: number; max: number } | null, b: { min: number; max: number } | null): { min: number; max: number } | null {
    if (!a) return b;
    if (!b) return a;
    return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/** Draw a compact name pill flush-left of the right axis divider (inside the plot edge). */
function drawAxisNameTag(ctx: CanvasRenderingContext2D, name: string, dataW: number, y: number, fill: string, textColor: string): void {
    const PAD_X = 6;
    const H = 16;
    const w = Math.ceil(ctx.measureText(name).width) + PAD_X * 2;
    const x = dataW - w - 1;
    const top = y - H / 2;
    const r = 2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, top);
    ctx.lineTo(x + w, top);
    ctx.lineTo(x + w, top + H);
    ctx.lineTo(x + r, top + H);
    ctx.quadraticCurveTo(x, top + H, x, top + H - r);
    ctx.lineTo(x, top + r);
    ctx.quadraticCurveTo(x, top, x + r, top);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.fillText(name, x + w / 2, y);
    ctx.textAlign = 'start';
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

/**
 * The color of the latest price element for the active chart style — matches how the
 * series itself is drawn: candle/bar body up-down, the line/area line color, the
 * baseline side (above/below the baseline price), or the last column's up-down (worn
 * opaque: the line and label are thin chrome, not a filled area). Candles resolve
 * through the active style's own candle colors (a candle-based plugin style such as
 * Footprint or TPO keeps its own), exactly as the candle painter does; with bodies
 * hidden the candle reads as its outline, so the outline color is used.
 */
export function priceElementColor(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, last: OHLCV): string {
    const st = scene.style;
    switch (scene.priceStyle) {
        case 'bars':
            return last.close >= last.open ? (st.bars.upColor ?? theme.upColor) : (st.bars.downColor ?? theme.downColor);
        case 'line':
        case 'linemarkers':
        case 'stepline':
            return st.line.color ?? theme.upColor;
        case 'columns': {
            const up = columnIsUp(scene.bars, scene.bars.length - 1);
            return withAlpha(up ? (st.columns.upColor ?? theme.upColor) : (st.columns.downColor ?? theme.downColor), 1);
        }
        case 'area':
            return st.area.lineColor ?? theme.upColor;
        case 'baseline': {
            const i0 = Math.max(0, Math.floor(coords.visibleLogicalRange().from));
            const baseline = scene.baselineValue ?? scene.bars[i0]?.close ?? 0;
            return last.close >= baseline ? (st.baseline.topLineColor ?? theme.upColor) : (st.baseline.bottomLineColor ?? theme.downColor);
        }
        default: {
            // 'candles', 'heikinashi', and candle-based plugin styles.
            const paint = effectiveCandlePaint(st.candle, scene.candleOverride, theme.upColor, theme.downColor);
            const up = last.close >= last.open;
            const body = up ? paint.up : paint.down;
            if (!paint.candle.bodyVisible && paint.candle.borderVisible) {
                return (up ? paint.candle.borderUpColor : paint.candle.borderDownColor) ?? body;
            }
            return body;
        }
    }
}

/** `text`, cut with an ellipsis to fit `maxW` px in the context's current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
}
