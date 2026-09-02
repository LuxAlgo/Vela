// One workspace CELL — a stable IDENTITY (its declared name, or `c<N>` for a slot no
// entry declared) holding a full Vela chart plus its per-cell overlays and per-cell
// state: statusline, watermark, context menu, its own undo timeline, and its indicator
// ledger (shared manifest, per-cell instances). The identity never derives from content:
// symbol/timeframe/style are mutable state, switched IN PLACE via `chart.setMarket` (the
// chart instance survives every market change and only dies with the cell itself, on a
// layout change — its state then round-trips through the workspace pool, so shrinking
// 4 → 2 → 4 restores the third and fourth exactly, indicators and drawings included).
import { Vela } from '../Vela';
import { normalizeSession, type MarketSession, type NativeBackend, type VelaOptions, type VelaTheme } from '../core/options';
import type { OHLCV } from '../core/model/ohlcv';
import type { VisibleRangePreset } from '../core/visible-range';
import type { VisibleRange } from '../core/ports/IChartRenderer';
import type { DrawingsOption } from '../core/drawings';
import type { MarketDataFeed } from '../core/ports/MarketDataFeed';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import { Statusline, statuslineInkOf, type StatuslinePart } from '../widget/statusline';
import { MarketStatusTracker } from '../widget/market-status';
import { SessionShadingTracker } from '../widget/session-shading';
import { timeframeMs } from '../widget/timeframe';
import { Watermark } from '../widget/watermark';
import { CellControls } from '../widget/cell-controls';
import { ChartContextMenu } from '../widget/context-menu';
import { WidgetHistory } from '../widget/history';
import type { RangePreset } from '../widget/bottombar';
import { indicatorLedger, ledgerEntryName, type LedgerManifestEntry, type ResolvedIndicator } from '../widget/indicators';
import { inputDeltas, type InputValue } from '../core/model/inputs';
import {
    legendActionsProviderFor,
    legendCalloutsProviderFor,
    resolveEngines,
    statePersistenceHandlers,
    type CellStateContext,
    type ExternalIndicatorEntry,
    type WidgetContext,
} from '../widget/contributions';
import { prefixedSymbol, type CellState } from '../state/document';
import { parseSymbol } from '../data/ProviderRegistry';
import { normalizeTimezone } from '../core/timezones';
import { applyPlotOverlayTokens } from '../ui';

/** The seed/mutable market state of one cell (all optional — an empty cell parks).
 *  The SAME vocabulary as the widget's chart options: the workspace's top-level chart
 *  options provide every cell's default ({@link seedDefaults}), `cells` overrides per
 *  cell. `data`/`visibleRange` are boot-only (they seed the first load, never persist). */
export interface CellSeed {
    /** Bare ticker (provider resolved by declaration order) or `EXCHANGE:`-prefixed. */
    symbol?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
    /** Trading session to show (markets that have one; `regular` is the default). */
    session?: string;
    /** Offline bars for this cell — replaces the provider (boot-only). */
    data?: OHLCV[];
    /** Initial visible window (boot-only). */
    visibleRange?: VisibleRangePreset | VisibleRange;
}

/** A destroyed cell's state, kept by the workspace pool so its slot restores later —
 *  the per-cell entry of the SHARED state document (`src/state/document.ts`). */
export type PooledCellState = CellState;

/** What a cell BOOTS from: a pooled state (restored slot) or an options seed — plus
 *  the boot-only extras a pooled state never carries (offline bars, initial window). */
export type CellBoot = PooledCellState & Pick<CellSeed, 'data' | 'visibleRange'>;

/** The per-cell SEED the workspace's top-level chart options provide — same words as
 *  the widget; `cells[id]` spreads over this. */
export function seedDefaults(opts: Pick<VelaOptions, 'symbol' | 'timeframe' | 'bars' | 'priceStyle' | 'session' | 'data' | 'visibleRange'>): CellSeed {
    return {
        symbol: opts.symbol,
        timeframe: opts.timeframe,
        bars: opts.bars,
        priceStyle: opts.priceStyle,
        session: opts.session,
        data: opts.data,
        visibleRange: opts.visibleRange,
    };
}

/** Chart options the workspace forwards VERBATIM to every cell's chart — the widget
 *  vocabulary minus what the grid manages itself: `height` (the grid sizes cells),
 *  `nativeBackend` (the WebGL budget policy, explicit value resolved upstream), the
 *  market/view seeds (those flow through {@link CellSeed}), and `drawings`' toolbar
 *  sub-key (see {@link cellDrawings}). */
export type CellChartDefaults = Pick<
    VelaOptions,
    'renderer' | 'defaultLanguage' | 'currentPriceLine' | 'logScale' | 'animations' | 'glow' | 'upColor' | 'downColor' | 'drawings' | 'settings'
>;

/** The {@link CellChartDefaults} pick of a workspace's options (pure, for the build). */
export function cellChartDefaults(opts: CellChartDefaults): CellChartDefaults {
    const { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings, settings } = opts;
    return { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings, settings };
}

/** The cell form of the shell's `drawings` option: everything passes through EXCEPT the
 *  toolbar — ONE shared bar serves the grid (per-cell bars would cost a 44px gutter
 *  each). An explicit `false` stays an opt-out (the headless `chart.drawings` API only). */
export function cellDrawings(opt: DrawingsOption | undefined): DrawingsOption {
    if (opt === false) return false;
    if (opt === true || opt == null) return { toolbar: false };
    return { ...opt, toolbar: false };
}

/** A cell's Status line tab prefs as one bundle — the segment toggles (null when the
 *  shell runs without status lines) plus the indicator legend's titles/values. What
 *  the workspace's STYLE link mirrors across same-group cells. */
export interface CellStatusPrefs {
    parts: Record<StatuslinePart, boolean> | null;
    indicatorTitles: boolean;
    indicatorValues: boolean;
}

/** One entry of the shared indicator picker's native catalog, per cell. */
export interface CellNativeInfo {
    type: string;
    title: string;
    supported: boolean;
    present: boolean;
    beta?: boolean;
}

/** What every cell shares from the workspace. */
export interface CellDeps {
    /** THE shared market-data feed (one registry, one cache, for every cell). */
    feed: MarketDataFeed;
    /** Scripting-engine factories — instantiated PER CELL (a worker engine per cell). */
    engines: Record<string, () => ScriptingEngine>;
    /** The workspace's top-level chart options every cell's chart starts from. */
    chartDefaults: CellChartDefaults;
    theme: VelaTheme;
    live: boolean;
    volume: boolean;
    statusline: boolean;
    watermark: boolean;
    /** Geometry backend for cells under the current layout (the WebGL budget policy). */
    nativeBackend: NativeBackend;
    /** Where the renderer mounts its MODAL dialogs (chart/indicator settings) — the
     *  workspace root, so dialogs center over the whole grid instead of one cell. */
    dialogHost: HTMLElement;
    /** The workspace-global display timezone (applied to every cell's renderer). */
    timezone(): string;
    /** Switch the workspace-global display timezone (a cell's time-axis menu). */
    setTimezone(zone: string): void;
    /** The live widget-context builder (per-cell context menus project contributed actions). */
    context(): WidgetContext;
    /** The shared manifest can no longer change instance sets: it resolved, or the
     *  workspace has no `indicators` option so nothing will ever resolve. Gates the
     *  ledger's pending fallback in `dehydrate` — once settled, a live empty set means
     *  "the user removed everything" and persists so. */
    manifestSettled(): boolean;
    /** Report a pointer-down/focus in this cell (the workspace sets it active). */
    activate(id: string): void;
    /** Whether the grid holds more than one cell — gates the cluster's maximize
     *  button and its drag handle (a lone chart has neither use). */
    multiCell(): boolean;
    /** Is this cell the one the workspace currently maximizes over the grid? */
    isMaximized(id: string): boolean;
    /** Maximize this cell over the whole grid, or restore the grid when it already is. */
    toggleMaximize(id: string): void;
    /** Drag-handle hit-test: the OTHER live cell under a viewport point (never `id`). */
    cellDragTarget(id: string, x: number, y: number): string | null;
    /** Live drop-target highlight while a grip drag is underway (null clears). */
    previewDropTarget(id: string | null): void;
    /** Commit a grip drag: the two cells trade slots in the grid. */
    dropCell(id: string, targetId: string): void;
    /** The cell's market changed in place (chrome/retention refresh upstream). */
    onMarketChanged(id: string): void;
    /** The cell's price style changed in place (topbar icon/menu refresh upstream). */
    onPriceStyleChanged(id: string): void;
    /** The cell's indicator ledger changed (count/picker refresh upstream). */
    onIndicatorsChanged(id: string): void;
    /** A Status line tab pref changed on this cell (the style link mirrors upstream). */
    onStatusPrefsChanged(id: string): void;
    /** Persistable per-cell state changed outside the market/indicator channels
     *  (bars budget, watermark/titles toggles) — the workspace debounces a save. */
    onStateDirty(): void;
    /** The shell's toast surface (unresolved-symbol notices land there). */
    toast(message: string, kind: 'info' | 'success' | 'error', durationMs?: number): void;
}

/** One live manifest/external instance and, when it deviates from declaration
 *  defaults, the values it was restored with or dropped holding. */
interface CellInstance {
    entry: ResolvedIndicator;
    handle: IndicatorHandle | null;
    external?: boolean;
    values?: { inputs?: Record<string, InputValue>; props?: Record<string, InputValue> };
}

/** The handle's current input/prop DELTAS against declaration defaults (see `inputDeltas`). */
function instanceDeltas(handle: IndicatorHandle | null): { inputs?: Record<string, InputValue>; props?: Record<string, InputValue> } | undefined {
    if (!handle) return undefined;
    const inputs = inputDeltas(handle.inputs, handle.inputValues());
    const props = inputDeltas(handle.props, handle.propValues());
    return inputs || props ? { ...(inputs ? { inputs } : {}), ...(props ? { props } : {}) } : undefined;
}

export class ChartCell {
    /** The grid item this cell renders into (owned; removed on destroy). */
    readonly host: HTMLElement;
    /** This cell's unified app+drawings undo timeline (the shared Ctrl+Z routes here). */
    readonly history = new WidgetHistory(() => this.inner);
    /** Live manifest-indicator instances on this cell (the SAME entry may repeat).
     *  `external` marks instances added through the public seam (`ctx.addIndicator`)
     *  rather than the shell manifest — they share the undo/redo and picker plumbing
     *  but stay OUT of the persisted ledger (their names would never resolve against
     *  the manifest); persisting them is their plugin's job (`registerStatePersistence`). */
    readonly instances: CellInstance[] = [];
    /** The native-indicator catalog with this cell's live supported/present flags. */
    nativeCatalog: CellNativeInfo[] = [];
    /** Last crosshair position in this cell (the alt+H/alt+V shortcuts anchor here). */
    lastCrossTime: number | null = null;
    lastCrossPrice: number | null = null;
    /** The bottombar range chip this cell is framed on (null = none). */
    activeRangeId: string | null = null;
    /** Latched verdict of {@link sessionAvailable} (async metadata, sticky per symbol). */
    private sessionAvailableFlag = false;

    private inner: Vela | null;
    /** The live app theme — seeded from deps, updated on `theme:changed` (the base the
     *  plot-overlay tokens re-derive from). */
    private appTheme: VelaTheme;
    private readonly statusline: Statusline | null;
    /** Keeps this cell's market badge on the symbol's real calendar (see {@link MarketStatusTracker}). */
    private readonly marketStatus: MarketStatusTracker | null;
    /** Keeps the pre/post-market shading on the symbol's real calendar (see {@link SessionShadingTracker}). */
    private readonly sessionShading = new SessionShadingTracker((zones) => this.inner?.renderer.set('sessionZones', zones));
    private readonly watermark: Watermark | null;
    /** Bottom-center hover cluster, pinned to the price plot: drag handle, zoom in/out, maximize/restore, reset view. */
    private readonly cellControls: CellControls;
    private readonly contextMenu: ChartContextMenu;
    private readonly offMarket: () => void;
    /** The cell's durable market state — the seed vocabulary plus the venue mirror the
     *  persisted document carries (`provider` = the symbol's parsed prefix). */
    private state: CellSeed & Pick<CellState, 'provider'>;
    private manifest: readonly ResolvedIndicator[] = [];
    /** A restored ledger's manifest entry NAMES, waiting for the manifest to resolve
     *  (a pool/persisted cell can be built before the shared manifest has loaded). */
    private pendingManifestNames: LedgerManifestEntry[] | null = null;
    /** The volume auto-add rides the cell's first candles (`load:end`); until then the
     *  registry can't show it and the dehydrated ledger reports the INTENT instead. */
    private volumeMayBePending = true;
    /** Volume intent: the seed's ledger, else the workspace `volume` option — a
     *  rehydrated ledger overwrites it (see {@link applyIndicatorLedger}). */
    private volumeIntent: boolean;
    /** Sync mirror of the chart's present native types — the removal handler diffs
     *  against it to identify (and record) whichever type was just removed. */
    private presentNatives: string[] = [];
    private rangeBars = 0;
    private pendingRange: RangePreset | null = null;
    /** Last symbol we toasted "no provider serves this" for — once per symbol (the
     *  core re-reports on every provider-index settle). */
    private unresolvedToasted: string | null = null;
    /** The cell's third-party state bag (`ext` of the persisted per-chart state) —
     *  seeded from the boot/restored document, refreshed by handler `serialize` calls at
     *  dehydrate time. Entries with no registered handler this session ride along
     *  verbatim, so a document never loses a plugin's state in the plugin's absence. */
    private extState: Record<string, unknown> = {};
    private watermarkOn: boolean;
    /** Indicator titles (this cell's in-chart legend rows) shown. */
    private indicatorTitlesOn = true;
    /** Plot values beside this cell's legend titles shown. */
    private indicatorValuesOn = true;
    private destroyed = false;

    constructor(
        readonly id: string,
        gridHost: HTMLElement,
        seed: CellBoot,
        private readonly deps: CellDeps,
    ) {
        this.appTheme = deps.theme;
        // The canonical symbol form: pre-prefix pooled/persisted states carried the venue
        // in `provider` beside a bare symbol — weld them back together once, at boot.
        const symbol = prefixedSymbol(seed);
        this.state = {
            symbol,
            provider: parseSymbol(symbol ?? '').provider ?? undefined,
            timeframe: seed.timeframe,
            priceStyle: seed.priceStyle,
            bars: seed.bars,
            session: normalizeSession(seed.session),
        };
        const doc = gridHost.ownerDocument;
        this.host = doc.createElement('div');
        this.host.className = 'vela-cell';
        this.host.dataset.cellId = id;
        this.host.style.cssText = 'position:relative;overflow:hidden;';
        // Capture-phase: a press anywhere in the cell (canvas, legend, dialogs) activates it
        // before any inner handler consumes the event.
        this.host.addEventListener('pointerdown', () => this.deps.activate(id), true);
        this.host.addEventListener('focusin', () => this.deps.activate(id));
        gridHost.appendChild(this.host);

        this.inner = new Vela(
            this.host,
            {
                ...deps.chartDefaults,
                symbol,
                timeframe: seed.timeframe,
                bars: seed.bars,
                priceStyle: seed.priceStyle,
                session: normalizeSession(seed.session),
                data: seed.data,
                visibleRange: seed.visibleRange,
                theme: deps.theme,
                live: deps.live,
                // A RESTORED ledger is authoritative for the auto-added volume too: a
                // slot persisted without it must come back without it (fresh slots
                // keep the workspace default).
                volume: seed.indicators ? seed.indicators.natives.includes('volume') : deps.volume,
                nativeBackend: deps.nativeBackend,
                // The user's drawings option minus its toolbar: one SHARED bar serves
                // the whole workspace (per-cell bars would cost a 44px gutter each).
                drawings: cellDrawings(deps.chartDefaults.drawings),
            },
            { dataFeed: deps.feed },
        );
        for (const [language, make] of Object.entries(resolveEngines(deps.engines))) this.inner.registerEngine(language, make());
        // ONE attribution mark per WORKSPACE, not per cell: each cell disables its own
        // in-chart mark; the workspace mounts the single grid-level mark that satisfies
        // the NOTICE's equivalent-visible-attribution requirement.
        this.inner.renderer.set('attribution', false);
        // Modal dialogs (chart settings, indicator settings) escape the cell's
        // overflow clip and center over the whole grid.
        this.inner.renderer.set('dialogHost', deps.dialogHost);
        // Contributed legend-row actions — the row resolves on THIS cell's chart; the
        // context follows the workspace rule (built fresh per click, active-cell bound).
        this.inner.renderer.setLegendActions(legendActionsProviderFor(this.inner, () => deps.context()));
        this.inner.renderer.setLegendCallouts(legendCalloutsProviderFor(this.inner, () => deps.context()));
        // The cell owns ONE unified undo timeline (drawings + indicator ops), driven by
        // the workspace keymap. The drawings layer must not self-serve Ctrl+Z/Y or the
        // two histories desync (its preempt would pop the core drawing stack while the
        // keymap pops an unrelated cell entry).
        if (this.inner.renderer.supports('historyChords')) this.inner.renderer.set('historyChords', false);
        this.history.onChart(this.inner);
        // The renderer's settings dialog owns a Time zone row too (it commits through
        // applyConfig) — mirror it back so the workspace bottom bar, the other cells and
        // the persisted state never disagree with this cell's axis. `renderer.set` is a
        // feature write, not an applyConfig, so adopting the value cannot loop.
        this.inner.renderer.onConfigChanged(() => {
            const zone = this.inner?.renderer.get('timezone');
            if (typeof zone === 'string' && normalizeTimezone(zone) !== normalizeTimezone(this.deps.timezone())) {
                this.deps.setTimezone(normalizeTimezone(zone));
            }
            this.syncStatuslineColors(); // a settings edit may have recolored the active style
            this.syncPlotOverlayTokens(); // a background edit may have flipped the plot's luminance
        });
        // A live theme swap re-bases this cell's overlay tokens too (the workspace already
        // re-skins the shared chrome).
        this.inner.on('theme:changed', (t) => {
            this.appTheme = t;
            this.syncPlotOverlayTokens();
        });
        this.syncPlotOverlayTokens();
        // Pool restore: cosmetics + drawings round-trip (both validate untrusted input).
        if (seed.rendererConfig != null) this.inner.renderer.applyConfig(seed.rendererConfig);
        if (seed.drawings != null) this.inner.drawings.fromJSON(seed.drawings);
        // A restored ledger: natives re-add immediately (registry truth from here on);
        // manifest entries wait for setManifest (the shared manifest may still be
        // resolving) and stay reported by `dehydrate` until then, so an early snapshot
        // (persist flush racing the resolution) never wipes them.
        if (seed.indicators) {
            for (const type of seed.indicators.natives) this.inner.addNativeIndicator(type);
            this.pendingManifestNames = [...seed.indicators.manifest] as LedgerManifestEntry[];
        }
        this.volumeIntent = seed.indicators ? seed.indicators.natives.includes('volume') : deps.volume;
        // Third-party state rides in verbatim; the workspace triggers the handlers'
        // `restore` AFTER wiring the cell (restorePersistedExt) — a restore that adds
        // indicators must not call back into a workspace that doesn't know the cell yet.
        this.extState = { ...(seed.ext ?? {}) };
        // The volume auto-add rides the cell's first candles — from `load:end` on, the
        // registry is the whole truth and the dehydrated ledger stops reporting intent.
        this.inner.on('load:end', () => {
            this.volumeMayBePending = false;
        });
        // A symbol nothing serves parks the load forever — say so instead of showing a
        // blank cell. Once per symbol: the core re-reports on every index settle.
        this.inner.on('data:unresolved', ({ symbol, providers }) => {
            if (this.unresolvedToasted === symbol) return;
            this.unresolvedToasted = symbol;
            const list = providers.length > 0 ? providers.join(', ') : 'none';
            this.deps.toast(`No registered provider serves "${symbol}" (registered: ${list})`, 'error', 6000);
        });
        // The loading affordance and the watermark never share the canvas.
        this.inner.on('load:start', () => this.watermark?.setLoading(true));
        this.inner.on('load:end', () => {
            this.watermark?.setLoading(false);
            this.refreshSessionShading(); // the first painted bars now define the exact range
        });
        this.inner.on('viewport:changed', (range) => this.sessionShading.updateRange(range));
        const tz = deps.timezone();
        if (tz !== 'Etc/UTC') this.inner.renderer.set('timezone', tz);

        this.indicatorTitlesOn = seed.indicatorTitles ?? true;
        if (!this.indicatorTitlesOn) this.inner.renderer.set('indicatorTitles', false);
        this.indicatorValuesOn = seed.indicatorValues ?? true;
        if (!this.indicatorValuesOn) this.inner.renderer.set('indicatorValues', false);
        this.watermarkOn = seed.watermark ?? deps.watermark;
        this.watermark = deps.watermark ? new Watermark(this.host, symbol ?? '', seed.timeframe ?? '60') : null;
        if (!this.watermarkOn) this.watermark?.setVisible(false);
        this.statusline = deps.statusline ? new Statusline(this.host, symbol ?? '', (sym) => this.inner?.data.symbolIcon(sym)) : null;
        this.statusline?.setMeta(seed.timeframe ?? '60', this.state.provider ?? '');
        this.statusline?.onChart(this.inner);
        // The status line's right-click menu: part toggles route through the cell so the
        // style link mirrors them; the chart toggle is the object tree's same eye seam.
        this.statusline?.attachMenu({
            setPart: (part, visible) => this.setStatuslinePart(part, visible),
            chartVisible: () => this.inner?.renderer.get('candleVisible') !== false,
            setChartVisible: (visible) => this.inner?.renderer.set('candleVisible', visible),
        });
        this.marketStatus = this.statusline ? new MarketStatusTracker((s) => this.statusline?.setMarketStatus(s)) : null;
        // The venue chip above is provisional (persisted/typed prefix): once the shared
        // feed's indexes settle, re-derive it from the DATA — a cell restored as
        // `edgx:AAPL` must come back up reading NASDAQ. The avatar re-resolves too: the
        // provider's icon resolver may only answer once its index is in.
        void this.inner.data.ready().then(() => {
            if (this.inner && this.state.symbol) {
                this.statusline?.setSymbol(this.state.symbol);
                this.statusline?.setMeta(this.state.timeframe ?? '60', this.inner.data.displayPrefix(this.state.symbol) ?? this.state.provider ?? '');
            }
            this.refreshSessionAvailable();
            if (this.inner && this.state.symbol) this.marketStatus?.track(this.inner.data, this.state.symbol);
        });
        this.syncStatuslineColors();
        this.cellControls = new CellControls(this.host, {
            chart: () => this.inner,
            reset: () => this.resetView(),
            multiCell: () => deps.multiCell(),
            isMaximized: () => deps.isMaximized(id),
            toggleMaximize: () => deps.toggleMaximize(id),
            dragTargetAt: (x, y) => deps.cellDragTarget(id, x, y),
            previewDrop: (target) => deps.previewDropTarget(target),
            dropOn: (target) => deps.dropCell(id, target),
        });
        this.contextMenu = new ChartContextMenu(this.host, {
            resetView: () => this.resetView(),
            timezone: () => this.deps.timezone(),
            setTimezone: (zone) => this.deps.setTimezone(zone),
            // Right-clicking activates the cell first (capture-phase pointerdown), so the
            // context the actions receive is this cell's — the active one.
            getContext: () => this.deps.context(),
        });
        this.contextMenu.onChart(this.inner);
        this.inner.renderer.onCrosshairMove((e) => {
            this.lastCrossTime = e.time;
            this.lastCrossPrice = e.price;
        });
        this.inner.on('indicator:added', () => {
            this.syncPresentNatives();
            this.refreshNativeCatalog();
        });
        this.inner.on('indicator:inputs', () => this.deps.onStateDirty());
        this.inner.on('indicator:removed', ({ id }) => {
            if (this.destroyed) return;
            // Out-of-band removals (legend ✕, object tree, middle-click, handle.remove())
            // must drop the matching manifest-instance ledger entry too — a stale entry
            // kept the name in the persisted document and resurrected the indicator on
            // reload — AND enter the undo timeline like a picker removal would. The picker
            // path splices/records first (so these lookups no-op there), and replays run
            // muted, so an undo/redo never re-records itself.
            const idx = this.instances.findIndex((it) => it.handle?.id === id);
            if (idx >= 0) {
                const snapshot = this.instances[idx]!;
                this.instances.splice(idx, 1);
                this.history.push({
                    undo: () => {
                        snapshot.handle = this.addToChart(snapshot.entry, snapshot.values);
                        this.instances.push(snapshot);
                        this.deps.onIndicatorsChanged(this.id);
                    },
                    redo: () => this.dropInstance(snapshot),
                });
            } else {
                // A native indicator left the registry — whichever type vanished from the
                // sync presence list is the one an undo must restore. This is the SINGLE
                // recording site for native removals (picker, legend ✕, object tree).
                const now = this.inner?.presentNativeIndicators() ?? [];
                for (const type of this.presentNatives.filter((t) => !now.includes(t))) {
                    this.history.push({
                        undo: () => {
                            this.inner?.addNativeIndicator(type);
                            this.refreshNativeCatalog();
                        },
                        redo: () => {
                            this.inner?.addNativeIndicator(type).remove();
                            this.refreshNativeCatalog();
                        },
                    });
                }
            }
            this.syncPresentNatives();
            this.refreshNativeCatalog();
        });
        this.syncPresentNatives();
        this.refreshNativeCatalog();

        // HOST settings sections — the same set the widget contributes, per cell
        // (the shared topbar gear opens the ACTIVE cell's dialog).
        this.pushSettingsSections();

        // The committed bookkeeping seam: every market change — cell setters, sync links,
        // or host code calling chart.setMarket directly — lands here and updates the cell
        // state + overlays, then notifies the workspace (chrome projection, retention).
        // The cell setters ALSO project optimistically before the load (see projectMarket);
        // this pass re-runs idempotently and adds the data-dependent bookkeeping.
        this.offMarket = this.inner.on('market:changed', ({ symbol, timeframe }) => {
            this.projectMarket(symbol, timeframe);
            this.refreshNativeCatalog(); // per-symbol support flags may differ
            this.refreshSessionAvailable(); // the new symbol may (not) have sessions
            if (this.inner) this.marketStatus?.track(this.inner.data, symbol); // …and its own market clock
            this.deps.onMarketChanged(this.id);
        });
    }

    /**
     * Project a market identity into the cell state and its display overlays (watermark,
     * statusline), WITHOUT the data-dependent bookkeeping. Runs twice per user pick: once
     * optimistically from the cell setters — the labels reflect the pick immediately, not
     * after the bars load — and again from `market:changed` (the committed pass, and the
     * only pass for host `chart.setMarket` calls). Idempotent, so the double run converges.
     */
    private projectMarket(symbol: string, timeframe: string): void {
        this.state.symbol = symbol;
        this.state.provider = parseSymbol(symbol).provider ?? undefined;
        this.state.timeframe = timeframe;
        this.state.session = normalizeSession(this.inner?.market.session);
        this.watermark?.update(symbol, timeframe);
        this.statusline?.setSymbol(symbol);
        this.statusline?.setMeta(timeframe, this.inner?.data.displayPrefix(symbol) ?? this.state.provider ?? '');
        if (this.inner) this.statusline?.onChart(this.inner); // drop the old market's resting OHLC
    }

    /**
     * Does this cell's market HAVE sessions (RTH/ETH meaningful)? Derived from the
     * symbol's own metadata (`syminfo.session !== '24x7'`), asynchronously — the
     * workspace re-projects the shared bottombar when the verdict lands or changes.
     */
    get sessionAvailable(): boolean {
        return this.sessionAvailableFlag;
    }

    /** This cell's shown session (`regular` when unset — the provider default). */
    get session(): MarketSession {
        return normalizeSession(this.state.session) ?? 'regular';
    }

    /** Switch this cell's shown session in place (a reload — RTH and ETH are different bars). */
    setSession(session: MarketSession): void {
        if (session === this.session) return;
        this.state.session = session;
        this.deps.onStateDirty();
        void this.inner?.setMarket({ session });
    }

    private refreshSessionAvailable(): void {
        const chart = this.inner;
        const symbol = this.state.symbol;
        if (!chart || !symbol) return;
        void chart.data.symbolInfo(symbol).then((si) => {
            if (this.inner !== chart) return;
            const available = typeof si?.session === 'string' && si.session !== '' && si.session !== '24x7';
            if (available !== this.sessionAvailableFlag) {
                this.sessionAvailableFlag = available;
                this.deps.onMarketChanged(this.id); // re-project the shared bottombar toggle
                this.pushSettingsSections(); // the Trading session group follows the symbol
            }
            this.refreshSessionShading();
        });
    }

    /** (Re)derive the pre/post-market shading bands for this cell's market. The bands
     *  expand locally from the symbol's session vocabulary, so they paint as soon as
     *  metadata is known and follow any pan depth without provider round trips. */
    private refreshSessionShading(): void {
        const chart = this.inner;
        const symbol = this.state.symbol;
        if (!chart || !symbol) return;
        const now = Date.now();
        const requestedSpan = Math.max(this.state.bars ?? 1000, this.rangeBars) * timeframeMs(this.state.timeframe ?? '60');
        const fallbackSpan = Number.isFinite(requestedSpan) ? Math.max(3 * 86_400_000, requestedSpan) : 3 * 86_400_000;
        const range = chart.getVisibleRange() ?? { from: now - fallbackSpan, to: now };
        this.sessionShading.track(chart.data, symbol, { session: this.session, timeframe: this.timeframe, range });
    }

    /** The session-shade colors live in the renderer CONFIG (persisted with it, edited
     *  live by the dialog swatch) — the cell only proxies them into its settings rows. */
    private sessionShadeColor(key: 'premarketColor' | 'postmarketColor'): string {
        const cfg = this.inner?.renderer.getConfig() as { sessions?: Record<string, unknown> } | null | undefined;
        const v = cfg?.sessions?.[key];
        return typeof v === 'string' ? v : '';
    }

    private setSessionShadeColor(key: 'premarketColor' | 'postmarketColor', color: string): void {
        this.inner?.renderer.applyConfig({ sessions: { [key]: color } });
        this.deps.onStateDirty(); // the colors persist with the renderer config document
    }

    /**
     * (Re)contribute this cell's settings-dialog sections: status line parts, the
     * per-cell fetch depth, the watermark toggle, and — only while the cell's symbol
     * HAS sessions — the Trading session group (RTH/ETH switch + the pre/post-market
     * shading colors) inside the Symbol tab. Bars/watermark/titles are persistable
     * cell state; a depth-only reload is silent, so mark dirty here. Re-run whenever
     * a gate changes (the dialog reads the sections on open).
     */
    private pushSettingsSections(): void {
        const chart = this.inner;
        if (!chart) return;
        const rth = 'Regular hours (RTH)';
        const eth = 'Extended hours (ETH)';
        // The `id` fields are the sections' stable visibility ids (`settings.hidden`,
        // docs/user/options.md) — same reserved ids as the widget's sections.
        const sessionSection = {
            title: 'Trading session',
            id: 'trading-session',
            placement: 'symbol' as const,
            rows: [
                {
                    kind: 'select' as const,
                    label: 'Session',
                    id: 'session',
                    options: [rth, eth],
                    get: () => (this.session === 'extended' ? eth : rth),
                    set: (v: string) => this.setSession(v === eth ? 'extended' : 'regular'),
                },
                {
                    kind: 'color' as const,
                    label: 'Pre-market',
                    id: 'premarket-color',
                    get: () => this.sessionShadeColor('premarketColor'),
                    set: (v: string) => this.setSessionShadeColor('premarketColor', v),
                },
                {
                    kind: 'color' as const,
                    label: 'Post-market',
                    id: 'postmarket-color',
                    get: () => this.sessionShadeColor('postmarketColor'),
                    set: (v: string) => this.setSessionShadeColor('postmarketColor', v),
                },
            ],
        };
        const advanced = {
            title: 'Advanced',
            id: 'advanced',
            placement: 'end' as const,
            rows: [
                {
                    kind: 'select' as const,
                    label: 'Bars to fetch',
                    id: 'bars',
                    options: ['500', '1000', '2000', '5000', '10000', '20000', '50000', '60000', '80000', '100000'],
                    get: () => String(this.state.bars ?? 1000),
                    set: (v: string) => {
                        this.state.bars = Number(v);
                        this.deps.onStateDirty();
                        void this.inner?.setMarket({ bars: Math.max(this.state.bars, this.rangeBars) });
                    },
                },
            ],
        };
        const watermarkSection = {
            title: 'Watermark',
            id: 'watermark',
            placement: 'symbol' as const,
            rows: [
                {
                    kind: 'toggle' as const,
                    label: 'Symbol watermark',
                    id: 'visible',
                    get: () => this.watermarkOn,
                    set: (v: boolean) => this.setWatermarkVisible(v),
                },
            ],
        };
        const sections: Array<{ title: string; rows: readonly unknown[]; placement?: 'after-symbol' | 'end' | 'symbol'; id?: string }> = [];
        if (this.statusline) {
            const sl = this.statusline;
            sections.push({
                title: 'Status line',
                id: 'status-line',
                rows: [
                    { kind: 'heading', label: 'Status line', id: 'parts' },
                    {
                        kind: 'toggle',
                        label: 'Symbol name',
                        id: 'name',
                        get: () => sl.partVisible('name'),
                        set: (v: boolean) => this.setStatuslinePart('name', v),
                    },
                    {
                        kind: 'toggle',
                        label: 'Market status',
                        id: 'market',
                        get: () => sl.partVisible('market'),
                        set: (v: boolean) => this.setStatuslinePart('market', v),
                    },
                    {
                        kind: 'toggle',
                        label: 'OHLC values',
                        id: 'ohlc',
                        get: () => sl.partVisible('ohlc'),
                        set: (v: boolean) => this.setStatuslinePart('ohlc', v),
                    },
                    {
                        kind: 'toggle',
                        label: 'Bar change values',
                        id: 'change',
                        get: () => sl.partVisible('change'),
                        set: (v: boolean) => this.setStatuslinePart('change', v),
                    },
                    { kind: 'heading', label: 'Indicators', id: 'indicators' },
                    {
                        kind: 'toggle',
                        label: 'Titles',
                        id: 'indicator-titles',
                        get: () => this.indicatorTitlesOn,
                        set: (v: boolean) => this.setIndicatorTitlesVisible(v),
                    },
                    {
                        kind: 'toggle',
                        label: 'Values',
                        id: 'indicator-values',
                        get: () => this.indicatorValuesOn,
                        set: (v: boolean) => this.setIndicatorValuesVisible(v),
                    },
                ],
            });
        }
        sections.push(advanced);
        if (this.sessionAvailableFlag) sections.push(sessionSection);
        sections.push(watermarkSection);
        chart.renderer.setSettingsSections(sections);
    }

    /** Show/hide this cell's symbol watermark (persisted per cell). */
    setWatermarkVisible(visible: boolean): void {
        this.watermarkOn = visible;
        this.watermark?.setVisible(visible);
        this.deps.onStateDirty();
    }

    /** Show/hide this cell's indicator titles — the in-chart legend rows (persisted per cell). */
    setIndicatorTitlesVisible(visible: boolean): void {
        this.indicatorTitlesOn = visible;
        this.inner?.renderer.set('indicatorTitles', visible);
        this.deps.onStateDirty();
        this.deps.onStatusPrefsChanged(this.id);
    }

    /** Show/hide the plot values beside this cell's legend titles (persisted per cell). */
    setIndicatorValuesVisible(visible: boolean): void {
        this.indicatorValuesOn = visible;
        this.inner?.renderer.set('indicatorValues', visible);
        this.deps.onStateDirty();
        this.deps.onStatusPrefsChanged(this.id);
    }

    /** Show/hide one status-line segment (the settings dialog's Status line tab). */
    private setStatuslinePart(part: StatuslinePart, visible: boolean): void {
        this.statusline?.setPartVisible(part, visible);
        this.deps.onStatusPrefsChanged(this.id);
    }

    /** This cell's Status line tab prefs as one bundle (see {@link CellStatusPrefs}). */
    statusPrefs(): CellStatusPrefs {
        const sl = this.statusline;
        return {
            parts: sl
                ? { logo: sl.partVisible('logo'), name: sl.partVisible('name'), market: sl.partVisible('market'), ohlc: sl.partVisible('ohlc'), change: sl.partVisible('change') }
                : null,
            indicatorTitles: this.indicatorTitlesOn,
            indicatorValues: this.indicatorValuesOn,
        };
    }

    /** Converge this cell's Status line tab prefs to `prefs` — the follower half of
     *  the workspace's style link. Idempotent: matching values change nothing, so a
     *  propagated echo dies on its own. */
    applyStatusPrefs(prefs: CellStatusPrefs): void {
        if (prefs.parts && this.statusline) {
            for (const part of Object.keys(prefs.parts) as StatuslinePart[]) {
                if (this.statusline.partVisible(part) !== prefs.parts[part]) this.statusline.setPartVisible(part, prefs.parts[part]);
            }
        }
        if (prefs.indicatorTitles !== this.indicatorTitlesOn) this.setIndicatorTitlesVisible(prefs.indicatorTitles);
        if (prefs.indicatorValues !== this.indicatorValuesOn) this.setIndicatorValuesVisible(prefs.indicatorValues);
    }

    /** The LIVE chart of this cell — never cache it across a layout change (the cell's
     *  identity is what endures; the chart dies with the cell). */
    get chart(): Vela {
        if (!this.inner) throw new Error(`[vela] cell "${this.id}" is destroyed`);
        return this.inner;
    }

    get symbol(): string {
        return this.state.symbol ?? '';
    }

    get timeframe(): string {
        return this.state.timeframe ?? '60';
    }

    get priceStyle(): string {
        const live = this.inner?.renderer.get('priceStyle');
        return typeof live === 'string' ? live : (this.state.priceStyle ?? 'candles');
    }

    /** Manifest instances + present natives — the topbar indicator count. */
    get indicatorCount(): number {
        return this.instances.length + this.nativeCatalog.filter((n) => n.present).length;
    }

    /** Switch this cell's market in place (the chart instance survives). The projection
     *  is OPTIMISTIC — labels and chrome show the pick before the bars load; it follows
     *  the setMarket call so the statusline reads the already-blanked chart. */
    setSymbol(symbol: string): void {
        if (!this.inner || symbol === this.symbol) return;
        this.unresolvedToasted = null; // a re-picked symbol gets a fresh verdict
        void this.inner.setMarket({ symbol });
        this.projectMarket(symbol, this.timeframe);
        this.deps.onMarketChanged(this.id);
    }

    setTimeframe(timeframe: string): void {
        if (!this.inner || timeframe === this.timeframe) return;
        // Leaving range mode: drop the chip AND its fetch budget (back to the cell's own bars).
        this.activeRangeId = null;
        this.rangeBars = 0;
        void this.inner.setMarket({ timeframe, bars: this.state.bars });
        this.projectMarket(this.symbol, timeframe);
        this.deps.onMarketChanged(this.id);
    }

    /** Applied live (renderer feature) — no reload. */
    setPriceStyle(style: string): void {
        this.state.priceStyle = style;
        this.inner?.renderer.set('priceStyle', style);
        this.syncStatuslineColors(); // the OHLC ink follows the newly active style's colors
        this.deps.onPriceStyleChanged(this.id);
    }

    /** OHLC/change ink in the status line follows the ACTIVE price style's configured
     *  colors and direction rule (candle bodies by close-vs-open, baseline by position
     *  against the live baseline price, …) instead of the fixed theme tokens. */
    private syncStatuslineColors(): void {
        if (!this.statusline || !this.inner) return;
        this.statusline.setDirectionColors(...statuslineInkOf(this.inner.renderer, this.priceStyle));
    }

    /** Multi-cell grids keep the status line on one row and hide what doesn't fit —
     *  the workspace flips this with the layout (see Statusline.setFitMode). */
    setStatuslineFit(on: boolean): void {
        this.statusline?.setFitMode(on);
    }

    /** The workspace shell keeps the app theme; the cell host's tokens re-derive from
     *  the LIVE plot surface (see {@link applyPlotOverlayTokens}). */
    private syncPlotOverlayTokens(): void {
        applyPlotOverlayTokens(this.host, this.appTheme, this.inner?.renderer.getConfig() ?? null);
    }

    /**
     * Frame a bottombar range chip: switch to its timeframe, fetch the depth its window
     * needs, and keep it framed (re-asserted once the deeper history is painted).
     */
    applyRange(preset: RangePreset): void {
        if (!this.inner || this.destroyed) return;
        this.activeRangeId = preset.id;
        const tfChanged = preset.tf !== this.timeframe;
        const deeper = preset.bars > Math.max(this.state.bars ?? 500, this.rangeBars);
        this.rangeBars = preset.bars;
        if (tfChanged || deeper) {
            this.pendingRange = preset;
            void this.inner
                .setMarket({ timeframe: preset.tf, bars: Math.max(this.state.bars ?? 500, this.rangeBars), visibleRange: preset.preset })
                .then(() => {
                    if (!this.destroyed && this.pendingRange === preset) {
                        this.inner?.setVisibleRangePreset(preset.preset);
                        this.pendingRange = null;
                    }
                });
        } else {
            this.inner.setVisibleRangePreset(preset.preset);
        }
    }

    /** Reset this cell's view: re-enable auto scale and frame the full history —
     *  the same action the chart context menu offers. */
    resetView(): void {
        this.inner?.renderer.set('autoScale', true);
        this.inner?.setVisibleRangePreset('ALL');
    }

    /** Rebuild the view-controls cluster (the maximize gate or state changed). */
    refreshControls(): void {
        this.cellControls.refresh();
    }

    /** Mobile flips the per-cell cluster off (the shell's mobile bar replaces it). */
    setControlsSuspended(on: boolean): void {
        this.cellControls.setSuspended(on);
    }

    /** Make this cell the active one and put keyboard focus on its chart surface. */
    focus(): void {
        this.deps.activate(this.id);
        this.inner?.renderer.focus();
    }

    /** Raster of this cell's chart (same pixels as the PNG download), or null. */
    screenshotCanvas(): HTMLCanvasElement | null {
        return this.inner?.renderer.screenshotCanvas() ?? null;
    }

    /** Download this cell's chart as a PNG (named after its market). */
    downloadScreenshot(): void {
        const url = this.inner?.renderer.screenshot();
        if (!url) return;
        const a = this.host.ownerDocument.createElement('a');
        a.href = url;
        a.download = `${this.symbol || 'chart'}-${this.timeframe}.png`;
        a.click();
    }

    // ── indicator ledger (shared manifest, per-cell instances) ──
    /**
     * Hand the cell the workspace's resolved manifest. A RESTORED ledger (pool or
     * persisted state) re-adds its recorded entries by name — held until the manifest
     * actually carries them. Otherwise `seedEnabled` auto-adds the manifest's `enabled`
     * entries (fresh cells only).
     */
    setManifest(list: readonly ResolvedIndicator[], seedEnabled: boolean): void {
        this.manifest = list;
        if (this.pendingManifestNames) {
            if (list.length === 0) return; // the manifest hasn't resolved yet — keep waiting
            for (const led of this.pendingManifestNames) {
                const entry = list.find((e) => e.name === ledgerEntryName(led));
                if (entry) this.addManifestInstance(entry, { record: false, ...(typeof led === 'object' ? { inputs: led.inputs, props: led.props } : {}) });
            }
            this.pendingManifestNames = null;
            return;
        }
        if (seedEnabled) {
            for (const entry of list) if (entry.enabled) this.addManifestInstance(entry, { record: false });
        }
    }

    /**
     * Replace the indicator ledger: natives converge to the listed set (volume
     * included — removing it sticks, the core's auto-add respects the opt-out), and
     * manifest instances are re-created by name, held until the shared manifest
     * resolves. Convergence is state application, not user edits — nothing enters the
     * undo timeline.
     */
    private applyIndicatorLedger(led: { manifest: LedgerManifestEntry[]; natives: string[] }): void {
        const chart = this.inner;
        if (!chart) return;
        this.volumeIntent = led.natives.includes('volume');
        this.history.silently(() => {
            const present = chart.presentNativeIndicators();
            for (const type of led.natives) {
                if (!present.includes(type)) chart.addNativeIndicator(type);
            }
            for (const type of present) {
                // addNativeIndicator on a present type returns the EXISTING handle.
                if (!led.natives.includes(type)) chart.addNativeIndicator(type).remove();
            }
            for (const it of [...this.instances]) this.dropInstance(it);
            if (this.manifest.length > 0) {
                for (const item of led.manifest) {
                    const entry = this.manifest.find((e) => e.name === ledgerEntryName(item));
                    if (entry)
                        this.addManifestInstance(entry, { record: false, ...(typeof item === 'object' ? { inputs: item.inputs, props: item.props } : {}) });
                }
                this.pendingManifestNames = null;
            } else if (!this.deps.manifestSettled()) {
                this.pendingManifestNames = [...led.manifest]; // consumed by setManifest on resolution
            } else {
                this.pendingManifestNames = null; // no manifest will ever resolve — never park names
            }
        });
        this.syncPresentNatives();
        this.refreshNativeCatalog();
    }

    /** The picker's library rows: supported natives first, then the manifest. */
    libraryRows(): Array<{ name: string; language?: string; category?: string; native?: boolean; nativeType?: string; beta?: boolean }> {
        return [
            ...this.nativeCatalog.filter((n) => n.supported).map((n) => ({ name: n.title, category: 'Vela', native: true, nativeType: n.type, beta: n.beta })),
            ...this.manifest.map((e) => ({ name: e.name, language: e.language, category: e.category })),
        ];
    }

    /** The picker's on-chart rows: present natives first, then live instances. */
    onChartRows(): Array<{ name: string; language?: string; native?: boolean; nativeType?: string }> {
        return [
            ...this.nativeCatalog.filter((n) => n.present).map((n) => ({ name: n.title, native: true, nativeType: n.type })),
            ...this.instances.map((it) => ({ name: it.entry.name, language: it.entry.language })),
        ];
    }

    /** Add by picker LIBRARY index (natives precede the manifest — mirrors libraryRows). */
    addFromLibrary(index: number): void {
        const natives = this.nativeCatalog.filter((n) => n.supported);
        if (index < natives.length) this.addNative(natives[index]!.type);
        else {
            const entry = this.manifest[index - natives.length];
            if (entry) this.addManifestInstance(entry);
        }
    }

    /** Remove by picker ON-CHART index (present natives precede instances). */
    removeFromChart(index: number): void {
        const present = this.nativeCatalog.filter((n) => n.present);
        if (index < present.length) this.removeNative(present[index]!.type);
        else this.removeInstance(index - present.length);
    }

    /**
     * Add a script indicator through the PUBLIC seam (`ctx.addIndicator`) — same undo/
     * redo and picker plumbing as a manifest entry, but flagged `external` so the
     * persisted ledger never records a name the manifest can't resolve (the plugin owns
     * persistence via `registerStatePersistence`). Recording follows the ambient mute:
     * a persistence handler's `restore` runs silently, a user-driven call records.
     */
    addExternalIndicator(entry: ExternalIndicatorEntry): void {
        this.addManifestInstance(
            { ...entry, enabled: true },
            { external: true, ...(entry.inputs ? { inputs: entry.inputs } : {}), ...(entry.props ? { props: entry.props } : {}) },
        );
    }

    /** Add ONE instance of a manifest entry (repeatable — duplicates are legitimate). */
    addManifestInstance(
        entry: ResolvedIndicator,
        opts: { record?: boolean; external?: boolean; inputs?: Record<string, InputValue>; props?: Record<string, InputValue> } = {},
    ): void {
        if (this.destroyed) return;
        const values = opts.inputs || opts.props ? { inputs: opts.inputs, props: opts.props } : undefined;
        const it: CellInstance = { entry, handle: this.addToChart(entry, values), ...(opts.external ? { external: true } : {}), ...(values ? { values } : {}) };
        this.instances.push(it);
        this.deps.onIndicatorsChanged(this.id);
        if (opts.record === false) return;
        const snapshot = it;
        this.history.push({
            undo: () => this.dropInstance(snapshot),
            redo: () => {
                snapshot.handle = this.addToChart(snapshot.entry, snapshot.values);
                this.instances.push(snapshot);
                this.deps.onIndicatorsChanged(this.id);
            },
        });
    }

    private removeInstance(index: number): void {
        const it = this.instances[index];
        if (!it || this.destroyed) return;
        this.dropInstance(it);
        const snapshot = it;
        this.history.push({
            undo: () => {
                snapshot.handle = this.addToChart(snapshot.entry, snapshot.values);
                this.instances.push(snapshot);
                this.deps.onIndicatorsChanged(this.id);
            },
            redo: () => this.dropInstance(snapshot),
        });
    }

    private dropInstance(it: CellInstance): void {
        const idx = this.instances.indexOf(it);
        if (idx >= 0) this.instances.splice(idx, 1);
        // Capture the deltas BEFORE removal — an undo/redo resurrection re-adds the
        // indicator with the values the user last saw, not the declaration defaults.
        const captured = instanceDeltas(it.handle);
        if (captured) it.values = captured;
        else delete it.values;
        try {
            it.handle?.remove();
        } catch {
            /* already gone */
        }
        it.handle = null;
        this.deps.onIndicatorsChanged(this.id);
    }

    /** Add a native indicator (single-instance per type — the core dedupes). */
    addNative(type: string): void {
        this.inner?.addNativeIndicator(type);
        this.syncPresentNatives();
        this.refreshNativeCatalog();
        this.history.push({
            undo: () => {
                this.inner?.addNativeIndicator(type).remove();
                this.refreshNativeCatalog();
            },
            redo: () => {
                this.inner?.addNativeIndicator(type);
                this.refreshNativeCatalog();
            },
        });
    }

    private removeNative(type: string): void {
        // addNativeIndicator on a present type returns the EXISTING handle. The undo
        // entry is recorded by the indicator:removed handler — the single site shared
        // with the legend ✕ and the object tree.
        this.inner?.addNativeIndicator(type).remove();
        this.refreshNativeCatalog();
    }

    /** Sync mirror of the chart's present native types — the removal handler diffs
     *  against it to identify (and record) whichever type was just removed. */
    private syncPresentNatives(): void {
        this.presentNatives = this.inner?.presentNativeIndicators() ?? [];
    }

    /** Refresh the native catalog (supported/present flags) for this cell's market. */
    refreshNativeCatalog(): void {
        const chart = this.inner;
        if (!chart) return;
        void chart.availableNativeIndicators().then((list) => {
            if (this.destroyed || this.inner !== chart) return;
            this.nativeCatalog = list.map((n) => ({ type: n.type, title: n.title, supported: n.supported, present: n.present, beta: n.beta }));
            this.deps.onIndicatorsChanged(this.id);
        });
    }

    private addToChart(entry: ResolvedIndicator, values?: { inputs?: Record<string, InputValue>; props?: Record<string, InputValue> }): IndicatorHandle | null {
        try {
            return (
                this.inner?.addIndicator(entry.script, {
                    ...(entry.language !== undefined ? { language: entry.language } : {}),
                    ...(values?.inputs ? { inputs: values.inputs } : {}),
                    ...(values?.props ? { props: values.props } : {}),
                }) ?? null
            );
        } catch (err) {
            console.warn(`[vela] indicator "${entry.name}" failed to add:`, err);
            return null;
        }
    }

    // ── third-party state (the `ext` seam) ──
    /** The cell-bound surface persistence handlers work against (built per call — the
     *  widget-context rule; nothing here may be cached by a handler). Its add methods
     *  are ALWAYS muted — a `restore` that fetches before adding escapes the sync mute
     *  of {@link restorePersistedExt}, and a state application must never enter the
     *  undo timeline, however late its continuation lands. */
    private stateContext(): CellStateContext {
        return {
            cellId: this.id,
            chart: this.chart,
            addIndicator: (entry) => this.history.silently(() => this.addExternalIndicator(entry)),
            addNativeIndicator: (type) => this.history.silently(() => this.addNative(type)),
        };
    }

    /**
     * Run the registered cell-scope `restore` handlers against the cell's restored
     * `ext` bag — the workspace calls this AFTER the core state is in place (chart
     * alive and wired, indicator ledger converged). Muted: nothing a restore does
     * enters the undo timeline. Handlers only see keys the document carries; a failing
     * handler is contained (one broken plugin must not take the cell down).
     */
    restorePersistedExt(): void {
        if (this.destroyed) return;
        for (const h of statePersistenceHandlers('cell')) {
            if (!(h.key in this.extState)) continue;
            try {
                this.history.silently(() => h.restore(this.extState[h.key], this.stateContext()));
            } catch (err) {
                console.warn(`[vela] state persistence "${h.key}" restore failed:`, err);
            }
        }
    }

    /** Assemble the cell's `ext` bag: fresh handler snapshots merged OVER the preserved
     *  entries — a key with no handler this session rides along verbatim; a registered
     *  handler returning `undefined` withdraws its entry. */
    private dehydrateExt(): Record<string, unknown> | undefined {
        const ext = { ...this.extState };
        for (const h of statePersistenceHandlers('cell')) {
            try {
                const value = h.serialize(this.stateContext());
                if (value === undefined) delete ext[h.key];
                else ext[h.key] = value;
            } catch (err) {
                console.warn(`[vela] state persistence "${h.key}" serialize failed:`, err);
            }
        }
        this.extState = ext; // the merged bag is the new baseline
        return Object.keys(ext).length > 0 ? ext : undefined;
    }

    // ── lifecycle ──
    /**
     * Apply a restored cell state IN PLACE — the chart instance survives (the market
     * switches via `setMarket`) while cosmetics, renderer config, drawings, and the
     * indicator ledger converge to the document. The workspace takes this path when a
     * state document lands on a grid of the same shape (async-storage boot, host
     * `applyState`), so chart references, indicator handles, event subscriptions, and
     * the cell host all stay valid.
     */
    rehydrate(cs: CellState): void {
        if (!this.inner || this.destroyed) return;
        if (cs.priceStyle && cs.priceStyle !== this.priceStyle) this.setPriceStyle(cs.priceStyle);
        if (cs.watermark !== undefined && cs.watermark !== this.watermarkOn) this.setWatermarkVisible(cs.watermark);
        if (cs.indicatorTitles !== undefined && cs.indicatorTitles !== this.indicatorTitlesOn) this.setIndicatorTitlesVisible(cs.indicatorTitles);
        if (cs.indicatorValues !== undefined && cs.indicatorValues !== this.indicatorValuesOn) this.setIndicatorValuesVisible(cs.indicatorValues);
        // Cosmetics + drawings round-trip (both validate untrusted input).
        if (cs.rendererConfig != null) this.inner.renderer.applyConfig(cs.rendererConfig);
        if (cs.drawings != null) this.inner.drawings.fromJSON(cs.drawings);
        if (cs.indicators) this.applyIndicatorLedger(cs.indicators as { manifest: LedgerManifestEntry[]; natives: string[] });
        // Third-party state converges to the document too: the restored bag REPLACES
        // the baseline (absent in the document = the document carries none), then the
        // registered handlers re-apply. After the ledger — a handler re-adding external
        // indicators must land on the converged (external-free) instance set.
        this.extState = { ...(cs.ext ?? {}) };
        this.restorePersistedExt();
        // Market last, as ONE in-place switch — `market:changed` re-syncs the cell
        // overlays and notifies the workspace (chrome projection, retention).
        const symbol = prefixedSymbol(cs);
        const session = normalizeSession(cs.session) ?? 'regular';
        const bars = typeof cs.bars === 'number' && Number.isFinite(cs.bars) && cs.bars > 0 ? cs.bars : 0;
        const next: { symbol?: string; timeframe?: string; bars?: number; session?: MarketSession } = {};
        if (symbol && symbol !== this.symbol) next.symbol = symbol;
        if (cs.timeframe && cs.timeframe !== this.timeframe) next.timeframe = cs.timeframe;
        if (session !== this.session) {
            this.state.session = session;
            next.session = session;
        }
        if (bars > 0 && bars !== this.state.bars) {
            this.state.bars = bars;
            next.bars = Math.max(bars, this.rangeBars);
        }
        if (Object.keys(next).length > 0) void this.inner.setMarket(next);
    }

    /** Snapshot everything the pool needs to restore this slot later. The market fields
     *  come from the LIVE config (`chart.market`) — the requested identity — so a switch
     *  still loading when the snapshot is taken (persist-on-close) is not lost. */
    dehydrate(): PooledCellState {
        // Identity from the live config; depth (`bars`) stays the cell's own durable
        // budget — in range mode the config carries the chip's transient fetch budget.
        const live = this.inner?.market;
        const ext = this.inner ? this.dehydrateExt() : Object.keys(this.extState).length > 0 ? { ...this.extState } : undefined;
        return {
            ...this.state,
            ...(live ? { symbol: live.symbol, provider: live.provider, timeframe: live.timeframe } : {}),
            priceStyle: this.priceStyle,
            watermark: this.watermarkOn,
            indicatorTitles: this.indicatorTitlesOn,
            indicatorValues: this.indicatorValuesOn,
            rendererConfig: this.inner?.renderer.getConfig() ?? undefined,
            drawings: this.inner ? this.inner.drawings.toJSON() : undefined,
            // Natives from the chart's SYNC registry read — an async catalog mirror here
            // lost unload-time saves, and the old empty-set fallbacks resurrected removed
            // indicators. Manifest names fall back to the restored ledger only until the
            // shared manifest settles. See {@link indicatorLedger}. External instances
            // (`ctx.addIndicator`) stay out: their names would never resolve against the
            // manifest — their plugin persists them via the `ext` seam instead.
            indicators: indicatorLedger({
                present: this.inner ? this.inner.presentNativeIndicators() : [],
                instanceEntries: this.instances
                    .filter((it) => !it.external)
                    .map((it) => {
                        // LIVE deltas from the handle; a handle-less instance (add failed)
                        // keeps whatever values it was restored with.
                        const d = it.handle ? instanceDeltas(it.handle) : it.values;
                        return d ? { name: it.entry.name, ...d } : it.entry.name;
                    }),
                pendingManifest: this.pendingManifestNames,
                manifestSettled: this.deps.manifestSettled(),
                volumePending: this.volumeMayBePending && this.volumeIntent,
            }),
            ...(ext ? { ext } : {}),
        };
    }

    destroy(): void {
        this.destroyed = true;
        this.offMarket();
        this.cellControls.destroy();
        this.contextMenu.destroy();
        this.history.destroy();
        this.marketStatus?.stop();
        this.sessionShading.stop();
        this.statusline?.destroy();
        this.watermark?.destroy();
        this.inner?.destroy();
        this.inner = null;
        this.host.remove();
    }
}
