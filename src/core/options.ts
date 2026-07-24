import type { OHLCV } from './model/ohlcv';
import type { InputValue } from './model/inputs';
import type { IChartRenderer } from './ports/IChartRenderer';
import type { DrawingsOption } from './drawings/toolbar';

/** A registered data-provider name (any string; matched case-insensitively). */
export type ProviderName = string;

/** How the chart obtains its candles. */
export interface MarketConfig {
    /** Default provider for a bare `symbol`. Equivalent to prefixing it `provider:symbol`.
     *  Omit when the symbol carries its own `EXCHANGE:` prefix or to resolve by index. */
    provider?: ProviderName;
    symbol?: string;
    timeframe?: string;
    bars?: number;
    /** Offline bars instead of a provider; when set, no network fetch happens. */
    data?: OHLCV[];
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
     *  each independently. Default: eased **zoom on**, inertial **pan on but snappy**
     *  (short glide). Set `{ pan: false }` for an instant pan with no momentum. */
    animations?: boolean | AnimationConfig;
    /** Neon glow/bloom intensity for line series (0 = off, ~0.6 = strong). WebGL2 only
     *  — the canvas2d backend ignores it. Default 0. */
    glow?: number;
    /** Bullish candle body/wick color (native renderer). Default `#0d98c6`. */
    upColor?: string;
    /** Bearish candle body/wick color (native renderer). Default `#ffffff`. */
    downColor?: string;
    /** How the base price series is drawn (native renderer): candlestick / OHLC bars /
     *  line / area / baseline. Default `'candles'`. */
    priceStyle?: PriceStyle;
    /** Interactive user drawings (native renderer). `true` shows the default toolbar;
     *  an object picks tools (`{ tools: [...] }`) or defines groups (`{ groups: [...] }`)
     *  and toggles the toolbar (`{ toolbar: false }`). Default off (toolbar hidden; the
     *  `chart.drawings` API still works headlessly). */
    drawings?: DrawingsOption;
    /** The built-in volume indicator: per-bar volume columns anchored to the bottom of the
     *  price pane, on their own scale (they never affect the price autoscale). Added
     *  automatically on chart creation (native renderer) — pass `false` to opt out. */
    volume?: boolean;
}

/** Per-feature native-renderer animation toggles. */
export interface AnimationConfig {
    /** Eased cursor-anchored wheel-zoom (+ gliding autoscale while zooming). Default true. */
    zoom?: boolean;
    /** Inertial/kinetic pan — a short snappy glide after a drag-release. Default true. */
    pan?: boolean;
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
    animZoom: boolean;
    animPan: boolean;
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
    indicators: Array<{ id: string; title: string; ownScale: boolean }>;
}

/** Options for `chart.addIndicator(source, options?)`. */
export interface AddIndicatorOptions {
    /** Which registered engine runs this script (by language id). Default: the chart's `defaultLanguage`. */
    language?: string;
    /** Input overrides, keyed by input title or varId. */
    inputs?: Record<string, InputValue>;
    /** Force overlay-vs-pane placement (default: read from `indicator(overlay=…)`). */
    overlay?: boolean;
    /** Explicit pane placement. */
    pane?: 'price' | 'new';
    /** Display title override. */
    title?: string;
}
