import type { IChartRenderer, VisibleRange } from '../ports/IChartRenderer';
import type { MarketDataFeed, BarRange } from '../ports/MarketDataFeed';
import type { ScriptingEngine, ExecutionMarket, VisibleBarRange, BarsChangeReason } from '../ports/ScriptingEngine';
import type { Unsubscribe } from '../util/types';
import type { OHLCV } from '../model/ohlcv';
import type { IndicatorModel } from '../model/indicator';
import type { ValuePatch, SeriesValueDelta } from '../model/patch';
import { isLineLikeSeries } from '../model/series';
import type { InputValue } from '../model/inputs';
import type { VelaTheme, MarketConfig, MarketSwitch, MarketSnapshot, AddIndicatorOptions, PriceStyle, MoveTarget, PaneInfo } from '../options';
import type { PaneController } from '../PanesControl';
import type { PaneAction } from '../ports/IChartRenderer';
import type { IndicatorHandle } from '../IndicatorHandle';
import type { ContextSelect, EngineContextSnapshot } from '../ports/ScriptingEngine';
import type { ScriptRun, ScriptRunCause } from '../script-run';
import type { StrategyTrade } from '../model/strategy';
import type { VelaEventMap } from '../events/types';
import { TypedEventBus } from '../events/EventBus';
import { IndicatorRegistry, type IndicatorRecord } from './IndicatorRegistry';
import { getNativeIndicator, nativeIndicatorDescriptors, type NativeIndicatorContext, type NativeIndicatorInfo, type NativeIndicatorOutput } from '../native-indicators/NativeIndicator';
import { LiveSession } from './LiveSession';
import { IndicatorHandleImpl, type IndicatorController } from './IndicatorHandleImpl';
import { inspectModels, type SceneInspection } from './inspect';
import { presetToRange, type VisibleRangePreset } from '../visible-range';
import { DrawingController } from '../drawings/DrawingController';
import { DrawingSeriesService } from './DrawingSeriesService';
import type { DrawingsOption } from '../drawings/toolbar';
import type { DataControl } from '../DataControl';
import { timeframeToMs } from '../../data/timeframe';
import { parseSymbol } from '../../data/ProviderRegistry';
import { barTransformFor, parseExtendedTicker, type BarTransform } from '../price-styles/BarTransform';
import { chartType, type SeriesDataEngine } from '../../chart-types/registry';
import { resolveTheme } from '../theme';

export interface ResolvedConfig {
    market: MarketConfig;
    live: boolean;
    theme: VelaTheme;
    /** Language used when `addIndicator` doesn't specify one. */
    defaultLanguage: string;
    /** Interactive user-drawings configuration (toolbar/tools/groups). */
    drawings?: DrawingsOption;
    /** Auto-add the built-in volume indicator (bottom-anchored bars on the price pane). */
    volume?: boolean;
}

/** Coalesce rapid pan/zoom viewport events into one re-run (ms). */
const VIEWPORT_DEBOUNCE_MS = 150;
/** `script:run` collapse window for FORMING-bar runs only — a stream re-executes the open
 *  candle several times a second, and a dashboard cannot use that rate. Every other cause
 *  (a new bar above all) is emitted unconditionally. */
const RUN_EMIT_THROTTLE_MS = 1_000;

/** Bars in the quick recent-window preview a RANGELESS feed paints before the deep fetch. */
const PREVIEW_BARS = 300;
/**
 * Depth a ranged feed serves in ONE request. A round trip costs far more than the extra
 * rows: splitting this range into a small head plus a stream of widening chunks paid for
 * itself only in time-to-first-candle, and nothing downstream can use those first candles
 * anyway — an indicator's first run is held until the whole depth has landed (Pine is
 * causal, so running it per chunk would repaint a different curve each time). Below this
 * line, one request wins outright. (Feeds with `loadProgressive` never reach this split:
 * their SOURCE decides what is paintable, snapshot by snapshot.)
 */
const SINGLE_LOAD_BARS = 5_000;
/**
 * Beyond {@link SINGLE_LOAD_BARS} the history loads BACKWARD in chunks of this many bars:
 * the chart is interactive after the first chunk while older ones stream in behind it
 * (each a bounded request the data source answers quickly, instead of one giant fetch that
 * stalls silently and lands as a single main-thread-freezing parse).
 */
const CHUNK_BARS = 10_000;
/**
 * A progressive source's FIRST paint waits until the snapshot carries at least this many
 * bars (or the full ask, whichever is smaller): the first paint is also the frame the
 * renderer sizes the view against, and a cold source's confirmed head can be a handful
 * of bars — framing onto those shows a few giant candles that later snapshots (painted
 * view-preserved) never fix. The FINAL answer always paints, whatever its depth: a
 * genesis-era symbol may simply have fewer bars than this.
 *
 * 20, not the original 100: on MONTHLY charts the whole contract often holds fewer than
 * 100 bars, so the hold never released and the chart sat blank until the provider's poll
 * budget ran out (~90 s measured). Twenty bars frame a readable view on every timeframe.
 */
const FIRST_PAINT_BARS = 20;

/**
 * A live bar more than this many intervals ahead of the last one signals MISSED bars (a throttled
 * background tab, a socket reconnect, system sleep) → backfill. 1.5 tolerates timestamp drift and
 * variable-length periods (a 31-day month on the ~30-day 'M' interval) without false positives.
 */
const GAP_FACTOR = 1.5;
/**
 * Minimum time between gap heals. A heal that comes back EMPTY (a legitimately tradeless interval
 * on an illiquid symbol — providers omit empty candles) must not re-trigger on every tick; within
 * the cooldown a discontinuous bar is accepted as a real market gap.
 */
const HEAL_COOLDOWN_MS = 5_000;

/**
 * Renderer- and engine-agnostic orchestration: owns market data (via the injected
 * `MarketDataFeed`), runs/streams indicators through registered `ScriptingEngine`s
 * (selected by language), routes panes, and drives the injected `IChartRenderer`.
 * Imports neither a concrete renderer nor a concrete scripting engine.
 */
export class EngineOrchestrator implements IndicatorController, PaneController {
    readonly events = new TypedEventBus<VelaEventMap>();
    private readonly registry = new IndicatorRegistry();
    /** Top-to-bottom pane display order (price always first). The routing + `chart.panes`
     *  source of truth; the renderer mirrors it via `orderPanes`. */
    private readonly paneOrder: string[] = ['price'];
    /** Panes currently collapsed to a strip (mirror of the renderer's visual state). */
    private readonly collapsedPanes = new Set<string>();
    /** The maximized pane (mirror), or null when the split is normal. */
    private maximizedPaneId: string | null = null;
    private paneActionUnsub: Unsubscribe | null = null;
    private readonly handles = new Map<string, IndicatorHandleImpl>();
    private readonly engines = new Map<string, ScriptingEngine>();
    private readonly defaultLanguage: string;
    private live: LiveSession | null = null;
    /**
     * The chart's bar VIEW — what the renderer, engines, and natives consume. With no bar
     * transform active it IS {@link rawBars} (same reference, zero cost); under a transforming
     * price style (Heikin Ashi) it's the derived series, index-aligned 1:1 with the raw one.
     */
    private bars: OHLCV[] = [];
    /** The RAW market data, exactly as the feed served it — the source of truth. The `'bar'`
     *  event, gap-heal reconciliation, and `chart.data` stay on this plane; nothing synthetic
     *  is ever stored or emitted as data. */
    private rawBars: OHLCV[] = [];
    /** The active price style's 1:1 bar transform (null ≡ raw view). */
    private barTransform: BarTransform | null = null;
    // ── chart-type data engines (SDK): one lazily-created engine per style id ──
    private readonly typeEngines = new Map<string, SeriesDataEngine>();
    /** Last-seen chart-type settings per type id (dialog edits + persisted restores) —
     *  replayed into a data engine whenever one is (re)created. */
    private readonly typeSettings = new Map<string, Record<string, unknown>>();
    /** The style id whose data engine is currently ACTIVE (drives suspend/resume + pokes). */
    private activeEngineStyle: string | null = null;
    /** The chart's current price style (tracked from the renderer's change events + initial read). */
    private priceStyle: PriceStyle = 'candles';
    private readonly readyPromise: Promise<void>;
    private unresolvedUnsub: Unsubscribe | null = null;
    /** Latest chart visible range (left/right bar times), fed to viewport-dependent scripts. */
    private visibleRange: VisibleBarRange | null = null;
    private viewportUnsub: Unsubscribe | null = null;
    private viewportTimer: ReturnType<typeof setTimeout> | null = null;
    // ── live gap-heal state (missed bars while a tab was backgrounded/frozen) ──
    /** A backfill fetch is in flight; live ticks arriving meanwhile buffer + replay after it. */
    private healing = false;
    private healBuffer: OHLCV[] = [];
    private lastHealAt = 0;
    /** The `visibilitychange` catch-up listener (removed on destroy). */
    private onVisible: (() => void) | null = null;
    /** What the last applied bar did: refine the open candle, or open a new one (which
     *  settles the previous). Read by the `script:run` cause attribution. */
    private barCause: 'tick' | 'bar' = 'tick';
    // ── deep-history backfill (older chunks streaming in behind the interactive chart) ──
    /** Where the history load stands. Stamped into new sessions + every bar notification. */
    private historyState: 'backfill' | 'complete' = 'complete';
    /** Invalidates detached async work (backfill loops, in-flight loads, gap heals):
     *  bumped by init(), setMarket() and destroy(). */
    private generation = 0;
    /** Aborts the in-flight PROGRESSIVE load's source polling on supersession — an
     *  abandoned stream left polling to its own budget starves the browser's per-host
     *  connection pool, and the NEXT symbol's very first fetch with it (measured). */
    private progressiveAbort: AbortController | null = null;
    /** Awaiters racing a superseded load (setMarket callers) — released on every bump so they never hang. */
    private readonly supersedeWaiters: Array<() => void> = [];
    /** `history:complete` fired for the CURRENT load. Each market load re-arms the cycle
     *  (see {@link resetHistoryTracking}) — `historyComplete()` is per-load, not per-chart. */
    private historyCompleted = false;
    private resolveHistoryComplete!: () => void;
    private historyCompletePromise = new Promise<void>((resolve) => {
        this.resolveHistoryComplete = resolve;
    });
    /** A setMarket switch is in flight: bar/viewport pokes to the OLD sessions are held
     *  (they must not re-run over the incoming market's bars — re-execution follows the load). */
    private switchingMarket = false;
    /** A load is in flight with nothing painted — the state behind the renderer's loading
     *  affordance and the `load:start`/`load:end` event pair (transition-guarded). */
    private loadingUp = false;

    constructor(
        container: HTMLElement,
        private readonly renderer: IChartRenderer,
        private readonly feed: MarketDataFeed,
        engines: ScriptingEngine[],
        private readonly config: ResolvedConfig,
        private readonly dataControl: DataControl,
    ) {
        // Register the construction-time engines (bulk sugar for registerEngine).
        for (const engine of engines) this.registerEngine(engine.language, engine);
        this.defaultLanguage = config.defaultLanguage;
        this.renderer.mount(container, config.theme);
        // The renderer's in-chart settings dialog reports edits here → re-run that indicator.
        this.renderer.onInputChange((e) =>
            e.kind === 'prop' ? this.applyProps(e.indicatorId, { [e.key]: e.value }) : this.applyInputs(e.indicatorId, { [e.key]: e.value }),
        );
        // The renderer's in-chart legend ✕ reports a removal here → tear the indicator down.
        this.renderer.onRemoveIndicator((id) => this.removeIndicator(id));
        // The renderer's in-chart legend eye reports a hide/show here → suspend/resume the indicator.
        this.renderer.onToggleIndicatorVisible?.((id, visible) => this.setVisible(id, visible));
        // Pane hover buttons + double-clicks report layout intents here (delete tears down the
        // pane's indicators; the rest are already applied by the renderer — this keeps the
        // `chart.panes` view + collapse/maximize mirror in sync).
        this.paneActionUnsub = this.renderer.onPaneAction?.((a) => this.handlePaneAction(a)) ?? null;
        // Chart-type SDK settings edited in the renderer's dialog (or replayed by
        // applyConfig on a persisted restore) → remember them AND forward to the
        // type's data engine. The cache matters: the engine may not exist yet (a
        // restored config lands before the style's first activation) or may be
        // recreated later (a market switch) — `startChartTypeEngine` replays the
        // last-seen values into every fresh engine, so one never fetches on schema
        // defaults the user has edited away.
        this.renderer.onChartTypeSettingsChange?.((typeId, values) => {
            this.typeSettings.set(typeId, values);
            this.typeEngines.get(typeId)?.onSettings?.(values);
        });
        // The renderer's legend "Move to" menu / row drag reports a move here → route it.
        this.renderer.onMoveIndicator?.((id, target) => this.moveIndicator(id, target));
        // The renderer's in-chart theme control (settings dialog Canvas → Theme) reports a
        // request here — the core owns the canonical theme, applies it, and announces it.
        this.renderer.onThemeSelect?.((name) => this.setTheme(resolveTheme(name)));
        // Pan/zoom → re-run ONLY visible-range-dependent scripts (e.g. visible-range
        // volume profile) with the new window. Debounced so a drag re-runs once.
        this.viewportUnsub = this.renderer.onViewportChange((range) => this.onViewportChange(range));
        // Price-style changes (feature set / settings dialog / config template) — a chart
        // type may carry a DATA requirement beyond drawing: a bar-stream transform
        // (heikinashi) and/or a registered data engine (SDK chart types).
        this.renderer.onPriceStyleChange?.((style) => this.syncPriceStyle(style));
        // Seed the bar transform from the CONSTRUCTED style (a chart created with
        // `priceStyle: 'heikinashi'`) so the initial load already produces the view.
        const initialStyle = this.renderer.readFeature('priceStyle');
        if (typeof initialStyle === 'string') this.priceStyle = initialStyle as PriceStyle;
        this.barTransform = barTransformFor(initialStyle);
        // User drawings: owns the model + tool/selection state, drives the renderer's
        // drawings port (inert when the renderer lacks the `userDrawings` capability).
        // The series service backs data-driven drawings that read a finer timeframe:
        // it rides the feed's cache-backed ranged fetch, same path as `request.security`.
        const drawingSeries = new DrawingSeriesService({
            fetchBars: (tf, range) => this.fetchSeries(this.config.market.symbol ?? '', tf, range),
            canFetch: () => !!this.feed.loadRange && !this.config.market.data?.length && !!this.config.market.symbol,
            chartTimeframe: () => this.config.market.timeframe ?? '60',
            marketKey: () => `${this.config.market.symbol ?? ''}|${this.config.market.session ?? ''}`,
        });
        this.drawings = new DrawingController(this.renderer, this.events, config.drawings, drawingSeries);
        // A symbol nothing can serve leaves the load PARKED; publish it so a host can say so
        // instead of showing a blank chart forever (it still resumes if a provider registers).
        // A parked load also ends the loading state — nothing is coming, and an endless
        // animation over the empty chart would promise otherwise.
        this.unresolvedUnsub =
            this.feed.onUnresolved?.((info) => {
                this.endLoad();
                this.events.emit('data:unresolved', info);
            }) ?? null;
        this.readyPromise = this.init();
        // Seed a constructed chart-type DATA engine only now — `startChartTypeEngine`
        // awaits `readyPromise`, so this MUST come after the assignment above. Seeding
        // earlier awaited `undefined`: the engine started before the first load, could
        // not resolve its provider surfaces (e.g. a footprint feed), and a later
        // style re-select only RESUMED the empty engine — a restored plugin style
        // painted nothing until a market switch recreated it.
        if (chartType(initialStyle)?.dataEngine) this.syncChartTypeEngine(initialStyle);
    }

    /** The user-drawings manager (backs `chart.drawings`). */
    readonly drawings: DrawingController;

    /**
     * The visible range to feed a run. Prefer the latest viewport-change event, but
     * fall back to querying the renderer directly — the native renderer doesn't emit
     * a viewport-change for its initial fitContent, so on the first run the event
     * hasn't fired yet and a visible-range script (e.g. `chart.left_visible_bar_time`)
     * would otherwise see the whole dataset instead of the visible window.
     */
    private currentVisibleRange(): VisibleBarRange | undefined {
        if (this.visibleRange) return this.visibleRange;
        const r = this.renderer.getVisibleRange();
        return r ? { left: r.from, right: r.to } : undefined;
    }

    /** Resolve the engine for a language, defaulting when unspecified. */
    private engineFor(language?: string): ScriptingEngine {
        const lang = language ?? this.defaultLanguage;
        const engine = this.engines.get(lang);
        if (!engine) {
            throw new Error(
                `[vela] no scripting engine registered for language "${lang}". Vela ships none — ` +
                    `install one (Pine Script: @luxalgo/vela-pinets) and register it before addIndicator, ` +
                    `e.g. chart.registerEngine('pine', new PineEngine()).`,
            );
        }
        return engine;
    }

    /** Market metadata for an execution (Vela owns the bars). */
    private market(): ExecutionMarket {
        return {
            symbol: this.config.market.symbol ?? 'TEST',
            timeframe: this.config.market.timeframe ?? '60',
            symbolInfo: this.feed.symbolInfo?.(this.config.market),
            chartStyle: this.priceStyle,
        };
    }

    /**
     * The data gateway handed to engines: fetch ANY `(symbol, timeframe)` series
     * through the feed + cache. Used for secondary series (request.security
     * HTF/LTF/cross-symbol). The symbol is passed through so the feed resolves its
     * OWN `provider:` prefix (cross-exchange) — falling back to the chart's provider
     * for a bare symbol. No aggregation; timeframes stay separate.
     *
     * Chart-type modifiers: providers only ever serve RAW market data — any transform
     * is applied here, above them, on the fetched series' OWN timeframe. The EXTENDED
     * ticker decides, explicitly: `"SYM;heikinashi"` fetches the derived series,
     * anything else (including `"SYM;standard"`) fetches raw. The engine composes the
     * modifier — on a Heikin Ashi chart `syminfo.tickerid` carries `";heikinashi"`, so
     * default same-symbol `request.security` calls inherit the chart type, while a
     * plain/`ticker.standard()` symbol explicitly opts back into standard data.
     */
    private async fetchSeries(symbol: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
        const parsed = parseExtendedTicker(symbol);
        const cfg: MarketConfig = { symbol: parsed.symbol, timeframe };
        const bars = await (this.feed.loadRange ? this.feed.loadRange(cfg, range) : this.feed.load({ ...cfg, bars: range.limit }));
        return parsed.transform ? parsed.transform.full(bars) : bars;
    }

    private onViewportChange(range: VisibleRange): void {
        this.visibleRange = { left: range.from, right: range.to };
        this.events.emit('viewport:changed', { from: range.from, to: range.to });
        if (this.viewportTimer != null) clearTimeout(this.viewportTimer);
        this.viewportTimer = setTimeout(() => {
            this.viewportTimer = null;
            if (this.switchingMarket) return; // old sessions must not re-run mid-switch
            const window = this.visibleRange;
            if (!window) return;
            for (const record of this.registry.all()) {
                if (!record.renderHandle || record.hidden) continue;
                // range-aware indicators re-run / refetch with the new window
                if (record.session && record.prepared?.reactsToViewport) {
                    record.pendingCause = 'viewport';
                    record.session.setVisibleRange(window);
                }
                else if (record.native?.descriptor.reactsToViewport) record.native.instance.onViewport({ from: window.left, to: window.right });
            }
            // An active chart-type data engine streams in newly-visible data as the user scrolls.
            if (this.activeEngineStyle) this.typeEngines.get(this.activeEngineStyle)?.onViewport?.({ from: window.left, to: window.right });
        }, VIEWPORT_DEBOUNCE_MS);
    }

    private async init(): Promise<void> {
        const gen = this.bumpGeneration();
        this.beginLoad(true); // first load — nothing painted until the first batch
        await this.loadMarket(gen, { firstLoad: true });
        if (this.generation !== gen) return; // superseded mid-load (a setMarket, or destroy)
        this.startLive();
        this.events.emit('ready', undefined);
    }

    /** Bump the generation — superseding every detached continuation — and release
     *  superseded setMarket awaiters so their promises resolve instead of hanging. */
    private bumpGeneration(): number {
        const gen = ++this.generation;
        this.progressiveAbort?.abort(); // the superseded load's source stops polling promptly
        this.progressiveAbort = null;
        for (const w of this.supersedeWaiters.splice(0)) w();
        return gen;
    }

    /**
     * Enter the loading state: raise the renderer's affordance and tell the plugins
     * (`load:start`) — BEFORE the series is blanked or fetched, so extensions and custom
     * indicators can hide or reset their own visuals first. Transition-guarded: a switch
     * superseding a still-loading switch re-enters silently.
     */
    private beginLoad(firstLoad: boolean): void {
        if (this.loadingUp) return;
        this.loadingUp = true;
        this.renderer.setLoading?.(true);
        const m = this.config.market;
        this.events.emit('load:start', { symbol: m.symbol ?? 'TEST', timeframe: m.timeframe ?? '60', firstLoad });
    }

    /** Leave the loading state (first bars painted, or a load that ended with none) —
     *  drops the affordance and fires the matching `load:end`. */
    private endLoad(): void {
        if (!this.loadingUp) return;
        this.loadingUp = false;
        this.renderer.setLoading?.(false);
        const m = this.config.market;
        this.events.emit('load:end', { symbol: m.symbol ?? 'TEST', timeframe: m.timeframe ?? '60', bars: this.bars.length });
    }

    /**
     * Load the configured market's history into the chart — THE shared load pipeline
     * behind {@link init} and {@link setMarket}. Up to {@link SINGLE_LOAD_BARS} the whole
     * depth comes in ONE request: a round trip dominates the row count, and splitting the
     * range buys a faster first candle that nothing can use — an indicator's first run is
     * held until the full depth lands anyway. DEEPER than that, the load is progressive:
     * the newest {@link CHUNK_BARS} paint immediately and the rest streams in behind them
     * through the shared backfill loop, so the pipeline resolves at the first paint (await
     * {@link historyComplete} for the full depth) and sessions started meanwhile are
     * stamped 'backfill' until 'complete'. Offline data is a single fetch; a rangeless
     * feed keeps the preview-then-full shape, since it cannot fetch a range at all.
     * EVERY await is followed by a generation check so a superseded load (newer
     * setMarket, destroy) abandons without touching the chart. `firstLoad` activates the
     * bar-following layers once (volume auto-add) — a market SWITCH must not re-add what
     * the user has since removed.
     */
    private async loadMarket(gen: number, opts: { firstLoad: boolean }): Promise<void> {
        try {
            await this.loadMarketInner(gen, opts);
        } finally {
            // The owning load always ends the loading state — this is the belt for the paths
            // that never hand the renderer a non-empty series (a failed fetch, an empty
            // market). A superseded load leaves the state to its successor.
            if (this.generation === gen) this.endLoad();
        }
    }

    private async loadMarketInner(gen: number, opts: { firstLoad: boolean }): Promise<void> {
        const market = this.config.market;
        const requested = market.bars ?? 500;
        const initialRange = market.visibleRange;
        // Only a DEEP request is worth splitting, and only when a requested initial window
        // does not pin the frame (a chunked load would paint the wrong range, then jump).
        const deep = !market.data?.length && initialRange == null && requested > SINGLE_LOAD_BARS;
        // PROGRESSIVE-CAPABLE source first: paint every snapshot it emits while it heals —
        // first candles in seconds on a cold symbol, depth growing behind them — and
        // complete when the final answer resolves. The pipeline returns at the FIRST paint
        // (exactly the deep head + backfill shape below); the remainder streams in,
        // generation-checked. Snapshots are cumulative and confirmed-from-the-newest-bar
        // by the port contract, so each paint replaces the series with a superset,
        // viewport preserved. A NULL resolution means the resolved provider lacks the
        // capability — no snapshot was emitted, and the classic paths below run untouched.
        let progressiveServed = false;
        if (!market.data?.length && initialRange == null && this.feed.loadProgressive) {
            let painted = false;
            const paint = (bars: OHLCV[], final: boolean): void => {
                if (this.generation !== gen || (!final && bars.length === 0)) return;
                if (!painted && !final && bars.length < Math.min(requested, FIRST_PAINT_BARS)) return; // hold the framing paint until it can carry the view

                this.setBarSeries(bars, painted ? { preserveView: true } : undefined);
                if (!painted && bars.length > 0) {
                    painted = true;
                    if (opts.firstLoad) this.activateBarLayers();
                    if (!final) this.historyState = 'backfill';
                }
            };
            const abort = new AbortController();
            this.progressiveAbort = abort;
            progressiveServed = await new Promise<boolean>((firstPaint) => {
                let signaled = false;
                const signal = (served: boolean): void => {
                    if (!signaled) {
                        signaled = true;
                        firstPaint(served);
                    }
                };
                // Supersession must release THIS wait immediately (the newer switch owns the
                // chart) — the provider's own resolution can lag its abort by one poll.
                abort.signal.addEventListener('abort', () => signal(true), { once: true });
                this.feed
                    .loadProgressive!(market, (bars) => {
                        paint(bars, false);
                        if (painted) signal(true);
                    }, { signal: abort.signal })
                    .then((full) => {
                        if (this.progressiveAbort === abort) this.progressiveAbort = null;
                        if (full == null) return signal(false); // incapable — classic paths take over
                        if (this.generation !== gen) return signal(true);
                        paint(full, true);
                        this.completeHistory(full.length >= requested ? 'depth' : 'genesis');
                        signal(true);
                    })
                    .catch(() => {
                        if (this.progressiveAbort === abort) this.progressiveAbort = null;
                        if (this.generation === gen) this.completeHistory('aborted');
                        signal(true);
                    });
            });
        }
        if (progressiveServed) {
            /* painted above; the final snapshot and completion stream in behind */
        } else if (deep && this.feed.loadRange) {
            // Paint the newest chunk, stream the rest in behind it. The first chunk is a full
            // CHUNK_BARS, not a token head: at this depth the round trips are what cost, so
            // each one carries as much as the source answers well.
            const head = await this.feed.load({ ...market, bars: Math.min(requested, CHUNK_BARS) });
            if (this.generation !== gen) return;
            this.setBarSeries(head);
            if (opts.firstLoad) this.activateBarLayers(); // bar-following layers ride the FIRST candles
            if (head.length > 0 && requested > head.length) {
                this.historyState = 'backfill';
                void this.backfillHistory(gen, requested);
            } else {
                this.completeHistory('depth'); // the source had no more than one chunk of history
            }
        } else if (deep) {
            // RANGELESS feed at depth: it cannot fetch a range, so chunking would re-download
            // the head every time — keep the two-fetch shape, a quick preview then everything.
            const preview = await this.feed.load({ ...market, bars: PREVIEW_BARS });
            if (this.generation !== gen) return;
            this.setBarSeries(preview);
            if (opts.firstLoad) this.activateBarLayers(); // bar-following layers follow the FIRST candles, not the deep fetch
            const full = await this.feed.load(market);
            if (this.generation !== gen) return;
            this.setBarSeries(full, { preserveView: true });
            this.completeHistory('depth');
        } else {
            const bars = await this.feed.load(market);
            if (this.generation !== gen) return;
            this.setBarSeries(bars);
            if (opts.firstLoad) this.activateBarLayers();
            this.completeHistory('depth');
        }
        // Frame the requested window NOW: `setBarSeries` only invalidated, so this lands in the
        // very first painted frame — no wrong-window flash, no re-frame jump.
        if (initialRange != null) {
            if (typeof initialRange === 'string') this.setVisibleRangePreset(initialRange);
            else this.renderer.setVisibleRange(initialRange);
        }
        // Price-axis precision: try the (already cached) tick size now, then resolve async so the
        // axis switches from the zoom formula to the symbol's true precision as soon as it lands.
        this.refreshPriceFormat();
        void this.ensurePriceFormat();
    }

    /** Start the live tick subscription + the tab-restore catch-up listener. */
    private startLive(): void {
        if (!this.config.live) return;
        this.live = new LiveSession(this.feed, this.config.market, (bar) => this.onBar(bar));
        this.live.start();
        // Tab-restore catch-up: browsers throttle hidden tabs (timers → 1/min, sockets can
        // freeze), so bars close unseen while backgrounded. On return, backfill from the last
        // known bar IMMEDIATELY instead of waiting for the next tick to expose the hole (on a
        // quiet symbol that could be many seconds away).
        if (typeof document !== 'undefined') {
            this.onVisible = () => {
                if (document.visibilityState !== 'visible') return;
                const last = this.bars[this.bars.length - 1];
                if (!last || this.healing || !this.canHeal() || Date.now() - this.lastHealAt <= HEAL_COOLDOWN_MS) return;
                void this.healGap(last.time);
            };
            document.addEventListener('visibilitychange', this.onVisible);
        }
    }

    /** Stop live ticks + the visibility listener and clear the gap-heal state (switch/destroy). */
    private stopLive(): void {
        this.live?.stop();
        this.live = null;
        if (this.onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
        this.onVisible = null;
        this.healing = false;
        this.healBuffer = [];
        this.lastHealAt = 0;
    }

    /** Re-arm per-load history tracking: resolve the PREVIOUS load's promise (awaiters must
     *  never hang on a superseded load), then start a fresh completed-once cycle. */
    private resetHistoryTracking(): void {
        this.resolveHistoryComplete();
        this.historyCompleted = false;
        this.historyState = 'complete';
        this.historyCompletePromise = new Promise<void>((resolve) => {
            this.resolveHistoryComplete = resolve;
        });
    }

    /** The current market identity — a snapshot of the REQUESTED market, so it reflects
     *  an in-flight `setMarket` immediately (the config mutates before the load). */
    marketSnapshot(): MarketSnapshot {
        const m = this.config.market;
        return { symbol: m.symbol, provider: parseSymbol(m.symbol ?? '').provider ?? undefined, timeframe: m.timeframe, bars: m.bars, session: m.session, offline: m.data !== undefined };
    }

    /**
     * Switch the chart's market IN PLACE — no destroy/recreate. The renderer stays
     * mounted (canvases, viewport policy, cosmetic config), panes and indicator records
     * survive, and user drawings are untouched (per-symbol drawing documents are a HOST
     * policy via `chart.drawings.toJSON()/fromJSON()`, keyed off `market:changed`). The
     * bars reload through the shared {@link loadMarket} pipeline, then every consumer
     * restarts over the new market: Pine sessions re-execute, native indicators restart
     * with a fresh context, the active chart-type data engine is rebuilt, and the live
     * subscription re-targets.
     *
     * Resolves once the new market's history is painted — a deep backfill continues
     * BEHIND it (await {@link historyComplete} for full depth). A call superseded by a
     * newer setMarket (or destroy) resolves silently. Emits `market:changed` (with
     * `prev`) when the market IDENTITY changed; a depth-only reload (`bars`) is silent.
     */
    async setMarket(next: MarketSwitch): Promise<void> {
        const m = this.config.market;
        const identityChanged =
            (next.symbol !== undefined && next.symbol !== m.symbol) ||
            (next.timeframe !== undefined && next.timeframe !== m.timeframe) ||
            // A session switch changes WHICH bars exist (RTH vs ETH) — a full reload,
            // exactly like a timeframe change; the cache keys the sessions apart.
            (next.session !== undefined && next.session !== m.session) ||
            next.data !== undefined;
        const depthChanged = next.bars !== undefined && next.bars !== m.bars;
        // Same market, only deeper/shallower, with bars already on screen: handled by moving
        // the array's oldest edge instead of reloading (see `extendDepth`). An offline `data`
        // series has no source to extend from, and GROWING needs a ranged feed to fetch the
        // missing older bars — without one the reload is the only way to get them. Shrinking
        // needs no source at all: it is a trim of what is already held.
        const depthOnly =
            depthChanged &&
            !identityChanged &&
            this.rawBars.length > 0 &&
            !m.data?.length &&
            ((next.bars ?? 0) <= this.rawBars.length || typeof this.feed.loadRange === 'function');
        if (!identityChanged && !depthChanged) {
            // Nothing to reload — honor at most a framing request.
            if (typeof next.visibleRange === 'string') this.setVisibleRangePreset(next.visibleRange);
            else if (next.visibleRange) this.renderer.setVisibleRange(next.visibleRange);
            return;
        }
        const prev = { symbol: m.symbol ?? 'TEST', timeframe: m.timeframe ?? '60' };
        // A SESSION-ONLY flip (RTH↔ETH) changes WHICH bars exist but not the time axis:
        // the user's zoom/position carries over to the reload — captured here, before the
        // quiesce below discards it — unless the caller framed a window of its own. Any
        // other identity change keeps today's re-frame (a new symbol's clock is new).
        // What carries is the VIEW, not the wall clock: the sessions' bar densities
        // differ ~2.5×, so preserving the raw time window would fatten/thin every candle
        // (a perceived zoom change) — instead the BAR COUNT on screen and the time of
        // the newest visible bar anchor the reframe against the INCOMING series (see
        // the post-load refinement below). The time window still frames the first
        // paint provisionally.
        const sessionOnly =
            identityChanged &&
            next.session !== undefined &&
            next.data === undefined &&
            (next.symbol === undefined || next.symbol === m.symbol) &&
            (next.timeframe === undefined || next.timeframe === m.timeframe);
        const carried = sessionOnly && next.visibleRange === undefined ? this.currentVisibleRange() : undefined;
        // How many bars the user is LOOKING at — the pixel zoom, in series-neutral form.
        const carriedCount = carried ? this.rawBars.filter((b) => b.time >= carried.left && b.time <= carried.right).length : 0;

        const gen = this.bumpGeneration();
        this.switchingMarket = true;
        try {
            // Quiesce the OLD market's inbound flow before touching the config.
            this.stopLive();
            if (this.viewportTimer != null) {
                clearTimeout(this.viewportTimer);
                this.viewportTimer = null;
            }
            this.visibleRange = null; // the old market's window means nothing on the new one
            this.resetHistoryTracking();

            // Mutate the market in place (the config object is what every reader holds).
            if (next.symbol !== undefined) m.symbol = next.symbol;
            if (next.timeframe !== undefined) m.timeframe = next.timeframe;
            if (next.bars !== undefined) m.bars = next.bars;
            if (next.session !== undefined) m.session = next.session;
            // Carrying the window is not enough — the incoming series must REACH it, or
            // the viewport clamp throws the user somewhere else (sessions cover very
            // different wall-clock spans for the same bar count: an RTH tape reaches
            // ~2.5× further back than ETH). Bar density is at most one per interval, so
            // this count always covers the window's left edge; capped so a view parked
            // years back never triggers a mega-load (the clamp is the honest fallback
            // there). Deepening only — the user's own depth is never shrunk.
            if (carried) {
                const needed = Math.min(Math.ceil((Date.now() - carried.left) / this.barIntervalMs()) + 50, 5000);
                if (needed > (m.bars ?? 500)) m.bars = needed;
            }
            if (next.data !== undefined) m.data = next.data;
            else if (next.symbol !== undefined) delete m.data; // offline → provider switch
            // Consumed by THIS load only (overwritten every switch); a session-only flip
            // re-frames the window the user was looking at.
            m.visibleRange = next.visibleRange ?? (carried ? { from: carried.left, to: carried.right } : undefined);

            // An identity switch blanks the chart NOW: the old market's candles must not sit
            // under the new market's name while its bars load — the loading affordance owns
            // the gap. `load:start` goes out first (with the NEW identity, hence after the
            // config mutation) so plugins hide their own visuals before the blank. A
            // depth-only reload keeps the bars (same market, more history).
            if (identityChanged) {
                this.beginLoad(false);
                this.setBarSeries([], { clearing: true });
                // The active style's DATA ENGINE still rides the old market — its rebuild only
                // follows the load. Silence it for the gap (its live pushes are stale the moment
                // the identity changed) and blank its channels: per-bar payloads are keyed by
                // bucket open-time, so on a same-timeframe switch the old market's cells would
                // land exactly on the new market's first candles.
                if (this.activeEngineStyle) {
                    this.typeEngines.get(this.activeEngineStyle)?.suspend();
                    this.renderer.setNativeData?.(this.activeEngineStyle, undefined);
                    this.renderer.setNativeData?.(`${this.activeEngineStyle}-pending`, []);
                }
            }

            // A DEPTH-ONLY change is an extension, never a reload: the bars on screen are the
            // same series, so the requested history is a superset (growing) or a suffix
            // (shrinking) of what is already loaded. Re-entering the loader would hand the
            // renderer a fresh short head — a shorter, LATER-starting array — which re-frames
            // the viewport and strands every mounted model's anchor behind the new first bar.
            if (depthOnly) {
                this.extendDepth(gen, m.bars ?? 500);
            } else {
                // Reload through the shared pipeline. The race lets a superseded caller resolve
                // promptly (e.g. a parked load on an unresolvable symbol) instead of hanging.
                await Promise.race([
                    this.loadMarket(gen, { firstLoad: false }),
                    new Promise<void>((resolve) => this.supersedeWaiters.push(resolve)),
                ]);
            }
            if (this.generation !== gen) return; // superseded — the newer switch owns the chart
        } finally {
            // A superseding call set its own flag — only the owning generation clears it.
            if (this.generation === gen) this.switchingMarket = false;
        }

        // The carried view's REFINEMENT: the provisional time window framed the first
        // paint, but sessions differ in bar density (~2.5×), so the same wall clock
        // would fatten/thin every candle — a perceived zoom change. Re-derive the
        // window from the bars that actually LOADED: same BAR COUNT on screen (the
        // pixel zoom), the newest visible time as the anchor. Skipped when the old
        // view held no bars (whitespace) — the time window is the only truth there.
        if (carried && carriedCount >= 2 && this.rawBars.length > 0) {
            const bars = this.rawBars;
            let idx = bars.length - 1;
            while (idx > 0 && bars[idx]!.time > carried.right) idx -= 1;
            const from = bars[Math.max(0, idx - (carriedCount - 1))]!.time;
            this.renderer.setVisibleRange({ from, to: Math.max(carried.right, bars[idx]!.time + 1) });
        }

        // Restart every consumer over the new market (records/panes/drawings survive). A
        // depth-only change is NOT a new market: the bars kept their identity and their
        // indices, so tearing the sessions down would recompute everything and flash a
        // stale plot for the whole load. The backfill pokes them per prepend instead —
        // the same path the initial progressive load already uses.
        if (!depthOnly) {
            this.restartNativeIndicators();
            this.restartChartTypeEngine();
            this.reexecuteIndicators();
        }
        this.startLive(); // stopped above on every path, depth-only included
        if (identityChanged) {
            this.events.emit('market:changed', { symbol: m.symbol ?? 'TEST', timeframe: m.timeframe ?? '60', prev });
        }
    }

    /**
     * Restart every native indicator over the new market: a `NativeIndicatorContext`
     * captures symbol/timeframe at start, so the old instance is stopped and a fresh one
     * created from the descriptor — same record, same id, same legend row. Hidden natives
     * are only re-instantiated and marked STALE; showing them starts the fresh instance
     * (a resume() would revive the OLD market's compute).
     */
    private restartNativeIndicators(): void {
        for (const record of this.registry.all()) {
            if (!record.native) continue;
            record.native.instance.stop();
            record.native.instance = record.native.descriptor.create();
            record.pendingStructural = true; // the next emitted model remounts over the old visuals
            if (record.hidden) {
                record.native.stale = true;
            } else {
                const handle = this.handles.get(record.id);
                if (handle) void this.startNativeIndicator(record.id, handle);
            }
        }
    }

    /** Chart-type data engines capture their host (symbol/timeframe) at start — stop them
     *  all on a market switch and rebuild the active style's engine against the new market. */
    private restartChartTypeEngine(): void {
        for (const engine of this.typeEngines.values()) engine.stop();
        this.typeEngines.clear();
        if (this.activeEngineStyle) void this.startChartTypeEngine(this.activeEngineStyle);
    }

    /**
     * The FIRST candles just painted (the quick preview, or the only load): activate the
     * layers that need bars but NOT full history. The volume layer reads the chart's bars
     * each frame and a chart-type data engine follows later chunks/prepends through its own
     * cycle — waiting for the deep chunk (as the end of init() used to) only delayed them.
     */
    private activateBarLayers(): void {
        // Auto-add the built-in volume indicator (default on).
        this.maybeAutoAddVolume();
        // The initial price style may already carry a data requirement (a chart constructed
        // with a chart-type style) — style CHANGES arrive via onPriceStyleChange. Seed
        // ONLY from what the feature reads: a change event may already have set the state
        // (and a renderer without the feature reads undefined) — the seed must never undo it.
    }

    /**
     * A depth-only reconfigure (`setMarket({ bars })` on the same market): move the array's
     * OLDEST edge, never rebuild it. Growing re-enters the same backfill loop the initial load
     * uses, so the extra history arrives as prepends with the viewport preserved; shrinking
     * trims in place. Both keep the newest bars — the viewport is right-anchored, so what the
     * user is looking at does not move, and mounted indicators keep their alignment (the
     * renderer re-derives each model's anchor offset against the new indices, negative when
     * the head moved forward).
     *
     * Sessions are NOT restarted here: the backfill pokes them per prepend (`'backfill'`), and
     * a trim leaves every value they already computed valid.
     */
    private extendDepth(gen: number, requested: number): void {
        if (this.rawBars.length > requested) {
            this.setBarSeries(this.rawBars.slice(this.rawBars.length - requested), { preserveView: true });
            this.completeHistory('depth');
            return;
        }
        if (this.rawBars.length === requested) {
            this.completeHistory('depth');
            return;
        }
        // Detached, exactly like the initial load: `setMarket` resolves on what is already
        // painted while the extra depth streams in behind it.
        this.historyState = 'backfill';
        void this.backfillHistory(gen, requested);
    }

    /**
     * The detached backward backfill: fetch chunks strictly older than the current oldest
     * bar until the requested depth (reason `'depth'`), the source's genesis (`'genesis'` —
     * a chunk added nothing older), or a fetch error (`'aborted'` — the chart keeps what
     * loaded). Runs BEHIND the interactive chart; every prepend keeps the viewport put and
     * pokes the sessions with `'backfill'` so run policy stays with the engines. The
     * generation check after each await abandons the loop when the chart is superseded.
     */
    private async backfillHistory(gen: number, requested: number): Promise<void> {
        try {
            while (this.generation === gen && this.rawBars.length < requested && this.rawBars.length > 0) {
                const remaining = requested - this.rawBars.length;
                // A flat chunk per request: only depths past SINGLE_LOAD_BARS reach this loop,
                // so there is no small near-window to fill quickly — every remaining round trip
                // should carry as much as the source answers well.
                const step = CHUNK_BARS;
                const chunk = await this.feed.loadRange!(this.config.market, {
                    to: this.rawBars[0]!.time, // overlap-by-one: the boundary bar dedupes below
                    limit: Math.min(step, remaining) + 1,
                });
                if (this.generation !== gen) return; // superseded mid-fetch (switch/destroy)
                // Merge against the CURRENT array — live ticks appended during the fetch —
                // keeping only genuinely older bars (the existing boundary bar wins).
                const oldest = this.rawBars[0]!.time;
                const head = chunk.filter((b) => b.time < oldest);
                if (head.length === 0) {
                    this.completeHistory('genesis'); // nothing older exists at the source
                    return;
                }
                for (let i = 1; i < head.length; i += 1) {
                    if (head[i]!.time <= head[i - 1]!.time) {
                        console.warn('[vela] non-monotonic history chunk — stopping the backfill');
                        this.completeHistory('aborted');
                        return;
                    }
                }
                this.setBarSeries([...head, ...this.rawBars], { preserveView: true });
                this.notifySessionsBars('backfill');
                this.events.emit('history:progress', { loaded: this.rawBars.length, target: requested });
            }
            if (this.generation === gen) this.completeHistory('depth');
        } catch (e) {
            console.warn(`[vela] history backfill failed — keeping ${this.rawBars.length} bars (${e instanceof Error ? e.message : String(e)})`);
            if (this.generation === gen) this.completeHistory('aborted');
        }
    }

    /**
     * Mark the history load finished (exactly once): flip the state, fire the sessions'
     * `'complete'` (their held first run executes now — during a non-chunked init no
     * session exists yet, so this is a no-op there), emit the event, resolve the promise.
     */
    private completeHistory(reason: 'depth' | 'genesis' | 'aborted'): void {
        if (this.historyCompleted) return;
        this.historyCompleted = true;
        this.historyState = 'complete';
        this.notifySessionsBars('complete');
        this.events.emit('history:complete', { reason, oldestTime: this.rawBars[0]?.time ?? 0, barsLoaded: this.rawBars.length });
        this.resolveHistoryComplete();
    }

    /** Resolves once the full requested history has loaded (immediately for small/offline charts). */
    historyComplete(): Promise<void> {
        return this.historyCompletePromise;
    }

    /** The primary symbol as the data layer resolves it, or null if no symbol is set. */
    private qualifiedSymbol(): string | null {
        const market = this.config.market;
        if (!market.symbol) return null;
        // The symbol travels BARE. The `provider` option is a preference the feed already applies
        // (it resolves with the chart's provider as first candidate), never a prefix: welding it
        // here made a hard requirement out of it, so metadata and capability probes were aimed at
        // the configured venue even for a symbol only another venue lists — a 502 on the tick-size
        // request and a capability verdict from the wrong venue after every cross-venue switch.
        return market.symbol;
    }

    /** Push the active symbol's tick size to the renderer's price axis. No-op when unknown (formula stays). */
    private refreshPriceFormat(): void {
        if (!this.renderer.setPricePrecision) return;
        const raw = this.feed.symbolInfo?.(this.config.market)?.mintick;
        this.renderer.setPricePrecision(typeof raw === 'number' && raw > 0 ? raw : undefined);
    }

    /** Resolve the symbol's tick size asynchronously (warming the sync cache) and push it once it lands. */
    private async ensurePriceFormat(): Promise<void> {
        if (!this.renderer.setPricePrecision) return;
        const symbol = this.qualifiedSymbol();
        if (!symbol) return;
        try {
            await this.dataControl.symbolInfo(symbol); // warms the sync metadata cache
            this.refreshPriceFormat();
        } catch {
            // metadata unavailable — the renderer keeps its zoom-derived decimals
        }
    }

    /** Auto-add the built-in volume indicator. Bar volume needs no capability probe (always supported). */
    /** The user removed the volume indicator — the auto-add must never override that. */
    private volumeOptedOut = false;

    private maybeAutoAddVolume(): void {
        if (!this.config.volume || this.volumeOptedOut || !this.renderer.setNativeData) return; // off, opted out, or no layer
        if (getNativeIndicator('volume')) this.addNativeIndicator('volume');
    }

    /**
     * React to a price-style change. Two styles carry requirements beyond drawing:
     * a plugin style may need its data engine running, `'heikinashi'` a bar-stream
     * transform. Both syncs are idempotent, so the umbrella just fans out.
     */
    private syncPriceStyle(style: unknown): void {
        if (typeof style === 'string') this.priceStyle = style as PriceStyle;
        this.syncBarTransform(style);
        this.syncChartTypeEngine(style);
    }

    /**
     * Drive a chart type's DATA engine from the price style: entering a style whose
     * registered definition carries `dataEngine` starts (or resumes) that engine; leaving
     * suspends it. Engines are per-chart, created lazily on first entry, and stopped only
     * at destroy — a style flip is a cheap suspend/resume, not a rebuild.
     */
    private syncChartTypeEngine(style: unknown): void {
        const id = typeof style === 'string' ? style : null;
        const def = chartType(id);
        const want = def?.dataEngine ? id : null;
        if (want === this.activeEngineStyle) return;
        if (this.activeEngineStyle) this.typeEngines.get(this.activeEngineStyle)?.suspend();
        this.activeEngineStyle = want;
        if (want) void this.startChartTypeEngine(want);
    }

    /** Start (or resume) the active style's data engine, once bars are loaded. */
    private async startChartTypeEngine(id: string): Promise<void> {
        if (!this.renderer.setNativeData) return; // a renderer without native layers — the style draws plain
        await this.readyPromise;
        if (this.activeEngineStyle !== id) return; // the style left again while loading
        const existing = this.typeEngines.get(id);
        if (existing) {
            existing.resume();
            return;
        }
        const def = chartType(id);
        if (!def?.dataEngine) return;
        const engine = def.dataEngine();
        this.typeEngines.set(id, engine);
        // Seed the stored settings BEFORE start (a pre-start onSettings is pure
        // configuration by contract), so the engine's first fetch already runs on
        // the user's values — never on schema defaults they edited away.
        const stored = this.typeSettings.get(id);
        if (stored) engine.onSettings?.(stored);
        engine.start({
            symbol: this.config.market.symbol ?? 'TEST',
            timeframe: this.config.market.timeframe ?? '60',
            live: this.config.live ?? false,
            session: this.config.market.session,
            bars: () => this.bars,
            data: this.dataControl,
            pushData: (data) => this.renderer.setNativeData?.(id, data),
            pushPending: (ranges) => this.renderer.setNativeData?.(`${id}-pending`, ranges),
        });
    }

    /**
     * Apply (or drop) the style's bar transform. The transform field flips SYNCHRONOUSLY —
     * a pre-load style change is picked up by init's `setBarSeries`. With bars loaded, the
     * view is rebuilt in place (viewport preserved) and every Pine indicator re-executes:
     * its input data changed wholesale, which a streaming session's incremental context
     * cannot absorb. Native indicators need nothing — their layers read the renderer's
     * bars per frame.
     */
    private syncBarTransform(style: unknown): void {
        const transform = barTransformFor(style);
        if (transform === this.barTransform) return; // singletons per style — identity is enough
        this.barTransform = transform;
        if (this.rawBars.length === 0) return;
        this.bars = transform ? transform.full(this.rawBars) : this.rawBars;
        this.renderer.setBars(this.bars, { preserveView: true });
        this.reexecuteIndicators();
    }

    /** Stop + re-run every visible Pine indicator (its input bars changed wholesale). */
    private reexecuteIndicators(): void {
        for (const record of this.registry.all()) {
            if (record.hidden || !record.session) continue;
            record.session.stop();
            record.session = undefined;
            record.pendingStructural = true; // every value changed → full remount, not a patch
            record.pendingCause = 'market';
            this.setLoading(record, true);
            const handle = this.handles.get(record.id);
            if (handle) this.executeIndicator(record.id, handle);
        }
    }

        private onBar(bar: OHLCV): void {
        if (this.healing) {
            this.healBuffer.push(bar); // replayed once the backfill lands (ordering preserved)
            return;
        }
        // Continuity check: a bar far ahead of the last one means live updates were MISSED —
        // browsers throttle timers in hidden tabs (and can freeze sockets), so bars close unseen
        // and the poll/stream only ever carries the newest one. Backfill the hole through the
        // feed's ranged fetch instead of pushing a discontinuous bar. Provider-agnostic: every
        // provider serves `getBars({ from })`. Within the cooldown a discontinuity is accepted
        // as a real market gap (an empty interval on an illiquid symbol) — no refetch loop.
        const last = this.rawBars[this.rawBars.length - 1];
        if (
            last && this.canHeal() &&
            bar.time > last.time + this.barIntervalMs() * GAP_FACTOR &&
            Date.now() - this.lastHealAt > HEAL_COOLDOWN_MS
        ) {
            this.healBuffer.push(bar);
            void this.healGap(last.time);
            return;
        }
        this.applyBar(bar);
    }

    /**
     * THE outbound bar seam for a full series load: store the raw series, derive the view
     * (identity when no transform), and hand the view to the renderer. Everything downstream
     * (engines via `getBars`, natives, visible-range presets) reads `this.bars` — the view.
     */
    private setBarSeries(raw: OHLCV[], opts?: { preserveView?: boolean; clearing?: boolean }): void {
        this.rawBars = raw;
        this.bars = this.barTransform ? this.barTransform.full(raw) : raw;
        this.renderer.setBars(this.bars, { preserveView: opts?.preserveView });
        // The first PAINTED batch ends the loading state — on a deep history that is the quick
        // preview, well before the load pipeline completes. Only a non-empty series counts: the
        // switch-time CLEARING call says so explicitly, and an empty COMPLETED load is closed
        // by loadMarket's finally instead (a style re-derivation over empty bars mid-load must
        // not end a load still in flight).
        if (!opts?.clearing && this.bars.length > 0) this.endLoad();
    }

    /**
     * Reconcile one live bar into the canonical array + renderer (no gap detection). The raw
     * bar lands in {@link rawBars}; the VIEW bar is derived incrementally (a transform needs
     * only the previous view bar — O(1) per tick) and index-stays aligned with the raw series.
     * The `'bar'` event carries the RAW bar (a data event, not a display event). `notify`
     * signals the indicator sessions too — a heal passes false and notifies ONCE for the whole
     * batch instead (a session re-run is a full re-execution over the canonical array, so per-bar
     * notifications during a backfill are pure waste).
     */
    private applyBar(bar: OHLCV, notify = true): void {
        const last = this.rawBars[this.rawBars.length - 1];
        let viewBar = bar;
        if (last && bar.time === last.time) {
            this.rawBars[this.rawBars.length - 1] = bar;
            // The forming candle refined — its values are still provisional.
            this.barCause = 'tick';
            if (this.barTransform) {
                // Replacing the FORMING bar: the previous view bar is the one BEFORE it.
                viewBar = this.barTransform.next(bar, this.bars[this.bars.length - 2]);
                this.bars[this.bars.length - 1] = viewBar;
            }
        } else if (!last || bar.time > last.time) {
            this.rawBars.push(bar);
            // A new bar opened, so the one before it is now FINAL — the distinction
            // `script:run` carries as `cause: 'bar'`.
            this.barCause = 'bar';
            if (this.barTransform) {
                viewBar = this.barTransform.next(bar, this.bars[this.bars.length - 1]);
                this.bars.push(viewBar);
            }
        } else return;

        this.renderer.updateBar(viewBar);
        this.events.emit('bar', bar);
        // During a backfill a tick is tagged 'backfill' too — policy-A sessions hold their
        // run either way, and the eventual 'complete' run reads the tick from the array.
        if (notify) this.notifySessionsBars(this.historyState === 'backfill' ? 'backfill' : undefined);
    }

    /**
     * Signal every live session that the bars changed: streamed sessions markDirty (re-execute
     * the forming bar), static-live sessions (visible-range scripts) full-re-run with the new
     * tail. Both value-patch the result. The reason travels to the ENGINE (which owns run
     * policy): no reason = live tick, `'backfill'`/`'complete'` bracket a history backfill.
     */
    private notifySessionsBars(reason?: BarsChangeReason): void {
        if (this.switchingMarket) return; // old sessions must not run over the incoming market's bars
        // A backfill chunk (or the run released by its completion) is still the script's
        // FIRST look at the history, whichever bar arrived last.
        const cause: ScriptRunCause = reason ? 'history' : this.barCause;
        for (const record of this.registry.all()) {
            if (!record.renderHandle || record.hidden) continue;
            if (record.session) {
                record.pendingCause = cause;
                record.session.notifyBars(reason);
            } else if (record.native) record.native.instance.onBars();
        }
    }

    /** Gap healing needs a ranged feed and a provider-backed series (offline `data` has no source). */
    private canHeal(): boolean {
        return !!this.feed.loadRange && !this.config.market.data?.length;
    }

    /** Duration of one chart bar in ms (for live-bar continuity checks). */
    private barIntervalMs(): number {
        return timeframeToMs(this.config.market.timeframe ?? '60');
    }

    /**
     * Backfill missed live bars: re-fetch from the LAST KNOWN bar's open time (so its stale
     * mid-formation close is corrected too) through "now", and replay the result — plus any live
     * ticks that arrived during the fetch — through the normal reconciler. Heals every miss cause
     * the same way: background-tab throttling, socket reconnects, system sleep, network blips.
     */
    private async healGap(fromMs: number): Promise<void> {
        const gen = this.generation;
        this.healing = true;
        this.lastHealAt = Date.now();
        try {
            const bars = await this.feed.loadRange!(this.config.market, { from: fromMs });
            if (this.generation !== gen) return; // market switched / chart destroyed mid-heal — drop the stale bars
            for (const b of bars) this.applyBar(b, false);
        } catch {
            // transient — the buffered ticks still apply; a later discontinuity re-triggers the heal
        } finally {
            // A superseded heal leaves the state alone: setMarket/destroy already reset it,
            // and replaying its buffer would push the OLD market's bars into the new array.
            if (this.generation === gen) {
                this.healing = false;
                const pending = this.healBuffer;
                this.healBuffer = [];
                for (const b of pending) this.applyBar(b, false);
                // ONE session notification for the whole heal: bars applied per-bar above (renderer +
                // 'bar' events keep their per-bar granularity), but the engines re-execute just once.
                this.notifySessionsBars(this.historyState === 'backfill' ? 'backfill' : undefined);
            }
        }
    }

    /**
     * Register a scripting engine for a language. Last registration wins:
     * re-registering replaces the engine (with a dev-console warning). Running
     * indicators keep the engine they were started with — only later addIndicator
     * calls use the replacement, so a swap never disrupts live work.
     */
    registerEngine(language: string, engine: ScriptingEngine): void {
        const existing = this.engines.get(language);
        if (existing && existing !== engine) {
            console.warn(
                `[vela] re-registering scripting engine for language "${language}"; ` +
                    `replacing ${existing.constructor.name} with ${engine.constructor.name}.`,
            );
        }
        this.engines.set(language, engine);
    }

    addIndicator(source: string, options: AddIndicatorOptions = {}): IndicatorHandle {
        const id = this.registry.nextId();
        const title = options.title ?? 'Indicator';
        const handle = new IndicatorHandleImpl(id, title, this, source);
        this.handles.set(id, handle);
        this.registry.add({ id, title, source, options, inputValues: { ...(options.inputs ?? {}) }, propValues: { ...(options.props ?? {}) } });
        void this.startIndicator(id, source, options, handle);
        return handle;
    }

    /**
     * Add a NATIVE (core-computed, no Pine engine) indicator by registered type — a first-class
     * indicator that shares the registry, handle, legend, settings, and lifecycle events. SINGLE
     * INSTANCE per type: a second add returns the existing handle. Unknown type ⇒ a fail-soft handle
     * that never mounts (mirrors addIndicator). Built-in types: `'volume'`, `'vpvr'`.
     */
    addNativeIndicator(type: string, options: { inputs?: Record<string, InputValue> } = {}): IndicatorHandle {
        const existing = this.registry.all().find((r) => r.native?.type === type);
        if (existing) return this.handles.get(existing.id) ?? new IndicatorHandleImpl(existing.id, existing.title, this);

        const descriptor = getNativeIndicator(type);
        const id = this.registry.nextId('native');
        const title = descriptor?.title ?? type;
        const handle = new IndicatorHandleImpl(id, title, this);
        this.handles.set(id, handle);
        if (!descriptor) {
            console.warn(`[vela] addNativeIndicator("${type}") — no native indicator registered for this type.`);
            return handle;
        }
        const inputValues = { ...descriptor.defaultInputs(), ...(options.inputs ?? {}) };
        this.registry.add({ id, title, source: type, inputValues, propValues: {}, native: { type, instance: descriptor.create(), descriptor } });
        handle.setSchema(descriptor.inputsSchema());
        void this.startNativeIndicator(id, handle);
        return handle;
    }

    /**
     * The catalog of registered native-indicator types with their live state on THIS chart: each
     * entry's `supported` (applies to the current symbol) and `present` (already added — a second
     * add is a no-op). Powers a host "add native indicator" menu that can gate + de-duplicate. Async
     * because a descriptor's `isSupported` may probe the provider for a required capability.
     */
    /** The native types present on the chart — SYNC (registry state; no support probe). */
    presentNativeIndicators(): string[] {
        return this.registry
            .all()
            .map((r) => r.native?.type)
            .filter((t): t is string => !!t);
    }

    async availableNativeIndicators(): Promise<NativeIndicatorInfo[]> {
        const symbol = this.qualifiedSymbol();
        const present = new Set(this.presentNativeIndicators());
        return Promise.all(
            nativeIndicatorDescriptors().map(async (d) => ({
                type: d.type,
                title: d.title,
                supported: await this.isNativeSupported(d, symbol),
                present: present.has(d.type),
                beta: d.beta,
            })),
        );
    }

    /**
     * Resolve a descriptor's support for the current symbol: no `isSupported` ⇒ always supported;
     * an `isSupported` but no symbol set ⇒ can't decide, treat as unsupported; a throw ⇒ unsupported.
     */
    private async isNativeSupported(descriptor: { isSupported?(symbol: string, data: DataControl): boolean | Promise<boolean> }, symbol: string | null): Promise<boolean> {
        if (!descriptor.isSupported) return true;
        if (!symbol) return false;
        try {
            return await descriptor.isSupported(symbol, this.dataControl);
        } catch {
            return false;
        }
    }

    /** IndicatorController: re-run an indicator with merged input overrides (Pine session OR native instance). */
    applyInputs(id: string, values: Record<string, InputValue>): void {
        const record = this.registry.get(id);
        if (!record || (!record.session && !record.native)) return;
        record.inputValues = { ...record.inputValues, ...values };
        // Reflect the new value in the open dialog immediately (the model arrives async).
        if (record.renderHandle) this.renderer.setIndicatorInputs(record.renderHandle, record.inputValues);
        // The next emitted model structurally remounts (input changes can restructure).
        record.pendingStructural = true;
        // Spinner during the re-compute (Pine only — native indicators drive their own status).
        if (!record.hidden && !record.native) this.setLoading(record, true);
        record.pendingCause = 'inputs';
        if (record.session) record.session.update(record.inputValues);
        else if (record.native && !record.hidden) record.native.instance.setInputs(record.inputValues);
        this.events.emit('indicator:inputs', { id });
    }

    /** IndicatorController: the CURRENT stored input values (defaults merged with edits). */
    inputValuesOf(id: string): Record<string, InputValue> {
        return { ...this.registry.get(id)?.inputValues };
    }

    /** IndicatorController: the CURRENT declaration-prop overrides. */
    propValuesOf(id: string): Record<string, InputValue> {
        return { ...this.registry.get(id)?.propValues };
    }

    /** IndicatorController: re-run an indicator with merged declaration-prop overrides.
     *  Same lifecycle as {@link applyInputs} — a prop change replays the whole script.
     *  Script indicators only: natives have no declaration props. */
    applyProps(id: string, values: Record<string, InputValue>): void {
        const record = this.registry.get(id);
        if (!record?.session) return;
        record.propValues = { ...record.propValues, ...values };
        // Reflect the new value in the open dialog immediately (the model arrives async).
        if (record.renderHandle) this.renderer.setIndicatorInputs(record.renderHandle, record.inputValues, record.propValues);
        record.pendingStructural = true;
        if (!record.hidden) this.setLoading(record, true);
        record.pendingCause = 'inputs';
        record.session.update(record.inputValues, record.propValues);
        this.events.emit('indicator:inputs', { id });
    }

    /** IndicatorController: tear down an indicator and (if now empty) its pane. */
    /** Live handles of every indicator on the chart (script + native), insertion order. */
    listIndicators(): IndicatorHandle[] {
        return [...this.handles.values()];
    }

    /** Read-only engine-context snapshot for one indicator (null: no capability / not run). */
    getIndicatorContext(id: string, select?: ContextSelect): Promise<EngineContextSnapshot | null> {
        const session = this.registry.get(id)?.session;
        return session?.getContext?.(select) ?? Promise.resolve(null);
    }

    removeIndicator(id: string): void {
        const record = this.registry.remove(id);
        // Removing the auto-added volume is a USER decision — make it stick: the
        // auto-add fires on every load (first paint of every market), so without the
        // opt-out a removed volume resurrected on the next symbol/timeframe switch.
        if (record?.native?.type === 'volume') this.volumeOptedOut = true;
        record?.session?.stop();
        record?.native?.instance.stop();
        this.handles.delete(id);
        if (record?.renderHandle) this.renderer.removeIndicator(record.renderHandle);
        const paneId = record?.model?.paneId;
        // A pane can now hold several indicators — only drop it when the last one leaves.
        if (paneId && paneId !== 'price' && !this.paneStillUsed(paneId)) {
            this.renderer.removePane(paneId);
            this.forgetPane(paneId);
            this.events.emit('pane:changed', undefined);
        }
        this.events.emit('indicator:removed', { id });
    }

    /**
     * IndicatorController: hide or show an indicator. Hiding **suspends** it — a Pine indicator's
     * session is stopped (and a native instance suspended), so it's never poked on bar/viewport/input
     * and consumes no resources, while the renderer drops its visuals and keeps the legend row marked
     * hidden. Showing resumes: a Pine indicator re-executes (cached prepared), a native instance
     * resumes + re-emits. Visuals were dropped on hide, so the next model re-mounts.
     */
    setVisible(id: string, visible: boolean): void {
        const record = this.registry.get(id);
        if (!record || record.hidden === !visible) return;
        record.hidden = !visible;
        this.handles.get(id)?.setVisibleState(visible);
        if (!visible) {
            record.session?.stop();
            record.session = undefined;
            record.native?.instance.suspend();
            if (record.renderHandle) this.renderer.setIndicatorVisible?.(record.renderHandle, false);
        } else {
            if (record.renderHandle) this.renderer.setIndicatorVisible?.(record.renderHandle, true);
            record.pendingStructural = true; // visuals dropped on hide → next model re-mounts
            if (record.native) {
                if (record.native.stale) {
                    // The instance was re-created for a NEW market while hidden — resume()
                    // would revive the old market's compute; start the fresh instance instead.
                    record.native.stale = false;
                    const handle = this.handles.get(id);
                    if (handle) void this.startNativeIndicator(id, handle);
                } else {
                    record.native.instance.resume();
                }
            } else {
                this.setLoading(record, true); // spinner on the kept legend row while re-executing
                const handle = this.handles.get(id);
                if (handle) this.executeIndicator(id, handle);
            }
        }
        // Announce the change so host UIs (object tree, custom legends) reflect the new
        // eye/dim state immediately — the toggle can come from the in-chart legend, so a
        // tree that only re-renders on its own actions would otherwise lag until a poll.
        this.events.emit('indicator:visibility', { id, visible });
    }

    ready(): Promise<void> {
        return this.readyPromise;
    }

    /** A renderer-agnostic snapshot of the graphic elements generated so far (the deterministic oracle signal). */
    inspect(): SceneInspection {
        // Native indicators sort to the top of the list (stable otherwise). A record still
        // loading holds only its legend placeholder — it has generated nothing yet, so skip it.
        const records = [...this.registry.all()].filter((r) => !r.loading).sort((a, b) => (b.native ? 1 : 0) - (a.native ? 1 : 0));
        return inspectModels(records.map((r) => r.model).filter((m): m is IndicatorModel => m != null));
    }

    resize(): void {
        this.renderer.resize();
    }

    /**
     * Swap the app theme live: re-skins the renderer (surfaces, axes, legends, in-chart
     * chrome) and emits `theme:changed` so host chrome around the chart follows. No-ops
     * when the resolved theme is already active — which also breaks the echo when a host
     * reacts to `theme:changed` by calling back into `setTheme`.
     */
    setTheme(theme: VelaTheme): void {
        const cur = this.config.theme;
        if ((Object.keys(theme) as Array<keyof VelaTheme>).every((k) => theme[k] === cur[k])) return;
        this.config.theme = theme;
        this.renderer.setTheme(theme);
        this.events.emit('theme:changed', theme);
    }

    /** The current visible time range (left/right bar times), or null before data loads. */
    getVisibleRange(): VisibleRange | null {
        return this.renderer.getVisibleRange();
    }

    /** Set the visible time range explicitly (epoch-ms `from`/`to`). */
    setVisibleRange(range: VisibleRange): void {
        this.renderer.setVisibleRange(range);
    }

    /** Pan by a fraction of the visible width (positive ⇒ toward the latest bars).
     *  Prefers the renderer's drag-equivalent pan; falls back to an instant shift of
     *  the visible range for renderers without one. */
    panBy(fraction: number): void {
        if (this.renderer.panBy) {
            this.renderer.panBy(fraction);
            return;
        }
        const r = this.renderer.getVisibleRange();
        if (!r) return;
        const delta = (r.to - r.from) * fraction;
        this.renderer.setVisibleRange({ from: r.from + delta, to: r.to + delta });
    }

    /** Frame a named preset (e.g. `'1M'`, `'YTD'`, `'ALL'`) over the loaded bars. */
    setVisibleRangePreset(preset: VisibleRangePreset): void {
        const range = presetToRange(preset, this.bars);
        if (range) this.renderer.setVisibleRange(range);
    }

    destroy(): void {
        this.bumpGeneration(); // abandon backfill loops/loads mid-flight + release superseded setMarket awaiters
        this.resolveHistoryComplete(); // never leave historyComplete() awaiters hanging
        this.stopLive();
        if (this.viewportTimer != null) clearTimeout(this.viewportTimer);
        this.viewportUnsub?.();
        this.paneActionUnsub?.();
        // native instances free their own caches/timers in stop()
        for (const record of this.registry.all()) { record.session?.stop(); record.native?.instance.stop(); }
        for (const engine of this.typeEngines.values()) engine.stop(); // chart-type data engines (SDK)
        this.typeEngines.clear();
        this.activeEngineStyle = null;
        this.unresolvedUnsub?.();
        this.unresolvedUnsub = null;
        this.feed.destroy?.(); // parked waits would otherwise outlive the chart
        this.drawings.destroy();
        this.renderer.destroy();
        this.events.clear();
    }

    // ── internals ───────────────────────────────────────────────

    private async startIndicator(id: string, source: string, options: AddIndicatorOptions, handle: IndicatorHandleImpl): Promise<void> {
        try {
            await this.readyPromise;
            if (!this.registry.get(id)) return;

            // Let the renderer paint the post-fetch frame (e.g. the "Running…" status)
            // before the engine's synchronous transpile + execution monopolizes the
            // main thread — otherwise the UI stays frozen on the pre-execution frame
            // for the whole run.
            await yieldToPaint();
            const record = this.registry.get(id);
            if (!record) return; // removed during the yield

            const engine = this.engineFor(options.language);
            record.engine = engine;

            const prepared = await engine.prepare(source, id);
            record.prepared = prepared;
            const defaults: Record<string, InputValue> = {};
            for (const input of prepared.inputs) defaults[input.key] = input.defval;
            record.inputValues = { ...defaults, ...record.inputValues };
            handle.setSchema(prepared.inputs);
            const propDefaults: Record<string, InputValue> = {};
            for (const prop of prepared.props ?? []) propDefaults[prop.key] = prop.defval;
            record.propValues = { ...propDefaults, ...record.propValues };
            handle.setPropsSchema(prepared.props ?? []);

            // Mount a legend-only placeholder BEFORE the (possibly long) execution, so
            // the indicator appears immediately with a loading spinner instead of the
            // UI staying blank until the first computed model lands.
            this.mountLoadingPlaceholder(id, record);
            this.executeIndicator(id, handle);
        } catch (err) {
            this.fail(id, handle, err);
        }
    }

    /**
     * Start (or restart) the engine session for an already-prepared indicator and route its
     * models to {@link applyModel}. Used by the initial run and by {@link setVisible} on show.
     * No-op while the indicator is hidden — a hidden indicator must not hold a live session.
     */
    private executeIndicator(id: string, handle: IndicatorHandleImpl): void {
        const record = this.registry.get(id);
        if (!record || !record.engine || !record.prepared || record.hidden) return;
        // Stream only when the chart is live, the script is NOT viewport-dependent, and the
        // engine can stream. Viewport scripts + non-streaming engines take the static path.
        const mode: 'static' | 'live' =
            this.config.live && !record.prepared.reactsToViewport && record.engine.capabilities.streaming ? 'live' : 'static';
        record.session = record.engine.execute(
            {
                prepared: record.prepared,
                market: this.market(),
                bars: this.bars,
                getBars: () => this.bars,
                fetchSeries: (sym, tf, range) => this.fetchSeries(sym, tf, range),
                inputs: record.inputValues,
                props: record.propValues,
                visibleRange: this.currentVisibleRange(),
                mode,
                // Mid-backfill session starts (add / re-show / price-style re-execute) let the
                // ENGINE decide whether to run now or hold for the 'complete' notification.
                historyState: this.historyState,
            },
            {
                onModel: (model) => {
                    // Read BEFORE applyModel: it is what announces the indicator, and the
                    // consumed cause must not leak into the next model.
                    const first = !record.announced;
                    const cause = record.pendingCause ?? 'history';
                    // A deferred (output-free while loading) model counts as no run at all:
                    // the pending cause stays for the real run, and no events fire.
                    if (!this.applyModel(id, model)) return;
                    record.pendingCause = undefined;
                    this.emitContextChanged(id); // throttled — streamed ticks collapse to ~1/s
                    this.emitScriptRun(id, cause, first);
                },
                onAlert: (a) => {
                    // The chart-level event names its source — the indicator's effective
                    // display title (host override, else the script's own; the same rule
                    // the legend announce uses) — hosts render alerts from many
                    // indicators on one surface (the shells' bell menu).
                    const indicator = record.options?.title ?? record.prepared?.meta.title ?? record.title;
                    this.events.emit('alert', { ...a, indicator });
                    handle.emit('alert', { id: a.id, message: a.message, title: a.title, time: a.time });
                },
                onWarning: (w) => this.events.emit('warning', w),
                onError: (err) => this.fail(id, handle, err),
            },
        );
        // A synchronous engine can emit its model DURING the execute call above — before
        // record.session exists, so the gated emit inside onModel missed. Fire once now
        // that the session (and its optional getContext) is attached; throttling dedupes.
        this.emitContextChanged(id);
    }

    /**
     * Start a native indicator's compute (after first bars are loaded). It pushes its visuals via
     * `ctx.emit`, which the orchestrator wraps into a full {@link IndicatorModel} and routes through
     * the SAME {@link applyModel} mount/patch path as a Pine indicator — so the legend, pane routing,
     * settings dialog, and events all come for free. No engine, no `prepared`, no `session`.
     */
    private async startNativeIndicator(id: string, handle: IndicatorHandleImpl): Promise<void> {
        try {
            await this.readyPromise;
            const record = this.registry.get(id);
            if (!record?.native || record.hidden) return; // removed/hidden during the await
            const ctx: NativeIndicatorContext = {
                symbol: this.config.market.symbol ?? 'TEST',
                timeframe: this.config.market.timeframe ?? '60',
                live: this.config.live,
                session: this.config.market.session,
                bars: () => this.bars,
                data: this.dataControl,
                emit: (out) => this.applyModel(id, this.buildNativeModel(record, out)),
                pushData: (data) => this.renderer.setNativeData?.(record.native!.type, data),
                setStatus: (status) => { if (record.renderHandle && !record.hidden) this.renderer.setIndicatorStatus?.(record.renderHandle, status); },
            };
            record.native.instance.start(ctx, record.inputValues);
        } catch (err) {
            this.fail(id, handle, err);
        }
    }

    /** Wrap a native indicator's emitted visuals into a full IndicatorModel, tagged `native`. */
    private buildNativeModel(record: IndicatorRecord, out: NativeIndicatorOutput): IndicatorModel {
        const d = record.native!.descriptor;
        return {
            id: record.id,
            title: record.title,
            ...(d.shortTitle ? { shorttitle: d.shortTitle } : {}),
            overlay: d.overlay,
            paneHint: d.paneHint,
            native: { type: record.native!.type },
            ...(out.paneAxis != null ? { paneAxis: out.paneAxis } : {}),
            series: out.series ?? [],
            fills: out.fills ?? [],
            backgrounds: out.backgrounds ?? [],
            priceLines: out.priceLines ?? [],
            ...(out.lines ? { lines: out.lines } : {}),
            ...(out.boxes ? { boxes: out.boxes } : {}),
            ...(out.labels ? { labels: out.labels } : {}),
            ...(out.polylines ? { polylines: out.polylines } : {}),
            ...(out.linefills ? { linefills: out.linefills } : {}),
            ...(out.tables ? { tables: out.tables } : {}),
            inputs: d.inputsSchema(),
            inputValues: record.inputValues,
        };
    }

    /**
     * Mount an EMPTY model for a just-prepared Pine indicator: the legend row (title,
     * gear, eye, ✕ — all functional) and its routed pane appear immediately with a
     * loading spinner, while the engine computes. The first computed model remounts
     * over it in place (`pendingStructural`), clears the spinner, and only THEN fires
     * `indicator:added`/`ready` — so event semantics and `inspect()` (which skips
     * loading records) still mean "the indicator produced output".
     */
    private mountLoadingPlaceholder(id: string, record: IndicatorRecord): void {
        if (record.renderHandle || record.hidden || !record.prepared) return;
        const meta = record.prepared.meta;
        const model: IndicatorModel = {
            id,
            // Deliberately the FULL title, never a shorttitle: while the script loads the
            // legend identifies it by its full name; the compact shorttitle arrives with
            // the first computed model and takes over from there.
            title: record.options?.title ?? meta.title,
            overlay: meta.overlay,
            paneHint: meta.overlay ? 'price' : 'new',
            series: [],
            fills: [],
            backgrounds: [],
            priceLines: [],
            inputs: record.prepared.inputs,
            inputValues: record.inputValues,
            ...(record.prepared.props ? { props: record.prepared.props, propValues: record.propValues } : {}),
        };
        const paneId = this.routePane(id, model, record.options ?? {});
        this.placeModel(model, id, paneId);
        record.model = model; // keeps pane routing + remove-time pane cleanup consistent
        this.ensurePaneFor(paneId);
        record.renderHandle = this.renderer.mountIndicator(model);
        record.pendingStructural = true; // the first computed model remounts over the placeholder
        this.setLoading(record, true);
    }

    /** Flip the record's loading state and reflect it in the legend row (spinner on/off). */
    private setLoading(record: IndicatorRecord, loading: boolean): void {
        record.loading = loading;
        if (record.renderHandle && !record.hidden) this.renderer.setIndicatorStatus?.(record.renderHandle, loading ? 'loading' : 'idle');
    }

    private ensurePaneFor(paneId: string): void {
        if (!this.paneOrder.includes(paneId)) this.paneOrder.push(paneId);
        this.renderer.ensurePane({
            id: paneId,
            kind: paneId === 'price' ? 'price' : 'study',
            order: this.paneOrder.indexOf(paneId),
        });
    }

    /** True when any (still-registered) indicator sits on the given pane. */
    private paneStillUsed(paneId: string): boolean {
        for (const r of this.registry.all()) if (r.model?.paneId === paneId) return true;
        return false;
    }

    /** Drop a now-empty pane from the order + collapse/maximize mirror. */
    private forgetPane(paneId: string): void {
        const i = this.paneOrder.indexOf(paneId);
        if (i > 0) this.paneOrder.splice(i, 1); // never remove 'price' (index 0)
        this.collapsedPanes.delete(paneId);
        if (this.maximizedPaneId === paneId) this.maximizedPaneId = null;
    }

    // ── pane management (PaneController — backs chart.panes) ──────

    paneManagementSupported(): boolean {
        return this.renderer.capabilities.paneManagement === true && typeof this.renderer.setIndicatorPane === 'function';
    }

    listPanes(): PaneInfo[] {
        const byPane = new Map<string, PaneInfo['indicators']>();
        for (const r of this.registry.all()) {
            const model = r.model;
            if (!model) continue;
            const paneId = model.paneId ?? 'price';
            if (!byPane.has(paneId)) byPane.set(paneId, []);
            byPane.get(paneId)!.push({ id: r.id, title: model.title || r.title, ownScale: model.ownScale === true });
        }
        const panes: PaneInfo[] = [];
        for (const paneId of this.paneOrder) {
            // The price pane always shows; a study pane only while it holds indicators.
            if (paneId !== 'price' && !byPane.has(paneId)) continue;
            panes.push({
                id: paneId,
                kind: paneId === 'price' ? 'price' : 'study',
                order: panes.length,
                collapsed: this.collapsedPanes.has(paneId),
                maximized: this.maximizedPaneId === paneId,
                indicators: byPane.get(paneId) ?? [],
            });
        }
        return panes;
    }

    movePane(paneId: string, dir: 'up' | 'down'): void {
        if (paneId === 'price') return; // price stays pinned on top
        const existing = this.existingPaneIds();
        const i = existing.indexOf(paneId);
        if (i < 0) return;
        const j = dir === 'up' ? i - 1 : i + 1;
        // Never move above the price pane (index 0) or past the last pane.
        if (j <= 0 || j >= existing.length) return;
        [existing[i], existing[j]] = [existing[j]!, existing[i]!];
        this.reorderPanes(existing);
        this.events.emit('pane:moved', { paneId, dir });
    }

    removePaneAndIndicators(paneId: string): void {
        if (paneId === 'price') return;
        for (const r of [...this.registry.all()]) if (r.model?.paneId === paneId) this.removeIndicator(r.id);
    }

    collapsePane(paneId: string, collapsed: boolean): void {
        if (collapsed) this.collapsedPanes.add(paneId);
        else this.collapsedPanes.delete(paneId);
        this.renderer.setPaneCollapsed?.(paneId, collapsed);
        this.events.emit('pane:changed', undefined);
    }

    maximizePane(paneId: string | null): void {
        this.maximizedPaneId = paneId;
        this.renderer.setPaneMaximized?.(paneId);
        this.events.emit('pane:changed', undefined);
    }

    /** IndicatorController/PaneController: move (or merge) an indicator to another pane. */
    moveIndicator(id: string, target: MoveTarget): void {
        if (!this.paneManagementSupported() || !this.renderer.setIndicatorPane) {
            console.warn('[vela] the active renderer does not support moving indicators between panes.');
            return;
        }
        const record = this.registry.get(id);
        if (!record?.renderHandle || !record.model) return;
        const model = record.model;
        const oldPaneId = model.paneId ?? 'price';
        const resolved = this.resolveMoveTarget(id, model, target);
        if (!resolved) return;
        const { paneId, ownScale, insert } = resolved;
        if (paneId === oldPaneId && (model.ownScale === true) === ownScale) return; // no-op

        if (insert) this.insertPaneOrder(paneId, insert);
        else if (!this.paneOrder.includes(paneId)) this.paneOrder.push(paneId);

        model.ownScale = ownScale;
        record.paneLocked = true; // recomputes must honor this placement, not re-route by default
        this.placeModel(model, id, paneId);
        this.ensurePaneFor(paneId);
        this.renderer.setIndicatorPane(record.renderHandle, paneId, { ownScale });

        if (oldPaneId !== 'price' && oldPaneId !== paneId && !this.paneStillUsed(oldPaneId)) {
            this.renderer.removePane(oldPaneId);
            this.forgetPane(oldPaneId);
        }
        this.reorderPanes(this.existingPaneIds());
        this.events.emit('indicator:moved', { id, paneId });
        this.events.emit('pane:changed', undefined);
    }

    /** Resolve a move target to a concrete pane id + own-scale flag + optional insertion. */
    private resolveMoveTarget(
        id: string,
        model: IndicatorModel,
        target: MoveTarget,
    ): { paneId: string; ownScale: boolean; insert?: { before?: string; after?: string } } | null {
        if (target === 'price' || (typeof target === 'object' && 'pane' in target && target.pane === 'price')) {
            // Merge onto price: a price-unit overlay (declared overlay=true) keeps sharing the
            // price scale; anything else gets its own scale column.
            return { paneId: 'price', ownScale: !model.overlay };
        }
        if ('pane' in target) {
            if (!this.existingPaneIds().includes(target.pane)) return null;
            return { paneId: target.pane, ownScale: true };
        }
        // A brand-new pane: the indicator owns it (shares its scale with itself → no own-scale column).
        // The natural name `pane-${id}` collides with this indicator's OWN pane when it is the
        // master (that pane was seeded from its id), which the move's no-op guard would then reject —
        // so pick an id distinct from both the current pane and every existing pane.
        const spec = target.newPane === true ? {} : target.newPane;
        return { paneId: this.freshPaneId(id, model.paneId ?? 'price'), ownScale: false, insert: spec };
    }

    /** A study-pane id unique among existing panes and distinct from `avoid` (the indicator's current pane). */
    private freshPaneId(id: string, avoid: string): string {
        const taken = new Set(this.existingPaneIds());
        let paneId = `pane-${id}`;
        for (let n = 2; paneId === avoid || taken.has(paneId); n += 1) paneId = `pane-${id}-${n}`;
        return paneId;
    }

    /** Splice a pane id into the order relative to a neighbor (default: bottom). */
    private insertPaneOrder(paneId: string, at: { before?: string; after?: string }): void {
        const i = this.paneOrder.indexOf(paneId);
        if (i > 0) this.paneOrder.splice(i, 1);
        let idx = this.paneOrder.length;
        if (at.before && this.paneOrder.includes(at.before)) idx = this.paneOrder.indexOf(at.before);
        else if (at.after && this.paneOrder.includes(at.after)) idx = this.paneOrder.indexOf(at.after) + 1;
        if (idx < 1) idx = 1; // never above the price pane
        this.paneOrder.splice(idx, 0, paneId);
    }

    /** Pane ids that currently exist (price + study panes holding ≥1 indicator), in order. */
    private existingPaneIds(): string[] {
        return this.paneOrder.filter((p) => p === 'price' || this.paneStillUsed(p));
    }

    /** Apply a new pane order to the mirror + renderer. */
    private reorderPanes(order: string[]): void {
        this.paneOrder.length = 0;
        this.paneOrder.push(...order);
        this.renderer.orderPanes?.(order);
        this.events.emit('pane:changed', undefined);
    }

    /** React to a renderer-initiated pane action (hover buttons / double-clicks). */
    private handlePaneAction(a: PaneAction): void {
        switch (a.type) {
            case 'remove':
                this.removePaneAndIndicators(a.paneId);
                break;
            case 'move': {
                // The renderer already reordered — mirror it (swap with the neighbor).
                const existing = this.existingPaneIds();
                const i = existing.indexOf(a.paneId);
                const j = a.dir === 'up' ? i - 1 : i + 1;
                if (i > 0 && j > 0 && j < existing.length) {
                    [existing[i], existing[j]] = [existing[j]!, existing[i]!];
                    this.paneOrder.length = 0;
                    this.paneOrder.push(...existing);
                    this.events.emit('pane:changed', undefined);
                    this.events.emit('pane:moved', { paneId: a.paneId, dir: a.dir });
                }
                break;
            }
            case 'collapse':
                if (a.collapsed) this.collapsedPanes.add(a.paneId);
                else this.collapsedPanes.delete(a.paneId);
                this.events.emit('pane:changed', undefined);
                break;
            case 'maximize':
                this.maximizedPaneId = a.maximized ? a.paneId : null;
                this.events.emit('pane:changed', undefined);
                break;
        }
    }

    /** Fire `indicator:added` + the handle's `ready` once, on the first computed model. */
    private announce(record: IndicatorRecord, handle: IndicatorHandleImpl | undefined): void {
        if (record.announced) return;
        record.announced = true;
        this.events.emit('indicator:added', { id: record.id });
        this.emitContextChanged(record.id);
        handle?.emit('ready', undefined);
    }

    /**
     * Apply an emitted model. First emission mounts (and routes the pane); a pending
     * structural change (after an input edit) remounts idempotently; everything else
     * (live tick / viewport re-run) value-patches.
     *
     * Returns false when the model was DEFERRED — an output-free model arriving while
     * the record is still loading and the chart has no bars (see below); every other
     * outcome, including the hidden drop, returns true so the caller's event semantics
     * stay unchanged.
     */
    private applyModel(id: string, model: IndicatorModel): boolean {
        const record = this.registry.get(id);
        if (!record || record.hidden) return true; // a model arriving for a just-hidden indicator is dropped

        // While the CHART ITSELF has no bars, an output-free model is the signature of a
        // run over zero bars (empty initial load: auth race, unresolved symbol, transient
        // feed failure) — an engine may then fabricate default metadata (generic title,
        // overlay: false) because the script body never executed. Letting it through
        // while loading would finalize pane routing off fabricated flags and clear the
        // spinner, stranding the indicator on the wrong pane with a value patch (no
        // title, no pane, unmounted series ids) as its only future. Keep the prepared
        // placeholder up and the one-shot pane re-route unconsumed; the session re-runs
        // when bars arrive and the first REAL model still routes. The bars check keeps
        // the guard narrow on purpose: loading ends when the run completes, not when it
        // produces output — a script that ran over real bars and legitimately emitted
        // nothing visual (e.g. alerts only) still clears its spinner and announces.
        if (record.loading && this.bars.length === 0 && !EngineOrchestrator.modelHasOutput(model)) return false;

        const handle = this.handles.get(id);

        if (!record.renderHandle) {
            const paneId = this.routePane(id, model, record.options ?? {});
            this.placeModel(model, id, paneId);
            record.model = model;
            this.ensurePaneFor(paneId);
            record.renderHandle = this.renderer.mountIndicator(model);
            record.pendingStructural = false;
            this.announce(record, handle);
            return true;
        }

        let paneId = record.model?.paneId ?? 'price';
        const prevOwnScale = record.model?.ownScale === true;
        if (record.loading && !record.paneLocked) {
            // First COMPUTED model after the placeholder. The placeholder's pane came from
            // the prepare-time overlay guess — if the real model routes differently, move
            // off the placeholder pane before mounting. (A user-placed indicator is locked,
            // so its pane is never re-derived here.)
            const routed = this.routePane(id, model, record.options ?? {});
            if (routed !== paneId) {
                if (paneId !== 'price') {
                    this.renderer.removePane(paneId);
                    this.forgetPane(paneId); // keep core paneOrder in sync (was left stale → desynced list()/anchors/undo)
                }
                this.ensurePaneFor(routed);
                record.pendingStructural = true;
                paneId = routed;
            }
        }
        this.placeModel(model, id, paneId);
        if (record.paneLocked) model.ownScale = prevOwnScale; // carry the merge across the recompute
        record.model = model;
        if (record.pendingStructural) {
            // Idempotent-by-id remount: refresh visuals while keeping the legend + open
            // settings dialog intact (an input change can restructure series/drawings).
            record.renderHandle = this.renderer.mountIndicator(model);
            this.renderer.setIndicatorInputs(record.renderHandle, record.inputValues, record.propValues);
            record.pendingStructural = false;
        } else {
            this.renderer.updateIndicator(record.renderHandle, modelToValuePatch(model));
        }
        if (record.loading) this.setLoading(record, false);
        this.announce(record, handle);
        return true;
    }

    /** True when the model carries ANY executed output — series, drawings, bar colors, or trades. */
    private static modelHasOutput(model: IndicatorModel): boolean {
        return (
            model.series.length > 0 ||
            model.fills.length > 0 ||
            model.backgrounds.length > 0 ||
            model.priceLines.length > 0 ||
            (model.lines?.length ?? 0) > 0 ||
            (model.boxes?.length ?? 0) > 0 ||
            (model.labels?.length ?? 0) > 0 ||
            (model.polylines?.length ?? 0) > 0 ||
            (model.linefills?.length ?? 0) > 0 ||
            (model.tables?.length ?? 0) > 0 ||
            (model.barColors?.length ?? 0) > 0 ||
            (model.trades?.length ?? 0) > 0
        );
    }

    private routePane(id: string, model: IndicatorModel, options: AddIndicatorOptions): string {
        if (options.pane === 'new') return `pane-${id}`;
        if (options.pane === 'price') return 'price';
        const overlay = options.overlay ?? model.overlay;
        return overlay ? 'price' : `pane-${id}`;
    }

    /** Each named value series' last plotted value — the model is the one source every
     *  engine fills, so this works without an execution context. */
    private static plotsAtLastBar(model: IndicatorModel): Record<string, number | null> {
        const out: Record<string, number | null> = {};
        for (const spec of model.series) {
            if (!isLineLikeSeries(spec)) continue;
            out[spec.title] = spec.points[spec.points.length - 1]?.value ?? null;
        }
        return out;
    }

    private placeModel(model: IndicatorModel, id: string, paneId: string): void {
        model.id = id;
        model.paneId = paneId;
        // A `force_overlay` item (overlay: true) renders on the price pane regardless of
        // where its indicator routed — stamp it 'price' so the model tells the truth.
        const paneOf = (item: { overlay?: boolean }): string => (item.overlay === true ? 'price' : paneId);
        for (const series of model.series) series.paneId = paneOf(series);
        for (const fill of model.fills) fill.paneId = paneOf(fill);
        for (const bg of model.backgrounds) bg.paneId = paneOf(bg);
        for (const line of model.priceLines) line.paneId = paneId;
        if (model.lines) for (const ln of model.lines) ln.paneId = paneOf(ln);
        if (model.boxes) for (const bx of model.boxes) bx.paneId = paneOf(bx);
        if (model.labels) for (const lb of model.labels) lb.paneId = paneOf(lb);
        if (model.polylines) for (const pl of model.polylines) pl.paneId = paneOf(pl);
        if (model.linefills) for (const lf of model.linefills) lf.paneId = paneOf(lf);
        if (model.tables) for (const tb of model.tables) tb.paneId = paneOf(tb);
    }

    /** Throttled (1/s per indicator) 'context:changed' — streamed models re-emit per tick,
     *  consumers only need a coarse re-pull signal. Fires only for context-capable sessions. */
    private readonly contextEmitAt = new Map<string, number>();
    private emitContextChanged(id: string): void {
        if (!this.registry.get(id)?.session?.getContext) return;
        const now = Date.now();
        if (now - (this.contextEmitAt.get(id) ?? 0) < 1000) return;
        this.contextEmitAt.set(id, now);
        this.events.emit('context:changed', { id });
    }

    /**
     * Build and emit `script:run`. Costs NOTHING when nobody listens — the engine-context
     * pull that fills `vars`/`strategy` only happens for an actual subscriber.
     *
     * Throttling is deliberately asymmetric: a stream re-executes the forming bar several
     * times a second and those `'tick'` runs collapse to ~1/s, but every other cause fires
     * unconditionally. Dropping a `'bar'` run would silently break the one thing a
     * recorder keys off — the moment a bar became final.
     */
    private readonly runEmitAt = new Map<string, number>();
    private emitScriptRun(id: string, cause: ScriptRunCause, first: boolean): void {
        const record = this.registry.get(id);
        if (!record || record.native || !this.events.hasListeners('script:run')) return;
        const now = Date.now();
        if (cause === 'tick' && now - (this.runEmitAt.get(id) ?? 0) < RUN_EMIT_THROTTLE_MS) return;
        this.runEmitAt.set(id, now);
        // Deferred one microtask on purpose: a SYNCHRONOUS engine emits its first model
        // during `execute()`, before `record.session` has been assigned — pulling the
        // execution context right now would find no session and silently drop `vars` and
        // `strategy` from the first run.
        void Promise.resolve()
            .then(() => this.buildScriptRun(record, cause, first))
            .then((run) => {
                // The indicator may have been removed while the snapshot crossed the worker.
                if (run && this.registry.get(id)) this.events.emit('script:run', run);
            });
    }

    /** The neutral run payload: the model supplies what every engine has, the execution
     *  context the rest (absent for an engine that exposes none). */
    private async buildScriptRun(record: IndicatorRecord, cause: ScriptRunCause, first: boolean): Promise<ScriptRun | null> {
        const model = record.model;
        if (!model) return null;
        const snapshot = await this.pullContext(record, ['variables', 'strategy', 'warnings']);
        const lastBar = this.bars[this.bars.length - 1];
        return {
            id: record.id,
            title: model.title,
            kind: snapshot?.strategy || (model.trades?.length ?? 0) > 0 ? 'strategy' : 'indicator',
            cause,
            first,
            // The CHART's frame of reference, the only one an engine and a host share.
            bar: Math.max(0, this.bars.length - 1),
            time: lastBar?.time ?? 0,
            // A live chart's last bar is the open one, so its values are provisional
            // whatever produced this run.
            forming: this.config.live && this.bars.length > 0,
            complete: this.historyState !== 'backfill',
            plots: EngineOrchestrator.plotsAtLastBar(model),
            vars: snapshot?.variables ?? {},
            ...(snapshot?.strategy ? { strategy: snapshot.strategy } : {}),
            warnings: snapshot?.warnings ?? [],
            trades: async (): Promise<readonly StrategyTrade[]> => (await this.pullContext(record, ['trades']))?.trades ?? [],
            series: async (key: string) => {
                const points = (await this.pullContext(record, ['plots']))?.plots?.[key] ?? [];
                return points.map((p) => ({ time: p.time, value: typeof p.value === 'number' ? p.value : null }));
            },
        };
    }

    /** One guarded execution-context pull; null for an engine without the capability. */
    private async pullContext(record: IndicatorRecord, select: ContextSelect): Promise<EngineContextSnapshot | null> {
        try {
            return (await record.session?.getContext?.(select)) ?? null;
        } catch {
            return null; // a torn-down session mid-pull is not an error worth surfacing
        }
    }

    private fail(id: string, handle: IndicatorHandleImpl | undefined, err: unknown): void {
        const record = this.registry.get(id);
        if (record?.loading) this.setLoading(record, false); // stop the spinner; the row stays so the user can remove it
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[vela] indicator "${id}" failed:`, error.message);
        this.events.emit('indicator:error', { id, error });
        handle?.emit('error', { error });
    }
}

/**
 * Yield long enough for the renderer to paint one frame before the engine's
 * synchronous transpile + execution locks the main thread. Double-rAF guarantees a
 * paint in the browser (the first callback runs pre-paint, the second resumes the
 * frame after); falls back to a macrotask where rAF is unavailable (tests/headless).
 */
function yieldToPaint(): Promise<void> {
    if (typeof requestAnimationFrame === 'function') {
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Build a value-only patch from a freshly-run model (used on live ticks / re-runs). */
function modelToValuePatch(model: IndicatorModel): ValuePatch {
    const series: SeriesValueDelta[] = [];
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const s of model.series) {
        if (s.kind === 'candle' || s.kind === 'bar') {
            series.push({ seriesId: s.id, kind: 'bars', bars: s.bars });
            for (const b of s.bars) {
                if (b.time < from) from = b.time;
                if (b.time > to) to = b.time;
            }
        } else if (isLineLikeSeries(s)) {
            series.push({ seriesId: s.id, kind: 'points', points: s.points });
            for (const p of s.points) {
                if (p.time < from) from = p.time;
                if (p.time > to) to = p.time;
            }
        }
    }
    return {
        kind: 'value',
        indicatorId: model.id,
        dirty: { from: Number.isFinite(from) ? from : 0, to },
        // ALWAYS stated, `null` included: an omitted key leaves the renderer on the previous
        // run's offset, so a re-run that widened to the whole chart could not clear it.
        anchorTime: model.anchorTime ?? null,
        series,
        lines: model.lines ?? [],
        boxes: model.boxes ?? [],
        labels: model.labels ?? [],
        polylines: model.polylines ?? [],
        linefills: model.linefills ?? [],
        tables: model.tables ?? [],
        trades: model.trades ?? [],
    };
}
