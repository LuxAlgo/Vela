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
import { Statusline, statuslineInkOf } from '../widget/statusline';
import { MarketStatusTracker } from '../widget/market-status';
import { Watermark } from '../widget/watermark';
import { ChartContextMenu } from '../widget/context-menu';
import { WidgetHistory } from '../widget/history';
import type { RangePreset } from '../widget/bottombar';
import { indicatorLedger, type ResolvedIndicator } from '../widget/indicators';
import { legendActionsProviderFor, resolveEngines, type WidgetContext } from '../widget/contributions';
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
    'renderer' | 'defaultLanguage' | 'currentPriceLine' | 'logScale' | 'animations' | 'glow' | 'upColor' | 'downColor' | 'drawings'
>;

/** The {@link CellChartDefaults} pick of a workspace's options (pure, for the build). */
export function cellChartDefaults(opts: CellChartDefaults): CellChartDefaults {
    const { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings } = opts;
    return { renderer, defaultLanguage, currentPriceLine, logScale, animations, glow, upColor, downColor, drawings };
}

/** The cell form of the shell's `drawings` option: everything passes through EXCEPT the
 *  toolbar — ONE shared bar serves the grid (per-cell bars would cost a 44px gutter
 *  each). An explicit `false` stays an opt-out (the headless `chart.drawings` API only). */
export function cellDrawings(opt: DrawingsOption | undefined): DrawingsOption {
    if (opt === false) return false;
    if (opt === true || opt == null) return { toolbar: false };
    return { ...opt, toolbar: false };
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
    /** The cell's market changed in place (chrome/retention refresh upstream). */
    onMarketChanged(id: string): void;
    /** The cell's indicator ledger changed (count/picker refresh upstream). */
    onIndicatorsChanged(id: string): void;
    /** Persistable per-cell state changed outside the market/indicator channels
     *  (bars budget, watermark/titles toggles) — the workspace debounces a save. */
    onStateDirty(): void;
}

export class ChartCell {
    /** The grid item this cell renders into (owned; removed on destroy). */
    readonly host: HTMLElement;
    /** This cell's unified app+drawings undo timeline (the shared Ctrl+Z routes here). */
    readonly history = new WidgetHistory(() => this.inner);
    /** Live manifest-indicator instances on this cell (the SAME entry may repeat). */
    readonly instances: Array<{ entry: ResolvedIndicator; handle: IndicatorHandle | null }> = [];
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
    private readonly watermark: Watermark | null;
    private readonly contextMenu: ChartContextMenu;
    private readonly offMarket: () => void;
    /** The cell's durable market state — the seed vocabulary plus the venue mirror the
     *  persisted document carries (`provider` = the symbol's parsed prefix). */
    private state: CellSeed & Pick<CellState, 'provider'>;
    private manifest: readonly ResolvedIndicator[] = [];
    /** A restored ledger's manifest entry NAMES, waiting for the manifest to resolve
     *  (a pool/persisted cell can be built before the shared manifest has loaded). */
    private pendingManifestNames: string[] | null = null;
    /** The volume auto-add rides the cell's first candles (`load:end`); until then the
     *  registry can't show it and the dehydrated ledger reports the INTENT instead. */
    private volumeMayBePending = true;
    /** Volume intent: the seed's ledger, else the workspace `volume` option. */
    private readonly volumeIntent: boolean;
    /** Sync mirror of the chart's present native types — the removal handler diffs
     *  against it to identify (and record) whichever type was just removed. */
    private presentNatives: string[] = [];
    private rangeBars = 0;
    private pendingRange: RangePreset | null = null;
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
        this.state = { symbol, provider: parseSymbol(symbol ?? '').provider ?? undefined, timeframe: seed.timeframe, priceStyle: seed.priceStyle, bars: seed.bars, session: normalizeSession(seed.session) };
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
            this.pendingManifestNames = [...seed.indicators.manifest];
        }
        this.volumeIntent = seed.indicators ? seed.indicators.natives.includes('volume') : deps.volume;
        // The volume auto-add rides the cell's first candles — from `load:end` on, the
        // registry is the whole truth and the dehydrated ledger stops reporting intent.
        this.inner.on('load:end', () => {
            this.volumeMayBePending = false;
        });
        // The loading affordance and the watermark never share the canvas.
        this.inner.on('load:start', () => this.watermark?.setLoading(true));
        this.inner.on('load:end', () => this.watermark?.setLoading(false));
        const tz = deps.timezone();
        if (tz !== 'Etc/UTC') this.inner.renderer.set('timezone', tz);

        this.indicatorTitlesOn = seed.indicatorTitles ?? true;
        if (!this.indicatorTitlesOn) this.inner.renderer.set('indicatorTitles', false);
        this.indicatorValuesOn = seed.indicatorValues ?? true;
        if (!this.indicatorValuesOn) this.inner.renderer.set('indicatorValues', false);
        this.watermarkOn = seed.watermark ?? deps.watermark;
        this.watermark = deps.watermark ? new Watermark(this.host, symbol ?? '', seed.timeframe ?? '60') : null;
        if (!this.watermarkOn) this.watermark?.setVisible(false);
        this.statusline = deps.statusline ? new Statusline(this.host, symbol ?? '') : null;
        this.statusline?.setMeta(seed.timeframe ?? '60', this.state.provider ?? '');
        this.statusline?.onChart(this.inner);
        this.marketStatus = this.statusline ? new MarketStatusTracker((s) => this.statusline?.setMarketStatus(s)) : null;
        // The venue chip above is provisional (persisted/typed prefix): once the shared
        // feed's indexes settle, re-derive it from the DATA — a cell restored as
        // `edgx:AAPL` must come back up reading NASDAQ.
        void this.inner.data.ready().then(() => {
            if (this.inner && this.state.symbol) this.statusline?.setMeta(this.state.timeframe ?? '60', this.inner.data.displayPrefix(this.state.symbol) ?? this.state.provider ?? '');
            this.refreshSessionAvailable();
            if (this.inner && this.state.symbol) this.marketStatus?.track(this.inner.data, this.state.symbol);
        });
        this.syncStatuslineColors();
        this.contextMenu = new ChartContextMenu(this.host, {
            resetView: () => {
                this.inner?.renderer.set('autoScale', true);
                this.inner?.setVisibleRangePreset('ALL');
            },
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
                        snapshot.handle = this.addToChart(snapshot.entry);
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
        // (the shared topbar gear opens the ACTIVE cell's dialog): status line parts,
        // the per-cell fetch depth, and the per-cell watermark/titles toggles.
        // Bars/watermark/titles are persistable cell state; a depth-only reload is
        // silent, so mark dirty here.
        const advanced = {
            title: 'Advanced',
            placement: 'end' as const,
            rows: [
                {
                    kind: 'select' as const,
                    label: 'Bars to fetch',
                    options: ['500', '1000', '2000', '5000', '10000', '20000'],
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
            placement: 'symbol' as const,
            rows: [
                {
                    kind: 'toggle' as const,
                    label: 'Symbol watermark',
                    get: () => this.watermarkOn,
                    set: (v: boolean) => this.setWatermarkVisible(v),
                },
            ],
        };
        if (this.statusline) {
            const sl = this.statusline;
            this.inner.renderer.setSettingsSections([
                {
                    title: 'Status line',
                    rows: [
                        { kind: 'heading', label: 'Status line' },
                        { kind: 'toggle', label: 'Symbol name', get: () => sl.partVisible('name'), set: (v: boolean) => sl.setPartVisible('name', v) },
                        { kind: 'toggle', label: 'Market status', get: () => sl.partVisible('market'), set: (v: boolean) => sl.setPartVisible('market', v) },
                        { kind: 'toggle', label: 'OHLC values', get: () => sl.partVisible('ohlc'), set: (v: boolean) => sl.setPartVisible('ohlc', v) },
                        { kind: 'toggle', label: 'Bar change values', get: () => sl.partVisible('change'), set: (v: boolean) => sl.setPartVisible('change', v) },
                        { kind: 'heading', label: 'Indicators' },
                        {
                            kind: 'toggle',
                            label: 'Titles',
                            get: () => this.indicatorTitlesOn,
                            set: (v: boolean) => this.setIndicatorTitlesVisible(v),
                        },
                        {
                            kind: 'toggle',
                            label: 'Values',
                            get: () => this.indicatorValuesOn,
                            set: (v: boolean) => this.setIndicatorValuesVisible(v),
                        },
                    ],
                },
                advanced,
                watermarkSection,
            ]);
        } else {
            this.inner.renderer.setSettingsSections([advanced, watermarkSection]);
        }

        // The ONE bookkeeping seam: every market change — cell setters, sync links, or
        // host code calling chart.setMarket directly — lands here and updates the cell
        // state + overlays, then notifies the workspace (chrome projection, retention).
        this.offMarket = this.inner.on('market:changed', ({ symbol, timeframe }) => {
            this.state.symbol = symbol;
            this.state.provider = parseSymbol(symbol).provider ?? undefined;
            this.state.timeframe = timeframe;
            this.state.session = normalizeSession(this.inner?.market.session);
            this.watermark?.update(symbol, timeframe);
            this.statusline?.setSymbol(symbol);
            this.statusline?.setMeta(timeframe, this.inner?.data.displayPrefix(symbol) ?? this.state.provider ?? '');
            if (this.inner) this.statusline?.onChart(this.inner); // drop the old market's resting OHLC
            this.refreshNativeCatalog(); // per-symbol support flags may differ
            this.refreshSessionAvailable(); // the new symbol may (not) have sessions
            if (this.inner) this.marketStatus?.track(this.inner.data, symbol); // …and its own market clock
            this.deps.onMarketChanged(this.id);
        });
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
            }
        });
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
    }

    /** Show/hide the plot values beside this cell's legend titles (persisted per cell). */
    setIndicatorValuesVisible(visible: boolean): void {
        this.indicatorValuesOn = visible;
        this.inner?.renderer.set('indicatorValues', visible);
        this.deps.onStateDirty();
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

    /** Switch this cell's market in place (the chart instance survives). */
    setSymbol(symbol: string): void {
        if (!this.inner || symbol === this.symbol) return;
        void this.inner.setMarket({ symbol });
    }

    setTimeframe(timeframe: string): void {
        if (!this.inner || timeframe === this.timeframe) return;
        // Leaving range mode: drop the chip AND its fetch budget (back to the cell's own bars).
        this.activeRangeId = null;
        this.rangeBars = 0;
        void this.inner.setMarket({ timeframe, bars: this.state.bars });
    }

    /** Applied live (renderer feature) — no reload. */
    setPriceStyle(style: string): void {
        this.state.priceStyle = style;
        this.inner?.renderer.set('priceStyle', style);
        this.syncStatuslineColors(); // the OHLC ink follows the newly active style's colors
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

    /** Make this cell the active one and put keyboard focus on its chart surface. */
    focus(): void {
        this.deps.activate(this.id);
        this.inner?.renderer.focus();
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
            for (const name of this.pendingManifestNames) {
                const entry = list.find((e) => e.name === name);
                if (entry) this.addManifestInstance(entry, { record: false });
            }
            this.pendingManifestNames = null;
            return;
        }
        if (seedEnabled) {
            for (const entry of list) if (entry.enabled) this.addManifestInstance(entry, { record: false });
        }
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

    /** Add ONE instance of a manifest entry (repeatable — duplicates are legitimate). */
    addManifestInstance(entry: ResolvedIndicator, opts: { record?: boolean } = {}): void {
        if (this.destroyed) return;
        const it = { entry, handle: this.addToChart(entry) };
        this.instances.push(it);
        this.deps.onIndicatorsChanged(this.id);
        if (opts.record === false) return;
        const snapshot = it;
        this.history.push({
            undo: () => this.dropInstance(snapshot),
            redo: () => {
                snapshot.handle = this.addToChart(snapshot.entry);
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
                snapshot.handle = this.addToChart(snapshot.entry);
                this.instances.push(snapshot);
                this.deps.onIndicatorsChanged(this.id);
            },
            redo: () => this.dropInstance(snapshot),
        });
    }

    private dropInstance(it: { entry: ResolvedIndicator; handle: IndicatorHandle | null }): void {
        const idx = this.instances.indexOf(it);
        if (idx >= 0) this.instances.splice(idx, 1);
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

    private addToChart(entry: ResolvedIndicator): IndicatorHandle | null {
        try {
            return this.inner?.addIndicator(entry.script, entry.language !== undefined ? { language: entry.language } : undefined) ?? null;
        } catch (err) {
            console.warn(`[vela] indicator "${entry.name}" failed to add:`, err);
            return null;
        }
    }

    // ── lifecycle ──
    /** Snapshot everything the pool needs to restore this slot later. The market fields
     *  come from the LIVE config (`chart.market`) — the requested identity — so a switch
     *  still loading when the snapshot is taken (persist-on-close) is not lost. */
    dehydrate(): PooledCellState {
        // Identity from the live config; depth (`bars`) stays the cell's own durable
        // budget — in range mode the config carries the chip's transient fetch budget.
        const live = this.inner?.market;
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
            // shared manifest settles. See {@link indicatorLedger}.
            indicators: indicatorLedger({
                present: this.inner ? this.inner.presentNativeIndicators() : [],
                instanceNames: this.instances.map((it) => it.entry.name),
                pendingManifest: this.pendingManifestNames,
                manifestSettled: this.deps.manifestSettled(),
                volumePending: this.volumeMayBePending && this.volumeIntent,
            }),
        };
    }

    destroy(): void {
        this.destroyed = true;
        this.offMarket();
        this.contextMenu.destroy();
        this.history.destroy();
        this.marketStatus?.stop();
        this.statusline?.destroy();
        this.watermark?.destroy();
        this.inner?.destroy();
        this.inner = null;
        this.host.remove();
    }
}
