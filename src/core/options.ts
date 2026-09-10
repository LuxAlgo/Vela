import type { OHLCV } from './model/ohlcv';
import type { VisibleRangePreset } from './visible-range';
import type { VisibleRange } from './ports/IChartRenderer';
import type { InputValue } from './model/inputs';
import type { IChartRenderer } from './ports/IChartRenderer';
import type { DrawingsOption } from './drawings/toolbar';

/** A registered data-provider name (any string; matched case-insensitively). */
export type ProviderName = string;

/**
 * Which trading session the chart shows, on markets that have one: `regular` = RTH
 * (09:30–16:00 for US equities), `extended` = ETH (pre/post-market included). The
 * provider owns the actual filtering — the flag rides every data request. Meaningless
 * (and ignored end-to-end) on continuous markets like crypto.
 */
export type MarketSession = 'regular' | 'extended';

/** Narrow an untrusted string (persisted document, URL param) to a {@link MarketSession}. */
export const normalizeSession = (v: unknown): MarketSession | undefined => (v === 'regular' || v === 'extended' ? v : undefined);

/** How the chart obtains its candles. */
export interface MarketConfig {
    /** The market's symbol. A bare ticker (`'BTCUSDT'`) resolves against the registered
     *  providers in DECLARATION order (first one whose index lists it); an
     *  `EXCHANGE:` prefix (`'coinbase:BTC-USD'`, case-insensitive) pins the venue. */
    symbol?: string;
    timeframe?: string;
    bars?: number;
    /** Trading session to show ({@link MarketSession}). Absent = the provider's default
     *  (`regular` on session markets); continuous markets ignore it entirely. */
    session?: MarketSession;
    /**
     * The window to frame on the FIRST paint — a preset name (`'1D'`, `'YTD'`, …) or an
     * explicit `{from, to}`. Set it when the initial view is known up front (a range
     * chip, a shared link): the chart then loads the depth in ONE pass and paints the
     * requested window straight away, instead of flashing its fast recent-bars preview
     * and re-framing a moment later.
     */
    visibleRange?: VisibleRangePreset | VisibleRange;
    /** Offline bars instead of a provider; when set, no network fetch happens. */
    data?: OHLCV[];
}

/**
 * One in-place market switch — the argument of `chart.setMarket(next)`. Only the fields
 * given change; the rest of the market keeps its current value. `data` switches to
 * offline bars (and giving `symbol`/`provider` WITHOUT `data` drops a previous offline
 * dataset — back to the provider path). `visibleRange` frames the FIRST paint of the
 * new market (a range chip switching timeframe + depth + window in one call).
 */
export interface MarketSwitch {
    /** Bare ticker (provider resolved by declaration order) or `EXCHANGE:`-prefixed. */
    symbol?: string;
    timeframe?: string;
    bars?: number;
    /** Switch the shown trading session (reloads like a timeframe change). */
    session?: MarketSession;
    data?: OHLCV[];
    visibleRange?: VisibleRangePreset | VisibleRange;
}

/**
 * The chart's current market identity — `chart.market`, the read counterpart of
 * `setMarket`. A SNAPSHOT of the requested market (mutating it changes nothing): it
 * reflects a switch as soon as `setMarket` is called, not when the load lands — the
 * "what is this chart showing/loading right now" answer. `offline` is true when the
 * chart runs on an inline `data` array instead of a provider.
 */
export interface MarketSnapshot {
    symbol?: string;
    /** The venue the symbol PINS (its `EXCHANGE:` prefix, lower-cased) — undefined for a
     *  bare symbol. The venue that actually served it: `chart.data.resolve(symbol)`. */
    provider?: ProviderName;
    timeframe?: string;
    bars?: number;
    /** The shown trading session — undefined = the provider's default (regular). */
    session?: MarketSession;
    offline: boolean;
}

export interface VelaTheme {
    background: string;
    textColor: string;
    gridColor: string;
    borderColor: string;
    upColor: string;
    downColor: string;
    fontFamily: string;
}

export type ThemeName = 'dark' | 'light';

/** A renderer **class** — Vela instantiates it with the resolved display options.
 *  Built-in default: `NativeRenderer`.
 *  from `'vela/renderers/lwc'` and pass it as `options.renderer`. */
export type RendererConstructor = new (opts?: RendererDisplayOptions) => IChartRenderer;

export interface VelaOptions extends MarketConfig {
    /** false = static history; true = history + live forming candle. */
    live?: boolean;
    theme?: ThemeName | VelaTheme;
    height?: number | string;
    /** Rendering backend as a renderer **class** that Vela instantiates (with the
     *  resolved display options). Omit for the built-in native renderer (default); for
     **/
    renderer?: RendererConstructor;
    /** Scripting language used when `addIndicator` doesn't specify one. Default `'pine'`
     *  (or the first injected engine's language). */
    defaultLanguage?: string;
    /** Show the dashed line + axis label at the latest price (default true). */
    currentPriceLine?: boolean;
    /** Use a logarithmic price scale on the price pane (default false). */
    logScale?: boolean;
    /** Native geometry backend: `'auto'` (WebGL2 if available, else canvas2d),
     *  or force `'canvas2d'` / `'webgl2'`. Native renderer only. */
    nativeBackend?: NativeBackend;
    /** Native-renderer animations. `true`/`false` toggles all; an object configures
     *  each motion independently — on/off, or its ease duration in ms. Default: eased
     *  **zoom on**, inertial **pan on but snappy** (short glide), gliding **autoscale
     *  on**, first-paint **reveal on**, live-bar glide **off**. Set `{ pan: false }` for an
     *  instant pan with no momentum, `{ zoom: 150 }` for a slower zoom glide,
     *  `{ liveBar: true }` (or a duration in ms) to make the forming candle slide toward
     *  each live tick instead of snapping, `{ intro: false }` to skip the reveal. */
    animations?: boolean | AnimationConfig;
    /** Neon glow/bloom intensity for line series (0 = off, ~0.6 = strong). WebGL2 only
     *  — the canvas2d backend ignores it. Default 0. */
    glow?: number;
    /** Bullish candle body/wick color (native renderer). Defaults to the palette's bullish green. */
    upColor?: string;
    /** Bearish candle body/wick color (native renderer). Defaults to the palette's bearish red. */
    downColor?: string;
    /** How the base price series is drawn (native renderer): candlestick / OHLC bars /
     *  line / area / baseline. Default `'candles'`. */
    priceStyle?: PriceStyle;
    /** Interactive user drawings (native renderer). Default: toolbar VISIBLE with the
     *  default tool set. `false` hides the toolbar (the `chart.drawings` API still works
     *  headlessly); an object picks tools (`{ tools: [...] }`) or defines groups
     *  (`{ groups: [...] }`) and toggles the toolbar (`{ toolbar: false }`). */
    drawings?: DrawingsOption;
    /** The built-in volume indicator: per-bar volume columns anchored to the bottom of the
     *  price pane, on their own scale (they never affect the price autoscale). Added
     *  automatically on chart creation (native renderer) — pass `false` to opt out. */
    volume?: boolean;
    /** Settings-dialog visibility policy. Default: everything visible. `hidden` lists
     *  setting ids to hide — a tab (`'canvas'`), a group (`'canvas.grid'`), or a single
     *  row (`'canvas.grid.vertical'`); an id hides its whole subtree, and a tab with
     *  nothing left disappears from the rail. Hiding is presentation-only: hidden
     *  values keep being stored and applied. Enumerate the addressable ids of a live
     *  chart with `chart.renderer.listSettingsIds()`; the catalog is documented in
     *  docs/user/options.md. */
    settings?: SettingsVisibilityPolicy;
}

/** Settings-dialog visibility policy (see `VelaOptions.settings`). */
export interface SettingsVisibilityPolicy {
    /** Setting ids to hide — a tab, a group, or a row; an id hides its subtree. */
    hidden?: readonly string[];
}

/**
 * Per-feature native-renderer animation settings. Every eased motion takes
 * `boolean | number`: `false`/`0` = off (the motion is instant), `true` = the built-in
 * duration, a number = its ease time-constant in ms — the motion covers ~63% of the
 * remaining distance per time-constant and is visually settled after about three of
 * them (clamped to {@link ANIMATION_EASE_MAX_MS}).
 */
export interface AnimationConfig {
    /** Eased cursor-anchored wheel-zoom: the bar spacing glides toward each wheel notch's
     *  target instead of jumping. Default `true` ({@link ZOOM_EASE_DEFAULT_MS}). */
    zoom?: boolean | number;
    /** Inertial/kinetic pan — the velocity a drag releases with decays over this
     *  time-constant (a short, snappy glide by default; `false` stops dead). Default
     *  `true` ({@link PAN_INERTIA_DEFAULT_MS}). */
    pan?: boolean | number;
    /** The programmatic scroll glide — the scroll-to-latest button, `chart.panBy`, the
     *  keyboard pan keys — easing the view toward its target at constant zoom. Default:
     *  follows `pan` on/off, at {@link SCROLL_EASE_DEFAULT_MS} when on. */
    scroll?: boolean | number;
    /** Autoscale glide: while a zoom or fling is in flight the price scale eases toward
     *  its new window instead of snapping every frame. Default `true`
     *  ({@link AUTOSCALE_EASE_DEFAULT_MS}). */
    autoscale?: boolean | number;
    /** Glide of the forming bar: on a live tick the displayed high/low/close ease toward
     *  the new values instead of snapping (the price line and axis label follow). `true`
     *  uses the default duration ({@link LIVE_BAR_EASE_DEFAULT_MS}); a number is the ease
     *  time-constant in ms (visually settled after ~3×; clamped to
     *  {@link LIVE_BAR_EASE_MAX_MS}); `false`/`0` snaps. A new bar always snaps. Default
     *  `false` — the painted candle is then never behind the real data. */
    liveBar?: boolean | number;
    /** The first-paint reveal: candles draw themselves in, left to right, when they first
     *  appear. `true` = the default `'settle'` style (an overshoot that eases back);
     *  `'grow'` = a plain ease-out; `false` = no reveal; an object picks the style and/or
     *  the `duration` of the whole sweep in ms (default {@link INTRO_DURATION_DEFAULT_MS};
     *  clamped to {@link INTRO_DURATION_MAX_MS}). Default `true`. */
    intro?: boolean | IntroStyle | IntroConfig;
}

/** The first-paint reveal styles: `settle` overshoots and eases back, `grow` eases out. */
export type IntroStyle = 'settle' | 'grow';

/** Object form of `animations.intro` — style and/or sweep duration (ms). */
export interface IntroConfig {
    style?: IntroStyle;
    duration?: number;
}

/** A resolved `animations.intro`: `style: false` = no reveal. */
export interface IntroAnimation {
    style: IntroStyle | false;
    duration: number;
}

// Built-in ease time-constants (ms) — what `true` means for each `animations` entry.
/** Wheel-zoom glide. */
export const ZOOM_EASE_DEFAULT_MS = 70;
/** Inertial-pan velocity decay — short/snappy (the drift is ≈ v₀·τ), not a long coast. */
export const PAN_INERTIA_DEFAULT_MS = 110;
/** Scroll-to-latest / `panBy` glide toward its target offset. */
export const SCROLL_EASE_DEFAULT_MS = 130;
/** Autoscale glide during a zoom/fling. */
export const AUTOSCALE_EASE_DEFAULT_MS = 80;
/** Time-constant (ms) of the live-bar glide when `animations.liveBar` is `true`. */
export const LIVE_BAR_EASE_DEFAULT_MS = 90;
/** Whole-sweep duration of the first-paint reveal. */
export const INTRO_DURATION_DEFAULT_MS = 650;
/** Upper bound (ms) for any ease time-constant — past this the chart visibly lags its input. */
export const ANIMATION_EASE_MAX_MS = 1000;
/** Upper bound (ms) for `animations.liveBar` — past this the candle visibly lags the feed. */
export const LIVE_BAR_EASE_MAX_MS = ANIMATION_EASE_MAX_MS;
/** Upper bound (ms) for the reveal sweep. */
export const INTRO_DURATION_MAX_MS = 5000;

/** Normalize a `boolean | number` animation entry to an ease time-constant in ms (0 = off):
 *  `true` ⇒ `defaultMs`, a positive finite number ⇒ itself clamped to `maxMs`, anything
 *  else (`false`, `0`, negative, NaN, junk) ⇒ 0. */
export function resolveEaseMs(value: unknown, defaultMs: number, maxMs = ANIMATION_EASE_MAX_MS): number {
    if (value === true) return defaultMs;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value, maxMs);
}

/** Normalize an `animations.liveBar` value to an ease time-constant in ms (0 = snap). */
export function resolveLiveBarEaseMs(value: unknown): number {
    return resolveEaseMs(value, LIVE_BAR_EASE_DEFAULT_MS, LIVE_BAR_EASE_MAX_MS);
}

/** Normalize an `animations.intro` value (also what the renderer's `intro` feature
 *  accepts): `true` ⇒ the default settle reveal, a style name ⇒ that style at the
 *  default duration, an object ⇒ its style/duration (missing fields default), and
 *  anything else (`false`, `'none'`, `'off'`, `null`, `undefined`, junk) ⇒ off — like
 *  {@link resolveEaseMs}, the "absent = default" rule lives in {@link resolveAnimations}. */
export function resolveIntro(value: unknown): IntroAnimation {
    const off: IntroAnimation = { style: false, duration: 0 };
    if (value === true) return { style: 'settle', duration: INTRO_DURATION_DEFAULT_MS };
    if (value === 'settle' || value === 'grow') return { style: value, duration: INTRO_DURATION_DEFAULT_MS };
    if (value && typeof value === 'object') {
        const o = value as IntroConfig;
        const d = o.duration;
        return {
            style: o.style === 'grow' ? 'grow' : 'settle',
            duration: typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.min(d, INTRO_DURATION_MAX_MS) : INTRO_DURATION_DEFAULT_MS,
        };
    }
    return off;
}

/** The renderer's resolved per-motion animation values (see {@link RendererDisplayOptions}). */
export type ResolvedAnimations = Pick<RendererDisplayOptions, 'animZoom' | 'animPan' | 'animScroll' | 'animAutoscale' | 'animLiveBar' | 'animIntro'>;

/** Resolve `VelaOptions.animations` to the renderer's per-motion values. `true` (or
 *  absent) is every motion at its default — the live-bar glide's default is off;
 *  `false` disables everything, the reveal included. An object configures each on its
 *  own; `scroll` left unset follows `pan` on/off. */
export function resolveAnimations(animations: boolean | AnimationConfig | undefined): ResolvedAnimations {
    if (animations === false) return { animZoom: 0, animPan: 0, animScroll: 0, animAutoscale: 0, animLiveBar: 0, animIntro: { style: false, duration: 0 } };
    const cfg: AnimationConfig = animations === true || animations == null ? {} : animations;
    const animPan = resolveEaseMs(cfg.pan ?? true, PAN_INERTIA_DEFAULT_MS);
    return {
        animZoom: resolveEaseMs(cfg.zoom ?? true, ZOOM_EASE_DEFAULT_MS),
        animPan,
        animScroll: cfg.scroll === undefined ? (animPan > 0 ? SCROLL_EASE_DEFAULT_MS : 0) : resolveEaseMs(cfg.scroll, SCROLL_EASE_DEFAULT_MS),
        animAutoscale: resolveEaseMs(cfg.autoscale ?? true, AUTOSCALE_EASE_DEFAULT_MS),
        animLiveBar: resolveLiveBarEaseMs(cfg.liveBar),
        animIntro: resolveIntro(cfg.intro ?? true),
    };
}

/** Native geometry-layer backend selection. */
export type NativeBackend = 'auto' | 'canvas2d' | 'webgl2';

/** How the base price series is drawn on the price pane (native renderer).
 *  A plugin chart type (registered via `vela/plugin`) adds its own id to this union
 *  volume-at-price (plus a right-edge visible-range profile); it needs the
 *  provider+symbol to expose trade data — without it, plain candles render.
 *  `'heikinashi'` draws Heikin Ashi candles: a 1:1 display transform of the raw
 *  bars applied at the core's bar seam, so indicators compute on the same
 *  smoothed values the chart shows (raw data stays untouched underneath). */
/** Built-in styles plus any id registered through the chart-type SDK (`registerChartType`). */
export type PriceStyle = 'candles' | 'bars' | 'line' | 'area' | 'baseline' | 'heikinashi' | (string & {});

/** Display options passed to a renderer at construction. */
export interface RendererDisplayOptions {
    currentPriceLine: boolean;
    logScale: boolean;
    nativeBackend: NativeBackend;
    // Ease time-constants in ms; 0 = that motion is off (instant). See `AnimationConfig`.
    animZoom: number;
    animPan: number;
    animScroll: number;
    animAutoscale: number;
    animLiveBar: number;
    animIntro: IntroAnimation;
    glow: number;
    upColor: string;
    downColor: string;
    priceStyle: PriceStyle;
}

/**
 * Where to move an indicator (via `handle.moveTo(...)`):
 * - `'price'` — merge into the main price pane (on its own scale unless it's a
 *   price-unit overlay).
 * - `{ pane: id }` — merge into an existing pane (identified by `Pane.id`).
 * - `{ newPane: {...} }` — create a fresh pane, optionally placed relative to an
 *   existing one (`before`/`after` its pane id); default is a new pane at the bottom.
 */
export type MoveTarget =
    | 'price'
    | { pane: string }
    | { newPane: { before?: string; after?: string } | true };

/** A pane and the indicators it holds — a `chart.panes.list()` entry. */
export interface PaneInfo {
    id: string;
    kind: 'price' | 'study';
    /** Display order, top-to-bottom (0 = topmost, the price pane). */
    order: number;
    collapsed: boolean;
    maximized: boolean;
    indicators: Array<{
        id: string;
        title: string;
        shorttitle?: string;
        ownScale: boolean;
    }>;
}

/** Options for `chart.addIndicator(source, options?)`. */
export interface AddIndicatorOptions {
    /** Which registered engine runs this script (by language id). Default: the chart's `defaultLanguage`. */
    language?: string;
    /** Input overrides, keyed by input title or varId. */
    inputs?: Record<string, InputValue>;
    /** Declaration-property overrides (a strategy's `initial_capital`, an indicator's
     *  `precision`, …), keyed like the engine's props schema. Ignored by engines
     *  without props support. */
    props?: Record<string, InputValue>;
    /** Force overlay-vs-pane placement (default: read from `indicator(overlay=…)`). */
    overlay?: boolean;
    /** Explicit pane placement. */
    pane?: 'price' | 'new';
    /** Display title override. */
    title?: string;
}
