import type { VelaTheme } from '../../../core/options';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { LineStyle } from '../../../core/model/series';
import type { PriceLine } from '../../../core/model/scene';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { percentScaleFor } from '../core/SceneGraph';
// Re-exported so existing importers (crosshair) can keep sourcing it from here.
export { percentScaleFor } from '../core/SceneGraph';
import { DrawingSceneRenderer, modelDrawingSet, type DrawingSet } from '../../shared/DrawingSceneRenderer';
import { renderTradeMarkers } from '../../shared/trade-markers';
import type { TradeExecution } from '../../../core/model/trades';
import { paneAxisTicks, formatAxisValue, timeTicks } from './ticks';
import { axisColumnX, PANE_SEPARATOR_PX } from './axisLayout';
import { parseColor } from '../backend/gl/color';
import { DARK_THEME } from '../../../core/theme';
import { tzOffsetMs } from './tz';

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

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
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
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

        // ── axes + current-price line + countdown ──
        this.drawPriceAxes(ctx, scene, coords, theme, dataW, panes);
        this.drawMergedScaleColumns(ctx, scene, coords, dataW);
        this.drawPaneSeparators(ctx, scene, theme, fullW, panes);
        this.drawPriceLineAndCountdown(ctx, scene, coords, theme, dataW, pricePane);
        this.drawPriceLineTags(ctx, scene, coords, theme, dataW, panes, pricePane);
        this.drawTimeAxis(ctx, scene, coords, theme, dataW, dataH, fullH);
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
        for (const pane of panes) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no scale numbers
            const pct = percentScaleFor(scene, pane);
            for (const t of paneAxisTicks(pane.scale, pane.bounds.height, pct, scene.priceMintick, pane.axisFormat)) {
                const y = coords.priceToY(t.price, pane.scale, pane.bounds);
                if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                ctx.fillText(t.label, dataW + 6, y);
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
                for (const t of paneAxisTicks(sc, pane.bounds.height, undefined, scene.priceMintick)) {
                    const y = coords.priceToY(t.price, sc, pane.bounds);
                    if (y < pane.bounds.top + 6 || y > pane.bounds.top + pane.bounds.height - 4) continue;
                    ctx.fillText(t.label, x + 5, y);
                }
            });
        }
        ctx.textAlign = 'start';
    }

    /**
     * The latest-price chrome on the price pane, all colored with the price element's own
     * color (candle/bar up-down, line, area, or baseline side) and white text:
     *  - the dashed current-price LINE (`showPriceLine`) — fully independent of the label,
     *  - the last-price LABEL chip (`showPriceLabel`),
     *  - the countdown-to-bar-close chip (`showCountdown`).
     * When the label and countdown are both on they merge into one stacked block (countdown
     * under the label, text flushed left); a lone label or countdown is centered on the
     * price level with centered text. The countdown ticks once per second (repaint scheduled).
     */
    private drawPriceLineAndCountdown(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, pricePane: PaneNode | null): void {
        if (!pricePane) return;
        // The dashed line is independent of the label/countdown chip, but shares the SAME
        // base visibility (hidden price series/pane, no bars, the close out of view) —
        // `currentPriceY` is the one place that gate lives, so this and the chip (and its
        // axis-tag reservation below) can never disagree on whether/where it sits.
        const y = currentPriceY(scene, coords, pricePane);
        if (y === null) return;
        const last = scene.bars[scene.bars.length - 1]!;
        const color = this.priceElementColor(scene, coords, theme, last);

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
        const chip = currentPriceChipGeometry(scene, coords, pricePane);
        if (!chip) return;
        const { showLabel, showCountdown } = chip;
        const interval = coords.barInterval;

        const priceText = formatAxisValue(pricePane.scale, pricePane.bounds.height, last.close, percentScaleFor(scene, pricePane), scene.priceMintick);
        const cdText = showCountdown ? formatCountdown(last.time + interval - Date.now()) : '';
        const PAD = 8;
        const x = dataW + 1;
        // Text color chosen for contrast against the chip's own color (so a white candle
        // color yields dark text, a dark color yields light text).
        const textColor = tagTextColor(color, theme.background);
        ctx.textBaseline = 'middle';

        if (showLabel && showCountdown) {
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
        const text = showLabel ? priceText : cdText;
        const w = ctx.measureText(text).width + PAD;
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 8, w, 16);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.fillText(text, x + w / 2, y);
        ctx.textAlign = 'start';
    }

    /**
     * Arbitrary price-line gutter tags (an indicator's `PriceLine.axisLabel`), one small
     * chip per opted-in line, styled like the lone last-price chip above (same height,
     * same centered-text/contrast-picked layout) but keyed to the LINE's own color instead
     * of the price element's. Lines without `axisLabel` draw no chip — only the horizontal
     * line itself (painted by the geometry backends, unaffected by this method). A hidden
     * or removed indicator's model simply isn't in `scene.indicators` anymore, so its tags
     * vanish with it; a collapsed pane is skipped like every other axis chrome here. On the
     * PRICE pane, tags also avoid the built-in current-price/countdown chip's own occupied
     * rows (`currentPriceChipInterval`) — the one chip this layer draws outside this method.
     */
    private drawPriceLineTags(ctx: CanvasRenderingContext2D, scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, dataW: number, panes: PaneNode[], pricePane: PaneNode | null): void {
        if (!scene.showAxisLabels) return; // the tags live in the axis gutter, same master toggle as the ticks
        const x = dataW + 1;
        ctx.textBaseline = 'middle';
        const reservedOnPricePane = currentPriceChipInterval(scene, coords, pricePane);
        for (const pane of panes) {
            if (pane.collapsed) continue;
            const tags: PriceLineTag[] = [];
            for (const model of scene.orderedIndicatorsForPane(pane.id)) {
                if (model.priceLines.length === 0) continue;
                const scale = scene.scaleFor(model, pane);
                // A merged (own-scale) indicator's line reads its OWN scale, absolute —
                // it doesn't follow the pane's percent/indexed mode, same as its axis column.
                const pct = model.ownScale === true ? undefined : percentScaleFor(scene, pane);
                for (const pl of model.priceLines) {
                    const tag = this.priceLineTag(ctx, pl, pane, scale, pct, scene.priceMintick, coords, theme);
                    if (tag) tags.push(tag);
                }
            }
            if (tags.length === 0) continue;
            const reserved = pane === pricePane ? reservedOnPricePane : null;
            for (const tag of layoutPriceLineTags(tags, reserved)) {
                ctx.fillStyle = tag.background;
                ctx.fillRect(x, tag.y - PRICE_LINE_TAG_HEIGHT / 2, tag.width, PRICE_LINE_TAG_HEIGHT);
                ctx.fillStyle = tag.textColor;
                ctx.textAlign = 'center';
                ctx.fillText(tag.text, x + tag.width / 2, tag.y);
            }
        }
        ctx.textAlign = 'start';
    }

    /** One opted-in line → its tag geometry/paint, or null when the line has no `axisLabel`
     *  or its price sits outside the pane's visible window (nothing to clip against). */
    private priceLineTag(
        ctx: CanvasRenderingContext2D,
        pl: PriceLine,
        pane: PaneNode,
        scale: { min: number; max: number; log?: boolean },
        pct: ReturnType<typeof percentScaleFor>,
        mintick: number | undefined,
        coords: CoordinateSystem,
        theme: VelaTheme,
    ): PriceLineTag | null {
        if (!pl.axisLabel) return null;
        const y = coords.priceToY(pl.price, scale, pane.bounds);
        if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) return null;
        const custom = pl.axisLabel === true ? undefined : pl.axisLabel;
        const text = custom?.text ?? formatAxisValue(scale, pane.bounds.height, pl.price, pct, mintick);
        const background = custom?.background ?? pl.color ?? this.axisTextColor;
        const width = ctx.measureText(text).width + 8;
        return { y, text, width, background, textColor: tagTextColor(background, theme.background) };
    }

    /**
     * The color of the latest price element for the active chart style — matches how the
     * series itself is drawn: candle/bar body up-down, the line/area line color, or the
     * baseline side (above/below the baseline price).
     */
    private priceElementColor(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, last: OHLCV): string {
        const st = scene.style;
        switch (scene.priceStyle) {
            case 'bars':
                return last.close >= last.open ? (st.bars.upColor ?? theme.upColor) : (st.bars.downColor ?? theme.downColor);
            case 'line':
                return st.line.color ?? theme.upColor;
            case 'area':
                return st.area.lineColor ?? theme.upColor;
            case 'baseline': {
                const i0 = Math.max(0, Math.floor(coords.visibleLogicalRange().from));
                const baseline = scene.baselineValue ?? scene.bars[i0]?.close ?? 0;
                return last.close >= baseline ? (st.baseline.topLineColor ?? theme.upColor) : (st.baseline.bottomLineColor ?? theme.downColor);
            }
            default: // 'candles'
                return last.close >= last.open ? theme.upColor : theme.downColor;
        }
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
        const offset = tzOffsetMs((tr.from + tr.to) / 2, scene.timezone);
        // Width-adaptive density so a narrow surface — a phone, a multi-chart cell —
        // asks for fewer ticks instead of cramming the default eight. The floor of 3
        // keeps a narrow axis populated (a too-small target snaps the ladder to a huge
        // step whose few ticks can all miss the frame); the collision pass below is
        // what actually prevents overlap.
        const target = Math.max(3, Math.min(8, Math.floor(dataW / 64)));
        const ticks = timeTicks(tr.from, tr.to, target, offset)
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

/**
 * The last bar's close mapped to pixels on the price pane, or null when the current-price
 * chrome (dashed line, label chip, countdown chip) is fully suppressed: no price pane, no
 * bars loaded, the price series/pane hidden or collapsed, a zero-height pane, or the close
 * outside the pane's visible window. The ONE place this bail-out lives, so the dashed line,
 * the chip's own paint, and the axis-tag reservation below can never disagree on whether —
 * or where — the latest price sits.
 */
function currentPriceY(scene: SceneGraph, coords: CoordinateSystem, pricePane: PaneNode | null): number | null {
    const n = scene.bars.length;
    if (!pricePane || n === 0 || scene.candlesHidden || pricePane.collapsed || pricePane.bounds.height <= 0) return null;
    const last = scene.bars[n - 1]!;
    const y = coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
    if (y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) return null;
    return y;
}

/** The built-in current-price chip's paint geometry — its y and which of the label/countdown
 *  rows show — or null when the chip itself is suppressed (on top of `currentPriceY`'s own
 *  gate, neither the label nor the countdown enabled). Shared by `drawPriceLineAndCountdown`
 *  (the chip's own paint) and `currentPriceChipInterval` below (the space OTHER axis tags
 *  reserve around it), so the two can never drift on visibility, `y`, or which rows show. */
function currentPriceChipGeometry(scene: SceneGraph, coords: CoordinateSystem, pricePane: PaneNode | null): { y: number; showLabel: boolean; showCountdown: boolean } | null {
    const y = currentPriceY(scene, coords, pricePane);
    if (y === null) return null;
    const showCountdown = scene.showCountdown && coords.barInterval > 0;
    const showLabel = scene.showPriceLabel;
    if (!showLabel && !showCountdown) return null;
    return { y, showLabel, showCountdown };
}

/** The built-in current-price chip's occupied vertical pixel interval, for arbitrary
 *  `PriceLine.axisLabel` tags to reserve space around — `[y-8, y+8]` for a lone label or
 *  countdown, `[y-8, y+24]` for the merged (label + countdown) block, matching the chip's
 *  own layout in `drawPriceLineAndCountdown` exactly. Null when the chip doesn't show. */
function currentPriceChipInterval(scene: SceneGraph, coords: CoordinateSystem, pricePane: PaneNode | null): { top: number; bottom: number } | null {
    const chip = currentPriceChipGeometry(scene, coords, pricePane);
    if (!chip) return null;
    const bottom = chip.showLabel && chip.showCountdown ? chip.y + 24 : chip.y + 8;
    return { top: chip.y - 8, bottom };
}

/** One resolved `PriceLine.axisLabel` tag, ready to paint (pixel `y`, measured `width`). */
interface PriceLineTag {
    y: number;
    text: string;
    width: number;
    background: string;
    textColor: string;
}

const PRICE_LINE_TAG_HEIGHT = 16;
const PRICE_LINE_TAG_GAP = 2; // min px between two stacked tags, after the collision pass

/**
 * Deterministic vertical declutter for a pane's price-line tags: sorted top-to-bottom by
 * their natural (price-mapped) top edge, each is pushed down just enough to clear whatever
 * sits directly above it. Unlike the time axis (which SKIPS a colliding tick), a tag is never
 * dropped — it's an indicator's explicit opt-in, not a generated ladder — so a busy pane
 * instead reads as a tight, still-legible stack rather than overlapping text.
 *
 * `reserved` (the PRICE pane's built-in current-price/countdown chip interval, or null on
 * every other pane / when that chip isn't showing) is folded into the SAME sweep as a
 * phantom, unlabeled obstacle at its own fixed slot — so a tag that would otherwise land on
 * top of the built-in chip is pushed clear of it exactly like it would be pushed clear of a
 * neighboring tag, while a tag already clear of it is left at its natural position.
 */
function layoutPriceLineTags(tags: PriceLineTag[], reserved: { top: number; bottom: number } | null): PriceLineTag[] {
    interface Slot {
        tag: PriceLineTag | null; // null ⇒ the reserved chip's phantom slot (nothing to paint)
        top: number;
        bottom: number;
    }
    const slots: Slot[] = tags.map((tag) => ({ tag, top: tag.y - PRICE_LINE_TAG_HEIGHT / 2, bottom: tag.y + PRICE_LINE_TAG_HEIGHT / 2 }));
    if (reserved) slots.push({ tag: null, top: reserved.top, bottom: reserved.bottom });
    // Ties (a tag landing exactly on the chip's own slot) resolve chip-first — the built-in
    // chip never moves, so the ONLY way to clear a tie is displacing the arbitrary tag.
    slots.sort((a, b) => a.top - b.top || (a.tag === null ? -1 : b.tag === null ? 1 : 0));
    let prevBottom = -Infinity;
    for (const slot of slots) {
        const top = Math.max(slot.top, prevBottom);
        if (slot.tag) slot.tag.y = top + PRICE_LINE_TAG_HEIGHT / 2;
        prevBottom = top + (slot.bottom - slot.top) + PRICE_LINE_TAG_GAP;
    }
    return tags;
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

/**
 * White or black text for a colored price tag, biased toward white so saturated brand
 * colors (the default candle green / red sit at L≈0.22–0.24) read as white,
 * while genuinely light colors (a white or pale candle color) still get dark text. Uses
 * relative luminance with a flip point of 0.4 — higher than `readableText`'s WCAG crossover
 * (~0.18) which perceptually over-picks black on mid-tone fills. Translucent `bg` is
 * composited over `over` first so the choice reflects what's actually seen.
 */
function tagTextColor(bg: string, over: string): string {
    const [r, g, b, a] = parseColor(bg);
    let R = r;
    let G = g;
    let B = b;
    if (a < 1) {
        const [or, og, ob] = parseColor(over);
        R = r * a + or * (1 - a);
        G = g * a + og * (1 - a);
        B = b * a + ob * (1 - a);
    }
    const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
    return L >= 0.4 ? '#000000' : '#ffffff';
}

/** `M:SS` (or `H:MM:SS` past an hour) for the ms remaining until the bar closes; clamped at 0. */
function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (v: number): string => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

