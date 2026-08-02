import type { OHLCV } from '../../../core/model/ohlcv';

import type { VolumeLayerData, VpvrLayerData } from '../../../core/model/volume-layers';
import type { PaneKind } from '../../../core/model/scene';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { PriceStyle } from '../../../core/options';
import type { PriceScale, PaneBounds } from './CoordinateSystem';
import { type ChartStyle, defaultChartStyle } from './chartConfig';
import { defaultTradeMarkersState, type TradeMarkersState } from '../../shared/trade-markers';

/** A user-defined shaded time band spanning the full plot height (all panes) — the
 *  generic primitive behind session highlighting (weekends, pre/regular/post). Unlike
 *  the engine-emitted `Background` (per-pane, from Pine `bgcolor()`), highlights are
 *  renderer-owned and set via the `highlights` feature. */
export interface HighlightArea {
    /** Inclusive start, epoch ms. */
    from: number;
    /** Exclusive end, epoch ms. */
    to: number;
    color: string;
}

/** Price-axis display mode: absolute price, percent change vs a visible baseline, or
 *  values indexed to 100 at that same baseline (`index = price / baseline * 100`). */
export type ScaleMode = 'price' | 'percent' | 'indexed';

/** A percent/indexed axis descriptor for the tick + label formatters: the visible baseline
 *  (a finite, non-zero reference value) plus which flavor. `indexed:false` ⇒ percent change
 *  (`+2.34%`); `indexed:true` ⇒ a plain number indexed to 100 at the baseline. Absent ⇒
 *  absolute (price/volume) axis. */
export interface PctScale {
    baseline: number;
    indexed: boolean;
}

/**
 * One raster layer of user drawings interleaved into a pane's series stack: a prepainted
 * plot-sized canvas the backend composites (drawImage / textured quad) immediately BEFORE
 * the series whose z key is `beforeZ` — so its drawings sit under that series and every
 * series above it, but over everything painted earlier (grid, fills, lower series).
 */
export interface DrawingSlice {
    /** The z key of the series this layer paints in front of the grid but behind. */
    beforeZ: number;
    /** Plot-sized, dpr-scaled canvas holding just this layer's drawings. */
    canvas: HTMLCanvasElement;
}

/**
 * A retained pane node. Stacked top-to-bottom by `order`; `heightWeight`
 * sets relative height. `bounds` (pixel extent) is recomputed on resize;
 * `scale` (price window) is recomputed per frame by autoscale. Both are
 * consumed by every layer via the CoordinateSystem.
 */
export interface PaneNode {
    id: string;
    kind: PaneKind;
    order: number;
    heightWeight: number;
    bounds: PaneBounds;
    /** Rendered price window (eased toward `scaleTarget` while animating). */
    scale: PriceScale;
    /** Autoscale result; `scale` snaps to it when idle, glides during zoom/fling. */
    scaleTarget: PriceScale;
    /** False until `scale` has been snapped to a real target once — so a pane added
     *  mid-animation seeds its scale instead of easing from the {0,1} placeholder. */
    initialized: boolean;
    /** User-set price window (price-axis drag / vertical pan). When non-null the pane
     *  STOPS autoscaling and renders this window verbatim; cleared (back to autoscale)
     *  by a double-click reset / re-fit. */
    manualScale: PriceScale | null;
    /** Collapsed to a thin strip (legend + expand affordance) — laid out at a fixed small
     *  height, keeping its weight so expanding restores its proportion. */
    collapsed: boolean;
    /** How this pane's axis labels read. `'volume'` (a volume indicator alone in its own
     *  pane) abbreviates the scale with K/M/B suffixes; undefined ⇒ the default price format.
     *  Recomputed per autoscale pass, so it clears the moment the pane's content changes. */
    axisFormat?: 'volume';
    /** This STUDY pane's own axis mode — `'price'` (absolute) or `'percent'` (change vs its
     *  own `percentBaseline`). The PRICE pane instead follows the scene-level `scaleMode`
     *  (persisted chart setting), so every pane's scale is independent. Undefined ⇒ `'price'`. */
    scaleMode?: ScaleMode;
    /** This STUDY pane's own logarithmic flag (the PRICE pane follows the scene-level
     *  `logScale`). Undefined ⇒ linear. */
    logScale?: boolean;
    /** This STUDY pane's own inverted-axis flag (high at the bottom); the PRICE pane follows
     *  the scene-level `invertScale`. Undefined ⇒ normal orientation. */
    invert?: boolean;
    /** Reference value for THIS pane's percent mode (its first visible value), recomputed per
     *  frame. On the price pane it's the first visible bar close; on a study pane, its master
     *  series' first visible value. */
    percentBaseline: number;
}

/** A merged (own-scale) indicator's private price window inside a shared pane. */
export interface IndicatorScale {
    scale: PriceScale;
    scaleTarget: PriceScale;
    initialized: boolean;
    manualScale: PriceScale | null;
}

/**
 * The retained scene the backend renders: panes, the shared price bars, the
 * mounted indicator models (rendered by paneId), and transient crosshair state.
 * P1 renders directly from the indicator models each frame (immediate-mode,
 * culled to the visible range); the per-node diff is a later optimization.
 */
export class SceneGraph {
    readonly panes = new Map<string, PaneNode>();
    readonly indicators = new Map<string, IndicatorModel>();
    bars: OHLCV[] = [];
    /** Volume-layer config pushed by the volume native indicator (null ⇒ layer off). Ephemeral. */
    volumeLayer: VolumeLayerData | null = null;
    /** Generic native-data channels for SDK renderer layers (`setNativeData(id, …)`). Ephemeral. */
    readonly nativeData = new Map<string, unknown>();
    /** Loading ranges per channel (`setNativeData(id + '-pending', …)`). Ephemeral. */
    readonly nativePending = new Map<string, ReadonlyArray<readonly [number, number]>>();
    /** VPVR-layer config pushed by the VPVR native indicator (null ⇒ layer off). Ephemeral. */
    vpvrLayer: VpvrLayerData | null = null;
    crosshair: { x: number; y: number } | null = null;
    /** How the base price series is drawn on the price pane (candles by default). */
    priceStyle: PriceStyle = 'candles';
    /** Price-series base painting for the ACTIVE style (see ChartTypeDefinition.basePainting). */
    basePainting: 'candles' | 'none' = 'candles';
    /** Explicit baseline reference price for `priceStyle:'baseline'`; when null the
     *  baseline follows `style.baseline.baselineLevel` as a percent of the visible pane
     *  range (resolved per frame via `baselinePriceFor`). */
    baselineValue: number | null = null;
    /** Draw the dashed horizontal line at the latest price (price pane). Independent
     *  of the axis label chip (`showPriceLabel`) — either can show without the other. */
    showPriceLine = true;
    /** Draw the last-price label chip on the price axis. Independent of the line. */
    showPriceLabel = true;
    /** Draw the countdown-to-bar-close chip on the price axis. When the price label is
     *  also shown, the two merge into one stacked block (countdown under the label);
     *  when either shows alone it's centered on the latest price level. */
    showCountdown = true;
    /** Logarithmic price scale on the price pane. */
    logScale = false;
    /** Inverted price axis on the price pane (high at the bottom). Study panes carry their own. */
    invertScale = false;
    /** Exchange tick size for the active symbol (e.g. 0.01), when known. Drives the
     *  price-axis decimals — the instrument's true precision instead of the zoom-derived
     *  formula. Undefined until symbol metadata loads (the formula is the fallback). */
    priceMintick: number | undefined = undefined;
    /** Price-axis mode on the price pane: `'price'` (absolute) or `'percent'` (change
     *  vs `percentBaseline`). Gridlines, axis labels and crosshair chip all follow it. */
    scaleMode: ScaleMode = 'price';
    /** Reference price for percent mode (first visible bar's close); recomputed per frame. */
    percentBaseline = 0;
    /** IANA time zone for the time axis + crosshair/data-window stamps (`'UTC'` default). */
    timezone = 'UTC';
    /** Draw the background gridlines (price + time). Master toggle (`gridlines`
     *  feature); per-axis visibility + colors live in `style.gridVert`/`gridHorz`. */
    showGrid = true;
    /** Comprehensive cosmetic config (item 15): grid colors, crosshair, candle
     *  border/wick, fonts, separators. Serialized via the renderer's `getConfig()`/
     *  `applyConfig()`; every draw layer reads its knobs from here, falling back to
     *  the theme for any value left at its inherit default. */
    style: ChartStyle = defaultChartStyle();
    /** Draw the price/time axis tick labels. */
    showAxisLabels = true;
    /** Strategy trade-marker display (the `tradeMarkers` feature): master toggle, the
     *  two text lines, and the palette. Trade markers always paint on the price pane. */
    tradeMarkers: TradeMarkersState = defaultTradeMarkersState();
    /** Renderer-owned shaded time bands (session highlighting), behind grid + data. */
    highlights: HighlightArea[] = [];
    /** Draw-order key of the price candles, relative to indicator series z (see `seriesZ`).
     *  Indicators with z below this draw BEHIND the candles; at/above draw in front.
     *  Default 0 with indicators mounting at z < 0 ⇒ the price reads on top of every overlay,
     *  and user drawings (z ≥ 1 by default) on top of the price. */
    candleZ = 0;
    /** Hide the base price series (candles/bars/line/area) without removing it — overlay
     *  indicators keep drawing and the pane autoscales to them. Toggled from the object tree. */
    candlesHidden = false;
    /** Per-indicator foreground draw-order key (series layer), keyed by indicator id.
     *  Higher = drawn later (in front). Assigned on mount to the current BOTTOM of the stack,
     *  so each indicator arrives behind the candles (and behind older indicators);
     *  `setIndicatorZ`/`bringToFront`/`sendToBack` change it. */
    private readonly seriesZ = new Map<string, number>();
    /** Per-pane raster layers of user drawings interleaved into the series stack — each is a
     *  prepainted canvas the backend composites just before the series carrying `beforeZ`.
     *  Rebuilt by the renderer per data frame; empty when every drawing sits over the stack. */
    drawingSlices: ReadonlyMap<string, ReadonlyArray<DrawingSlice>> = new Map();
    /** Per-model index offset: the chart bar index of the model's `anchorTime` — its
     *  index-aligned payloads (dense series arrays, `bar_index` drawings) count from that
     *  bar. Only nonzero for models computed over a SUFFIX of the bars (whole-chart models,
     *  the norm, aren't stored). Recomputed by the renderer on setBars + mount/patch. */
    private readonly anchorOffsets = new Map<string, number>();
    /** Per-indicator private price windows (merged indicators drawn on their own scale
     *  column). Populated per frame for models flagged `ownScale`; absent ⇒ the model
     *  shares its pane's master scale. */
    readonly indicatorScales = new Map<string, IndicatorScale>();
    /** Cached sort of `panes` by order; invalidated on add/remove/reorder. */
    private orderedCache: PaneNode[] | null = null;

    /** Panes sorted top-to-bottom by `order`. Cached — callers must NOT mutate the array. */
    orderedPanes(): PaneNode[] {
        if (!this.orderedCache) this.orderedCache = [...this.panes.values()].sort((a, b) => a.order - b.order);
        return this.orderedCache;
    }

    indicatorsForPane(paneId: string): IndicatorModel[] {
        const out: IndicatorModel[] = [];
        for (const model of this.indicators.values()) if (model.paneId === paneId) out.push(model);
        return out;
    }

    /** Merged (own-scale) indicators on a pane, ordered by z — one axis column each. */
    ownScaleIndicatorsForPane(paneId: string): IndicatorModel[] {
        return this.orderedIndicatorsForPane(paneId).filter((m) => m.ownScale === true);
    }

    /** Ensure a merged indicator has a private scale slot (seeded from the pane if given). */
    ensureIndicatorScale(id: string, seed?: PriceScale): IndicatorScale {
        let s = this.indicatorScales.get(id);
        if (!s) {
            const base = seed ?? { min: 0, max: 1 };
            s = { scale: { ...base }, scaleTarget: { ...base }, initialized: false, manualScale: null };
            this.indicatorScales.set(id, s);
        }
        return s;
    }

    dropIndicatorScale(id: string): void {
        this.indicatorScales.delete(id);
    }

    /** The price window a model renders on: its own scale when merged (`ownScale`), else the pane's. */
    scaleFor(model: IndicatorModel, pane: PaneNode): PriceScale {
        if (model.ownScale === true) {
            const s = this.indicatorScales.get(model.id);
            if (s) return s.scale;
        }
        return pane.scale;
    }

    /** Apply a new top-to-bottom pane order (ids not present are ignored). */
    orderPanes(orderedIds: string[]): void {
        orderedIds.forEach((id, i) => {
            const pane = this.panes.get(id);
            if (pane) pane.order = i;
        });
        this.orderedCache = null;
    }

    /** Indicators on a pane sorted by foreground z (ascending). Array#sort is stable,
     *  so equal-z models keep their insertion order (the default). */
    orderedIndicatorsForPane(paneId: string): IndicatorModel[] {
        return this.indicatorsForPane(paneId).sort((a, b) => this.zOf(a.id) - this.zOf(b.id));
    }

    /** The foreground draw-order key of an indicator (0 when never assigned). */
    zOf(id: string): number {
        return this.seriesZ.get(id) ?? 0;
    }

    /** The model's index offset: chart bar index its index-aligned payloads count from (0 = whole-chart). */
    offsetOf(id: string): number {
        return this.anchorOffsets.get(id) ?? 0;
    }

    /** Offsets are SIGNED. Positive: the model starts after the chart's first bar (it ran
     *  over a suffix) — readers skip its leading chart bars. Negative: the model starts
     *  BEFORE it (the chart's head moved forward under a mounted model) — readers skip the
     *  model's own leading points, `points[i - off]` reaching further in. Storing only the
     *  positive case silently pinned such a model at index 0, i.e. drew it shifted. */
    setAnchorOffset(id: string, offset: number): void {
        if (offset !== 0 && Number.isFinite(offset)) this.anchorOffsets.set(id, offset);
        else this.anchorOffsets.delete(id);
    }

    forgetAnchorOffset(id: string): void {
        this.anchorOffsets.delete(id);
    }

    /** Resolve the baseline reference price for the given pane window: the explicit
     *  `baselineValue` when set, else `style.baseline.baselineLevel` as the price that sits
     *  at that fraction of the pane height. Interpolated in the same space the pane renders
     *  in (log when `scale.log`, else linear) so `level%` always lands at `level%` of the
     *  height — matching `CoordinateSystem.yToPrice`. */
    baselinePriceFor(scale: PriceScale): number {
        if (this.baselineValue != null) return this.baselineValue;
        const t = this.style.baseline.baselineLevel / 100;
        if (scale.log && scale.min > 0 && scale.max > scale.min) {
            const lo = Math.log(scale.min);
            return Math.exp(lo + t * (Math.log(scale.max) - lo));
        }
        return scale.min + (scale.max - scale.min) * t;
    }

    /** Assign a default z on mount: the current bottom of the stack, so a new indicator
     *  paints behind the candles and behind every indicator already there — the price stays
     *  the top of the pile until the user restacks it. No-op if the indicator already has one. */
    assignIndicatorZ(id: string): void {
        if (!this.seriesZ.has(id)) this.seriesZ.set(id, this.bottomZ() - 1);
    }

    forgetIndicatorZ(id: string): void {
        this.seriesZ.delete(id);
    }

    setIndicatorZ(id: string, z: number): void {
        this.seriesZ.set(id, z);
    }

    /** Snapshot of the current ordering for a UI/read API: `{ id, z }` sorted by z. */
    indicatorZOrder(): Array<{ id: string; z: number }> {
        return [...this.seriesZ.entries()].map(([id, z]) => ({ id, z })).sort((a, b) => a.z - b.z);
    }

    /** The pane's series z keys (each indicator, plus the candles on the price pane), sorted
     *  ascending and de-duplicated — the boundaries a user drawing's z is slotted against. */
    seriesBoundaries(paneId: string): number[] {
        const keys = new Set<number>();
        if (paneId === 'price') keys.add(this.candleZ);
        for (const m of this.indicatorsForPane(paneId)) keys.add(this.zOf(m.id));
        return [...keys].sort((a, b) => a - b);
    }

    /** Raise an indicator above every other layer (other indicators AND the candles). */
    bringIndicatorToFront(id: string): void {
        this.seriesZ.set(id, this.topZ() + 1);
    }

    /** Drop an indicator below every other layer (other indicators AND the candles). */
    sendIndicatorToBack(id: string): void {
        this.seriesZ.set(id, this.bottomZ() - 1);
    }

    private topZ(): number {
        let max = this.candleZ;
        for (const z of this.seriesZ.values()) if (z > max) max = z;
        return max;
    }

    private bottomZ(): number {
        let min = this.candleZ;
        for (const z of this.seriesZ.values()) if (z < min) min = z;
        return min;
    }

    ensurePane(id: string, kind: PaneKind, order: number, heightWeight: number): PaneNode {
        this.orderedCache = null; // order/membership may change
        const existing = this.panes.get(id);
        if (existing) {
            existing.order = order;
            existing.heightWeight = heightWeight;
            existing.kind = kind;
            return existing;
        }
        const pane: PaneNode = { id, kind, order, heightWeight, bounds: { top: 0, height: 0 }, scale: { min: 0, max: 1 }, scaleTarget: { min: 0, max: 1 }, initialized: false, manualScale: null, collapsed: false, percentBaseline: 0 };
        this.panes.set(id, pane);
        return pane;
    }

    removePane(id: string): void {
        this.panes.delete(id);
        this.orderedCache = null;
    }
}

/** This pane's axis mode. The PRICE pane follows the scene-level `scaleMode` (the persisted
 *  chart setting); every STUDY pane carries its own, so the panes' scales are independent. */
export function paneScaleMode(scene: SceneGraph, pane: PaneNode): ScaleMode {
    return pane.kind === 'price' ? scene.scaleMode : (pane.scaleMode ?? 'price');
}

/** This pane's logarithmic flag — the price pane from the scene, study panes their own. */
export function paneLogScale(scene: SceneGraph, pane: PaneNode): boolean {
    return pane.kind === 'price' ? scene.logScale : (pane.logScale ?? false);
}

/** This pane's inverted-axis flag — the price pane from the scene, study panes their own. */
export function paneInvert(scene: SceneGraph, pane: PaneNode): boolean {
    return pane.kind === 'price' ? scene.invertScale : (pane.invert ?? false);
}

/** Percent baseline for a pane, or undefined when it renders as an absolute (non-percent) axis.
 *  Both percent and indexed modes share the baseline; `indexed` is `false` here. */
export function percentBaselineFor(scene: SceneGraph, pane: PaneNode): number | undefined {
    return paneScaleMode(scene, pane) === 'percent' ? pane.percentBaseline : undefined;
}

/** The percent/indexed descriptor for a pane's axis (baseline + flavor), or undefined when the
 *  pane shows absolute values or has no usable baseline yet. Percent and indexed are the same
 *  affine map onto `percentBaseline`; only the label formatting differs. */
export function percentScaleFor(scene: SceneGraph, pane: PaneNode): PctScale | undefined {
    const mode = paneScaleMode(scene, pane);
    if (mode !== 'percent' && mode !== 'indexed') return undefined;
    const baseline = pane.percentBaseline;
    if (!Number.isFinite(baseline) || baseline === 0) return undefined;
    return { baseline, indexed: mode === 'indexed' };
}
