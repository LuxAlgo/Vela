import type { OHLCV } from './model/ohlcv';
import type { VisibleRangePreset } from './visible-range';
import type { VisibleRange } from './ports/IChartRenderer';
import type { InputValue } from './model/inputs';
import type { IChartRenderer } from './ports/IChartRenderer';
import type { DrawingsOption } from './drawings/toolbar';

/** A registered data-provider name (any string; matched case-insensitively). */
export type ProviderName = string;

/**
 * Which trading session the chart shows. The two built-in metadata-derived IDs remain
 * literal union members for editor completion, while providers may accept any non-empty
 * ID without a catalog. An explicit catalog adds validation and presentation metadata.
 * The provider owns the actual bar filtering. History and live paths receive the ID
 * unchanged; a metadata-derived market-status badge may additionally request the
 * conventional `regular` and `extended` calendars.
 */
export type MarketSession = 'regular' | 'extended' | (string & Record<never, never>);

/** One host-declared market session. Windows use `HHMM-HHMM`, recur each civil day in
 * market time, and may wrap midnight; several windows represent split sessions such as
 * a lunch break. */
export interface MarketSessionDefinition {
    id: MarketSession;
    label: string;
    windows: readonly string[];
    /** Any non-empty canvas-compatible CSS color literal. Use alpha for translucent shading. */
    color: string;
}

/** Normalize an untrusted provider/persisted session ID without changing its case. */
export const normalizeSession = (v: unknown): MarketSession | undefined => {
    if (typeof v !== 'string') return undefined;
    const id = v.trim();
    return id.length > 0 ? (id as MarketSession) : undefined;
};

/** Whether a string is one valid `HHMM-HHMM` session window. `2400` is accepted only
 * as the end boundary; equal edges are empty and therefore invalid. */
function validSessionWindow(v: unknown): v is string {
    if (typeof v !== 'string') return false;
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(v);
    if (!m) return false;
    const sh = Number(m[1]);
    const sm = Number(m[2]);
    const eh = Number(m[3]);
    const em = Number(m[4]);
    if (sh > 23 || sm > 59 || eh > 24 || em > 59 || (eh === 24 && em !== 0)) return false;
    return sh !== eh || sm !== em;
}

/**
 * Validate and defensively copy a host session catalog. Invalid definitions are
 * dropped whole, declaration/window order is preserved, and the first valid duplicate
 * ID wins. This function deliberately validates colors as non-empty strings, matching
 * renderer config: syntax is consumed by the renderer in its browser context.
 */
export function normalizeSessionDefinitions(value: unknown): readonly MarketSessionDefinition[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: MarketSessionDefinition[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const r = raw as { id?: unknown; label?: unknown; windows?: unknown; color?: unknown };
        const id = normalizeSession(r.id);
        const label = typeof r.label === 'string' ? r.label.trim() : '';
        const color = typeof r.color === 'string' ? r.color.trim() : '';
        if (!id || !label || !color || !Array.isArray(r.windows) || r.windows.length === 0 || !r.windows.every(validSessionWindow)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label, windows: [...r.windows], color });
    }
    return out;
}

/** Resolve a candidate against an explicit catalog; an absent/unknown ID falls back to
 * the first valid definition. An empty catalog deliberately resolves to no session. */
export function resolveMarketSession(candidate: unknown, definitions: readonly MarketSessionDefinition[]): MarketSession | undefined {
    const id = normalizeSession(candidate);
    if (id && definitions.some((definition) => definition.id === id)) return id;
    return definitions[0]?.id;
}

/** How the chart obtains its candles. */
export interface MarketConfig {
    /** The market's symbol. A bare ticker (`'BTCUSDT'`) resolves against the registered
     *  providers in DECLARATION order (first one whose index lists it); an
     *  `EXCHANGE:` prefix (`'coinbase:BTC-USD'`, case-insensitive) pins the venue. */
    symbol?: string;
    timeframe?: string;
    bars?: number;
    /** Trading session to show ({@link MarketSession}). Absent asks the provider for its
     * default (`regular` on legacy session markets); continuous markets ignore it. */
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
 * offline bars (and giving `symbol` WITHOUT `data` drops a previous offline dataset —
 * back to the provider path). `visibleRange` frames the FIRST paint of the
 * new market (a range chip switching timeframe + depth + window in one call).
 */
export interface MarketSwitch {
    /** Bare ticker (provider resolved by declaration order) or `EXCHANGE:`-prefixed. */
    symbol?: string;
    timeframe?: string;
    bars?: number;
    /** Switch to an exact provider-facing trading-session ID (reloads like a timeframe change). */
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
    /** The shown trading session — undefined = the provider default or no session. */
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

/** A renderer class — Vela instantiates it with the resolved display options.
 * Built-in default: `NativeRenderer`; hosts may pass any conforming implementation. */
export type RendererConstructor = new (opts?: RendererDisplayOptions) => IChartRenderer;

export interface VelaOptions extends MarketConfig {
    /** Explicit session catalog. A bare chart uses the IDs to validate and resolve the
     * provider-facing session; a shell also projects labels, windows, and colors into its
     * UI. `undefined` lets a shell derive legacy regular/extended choices from symbol
     * metadata; `[]` disables session UI. Host configuration, never chart state. */
    sessions?: readonly MarketSessionDefinition[];
    /** IANA market timezone a shell uses to expand explicit session windows. Falls back
     * to symbol metadata, then `Etc/UTC`; independent from its display timezone. An
     * invalid explicit zone produces no shading. */
    sessionTimezone?: string;
    /** false = static history; true = history + live forming candle. */
    live?: boolean;
    theme?: ThemeName | VelaTheme;
    height?: number | string;
    /** Rendering backend as a renderer class that Vela instantiates with the resolved
     * display options. Omit it for the built-in native renderer. */
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
    /** Native-renderer animations. When omitted, Vela follows
     *  `prefers-reduced-motion`; `false` always reduces motion, while `true` and any
     *  object are explicit full-motion host policies. An object configures each path
     *  independently. Full-motion defaults: eased **zoom on**, inertial **pan on but
     *  snappy** (short glide), live-bar glide **off**. Set `{ pan: false }` for an
     *  instant pan with no momentum, `{ liveBar: true }` (or a duration in ms) to make
     *  the forming candle slide toward each live tick instead of snapping. */
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

/** Per-feature native-renderer animation toggles. */
export interface AnimationConfig {
    /** Eased cursor-anchored wheel-zoom (+ gliding autoscale while zooming). Default true. */
    zoom?: boolean;
    /** Inertial/kinetic pan — a short snappy glide after a drag-release. Default true. */
    pan?: boolean;
    /** Glide of the forming bar: on a live tick the displayed high/low/close ease toward
     *  the new values instead of snapping (the price line and axis label follow). `true`
     *  uses the default duration ({@link LIVE_BAR_EASE_DEFAULT_MS}); a number is the ease
     *  time-constant in ms (visually settled after ~3×; clamped to
     *  {@link LIVE_BAR_EASE_MAX_MS}); `false`/`0` snaps. A new bar always snaps. Default
     *  `false` — the painted candle is then never behind the real data. */
    liveBar?: boolean | number;
}

/** Effective presentation-motion policy after combining host configuration with the
 * browser preference. `animations` values remain the configured source of truth; this
 * runtime result is never persisted. */
export interface ResolvedMotionPolicy {
    reduced: boolean;
    animZoom: boolean;
    animPan: boolean;
    animLiveBar: number;
    intro: boolean;
}

/** Time-constant (ms) of the live-bar glide when `animations.liveBar` is `true`. */
export const LIVE_BAR_EASE_DEFAULT_MS = 90;
/** Upper bound (ms) for `animations.liveBar` — past this the candle visibly lags the feed. */
export const LIVE_BAR_EASE_MAX_MS = 1000;

/** Normalize an `animations.liveBar` value to an ease time-constant in ms (0 = snap). */
export function resolveLiveBarEaseMs(value: unknown): number {
    if (value === true) return LIVE_BAR_EASE_DEFAULT_MS;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value, LIVE_BAR_EASE_MAX_MS);
}

/** Resolve `VelaOptions.animations` to the renderer's per-feature values.
 *  A boolean toggles zoom + pan and leaves the live-bar glide at its default (off) for
 *  `true`; `false` disables everything. An object configures each independently. */
export function resolveAnimations(animations: boolean | AnimationConfig | undefined): Pick<RendererDisplayOptions, 'animZoom' | 'animPan' | 'animLiveBar'> {
    if (typeof animations === 'boolean') return { animZoom: animations, animPan: animations, animLiveBar: 0 };
    return {
        animZoom: animations?.zoom ?? true,
        animPan: animations?.pan ?? true,
        animLiveBar: resolveLiveBarEaseMs(animations?.liveBar),
    };
}

/** Resolve the whole motion surface. Omission follows the system; every supplied value
 * is an explicit host override. `true` retains the historical live-bar default (off). */
export function resolveMotionPolicy(animations: boolean | AnimationConfig | undefined, systemReduced: boolean): ResolvedMotionPolicy {
    const configured = resolveAnimations(animations);
    const reduced = animations === false || (animations === undefined && systemReduced);
    return {
        reduced,
        animZoom: reduced ? false : configured.animZoom,
        animPan: reduced ? false : configured.animPan,
        animLiveBar: reduced ? 0 : configured.animLiveBar,
        intro: !reduced,
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
    animZoom: boolean;
    animPan: boolean;
    animLiveBar: number;
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
