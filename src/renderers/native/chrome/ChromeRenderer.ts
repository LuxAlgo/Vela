import type { VelaTheme } from '../../../core/options';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { LineStyle } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { percentScaleFor } from '../core/SceneGraph';
// Re-exported so existing importers (crosshair) can keep sourcing it from here.
export { percentScaleFor } from '../core/SceneGraph';
import { DrawingSceneRenderer, type DrawingSet } from '../../shared/DrawingSceneRenderer';
import { renderTradeMarkers } from '../../shared/trade-markers';
import type { TradeExecution } from '../../../core/model/trades';
import { paneAxisTicks, formatAxisValue, timeTicks } from './ticks';
import { axisColumnX, PANE_SEPARATOR_PX } from './axisLayout';
import { parseColor } from '../backend/gl/color';
import { DARK_THEME } from '../../../core/theme';
import { tzOffsetMs } from './tz';

/**
 * Renderer-owned chrome layer (canvas2d) on its own canvas, stacked above the
 * geometry layer (L0) and below the cursor layer (L2). It draws the things the
 * geometry backend can't (or shouldn't): Pine drawings (geometry + text TOGETHER,
 * preserving creation-order z-order), the per-pane price axes + labels, the time
 * axis + labels, and the current-price line + chip.
 *
 * It is ALWAYS canvas2d and independent of the geometry backend (canvas2d now,
 * WebGL2 later) — the GPU path never has to rasterize text. It also owns the
 * shared DrawingSceneRenderer, so it computes the drawing price-range that folds
 * into autoscale (`paneDrawingsRange`).
 */
export class ChromeRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    // The color for axis tick labels — the host-passed surface text, set each frame in render().
    private axisTextColor = DARK_THEME.textColor;
    // Shared Pine-drawing renderer (line/box/label/polyline/linefill); widthCache persists.
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
        for (const m of ownModels) dr = unionRange(dr, this.drawingsRange(this.ownDrawings(m), vr, scene.offsetOf(m.id)));
        if (isPricePane) for (const m of scene.indicators.values()) dr = unionRange(dr, this.drawingsRange(this.overlayDrawings(m), vr, scene.offsetOf(m.id)));
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

        // ── Pine drawings — above series. Own drawings on each model's pane;
        //    force_overlay drawings on the price pane (Pine semantics). A merged (own-scale)
        //    indicator's drawings follow its own scale column. ──
        for (const pane of panes) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no drawings/plots
            for (const m of scene.indicatorsForPane(pane.id)) {
                const sc = scene.scaleFor(m, pane);
                const mp = sc === pane.scale ? pane : { ...pane, scale: sc };
                this.renderDrawings(ctx, coords, this.ownDrawings(m), mp, dataW, scene.offsetOf(m.id));
            }
        }
        if (pricePane) {
            for (const m of scene.indicators.values()) this.renderDrawings(ctx, coords, this.overlayDrawings(m), pricePane, dataW, scene.offsetOf(m.id));
        }

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
        this.drawTimeAxis(ctx, scene, coords, theme, dataW, dataH, fullH);
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    // ── Pine-drawing helpers (own vs force_overlay routing) ──
    private ownDrawings(m: IndicatorModel): DrawingSet {
        return {
            lines: (m.lines ?? []).filter((d) => !d.overlay),
            boxes: (m.boxes ?? []).filter((d) => !d.overlay),
            labels: (m.labels ?? []).filter((d) => !d.overlay),
            polylines: (m.polylines ?? []).filter((d) => !d.overlay),
            linefills: (m.linefills ?? []).filter((d) => !d.overlay),
        };
    }

    private overlayDrawings(m: IndicatorModel): DrawingSet {
        return {
            lines: (m.lines ?? []).filter((d) => d.overlay),
            boxes: (m.boxes ?? []).filter((d) => d.overlay),
            labels: (m.labels ?? []).filter((d) => d.overlay),
            polylines: (m.polylines ?? []).filter((d) => d.overlay),
            linefills: (m.linefills ?? []).filter((d) => d.overlay),
        };
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

    private renderDrawings(ctx: CanvasRenderingContext2D, coords: CoordinateSystem, set: DrawingSet, pane: PaneNode, dataW: number, indexOffset = 0): void {
        this.drawScene.setSet(set, indexOffset);
        if (this.drawScene.isEmpty()) return;
        ctx.save();
        ctx.translate(0, pane.bounds.top); // pane-relative space (drawings use [0, H])
        ctx.beginPath();
        ctx.rect(0, 0, dataW, pane.bounds.height);
        ctx.clip();
        this.drawScene.render(
            ctx,
            dataW,
            pane.bounds.height,
            (l) => coords.logicalToX(l),
            (price) => coords.priceToY(price, pane.scale, pane.bounds) - pane.bounds.top,
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
        const n = scene.bars.length;
        // A hidden price series takes its current-price line/label/countdown down with it —
        // as does a hidden price PANE (collapsed, or zero-height while a study pane is maximized).
        if (!pricePane || n === 0 || scene.candlesHidden || pricePane.collapsed || pricePane.bounds.height <= 0) return;
        const last = scene.bars[n - 1]!;
        const y = coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
        if (y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) return;
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
        const interval = coords.barInterval;
        const showCountdown = scene.showCountdown && interval > 0;
        const showLabel = scene.showPriceLabel;
        if (!showLabel && !showCountdown) return;

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

