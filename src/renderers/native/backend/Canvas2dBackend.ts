import type { VelaTheme } from '../../../core/options';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { Fill, Background, PriceLine } from '../../../core/model/scene';
import type { SeriesSpec, LineLikeSeries, CandleSeries, LineStyle, CandleBarColor } from '../../../core/model/series';
import { isLineLikeSeries } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { candleTier, wickWidth, candleGeometry, snapY } from './candle-lod';
import { BASELINE_TOP_LINE, BASELINE_BOTTOM_LINE, BASELINE_FILL_ALPHA, BASELINE_FILL_ALPHA_FAR, withAlpha, effectiveCandlePaint } from '../core/chartConfig';
import type { IRenderBackend } from './IRenderBackend';

/**
 * Canvas2d GEOMETRY backend (L0) — the PRIMARY native backend and the WebGL2
 * backend's permanent fallback. Renders immediate-mode from the scene each frame,
 * culled to the visible bar range: bgcolor, fills (flat/conditional/gradient),
 * candles, line/area/step/histogram/columns/circles/cross with per-point/per-bar
 * color, hline. Per-pane price scales are computed by the renderer BEFORE this
 * runs (it reads pane.scale). Pine drawings, axes, the current-price line, and the
 * crosshair are NOT its concern — they live on the canvas2d chrome (ChromeRenderer)
 * and cursor (CrosshairRenderer) layers above; the grid + session highlights live
 * on the backdrop canvas below (BackdropRenderer).
 */
export class Canvas2dBackend implements IRenderBackend {
    readonly kind = 'canvas2d' as const;
    modelAlpha = 1;
    candleBodyAlpha = 1;
    candleStructureAlpha = 1;
    candleBodyScale = 1;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;

        const dpr = coords.dpr;
        const fullW = canvas.width / dpr;
        const fullH = canvas.height / dpr;
        const dataW = coords.width; // excludes the right price-axis strip

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, fullW, fullH);

        const n = coords.barCount;
        if (n === 0) return;
        const vr = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(vr.from));
        const i1 = Math.min(n - 1, Math.ceil(vr.to));
        if (i1 < i0) return;

        const barColorMap = mergeBarColors(scene.indicators);
        const panes = scene.orderedPanes();

        // Session highlights + the grid paint on the renderer's BACKDROP canvas, below
        // every layer canvas (see backdrop/BackdropRenderer) — nothing to do here.

        // ── per-pane data (pane.scale was set by the renderer's autoscale) ──
        for (const pane of panes) {
            // A collapsed pane is a legend-only strip — draw no plots (its separator + legend remain).
            if (pane.collapsed) continue;
            // Indicators sorted by foreground z; the candles are one orderable layer at
            // `scene.candleZ`, so an overlay with z below it draws BEHIND the candles.
            const models = scene.orderedIndicatorsForPane(pane.id);
            const isPrice = pane.kind === 'price';
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, pane.bounds.top, dataW, pane.bounds.height);
            ctx.clip();

            // A merged (own-scale) indicator draws against its own price window inside the pane;
            // everything else against the pane's master scale. `effPane` swaps only the scale.
            const effPane = (m: IndicatorModel): PaneNode => {
                const sc = scene.scaleFor(m, pane);
                return sc === pane.scale ? pane : { ...pane, scale: sc };
            };

            // Behind everything: backgrounds + fills (kept under the candle/series layers).
            // Own (non-force_overlay) content on each model's pane; force_overlay content
            // on the price pane against its MASTER scale, whatever pane the indicator owns
            // (Pine semantics — mirrors the chrome's overlay-drawing routing).
            ctx.globalAlpha = this.modelAlpha; // indicator models fade in after the intro; candles stay opaque
            for (const m of models) for (const bg of m.backgrounds) if (bg.overlay !== true) this.drawBackground(ctx, bg, pane, coords);
            for (const m of models) for (const f of m.fills) if (f.overlay !== true) this.drawFill(ctx, m, f, effPane(m), coords, i0, i1, scene.offsetOf(m.id));
            if (isPrice) {
                for (const m of scene.indicators.values()) {
                    for (const bg of m.backgrounds) if (bg.overlay === true) this.drawBackground(ctx, bg, pane, coords);
                    for (const f of m.fills) if (f.overlay === true) this.drawFill(ctx, m, f, pane, coords, i0, i1, scene.offsetOf(m.id));
                }
            }

            // User-drawing interleave layers, prepainted by the renderer: each composites just
            // before the series carrying its `beforeZ`, so a drawing can sit under the candles
            // or between two indicators. Full-opacity — drawings don't fade with the models.
            const slices = scene.drawingSlices.get(pane.id) ?? [];
            let si = 0;
            const drawSlicesUpTo = (z: number): void => {
                for (; si < slices.length && slices[si]!.beforeZ <= z; si += 1) {
                    ctx.globalAlpha = 1;
                    ctx.drawImage(slices[si]!.canvas, 0, 0, fullW, fullH);
                }
            };

            // Foreground: candles + each indicator's series, interleaved by z-order.
            // When the price is hidden, the candle layer is skipped entirely (overlays still draw).
            const drawCandles = isPrice && !scene.candlesHidden;
            let candleDrawn = false;
            for (const m of models) {
                if (drawCandles && !candleDrawn && scene.zOf(m.id) >= scene.candleZ) {
                    drawSlicesUpTo(scene.candleZ);
                    ctx.globalAlpha = this.candleStructureAlpha; // baseline; drawCandles sets body vs structure per-element
                    this.drawPriceSeries(ctx, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                    candleDrawn = true;
                }
                drawSlicesUpTo(scene.zOf(m.id));
                ctx.globalAlpha = this.modelAlpha;
                // Model data is index-aligned from the model's ANCHOR bar (offset 0 = whole-chart).
                const off = scene.offsetOf(m.id);
                const mp = effPane(m);
                for (const s of m.series) if (s.overlay !== true) this.drawSeries(ctx, s, mp, coords, i0, i1, theme, off);
            }
            if (drawCandles && !candleDrawn) {
                drawSlicesUpTo(scene.candleZ);
                ctx.globalAlpha = this.candleStructureAlpha;
                this.drawPriceSeries(ctx, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
            }
            drawSlicesUpTo(Infinity); // layers bound to a hidden/removed series still paint, at the stack top

            // force_overlay series from EVERY indicator paint on the price pane, at the top
            // of its series stack, against the master price scale.
            if (isPrice) {
                ctx.globalAlpha = this.modelAlpha;
                for (const m of scene.indicators.values()) {
                    const off = scene.offsetOf(m.id);
                    for (const s of m.series) if (s.overlay === true) this.drawSeries(ctx, s, pane, coords, i0, i1, theme, off);
                }
            }

            // On top: price lines.
            ctx.globalAlpha = this.modelAlpha;
            for (const m of models) { const mp = effPane(m); for (const pl of m.priceLines) this.drawHline(ctx, pl, mp, coords, dataW, theme); }

            ctx.restore();
        }
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    // ── base price series (chart type) ──
    /**
     * Draw the base price series in the configured style: candlesticks, OHLC bars,
     * line, area, or baseline. All stay time-indexed.
     */
    private drawPriceSeries(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
        dataW: number,
    ): void {
        if (scene.basePainting === 'none') return; // plugin style fully replaces the price series
        const bars = scene.bars;
        const st = scene.style;
        switch (scene.priceStyle) {
            case 'bars':
                this.drawBars(ctx, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, barColors);
                return;
            case 'line':
                this.drawPriceLine(ctx, bars, i0, i1, coords, pane, st.line.color ?? theme.upColor, st.line.width);
                return;
            case 'area': {
                const lineColor = st.area.lineColor ?? theme.upColor;
                this.drawPriceArea(ctx, bars, i0, i1, coords, pane, st.area.topColor ?? lineColor, st.area.bottomColor ?? 'rgba(0,0,0,0)');
                this.drawPriceLine(ctx, bars, i0, i1, coords, pane, lineColor, st.area.width);
                return;
            }
            case 'baseline':
                this.drawBaseline(ctx, bars, i0, i1, coords, pane, scene, theme, dataW);
                return;
            default: // 'candles' + candle-drawn styles (a plugin style may fade candles to reveal its
                // order-flow layer) and 'heikinashi' (the bars themselves arrive already transformed)
                this.drawCandles(ctx, scene, bars, i0, i1, coords, pane, theme, barColors);
        }
    }

    /** OHLC bars: high-low stick + left open tick + right close tick (no body). */
    private drawBars(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        up: string,
        down: string,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, up, down, barColors);
            return;
        }
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        const drawTicks = tier === 'full';
        ctx.lineWidth = 1;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const color = barColors.get(b.time) ?? (b.close >= b.open ? up : down);
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            if (drawTicks) {
                const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
                ctx.moveTo(x - tickW, oY);
                ctx.lineTo(x, oY);
                ctx.moveTo(x, cY);
                ctx.lineTo(x + tickW, cY);
            }
            ctx.stroke();
        }
    }

    /** Close-price line (also the top stroke of the area style). */
    private drawPriceLine(ctx: CanvasRenderingContext2D, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, color: string, width: number): void {
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        ctx.beginPath();
        let started = false;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) {
                started = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    /** Filled area under the close line: a vertical gradient from `topColor` (at the
     *  line) to `bottomColor` (at the pane floor). Defaults fade the line color out. */
    private drawPriceArea(ctx: CanvasRenderingContext2D, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, topColor: string, bottomColor: string): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const pts: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(b.close, pane.scale, pane.bounds);
            pts.push({ x, y });
            if (y < minY) minY = y;
        }
        if (pts.length < 2) return;
        const g = ctx.createLinearGradient(0, minY, 0, baseY);
        g.addColorStop(0, topColor);
        g.addColorStop(1, bottomColor);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, baseY);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1]!.x, baseY);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Baseline style: the close line split at a baseline price — filled+stroked with
     * the up color above the baseline and the down color below it, each fading to
     * transparent at the baseline. Clipping (not geometry-splitting) does the split.
     */
    private drawBaseline(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        scene: SceneGraph,
        theme: VelaTheme,
        dataW: number,
    ): void {
        const baseline = scene.baselinePriceFor(pane.scale);
        const baseY = coords.priceToY(baseline, pane.scale, pane.bounds);
        const top = pane.bounds.top;
        const bottom = pane.bounds.top + pane.bounds.height;
        const bs = scene.style.baseline;
        const topLine = bs.topLineColor ?? BASELINE_TOP_LINE;
        const bottomLine = bs.bottomLineColor ?? BASELINE_BOTTOM_LINE;
        const topFill = bs.topFillColor ?? withAlpha(topLine, BASELINE_FILL_ALPHA);
        const topFill2 = bs.topFillColor2 ?? withAlpha(topLine, BASELINE_FILL_ALPHA_FAR);
        const bottomFill = bs.bottomFillColor ?? withAlpha(bottomLine, BASELINE_FILL_ALPHA);
        const bottomFill2 = bs.bottomFillColor2 ?? withAlpha(bottomLine, BASELINE_FILL_ALPHA_FAR);
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const b = bars[i];
            if (!b) continue;
            pts.push({ x: coords.logicalToX(i), y: coords.priceToY(b.close, pane.scale, pane.bounds) });
        }
        if (pts.length < 2) return;
        const poly = (): void => {
            ctx.beginPath();
            ctx.moveTo(pts[0]!.x, baseY);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1]!.x, baseY);
            ctx.closePath();
        };
        // Above the baseline: top fill near the line → fainter top fill at the baseline.
        if (baseY > top) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, top, dataW, baseY - top);
            ctx.clip();
            const gUp = ctx.createLinearGradient(0, top, 0, baseY);
            gUp.addColorStop(0, topFill);
            gUp.addColorStop(1, topFill2);
            ctx.fillStyle = gUp;
            poly();
            ctx.fill();
            ctx.restore();
        }
        // Below the baseline: fainter bottom fill at the baseline → bottom fill near the line.
        if (baseY < bottom) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, baseY, dataW, bottom - baseY);
            ctx.clip();
            const gDn = ctx.createLinearGradient(0, baseY, 0, bottom);
            gDn.addColorStop(0, bottomFill2);
            gDn.addColorStop(1, bottomFill);
            ctx.fillStyle = gDn;
            poly();
            ctx.fill();
            ctx.restore();
        }
        // The baseline marker, then the close line colored per segment by its side.
        ctx.strokeStyle = scene.style.borderColor ?? theme.borderColor;
        ctx.lineWidth = 1;
        setDash(ctx, 'dashed');
        ctx.beginPath();
        ctx.moveTo(0, Math.round(baseY) + 0.5);
        ctx.lineTo(dataW, Math.round(baseY) + 0.5);
        ctx.stroke();
        setDash(ctx, 'solid');
        ctx.lineWidth = bs.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const seg = (x0: number, y0: number, x1: number, y1: number, color: string): void => {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        };
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            const aUp = a.y <= baseY;
            const cUp = c.y <= baseY;
            // Split the segment AT the baseline so each side is colored correctly — a
            // segment must never be the up color below the baseline (or vice versa).
            if (aUp !== cUp && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                seg(a.x, a.y, xCross, baseY, aUp ? topLine : bottomLine);
                seg(xCross, baseY, c.x, c.y, cUp ? topLine : bottomLine);
            } else {
                seg(a.x, a.y, c.x, c.y, aUp ? topLine : bottomLine);
            }
        }
        ctx.lineCap = 'butt';
    }

    // ── data ──
    private drawCandles(
        ctx: CanvasRenderingContext2D,
        scene: SceneGraph,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
    ): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        // A candle-based plugin style paints with its OWN cosmetics (unset keys inherit
        // the shared candles block); built-ins pass through untouched.
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        if (tier === 'aggregate') {
            this.drawCandlesAggregated(ctx, bars, i0, i1, coords, pane, paint.up, paint.down, barColors);
            return;
        }
        const drawBody = tier === 'full';
        const cs = paint.candle;
        // When a fading style drops the body below the structure, draw a body outline even
        // if no border is configured — so the candle keeps a visible (hollow) skeleton.
        const fading = this.candleStructureAlpha > this.candleBodyAlpha + 0.001;
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue; // skip zero-range candles (e.g. the intro reveal's un-started state)
            // Wick + body snapped to the device grid as one unit, so the wick is always
            // dead-center in the body and the gap between candles stays uniform.
            const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);
            const x = g.center;
            const up = b.close >= b.open;
            const dir = up ? paint.up : paint.down;
            const bc = barColors.get(b.time);
            const color = bc ?? dir;
            // Body geometry up front so the wick can be clipped to it when the body is hollow.
            let top = 0;
            let bodyH = 0;
            if (drawBody) {
                const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
                // Both edges snapped to the device grid so the horizontal edges rasterize
                // crisp (no blended rim); a doji keeps a visible 1-device-px body.
                top = snapY(Math.min(oY, cY), coords.dpr);
                bodyH = Math.max(1 / coords.dpr, snapY(Math.max(oY, cY), coords.dpr) - top);
            }
            if (cs.wickVisible) {
                // barcolor() recolors only the BODY (TV semantics): the wick keeps the
                // direction color while a body is drawn. At stick-only zoom the stick IS
                // the candle, so it keeps the barcolor tint.
                const wick = (up ? cs.wickUpColor : cs.wickDownColor) ?? (drawBody ? dir : color);
                const hY = snapY(coords.priceToY(b.high, pane.scale, pane.bounds), coords.dpr);
                const lY = snapY(coords.priceToY(b.low, pane.scale, pane.bounds), coords.dpr);
                ctx.globalAlpha = this.candleStructureAlpha;
                ctx.strokeStyle = wick;
                ctx.lineWidth = g.wickW;
                ctx.beginPath();
                if (drawBody) {
                    // Draw the wick only outside the body, so it never shows through it — including
                    // hollow bodies and semi-transparent fills.
                    ctx.moveTo(x, hY);
                    ctx.lineTo(x, top);
                    ctx.moveTo(x, top + bodyH);
                    ctx.lineTo(x, lY);
                } else {
                    ctx.moveTo(x, hY);
                    ctx.lineTo(x, lY);
                }
                ctx.stroke();
            }
            if (drawBody) {
                if (cs.bodyVisible) {
                    ctx.globalAlpha = this.candleBodyAlpha;
                    ctx.fillStyle = color;
                    ctx.fillRect(g.bodyX, top, g.bodyW, bodyH);
                }
                // The border strictly follows its visibility setting — barcolor() never
                // forces one. An unconfigured border color inherits the body color, so a
                // barcolored body gets a matching tinted border, not a direction-colored
                // outline.
                if (cs.borderVisible || (fading && cs.bodyVisible)) {
                    ctx.globalAlpha = this.candleStructureAlpha;
                    ctx.strokeStyle = cs.borderVisible ? ((up ? cs.borderUpColor : cs.borderDownColor) ?? color) : color;
                    ctx.lineWidth = 1;
                    // Inset by half the stroke so the border lands on whole pixels
                    // (crisp) and stays inside the body's snapped footprint.
                    const bw = Math.max(0, g.bodyW - 1);
                    const bh = Math.max(0, bodyH - 1);
                    ctx.strokeRect(g.bodyX + 0.5, top + 0.5, bw, bh);
                }
            }
        }
    }

    /**
     * Sub-pixel LOD: bucket every bar sharing a rounded pixel column into ONE
     * high-low stick, so draw cost is bounded by screen width (not bar count) when
     * zoomed far out. The bucket's color follows its first-open→last-close
     * direction (a barcolor() on the head bar still wins).
     */
    private drawCandlesAggregated(
        ctx: CanvasRenderingContext2D,
        bars: OHLCV[],
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        up: string,
        down: string,
        barColors: ReadonlyMap<number, string>,
    ): void {
        let px = NaN;
        let lo = Infinity;
        let hi = -Infinity;
        let openV = 0;
        let closeV = 0;
        let headTime = 0;
        let active = false;
        const flush = (): void => {
            if (!active) return;
            const color = barColors.get(headTime) ?? (closeV >= openV ? up : down);
            const hY = coords.priceToY(hi, pane.scale, pane.bounds);
            const lY = coords.priceToY(lo, pane.scale, pane.bounds);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, hY);
            ctx.lineTo(px, lY);
            ctx.stroke();
        };
        for (let i = i0; i <= i1; i += 1) {
            const b = bars[i];
            if (!b || b.high <= b.low) continue;
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            if (!active || x !== px) {
                flush();
                px = x;
                lo = b.low;
                hi = b.high;
                openV = b.open;
                headTime = b.time;
                active = true;
            } else {
                if (b.low < lo) lo = b.low;
                if (b.high > hi) hi = b.high;
            }
            closeV = b.close;
        }
        flush();
    }

    private drawSeries(ctx: CanvasRenderingContext2D, spec: SeriesSpec, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        if (spec.kind === 'candle' || spec.kind === 'bar') {
            this.drawPlotCandles(ctx, spec, pane, coords, i0, i1, theme, off);
            return;
        }
        if (!isLineLikeSeries(spec) || spec.visible === false) return;
        switch (spec.kind) {
            case 'histogram':
            case 'columns':
                this.drawHistogram(ctx, spec, pane, coords, i0, i1, off);
                break;
            case 'area':
                this.drawArea(ctx, spec, pane, coords, i0, i1, off);
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, false, off);
                break;
            case 'circles':
            case 'cross':
                this.drawPointMarkers(ctx, spec, pane, coords, i0, i1, off);
                break;
            case 'step':
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, true, off);
                break;
            default:
                this.drawPolyline(ctx, spec, pane, coords, i0, i1, false, off);
        }
    }

    private drawPolyline(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, step: boolean, off = 0): void {
        ctx.lineWidth = Math.max(1, s.style.width);
        ctx.lineJoin = 'round';
        setDash(ctx, s.style.lineStyle);
        // Per-segment stroke so a varying per-point color renders natively
        // (no series split). The segment entering point i takes point i's color.
        let prevX = 0;
        let prevY = 0;
        let have = false;
        for (let i = Math.max(1, i0 - 1); i <= i1; i += 1) {
            const p = s.points[i - off];
            const pv = s.points[i - 1 - off];
            if (!p || p.value === null || !pv || pv.value === null) {
                have = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            if (!have) {
                prevX = coords.logicalToX(i - 1);
                prevY = coords.priceToY(pv.value, pane.scale, pane.bounds);
            }
            ctx.strokeStyle = p.color ?? s.style.color;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            if (step) {
                ctx.lineTo(x, prevY);
                ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            prevX = x;
            prevY = y;
            have = true;
        }
        setDash(ctx, 'solid');
    }

    private drawArea(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        // One filled polygon per contiguous non-null run (breaks on gaps, like the
        // line overlay + AreaSeries), with a top-color → transparent vertical fade.
        let pts: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (pts.length === 0) return;
            const g = ctx.createLinearGradient(0, minY, 0, baseY);
            g.addColorStop(0, s.style.color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(pts[0]!.x, baseY);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1]!.x, baseY);
            ctx.closePath();
            ctx.fill();
            pts = [];
            minY = Infinity;
        };
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            pts.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    private drawHistogram(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, (s.kind === 'columns' ? 0.7 : 0.8) * spacing);
        const half = w / 2;
        const base = s.style.base ?? 0;
        const baseY = coords.priceToY(base, pane.scale, pane.bounds);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            ctx.fillStyle = p.color ?? s.style.color;
            ctx.fillRect(x - half, Math.min(baseY, y), w, Math.max(1, Math.abs(y - baseY)));
        }
    }

    private drawPointMarkers(ctx: CanvasRenderingContext2D, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const r = Math.max(1.5, s.style.width);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            ctx.strokeStyle = p.color ?? s.style.color;
            ctx.fillStyle = p.color ?? s.style.color;
            if (s.kind === 'cross') {
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - r, y);
                ctx.lineTo(x + r, y);
                ctx.moveTo(x, y - r);
                ctx.lineTo(x, y + r);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    private drawPlotCandles(ctx: CanvasRenderingContext2D, s: CandleSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        const spacing = coords.bodySpacing();
        const up = s.style?.up ?? theme.upColor;
        const down = s.style?.down ?? theme.downColor;
        const isBar = s.kind === 'bar';
        const half = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        for (let i = i0; i <= i1; i += 1) {
            const b = s.bars[i - off];
            if (!b) continue;
            const bc: CandleBarColor | null | undefined = s.barColors?.[i - off];
            const body = bc?.color ?? (b.close >= b.open ? up : down);
            const x = Math.round(coords.logicalToX(i)) + 0.5;
            const hY = coords.priceToY(b.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(b.low, pane.scale, pane.bounds);
            const oY = coords.priceToY(b.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(b.close, pane.scale, pane.bounds);
            if (isBar) {
                // OHLC bar: high-low stick + left open tick + right close tick.
                ctx.strokeStyle = body;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, hY);
                ctx.lineTo(x, lY);
                ctx.moveTo(x - tickW, oY);
                ctx.lineTo(x, oY);
                ctx.moveTo(x, cY);
                ctx.lineTo(x + tickW, cY);
                ctx.stroke();
                continue;
            }
            ctx.strokeStyle = bc?.wickColor ?? body;
            ctx.lineWidth = wickWidth(spacing);
            ctx.beginPath();
            ctx.moveTo(x, hY);
            ctx.lineTo(x, lY);
            ctx.stroke();
            ctx.fillStyle = body;
            ctx.fillRect(x - half, Math.min(oY, cY), half * 2, Math.max(1, Math.abs(cY - oY)));
            if (bc?.borderColor) {
                ctx.strokeStyle = bc.borderColor;
                ctx.strokeRect(x - half, Math.min(oY, cY), half * 2, Math.max(1, Math.abs(cY - oY)));
            }
        }
    }

    private drawFill(ctx: CanvasRenderingContext2D, model: IndicatorModel, fill: Fill, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const from = findPoints(model, fill.fromSeriesId);
        const to = findPoints(model, fill.toSeriesId);
        if (!from || !to) return;
        // Gradient pool: reuse one CanvasGradient across a run of bars with identical
        // top/bottom y + colors (a constant gradient → 1 object for the whole fill,
        // instead of one createLinearGradient per bar per frame).
        let gTop = NaN;
        let gBot = NaN;
        let gTC = '';
        let gBC = '';
        let gObj: CanvasGradient | null = null;
        // Per-bar quads (flat / conditional / vertical gradient), culled to view.
        for (let i = Math.max(1, i0); i <= i1; i += 1) {
            const a0 = from[i - 1 - off];
            const b0 = to[i - 1 - off];
            const a1 = from[i - off];
            const b1 = to[i - off];
            if (!a0 || !b0 || !a1 || !b1 || a0.value === null || b0.value === null || a1.value === null || b1.value === null) continue;
            const xPrev = coords.logicalToX(i - 1);
            const xCur = coords.logicalToX(i);
            const tPrev = coords.priceToY(a0.value, pane.scale, pane.bounds);
            const bPrev = coords.priceToY(b0.value, pane.scale, pane.bounds);
            const tCur = coords.priceToY(a1.value, pane.scale, pane.bounds);
            const bCur = coords.priceToY(b1.value, pane.scale, pane.bounds);

            // Style a span [i-1, i] by its LEFT/head column (matches FillPrimitive's
            // run-head convention — keying off i would shift colours/gradient by 1 bar).
            const grad = fill.gradient?.[i - 1 - off];
            if (grad) {
                const yTop = coords.priceToY(grad.topValue, pane.scale, pane.bounds);
                const yBot0 = coords.priceToY(grad.bottomValue, pane.scale, pane.bounds);
                const yBot = yBot0 === yTop ? yTop + 1 : yBot0;
                if (!gObj || yTop !== gTop || yBot !== gBot || grad.topColor !== gTC || grad.bottomColor !== gBC) {
                    gObj = ctx.createLinearGradient(0, yTop, 0, yBot);
                    gObj.addColorStop(0, grad.topColor);
                    gObj.addColorStop(1, grad.bottomColor);
                    gTop = yTop;
                    gBot = yBot;
                    gTC = grad.topColor;
                    gBC = grad.bottomColor;
                }
                ctx.fillStyle = gObj;
            } else {
                const color = fill.colors ? fill.colors[i - 1 - off] : fill.color;
                if (!color) continue;
                ctx.fillStyle = color;
            }
            ctx.beginPath();
            ctx.moveTo(xPrev, tPrev);
            ctx.lineTo(xCur, tCur);
            ctx.lineTo(xCur, bCur);
            ctx.lineTo(xPrev, bPrev);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawBackground(ctx: CanvasRenderingContext2D, bg: Background, pane: PaneNode, coords: CoordinateSystem): void {
        const x1 = coords.timeToX(bg.from);
        const x2 = coords.timeToX(bg.to);
        if (x2 < 0 || x1 > coords.width || x2 <= x1) return;
        ctx.fillStyle = bg.color;
        ctx.fillRect(x1, pane.bounds.top, x2 - x1, pane.bounds.height);
    }

    private drawHline(ctx: CanvasRenderingContext2D, pl: PriceLine, pane: PaneNode, coords: CoordinateSystem, dataW: number, theme: VelaTheme): void {
        const y = Math.round(coords.priceToY(pl.price, pane.scale, pane.bounds)) + 0.5;
        if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) return;
        ctx.strokeStyle = pl.color ?? theme.textColor;
        ctx.lineWidth = pl.width ?? 1;
        setDash(ctx, pl.lineStyle ?? 'solid');
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(dataW, y);
        ctx.stroke();
        setDash(ctx, 'solid');
    }
}

function setDash(ctx: CanvasRenderingContext2D, style: LineStyle): void {
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
}

function findPoints(model: IndicatorModel, seriesId: string): LineLikeSeries['points'] | null {
    const s = model.series.find((x) => x.id === seriesId);
    return s && isLineLikeSeries(s) ? s.points : null;
}

const EMPTY_BARCOLORS: ReadonlyMap<number, string> = new Map();

function mergeBarColors(indicators: Map<string, IndicatorModel>): ReadonlyMap<number, string> {
    // Common case (no barcolor() anywhere) → shared empty map, no per-frame alloc.
    let any = false;
    for (const m of indicators.values()) {
        if (m.barColors && m.barColors.length > 0) {
            any = true;
            break;
        }
    }
    if (!any) return EMPTY_BARCOLORS;
    const map = new Map<number, string>();
    for (const m of indicators.values()) {
        if (m.barColors) for (const bc of m.barColors) map.set(bc.time, bc.color);
    }
    return map;
}

