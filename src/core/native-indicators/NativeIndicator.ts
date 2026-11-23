import type { OHLCV } from '../model/ohlcv';
import type { PaneAxis } from '../model/indicator';
import type { SeriesSpec } from '../model/series';
import type { Fill, Background, PriceLine } from '../model/scene';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from '../model/drawings';
import type { InputSchema, InputValue } from '../model/inputs';
import type { VisibleRange, IndicatorStatus } from '../ports/IChartRenderer';
import type { BarRange } from '../ports/MarketDataFeed';
import type { Unsubscribe } from '../util/types';
import type { DataControl } from '../DataControl';
import type { MessageLike, Translator } from '../i18n/types';
import { textOf } from '../i18n/text';

/**
 * The renderer-neutral visual parts a native indicator emits each compute — a subset of
 * {@link import('../model/indicator').IndicatorModel}. The orchestrator wraps this into a full
 * model (stamping id / pane / native tag), so the native path reuses the entire mount → legend →
 * settings → patch pipeline. (A native indicator with a *bespoke* renderer layer — e.g. the volume
 * columns — instead pushes its payload through the dedicated renderer seam, `pushData`.)
 */
export interface NativeIndicatorOutput {
    /**
     * Value-axis override for the pane this native OWNS (see `IndicatorModel.paneAxis`):
     * `'none'` for content that is not value-mapped, or band labels for a categorical
     * axis. Emitted per compute, so it can follow the inputs (e.g. row toggles relabel
     * the axis). Absent ⇒ the pane derives a scale from its content as usual.
     */
    paneAxis?: PaneAxis;
    series?: SeriesSpec[];
    fills?: Fill[];
    backgrounds?: Background[];
    priceLines?: PriceLine[];
    lines?: DrawingLine[];
    boxes?: DrawingBox[];
    labels?: DrawingLabel[];
    polylines?: DrawingPolyline[];
    linefills?: DrawingLinefill[];
    tables?: DrawingTable[];
}

/** Services the host gives a running native indicator. */
export interface NativeIndicatorContext {
    /** This instance's indicator id — the same id its `IndicatorHandle`, `inspect()` and
     *  the pane listing report. Lets an instance name itself to host code (a picker, a
     *  hit-test) and tell itself apart from siblings of a `multiInstance` type. */
    readonly id: string;
    readonly symbol: string;
    readonly timeframe: string;
    /** Whether the chart streams live data. False during a bar replay — entering and
     *  leaving replay RESTARTS the indicator, so this never changes within one context. */
    readonly live: boolean;
    /** The chart's trading session (`'regular'` | `'extended'`); undefined = regular /
     *  no session model. A session switch reloads the market and RESTARTS the
     *  indicator, so this never changes within one context's lifetime. */
    readonly session?: string;
    /** The canonical bar array (a live accessor — always current). */
    bars(): readonly OHLCV[];
    /** Market-data access (trades / capabilities) for data-driven natives. */
    readonly data: DataControl;
    /**
     * Fetch bars for another symbol/timeframe through the chart's data feed (the same gateway
     * scripting engines use). Unresolvable or empty answers resolve to `[]`.
     */
    fetchSeries?(symbol: string, timeframe: string, range: BarRange): Promise<OHLCV[]>;
    /**
     * Subscribe to live bar updates for another symbol/timeframe. Returns an unsubscribe
     * function; always a no-op while `live` is `false` (bar replay or static mode), and
     * automatically torn down when this indicator context stops.
     */
    subscribeSeries?(symbol: string, timeframe: string, onBar: (bar: OHLCV) => void): Unsubscribe;
    /**
     * Push a fresh render output; the chart mounts it (first call) or patches it (subsequent).
     * Series payloads are index-aligned: one slot per bar of `bars()` AS IT STANDS AT THE
     * CALL, first slot on its first bar. The chart keeps an emitted output on those bars
     * when history later lands in front of them (or the oldest bars are trimmed), until the
     * next emit replaces it.
     */
    emit(out: NativeIndicatorOutput): void;
    /**
     * Push a BESPOKE render payload to the renderer's native layer for this indicator's type (for a
     * native whose visuals aren't ordinary series/fills — e.g. volume/VPVR push their layer config).
     */
    pushData(data: unknown): void;
    /** Set the indicator's legend status: `'loading'` (fetching), `'live'` (live-updating), `'idle'`. */
    setStatus(status: IndicatorStatus): void;
}

/**
 * A core-computed (non-Pine) indicator instance — the compute + lifecycle behind one on-chart
 * native indicator. The orchestrator owns one per instance and drives it through these hooks; the
 * instance pushes its visuals via {@link NativeIndicatorContext.emit}. Implementations live in this
 * folder (one file per type) and self-register a {@link NativeIndicatorDescriptor}.
 */
export interface NativeIndicator {
    /** Begin: compute + emit the first output. */
    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void;
    /** The bars changed — a live tick, older history landing, or the candles re-derived
     *  by a price style — recompute + emit. */
    onBars(): void;
    /** The viewport changed (scroll/zoom) — for range-aware natives (see `reactsToViewport`). */
    onViewport(range: VisibleRange): void;
    /** Settings changed — recompute + emit. */
    setInputs(inputs: Record<string, InputValue>): void;
    /** Hidden — stop timers/fetches (free resources); the instance + its state are kept for resume.
     *  Only ever called after `start` (an instance added hidden is not suspended — it is
     *  started when first shown). */
    suspend(): void;
    /** Shown again — resume + re-emit. */
    resume(): void;
    /** Removed, or replaced by a fresh instance (a market switch stops it as the switch
     *  begins) — full teardown (clear caches, stop timers). Only ever called after `start`.
     *  Pushes made inside `stop()` still land (a layer-backed native clears its channel
     *  here); once it returns, the context drops every push and emit. */
    stop(): void;
}

/**
 * Static description + factory for a native-indicator TYPE, registered once via
 * {@link registerNativeIndicator}. The descriptor is the type (metadata + capability); `create()`
 * mints a per-instance {@link NativeIndicator}.
 */
export interface NativeIndicatorDescriptor {
    readonly type: string;
    /** Full display name (picker, settings header, handle title). A message (`msg()`)
     *  reads in the chart's language. */
    readonly title: MessageLike;
    /**
     * Compact name for the on-chart legend chip, the settings-dialog header and the
     * object tree's indicator rows.
     * Absent ⇒ {@link title}. The picker keeps the full title either way.
     */
    readonly shortTitle?: MessageLike;
    readonly paneHint: 'price' | 'new';
    readonly overlay: boolean;
    /** Whether instances react to viewport changes (drives the orchestrator's viewport poke). */
    readonly reactsToViewport?: boolean;
    /**
     * Compute only over the chart's COMPLETE history, the way script indicators do. While
     * the history is still loading (a deep load streaming in, a source healing a cold
     * symbol, a deeper depth being fetched), the instance is not started — its legend row
     * shows a loading state, and `ready` / `indicator:added` wait — or, when it already
     * runs, `onBars()` is held and the previous output stays on its bars. The first
     * compute (or the re-run) comes once the history completes, so values computed over
     * a partial history never paint and never repaint. Absent ⇒ the instance starts on
     * the first bars and `onBars()` fires for every history chunk as it lands.
     */
    readonly waitsForHistory?: boolean;
    /** Marks the type as beta — surfaced in the catalog so a host "add indicator" UI can badge it. */
    readonly beta?: boolean;
    /**
     * Whether instances get in-chart chrome. Absent ⇒ a legend row like any indicator.
     * `false` ⇒ the output paints, but there is NO legend row (no title chip, no eye/gear/✕,
     * uncounted by the fold chip) and `panes.list()` does not report it — for host-owned
     * overlays (trade markers, event flags) whose on/off lives in the host's own UI. Distinct
     * from hidden: a legend-less indicator still computes and paints; the host controls it
     * through its handle.
     */
    readonly legend?: boolean;
    /**
     * Allow several instances of this type on one chart — every add creates a new one (a study
     * like a moving average is typically stacked at different lengths). Absent ⇒ SINGLE instance
     * per type: a second add returns the existing handle. A type that paints through a renderer
     * layer (`pushData`) gets ONE layer instance per indicator instance, each fed by that
     * instance's own channel and painting on that instance's pane — so instances never
     * overwrite each other (see `IndicatorModel.native.channel`).
     */
    readonly multiInstance?: boolean;
    inputsSchema(): InputSchema[];
    defaultInputs(): Record<string, InputValue>;
    create(): NativeIndicator;
    /**
     * Whether this native indicator applies to `symbol` (a type may need a provider capability).
     * Absent ⇒ always supported. Used to gate auto-add + an "add native indicator" menu.
     */
    isSupported?(symbol: string, data: DataControl): boolean | Promise<boolean>;
}

/**
 * One entry in the "add native indicator" catalog: the type's static metadata plus its live state
 * on a specific chart — whether it applies to the current symbol (`supported`) and whether at
 * least one instance is already present (`present`). Produced by
 * `chart.availableNativeIndicators()`.
 */
export interface NativeIndicatorInfo {
    readonly type: string;
    readonly title: string;
    /** Applies to the current symbol (a type may need data the provider lacks). */
    readonly supported: boolean;
    /** At least one instance is on the chart. For a single-instance type a second add is a no-op;
     *  a `multiInstance` type adds another instance regardless. */
    readonly present: boolean;
    /** The type allows several instances per chart (see `NativeIndicatorDescriptor.multiInstance`). */
    readonly multiInstance?: boolean;
    /** The type is flagged beta (for a badge in the picker). */
    readonly beta?: boolean;
}

/**
 * The renderer-layer data channel of ONE instance of a `multiInstance` native type. A
 * single-instance type's channel is its type (the layer id doubles as the channel); a
 * multi-instance type needs one channel per instance, or every instance's `pushData`
 * would land on the same layer. The orchestrator stamps it on the model
 * (`IndicatorModel.native.channel`) and routes the instance's pushes to it; the renderer
 * mounts a dedicated layer instance reading it.
 */
export function nativeInstanceChannel(type: string, instanceId: string): string {
    return `${type}#${instanceId}`;
}

/** Process-wide catalog of native-indicator types. Built-ins (volume, VPVR) register via the composition root. */
const REGISTRY = new Map<string, NativeIndicatorDescriptor>();

/** Register a native-indicator type so `chart.addNativeIndicator(type)` can create it. */
export function registerNativeIndicator(descriptor: NativeIndicatorDescriptor): void {
    REGISTRY.set(descriptor.type, descriptor);
}

/** Remove a registered native-indicator type (mainly for tests). */
export function unregisterNativeIndicator(type: string): void {
    REGISTRY.delete(type);
}

/** A registered descriptor as the read APIs hand it out: its names as plain text. */
export type ResolvedNativeIndicatorDescriptor = NativeIndicatorDescriptor & { readonly title: string; readonly shortTitle?: string };

function resolved(d: NativeIndicatorDescriptor, i18n: Translator | undefined): ResolvedNativeIndicatorDescriptor {
    if (typeof d.title === 'string' && (d.shortTitle === undefined || typeof d.shortTitle === 'string')) return d as ResolvedNativeIndicatorDescriptor;
    // Delegate to the registered descriptor (its factory and hooks stay its own) with the
    // names resolved on top.
    const names: { title: string; shortTitle?: string } = { title: textOf(i18n, d.title) };
    if (d.shortTitle !== undefined) names.shortTitle = textOf(i18n, d.shortTitle);
    return Object.assign(Object.create(d) as NativeIndicatorDescriptor, names) as ResolvedNativeIndicatorDescriptor;
}

/** Look up a registered native-indicator descriptor (undefined if the type isn't registered).
 *  Its names read in `i18n`'s language (English without one). */
export function getNativeIndicator(type: string, i18n?: Translator): ResolvedNativeIndicatorDescriptor | undefined {
    const d = REGISTRY.get(type);
    return d ? resolved(d, i18n) : undefined;
}

/** All registered native-indicator types (for a host "add native indicator" menu). */
export function nativeIndicatorTypes(): string[] {
    return [...REGISTRY.keys()];
}

/** All registered native-indicator descriptors (for building a catalog with metadata +
 *  capability), their names in `i18n`'s language (English without one). */
export function nativeIndicatorDescriptors(i18n?: Translator): ResolvedNativeIndicatorDescriptor[] {
    return [...REGISTRY.values()].map((d) => resolved(d, i18n));
}

/** A registered descriptor exactly as registered, its names still messages (the chart
 *  resolves them in its own language). */
export function nativeIndicatorEntry(type: string): NativeIndicatorDescriptor | undefined {
    return REGISTRY.get(type);
}

/** Every registered descriptor exactly as registered. */
export function nativeIndicatorEntries(): NativeIndicatorDescriptor[] {
    return [...REGISTRY.values()];
}
