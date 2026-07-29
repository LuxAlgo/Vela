import type { IChartRenderer, VisibleRange } from './core/ports/IChartRenderer';
import type { ScriptingEngine } from './core/ports/ScriptingEngine';
import type { MarketDataFeed } from './core/ports/MarketDataFeed';
import type { VisibleRangePreset } from './core/visible-range';
import type { VelaOptions, MarketSwitch, MarketSnapshot, AddIndicatorOptions } from './core/options';
import type { InputValue } from './core/model/inputs';
import type { IndicatorHandle } from './core/IndicatorHandle';
import type { EngineContextSnapshot } from './core/ports/ScriptingEngine';
import type { NativeIndicatorInfo } from './core/native-indicators';
import type { VelaEventMap } from './core/events/types';
import { EngineOrchestrator, type ResolvedConfig } from './core/engine/EngineOrchestrator';
import type { SceneInspection } from './core/engine/inspect';
import { resolveTheme } from './core/theme';
import { RendererControl } from './core/RendererControl';
import { PanesControl } from './core/PanesControl';
import { DataControl } from './core/DataControl';
import { DrawingsControl } from './core/DrawingsControl';
import { NativeRenderer } from './renderers/native/NativeRenderer';
import { MultiProviderFeed } from './data/MultiProviderFeed';
import { registerBuiltinChartTypes } from './chart-types/builtins';
import { registerVolume } from './core/native-indicators/volume';
import { registerVpvr } from './core/native-indicators/vpvr';

/** Outcome of {@link Vela.runIndicator}: success carries the live handle, failure the error. */
export interface RunIndicatorResult {
    ok: boolean;
    /** The mounted indicator on success; null on failure (it was removed again). */
    handle: IndicatorHandle | null;
    /** The compile/runtime error on failure; null on success. */
    error: Error | null;
    /** Post-mortem context snapshot on failure, when the engine had produced one (else null). */
    context: EngineContextSnapshot | null;
}

/** Optional dependency overrides — inject a different renderer, engines, or data feed (tests, swaps). */
export interface VelaDeps {
    renderer?: IChartRenderer;
    /** Scripting engines to register at construction (bulk form of `registerEngine`); default none. */
    engines?: ScriptingEngine[];
    /** Market-data source; default `new MultiProviderFeed()` (a provider registry; offline `data` needs no provider).
     *  A custom feed injected here is used bare — `chart.data` registration is then a no-op. */
    dataFeed?: MarketDataFeed;
}

/**
 * The public, imperative chart. Composition root: wires the built-in native
 * renderer (the default) + provider data feed and delegates orchestration.
 * Optional renderers (e.g. lightweight-charts) are passed in as a class via
 * `options.renderer` and instantiated here, so this module imports only the
 * built-in native renderer. Scripting engines are opt-in — register one with
 * `registerEngine` (no engine ⇒ candles only).
 */
export class Vela {
    private readonly orchestrator: EngineOrchestrator;
    private readonly rendererControl: RendererControl;
    private readonly panesControl: PanesControl;
    private readonly dataControl: DataControl;
    private readonly drawingsControl: DrawingsControl;

    constructor(container: HTMLElement | string, options: VelaOptions = {}, deps: VelaDeps = {}) {
        registerBuiltinChartTypes(); // built-in chart types through the public SDK registry (idempotent)
        registerVolume(); // register the built-in native indicators (idempotent)
        registerVpvr();
        const element = resolveElement(container);
        const theme = resolveTheme(options.theme);
        // Resolve animations: boolean toggles all; object configures each; default = zoom on, pan on.
        let animZoom = true;
        let animPan = true;
        if (typeof options.animations === 'boolean') {
            animZoom = options.animations;
            animPan = options.animations;
        } else if (options.animations) {
            animZoom = options.animations.zoom ?? true;
            animPan = options.animations.pan ?? true;
        }
        const display = {
            currentPriceLine: options.currentPriceLine ?? true,
            logScale: options.logScale ?? false,
            nativeBackend: options.nativeBackend ?? 'auto',
            animZoom,
            animPan,
            glow: options.glow ?? 0,
            upColor: options.upColor ?? '#089981',
            downColor: options.downColor ?? '#f23645',
            priceStyle: options.priceStyle ?? 'candles',
        };
        const RendererClass = options.renderer ?? NativeRenderer;
        if (typeof RendererClass !== 'function') {
            throw new Error(
                "[vela] options.renderer must be a renderer class, e.g. import { LwcRenderer } from " +
                    "'vela/renderers/lwc'. The 'lwc'/'native' string options were removed.",
            );
        }
        const renderer = deps.renderer ?? new RendererClass(display);
        const engines = deps.engines ?? [];
        // Default: a multi-provider registry feed (caches closed bars internally). No
        // provider is bundled — register one with `chart.data.registerProvider(...)`;
        // until then a symbol-backed chart parks its initial load. Inject
        // `deps.dataFeed` to source candles from your own feed (used bare, no registry).
        const feed = deps.dataFeed ?? new MultiProviderFeed();
        const config: ResolvedConfig = {
            market: {
                provider: options.provider,
                symbol: options.symbol,
                timeframe: options.timeframe,
                bars: options.bars,
                visibleRange: options.visibleRange,
                data: options.data,
            },
            live: options.live ?? false,
            theme,
            defaultLanguage: options.defaultLanguage ?? engines[0]?.language ?? 'pine',
            drawings: options.drawings,
            volume: options.volume ?? true, // the volume indicator is on by default
        };
        this.rendererControl = new RendererControl(renderer);
        this.dataControl = new DataControl(feed);
        this.orchestrator = new EngineOrchestrator(element, renderer, feed, engines, config, this.dataControl);
        this.panesControl = new PanesControl(this.orchestrator);
        this.drawingsControl = new DrawingsControl(this.orchestrator.drawings);
    }

    /**
     * Register a scripting engine so `addIndicator({ language })` can run that
     * language. No engine is registered by default — import and register the one
     * you need (e.g. `chart.registerEngine('pine', new PineEngine())`); without it
     * the chart only displays candles. Re-registering a language replaces it.
     */
    registerEngine(language: string, engine: ScriptingEngine): this {
        this.orchestrator.registerEngine(language, engine);
        return this;
    }

    /** Run an indicator script on the chart's market data and render it. */
    addIndicator(source: string, options?: AddIndicatorOptions): IndicatorHandle {
        return this.orchestrator.addIndicator(source, options);
    }

    /**
     * Add a built-in NATIVE indicator (core-computed, no scripting engine) by registered `type` —
     * e.g. `'vpvr'`. It becomes a first-class indicator (legend row, settings, hide, remove,
     * events) and is single-instance per type (a second call returns the existing handle). Returns
     * a fail-soft handle for an unregistered type. Native renderer only.
     */
    addNativeIndicator(type: string, options?: { inputs?: Record<string, InputValue> }): IndicatorHandle {
        return this.orchestrator.addNativeIndicator(type, options);
    }

    /**
     * The catalog of built-in native indicators with their live state on this chart — each entry's
     * `type`, `title`, whether it `supported`s the current symbol, and whether it's already `present`
     * (native indicators are single-instance per type, so a second `addNativeIndicator` is a no-op).
     * Lets a host "add indicator" UI list them, gate unsupported ones, and avoid duplicates. Async
     * because support may probe the provider (a type may need data the symbol lacks).
     */
    availableNativeIndicators(): Promise<NativeIndicatorInfo[]> {
        return this.orchestrator.availableNativeIndicators();
    }

    /** Live handles of every indicator currently on the chart (script + native) — drive
     *  host panels (object trees, indicator lists) with per-id visibility/removal. */
    indicators(): IndicatorHandle[] {
        return this.orchestrator.listIndicators();
    }

    /**
     * Execute an indicator script and INJECT it only if the run succeeds — the seam for
     * host editors and consoles. Resolves `{ ok: true, handle }` after the first
     * successful evaluation, or `{ ok: false, error }` after a compile/runtime failure —
     * in which case the failed indicator is removed again (no dead legend row).
     * Never rejects.
     */
    runIndicator(source: string, options?: AddIndicatorOptions): Promise<RunIndicatorResult> {
        const handle = this.addIndicator(source, options);
        return new Promise((resolve) => {
            const offReady = handle.on('ready', () => {
                offReady();
                offError();
                resolve({ ok: true, handle, error: null, context: null });
            });
            const offError = handle.on('error', ({ error }) => {
                offReady();
                offError();
                void handle
                    .context()
                    .catch(() => null)
                    .then((context) => {
                        try {
                            handle.remove();
                        } catch {
                            /* already torn down */
                        }
                        resolve({ ok: false, handle: null, error, context });
                    });
            });
        });
    }

    /**
     * Switch the chart's market IN PLACE — symbol, provider, timeframe, depth, or offline
     * data — WITHOUT destroying the chart: indicators re-execute over the new bars, native
     * indicators restart, and panes, user drawings, renderer config and event
     * subscriptions all survive. Resolves once the new market's history is painted (a
     * deep backfill continues behind it — await {@link historyComplete}); a call
     * superseded by a newer `setMarket` resolves silently. Emits `market:changed`
     * (with the previous identity) when the market identity changed.
     */
    setMarket(next: MarketSwitch): Promise<void> {
        return this.orchestrator.setMarket(next);
    }

    /** The current market identity — the read counterpart of {@link setMarket}. A snapshot
     *  of the REQUESTED market: it reflects an in-flight switch immediately (before the
     *  new bars land). Listen to `market:changed` for committed identity changes. */
    get market(): MarketSnapshot {
        return this.orchestrator.marketSnapshot();
    }

    /** Resolves once the chart is painted and interactive. For a symbol-backed chart this
     *  awaits a provider being registered that resolves the symbol (the parked load). On a
     *  deep-history chart (beyond one ~10k-bar chunk) older bars keep backfilling BEHIND
     *  this — await {@link historyComplete} for the full depth. Distinct from
     *  `chart.data.ready()`, which awaits only the provider symbol indexes. */
    ready(): Promise<void> {
        return this.orchestrator.ready();
    }

    /** Resolves once the FULL requested history has loaded (immediately for small/offline
     *  charts; after the backward backfill for deep ones — see the `history:progress` /
     *  `history:complete` events). Never rejects: on destroy or a failed backfill it
     *  resolves with whatever depth loaded. */
    historyComplete(): Promise<void> {
        return this.orchestrator.historyComplete();
    }

    /**
     * A renderer-agnostic snapshot of the graphic elements the core has generated
     * (series, fills, drawings, tables, …) — a deterministic check that a feature was
     * produced, independent of which renderer drew it.
     */
    inspect(): SceneInspection {
        return this.orchestrator.inspect();
    }

    /**
     * The active renderer's control surface. Set/read render features at runtime —
     * common ones (candle colors, `logScale`, `currentPriceLine`) and renderer-specific
     * ones (native `glow`) — with **no indicator re-run**. Unsupported keys warn and no-op:
     * `chart.renderer.set('glow', 0.6)`, `chart.renderer.set({ logScale: true })`.
     */
    get renderer(): RendererControl {
        return this.rendererControl;
    }

    /**
     * The chart's pane control surface. List panes with the indicators each holds and
     * move/merge/reorder/collapse/maximize them: `chart.panes.list()`,
     * `chart.panes.moveIndicator(id, { newPane: true })`, `chart.panes.collapse(id)`.
     * On a renderer without pane management the mutators warn and no-op.
     */
    get panes(): PanesControl {
        return this.panesControl;
    }

    /**
     * The chart's data control surface. Register market-data providers and query the
     * registry: `chart.data.registerProvider('binance', new BinanceProvider())`,
     * `chart.data.resolve('BTCUSDT')`, `chart.data.symbols('binance')`, and
     * `chart.data.ready()` (provider indexes settled). No provider is bundled —
     * registering the one that resolves the chart symbol fires the parked initial load
     * (await it with `chart.ready()`).
     */
    get data(): DataControl {
        return this.dataControl;
    }

    /**
     * The chart's user-drawings control surface. Activate tools, create/mutate
     * drawings programmatically, and persist them:
     * `chart.drawings.setTool('trendline')`, `chart.drawings.add('hline', { … })`,
     * `chart.drawings.toJSON()/fromJSON(doc)`. Always present; on a renderer without
     * the `userDrawings` capability the interactive methods warn + no-op while
     * persistence still round-trips. Enable the on-chart toolbar with
     * `new Vela(el, { drawings: true })` or `chart.drawings.showToolbar()`.
     */
    get drawings(): DrawingsControl {
        return this.drawingsControl;
    }

    on<K extends keyof VelaEventMap>(event: K, handler: (payload: VelaEventMap[K]) => void): () => void {
        return this.orchestrator.events.on(event, handler);
    }

    /** The current visible time range (`from`/`to` in epoch-ms), or null before data loads. */
    getVisibleRange(): VisibleRange | null {
        return this.orchestrator.getVisibleRange();
    }

    /** Set the visible time range explicitly (epoch-ms). Use for a custom date range. */
    setVisibleRange(range: VisibleRange): this {
        this.orchestrator.setVisibleRange(range);
        return this;
    }

    /**
     * Pan the view by a fraction of the visible width — positive ⇒ toward the latest
     * bars, negative ⇒ into history. Behaves exactly like dragging the chart: constant
     * zoom, the same pan limits (forward stops at the newest candle plus the bounded
     * empty space), and eased on renderers that animate pans. Repeated calls stack into
     * one continuous scroll.
     */
    panBy(fraction: number): this {
        this.orchestrator.panBy(fraction);
        return this;
    }

    /**
     * Frame a named date-range preset over the loaded bars: `'1D'`, `'1W'`, `'1M'`,
     * `'3M'`, `'6M'`, `'1Y'`, `'YTD'`, or `'ALL'`. A preset deeper than the loaded
     * history simply frames everything (it doesn't fetch more bars).
     */
    setVisibleRangePreset(preset: VisibleRangePreset): this {
        this.orchestrator.setVisibleRangePreset(preset);
        return this;
    }

    resize(): void {
        this.orchestrator.resize();
    }

    destroy(): void {
        this.orchestrator.destroy();
    }
}

function resolveElement(container: HTMLElement | string): HTMLElement {
    if (typeof container !== 'string') return container;
    const element = document.querySelector(container);
    if (!element) throw new Error(`[vela] container not found for selector "${container}"`);
    return element as HTMLElement;
}
