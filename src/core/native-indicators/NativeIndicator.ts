import type { OHLCV } from '../model/ohlcv';
import type { PaneAxis } from '../model/indicator';
import type { SeriesSpec } from '../model/series';
import type { Fill, Background, PriceLine } from '../model/scene';
import type { DrawingLine, DrawingBox, DrawingLabel, DrawingPolyline, DrawingLinefill, DrawingTable } from '../model/drawings';
import type { InputSchema, InputValue } from '../model/inputs';
import type { VisibleRange, IndicatorStatus } from '../ports/IChartRenderer';
import type { DataControl } from '../DataControl';

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
    readonly symbol: string;
    readonly timeframe: string;
    readonly live: boolean;
    /** The chart's case-sensitive, provider-facing trading-session ID; undefined means
     *  the provider default or no session model. A session switch reloads the market and
     *  RESTARTS the indicator, so this never changes within one context's lifetime. */
    readonly session?: string;
    /** The canonical bar array (a live accessor — always current). */
    bars(): readonly OHLCV[];
    /** Market-data access (trades / capabilities) for data-driven natives. */
    readonly data: DataControl;
    /** Push a fresh render output; the chart mounts it (first call) or patches it (subsequent). */
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
    /** A live tick arrived (bars changed) — recompute + emit. */
    onBars(): void;
    /** The viewport changed (scroll/zoom) — for range-aware natives (see `reactsToViewport`). */
    onViewport(range: VisibleRange): void;
    /** Settings changed — recompute + emit. */
    setInputs(inputs: Record<string, InputValue>): void;
    /** Hidden — stop timers/fetches (free resources); the instance + its state are kept for resume. */
    suspend(): void;
    /** Shown again — resume + re-emit. */
    resume(): void;
    /** Removed — full teardown (clear caches, stop timers). */
    stop(): void;
}

/**
 * Static description + factory for a native-indicator TYPE, registered once via
 * {@link registerNativeIndicator}. The descriptor is the type (metadata + capability); `create()`
 * mints a per-instance {@link NativeIndicator}.
 */
export interface NativeIndicatorDescriptor {
    readonly type: string;
    /** Full display name (picker, settings header, handle title). */
    readonly title: string;
    /**
     * Compact name for the on-chart legend chip and the settings-dialog header.
     * Absent ⇒ {@link title}. The picker keeps the full title either way.
     */
    readonly shortTitle?: string;
    readonly paneHint: 'price' | 'new';
    readonly overlay: boolean;
    /** Whether instances react to viewport changes (drives the orchestrator's viewport poke). */
    readonly reactsToViewport?: boolean;
    /** Marks the type as beta — surfaced in the catalog so a host "add indicator" UI can badge it. */
    readonly beta?: boolean;
    /**
     * Allow several instances of this type on one chart — every add creates a new one (a study
     * like a moving average is typically stacked at different lengths). Absent ⇒ SINGLE instance
     * per type: a second add returns the existing handle. A type that pushes a bespoke layer
     * payload through `pushData` must stay single-instance (the layer is keyed by type).
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

/** Look up a registered native-indicator descriptor (undefined if the type isn't registered). */
export function getNativeIndicator(type: string): NativeIndicatorDescriptor | undefined {
    return REGISTRY.get(type);
}

/** All registered native-indicator types (for a host "add native indicator" menu). */
export function nativeIndicatorTypes(): string[] {
    return [...REGISTRY.keys()];
}

/** All registered native-indicator descriptors (for building a catalog with metadata + capability). */
export function nativeIndicatorDescriptors(): NativeIndicatorDescriptor[] {
    return [...REGISTRY.values()];
}
