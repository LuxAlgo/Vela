import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    CrosshairOHLC,
    ClickEvent,
    AxisLongPressEvent,
    InputChangeEvent,
    VisibleRange,
    IndicatorStatus,
    LegendActionView,
    PaneAction,
    DataWindowRow,
    DataWindowOHLC,
    DataWindowGroup,
    DataWindowReadout,
} from '../../core/ports/IChartRenderer';
import type { VelaTheme } from '../../core/options';
import type { OHLCV } from '../../core/model/ohlcv';
import type { Millis } from '../../core/model/time';
import type { VolumeLayerData, VpvrLayerData } from '../../core/model/volume-layers';
import type { Pane } from '../../core/model/scene';
import type { IndicatorModel } from '../../core/model/indicator';
import type { ScenePatch } from '../../core/model/patch';
import type { InputValue, SymbolPickerFn } from '../../core/model/inputs';
import type { RendererDisplayOptions, NativeBackend, PriceStyle, MoveTarget, ThemeName } from '../../core/options';
import type { Unsubscribe } from '../../core/util/types';
import { isLineLikeSeries } from '../../core/model/series';
import { InputsUI, type LegendPlotValue } from '../shared/InputsUI';
import { PaneControls } from './chrome/PaneControls';
import { TableOverlay } from '../shared/TableOverlay';
import { NATIVE_CAPABILITIES, supportsWebGL2 } from './capabilities';
import { WebGL2Backend } from './backend/WebGL2Backend';
import { CoordinateSystem, type PaneBounds, type PriceScale } from './core/CoordinateSystem';
import { Scheduler, InvalidateLevel, repaintsData, repaintsChrome } from './core/Scheduler';
import { Animator, easeToward } from './core/Animator';
import { InputController } from './core/InputController';
import { KeyboardController } from './core/KeyboardController';
import { SceneGraph, paneLogScale, paneScaleMode, paneInvert, type PaneNode, type HighlightArea, type ScaleMode } from './core/SceneGraph';
import { clampBarSpacing, defaultViewport, MIN_BAR_SPACING, MAX_BAR_SPACING, type ViewportState } from './core/ViewportState';
import { Canvas2dBackend } from './backend/Canvas2dBackend';
import type { IRenderBackend } from './backend/IRenderBackend';
import { ChromeRenderer } from './chrome/ChromeRenderer';
import { AXIS_MASTER_W, AXIS_MERGED_W } from './chrome/axisLayout';
import { CrosshairRenderer } from './chrome/CrosshairRenderer';
import { SettingsDialog } from './chrome/SettingsDialog';
import { UserDrawingController } from './drawings/UserDrawingController';
import { createProjector } from './drawings/Projector';
import type { Projector, SnapMode } from '../../core/drawings';
import type { IDrawingsRendererPort } from '../../core/drawings';
import { formatPriceLabel } from './chrome/ticks';
import { zonedDate } from './chrome/tz';
import { computePaneScale, expandScaleByPixels } from './core/autoscale';
import { mergeTradeMarkersState, tradesPriceHints, type TradeMarkerHints } from '../shared/trade-markers';
import { rescaleAround, shiftScale } from './core/manualScale';
import { resizeSplit, type PaneSplit } from './core/paneResize';
import { type ChartConfig, CHART_CONFIG_VERSION, factoryResetConfig, mergeConfig, BASELINE_TOP_LINE, BASELINE_BOTTOM_LINE, BASELINE_FILL_ALPHA, BASELINE_FILL_ALPHA_FAR, withAlpha, priceStyleIds, basePaintingOf, candleOverrideFor } from './core/chartConfig';
import { VolumeRenderer, VOLUME_PANE_FILL_FRAC } from './volume/VolumeRenderer';
import { rendererLayers, type RendererLayerArgs, type RendererLayerDefinition, type RendererLayerInstance } from './layers';
import { applyAttributionMarkTheme, attributionMarkColor, createAttributionMark, createCustomMark } from './chrome/AttributionMark';
import type { HostSettingsSection } from './chrome/SettingsDialog';
import { VpvrRenderer } from './vpvr/VpvrRenderer';
import { DARK_THEME, LIGHT_THEME } from '../../core/theme';
import { isDarkColor } from '../../core/color';
import { iconAt } from '../../core/icons';
import { BEARISH, BULLISH } from '../../core/palette';
import { applyChromeTokens } from '../shared/theme-tokens';

/** A vertically-scalable window: a pane's master scale or a merged indicator's own scale.
 *  Both expose the same four fields, so axis-drag / reset work uniformly on either. */
type ScaleHolder = { scale: PriceScale; scaleTarget: PriceScale; manualScale: PriceScale | null; initialized: boolean };

const PRICE_PANE_ID = 'price';
const WEAK_SNAP_PX = 8; // 'weak' magnet only snaps when a candle point is within this many px of the cursor
const TRANSPARENT = 'rgba(0,0,0,0)'; // default area/baseline fill edge (fades out)
const RIGHT_AXIS_W = AXIS_MASTER_W; // px reserved on the right for one price-axis column (the pane master scale)
const AXIS_COL_W = AXIS_MERGED_W; // px width of each EXTRA merged-indicator scale column, added right of the master
const COLLAPSED_PANE_H = 26; // px height of a collapsed pane's strip (legend + expand affordance)
const TIME_AXIS_H = 22; // px reserved at the bottom for the time axis
// ── "scroll to most recent bar" affordance (bottom-right, shown only when the latest bar is off-screen and the cursor is nearby) ──
// Size/border match the playground drawing-toolbar collapse toggle (`.toolbar-toggle`).
const SCROLL_BTN_SIZE = 26; // px — width & height (`.toolbar-toggle`)
const SCROLL_BTN_SIZE_TOUCH = 24; // px — the mobile variant; a hair under the desktop affordance
const SCROLL_BTN_RADIUS = 5; // px — border-radius (`.toolbar-toggle`)
const SCROLL_BTN_SHADOW = '0 2px 8px rgba(0,0,0,0.4)'; // box-shadow (`.toolbar-toggle`)
const SCROLL_BTN_ICON_PX = 12; // px — icon box (`.toolbar-toggle` font-size / FA glyph size)
const SCROLL_BTN_RIGHT_INSET = 12; // px the button sits left of the price-axis gutter's inner edge
const SCROLL_BTN_RIGHT = RIGHT_AXIS_W + SCROLL_BTN_RIGHT_INSET; // initial offset (single-column scale); widened at runtime for merged scales
const SCROLL_BTN_BOTTOM = TIME_AXIS_H + 14; // px from the plot's bottom edge — the corner slot also used by the opt-in `settings` gear (off by default)
const SCROLL_BTN_PROXIMITY_PX = 120; // the button reveals only while the cursor is within this radius of its center
const MIN_VISIBLE_BARS = 2; // never zoom/pan so far that fewer than this many candles stay on screen (the only pan limit)
const ZOOM_OUT_MARGIN_BARS = 6; // breathing room at max zoom-out: all bars + this margin fill the width (no thin strip)
// Animation time constants (exponential-approach time-constants, ms).
const ZOOM_TAU_MS = 70; // wheel-zoom glide
const SCALE_TAU_MS = 80; // autoscale glide during zoom/fling
const FLING_TAU_MS = 110; // inertial-pan velocity decay — short/snappy glide (≈ v0·tau drift), not a long drift
const LIVE_BAR_TAU_MS = 90; // forming-bar OHLC glide — a fast ease so the live candle slides to each tick instead of snapping
const SCROLL_TO_TAU_MS = 130; // scroll-to-latest glide — eases rightOffset back to the latest bars
// Fling ends when on-screen motion drops below this (PIXELS/ms). Kept in pixel units
// so the stop point is zoom-invariant + agrees with InputController's FLING_MIN_SPEED.
const FLING_STOP_PX = 0.02;
// Price-axis drag sensitivity: the visible price SPAN scales by e^(Δpx·k) — drag down
// (Δpx>0) expands the span (zoom out), drag up compresses it (zoom in). Kept low so a
// rescale takes a deliberate, sizeable drag (~2× over ~170px) rather than a twitch.
const PRICE_SCALE_K = 0.004;
// Keyboard zoom step: barSpacing scales by e^(±k) per +/- press (a clear, single notch).
const KEY_ZOOM_STEP = 0.2;
// Pixel half-thickness of a pane separator's hover/drag hit zone (the visible line is 1px;
// this widens it to a comfortable ~8px grab target on either side).
const SEPARATOR_HIT_PX = 4;

/**
 * The from-scratch "native" renderer (canvas2d backend in P0/P1/P2; hand-rolled
 * WebGL2 added in P3 behind the same backend seam). P0 implements the full
 * `IChartRenderer` surface but only the foundation is live: layered DOM, the
 * shared CoordinateSystem, the invalidation scheduler, pane layout, and
 * pointer/wheel pan-zoom over a placeholder grid. Series/fills/drawings/axes/
 * crosshair/inputs land in P1–P2.
 */
export class NativeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = NATIVE_CAPABILITIES;

    private theme!: VelaTheme;
    // The app "chrome" surface (drawing toolbar + in-chart dialogs): background + text.
    // Owned by the app theme alone (mount/setTheme) — config-level background/text edits
    // (settings dialog, persisted configs) recolor the plot AND the axis scales (see
    // axisSurface), but never the toolbar/dialog chrome.
    private surfaceBackground = DARK_THEME.background;
    private surfaceTextColor = DARK_THEME.textColor;
    private wrapper!: HTMLDivElement; // outer root: holds the left toolbar gutter + the plot sub-container
    private plot!: HTMLDivElement; // the plot area (canvases + DOM overlays), inset to the right of the toolbar gutter
    private toolbarGutter = 0; // px reserved on the left for the docked drawings toolbar (0 when hidden)
    private mountContainer: HTMLElement | null = null; // the host-owned element mount() renders into
    private dataCanvas!: HTMLCanvasElement;
    private volumeCanvas!: HTMLCanvasElement; // bottom-anchored volume columns above grid/candles
    private vpvrCanvas!: HTMLCanvasElement; // visible-range volume profile (above candles, right edge)
    private chromeCanvas!: HTMLCanvasElement;
    private drawingsCanvas!: HTMLCanvasElement;
    private cursorCanvas!: HTMLCanvasElement;
    private overlayRoot!: HTMLDivElement;
    private userDrawings: UserDrawingController | null = null;
    private readonly volumeRenderer = new VolumeRenderer();
    /** SDK renderer layers instantiated at mount ({@link registerRendererLayer}). */
    private extLayers: Array<{ def: RendererLayerDefinition; instance: RendererLayerInstance; canvas: HTMLCanvasElement }> = [];
    // The attribution mark (see chrome/AttributionMark + the NOTICE file): default-on;
    // disabling requires an equivalent visible attribution elsewhere in the host UI.
    private attributionEl: HTMLElement | null = null;
    private attributionEnabled = true;
    /** Host-supplied mark shown INSTEAD of the built-in one (`attribution: '<html>'`). */
    private attributionHtml: string | null = null;
    private readonly vpvrRenderer = new VpvrRenderer();
    private resizeObserver: ResizeObserver | null = null;
    private dprMedia: MediaQueryList | null = null;

    private readonly coords = new CoordinateSystem();
    private readonly scene = new SceneGraph();
    private backend!: IRenderBackend; // chosen at mount (WebGL2 if available, else canvas2d)
    private backendMode: NativeBackend = 'auto';
    private glowAmount = 0; // WebGL2 neon-glow intensity (canvas2d ignores it)
    private readonly chrome = new ChromeRenderer();
    private readonly crosshairLayer = new CrosshairRenderer();
    private scheduler!: Scheduler;
    /** 1 Hz repaint pump so the price-axis countdown-to-bar-close ticks; null when off. */
    private countdownTimer: ReturnType<typeof setInterval> | null = null;
    private animator!: Animator;
    private input!: InputController;
    private inputsUI!: InputsUI;
    private symbolPicker: SymbolPickerFn | null = null;
    /** Indicator titles (the legend rows) shown — held here so a remount re-applies it. */
    private indicatorTitlesOn = true;
    /** Plot values beside the legend titles shown — held here so a remount re-applies it. */
    private indicatorValuesOn = true;
    /** Host-contributed legend actions — held here so a rebuild of the legend re-wires them. */
    private legendActionsProvider: ((indicatorId: string) => LegendActionView[]) | null = null;
    /** Host override of the legend's fold toggle — held here so a remount re-applies it. */
    private legendOverviewAction: (() => void) | null = null;
    // ── keyboard navigation / accessibility (item 11) ──
    private keyboard: KeyboardController | null = null;
    private keyboardEnabled = true;
    /** Drawings layer self-serves Ctrl+Z/Y (see the `historyChords` feature). */
    private historyChordsEnabled = true;
    private liveRegion: HTMLDivElement | null = null;

    // ── animation state (eased zoom + inertial pan) ──
    private animZoom = true;
    private animPan = true;
    // Brand default candles.
    private candleUp = BULLISH;
    private candleDown = BEARISH;
    // ── intro reveal (plays once when candles first appear) ──
    private introStyle = 'settle'; // 'grow' | 'settle' | '' (off)
    private introPlayed = false;
    private introRaf: number | null = null;
    /** The load affordance (three pulsing dots) — up while the host reports a bar load in
     *  flight with nothing painted (first load, market switch). Rebuilt per show, so it
     *  picks up the current theme without a setTheme hook. */
    private loadingEl: HTMLElement | null = null;
    private modelAlpha = 1; // indicator-model opacity: 0 during the candle reveal, fades to 1 after
    private targetBarSpacing = 0; // eased zoom target
    private zoomAnchorLogical = 0; // logical kept pinned under the cursor while zooming
    private zoomAnchorX = 0; // pixel the anchor logical is pinned to
    private zoomAnchorMode: 'cursor' | 'right' = 'right'; // wheel-zoom anchor (right edge by default, the common idiom)
    private panVelocity = 0; // inertial rightOffset velocity (logical units / ms)

    private bars: OHLCV[] = [];
    private didInitialFit = false;
    /** A data-tier paint has happened (scales + drawing resolvers are real) — gates the
     *  cheap chrome-only repaint so it never draws over placeholder state. */
    private paintedData = false;

    private skeletonClockMs = 0; // monotonic clock for the loading-skeleton pulse (advanced per animator frame)
    private candleBodyAlpha = 1; // candle body-fill opacity (constant; style layers may modulate later)
    private candleStructureAlpha = 1; // candle wick+border opacity (fades only partway, keeping a skeleton)
    private lastPointer: { x: number; y: number } | null = null; // last plot-relative pointer (re-tests the hovered row after a pan/zoom)

    // ── volume layers (bottom-anchored columns + visible-range profile; driven by their native indicators) ──
    private volumeActive = false; // a volume native indicator is mounted
    private volumeHidden = false; // …but hidden via its legend eye (config kept)
    private vpvrActive = false; // a VPVR native indicator is mounted
    private vpvrHidden = false; // …but hidden via its legend eye (config kept)

    // ── live (forming) bar easing: the last bar's high/low/close glide toward each tick instead of snapping ──
    private liveEaseTime = 0; // open-time of the bar currently being eased (0 = none)
    private liveEaseHigh = 0;
    private liveEaseLow = 0;
    private liveEaseClose = 0;

    // ── axis-drag / manual-scale (price-axis rescale + vertical price pan) ──
    private axisDragEnabled = true;
    private scaleDragHolder: ScaleHolder | null = null; // pane master OR merged-indicator scale being dragged
    private scaleDragHeight = 0; // the grabbed pane's pixel height (for vertical-pan math)
    private scaleDragStart: PriceScale | null = null; // its price window when the gesture began

    // ── pane resize (drag the separator between stacked panes) ──
    private paneResizeEnabled = true;
    private resizeAbove: PaneNode | null = null; // pane just above the dragged separator
    private resizeBelow: PaneNode | null = null; // pane just below it
    private resizeSplitStart: PaneSplit | null = null; // the two panes' shared span when the drag began
    private hoverSeparatorY: number | null = null; // pixel y of the separator under the cursor (drives its hover highlight)

    // ── pane management (merge / reorder / collapse / maximize) ──
    private maximizedPaneId: string | null = null; // pane filling the plot (others hidden), or null
    private rightAxisW = RIGHT_AXIS_W; // total right-gutter width (master column + merged-scale columns)
    private paneControls: PaneControls | null = null; // per-pane hover button cluster (top-right)
    private readonly paneActionCbs = new Set<(a: PaneAction) => void>();

    // ── data window (crosshair OHLC + per-series readout, pulled by host panels) ──
    private hoverLogical: number | null = null; // bar under the crosshair; null when off a bar

    // ── settings dialog (rich, serializable config — item 15) ──
    private settingsDialog: SettingsDialog | null = null;
    /** Where modal dialogs mount — a HOST override (multi-chart shells pass their root
     *  so dialogs center globally instead of clipping inside one cell). Null = the plot. */
    private dialogHost: HTMLElement | null = null;
    private settingsButton: HTMLButtonElement | null = null;
    private settingsEnabled = false;

    // ── "scroll to most recent bar" button (bottom-right; shown only when the latest bar is scrolled off and the cursor is near) ──
    private scrollButton: HTMLButtonElement | null = null;
    private pointerNearScrollBtn = false; // cursor is within the reveal radius of the button
    private scrollTargetRO: number | null = null; // eased rightOffset target while gliding back to the latest bars
    // Distance (px) from the plot's bottom edge to the button — tracks the bottom-most EXPANDED
    // pane like the watermark: when the lower sub-panes collapse it rides up into the open pane.
    private scrollBtnBottomPx = SCROLL_BTN_BOTTOM;
    // Distance (px) from the plot's right edge — clears the FULL scale gutter, which widens when a
    // pane carries merged (own-scale) columns; the constant only clears a single-column scale.
    private scrollBtnRightPx = SCROLL_BTN_RIGHT;

    // ── chrome size class (pushed by the host shell; see IChartRenderer.setLayoutMode) ──
    private layoutMode: 'mobile' | 'desktop' = 'desktop';

    private readonly viewportCbs = new Set<(r: VisibleRange) => void>();
    private readonly crosshairCbs = new Set<(e: CrosshairEvent) => void>();
    private readonly chartTypeSettingsCbs = new Set<(typeId: string, values: Record<string, unknown>) => void>();
    private readonly configChangedCbs = new Set<() => void>();
    /** The settings dialog's Canvas → Theme row raises the pick here; the host applies it. */
    private readonly themeSelectCbs = new Set<(theme: ThemeName) => void>();
    /** First-run config snapshot — what "Reset defaults" restores. */
    private factoryConfig: ChartConfig | null = null;
    private hostSettingsSections: HostSettingsSection[] = [];
    private readonly clickCbs = new Set<(e: ClickEvent) => void>();
    private readonly axisLongPressCbs = new Set<(e: AxisLongPressEvent) => void>();
    private readonly inputChangeCbs = new Set<(e: InputChangeEvent) => void>();
    private readonly removeIndicatorCbs = new Set<(id: string) => void>();
    private readonly toggleVisibleCbs = new Set<(id: string, visible: boolean) => void>();
    private readonly moveIndicatorCbs = new Set<(id: string, target: MoveTarget) => void>();
    private readonly priceStyleCbs = new Set<(style: PriceStyle) => void>();
    private readonly tableOverlays = new Map<string, TableOverlay>();

    constructor(opts?: RendererDisplayOptions) {
        if (opts) {
            this.scene.showPriceLine = opts.currentPriceLine;
            this.scene.logScale = opts.logScale;
            this.backendMode = opts.nativeBackend;
            this.animZoom = opts.animZoom;
            this.animPan = opts.animPan;
            this.glowAmount = opts.glow;
            this.candleUp = opts.upColor;
            this.candleDown = opts.downColor;
            this.scene.priceStyle = opts.priceStyle;
            this.scene.basePainting = basePaintingOf(opts.priceStyle);
            this.scene.candleOverride = candleOverrideFor(opts.priceStyle, this.scene.style.chartTypes);
        }
        // Seed a theme so getConfig()/applyConfig() work before mount (mount overwrites
        // it with the real, Vela-resolved theme). Candle colors follow opts.
        this.theme = this.deriveTheme(DARK_THEME);
    }

    readonly name = 'native';
    readonly features: readonly string[] = ['logScale', 'currentPriceLine', 'priceLabel', 'countdown', 'upColor', 'downColor', 'glow', 'animZoom', 'animPan', 'intro', 'zoomAnchor', 'axisDrag', 'paneResize', 'candleZOrder', 'candleVisible', 'seriesOrder', 'highlights', 'gridlines', 'axisLabels', 'scaleMode', 'invertScale', 'paneScales', 'autoScale', 'timezone', 'keyboard', 'historyChords', 'priceStyle', 'priceBaseline', 'baselinePrice', 'settings', 'attribution', 'dialogHost', 'tradeMarkers', 'indicatorTitles', 'indicatorValues'];

    /** Apply a render feature live — mutate the field + invalidate, no engine re-run. */
    applyFeature(key: string, value: unknown): void {
        switch (key) {
            case 'logScale':
                // `{ pane, value }` targets one pane; a bare boolean is the price pane (back-compat).
                if (value && typeof value === 'object') {
                    const v = value as { pane?: string; value?: unknown };
                    this.setPaneLog(v.pane ?? PRICE_PANE_ID, Boolean(v.value));
                    return; // setPaneLog invalidates
                }
                this.scene.logScale = Boolean(value);
                break;
            case 'currentPriceLine':
                this.scene.showPriceLine = Boolean(value);
                break;
            case 'priceLabel':
                this.scene.showPriceLabel = Boolean(value);
                break;
            case 'countdown':
                this.scene.showCountdown = Boolean(value);
                this.syncCountdownTimer();
                break;
            case 'upColor':
                this.candleUp = String(value);
                if (this.theme) this.theme = this.deriveTheme(this.theme);
                break;
            case 'downColor':
                this.candleDown = String(value);
                if (this.theme) this.theme = this.deriveTheme(this.theme);
                break;
            case 'glow':
                this.glowAmount = Number(value) || 0;
                if (this.backend && 'glow' in this.backend) (this.backend as unknown as { glow: number }).glow = this.glowAmount;
                break;
            case 'animZoom':
                this.animZoom = Boolean(value);
                return; // affects the next interaction only — nothing to repaint
            case 'animPan':
                this.animPan = Boolean(value);
                return;
            case 'intro': {
                const s = value === false || value === 'none' || value === 'off' || value == null ? '' : String(value);
                this.introStyle = s;
                if (s) this.playIntro(s); // setting it replays — used to compare styles from the console
                return;
            }
            case 'zoomAnchor':
                this.zoomAnchorMode = value === 'right' ? 'right' : 'cursor';
                if (this.input) this.input.rightEdgeZoom = this.zoomAnchorMode === 'right';
                return; // affects the next wheel-zoom only — nothing to repaint
            case 'axisDrag':
                this.axisDragEnabled = Boolean(value);
                if (this.input) this.input.axisDrag = this.axisDragEnabled;
                return; // affects the next gesture only — nothing to repaint
            case 'paneResize':
                this.paneResizeEnabled = Boolean(value);
                if (this.input) this.input.paneResize = this.paneResizeEnabled;
                return; // affects the next gesture only — nothing to repaint
            case 'candleZOrder':
                this.scene.candleZ = Number(value) || 0;
                break;
            case 'candleVisible':
                this.scene.candlesHidden = value === false;
                break;
            case 'seriesOrder':
                this.applySeriesOrder(value);
                break;
            case 'highlights':
                this.scene.highlights = sanitizeHighlights(value);
                break;
            case 'gridlines':
                this.scene.showGrid = Boolean(value);
                break;
            case 'axisLabels':
                this.scene.showAxisLabels = Boolean(value);
                break;
            case 'scaleMode':
                // `{ pane, mode }` targets one pane; a bare string is the price pane (back-compat).
                if (value && typeof value === 'object') {
                    const v = value as { pane?: string; mode?: unknown };
                    this.setPaneScaleMode(v.pane ?? PRICE_PANE_ID, asScaleMode(v.mode));
                    return; // setPaneScaleMode invalidates
                }
                this.scene.scaleMode = asScaleMode(value);
                break;
            case 'invertScale':
                // `{ pane, value }` targets one pane; a bare boolean is the price pane.
                if (value && typeof value === 'object') {
                    const v = value as { pane?: string; value?: unknown };
                    this.setPaneInvert(v.pane ?? PRICE_PANE_ID, Boolean(v.value));
                    return; // setPaneInvert invalidates
                }
                this.scene.invertScale = Boolean(value);
                break;
            case 'autoScale':
                // Auto on ⇒ drop every pane's frozen window so autoscale resumes (same as
                // double-clicking the price axis). Auto off ⇒ freeze each pane's current
                // window into manual mode, unlocking vertical price pan/drag.
                for (const pane of this.scene.panes.values()) {
                    pane.manualScale = value ? null : { ...pane.scale };
                }
                break;
            case 'timezone':
                this.scene.timezone = typeof value === 'string' && value ? value : 'UTC';
                break;
            case 'priceStyle':
                this.setPriceStyle(isPriceStyle(value) ? value : 'candles');
                break;
            case 'priceBaseline':
                this.scene.baselineValue = value == null ? null : Number(value);
                break;
            case 'tradeMarkers':
                // Partial state merge ({ visible?, labels?, qty?, colors? }) — malformed fields drop.
                this.scene.tradeMarkers = mergeTradeMarkersState(this.scene.tradeMarkers, value);
                break;
            case 'keyboard':
                this.setKeyboardEnabled(Boolean(value));
                return; // owns its own DOM (focus/listeners/live region)
            case 'historyChords':
                // Off = the host keymap owns Ctrl+Z/Y (a unified app+drawings history);
                // the drawings layer stops consuming the chords so they bubble up.
                this.historyChordsEnabled = Boolean(value);
                if (this.userDrawings) this.userDrawings.historyChords = this.historyChordsEnabled;
                return; // keyboard-path only — nothing to repaint
            case 'settings':
                this.setSettingsEnabled(Boolean(value));
                return; // owns its own DOM (gear button + dialog)
            case 'indicatorTitles':
                // Show/hide the indicator legend rows chart-wide (the settings dialog's
                // Indicators toggle drives it through the host section).
                this.indicatorTitlesOn = value !== false;
                this.inputsUI?.setTitlesVisible(this.indicatorTitlesOn);
                return; // own DOM, no repaint needed
            case 'indicatorValues':
                // Show/hide the plot values beside every legend title (the settings dialog's
                // Indicators → Values toggle); clears any per-row context-menu overrides.
                this.indicatorValuesOn = value !== false;
                this.inputsUI?.setValuesVisible(this.indicatorValuesOn);
                return; // own DOM, no repaint needed
            case 'attribution':
                // `false` hides it, `true` restores the built-in mark, a non-empty STRING
                // puts the host's own mark in that corner (see the NOTICE).
                this.attributionHtml = typeof value === 'string' && value.trim() ? value : null;
                this.attributionEnabled = this.attributionHtml !== null || Boolean(value);
                this.rebuildAttribution();
                return; // own DOM, no repaint needed
            case 'dialogHost':
                // Where MODAL dialogs mount (chart settings, indicator settings). A
                // multi-chart shell passes its root so dialogs center over the whole
                // grid instead of clipping inside one cell. Runtime-only, never part
                // of the cosmetic config template.
                this.dialogHost = value instanceof HTMLElement ? value : null;
                this.settingsDialog?.close();
                this.settingsDialog = null; // recreated lazily against the new host
                this.inputsUI?.setDialogHost(this.dialogHost);
                return; // own DOM, no repaint needed
            default:
                return;
        }
        this.scheduler?.invalidate(InvalidateLevel.Full);
    }

    readFeature(key: string): unknown {
        switch (key) {
            case 'logScale': return this.scene.logScale;
            case 'currentPriceLine': return this.scene.showPriceLine;
            case 'priceLabel': return this.scene.showPriceLabel;
            case 'countdown': return this.scene.showCountdown;
            case 'upColor': return this.candleUp;
            case 'downColor': return this.candleDown;
            case 'glow': return this.glowAmount;
            case 'animZoom': return this.animZoom;
            case 'animPan': return this.animPan;
            case 'intro': return this.introStyle;
            case 'zoomAnchor': return this.zoomAnchorMode;
            case 'axisDrag': return this.input ? this.input.axisDrag : this.axisDragEnabled;
            case 'paneResize': return this.input ? this.input.paneResize : this.paneResizeEnabled;
            case 'candleZOrder': return this.scene.candleZ;
            case 'candleVisible': return !this.scene.candlesHidden;
            case 'seriesOrder': return this.scene.indicatorZOrder();
            case 'highlights': return this.scene.highlights;
            case 'gridlines': return this.scene.showGrid;
            case 'axisLabels': return this.scene.showAxisLabels;
            case 'scaleMode': return this.scene.scaleMode;
            case 'invertScale': return this.scene.invertScale;
            case 'paneScales': return this.paneScaleInfos();
            case 'autoScale': {
                // Auto when the price pane isn't holding a frozen (manual) window.
                const price = this.scene.orderedPanes().find((p) => p.kind === 'price');
                return price ? price.manualScale == null : true;
            }
            case 'timezone': return this.scene.timezone;
            case 'priceStyle': return this.scene.priceStyle;
            case 'priceBaseline': return this.scene.baselineValue;
            case 'baselinePrice': {
                // READ-ONLY: the RESOLVED baseline reference price the paint splits on —
                // the explicit `priceBaseline` when set, else the configured level% of the
                // price pane's current range. Host chrome coloring by baseline position
                // (a status line's value ink) compares against this.
                const price = this.scene.panes.get(PRICE_PANE_ID);
                return price ? this.scene.baselinePriceFor(price.scale) : this.scene.baselineValue;
            }
            case 'tradeMarkers': return { ...this.scene.tradeMarkers, colors: { ...this.scene.tradeMarkers.colors } };
            case 'keyboard': return this.keyboardEnabled;
            case 'historyChords': return this.historyChordsEnabled;
            case 'settings': return this.settingsEnabled;
            case 'indicatorTitles': return this.indicatorTitlesOn;
            case 'indicatorValues': return this.indicatorValuesOn;
            case 'attribution': return this.attributionHtml ?? this.attributionEnabled;
            case 'dialogHost': return this.dialogHost ?? undefined;
            default: return undefined;
        }
    }

    /**
     * Native-layer data push (see `setNativeData` on the port), keyed by native type. A chart-type
     * indicator pushes its per-bar order-flow (revealed under the candles on zoom); the volume + VPVR
     * indicators push their layer CONFIG only — both layers read the chart's bars each frame.
     */
    setNativeData(type: string, data: unknown): void {
        if (type === 'volume') {
            this.scene.volumeLayer = (data as VolumeLayerData | undefined) ?? null;
            this.scheduler?.invalidate(InvalidateLevel.Light);
        } else if (type === 'vpvr') {
            this.scene.vpvrLayer = (data as VpvrLayerData | undefined) ?? null;
            this.scheduler?.invalidate(InvalidateLevel.Light);
        } else if (type.endsWith('-pending')) {
            // The loading protocol of an SDK layer channel: `<id>-pending` = ranges still on their way.
            this.scene.nativePending.set(type.slice(0, -'-pending'.length), (data as ReadonlyArray<readonly [number, number]> | undefined) ?? []);
            this.scheduler?.invalidate(InvalidateLevel.Light);
        } else {
            // A generic SDK layer channel (chart-type data engines push here via host.pushData).
            this.scene.nativeData.set(type, data);
            this.scheduler?.invalidate(InvalidateLevel.Light);
        }
    }

    /** Reflect an indicator's live status (loading / live / idle) in its legend row. */
    setIndicatorStatus(handle: IndicatorRenderHandle, status: IndicatorStatus): void {
        this.inputsUI.setStatus(handle.id, status);
    }

    /**
     * The host reports a bar load in flight with nothing painted (first load, market switch —
     * see the port): three small dots pulse at the center of the plot. Web-Animations-driven,
     * so no stylesheet crosses the renderer boundary; pointer-transparent, and removed (not
     * hidden) on clear so a re-show picks up the current theme.
     */
    setLoading(loading: boolean): void {
        // Tables are the one series-independent content: corner-anchored DOM, so an emptied
        // chart doesn't take them along — hide them for the load, restore with the bars.
        for (const overlay of this.tableOverlays.values()) overlay.setVisible(!loading);
        if (!loading || !this.wrapper) {
            this.loadingEl?.remove();
            this.loadingEl = null;
            return;
        }
        if (this.loadingEl) return;
        const doc = this.wrapper.ownerDocument;
        const el = doc.createElement('div');
        el.className = 'vela-loading'; // stable hook for probes and host styling
        Object.assign(el.style, {
            position: 'absolute',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            pointerEvents: 'none',
        });
        for (let i = 0; i < 3; i += 1) {
            const dot = doc.createElement('span');
            Object.assign(dot.style, { width: '7px', height: '7px', borderRadius: '50%', background: this.chromeTheme().textColor, opacity: '0.15' });
            // Staggered phases via negative delays — every dot animates from the first frame.
            dot.animate([{ opacity: 0.12 }, { opacity: 0.55 }], { duration: 800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -i * 260 });
            el.appendChild(dot);
        }
        this.wrapper.appendChild(el); // appended last ⇒ above the canvases, still under dialogs
        this.loadingEl = el;
    }

    /**
     * Set the active symbol's tick size so the price axis shows the instrument's true
     * precision (see the port). Undefined / non-positive ⇒ fall back to the zoom formula.
     */
    setPricePrecision(mintick: number | undefined): void {
        const m = typeof mintick === 'number' && mintick > 0 ? mintick : undefined;
        if (m === this.scene.priceMintick) return;
        this.scene.priceMintick = m;
        this.scheduler?.invalidate(InvalidateLevel.Full);
    }

    // ── rich serializable config (templates / persisted user settings — item 15) ──
    /**
     * Snapshot the full chart cosmetics as one serializable, versioned document.
     * Every inherited value is resolved to a concrete one so an exported template
     * stands on its own. Stable shape — safe to persist (localStorage) or share.
     */
    getConfig(): ChartConfig {
        const s = this.scene.style;
        const chartTypesBag = Object.fromEntries(Object.entries(s.chartTypes).map(([k, v]) => [k, { ...v }]));
        const t = this.theme;
        return {
            version: CHART_CONFIG_VERSION,
            chartTypes: chartTypesBag,
            layout: {
                background: t.background,
                textColor: t.textColor,
                fontFamily: t.fontFamily,
                fontSize: s.fontSize,
            },
            grid: {
                vertLines: { visible: s.gridVert.visible, color: s.gridVert.color ?? t.gridColor },
                horzLines: { visible: s.gridHorz.visible, color: s.gridHorz.color ?? t.gridColor },
            },
            crosshair: {
                color: s.crosshair.color ?? t.textColor,
                width: s.crosshair.width,
                style: s.crosshair.style,
                opacity: s.crosshair.opacity,
                labelBackground: s.crosshair.labelBackground ?? t.textColor,
            },
            priceScale: {
                mode: this.scene.scaleMode,
                log: this.scene.logScale,
                invert: this.scene.invertScale,
                borderColor: s.borderColor ?? t.borderColor,
                labelsVisible: this.scene.showAxisLabels,
                currentPriceLine: this.scene.showPriceLine,
                priceLabel: this.scene.showPriceLabel,
                countdown: this.scene.showCountdown,
            },
            panes: { separatorColor: s.separatorColor ?? t.borderColor },
            trades: {
                visible: this.scene.tradeMarkers.visible,
                labels: this.scene.tradeMarkers.labels,
                qty: this.scene.tradeMarkers.qty,
                longColor: this.scene.tradeMarkers.colors.long,
                shortColor: this.scene.tradeMarkers.colors.short,
                exitColor: this.scene.tradeMarkers.colors.exit,
            },
            timeScale: { timezone: this.scene.timezone },
            candles: {
                upColor: this.candleUp,
                downColor: this.candleDown,
                bodyVisible: s.candle.bodyVisible,
                borderVisible: s.candle.borderVisible,
                borderUpColor: s.candle.borderUpColor ?? this.candleUp,
                borderDownColor: s.candle.borderDownColor ?? this.candleDown,
                wickVisible: s.candle.wickVisible,
                wickUpColor: s.candle.wickUpColor ?? this.candleUp,
                wickDownColor: s.candle.wickDownColor ?? this.candleDown,
            },
            bars: {
                upColor: s.bars.upColor ?? this.candleUp,
                downColor: s.bars.downColor ?? this.candleDown,
            },
            line: {
                color: s.line.color ?? this.candleUp,
                width: s.line.width,
            },
            stacking: {
                candles: this.scene.candleZ,
                series: Object.fromEntries(this.scene.indicatorZOrder().map(({ id, z }) => [id, z])),
            },
            area: (() => {
                const lineColor = s.area.lineColor ?? this.candleUp;
                return {
                    lineColor,
                    width: s.area.width,
                    topColor: s.area.topColor ?? lineColor,
                    bottomColor: s.area.bottomColor ?? TRANSPARENT,
                };
            })(),
            baseline: (() => {
                const topLineColor = s.baseline.topLineColor ?? BASELINE_TOP_LINE;
                const bottomLineColor = s.baseline.bottomLineColor ?? BASELINE_BOTTOM_LINE;
                return {
                    topLineColor,
                    bottomLineColor,
                    topFillColor: s.baseline.topFillColor ?? withAlpha(topLineColor, BASELINE_FILL_ALPHA),
                    topFillColor2: s.baseline.topFillColor2 ?? withAlpha(topLineColor, BASELINE_FILL_ALPHA_FAR),
                    bottomFillColor: s.baseline.bottomFillColor ?? withAlpha(bottomLineColor, BASELINE_FILL_ALPHA),
                    bottomFillColor2: s.baseline.bottomFillColor2 ?? withAlpha(bottomLineColor, BASELINE_FILL_ALPHA_FAR),
                    width: s.baseline.width,
                    baselineLevel: s.baseline.baselineLevel,
                };
            })(),
            series: { style: this.scene.priceStyle, baseline: this.scene.baselineValue, spacing: this.coords.spacingScale },
        };
    }

    /**
     * Apply a (possibly partial) config document — the inverse of `getConfig()`.
     * Untrusted JSON is validated + merged onto the current config (`mergeConfig`),
     * so malformed fields are dropped and a partial patch only changes what it names.
     * Repaints with NO indicator re-run; safe to call live or before mount.
     */
    applyConfig(config: unknown): void {
        const next = mergeConfig(this.getConfig(), config);
        const s = this.scene.style;
        // Chart-type SDK settings: on change, store + push the type's `<id>-settings`
        // channel (its renderer layer reads it) + notify the core (its data engine).
        for (const [typeId, vals] of Object.entries(next.chartTypes)) {
            if (JSON.stringify(s.chartTypes[typeId]) === JSON.stringify(vals)) continue;
            this.scene.nativeData.set(`${typeId}-settings`, { ...vals });
            for (const cb of this.chartTypeSettingsCbs) cb(typeId, { ...vals });
        }
        s.chartTypes = Object.fromEntries(Object.entries(next.chartTypes).map(([k, v]) => [k, { ...v }]));
        // The chrome surface (toolbar/scales) deliberately does NOT follow the config: it is
        // owned by the app theme (mount/setTheme) alone, so background edits — whether typed
        // live in the settings dialog or replayed from a persisted config — recolor only the
        // plot and never bleed into the chrome.
        // layout → theme (mutate our copy; mount/setTheme own the canonical one).
        // A background edit that lands the plot in the OTHER luminance class (a dark theme
        // with a white background typed into the settings dialog) would leave the derived
        // inks unreadable — light-gray legends and axis text on white. When the resulting
        // text/background pair falls in the SAME luminance class and the patch itself did
        // not choose a text color, re-base the derived inks (text/grid/border) from the
        // built-in theme of the new class. An explicit `layout.textColor` in the same
        // patch always wins (this also keeps full persisted configs, which serialize every
        // value, byte-exact on restore).
        const layoutPatch = config && typeof config === 'object' ? (config as { layout?: unknown }).layout : undefined;
        const patchTextColor = layoutPatch && typeof layoutPatch === 'object' ? (layoutPatch as { textColor?: unknown }).textColor : undefined;
        const explicitTextColor = typeof patchTextColor === 'string' && patchTextColor.trim().length > 0;
        const prevTheme = this.theme;
        let inks = { textColor: next.layout.textColor, gridColor: prevTheme.gridColor, borderColor: prevTheme.borderColor };
        if (!explicitTextColor && isDarkColor(next.layout.textColor) === isDarkColor(next.layout.background)) {
            const rebase = isDarkColor(next.layout.background) ? DARK_THEME : LIGHT_THEME;
            inks = { textColor: rebase.textColor, gridColor: rebase.gridColor, borderColor: rebase.borderColor };
        }
        this.theme = { ...this.theme, background: next.layout.background, textColor: inks.textColor, gridColor: inks.gridColor, borderColor: inks.borderColor, fontFamily: next.layout.fontFamily };
        s.fontSize = next.layout.fontSize;
        // `mergeConfig` runs over the RESOLVED getConfig(), so a live "inherit the theme"
        // sentinel (null) comes back as its concrete value even when the patch never named
        // the field. Writing that back would pin the old theme's color forever; keep the
        // sentinel whenever the merged value is just the resolved echo of it.
        const keepInherit = (cur: string | null, merged: string, resolved: string): string | null =>
            cur === null && merged === resolved ? null : merged;
        // grid
        s.gridVert = { visible: next.grid.vertLines.visible, color: keepInherit(s.gridVert.color, next.grid.vertLines.color, prevTheme.gridColor) };
        s.gridHorz = { visible: next.grid.horzLines.visible, color: keepInherit(s.gridHorz.color, next.grid.horzLines.color, prevTheme.gridColor) };
        // crosshair
        s.crosshair = {
            color: next.crosshair.color,
            width: next.crosshair.width,
            style: next.crosshair.style,
            opacity: next.crosshair.opacity,
            labelBackground: next.crosshair.labelBackground,
        };
        // price scale
        this.scene.scaleMode = next.priceScale.mode;
        this.scene.logScale = next.priceScale.log;
        this.scene.invertScale = next.priceScale.invert;
        s.borderColor = keepInherit(s.borderColor, next.priceScale.borderColor, prevTheme.borderColor);
        this.scene.showAxisLabels = next.priceScale.labelsVisible;
        this.scene.showPriceLine = next.priceScale.currentPriceLine;
        this.scene.showPriceLabel = next.priceScale.priceLabel;
        this.scene.showCountdown = next.priceScale.countdown;
        this.syncCountdownTimer();
        // panes
        s.separatorColor = keepInherit(s.separatorColor, next.panes.separatorColor, prevTheme.borderColor);
        // trade markers
        this.scene.tradeMarkers = {
            visible: next.trades.visible,
            labels: next.trades.labels,
            qty: next.trades.qty,
            colors: { long: next.trades.longColor, short: next.trades.shortColor, exit: next.trades.exitColor },
        };
        // time scale
        this.scene.timezone = next.timeScale.timezone;
        // candles
        this.candleUp = next.candles.upColor;
        this.candleDown = next.candles.downColor;
        s.candle = {
            bodyVisible: next.candles.bodyVisible,
            borderVisible: next.candles.borderVisible,
            borderUpColor: next.candles.borderUpColor,
            borderDownColor: next.candles.borderDownColor,
            wickVisible: next.candles.wickVisible,
            wickUpColor: next.candles.wickUpColor,
            wickDownColor: next.candles.wickDownColor,
        };
        // stacking — the candles' draw-order key plus each indicator's. Seeding an id BEFORE its
        // indicator mounts also works: assignIndicatorZ keeps an existing key, so a restored
        // stack survives the (async) indicator restore that follows a config restore.
        this.scene.candleZ = next.stacking.candles;
        for (const [id, z] of Object.entries(next.stacking.series)) this.scene.setIndicatorZ(id, z);
        // per-price-style cosmetics (independent of the candle palette)
        s.bars = { upColor: next.bars.upColor, downColor: next.bars.downColor };
        s.line = { color: next.line.color, width: next.line.width };
        s.area = { lineColor: next.area.lineColor, width: next.area.width, topColor: next.area.topColor, bottomColor: next.area.bottomColor };
        s.baseline = {
            topLineColor: next.baseline.topLineColor,
            bottomLineColor: next.baseline.bottomLineColor,
            topFillColor: next.baseline.topFillColor,
            topFillColor2: next.baseline.topFillColor2,
            bottomFillColor: next.baseline.bottomFillColor,
            bottomFillColor2: next.baseline.bottomFillColor2,
            width: next.baseline.width,
            baselineLevel: next.baseline.baselineLevel,
        };
        // series
        this.setPriceStyle(next.series.style);
        // Re-read the active style's candle override: setPriceStyle no-ops when the style
        // did not change, but the per-type bag (candle* keys) may have — this is the live
        // path behind the Symbol tab's Candles group for plugin styles.
        this.scene.candleOverride = candleOverrideFor(this.scene.priceStyle, s.chartTypes);
        this.scene.baselineValue = next.series.baseline;
        // Spacing multiplier: widens the center-to-center pitch (and crosshair step) without
        // touching body width. Re-clamp because it changes how many bars fit → the zoom/pan limits.
        this.coords.setPitchScale(next.series.spacing);
        this.coords.setViewport(this.clampViewport(this.coords.getViewport().barSpacing, this.coords.getViewport().rightOffset));
        this.targetBarSpacing = this.coords.getViewport().barSpacing;

        // Re-derive the candle-colored theme + repaint the DOM chrome that mirrors it.
        this.theme = this.deriveTheme(this.theme);
        if (this.wrapper) {
            applyChromeTokens(this.wrapper, this.chromeTheme());
            this.applyBackground();
        }
        this.inputsUI?.setTheme(this.theme);
        this.paneControls?.setTheme(this.theme);
        // Re-theme the docked drawing toolbar on the STABLE chrome surface, so editing the
        // plot background (layout.background) never bleeds into the toolbar.
        this.userDrawings?.setTheme(this.chromeTheme());
        // The open settings dialog is NOT rebuilt here — re-seeding mid-edit would
        // steal focus from the control being dragged/typed. It re-themes on next open.
        this.refreshScrollButtonTheme();
        this.refreshAttributionColor();
        this.scheduler?.invalidate(InvalidateLevel.Full);
        // The settings dialog commits through applyConfig — this is how host chrome
        // that mirrors a config value (bottom-bar timezone) learns about in-chart edits.
        for (const cb of this.configChangedCbs) cb();
    }

    /**
     * Reorder one indicator's series layer. Accepts `{ id, to: 'front' | 'back' }`
     * (relative to every layer incl. the candles) or `{ id, z }` (an explicit key).
     */
    private applySeriesOrder(value: unknown): void {
        if (!value || typeof value !== 'object') return;
        const v = value as { id?: unknown; to?: unknown; z?: unknown };
        if (typeof v.id !== 'string') return;
        if (typeof v.z === 'number') this.scene.setIndicatorZ(v.id, v.z);
        else if (v.to === 'front') this.scene.bringIndicatorToFront(v.id);
        else if (v.to === 'back') this.scene.sendIndicatorToBack(v.id);
    }

    /** Toggle the in-chart settings gear + dialog (the `settings` feature). The gear
     *  sits above the time axis, clear of the right price-axis strip. */
    private setSettingsEnabled(enabled: boolean): void {
        this.settingsEnabled = enabled;
        if (enabled) {
            if (this.plot && !this.settingsButton) {
                this.settingsButton = this.makeSettingsButton();
                this.plot.appendChild(this.settingsButton);
            }
            if (this.settingsButton) this.settingsButton.style.display = 'flex';
            if (this.plot && !this.settingsDialog) this.settingsDialog = new SettingsDialog(this.dialogHost ?? this.plot, this.theme);
        } else {
            this.settingsButton?.style.setProperty('display', 'none');
            this.settingsDialog?.close();
        }
    }

    private makeSettingsButton(): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Chart settings';
        btn.innerHTML = iconAt('gear', 14);
        Object.assign(btn.style, {
            position: 'absolute',
            bottom: `${TIME_AXIS_H + 10}px`,
            right: `${RIGHT_AXIS_W + 10}px`,
            zIndex: '6',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: '50%',
            border: `1px solid ${this.theme.borderColor}`,
            background: this.theme.background,
            color: this.theme.textColor,
            fontSize: '14px',
            lineHeight: '1',
            opacity: '0.75',
            pointerEvents: 'auto',
            padding: '0',
        });
        btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
        btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.75'));
        btn.addEventListener('click', () => this.toggleSettingsDialog());
        return btn;
    }

    /** Port surface: hosts (bottom-bar / chrome buttons) open the same dialog as the
     *  in-chart gear — created on demand, independent of the gear feature being enabled. */
    openSettingsDialog(section?: string): void {
        if (!this.settingsDialog && this.plot) {
            this.settingsDialog = new SettingsDialog(this.dialogHost ?? this.plot, this.theme);
            this.settingsDialog.setLayoutMode(this.layoutMode);
        }
        this.toggleSettingsDialog(section);
    }

    /** (Re)aim the dialog's Canvas → Theme row: the current selection reflects the STABLE
     *  app-theme surface (not the plot background, which the config recolors
     *  independently); a pick is raised to the host (`onThemeSelect`), which owns the
     *  canonical theme. */
    private syncThemeControl(): void {
        this.settingsDialog?.setThemeControl(isDarkColor(this.surfaceBackground) ? 'dark' : 'light', (name) => {
            for (const cb of this.themeSelectCbs) cb(name);
        });
    }

    private toggleSettingsDialog(section?: string): void {
        if (!this.settingsDialog) return;
        // A caller asking for a section wants to SEE it: an open dialog switches tabs
        // instead of closing, so the same menu item never reads as a toggle.
        if (section !== undefined && this.settingsDialog.isOpen()) {
            this.settingsDialog.showSection(section);
            return;
        }
        this.settingsDialog.setTheme(this.theme);
        this.settingsDialog.setHostSections(this.hostSettingsSections);
        this.syncThemeControl();
        this.settingsDialog.toggle(
            this.getConfig(),
            (patch) => this.applyConfig(patch),
            (json) => this.applyConfig(json),
            () => {
                if (this.factoryConfig) this.applyConfig(factoryResetConfig(this.factoryConfig));
                // Re-open so every control re-reads the restored values.
                this.settingsDialog?.close();
                this.openSettingsDialog();
            },
            section,
        );
    }

    /** Close the in-chart dialogs (indicator settings + chart-settings gear). No-op when none are open. */
    closeDialogs(): void {
        this.inputsUI?.closeOpenDialog();
        this.settingsDialog?.close();
    }

    /** Jump-back-to-latest button — same size/border chrome as the drawing-toolbar collapse toggle. */
    private makeScrollToRealtimeButton(): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Scroll to most recent bar (Alt+Shift+→)';
        btn.setAttribute('aria-label', 'Scroll to most recent bar');
        btn.innerHTML = this.scrollButtonIcon();
        Object.assign(btn.style, {
            position: 'absolute',
            bottom: `${SCROLL_BTN_BOTTOM}px`,
            right: `${SCROLL_BTN_RIGHT}px`,
            zIndex: '6',
            width: `${SCROLL_BTN_SIZE}px`,
            height: `${SCROLL_BTN_SIZE}px`,
            boxSizing: 'border-box',
            display: 'none', // revealed by updateScrollToRealtimeButton() when the latest bar is off-screen + the cursor is near
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderRadius: `${SCROLL_BTN_RADIUS}px`,
            border: `1px solid ${this.theme.borderColor}`,
            boxShadow: SCROLL_BTN_SHADOW,
            background: this.scrollButtonSurface(),
            color: this.theme.textColor,
            lineHeight: '0',
            opacity: '0.85',
            pointerEvents: 'auto',
            padding: '0',
        });
        btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
        btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.85'));
        btn.addEventListener('click', () => this.scrollToRealtime());
        return btn;
    }

    /** Double-chevron icon — the "jump back to the latest bar" affordance. */
    private scrollButtonIcon(): string {
        return iconAt('chevrons-right', SCROLL_BTN_ICON_PX);
    }

    /** The button's fill — the chart background at 50% so it blends with the plot beneath. */
    private scrollButtonSurface(): string {
        return withAlpha(this.theme.background, 0.5);
    }

    /** Re-sync the scroll button's colors when `layout.background` changes — called from both
     *  `applyConfig` (playground path) and `setTheme` (app-theme swap). */
    private refreshScrollButtonTheme(): void {
        if (!this.scrollButton) return;
        this.scrollButton.style.background = this.scrollButtonSurface();
        this.scrollButton.style.color = this.theme.textColor;
        this.scrollButton.style.borderColor = this.theme.borderColor;
    }

    /** Track cursor proximity to the scroll button on the plot (bubbles from the button too,
     *  so moving onto the button doesn't count as leaving). */
    private readonly onScrollProximityMove = (e: PointerEvent): void => {
        if (!this.scrollButton || !this.plot) return;
        const rect = this.plot.getBoundingClientRect();
        const cx = rect.width - this.scrollBtnRightPx - SCROLL_BTN_SIZE / 2;
        const cy = rect.height - this.scrollBtnBottomPx - SCROLL_BTN_SIZE / 2;
        const near = Math.hypot(e.clientX - rect.left - cx, e.clientY - rect.top - cy) <= SCROLL_BTN_PROXIMITY_PX;
        if (near !== this.pointerNearScrollBtn) {
            this.pointerNearScrollBtn = near;
            this.updateScrollToRealtimeButton();
        }
    };

    private readonly onScrollProximityLeave = (): void => {
        if (!this.pointerNearScrollBtn) return;
        this.pointerNearScrollBtn = false;
        this.updateScrollToRealtimeButton();
    };

    /** Show the button only when the latest bar is scrolled off the right edge. On desktop the
     *  cursor must also be nearby (hover reveal); on mobile — no hovering cursor — the button
     *  appears whenever the latest bars are off-screen and hides again once the view is back
     *  at the right edge. */
    private updateScrollToRealtimeButton(): void {
        const btn = this.scrollButton;
        if (!btn) return;
        const latestOffScreen = this.coords.barCount > 0 && this.coords.getViewport().rightOffset < 0;
        if (this.layoutMode === 'mobile') {
            btn.style.display = latestOffScreen ? 'flex' : 'none';
            return;
        }
        btn.style.display = latestOffScreen && this.pointerNearScrollBtn ? 'flex' : 'none';
    }

    /** Glide the view back to the most recent bars, keeping the current zoom (barSpacing). */
    private scrollToRealtime(): void {
        if (this.coords.barCount === 0) return;
        this.glideRightOffset(ZOOM_OUT_MARGIN_BARS);
    }

    /** Ease rightOffset to `target` at constant zoom (see animTick's scroll glide);
     *  instant when pan animation is off. Shared by scroll-to-latest and panBy. */
    private glideRightOffset(target: number): void {
        const vp = this.coords.getViewport();
        if (!this.animPan) {
            this.applyViewport({ barSpacing: vp.barSpacing, rightOffset: target });
            return;
        }
        this.panVelocity = 0;
        this.targetBarSpacing = vp.barSpacing; // keep zoom fixed so animTick doesn't re-anchor
        this.scrollTargetRO = target;
        this.animator.start();
    }

    /**
     * Export the current chart as a PNG data URL by compositing the geometry (L0)
     * + chrome (L1) + user-drawings (L1.5) canvases onto an offscreen canvas. The
     * background is filled first (the canvas2d data layer is transparent — its bg
     * lives on the wrapper), and a fresh synchronous paint runs first so the WebGL2
     * backend's (non-preserved) drawing buffer is populated before it's read back
     * this tick — the same paint also repaints the drawings layers, so they're
     * current (interleaved drawings are already inside the data composite). They're
     * drawn bottom-up in DOM stacking order so the front user drawings (trend lines,
     * boxes, etc.) sit above the Pine drawings on the chrome layer, matching what's
     * on screen. The crosshair (L2) and DOM overlays (tables, legend) are
     * intentionally excluded.
     */
    screenshot(): string | null {
        if (!this.dataCanvas) return null;
        this.computeScales();
        this.paintData();
        const out = document.createElement('canvas');
        out.width = this.dataCanvas.width;
        out.height = this.dataCanvas.height;
        const ctx = out.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(this.dataCanvas, 0, 0);
        ctx.drawImage(this.chromeCanvas, 0, 0);
        ctx.drawImage(this.drawingsCanvas, 0, 0);
        return out.toDataURL('image/png');
    }

    /**
     * The candles-first-appear reveal — animates the **candles themselves** (no extra
     * element). Each candle's OHLC is interpolated from a flat tick at its open up to
     * full size, eased, with a left→right stagger so the chart draws itself; `settle`
     * adds an ease-out-back overshoot. Autoscale stays on the real bars so the frame
     * never moves. Re-callable, so styles can be compared live from the console.
     */
    private playIntro(style: string): void {
        if (this.introRaf != null) cancelAnimationFrame(this.introRaf);
        this.introRaf = null;
        const real = this.bars;
        const n = real.length;
        if (n === 0) return;
        // Pin the price scale to the real-data autoscale for the whole reveal.
        this.computeScales();
        for (const pane of this.scene.panes.values()) pane.scale = { ...pane.scaleTarget };
        this.modelAlpha = 0; // indicators stay hidden until the candles finish
        const DURATION = 650;
        const start = performance.now();
        const step = (now: number): void => {
            const p = Math.min(1, (now - start) / DURATION);
            this.scene.bars = p >= 1 ? real : real.map((b, i) => this.revealCandle(b, i, p, n, style));
            this.paintData();
            if (p < 1) {
                this.introRaf = requestAnimationFrame(step);
            } else {
                this.scene.bars = real;
                this.fadeInModels(); // candles done → fade the indicators in
            }
        };
        this.introRaf = requestAnimationFrame(step);
    }

    /** After the candle reveal, fade the indicator models (series/fills/…) from hidden to full. */
    private fadeInModels(): void {
        const FADE = 350;
        const start = performance.now();
        const step = (now: number): void => {
            this.modelAlpha = Math.min(1, (now - start) / FADE);
            this.paintData();
            if (this.modelAlpha < 1) {
                this.introRaf = requestAnimationFrame(step);
            } else {
                this.modelAlpha = 1;
                this.introRaf = null;
            }
        };
        this.introRaf = requestAnimationFrame(step);
    }

    /**
     * One candle of the reveal: interpolate its body + wick from a flat tick at the open
     * up to full size, staggered left→right. `settle` overshoots past full then eases back.
     */
    private revealCandle(b: OHLCV, i: number, p: number, n: number, style: string): OHLCV {
        const SPAN = 0.55; // fraction of the timeline the wave takes to cross left→right
        const local = Math.max(0, Math.min(1, (p - (i / Math.max(1, n - 1)) * SPAN) / (1 - SPAN)));
        let t: number;
        if (style === 'settle') {
            const c1 = 1.70158;
            const u = local - 1;
            t = 1 + (c1 + 1) * u * u * u + c1 * u * u; // ease-out-back (overshoot)
        } else {
            const u = 1 - local;
            t = 1 - u * u * u; // ease-out cubic (grow)
        }
        const o = b.open;
        return { ...b, high: o + (b.high - o) * t, low: o + (b.low - o) * t, close: o + (b.close - o) * t };
    }

    /** Theme with the configured candle up/down colors applied (candles, wicks,
     *  plotcandle defaults, and the current-price line direction all follow them). */
    private deriveTheme(theme: VelaTheme): VelaTheme {
        return { ...theme, upColor: this.candleUp, downColor: this.candleDown };
    }

    /** The theme the chrome (drawing toolbar / settings popups) paints with: the live theme
     *  but pinned to the stable surface background, text, and border, so custom plot cosmetics
     *  never recolor the toolbar, gutters, or drawing UI chrome. */
    private chromeTheme(): VelaTheme {
        return {
            ...this.theme,
            background: this.surfaceBackground,
            textColor: this.surfaceTextColor,
            // The divider follows the stable surface, not the live plot background, so a
            // light app theme gets light dividers without plot cosmetics bleeding in.
            borderColor: isDarkColor(this.surfaceBackground) ? DARK_THEME.borderColor : LIGHT_THEME.borderColor,
        };
    }

    /** The colors the axis-scale gutters (price + time) paint with: the LIVE chart background
     *  (`layout.background`) and its contrast-corrected text, so the scales read as part of the
     *  plot. Only the toolbar/dialog chrome stays on the stable app-theme surface. */
    private axisSurface(): { background: string; textColor: string } {
        return { background: this.theme.background, textColor: this.theme.textColor };
    }

    // ── lifecycle ──
    mount(container: HTMLElement, theme: VelaTheme): void {
        this.mountContainer = container;
        this.publishGutters();
        this.theme = this.deriveTheme(theme);
        // provisional chrome surface (refined by the first applyConfig)
        this.surfaceBackground = theme.background;
        this.surfaceTextColor = theme.textColor;

        this.wrapper = document.createElement('div');
        Object.assign(this.wrapper.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', cursor: 'crosshair' });
        // Every DOM overlay below is a descendant, so the chrome tokens land once here.
        applyChromeTokens(this.wrapper, this.chromeTheme());

        // L0.25 volume columns: bottom-anchored per-bar volume, ABOVE the geometry canvas so
        // grid lines and candles cannot paint over them. Transparent + pointer-transparent.
        this.volumeCanvas = document.createElement('canvas');
        Object.assign(this.volumeCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });

        // L0 geometry — the swappable backend (WebGL2 if available, else canvas2d)
        // owns the data canvas + gets its rendering context.
        this.dataCanvas = this.createGeometryBackend();

        // L0.6 VPVR: the visible-range volume profile against the right edge, painted ABOVE
        // the candles (it reads over them, translucent) but below the chrome/axes.
        this.vpvrCanvas = document.createElement('canvas');
        Object.assign(this.vpvrCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });

        // L1 chrome (canvas2d): Pine drawings + axes + current-price line. Transparent,
        // above the geometry layer (so the GL backend never has to rasterize text).
        this.chromeCanvas = document.createElement('canvas');
        Object.assign(this.chromeCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });

        // L1.5 user drawings: trend lines/boxes/labels + selection handles + the live
        // placing ghost. Above Pine drawings (chrome), below the crosshair. Transparent +
        // pointer-transparent — pointer events reach the data canvas (InputController),
        // which hands gestures to the drawings layer via the region-claim seam.
        this.drawingsCanvas = document.createElement('canvas');
        Object.assign(this.drawingsCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });

        // L2 cursor: the crosshair, repainted alone on the cheap Cursor tier.
        this.cursorCanvas = document.createElement('canvas');
        Object.assign(this.cursorCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });

        this.overlayRoot = document.createElement('div');
        Object.assign(this.overlayRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });

        // The plot sub-container holds the canvases + all plot-relative DOM overlays. It is inset to
        // the right of the toolbar gutter (left = toolbarGutter), so everything inside stays 0-based
        // at the plot's left edge — pointer coords, the coordinate system, grid, and the projector
        // are unchanged. The toolbar docks in the wrapper's left strip (the gutter).
        this.plot = document.createElement('div');
        Object.assign(this.plot.style, { position: 'absolute', top: '0', right: '0', bottom: '0', left: '0' });
        // SDK renderer layers: one transparent canvas each, stacked by placement —
        // 'below-data' behind the candles, 'above-data' over them (under the chrome/axes).
        this.extLayers = rendererLayers().map((def) => {
            const canvas = document.createElement('canvas');
            Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
            return { def, instance: def.create(), canvas };
        });
        const below = this.extLayers.filter((l) => l.def.placement === 'below-data').map((l) => l.canvas);
        const above = this.extLayers.filter((l) => l.def.placement !== 'below-data').map((l) => l.canvas);
        this.plot.append(...below, this.dataCanvas, this.volumeCanvas, this.vpvrCanvas, ...above, this.chromeCanvas, this.drawingsCanvas, this.cursorCanvas, this.overlayRoot);
        this.wrapper.appendChild(this.plot);
        this.factoryConfig = this.getConfig();
        this.attributionEl = this.buildAttributionEl();
        if (!this.attributionEnabled) this.attributionEl.style.display = 'none';
        this.positionAttribution();
        this.wrapper.appendChild(this.attributionEl);
        container.appendChild(this.wrapper);
        this.applyBackground();

        this.volumeRenderer.mount(this.volumeCanvas);
        this.vpvrRenderer.mount(this.vpvrCanvas);
        for (const l of this.extLayers) l.instance.mount(l.canvas);
        this.chrome.mount(this.chromeCanvas);
        this.crosshairLayer.mount(this.cursorCanvas);
        this.coords.setViewport(defaultViewport());
        this.scene.ensurePane(PRICE_PANE_ID, 'price', 0, 3);

        this.scheduler = new Scheduler((level) => this.renderFrame(level));
        this.animator = new Animator((dt) => this.animTick(dt));
        this.targetBarSpacing = this.coords.getViewport().barSpacing;
        this.input = new InputController({
            getCoords: () => this.coords,
            apply: (vp) => this.applyViewport(vp),
            zoomTo: (target, anchorLogical, anchorX) => this.zoomTo(target, anchorLogical, anchorX),
            fling: (v) => this.fling(v),
            onPointerMove: (x, y) => this.handlePointerMove(x, y),
            onClick: (x) => this.handleClick(x),
            onAxisLongPress: (axis, x, y) => {
                for (const cb of this.axisLongPressCbs) cb({ axis, x, y });
            },
            beginPriceScale: (x, y) => this.beginPriceScale(x, y),
            priceScaleBy: (dy) => this.priceScaleBy(dy),
            beginPricePan: (y) => this.beginPricePan(y),
            pricePanBy: (dy) => this.pricePanBy(dy),
            resetPriceScale: (x, y) => this.resetPriceScale(x, y),
            dataDblClick: (x, y) => this.dataDblClick(x, y),
            paneSeparatorAt: (y) => this.paneSeparatorAt(y),
            beginPaneResize: (y) => this.beginPaneResize(y),
            paneResizeBy: (dy) => this.paneResizeBy(dy),
            resetPaneSize: (y) => this.resetPaneSize(y),
            resetView: () => this.resetView(),
            // User drawings claim a gesture before pan when armed / over a drawing.
            drawingsClaim: (x, y) => this.userDrawings?.claim(x, y) ?? false,
            drawingsMeasureStart: (x, y) => this.userDrawings?.beginMeasureAt(x, y) ?? false,
            drawingsDeleteAt: (x, y) => this.userDrawings?.deleteAt(x, y) ?? false,
            drawingsSnapMode: () => this.snapMode,
            drawingsPointerDown: (x, y, snap, shift) => this.userDrawings?.pointerDown(x, y, snap, shift),
            drawingsPointerMove: (x, y, snap, shift) => this.userDrawings?.pointerMove(x, y, snap, shift),
            drawingsPointerUp: (x, y) => this.userDrawings?.pointerUp(x, y),
            drawingsCursor: (x, y) => this.userDrawings?.cursorAt(x, y) ?? null,
            drawingsDblClick: (x, y) => this.userDrawings?.dblClick(x, y) ?? false,
            drawingsClearTransient: () => this.userDrawings?.clearTransient(),
        });
        this.input.rightEdgeZoom = this.zoomAnchorMode === 'right'; // honor a pre-mount feature set
        this.input.axisDrag = this.axisDragEnabled;
        this.input.paneResize = this.paneResizeEnabled;
        // Attach to the data canvas so legend/gear/dialog clicks (above it) don't pan.
        this.input.attach(this.dataCanvas);
        if (this.settingsEnabled) this.setSettingsEnabled(true); // honor a pre-mount feature set
        this.syncCountdownTimer(); // start the countdown pump if the feature is on

        // "Scroll to most recent bar" button: created up front (hidden), revealed on cursor proximity
        // when the latest bar is scrolled off the right. Proximity is tracked on the plot so moving onto
        // the button (a plot child) keeps it revealed.
        this.scrollButton = this.makeScrollToRealtimeButton();
        this.plot.appendChild(this.scrollButton);
        this.plot.addEventListener('pointermove', this.onScrollProximityMove);
        this.plot.addEventListener('pointerleave', this.onScrollProximityLeave);

        // User-drawings layer (paints L1.5 plus the interleave layers the geometry backend
        // composites into the series stack, and owns the interaction/settings popup). It
        // implements the IDrawingsRendererPort the core DrawingController drives.
        this.userDrawings = new UserDrawingController(this.wrapper, this.plot, this.drawingsCanvas, {
            projector: () => this.drawingProjector(),
            dpr: () => this.coords.dpr,
            theme: () => this.theme,
            requestScaleUpdate: () => this.scheduler.invalidate(InvalidateLevel.Light),
            seriesBoundaries: (paneId) => this.scene.seriesBoundaries(paneId),
            priceZ: (paneId) => (paneId === PRICE_PANE_ID ? this.scene.candleZ : null),
            requestDataPaint: () => this.scheduler.invalidate(InvalidateLevel.Light),
            snap: (pt, paneId, mode, cursorPx) => this.snapToCandle(pt, paneId, mode, cursorPx),
            setSnapMode: (mode) => this.setSnapMode(mode),
            setToolbarGutter: (px) => this.setToolbarGutter(px),
        });
        this.userDrawings.historyChords = this.historyChordsEnabled; // may be set before init()
        // Honor a layout mode pushed before mount (the shell may set it ahead of the chart build).
        if (this.layoutMode === 'mobile') {
            this.mountContainer?.setAttribute('data-vela-layout', this.layoutMode);
            this.userDrawings.setLayoutMode(this.layoutMode);
            if (this.scrollButton) {
                this.scrollButton.style.width = `${SCROLL_BTN_SIZE_TOUCH}px`;
                this.scrollButton.style.height = `${SCROLL_BTN_SIZE_TOUCH}px`;
            }
        }

        this.keyboard = new KeyboardController({
            panByBars: (bars) => this.panByBars(bars),
            zoomByStep: (dir) => this.zoomByStep(dir),
            stepCrosshair: (delta) => this.stepCrosshair(delta),
            jumpToEdge: (edge) => this.focusBar(edge === 'first' ? 0 : this.coords.barCount - 1),
            resetView: () => this.resetView(),
            scrollToRealtime: () => this.scrollToRealtime(),
            clearCrosshair: () => this.handlePointerMove(null, null),
            preempt: (e) => this.userDrawings?.handleKey(e) ?? false,
        });
        this.setKeyboardEnabled(this.keyboardEnabled); // accessible by default; wires focus + ARIA

        this.inputsUI = new InputsUI(this.plot, theme, (paneId) => this.paneBoundsFor(paneId));
        this.inputsUI.setLayoutMode(this.layoutMode);
        this.inputsUI.setTitlesVisible(this.indicatorTitlesOn); // a remount keeps the toggle state
        this.inputsUI.setValuesVisible(this.indicatorValuesOn);
        this.inputsUI.setDialogHost(this.dialogHost);
        this.inputsUI.setSymbolPicker(this.symbolPicker);
        this.inputsUI.setLegendActions(this.legendActionsProvider);
        this.inputsUI.setLegendOverviewAction(this.legendOverviewAction);
        this.inputsUI.setOnChange((c) => {
            for (const cb of this.inputChangeCbs) cb({ indicatorId: c.indicatorId, key: c.key, value: c.value });
        });
        this.inputsUI.setOnRemove((id) => {
            for (const cb of this.removeIndicatorCbs) cb(id);
        });
        this.inputsUI.setOnToggleVisible((id, visible) => {
            for (const cb of this.toggleVisibleCbs) cb(id, visible);
        });
        this.inputsUI.setMoveApi({
            panes: () =>
                this.scene.orderedPanes().map((p, i) => ({
                    id: p.id,
                    kind: p.kind,
                    // A study pane is named after its master indicator ("Move to RSI"), not a
                    // positional "Pane N" (which shifts as panes reorder and means little).
                    label: p.kind === 'price' ? 'Main chart' : this.paneMasterTitle(p.id) ?? `Pane ${i}`,
                    top: p.bounds.top,
                    height: p.bounds.height,
                })),
            move: (id, target) => {
                for (const cb of this.moveIndicatorCbs) cb(id, target);
            },
        });

        this.paneControls = new PaneControls(this.plot, theme, {
            panes: () => this.paneControlViews(),
            rightAxis: () => this.rightAxisW,
            onMove: (paneId, dir) => this.movePaneLocal(paneId, dir),
            onToggleCollapse: (paneId) => {
                const pane = this.scene.panes.get(paneId);
                if (!pane) return;
                const collapsed = !pane.collapsed;
                pane.collapsed = collapsed;
                this.afterPaneLayoutChange();
                this.emitPaneAction({ type: 'collapse', paneId, collapsed });
            },
            onToggleMaximize: (paneId) => {
                const maximized = this.maximizedPaneId !== paneId;
                this.maximizedPaneId = maximized ? paneId : null;
                this.afterPaneLayoutChange();
                this.emitPaneAction({ type: 'maximize', paneId, maximized });
            },
        });

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.wrapper);
        this.watchDpr();
        this.syncSize();
    }

    /**
     * Create + mount the L0 geometry backend and return its canvas. Picks WebGL2
     * when allowed + available (probed), else the canvas2d backend (the permanent
     * fallback). If a GL context can't be acquired the (tainted) canvas is discarded
     * and a fresh one is made for canvas2d.
     */
    private makeDataCanvas(): HTMLCanvasElement {
        const c = document.createElement('canvas');
        Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
        return c;
    }

    private createGeometryBackend(): HTMLCanvasElement {
        if ((this.backendMode === 'auto' || this.backendMode === 'webgl2') && supportsWebGL2()) {
            const canvas = this.makeDataCanvas();
            const gl = new WebGL2Backend();
            gl.glow = this.glowAmount;
            gl.onNeedsRedraw = () => this.scheduler?.invalidate(InvalidateLevel.Full);
            gl.onContextFailed = () => this.swapToCanvas2dFallback();
            gl.mount(canvas);
            if (gl.ok) {
                this.backend = gl;
                return canvas;
            }
            gl.destroy(); // context acquisition failed → discard the tainted canvas
        }
        const canvas = this.makeDataCanvas();
        const c2 = new Canvas2dBackend();
        c2.mount(canvas);
        this.backend = c2;
        return canvas;
    }

    /**
     * The WebGL2 context became permanently unusable (a restore couldn't rebuild
     * the program) → replace the L0 backend with the canvas2d fallback on a fresh
     * data canvas. The chrome/cursor layers + viewport state are untouched.
     */
    private swapToCanvas2dFallback(): void {
        if (this.backend.kind === 'canvas2d') return;
        const old = this.dataCanvas;
        this.input?.detach();
        this.backend.destroy();
        const canvas = this.makeDataCanvas();
        const c2 = new Canvas2dBackend();
        c2.mount(canvas);
        this.backend = c2;
        old.replaceWith(canvas); // keep the same z-position under the chrome canvas
        this.dataCanvas = canvas;
        this.input?.attach(canvas);
        this.syncSize(); // size the new canvas + flushNow(Full) to repaint
    }

    /**
     * Re-sync both canvases when devicePixelRatio changes WITHOUT a CSS resize —
     * e.g. dragging the window to a monitor with different scaling, or an OS/
     * browser zoom change (the ResizeObserver doesn't fire for those). A
     * `(resolution: Xdppx)` query only tracks one dpr boundary, so it's re-armed
     * for the new dpr each time it fires.
     */
    private watchDpr(): void {
        if (typeof window.matchMedia !== 'function') return;
        this.dprMedia?.removeEventListener('change', this.onDprChange);
        this.dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        this.dprMedia.addEventListener('change', this.onDprChange, { once: true });
    }

    private readonly onDprChange = (): void => {
        this.watchDpr(); // re-arm for the new dpr
        this.resize(); // syncSize re-reads dpr and re-sizes both canvases together
    };

    setTheme(theme: VelaTheme): void {
        this.theme = this.deriveTheme(theme);
        // a full app-theme swap re-bases the chrome surface
        this.surfaceBackground = theme.background;
        this.surfaceTextColor = theme.textColor;
        if (this.wrapper) applyChromeTokens(this.wrapper, this.chromeTheme());
        this.applyBackground();
        this.inputsUI.setTheme(theme);
        this.paneControls?.setTheme(this.theme);
        // An open dialog rebuilds on setTheme — hand it the re-based config + the new
        // current of its Theme row first, so the rebuilt controls show live values.
        this.settingsDialog?.refreshConfig(this.getConfig());
        this.syncThemeControl();
        this.settingsDialog?.setTheme(this.theme);
        if (this.settingsButton) {
            this.settingsButton.style.background = this.theme.background;
            this.settingsButton.style.color = this.theme.textColor;
            this.settingsButton.style.borderColor = this.theme.borderColor;
        }
        this.refreshScrollButtonTheme();
        this.userDrawings?.setTheme(this.chromeTheme());
        this.refreshAttributionColor();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    resize(): void {
        this.syncSize();
    }

    /** Run a 1 Hz repaint pump while the countdown chip is on (so it ticks); stop it otherwise.
     *  Chrome tier: only the chip's wall-clock text moves — an idle chart must not recompute
     *  scales or repaint the geometry/volume/VPVR/SDK layers once a second (that cost
     *  multiplies by the cell count in a multi-chart workspace). */
    private syncCountdownTimer(): void {
        if (this.scene.showCountdown) {
            if (this.countdownTimer == null) {
                this.countdownTimer = setInterval(() => {
                    if (this.scene.showCountdown && this.scene.bars.length > 0) this.scheduler?.invalidate(InvalidateLevel.Chrome);
                }, 1000);
            }
        } else if (this.countdownTimer != null) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
    }

    destroy(): void {
        if (this.introRaf != null) cancelAnimationFrame(this.introRaf);
        this.loadingEl?.remove();
        this.loadingEl = null;
        if (this.countdownTimer != null) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
        this.scheduler?.destroy();
        this.animator?.stop();
        this.input?.detach();
        this.keyboard?.detach();
        this.keyboard = null;
        this.liveRegion = null;
        this.inputsUI?.destroy();
        this.paneControls?.destroy();
        for (const overlay of this.tableOverlays.values()) overlay.destroy();
        this.tableOverlays.clear();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.dprMedia?.removeEventListener('change', this.onDprChange);
        this.dprMedia = null;
        this.userDrawings?.destroy();
        this.userDrawings = null;
        this.settingsDialog?.destroy();
        this.settingsDialog = null;
        this.settingsButton?.remove();
        this.settingsButton = null;
        this.plot?.removeEventListener('pointermove', this.onScrollProximityMove);
        this.plot?.removeEventListener('pointerleave', this.onScrollProximityLeave);
        this.scrollButton?.remove();
        this.scrollButton = null;
        for (const l of this.extLayers) l.instance.destroy?.();
        this.extLayers = [];
        this.volumeRenderer.destroy();
        this.vpvrRenderer.destroy();
        this.backend.destroy();
        this.chrome.destroy();
        this.crosshairLayer.destroy();
        this.attributionEl?.remove();
        this.attributionEl = null;
        this.mountContainer?.style.removeProperty('--vela-toolbar-gutter');
        this.mountContainer?.style.removeProperty('--vela-scale-gutter');
        this.mountContainer = null;
        this.wrapper?.remove();
    }

    // ── price data ──
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void {
        if (this.introRaf != null) { cancelAnimationFrame(this.introRaf); this.introRaf = null; this.modelAlpha = 1; } // a re-set interrupts a running reveal
        // A series replacement invalidates the forming-bar glide: after an in-place market
        // switch the NEW market's forming bar shares the same bucket open-time, so a stale
        // eased close/high/low would paint a full-height candle (old-market prices on the
        // new scale) until the next tick re-seeds. The bars given here carry real values —
        // drop the ease; the next tick snaps fresh (liveEaseTime no longer matches).
        this.liveEaseTime = 0;
        const prevBars = this.bars;
        const prevHeadTime = prevBars[0]?.time;
        this.bars = normalizeBars(bars);
        this.scene.bars = this.bars;
        this.coords.setBars(this.bars.map((b) => b.time));
        // The bar array's head may have moved (a history-backfill prepend) — re-derive
        // every mounted model's anchor offset against the new indices.
        for (const model of this.scene.indicators.values()) this.refreshAnchorOffset(model);
        // Logical-space INTERACTION anchors need the same prepend shift: a wheel-zoom glide
        // recomputes rightOffset from `zoomAnchorLogical` EVERY frame — a backfill landing
        // mid-zoom would otherwise re-anchor thousands of bars into the past and teleport the
        // viewport (the "view jumps to the middle of history" bug). Same series only: on a
        // symbol/timeframe switch the head time won't match and the view re-fits anyway.
        if (opts?.preserveView === true && prevHeadTime != null && this.bars.length > 0) {
            // The head can move BOTH ways on the same series: a backfill PREPENDS older bars
            // (indices shift up), a shallower depth TRIMS from the front (indices shift down).
            // Only the prepend used to be handled, so a trim left the anchors pointing past
            // the data. The newest end is fixed either way, so the viewport itself never moves.
            const newHeadTime = this.bars[0]!.time;
            let shift = 0;
            if (newHeadTime !== prevHeadTime) {
                const prepended = this.bars.findIndex((b) => b.time === prevHeadTime);
                if (prepended > 0) shift = prepended;
                else {
                    const trimmed = prevBars.findIndex((b) => b.time === newHeadTime);
                    if (trimmed > 0) shift = -trimmed;
                }
            }
            if (shift !== 0) {
                this.zoomAnchorLogical += shift;
                if (this.hoverLogical != null) this.hoverLogical += shift;
            }
        }
        // Full bar replacement re-frames the view (matches LWC's fitContent on
        // every setData) — so a symbol/timeframe switch doesn't keep stale zoom.
        // `preserveView` keeps the current viewport: the series is right-anchored,
        // so extending it with older bars in place leaves the visible bars unchanged
        // (used when swapping the quick preview for the full history). Still fit the
        // first time, even with preserveView, so there's always an initial frame.
        const skipFit = opts?.preserveView === true && this.didInitialFit;
        if (this.coords.width > 0 && !skipFit) {
            this.fitContent();
            this.didInitialFit = true;
        }
        if (!this.introPlayed && this.bars.length > 0) {
            this.introPlayed = true; // play the reveal once, when candles first appear
            if (this.introStyle) {
                this.playIntro(this.introStyle); // the reveal owns the paint — no full-frame flash first
                return;
            }
        }
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    updateBar(bar: OHLCV): void {
        const n = this.bars.length;
        const last = this.bars[n - 1];
        if (last && bar.time === last.time) {
            this.bars[n - 1] = bar; // actual forming bar — the ease target
            if (this.liveEaseTime !== bar.time) this.syncLiveEase(bar); // first tick of this bar (snap), then ease
            this.animator.start(); // glide the displayed high/low/close toward this tick
        } else if (!last || bar.time > last.time) {
            this.bars.push(bar);
            this.syncLiveEase(bar); // a fresh bar — snap (never ease across bars)
            // Warm path: O(1) append (no full times remap / median re-sort). Cold start
            // (interval not yet established) takes the robust full-median setBars path.
            if (this.coords.barInterval > 0) this.coords.appendBar(bar.time);
            else this.coords.setBars(this.bars.map((b) => b.time));
        } else {
            return;
        }
        this.scene.bars = this.bars;
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Snap the eased forming-bar state to `bar` — no glide (a fresh bar or the first tick of one). */
    private syncLiveEase(bar: OHLCV): void {
        this.liveEaseTime = bar.time;
        this.liveEaseHigh = bar.high;
        this.liveEaseLow = bar.low;
        this.liveEaseClose = bar.close;
    }

    /** Glide the forming bar's displayed high/low/close toward the actual latest. Returns true while easing. */
    private easeLiveBar(dtMs: number): boolean {
        const target = this.bars[this.bars.length - 1];
        if (!target || this.liveEaseTime !== target.time) return false;
        const eps = Math.max(1e-9, Math.abs(target.close) * 1e-6);
        const nh = easeToward(this.liveEaseHigh, target.high, dtMs, LIVE_BAR_TAU_MS);
        const nl = easeToward(this.liveEaseLow, target.low, dtMs, LIVE_BAR_TAU_MS);
        const nc = easeToward(this.liveEaseClose, target.close, dtMs, LIVE_BAR_TAU_MS);
        const active = Math.abs(nh - target.high) > eps || Math.abs(nl - target.low) > eps || Math.abs(nc - target.close) > eps;
        this.liveEaseHigh = active ? nh : target.high;
        this.liveEaseLow = active ? nl : target.low;
        this.liveEaseClose = active ? nc : target.close;
        return active;
    }

    // ── panes ──
    ensurePane(pane: Pane): void {
        this.scene.ensurePane(pane.id, pane.kind, pane.order, pane.heightWeight ?? (pane.kind === 'price' ? 3 : 1));
        this.layoutPanes();
        this.repositionTables();
        // A new pane changes the count, so the lone price pane's maximize button appears.
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    removePane(id: string): void {
        if (id === PRICE_PANE_ID) return;
        this.scene.removePane(id);
        if (this.maximizedPaneId === id) this.maximizedPaneId = null;
        this.refreshAxisWidth();
        this.layoutPanes();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Move/merge a mounted indicator to another pane (its scale column follows via `ownScale`). */
    setIndicatorPane(handle: IndicatorRenderHandle, paneId: string, opts?: { ownScale?: boolean }): void {
        const model = this.scene.indicators.get(handle.id);
        if (!model) return;
        model.paneId = paneId;
        model.ownScale = opts?.ownScale === true;
        if (!model.ownScale) this.scene.dropIndicatorScale(handle.id);
        this.inputsUI.setPane(handle.id, paneId);
        this.refreshAnchorOffset(model);
        this.syncTables(model); // re-anchor any table overlay to the new pane
        this.refreshAxisWidth();
        this.layoutPanes();
        this.repositionTables();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    orderPanes(orderedIds: string[]): void {
        this.scene.orderPanes(orderedIds);
        this.layoutPanes();
        this.repositionTables();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    setPaneCollapsed(paneId: string, collapsed: boolean): void {
        const pane = this.scene.panes.get(paneId);
        if (!pane || pane.collapsed === collapsed) return;
        pane.collapsed = collapsed;
        this.layoutPanes();
        this.repositionTables();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    setPaneMaximized(paneId: string | null): void {
        if (paneId !== null && !this.scene.panes.has(paneId)) paneId = null;
        this.maximizedPaneId = paneId;
        this.layoutPanes();
        this.repositionTables();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    onPaneAction(cb: (a: PaneAction) => void): Unsubscribe {
        this.paneActionCbs.add(cb);
        return () => this.paneActionCbs.delete(cb);
    }

    private emitPaneAction(a: PaneAction): void {
        for (const cb of this.paneActionCbs) cb(a);
    }

    onMoveIndicator(cb: (id: string, target: MoveTarget) => void): Unsubscribe {
        this.moveIndicatorCbs.add(cb);
        return () => this.moveIndicatorCbs.delete(cb);
    }

    /** The number of merged (own-scale) scale columns needed = max across panes. */
    private maxOwnScaleColumns(): number {
        let max = 0;
        for (const pane of this.scene.panes.values()) {
            const n = this.scene.ownScaleIndicatorsForPane(pane.id).length;
            if (n > max) max = n;
        }
        return max;
    }

    /** Recompute the right-gutter width (master column + one per merged scale). Re-sizes on change. */
    private refreshAxisWidth(): boolean {
        const w = RIGHT_AXIS_W + AXIS_COL_W * this.maxOwnScaleColumns();
        if (w === this.rightAxisW) return false;
        this.rightAxisW = w;
        this.publishGutters();
        if (this.coords.width > 0) this.syncSize();
        return true;
    }

    // ── indicators ──

    /**
     * Re-derive one model's index offset: the chart bar index of its `anchorTime` (see
     * `IndicatorModel.anchorTime`). Absent anchor, or an anchor matching the first bar,
     * means whole-chart alignment — offset 0, today's norm. An anchor that doesn't land
     * exactly on a chart bar renders unanchored (defensive; engines stamp a real bar time).
     */
    private refreshAnchorOffset(model: IndicatorModel): void {
        const anchor = model.anchorTime;
        if (anchor == null || this.bars.length === 0) {
            this.scene.setAnchorOffset(model.id, 0);
            return;
        }
        const head = this.bars[0]!.time;
        if (anchor === head) {
            this.scene.setAnchorOffset(model.id, 0);
            return;
        }
        if (anchor < head) {
            // The model starts BEFORE the chart's first bar — its own leading values fall off
            // the left edge (the head moved forward under it: a trimmed series, or a shorter
            // reload arriving before the model re-runs). A NEGATIVE offset skips exactly those
            // points; treating this as "unanchored" (offset 0) is what pinned a stale model's
            // first value onto the chart's first bar and drew the whole plot shifted.
            const skip = leadingPointsBefore(model, head);
            if (skip == null) {
                // Nothing index-aligned to measure against (a drawings-only model). Keep the
                // old, honest-but-approximate behavior rather than inventing a count.
                console.warn(`[vela] indicator "${model.id}" starts before the first bar with no series to align on — rendering unanchored`);
                this.scene.setAnchorOffset(model.id, 0);
                return;
            }
            this.scene.setAnchorOffset(model.id, -skip);
            return;
        }
        // Lower-bound binary search over the sorted bar times.
        let lo = 0;
        let hi = this.bars.length - 1;
        let at = this.bars.length;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.bars[mid]!.time >= anchor) { at = mid; hi = mid - 1; } else lo = mid + 1;
        }
        if (at >= this.bars.length || this.bars[at]!.time !== anchor) {
            console.warn(`[vela] indicator "${model.id}" anchorTime matches no chart bar — rendering unanchored`);
            this.scene.setAnchorOffset(model.id, 0);
            return;
        }
        this.scene.setAnchorOffset(model.id, at);
    }

    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        this.scene.indicators.set(model.id, model);
        this.refreshAnchorOffset(model);
        this.scene.assignIndicatorZ(model.id); // default z = mount order (later ⇒ in front)
        // Legend chip prefers the compact shorttitle; the settings dialog keeps the full title.
        this.inputsUI.upsert(model.id, model.shorttitle ?? model.title, model.inputs, model.inputValues, model.paneId, {
            native: !!model.native,
            ...(model.shorttitle ? { settingsTitle: model.title } : {}),
        });
        this.syncTables(model);
        if (model.native?.type === 'volume') {
            this.volumeActive = true; // the volume layer follows the indicator's presence
            this.volumeHidden = false;
        } else if (model.native?.type === 'vpvr') {
            this.vpvrActive = true; // the VPVR layer follows the indicator's presence
            this.vpvrHidden = false;
        }
        if (model.ownScale) this.refreshAxisWidth();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
        return { id: model.id };
    }

    updateIndicator(handle: IndicatorRenderHandle, patch: ScenePatch): void {
        const model = this.scene.indicators.get(handle.id);
        if (!model) return;
        // A value patch from a re-run over a DIFFERENT bar window carries its anchor; `null`
        // says the run spanned the whole chart and CLEARS the previous one.
        if (patch.kind === 'value' && patch.anchorTime !== undefined) {
            const next = patch.anchorTime ?? undefined;
            if (next !== model.anchorTime) {
                model.anchorTime = next;
                this.refreshAnchorOffset(model);
            }
        }
        applyPatch(model, patch);
        this.syncTables(model);
        this.scheduler.invalidate(InvalidateLevel.Light);
    }

    removeIndicator(handle: IndicatorRenderHandle): void {
        const nativeType = this.scene.indicators.get(handle.id)?.native?.type;
        if (nativeType === 'volume') {
            this.volumeActive = false; // tear down the volume layer with the indicator
            this.volumeHidden = false;
            this.scene.volumeLayer = null;
        } else if (nativeType === 'vpvr') {
            this.vpvrActive = false; // tear down the VPVR layer with the indicator
            this.vpvrHidden = false;
            this.scene.vpvrLayer = null;
        }
        this.scene.indicators.delete(handle.id);
        this.scene.forgetIndicatorZ(handle.id);
        this.scene.forgetAnchorOffset(handle.id);
        this.scene.dropIndicatorScale(handle.id);
        this.inputsUI.remove(handle.id);
        this.tableOverlays.get(handle.id)?.destroy();
        this.tableOverlays.delete(handle.id);
        this.refreshAxisWidth();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    setIndicatorInputs(handle: IndicatorRenderHandle, values: Record<string, InputValue>): void {
        this.inputsUI.setValues(handle.id, values);
    }

    setSymbolPicker(picker: SymbolPickerFn | null): void {
        this.symbolPicker = picker;
        this.inputsUI?.setSymbolPicker(picker);
    }

    setLegendActions(provider: ((indicatorId: string) => LegendActionView[]) | null): void {
        this.legendActionsProvider = provider;
        this.inputsUI?.setLegendActions(provider);
    }

    setLegendOverviewAction(action: (() => void) | null): void {
        this.legendOverviewAction = action;
        this.inputsUI?.setLegendOverviewAction(action);
    }

    openIndicatorSettings(indicatorId: string): void {
        this.inputsUI?.openSettingsFor(indicatorId);
    }

    /**
     * Hide/show a mounted indicator. Hiding drops its model from the scene (so every paint path —
     * series, fills, drawings, tables, glow, data window — skips it) while keeping its z key and its
     * legend row (marked hidden). The core re-mounts it on show, so this only needs to drop the
     * visuals and flag the row.
     */
    setIndicatorVisible(handle: IndicatorRenderHandle, visible: boolean): void {
        // Layer-drawn natives have no series in the scene — suppress/restore their layer instead of
        // dropping the model (kept so the layer stays identifiable + its data survives the hide).
        const nativeType = this.scene.indicators.get(handle.id)?.native?.type;
        if (nativeType === 'volume' || nativeType === 'vpvr') {
            if (nativeType === 'volume') this.volumeHidden = !visible;
            else this.vpvrHidden = !visible;
            this.inputsUI.setVisible(handle.id, visible);
            this.scheduler.invalidate(InvalidateLevel.Full);
            return;
        }
        if (!visible) {
            this.scene.indicators.delete(handle.id); // keep the z key (forgetIndicatorZ NOT called) so show preserves order
            this.tableOverlays.get(handle.id)?.destroy();
            this.tableOverlays.delete(handle.id);
        }
        this.inputsUI.setVisible(handle.id, visible);
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    // ── events ──
    onInputChange(cb: (e: InputChangeEvent) => void): Unsubscribe {
        this.inputChangeCbs.add(cb);
        return () => this.inputChangeCbs.delete(cb);
    }

    onToggleIndicatorVisible(cb: (id: string, visible: boolean) => void): Unsubscribe {
        this.toggleVisibleCbs.add(cb);
        return () => this.toggleVisibleCbs.delete(cb);
    }

    onPriceStyleChange(cb: (style: PriceStyle) => void): Unsubscribe {
        this.priceStyleCbs.add(cb);
        return () => this.priceStyleCbs.delete(cb);
    }

    /**
     * THE single write path for the base price style at runtime (feature set / settings dialog /
     * config template — the constructor seeds the field directly, pre-listeners). Updates the
     * scene, eases any reveal layer toward the new style's target, and notifies the core —
     * which owns the DATA side of styles that need one (a chart type's SeriesDataEngine).
     */
    private setPriceStyle(style: PriceStyle): void {
        if (style === this.scene.priceStyle) return;
        this.scene.priceStyle = style;
        this.scene.basePainting = basePaintingOf(style);
        this.scene.candleOverride = candleOverrideFor(style, this.scene.style.chartTypes);
        for (const cb of this.priceStyleCbs) cb(style);
    }

    onRemoveIndicator(cb: (id: string) => void): Unsubscribe {
        this.removeIndicatorCbs.add(cb);
        return () => this.removeIndicatorCbs.delete(cb);
    }

    /** Port surface: the host shell's chrome size class. Mobile switches the renderer
     *  chrome to its touch-first presentation — fullscreen dialogs, no docked drawing
     *  toolbar (the shell provides its own picker), the scroll-to-latest button shown
     *  whenever the latest bars are off-screen (touch has no cursor proximity). */
    setLayoutMode(mode: 'mobile' | 'desktop'): void {
        if (mode === this.layoutMode) return;
        this.layoutMode = mode;
        this.mountContainer?.setAttribute('data-vela-layout', mode);
        this.userDrawings?.setLayoutMode(mode);
        this.settingsDialog?.setLayoutMode(mode);
        this.inputsUI?.setLayoutMode(mode);
        if (this.scrollButton) {
            // A finger needs a larger target than a cursor.
            const px = mode === 'mobile' ? SCROLL_BTN_SIZE_TOUCH : SCROLL_BTN_SIZE;
            this.scrollButton.style.width = `${px}px`;
            this.scrollButton.style.height = `${px}px`;
        }
        this.updateScrollToRealtimeButton();
    }

    setSettingsSections(sections: HostSettingsSection[]): void {
        this.hostSettingsSections = sections;
        this.settingsDialog?.setHostSections(sections);
    }

    onChartTypeSettingsChange(cb: (typeId: string, values: Record<string, unknown>) => void): Unsubscribe {
        this.chartTypeSettingsCbs.add(cb);
        return () => this.chartTypeSettingsCbs.delete(cb);
    }

    onConfigChanged(cb: () => void): Unsubscribe {
        this.configChangedCbs.add(cb);
        return () => this.configChangedCbs.delete(cb);
    }

    onThemeSelect(cb: (theme: ThemeName) => void): Unsubscribe {
        this.themeSelectCbs.add(cb);
        return () => this.themeSelectCbs.delete(cb);
    }

    onCrosshairMove(cb: (e: CrosshairEvent) => void): Unsubscribe {
        this.crosshairCbs.add(cb);
        return () => this.crosshairCbs.delete(cb);
    }

    onClick(cb: (e: ClickEvent) => void): Unsubscribe {
        this.clickCbs.add(cb);
        return () => this.clickCbs.delete(cb);
    }

    onAxisLongPress(cb: (e: AxisLongPressEvent) => void): Unsubscribe {
        this.axisLongPressCbs.add(cb);
        return () => this.axisLongPressCbs.delete(cb);
    }

    onViewportChange(cb: (range: VisibleRange) => void): Unsubscribe {
        this.viewportCbs.add(cb);
        return () => this.viewportCbs.delete(cb);
    }

    // ── viewport ──
    getVisibleRange(): VisibleRange | null {
        const n = this.coords.barCount;
        if (n === 0 || this.coords.width === 0) return null;
        // Data-bounded like LwC: clamp to actual bar indices so `from`/`to` are REAL
        // bar times. Visible-range scripts compare `time == chart.right_visible_bar_time`
        // exactly, so returning the extrapolated whitespace edge would never match a bar.
        const vr = this.coords.visibleLogicalRange();
        const from = Math.max(0, Math.ceil(vr.from));
        const to = Math.min(n - 1, Math.floor(vr.to));
        if (to < from) return null; // scrolled entirely into the whitespace
        return { from: this.coords.logicalToTime(from), to: this.coords.logicalToTime(to) };
    }

    setVisibleRange(range: VisibleRange): void {
        const fromL = this.coords.timeToLogical(range.from);
        const toL = this.coords.timeToLogical(range.to);
        const span = Math.max(1e-6, toL - fromL);
        const barSpacing = clampBarSpacing(this.coords.width / (span * this.coords.spacingScale));
        const rightOffset = toL - (this.coords.barCount - 1);
        this.applyViewport({ barSpacing, rightOffset });
    }

    /** Pan by a fraction of the visible width at constant zoom (positive ⇒ toward the
     *  latest bars). Mirrors a drag exactly: the target is clamped by the same viewport
     *  bounds (so panning forward stops at the newest candle plus the bounded right
     *  whitespace) and eases on the scroll-to-latest glide — repeated calls retarget the
     *  running glide, so a held key reads as one continuous scroll. */
    panBy(fraction: number): void {
        if (this.coords.barCount === 0 || this.coords.width === 0) return;
        const vp = this.coords.getViewport();
        const visBars = this.coords.width / this.coords.pxPerBar();
        const base = this.scrollTargetRO ?? vp.rightOffset; // stack onto an in-flight glide
        this.glideRightOffset(this.clampViewport(vp.barSpacing, base + fraction * visBars).rightOffset);
    }

    // ── internals ──
    /** Instant viewport set (drag, freeze-on-touch, setVisibleRange) — stops any animation. */
    private applyViewport(vp: ViewportState): void {
        this.animator.stop();
        this.panVelocity = 0;
        this.scrollTargetRO = null;
        const clamped = this.clampViewport(vp.barSpacing, vp.rightOffset);
        this.coords.setViewport(clamped);
        this.targetBarSpacing = clamped.barSpacing;
        this.scheduler.invalidate(InvalidateLevel.Full);
        this.emitViewportChange();
    }

    /** Eased cursor-anchored zoom: glide barSpacing → target, pinning the anchor logical at its pixel. */
    private zoomTo(target: number, anchorLogical: number, anchorX: number): void {
        // Clamp the target to the dynamic zoom range so the animator settles inside the limits.
        const barSpacing = this.clampViewport(target, this.coords.getViewport().rightOffset).barSpacing;
        this.zoomAnchorLogical = anchorLogical;
        this.zoomAnchorX = anchorX;
        this.panVelocity = 0;
        this.scrollTargetRO = null;
        if (!this.animZoom) {
            const v = this.clampViewport(barSpacing, this.anchoredRightOffset(barSpacing));
            this.coords.setViewport(v);
            this.targetBarSpacing = v.barSpacing;
            this.scheduler.invalidate(InvalidateLevel.Full);
            this.emitViewportChange();
            return;
        }
        this.targetBarSpacing = barSpacing;
        this.animator.start();
    }

    /** Inertial pan: continue with a rightOffset velocity (logical units / ms) that decays. */
    private fling(velocity: number): void {
        if (!this.animPan) return; // pan animation off → drag-release stops dead
        this.scrollTargetRO = null; // a fresh flick cancels an in-flight scroll-to-latest glide
        this.panVelocity = velocity;
        this.animator.start();
    }

    private anchoredRightOffset(barSpacing: number): number {
        // Pinning a pixel while zooming is a px→bar conversion, so it uses the EFFECTIVE pitch
        // (zoom × spacing multiplier) — otherwise the anchor drifts when the multiplier ≠ 1.
        const pitch = barSpacing * this.coords.spacingScale;
        return this.zoomAnchorLogical + (this.coords.width - this.zoomAnchorX) / pitch - (this.coords.barCount - 1);
    }

    /**
     * Bound the viewport so the user can't zoom/pan into a useless state:
     *  - zoom OUT no further than "all bars + a small margin fill the width" (no thin strip
     *    of compressed candles floating in whitespace);
     *  - zoom IN no further than keeping ≥ {@link MIN_VISIBLE_BARS} candles on screen;
     *  - pan no further than a bounded right whitespace / the same minimum visible.
     * Applied at every viewport write (drag, wheel, fling, time-axis drag, keyboard).
     */
    private clampViewport(barSpacing: number, rightOffset: number): ViewportState {
        const n = this.coords.barCount;
        const W = this.coords.width;
        if (n <= 1 || W <= 0) return { barSpacing: clampBarSpacing(barSpacing), rightOffset };
        const minVisible = Math.min(MIN_VISIBLE_BARS, n);
        // Bars-on-screen depends on the EFFECTIVE pitch (barSpacing × spacing multiplier), so fold
        // the multiplier into these bar-count limits — else a >1 multiplier would let the user zoom
        // in past minVisible, or zoom out to a thin strip that no longer fills the width.
        const scale = this.coords.spacingScale;
        // bar spacing: max keeps ≥ minVisible bars on screen; min keeps all bars + a margin within the width.
        const maxBs = Math.min(MAX_BAR_SPACING, W / (minVisible * scale));
        const minBs = Math.max(MIN_BAR_SPACING, Math.min(maxBs, W / ((n + ZOOM_OUT_MARGIN_BARS) * scale)));
        const bs = Math.max(minBs, Math.min(maxBs, barSpacing));
        // right offset: the ONLY pan limit is keeping ≥ minVisible candles on screen. Panning left
        // can push the data far left (lots of right whitespace) until just minVisible remain; panning
        // right can scroll into the oldest bars until just minVisible remain at the right edge.
        const visBars = W / (bs * scale);
        const maxRo = visBars - (minVisible - 1); // slide left until exactly minVisible candles remain
        const minRo = minVisible - n; // slide right until exactly minVisible candles remain at the right edge
        const ro = Math.max(minRo, Math.min(maxRo, rightOffset));
        return { barSpacing: bs, rightOffset: ro };
    }

    /** One animation frame: ease zoom + integrate inertia + glide autoscale, then paint. */
    private animTick(dtMs: number): boolean {
        const vp = this.coords.getViewport();
        let barSpacing = vp.barSpacing;
        let rightOffset = vp.rightOffset;
        let active = false;

        const tbs = this.targetBarSpacing;
        if (Math.abs(barSpacing - tbs) > tbs * 1e-3) {
            barSpacing = clampBarSpacing(easeToward(barSpacing, tbs, dtMs, ZOOM_TAU_MS));
            rightOffset = this.anchoredRightOffset(barSpacing);
            active = true;
        } else if (barSpacing !== tbs) {
            barSpacing = tbs;
            rightOffset = this.anchoredRightOffset(barSpacing);
        }

        const stopVel = FLING_STOP_PX / Math.max(1e-6, barSpacing * this.coords.spacingScale); // zoom-invariant stop point
        if (Math.abs(this.panVelocity) > stopVel) {
            rightOffset += this.panVelocity * dtMs;
            this.panVelocity *= Math.exp(-dtMs / FLING_TAU_MS);
            if (Math.abs(this.panVelocity) <= stopVel) this.panVelocity = 0;
            else active = true;
        }

        // Scroll-to-latest glide: ease rightOffset toward the target margin at constant zoom.
        if (this.scrollTargetRO != null) {
            const target = this.scrollTargetRO;
            const next = easeToward(rightOffset, target, dtMs, SCROLL_TO_TAU_MS);
            if (Math.abs(next - target) < 1e-3) {
                rightOffset = target;
                this.scrollTargetRO = null;
            } else {
                rightOffset = next;
                active = true;
            }
        }

        const clamped = this.clampViewport(barSpacing, rightOffset);
        // The clamp bounds depend on the chart WIDTH, so a resize (splitter drag, layout
        // change) can strand a target outside the reachable range mid-ease. Snap a target
        // the clamp rejected onto the bound it chose — otherwise the ease above re-arms
        // forever: a permanent rAF loop emitting a viewport change every frame and
        // jittering rightOffset through the zoom anchor until a pointerdown re-aligns it.
        if (clamped.barSpacing !== barSpacing) this.targetBarSpacing = clamped.barSpacing;
        if (this.scrollTargetRO != null && clamped.rightOffset !== rightOffset) this.scrollTargetRO = clamped.rightOffset;
        this.coords.setViewport(clamped);
        this.computeScales(); // sets pane.scaleTarget (animator active → no snap)
        if (this.easeScales(dtMs)) active = true;
        if (this.easeLiveBar(dtMs)) active = true; // glide the forming bar toward the latest tick
        this.skeletonClockMs += dtMs; // drives the loading-skeleton pulse (harmless when none show)
        this.paintData();
        this.crosshairLayer.render(this.scene, this.coords, this.theme, this.hoverSeparatorY, this.externalCrossPx());
        this.updateLegendValues(); // the animator owns the frame — renderFrame won't run
        this.emitViewportChange();
        return active;
    }

    /** Ease each pane's rendered scale toward its autoscale target (snap within epsilon).
     *  Log panes ease in LOG space so the glide is uniform on screen (the pane renders
     *  through Math.log), not a non-linear jump. */
    private easeScales(dtMs: number): boolean {
        let moving = false;
        for (const pane of this.scene.panes.values()) {
            const t = pane.scaleTarget;
            const s = pane.scale;
            if (t.log && s.min > 0 && t.min > 0) {
                const lt0 = Math.log(t.min);
                const lt1 = Math.log(t.max);
                const lspan = Math.max(1e-9, Math.abs(lt1 - lt0));
                const n0 = easeToward(Math.log(s.min), lt0, dtMs, SCALE_TAU_MS);
                const n1 = easeToward(Math.log(s.max), lt1, dtMs, SCALE_TAU_MS);
                if (Math.abs(n0 - lt0) <= lspan * 1e-3 && Math.abs(n1 - lt1) <= lspan * 1e-3) {
                    pane.scale = { min: t.min, max: t.max, log: true };
                } else {
                    moving = true;
                    pane.scale = { min: Math.exp(n0), max: Math.exp(n1), log: true };
                }
                continue;
            }
            const span = Math.max(1e-9, Math.abs(t.max - t.min));
            let nmin = easeToward(s.min, t.min, dtMs, SCALE_TAU_MS);
            let nmax = easeToward(s.max, t.max, dtMs, SCALE_TAU_MS);
            if (Math.abs(nmin - t.min) <= span * 1e-3 && Math.abs(nmax - t.max) <= span * 1e-3) {
                nmin = t.min;
                nmax = t.max;
            } else {
                moving = true;
            }
            pane.scale = { min: nmin, max: nmax, log: t.log };
        }
        // Merged (own-scale) indicator windows glide the same way (always linear).
        for (const sl of this.scene.indicatorScales.values()) {
            const t = sl.scaleTarget;
            const s = sl.scale;
            const span = Math.max(1e-9, Math.abs(t.max - t.min));
            let nmin = easeToward(s.min, t.min, dtMs, SCALE_TAU_MS);
            let nmax = easeToward(s.max, t.max, dtMs, SCALE_TAU_MS);
            if (Math.abs(nmin - t.min) <= span * 1e-3 && Math.abs(nmax - t.max) <= span * 1e-3) {
                nmin = t.min;
                nmax = t.max;
            } else {
                moving = true;
            }
            sl.scale = { min: nmin, max: nmax };
        }
        return moving;
    }

    private emitViewportChange(): void {
        this.updateScrollToRealtimeButton(); // reveal/hide as the latest bar scrolls in/out of view
        const range = this.getVisibleRange();
        if (range) for (const cb of this.viewportCbs) cb(range);
    }

    private handlePointerMove(x: number | null, y: number | null): void {
        if (x === null || y === null || this.coords.barCount === 0) {
            this.scene.crosshair = null;
            this.hoverSeparatorY = null;
            this.lastPointer = null;
            this.scheduler.invalidate(InvalidateLevel.Cursor);
            this.hoverLogical = null; // off the plot ⇒ the readout falls back to the latest bar
            const empty: CrosshairEvent = { time: null, price: null, values: new Map(), ohlc: null };
            for (const cb of this.crosshairCbs) cb(empty);
            return;
        }
        const inData = x >= 0 && y >= 0 && x <= this.coords.width && y <= this.coords.height;
        this.scene.crosshair = inData ? { x, y } : null;
        this.lastPointer = inData ? { x, y } : null;
        // The separator spans data + gutter, so its hover highlight tracks the full width (not just
        // the data area) — the divider stays a visible, grabbable handle over the scale too.
        this.hoverSeparatorY = x >= 0 && y >= 0 && y <= this.coords.height ? this.separatorHoverY(y) : null;
        // Cursor tier: repaint only the crosshair overlay, not the data layer.
        this.scheduler.invalidate(InvalidateLevel.Cursor);

        // Only report a time/value when the cursor is over a real bar (not the
        // right-offset whitespace) — matches LWC emitting null off any data point.
        const logical = Math.round(this.coords.xToLogical(x));
        const onBar = logical >= 0 && logical < this.coords.barCount;
        const time = onBar ? this.coords.logicalToTime(logical) : null;
        const pane = this.paneAtY(y);
        const price = inData && pane ? this.coords.yToPrice(y, pane.scale, pane.bounds) : null;
        const values = new Map<string, number>();
        if (onBar) {
            for (const model of this.scene.indicators.values()) {
                const off = this.scene.offsetOf(model.id);
                for (const s of model.series) {
                    if (isLineLikeSeries(s)) {
                        const v = s.points[logical - off]?.value;
                        if (v != null) values.set(s.id, v);
                    }
                }
            }
        }
        const bar = onBar ? this.bars[logical] : undefined;
        const ohlc: CrosshairOHLC | null = bar
            ? { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }
            : null;
        this.hoverLogical = onBar ? logical : null;
        const event: CrosshairEvent = { time, price, values, ohlc };
        for (const cb of this.crosshairCbs) cb(event);
    }

    private handleClick(x: number): void {
        if (this.coords.barCount === 0) return;
        const logical = Math.round(this.coords.xToLogical(x));
        const onBar = logical >= 0 && logical < this.coords.barCount;
        for (const cb of this.clickCbs) cb({ time: onBar ? this.coords.logicalToTime(logical) : null, price: null });
    }

    private paneAtY(y: number): { scale: { min: number; max: number }; bounds: { top: number; height: number } } | null {
        return this.paneNodeAtY(y);
    }

    /** The pane node whose vertical bounds contain `y` (linear scan; panes don't overlap). */
    private paneNodeAtY(y: number): PaneNode | null {
        for (const pane of this.scene.panes.values()) {
            if (y >= pane.bounds.top && y <= pane.bounds.top + pane.bounds.height) return pane;
        }
        return null;
    }

    // ── manual vertical scaling (price-axis drag + vertical price pan) ──
    /** The scale window a gesture targets: a pane's master scale, or a merged indicator's
     *  own scale column (resolved from the grabbed x). Both share the four scale fields. */
    private resolveScaleHolder(x: number, y: number): { holder: ScaleHolder; height: number } | null {
        const pane = this.paneNodeAtY(y);
        if (!pane) return null;
        const dataW = this.coords.width;
        const merged = this.scene.ownScaleIndicatorsForPane(pane.id);
        if (x >= dataW + AXIS_MASTER_W && merged.length > 0) {
            const k = Math.floor((x - dataW - AXIS_MASTER_W) / AXIS_MERGED_W);
            const model = merged[k];
            if (model) return { holder: this.scene.ensureIndicatorScale(model.id, pane.scaleTarget), height: pane.bounds.height };
        }
        return { holder: pane, height: pane.bounds.height };
    }

    /** Grab the price axis: snapshot the grabbed scale's window and freeze it into manual mode. */
    private beginPriceScale(x: number, y: number): void {
        const res = this.resolveScaleHolder(x, y);
        if (!res) return;
        this.scaleDragHolder = res.holder;
        this.scaleDragHeight = res.height;
        this.scaleDragStart = { ...res.holder.scale };
        res.holder.manualScale = { ...res.holder.scale };
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Rescale the grabbed scale around its center by the total drag (down ⇒ zoom out). */
    private priceScaleBy(dyTotal: number): void {
        const holder = this.scaleDragHolder;
        const start = this.scaleDragStart;
        if (!holder || !start) return;
        this.setManualScale(holder, rescaleAround(start, Math.exp(dyTotal * PRICE_SCALE_K)));
    }

    /** Grab inside the data area: vertical price-pan is available only when the pane is
     *  already manual (so a normal drag stays a pure time-pan until the user opts in). */
    private beginPricePan(y: number): boolean {
        const pane = this.paneNodeAtY(y);
        if (!pane || !pane.manualScale) return false;
        this.scaleDragHolder = pane;
        this.scaleDragHeight = pane.bounds.height;
        this.scaleDragStart = { ...pane.scale };
        return true;
    }

    /** Pan the grabbed pane's price window by the total drag (down ⇒ show lower prices). */
    private pricePanBy(dyTotal: number): void {
        const holder = this.scaleDragHolder;
        const start = this.scaleDragStart;
        if (!holder || !start) return;
        this.setManualScale(holder, shiftScale(start, dyTotal, this.scaleDragHeight));
    }

    /** Double-click the price axis → drop manual mode for that scale (autoscale resumes). */
    private resetPriceScale(x: number, y: number): void {
        const res = this.resolveScaleHolder(x, y);
        if (!res) return;
        res.holder.manualScale = null;
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /**
     * New double-click semantics inside the data area: the price pane toggles collapse of
     * every study pane (hide/show sub panes); a study pane toggles maximize. (Keyboard `0`
     * still fits the view.)
     */
    private dataDblClick(_x: number, y: number): void {
        const pane = this.paneNodeAtY(y);
        if (!pane) return;
        // Double-click maximizes the clicked pane so it fills the plot and every other pane is
        // fully hidden (zero height, not a strip): the price pane hides all study indicators, a
        // study pane hides the price + other studies. A second double-click restores the split.
        const maximized = this.maximizedPaneId !== pane.id;
        this.maximizedPaneId = maximized ? pane.id : null;
        this.afterPaneLayoutChange();
        this.emitPaneAction({ type: 'maximize', paneId: pane.id, maximized });
    }

    /** Re-fit the view and drop every manual scale (keyboard `0`). */
    private resetView(): void {
        this.fitContent(); // clears all manual scales
        this.scheduler.invalidate(InvalidateLevel.Full);
        this.emitViewportChange();
    }

    private setManualScale(holder: ScaleHolder, scale: PriceScale): void {
        holder.manualScale = scale;
        holder.scale = { ...scale };
        holder.scaleTarget = { ...scale };
        holder.initialized = true;
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Relayout + repaint + refresh the hover buttons after a collapse/maximize/order change. */
    private afterPaneLayoutChange(): void {
        this.layoutPanes();
        this.repositionTables();
        this.paneControls?.refresh();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Thin projection of the panes for the hover-control cluster (top-to-bottom order). */
    private paneControlViews(): Array<{ id: string; kind: 'price' | 'study'; collapsed: boolean; maximized: boolean; top: number; height: number; index: number; count: number }> {
        const ordered = this.scene.orderedPanes();
        return ordered.map((p, i) => ({
            id: p.id,
            kind: p.kind,
            collapsed: p.collapsed,
            maximized: this.maximizedPaneId === p.id,
            top: p.bounds.top,
            height: p.bounds.height,
            index: i,
            count: ordered.length,
        }));
    }

    /** Reorder a study pane one slot up/down (renderer-applied, mirrored to core via onPaneAction). */
    private movePaneLocal(paneId: string, dir: 'up' | 'down'): void {
        const ordered = this.scene.orderedPanes();
        const i = ordered.findIndex((p) => p.id === paneId);
        if (i < 0) return;
        const j = dir === 'up' ? i - 1 : i + 1;
        if (j < 1 || j >= ordered.length) return; // price pane stays pinned at index 0
        const ids = ordered.map((p) => p.id);
        const tmp = ids[i]!;
        ids[i] = ids[j]!;
        ids[j] = tmp;
        this.scene.orderPanes(ids);
        this.afterPaneLayoutChange();
        this.emitPaneAction({ type: 'move', paneId, dir });
    }

    // ── pane resize (drag the separator between stacked panes) ──
    /** True when `y` is within the hit zone of a draggable sub-pane separator. */
    private paneSeparatorAt(y: number): boolean {
        return this.separatorPaneIndexAt(y) !== null;
    }

    /** Pixel y of the draggable separator under the cursor (for the hover highlight), or null. */
    private separatorHoverY(y: number): number | null {
        if (!this.paneResizeEnabled) return null;
        const i = this.separatorPaneIndexAt(y);
        return i === null ? null : this.scene.orderedPanes()[i]!.bounds.top;
    }

    /** Index (in `orderedPanes`) of the LOWER pane whose top separator is within the hit
     *  zone of `y`, or null. Separators sit between every adjacent pair, so the first
     *  candidate is index 1 (the top of the second pane). */
    private separatorPaneIndexAt(y: number): number | null {
        const panes = this.scene.orderedPanes();
        for (let i = 1; i < panes.length; i++) {
            if (Math.abs(y - panes[i]!.bounds.top) <= SEPARATOR_HIT_PX) return i;
        }
        return null;
    }

    /** Grab the separator at `y`: snapshot the adjacent panes + their shared pixel span. */
    private beginPaneResize(y: number): void {
        const i = this.separatorPaneIndexAt(y);
        if (i === null) return;
        const panes = this.scene.orderedPanes();
        const above = panes[i - 1]!;
        const below = panes[i]!;
        this.resizeAbove = above;
        this.resizeBelow = below;
        this.resizeSplitStart = {
            combinedTop: above.bounds.top,
            combinedHeight: above.bounds.height + below.bounds.height,
            combinedWeight: above.heightWeight + below.heightWeight,
            startBoundaryY: below.bounds.top,
        };
    }

    /** Resize the grabbed panes by the total drag (down ⇒ grow the upper pane), keeping the
     *  combined weight fixed so every other pane keeps its height. */
    private paneResizeBy(dyTotal: number): void {
        const above = this.resizeAbove;
        const below = this.resizeBelow;
        const split = this.resizeSplitStart;
        if (!above || !below || !split) return;
        const next = resizeSplit(split, dyTotal);
        above.heightWeight = next.above;
        below.heightWeight = next.below;
        this.layoutPanes();
        this.repositionTables();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    /** Double-click a separator → split the two adjacent panes evenly (each gets half of
     *  their combined weight). A simple, predictable reset that leaves siblings untouched. */
    private resetPaneSize(y: number): void {
        const i = this.separatorPaneIndexAt(y);
        if (i === null) return;
        const panes = this.scene.orderedPanes();
        const above = panes[i - 1]!;
        const below = panes[i]!;
        const half = (above.heightWeight + below.heightWeight) / 2;
        above.heightWeight = half;
        below.heightWeight = half;
        this.layoutPanes();
        this.repositionTables();
        this.scheduler.invalidate(InvalidateLevel.Full);
    }

    // ── keyboard navigation / accessibility (item 11) ──
    /** Enable/disable keyboard control: focusability + ARIA + key listeners + live region. */
    private setKeyboardEnabled(enabled: boolean): void {
        this.keyboardEnabled = enabled;
        if (!this.dataCanvas || !this.keyboard) return;
        if (enabled) {
            this.dataCanvas.tabIndex = 0;
            this.dataCanvas.setAttribute('role', 'application');
            this.dataCanvas.setAttribute('aria-label', 'Interactive price chart. Use Left/Right arrows to move between bars, Shift+Arrow to pan, plus/minus to zoom, Home/End to jump, 0 to reset.');
            if (!this.liveRegion && this.wrapper) {
                this.liveRegion = document.createElement('div');
                this.liveRegion.setAttribute('aria-live', 'polite');
                this.liveRegion.setAttribute('role', 'status');
                // Visually hidden, but available to assistive tech.
                Object.assign(this.liveRegion.style, {
                    position: 'absolute',
                    width: '1px',
                    height: '1px',
                    margin: '-1px',
                    padding: '0',
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                    whiteSpace: 'nowrap',
                    border: '0',
                });
                this.wrapper.appendChild(this.liveRegion);
            }
            this.keyboard.attach(this.dataCanvas);
        } else {
            this.keyboard.detach();
            this.dataCanvas.removeAttribute('tabindex');
            this.dataCanvas.removeAttribute('role');
            this.dataCanvas.removeAttribute('aria-label');
        }
    }

    /** Pan the view by a whole number of bars (keyboard): +bars ⇒ toward the latest. */
    private panByBars(bars: number): void {
        const vp = this.coords.getViewport();
        this.applyViewport({ barSpacing: vp.barSpacing, rightOffset: vp.rightOffset + bars });
    }

    /** Zoom one keyboard notch, right-edge anchored (+1 in, -1 out). */
    private zoomByStep(direction: 1 | -1): void {
        const vp = this.coords.getViewport();
        const target = clampBarSpacing(vp.barSpacing * Math.exp(direction * KEY_ZOOM_STEP));
        this.zoomTo(target, this.coords.rightEdgeLogical, this.coords.width);
    }

    /** Move the focused bar by `delta` from the current crosshair bar (or the last bar). */
    private stepCrosshair(delta: number): void {
        const n = this.coords.barCount;
        if (n === 0) return;
        const cur = this.hoverLogical ?? Math.min(n - 1, Math.round(this.coords.xToLogical(this.coords.width)));
        this.focusBar(cur + delta);
    }

    /** Center-ish the given bar in view (scrolling minimally), draw the crosshair on it,
     *  and announce its OHLC + indicator values to the ARIA live region. */
    private focusBar(target: number): void {
        const n = this.coords.barCount;
        if (n === 0) return;
        const next = Math.max(0, Math.min(n - 1, target));
        // Scroll just enough to keep the focused bar a couple of bars inside the plot.
        const vp = this.coords.getViewport();
        const margin = 2;
        const leftL = this.coords.xToLogical(0);
        const rightL = this.coords.xToLogical(this.coords.width);
        let rightOffset = vp.rightOffset;
        if (next < leftL + margin) rightOffset -= leftL + margin - next;
        else if (next > rightL - margin) rightOffset += next - (rightL - margin);
        if (rightOffset !== vp.rightOffset) this.applyViewport({ barSpacing: vp.barSpacing, rightOffset });
        const pricePane = this.scene.orderedPanes().find((p) => p.kind === 'price') ?? this.scene.orderedPanes()[0] ?? null;
        const y = this.scene.crosshair?.y ?? (pricePane ? pricePane.bounds.top + pricePane.bounds.height / 2 : this.coords.height / 2);
        this.handlePointerMove(this.coords.logicalToX(next), y);
        this.announceBar(next);
    }

    /** Update the ARIA live region with a spoken summary of bar `idx` (date + OHLC + values). */
    private announceBar(idx: number): void {
        if (!this.liveRegion) return;
        const bar = this.bars[idx];
        const pricePane = this.dataWindowPricePane();
        const ohlc = this.dataWindowOHLC(bar, pricePane);
        const parts: string[] = [];
        if (bar) parts.push(formatStamp(bar.time, this.scene.timezone));
        if (ohlc) parts.push(`Open ${ohlc.o}, High ${ohlc.h}, Low ${ohlc.l}, Close ${ohlc.c}`);
        for (const group of this.dataWindowGroups(idx, pricePane)) {
            for (const row of group.rows) parts.push(`${row.label} ${row.value}`);
        }
        this.liveRegion.textContent = parts.join('. ');
    }

    // ── data window ──
    /** The data-window readout (port seam) — the hovered bar's date/time and OHLCV plus every
     *  indicator's value there, or the latest bar when the cursor is off the plot. Values are
     *  pre-formatted on the scale of the pane they belong to, so a host panel renders them as-is. */
    getDataWindowReadout(): DataWindowReadout {
        const n = this.bars.length;
        if (n === 0) return { date: '', time: '', ohlc: null, groups: [] };
        const idx = this.hoverLogical != null ? this.hoverLogical : n - 1;
        const bar = this.bars[idx];
        const pricePane = this.dataWindowPricePane();
        const parts = bar ? formatStampParts(bar.time, this.scene.timezone) : { date: '', time: '' };
        return { date: parts.date, time: parts.time, ohlc: this.dataWindowOHLC(bar, pricePane), groups: this.dataWindowGroups(idx, pricePane) };
    }

    private dataWindowPricePane(): PaneNode | null {
        return this.scene.orderedPanes().find((p) => p.kind === 'price') ?? null;
    }

    private dataWindowFmt(v: number, pane: PaneNode | null): string {
        return pane ? formatPriceLabel(pane.scale, pane.bounds.height, v, this.scene.priceMintick) : String(v);
    }

    private dataWindowOHLC(bar: OHLCV | undefined, pricePane: PaneNode | null): DataWindowOHLC | null {
        if (!bar) return null;
        return {
            o: this.dataWindowFmt(bar.open, pricePane),
            h: this.dataWindowFmt(bar.high, pricePane),
            l: this.dataWindowFmt(bar.low, pricePane),
            c: this.dataWindowFmt(bar.close, pricePane),
            vol: bar.volume != null ? formatVolume(bar.volume) : undefined,
            up: bar.close >= bar.open,
        };
    }

    /** One group per indicator (name = indicator title), each with a row per drawable plot. */
    private dataWindowGroups(idx: number, pricePane: PaneNode | null): DataWindowGroup[] {
        const groups: DataWindowGroup[] = [];
        for (const model of this.scene.indicators.values()) {
            const rows = this.dataWindowRowsFor(model, idx, pricePane);
            if (rows.length) groups.push({ name: model.title, rows });
        }
        return groups;
    }

    /** One indicator's readout at bar `idx`: a row per drawable plot, formatted on its pane's scale. */
    private dataWindowRowsFor(model: IndicatorModel, idx: number, pricePane: PaneNode | null): DataWindowRow[] {
        // The volume native draws through its bespoke layer and mounts a series-less model, so
        // its readout comes straight from the bar's volume instead of iterating `model.series`.
        if (model.native?.type === 'volume') return this.volumeReadoutRows(model, idx);
        const pane = (model.paneId ? this.scene.panes.get(model.paneId) : null) ?? pricePane;
        const off = this.scene.offsetOf(model.id);
        const rows: DataWindowRow[] = [];
        for (const s of model.series) {
            let value: number | null | undefined;
            let color: string;
            if (s.kind === 'candle' || s.kind === 'bar') {
                value = s.bars[idx - off]?.close;
                color = s.style?.up ?? this.theme.upColor;
            } else if (isLineLikeSeries(s)) {
                if (s.visible === false) continue;
                value = s.points[idx - off]?.value;
                color = s.points[idx - off]?.color ?? s.style.color;
            } else {
                continue; // markers carry no scalar readout
            }
            if (value == null || !Number.isFinite(value)) continue;
            rows.push({ label: s.title || model.title, value: this.dataWindowFmt(value, pane), color });
        }
        return rows;
    }

    /** The volume indicator's readout: the bar's volume, tinted with the layer's own direction
     *  colors. Hiding volume keeps its model in the scene (only the layer is suppressed — see
     *  `setIndicatorVisible`), so the hidden flag is checked here rather than by model absence. */
    private volumeReadoutRows(model: IndicatorModel, idx: number): DataWindowRow[] {
        if (this.volumeHidden) return [];
        const bar = this.bars[idx];
        const vol = bar?.volume;
        if (bar == null || vol == null || !Number.isFinite(vol)) return [];
        const cfg = this.scene.volumeLayer;
        const color = bar.close >= bar.open ? (cfg?.upColor ?? this.theme.upColor) : (cfg?.downColor ?? this.theme.downColor);
        return [{ label: model.title, value: formatVolume(vol), color }];
    }

    /** Refresh the plot values beside every legend title — the same readout the data window
     *  shows (crosshair bar, else the latest bar), pushed per paint. A hidden indicator has
     *  no scene model, so its row is absent from the map and its readout clears. */
    private updateLegendValues(): void {
        if (!this.inputsUI) return;
        const n = this.bars.length;
        const values = new Map<string, LegendPlotValue[]>();
        if (n > 0) {
            const idx = this.hoverLogical != null ? this.hoverLogical : n - 1;
            const pricePane = this.dataWindowPricePane();
            for (const model of this.scene.indicators.values()) {
                values.set(model.id, this.dataWindowRowsFor(model, idx, pricePane).map((r) => ({ value: r.value, color: r.color })));
            }
        }
        this.inputsUI.setPlotValues(values);
    }

    private renderFrame(level: InvalidateLevel): void {
        // Cursor tier: only the crosshair moved → repaint just the overlay layer,
        // leaving the geometry (L0) + chrome (L1) layers untouched. Light/Full
        // recompute the scales then repaint L0 + L1; the crosshair always follows
        // (cheap) so it stays aligned after a pan/zoom/value change.
        // While a gesture animates, the Animator's loop owns the frame (it paints L0+L1
        // + crosshair every tick and picks up live data/scale changes), so a concurrent
        // Scheduler invalidation (live tick, hover) must NOT also paint — else both run
        // each frame. The animTick will reflect the change on its next frame.
        if (this.animator.active) return;
        if (repaintsData(level)) {
            this.computeScales();
            this.paintData();
        } else if (repaintsChrome(level) && this.paintedData) {
            // Chrome-only tier (the countdown's wall-clock tick): neither data nor viewport
            // changed, so repaint just the chrome canvas over the frame's existing scales —
            // the geometry backend, volume/VPVR and SDK layers stay untouched. prepare()
            // re-wires the drawing resolvers (three closures over live refs — cheap).
            this.chrome.prepare(this.scene, this.coords, this.theme);
            this.chrome.render(this.scene, this.coords, this.theme, this.axisSurface());
        }
        this.crosshairLayer.render(this.scene, this.coords, this.theme, this.hoverSeparatorY, this.externalCrossPx()); // L2 crosshair
        // Hover-testing SDK layers (repaintOnCursor) follow pointer moves too — each owns
        // one transparent canvas, so this stays as cheap as the crosshair tier itself.
        if (!repaintsData(level) && this.paintedData) this.repaintCursorLayers();
        // Legend values follow the same tiers (hover moves the read bar, data changes the
        // value); the push diffs per row, so an unchanged frame touches no DOM.
        this.updateLegendValues();
    }

    /** Repaint the SDK layers that opted into cursor tracking (their own canvas only). */
    private repaintCursorLayers(): void {
        const pane = this.scene.panes.get(PRICE_PANE_ID);
        if (!pane) return;
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        for (const l of this.extLayers) {
            if (!l.def.repaintOnCursor) continue;
            l.instance.render(this.extLayerArgs(l.def.id, pane.scale, pane.bounds, nowMs));
            if (this.animZoom && l.instance.animating?.()) this.animator.start();
        }
    }

    /** One frame's args for an SDK renderer layer (shared by the data + cursor paint paths). */
    private extLayerArgs(id: string, scale: PriceScale, bounds: PaneBounds, nowMs: number): RendererLayerArgs {
        return {
            bars: this.scene.bars,
            data: this.scene.nativeData.get(id),
            settings: (this.scene.nativeData.get(`${id}-settings`) as Record<string, unknown> | undefined) ?? {},
            pending: this.scene.nativePending.get(id) ?? [],
            coords: this.coords,
            scale,
            bounds,
            theme: this.theme,
            priceStyle: this.scene.priceStyle,
            nowMs,
            cursor: this.lastPointer,
        };
    }

    /** Paint the below-data (L-1) + geometry (L0) + chrome (L1) layers from the current scene/coords. */
    private paintData(): void {
        this.stampScaleInvert(); // flip axes (if inverted) before any layer reads pane.scale
        this.backend.modelAlpha = this.modelAlpha;
        this.backend.candleBodyAlpha = this.candleBodyAlpha;
        this.backend.candleStructureAlpha = this.candleStructureAlpha;
        this.backend.gridAlpha = 1;
        const candleBodyScale = 1;
        this.backend.candleBodyScale = candleBodyScale;
        const pane = this.scene.panes.get(PRICE_PANE_ID);
        if (pane) {
            // The volume layer follows its indicator's pane (it can be moved to its own pane);
            // a collapsed host pane shows its legend strip only, so the columns are suppressed.
            const volumePane = this.nativeLayerPane('volume') ?? pane;
            this.volumeRenderer.render({
                bars: this.scene.bars,
                data: this.scene.volumeLayer,
                visible: this.volumeActive && !this.volumeHidden && !volumePane.collapsed,
                coords: this.coords,
                bounds: volumePane.bounds,
                fillPane: volumePane.kind !== 'price',
            });
            this.vpvrRenderer.render({
                bars: this.scene.bars,
                data: this.scene.vpvrLayer,
                visible: this.vpvrActive && !this.vpvrHidden,
                coords: this.coords,
                scale: pane.scale,
                bounds: pane.bounds,
                theme: this.theme,
            });
            // SDK renderer layers: shared paint cycle, own channel data, own canvas.
            const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            for (const l of this.extLayers) {
                const args = this.extLayerArgs(l.def.id, pane.scale, pane.bounds, nowMs);
                l.instance.render(args);
                // The active style's layer may dim/slim the base painting under it (a
                // gradual counterpart of basePainting 'none') — applied this same frame,
                // before the backend paints.
                if (l.def.id === this.scene.priceStyle && l.instance.modulateBase) {
                    const mod = l.instance.modulateBase(args);
                    if (mod) {
                        if (mod.candleBodyScale != null) this.backend.candleBodyScale = clamp01(mod.candleBodyScale) || 0.01;
                        if (mod.candleBodyAlpha != null) this.backend.candleBodyAlpha = clamp01(mod.candleBodyAlpha) * this.candleBodyAlpha;
                        if (mod.gridAlpha != null) this.backend.gridAlpha = clamp01(mod.gridAlpha);
                    }
                }
                // A pulsing/fading layer keeps the animator alive; it stops itself when done.
                if (this.animZoom && l.instance.animating?.()) this.animator.start();
            }
        }
        // Live-bar easing: render the eased (gliding) OHLC for the forming bar, then restore the true
        // values immediately so every reader (data window, inspect, crosshair) sees real data.
        const li = this.bars.length - 1;
        const liveActual = li >= 0 ? this.bars[li] : undefined;
        const easeLive = !!liveActual && this.liveEaseTime === liveActual.time
            && (liveActual.high !== this.liveEaseHigh || liveActual.low !== this.liveEaseLow || liveActual.close !== this.liveEaseClose);
        if (easeLive && liveActual) this.bars[li] = { ...liveActual, high: this.liveEaseHigh, low: this.liveEaseLow, close: this.liveEaseClose };

        // Interleave layers: the drawings whose z sits inside a pane's series stack, prepainted
        // so the backend can composite them mid-stack (under the candles, between indicators).
        this.scene.drawingSlices = this.userDrawings?.prepareSlices(this.scene.orderedPanes().map((p) => p.id)) ?? new Map();
        this.backend.render(this.scene, this.coords, this.theme);
        this.chrome.render(this.scene, this.coords, this.theme, this.axisSurface());
        this.userDrawings?.render(); // L1.5 — above Pine drawings, below the crosshair

        if (easeLive && liveActual) this.bars[li] = liveActual; // restore the true forming bar
        this.paintedData = true; // scales are real from here on — the chrome-only tier may run
    }

    /** Build the data→pixel projector user drawings resolve their anchors through. */
    private drawingProjector(): Projector {
        return createProjector(
            this.coords,
            (paneId) => {
                const p = this.scene.panes.get(paneId);
                return p ? { scale: p.scale, bounds: p.bounds, collapsed: p.collapsed } : null;
            },
            (y) => this.paneNodeAtY(y)?.id ?? null,
            (from, to) => this.barsInTimeRange(from, to),
        );
    }

    /** OHLC bars whose open-time falls within `[from, to]` (inclusive) — the data a regression
     *  (or other statistical) drawing fits against. `this.bars` is ascending, so a linear scan is fine. */
    private barsInTimeRange(from: number, to: number): OHLCV[] {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        const out: OHLCV[] = [];
        for (const b of this.bars) {
            if (b.time < lo) continue;
            if (b.time > hi) break;
            out.push(b);
        }
        return out;
    }

    /** The interactive user-drawings surface the core DrawingController drives. */
    get userDrawingsPort(): IDrawingsRendererPort | undefined {
        return this.userDrawings ?? undefined;
    }

    /** Focus the data canvas — the element chart/drawing keyboard shortcuts key off
     *  (tabIndex 0 while the `keyboard` feature is on). Host UIs call it after their
     *  own controls steal focus (e.g. a shared workspace toolbar click). */
    focus(): void {
        this.dataCanvas?.focus({ preventScroll: true });
    }

    /** EXTERNAL (synced) crosshair — a ghost marker driven by another chart. Kept in
     *  DATA space (epoch-ms + optional price) so it stays glued through pan/zoom. */
    private externalCross: { time: Millis; price: number | null } | null = null;

    /** Show/clear the external ghost crosshair (port seam — see IChartRenderer). It only
     *  repaints the cursor overlay (Cursor tier) and NEVER re-emits onCrosshairMove. */
    setExternalCrosshair(time: Millis | null, price: number | null = null): void {
        const next = time == null ? null : { time, price };
        const prev = this.externalCross;
        if (!next && !prev) return;
        if (next && prev && prev.time === next.time && prev.price === next.price) return; // idempotent — 60Hz streams stay cheap
        this.externalCross = next;
        this.scheduler.invalidate(InvalidateLevel.Cursor);
    }

    /** Resolve the ghost to pixels for THIS frame (null when off-window or dataless).
     *  Snaps by FLOOR to the bar CONTAINING the foreign time — never by rounding: a 1h
     *  pointer at 14:00 must light THIS day's daily candle, not tomorrow's (a time past
     *  a bar's midpoint still belongs to that bar). Before the first open or past the
     *  forming bar there is no containing bar — no ghost. */
    private externalCrossPx(): { x: number; y: number | null; time: Millis } | null {
        const ext = this.externalCross;
        if (!ext || this.coords.barCount === 0) return null;
        const logical = Math.floor(this.coords.timeToLogical(ext.time));
        if (logical < 0 || logical >= this.coords.barCount) return null;
        const x = this.coords.logicalToX(logical);
        if (!Number.isFinite(x) || x < 0 || x > this.coords.width) return null;
        let y: number | null = null;
        if (ext.price != null) {
            const pricePane = this.scene.orderedPanes().find((p) => p.kind === 'price');
            if (pricePane) {
                y = this.coords.priceToY(ext.price, pricePane.scale, pricePane.bounds);
                if (!Number.isFinite(y) || y < pricePane.bounds.top || y > pricePane.bounds.top + pricePane.bounds.height) y = null;
            }
        }
        return { x, y, time: this.coords.logicalToTime(logical) };
    }

    /** Sticky magnet mode for user drawings (off/weak/strong); the drawings toolbar drives it. */
    private snapMode: SnapMode = 'off';

    /** Set the sticky magnet mode (called by the drawings toolbar's 3-state button). */
    setSnapMode(mode: SnapMode): void {
        this.snapMode = mode;
    }

    /**
     * Snap a data point to the nearest candle for the drawing magnet: time → the nearest
     * bar, price → that bar's closest OHLC value. Off the price pane (sub-panes have no
     * OHLC) only the time snaps. `weak` only snaps when the candle point is within
     * {@link WEAK_SNAP_PX} of the cursor pixel; `strong` always snaps; `off` is a no-op.
     */
    private snapToCandle(
        point: { time: number; price: number },
        paneId: string,
        mode: SnapMode = 'strong',
        cursorPx?: { x: number; y: number },
    ): { time: number; price: number } {
        if (mode === 'off') return point;
        const n = this.bars.length;
        if (n === 0) return point;
        const i = Math.max(0, Math.min(n - 1, Math.round(this.coords.timeToLogical(point.time))));
        const bar = this.bars[i];
        if (!bar) return point;
        let snapped: { time: number; price: number };
        if (paneId !== PRICE_PANE_ID) {
            snapped = { time: bar.time, price: point.price };
        } else {
            let price = bar.open;
            for (const v of [bar.high, bar.low, bar.close]) {
                if (Math.abs(v - point.price) < Math.abs(price - point.price)) price = v;
            }
            snapped = { time: bar.time, price };
        }
        if (mode === 'weak' && cursorPx) {
            const proj = this.drawingProjector();
            const sy = proj.yOf(snapped.price, paneId);
            const dist = Math.hypot(proj.xOf(snapped.time) - cursorPx.x, (sy ?? cursorPx.y) - cursorPx.y);
            if (dist > WEAK_SNAP_PX) return point; // candle is too far → place freely
        }
        return snapped;
    }

    /**
     * Per-pane autoscale — the single price-window pass both layers consume. Folds
     * the visible series (computePaneScale) with the visible Pine-drawing range
     * (own drawings per pane + force_overlay drawings on the price pane), so a box/
     * line/label outside the series range still expands the scale and never clips.
     * Runs only on Light/Full frames (the crosshair-only Cursor tier reuses the
     * retained pane.scale).
     */
    private computeScales(): void {
        const n = this.coords.barCount;
        if (n === 0) return;
        const vr = this.coords.visibleLogicalRange();
        const vtr = this.coords.visibleTimeRange(); // for time-culling user drawings into autoscale
        const i0 = Math.max(0, Math.floor(vr.from));
        const i1 = Math.min(n - 1, Math.ceil(vr.to));
        if (i1 < i0) return;
        // Percent mode: the reference is the first visible bar's close (the common idiom).
        this.scene.percentBaseline = this.bars[i0]?.close ?? 0;
        const panes = this.scene.orderedPanes();
        const pricePane = panes.find((p) => p.kind === 'price') ?? null;
        this.chrome.prepare(this.scene, this.coords, this.theme); // wire drawing resolvers for priceRange
        const animating = this.animator.active;
        for (const pane of panes) {
            // Manual mode (price-axis drag / vertical pan): render the user's window
            // verbatim and skip autoscale entirely for this pane.
            if (pane.manualScale) {
                pane.scaleTarget = pane.manualScale;
                pane.scale = { ...pane.manualScale };
                pane.initialized = true;
                continue;
            }
            const models = this.scene.indicatorsForPane(pane.id);
            // A merged (own-scale) indicator does NOT contribute to the pane master scale.
            const masterModels = models.filter((m) => m.ownScale !== true);
            let dr = this.chrome.paneDrawingsRange(masterModels, this.scene, pane === pricePane, vr);
            // Fold visible USER drawings on this pane into the price range, exactly like
            // Pine drawings — so an off-series line/box still expands the scale.
            const udr = this.userDrawings?.priceRangeForPane(pane.id, vtr.from, vtr.to) ?? null;
            if (udr) dr = dr ? { min: Math.min(dr.min, udr.min), max: Math.max(dr.max, udr.max) } : udr;
            // Hidden candles drop out of the price pane's autoscale, so overlay indicators fill the pane.
            const includeCandles = pane.kind === 'price' && !this.scene.candlesHidden;
            // Each pane logs (or not) on its OWN flag — the price pane from the scene setting,
            // study panes from their own — so a study going log never touches the price pane.
            pane.scaleTarget = computePaneScale(masterModels, this.bars, includeCandles, i0, i1, dr, paneLogScale(this.scene, pane), (id) => this.scene.offsetOf(id));
            // Percent baseline for THIS pane (the first visible value it measures change from):
            // the first visible bar close on the price pane, else the master series' first
            // visible value. 0 ⇒ no reference yet, so the axis falls back to absolute.
            pane.percentBaseline = pane.kind === 'price'
                ? (this.bars[i0]?.close ?? 0)
                : this.firstVisibleValue(masterModels, i0);
            // The volume layer is a bespoke renderer layer with no model series, so on its own
            // pane the master scale would be the empty {0,1} placeholder (axis reads "0.50").
            // Drive it from the visible volume instead, matching the columns' bottom-anchored
            // 0..maxVol mapping so labels line up with the bars. Only when volume is this pane's
            // sole content (any real merged/master series takes over the scale as usual).
            pane.axisFormat = undefined;
            if (this.volumeOwnsPane(pane, masterModels)) {
                const maxVol = this.maxVisibleVolume(i0, i1);
                if (maxVol > 0) {
                    pane.scaleTarget = { min: 0, max: maxVol / VOLUME_PANE_FILL_FRAC };
                    pane.axisFormat = 'volume';
                }
            }
            // Strategy trade markers reserve their PIXEL headroom on the price pane, so a
            // marker stack under the lows (or above the highs) never clips at the pane edge.
            // Anchor-bar extremes are folded first — they matter when the candles are hidden.
            if (pane === pricePane && this.scene.tradeMarkers.visible && pane.bounds.height > 0) {
                const th = this.tradesScaleHints(vr);
                if (th) {
                    const st = pane.scaleTarget;
                    const folded = { ...st, min: Math.min(st.min, th.min), max: Math.max(st.max, th.max) };
                    pane.scaleTarget = expandScaleByPixels(folded, pane.bounds.height, th.abovePx, th.belowPx);
                }
            }
            // Idle → snap. While zooming/flinging the animator eases pane.scale toward
            // the target (gliding autoscale) — EXCEPT an uninitialized pane (added
            // mid-gesture) snaps once so it doesn't flash-ease from the {0,1} placeholder.
            if (!animating || !pane.initialized) {
                pane.scale = { ...pane.scaleTarget };
                pane.initialized = true;
            }
            // Merged indicators: each gets its own window, rescaled with identical margins so
            // its visible extent lines up pixel-for-pixel with the pane's master extent.
            for (const model of this.scene.ownScaleIndicatorsForPane(pane.id)) {
                const sl = this.scene.ensureIndicatorScale(model.id, pane.scaleTarget);
                if (sl.manualScale) {
                    sl.scaleTarget = sl.manualScale;
                    sl.scale = { ...sl.manualScale };
                    sl.initialized = true;
                    continue;
                }
                const mdr = this.chrome.paneDrawingsRange([model], this.scene, false, vr);
                sl.scaleTarget = computePaneScale([model], this.bars, false, i0, i1, mdr, false, (id) => this.scene.offsetOf(id));
                if (!animating || !sl.initialized) {
                    sl.scale = { ...sl.scaleTarget };
                    sl.initialized = true;
                }
            }
        }
    }

    /** Union of the visible trade-marker autoscale hints across every mounted indicator
     *  (trade markers always target the price pane, whatever pane their model landed on). */
    private tradesScaleHints(vr: { from: number; to: number }): TradeMarkerHints | null {
        let out: TradeMarkerHints | null = null;
        const deps = {
            timeToLogical: (ms: number) => this.coords.timeToLogical(ms),
            barAt: (logical: number) => {
                const b = this.bars[Math.round(logical)];
                return b ? { high: b.high, low: b.low } : null;
            },
        };
        for (const m of this.scene.indicators.values()) {
            if (!m.trades?.length) continue;
            const h = tradesPriceHints(m.trades, this.scene.tradeMarkers, deps, vr.from, vr.to, this.scene.style.fontSize);
            if (!h) continue;
            out = out
                ? {
                      min: Math.min(out.min, h.min),
                      max: Math.max(out.max, h.max),
                      abovePx: Math.max(out.abovePx, h.abovePx),
                      belowPx: Math.max(out.belowPx, h.belowPx),
                  }
                : h;
        }
        return out;
    }

    private fitContent(): void {
        const n = this.coords.barCount;
        const w = this.coords.width;
        if (n <= 0 || w <= 0) return;
        this.animator?.stop(); // a hard re-frame cancels any in-flight gesture
        this.panVelocity = 0;
        for (const pane of this.scene.panes.values()) pane.manualScale = null; // re-fit ⇒ autoscale resumes
        for (const sl of this.scene.indicatorScales.values()) sl.manualScale = null;
        const visibleBars = Math.min(n, 200);
        const rightOffset = 6;
        const v = this.clampViewport(w / ((visibleBars + rightOffset) * this.coords.spacingScale), rightOffset);
        this.coords.setViewport(v);
        this.targetBarSpacing = v.barSpacing;
    }

    private paneBoundsFor(paneId: string): { top: number; height: number; rightAxis: number } {
        const p = this.scene.panes.get(paneId);
        return { top: p?.bounds.top ?? 0, height: p?.bounds.height ?? 0, rightAxis: this.rightAxisW };
    }

    /** The display title of a study pane's master (pane-scale) indicator — merged own-scale
     *  indicators don't name the pane. Null when the pane holds no indicators. */
    private paneMasterTitle(paneId: string): string | null {
        const models = this.scene.orderedIndicatorsForPane(paneId);
        const master = models.find((m) => m.ownScale !== true) ?? models[0];
        return master?.title || null;
    }

    /** The pane a bespoke-layer native indicator (volume/vpvr) currently lives in (null = not mounted). */
    private nativeLayerPane(type: 'volume' | 'vpvr'): PaneNode | null {
        for (const m of this.scene.indicators.values()) {
            if (m.native?.type === type) return this.scene.panes.get(m.paneId ?? PRICE_PANE_ID) ?? null;
        }
        return null;
    }

    /** True when an active volume layer is this study pane's ONLY content — so its scale should
     *  come from volume, not the empty {0,1} placeholder. (In the price pane, or alongside a real
     *  series, volume stays a bottom overlay and the master scale wins.) */
    private volumeOwnsPane(pane: PaneNode, masterModels: IndicatorModel[]): boolean {
        if (pane.kind === 'price') return false;
        if (!this.volumeActive || this.volumeHidden || !this.scene.volumeLayer) return false;
        if (this.nativeLayerPane('volume') !== pane) return false;
        // The volume indicator's own (series-less) model doesn't count as real content.
        return masterModels.every((m) => m.native?.type === 'volume');
    }

    /** Per-pane scale state for a host UI (e.g. a price-axis context menu): the pane's pixel
     *  band (`top`/`height`, so a click y maps to a pane) plus its current axis `mode`/`log`.
     *  Top-to-bottom order. Every pane is independent — the price pane from the scene setting,
     *  study panes from their own. */
    private paneScaleInfos(): Array<{ id: string; kind: 'price' | 'study'; top: number; height: number; mode: ScaleMode; log: boolean; invert: boolean }> {
        return this.scene.orderedPanes().map((p) => ({
            id: p.id,
            kind: p.kind,
            top: p.bounds.top,
            height: p.bounds.height,
            mode: paneScaleMode(this.scene, p),
            log: paneLogScale(this.scene, p),
            invert: paneInvert(this.scene, p),
        }));
    }

    /** Set one pane's axis mode. The price pane routes to the scene-level setting (persisted +
     *  keyboard shortcuts); a study pane keeps its own, so panes never affect each other. */
    private setPaneScaleMode(paneId: string, mode: ScaleMode): void {
        if (paneId === PRICE_PANE_ID) this.scene.scaleMode = mode;
        else {
            const p = this.scene.panes.get(paneId);
            if (!p) return;
            p.scaleMode = mode;
        }
        this.scheduler?.invalidate(InvalidateLevel.Full);
    }

    /** Set one pane's logarithmic flag. Clears that pane's frozen (manual) window so the new
     *  space re-fits, and routes the price pane to the scene-level flag. */
    private setPaneLog(paneId: string, log: boolean): void {
        if (paneId === PRICE_PANE_ID) {
            this.scene.logScale = log;
            const price = this.scene.orderedPanes().find((p) => p.kind === 'price');
            if (price) price.manualScale = null;
        } else {
            const p = this.scene.panes.get(paneId);
            if (!p) return;
            p.logScale = log;
            p.manualScale = null;
        }
        this.scheduler?.invalidate(InvalidateLevel.Full);
    }

    /** Flip one pane's axis (high at the bottom). The price pane routes to the scene-level flag
     *  (persisted with the chart config); study panes keep their own so panes stay independent. */
    private setPaneInvert(paneId: string, invert: boolean): void {
        if (paneId === PRICE_PANE_ID) this.scene.invertScale = invert;
        else {
            const p = this.scene.panes.get(paneId);
            if (!p) return;
            p.invert = invert;
        }
        this.scheduler?.invalidate(InvalidateLevel.Full);
    }

    /** Stamp each pane's current inversion onto the live scale objects that {@link CoordinateSystem}
     *  reads (the pane master scale, its target/manual windows, and any merged own-scale columns),
     *  so `priceToY`/`yToPrice` flip consistently across every layer — data, chrome, drawings,
     *  crosshair, hit-testing. Run once per paint (scales are rebuilt each frame by autoscale/ease),
     *  which also covers pointer-time reads between frames since the objects retain the last stamp. */
    private stampScaleInvert(): void {
        for (const pane of this.scene.panes.values()) {
            const inv = paneInvert(this.scene, pane);
            pane.scale.invert = inv;
            pane.scaleTarget.invert = inv;
            if (pane.manualScale) pane.manualScale.invert = inv;
            for (const model of this.scene.ownScaleIndicatorsForPane(pane.id)) {
                const sl = this.scene.indicatorScales.get(model.id);
                if (!sl) continue;
                sl.scale.invert = inv;
                sl.scaleTarget.invert = inv;
                if (sl.manualScale) sl.manualScale.invert = inv;
            }
        }
    }

    /** The first visible value a study pane measures percent-change from: the earliest finite
     *  value at bar `i0` across its master series (line-like value, else a candle/bar close).
     *  0 when none is available yet — the axis then falls back to absolute. */
    private firstVisibleValue(models: IndicatorModel[], i0: number): number {
        for (const m of models) {
            const off = this.scene.offsetOf(m.id);
            for (const s of m.series) {
                if (isLineLikeSeries(s)) {
                    const v = s.points[i0 - off]?.value;
                    if (v != null && Number.isFinite(v)) return v;
                } else if (s.kind === 'candle' || s.kind === 'bar') {
                    const b = s.bars[i0 - off];
                    if (b && Number.isFinite(b.close)) return b.close;
                }
            }
        }
        return 0;
    }

    /** Largest volume across the visible bar-index window (0 when none) — the volume pane's scale top. */
    private maxVisibleVolume(i0: number, i1: number): number {
        let maxVol = 0;
        for (let i = i0; i <= i1; i += 1) {
            const v = this.bars[i]?.volume;
            if (v != null && v > maxVol) maxVol = v;
        }
        return maxVol;
    }

    /** Create/update/destroy an indicator's DOM table overlay (anchored off real pane geometry). */
    private syncTables(model: IndicatorModel): void {
        const tables = model.tables ?? [];
        let overlay = this.tableOverlays.get(model.id);
        if (tables.length === 0) {
            if (overlay) {
                overlay.destroy();
                this.tableOverlays.delete(model.id);
            }
            return;
        }
        if (!overlay) {
            overlay = new TableOverlay(this.plot, this.theme, (id) => this.paneBoundsFor(id));
            overlay.setVisible(this.loadingEl === null); // born mid-load ⇒ born hidden
            this.tableOverlays.set(model.id, overlay);
        }
        overlay.update(tables);
    }

    private repositionTables(): void {
        for (const overlay of this.tableOverlays.values()) overlay.reposition();
    }

    private layoutPanes(): void {
        const panes = this.scene.orderedPanes();
        const dataHeight = this.coords.height;
        // Tell the legend which panes are collapsed (→ show only the master row) before repositioning.
        this.inputsUI?.setCollapsedPanes(this.collapsedMasterMap());
        // Maximized: the chosen pane fills the plot; the rest collapse to zero-height (hidden but retained).
        const maxPane = this.maximizedPaneId ? this.scene.panes.get(this.maximizedPaneId) : null;
        if (maxPane) {
            let top = 0;
            for (const pane of panes) {
                if (pane === maxPane) { pane.bounds = { top: 0, height: dataHeight }; }
                else { pane.bounds = { top: dataHeight, height: 0 }; }
                top += pane.bounds.height;
            }
            this.inputsUI?.reposition();
            this.paneControls?.reposition();
            this.repositionScrollButton();
            this.positionAttribution();
            return;
        }
        // Collapsed panes take a fixed strip; the rest share the remaining height by weight.
        const collapsed = panes.filter((p) => p.collapsed);
        const flexPanes = panes.filter((p) => !p.collapsed);
        const stripTotal = collapsed.length * COLLAPSED_PANE_H;
        const flexHeight = Math.max(0, dataHeight - stripTotal);
        const totalWeight = flexPanes.reduce((s, p) => s + (p.heightWeight || 1), 0) || 1;
        let top = 0;
        for (const pane of panes) {
            const height = pane.collapsed ? COLLAPSED_PANE_H : (flexHeight * (pane.heightWeight || 1)) / totalWeight;
            pane.bounds = { top, height };
            top += height;
        }
        this.inputsUI?.reposition(); // keep each pane's legend pinned to its pane top
        this.paneControls?.reposition();
        this.repositionScrollButton();
        this.positionAttribution(); // the mark follows the lowest open pane's bottom edge
    }

    /** Pin the scroll-to-realtime button above the bottom-most EXPANDED pane's data area (like the
     *  watermark): with all lower sub-panes collapsed it settles into the lowest open pane. */
    private repositionScrollButton(): void {
        const dataHeight = this.coords.height;
        if (dataHeight <= 0) return;
        const maxPane = this.maximizedPaneId ? this.scene.panes.get(this.maximizedPaneId) : null;
        const visible = maxPane ? [maxPane] : this.scene.orderedPanes().filter((p) => !p.collapsed);
        // Bottom (in data-area coords) of the lowest open pane; falls back to the full data area.
        const paneBottom = visible.length
            ? Math.max(...visible.map((p) => p.bounds.top + p.bounds.height))
            : dataHeight;
        // Extra collapsed strips below that pane push the button up by exactly their height.
        this.scrollBtnBottomPx = SCROLL_BTN_BOTTOM + Math.max(0, dataHeight - paneBottom);
        // Clear the whole scale gutter (wider when merged own-scale columns are present), not just
        // the single master column — otherwise the button lands inside a multi-column scale.
        this.scrollBtnRightPx = this.rightAxisW + SCROLL_BTN_RIGHT_INSET;
        if (this.scrollButton) {
            this.scrollButton.style.bottom = `${this.scrollBtnBottomPx}px`;
            this.scrollButton.style.right = `${this.scrollBtnRightPx}px`;
        }
    }

    /** For each collapsed pane, the master (master-scale) indicator id whose legend row stays in the
     *  strip — merged own-scale indicators are hidden while collapsed. */
    private collapsedMasterMap(): Map<string, string | null> {
        const map = new Map<string, string | null>();
        for (const pane of this.scene.panes.values()) {
            if (!pane.collapsed) continue;
            const models = this.scene.orderedIndicatorsForPane(pane.id);
            const merged = new Set(this.scene.ownScaleIndicatorsForPane(pane.id).map((m) => m.id));
            const master = models.find((m) => !merged.has(m.id)) ?? models[0];
            map.set(pane.id, master?.id ?? null);
        }
        return map;
    }

    /** Reserve `px` of left gutter for the docked drawings toolbar (0 releases it) + re-lay-out the plot. */
    private setToolbarGutter(px: number): void {
        if (px === this.toolbarGutter) return;
        this.toolbarGutter = px;
        this.publishGutters();
        this.positionAttribution();
        this.syncSize();
    }

    /** Publish the gutters on the mount container as `--vela-toolbar-gutter` (left,
     *  drawings toolbar) and `--vela-scale-gutter` (right, the full price-scale width
     *  incl. merged own-scale columns), so host overlays sharing that container (a
     *  status line, a watermark, a custom legend) can anchor to the plot's edges
     *  without reaching into the renderer's DOM. */
    private publishGutters(): void {
        this.mountContainer?.style.setProperty('--vela-toolbar-gutter', `${this.toolbarGutter}px`);
        this.mountContainer?.style.setProperty('--vela-scale-gutter', `${this.rightAxisW}px`);
    }

    /** The built-in mark, or the host's own when one is set. */
    private buildAttributionEl(): HTMLElement {
        return this.attributionHtml !== null
            ? createCustomMark(document, this.attributionHtml, this.theme.background)
            : createAttributionMark(document, this.theme.background);
    }

    /** Swap the mark in place — the content kind changed (built-in ↔ host-supplied). */
    private rebuildAttribution(): void {
        if (!this.attributionEl) return; // pre-mount: mount() builds from the stored state
        this.attributionEl.remove();
        this.attributionEl = this.buildAttributionEl();
        if (!this.attributionEnabled) this.attributionEl.style.display = 'none';
        this.positionAttribution();
        this.wrapper.appendChild(this.attributionEl);
    }

    /** Bottom-left of the LOWEST visible, non-collapsed pane, above the time axis, clear of
     *  the drawings toolbar — the same anchor rule as the scroll-to-realtime button. With
     *  collapsed strips (or a maximize hiding the rest) at the bottom, the mark climbs into
     *  the lowest open pane instead of sitting on a strip's legend. */
    private positionAttribution(): void {
        if (!this.attributionEl) return;
        const dataHeight = this.coords?.height ?? 0;
        const maxPane = this.maximizedPaneId ? this.scene.panes.get(this.maximizedPaneId) : null;
        const visible = maxPane ? [maxPane] : this.scene.orderedPanes().filter((p) => !p.collapsed);
        // Bottom (in data-area coords) of the lowest open pane; falls back to the full data area.
        const paneBottom = dataHeight > 0 && visible.length
            ? Math.max(...visible.map((p) => p.bounds.top + p.bounds.height))
            : dataHeight;
        Object.assign(this.attributionEl.style, {
            left: `${(this.toolbarGutter || 0) + 12}px`,
            bottom: `${TIME_AXIS_H + 10 + Math.max(0, dataHeight - paneBottom)}px`,
        });
    }

    /** Re-tint the mark when the plot background flips light/dark. A host-supplied mark
     *  only gets the ink color — its own artwork keeps whatever colors it declares. */
    private refreshAttributionColor(): void {
        if (!this.attributionEl) return;
        if (this.attributionHtml !== null) this.attributionEl.style.color = attributionMarkColor(this.theme.background);
        else applyAttributionMarkTheme(this.attributionEl, this.theme.background);
    }

    private syncSize(): void {
        const w = this.wrapper.clientWidth;
        const h = this.wrapper.clientHeight;
        if (w <= 0 || h <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        // The plot area is inset to the right of the toolbar gutter; the canvases fill the plot
        // sub-container (0-based), so the coordinate system / pointer coords stay unchanged.
        this.plot.style.left = `${this.toolbarGutter}px`;
        const pw = Math.max(1, w - this.toolbarGutter);
        const ph = h;
        this.dataCanvas.width = Math.round(pw * dpr);
        this.dataCanvas.height = Math.round(ph * dpr);
        this.volumeCanvas.width = this.dataCanvas.width;
        this.volumeCanvas.height = this.dataCanvas.height;
        for (const l of this.extLayers) { l.canvas.width = this.dataCanvas.width; l.canvas.height = this.dataCanvas.height; }
        this.vpvrCanvas.width = this.dataCanvas.width;
        this.vpvrCanvas.height = this.dataCanvas.height;
        this.chromeCanvas.width = this.dataCanvas.width;
        this.chromeCanvas.height = this.dataCanvas.height;
        this.drawingsCanvas.width = this.dataCanvas.width;
        this.drawingsCanvas.height = this.dataCanvas.height;
        this.cursorCanvas.width = this.dataCanvas.width;
        this.cursorCanvas.height = this.dataCanvas.height;
        // Reserve strips for the price axis (right) + time axis (bottom); the
        // data area drives the coordinate transform so series sit clear of them.
        this.coords.setSize(Math.max(1, pw - this.rightAxisW), Math.max(1, ph - TIME_AXIS_H), dpr);
        // Geometry changed — the retained crosshair {x,y} now points at the wrong
        // bar/price, so drop it (LWC hides the crosshair until the next move).
        this.scene.crosshair = null;
        this.layoutPanes();
        this.repositionTables();
        this.userDrawings?.onResize(); // dismiss the settings popup on a resize
        if (!this.didInitialFit && this.coords.barCount > 0) {
            this.fitContent();
            this.didInitialFit = true;
        }
        if (this.animator.active) {
            // The width/height assignments above just CLEARED every canvas, and renderFrame
            // yields to the Animator while it runs — so a scheduler flush would paint
            // nothing and the browser would present blank canvases until the animator's
            // next rAF tick (a visible flash on every splitter/divider move of an
            // animating chart, live-bar easing included). Paint synchronously instead.
            this.computeScales();
            this.paintData();
            this.crosshairLayer.render(this.scene, this.coords, this.theme, this.hoverSeparatorY, this.externalCrossPx());
        } else {
            this.scheduler.flushNow(InvalidateLevel.Full);
        }
    }

    private applyBackground(): void {
        this.wrapper.style.background = this.theme.background;
    }
}

/**
 * How many of a model's own index-aligned values sit strictly BEFORE `headTime` — the count
 * to skip when the chart's first bar is later than the model's anchor. Read off the model's
 * series, whose point/bar times ARE the bar times it ran over; a lower bound also covers a
 * head that the model never saw (a gap) and a model that ended before the head entirely.
 * `null` when the model carries no index-aligned series to measure.
 */
function leadingPointsBefore(model: IndicatorModel, headTime: number): number | null {
    for (const s of model.series) {
        const times: ReadonlyArray<{ time: number }> | null = s.kind === 'candle' || s.kind === 'bar' ? s.bars : isLineLikeSeries(s) ? s.points : null;
        if (!times || times.length === 0) continue;
        let lo = 0;
        let hi = times.length; // lower bound: first index whose time is >= headTime
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (times[mid]!.time < headTime) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
    return null;
}

/** Apply a scene patch to a stored indicator model so the next frame reflects it. */
function applyPatch(model: IndicatorModel, patch: ScenePatch): void {
    if (patch.kind === 'value') {
        for (const delta of patch.series) {
            const s = model.series.find((x) => x.id === delta.seriesId);
            if (!s) continue;
            if (delta.kind === 'points' && isLineLikeSeries(s)) s.points = delta.points;
            else if (delta.kind === 'bars' && (s.kind === 'candle' || s.kind === 'bar')) s.bars = delta.bars;
        }
        if (patch.lines) model.lines = patch.lines;
        if (patch.boxes) model.boxes = patch.boxes;
        if (patch.labels) model.labels = patch.labels;
        if (patch.polylines) model.polylines = patch.polylines;
        if (patch.linefills) model.linefills = patch.linefills;
        if (patch.tables) model.tables = patch.tables;
        if (patch.trades) model.trades = patch.trades;
        return;
    }
    for (const id of patch.removed) {
        const i = model.series.findIndex((x) => x.id === id);
        if (i >= 0) model.series.splice(i, 1);
    }
    for (const spec of patch.added) model.series.push(spec);
}

/** Compact stamp for the data-window header in the configured zone (e.g. `2024-03-08 14:30`). */
/** Split a bar timestamp (in the chart's zone) into a `YYYY-MM-DD` date and an `HH:MM` time. */
function formatStampParts(ms: number, timeZone: string): { date: string; time: string } {
    const d = zonedDate(ms, timeZone);
    const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
    return {
        date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
        time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    };
}

function formatStamp(ms: number, timeZone: string): string {
    const { date, time } = formatStampParts(ms, timeZone);
    return `${date} ${time}`;
}

/** Coerce arbitrary input into a clean, time-ordered list of highlight bands. */
function sanitizeHighlights(value: unknown): HighlightArea[] {
    if (!Array.isArray(value)) return [];
    const out: HighlightArea[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as { from?: unknown; to?: unknown; color?: unknown };
        const from = Number(r.from);
        const to = Number(r.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
        out.push({ from, to, color: typeof r.color === 'string' ? r.color : 'rgba(120,130,160,0.10)' });
    }
    return out.sort((a, b) => a.from - b.from);
}

/** Whether a value is one of the supported price-series styles (built-ins + SDK-registered). */
function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function isPriceStyle(v: unknown): v is PriceStyle {
    return typeof v === 'string' && (priceStyleIds() as readonly string[]).includes(v);
}

/** Coerce an untrusted value to a valid `ScaleMode`, defaulting to absolute `'price'`. */
function asScaleMode(v: unknown): ScaleMode {
    return v === 'percent' || v === 'indexed' ? v : 'price';
}

/** Abbreviate a volume with a K/M/B suffix (e.g. `1.23M`). */
function formatVolume(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
    return v.toFixed(2);
}

/** Sort ascending + dedupe by time (last write wins). */
function normalizeBars(bars: OHLCV[]): OHLCV[] {
    const sorted = [...bars].sort((a, b) => a.time - b.time);
    const out: OHLCV[] = [];
    for (const bar of sorted) {
        const last = out[out.length - 1];
        if (last && last.time === bar.time) out[out.length - 1] = bar;
        else out.push(bar);
    }
    return out;
}
