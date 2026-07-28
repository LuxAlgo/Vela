// One workspace CELL — a stable SLOT identity (`c1`…`cN`) holding a full Vela chart
// plus its per-cell overlays and per-cell state: statusline, watermark, context menu,
// its own undo timeline, and its indicator ledger (shared manifest, per-cell
// instances). The id never derives from content: symbol/timeframe/style are mutable
// state, switched IN PLACE via `chart.setMarket` (the chart instance survives every
// market change and only dies with the cell itself, on a layout change — its state
// then round-trips through the workspace pool, so shrinking 4 → 2 → 4 restores
// `c3`/`c4` exactly, indicators and drawings included).
import { Vela } from '../Vela';
import type { VelaTheme, NativeBackend } from '../core/options';
import type { MarketDataFeed } from '../core/ports/MarketDataFeed';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import { Statusline } from '../widget/statusline';
import { Watermark } from '../widget/watermark';
import { ChartContextMenu } from '../widget/context-menu';
import { WidgetHistory } from '../widget/history';
import type { RangePreset } from '../widget/bottombar';
import type { ResolvedIndicator } from '../widget/indicators';
import type { WidgetContext } from '../widget/contributions';
import type { CellState } from '../state/document';

/** The seed/mutable market state of one cell (all optional — an empty cell parks). */
export interface CellSeed {
    symbol?: string;
    provider?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
}

/** A destroyed cell's state, kept by the workspace pool so its slot restores later —
 *  the per-cell entry of the SHARED state document (`src/state/document.ts`). */
export type PooledCellState = CellState;

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
    /** The live widget-context builder (per-cell context menus project contributed actions). */
    context(): WidgetContext;
    /** Report a pointer-down/focus in this cell (the workspace sets it active). */
    activate(id: string): void;
    /** The cell's market changed in place (chrome/retention refresh upstream). */
    onMarketChanged(id: string): void;
    /** The cell's indicator ledger changed (count/picker refresh upstream). */
    onIndicatorsChanged(id: string): void;
    /** Persistable per-cell state changed outside the market/indicator channels
     *  (bars budget, watermark toggle) — the workspace debounces a save. */
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

    private inner: Vela | null;
    private readonly statusline: Statusline | null;
    private readonly watermark: Watermark | null;
    private readonly contextMenu: ChartContextMenu;
    private readonly offMarket: () => void;
    private state: CellSeed;
    private manifest: readonly ResolvedIndicator[] = [];
    /** A restored ledger's manifest entry NAMES, waiting for the manifest to resolve
     *  (a pool/persisted cell can be built before the shared manifest has loaded). */
    private pendingManifestNames: string[] | null = null;
    /** Restored natives not yet visible in the async catalog — `dehydrate` fallback. */
    private seedNatives: string[] | null = null;
    private rangeBars = 0;
    private pendingRange: RangePreset | null = null;
    private watermarkOn: boolean;
    private destroyed = false;

    constructor(
        readonly id: string,
        gridHost: HTMLElement,
        seed: PooledCellState,
        private readonly deps: CellDeps,
    ) {
        this.state = { symbol: seed.symbol, provider: seed.provider, timeframe: seed.timeframe, priceStyle: seed.priceStyle, bars: seed.bars };
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
                provider: seed.provider,
                symbol: seed.symbol,
                timeframe: seed.timeframe,
                bars: seed.bars,
                priceStyle: seed.priceStyle,
                theme: deps.theme,
                live: deps.live,
                // A RESTORED ledger is authoritative for the auto-added volume too: a
                // slot persisted without it must come back without it (fresh slots
                // keep the workspace default).
                volume: seed.indicators ? seed.indicators.natives.includes('volume') : deps.volume,
                nativeBackend: deps.nativeBackend,
                // One SHARED toolbar serves the whole workspace (it lands with the shared
                // chrome); per-cell bars would cost a 44px gutter in every cell.
                drawings: { toolbar: false },
            },
            { dataFeed: deps.feed },
        );
        for (const [language, make] of Object.entries(deps.engines)) this.inner.registerEngine(language, make());
        // ONE attribution mark per WORKSPACE, not per cell: each cell disables its own
        // in-chart mark; the workspace mounts the single grid-level mark that satisfies
        // the NOTICE's equivalent-visible-attribution requirement.
        this.inner.renderer.set('attribution', false);
        // Modal dialogs (chart settings, indicator settings) escape the cell's
        // overflow clip and center over the whole grid.
        this.inner.renderer.set('dialogHost', deps.dialogHost);
        // Pool restore: cosmetics + drawings round-trip (both validate untrusted input).
        if (seed.rendererConfig != null) this.inner.renderer.applyConfig(seed.rendererConfig);
        if (seed.drawings != null) this.inner.drawings.fromJSON(seed.drawings);
        // A restored ledger: natives re-add immediately (no manifest needed); manifest
        // entries wait for setManifest (the shared manifest may still be resolving).
        // Both halves stay reported by `dehydrate` until they materialize, so an early
        // snapshot (persist flush racing the async resolutions) never wipes them.
        if (seed.indicators) {
            for (const type of seed.indicators.natives) this.inner.addNativeIndicator(type);
            this.pendingManifestNames = [...seed.indicators.manifest];
            this.seedNatives = [...seed.indicators.natives];
        }
        const tz = deps.timezone();
        if (tz !== 'Etc/UTC') this.inner.renderer.set('timezone', tz);

        this.watermarkOn = seed.watermark ?? deps.watermark;
        this.watermark = deps.watermark ? new Watermark(this.host, seed.symbol ?? '', seed.timeframe ?? '60') : null;
        if (!this.watermarkOn) this.watermark?.setVisible(false);
        this.statusline = deps.statusline ? new Statusline(this.host, seed.symbol ?? '') : null;
        this.statusline?.setMeta(seed.timeframe ?? '60', seed.provider ?? '');
        this.statusline?.onChart(this.inner);
        this.contextMenu = new ChartContextMenu(this.host, {
            screenshot: () => this.downloadScreenshot(),
            resetView: () => this.inner?.renderer.set('autoScale', true),
            // Right-clicking activates the cell first (capture-phase pointerdown), so the
            // context the actions receive is this cell's — the active one.
            getContext: () => this.deps.context(),
        });
        this.contextMenu.onChart(this.inner);
        this.inner.renderer.onCrosshairMove((e) => {
            this.lastCrossTime = e.time;
            this.lastCrossPrice = e.price;
        });
        this.inner.on('indicator:added', () => this.refreshNativeCatalog());
        this.inner.on('indicator:removed', ({ id }) => {
            // Out-of-band removals (legend ✕, object tree, handle.remove()) must drop
            // the matching manifest-instance ledger entry too — a stale entry kept the
            // name in the persisted document and resurrected the indicator on reload.
            // The picker path splices first, so this lookup no-ops there (idempotent).
            const idx = this.instances.findIndex((it) => it.handle?.id === id);
            if (idx >= 0) this.instances.splice(idx, 1);
            this.refreshNativeCatalog();
        });
        this.refreshNativeCatalog();

        // HOST settings sections — the same set the widget contributes, per cell
        // (the shared topbar gear opens the ACTIVE cell's dialog): status line parts,
        // the per-cell fetch depth, and the per-cell watermark toggle. Bars/watermark
        // are persistable cell state; a depth-only reload is silent, so mark dirty here.
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
                        { kind: 'toggle', label: 'Symbol name', get: () => sl.partVisible('name'), set: (v: boolean) => sl.setPartVisible('name', v) },
                        { kind: 'toggle', label: 'Market status', get: () => sl.partVisible('market'), set: (v: boolean) => sl.setPartVisible('market', v) },
                        { kind: 'toggle', label: 'OHLC values', get: () => sl.partVisible('ohlc'), set: (v: boolean) => sl.setPartVisible('ohlc', v) },
                        { kind: 'toggle', label: 'Bar change values', get: () => sl.partVisible('change'), set: (v: boolean) => sl.setPartVisible('change', v) },
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
            this.state.timeframe = timeframe;
            this.watermark?.update(symbol, timeframe);
            this.statusline?.setSymbol(symbol);
            this.statusline?.setMeta(timeframe, this.state.provider ?? '');
            if (this.inner) this.statusline?.onChart(this.inner); // drop the old market's resting OHLC
            this.refreshNativeCatalog(); // per-symbol support flags may differ
            this.deps.onMarketChanged(this.id);
        });
    }

    /** Show/hide this cell's symbol watermark (persisted per cell). */
    setWatermarkVisible(visible: boolean): void {
        this.watermarkOn = visible;
        this.watermark?.setVisible(visible);
        this.deps.onStateDirty();
    }

    /** The LIVE chart of this cell — never cache it across a layout change (the cell's
     *  slot id is the durable identity; the chart dies with the cell). */
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
        // addNativeIndicator on a present type returns the EXISTING handle.
        this.inner?.addNativeIndicator(type).remove();
        this.refreshNativeCatalog();
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

    /** Refresh the native catalog (supported/present flags) for this cell's market. */
    refreshNativeCatalog(): void {
        const chart = this.inner;
        if (!chart) return;
        void chart.availableNativeIndicators().then((list) => {
            if (this.destroyed || this.inner !== chart) return;
            this.nativeCatalog = list.map((n) => ({ type: n.type, title: n.title, supported: n.supported, present: n.present, beta: n.beta }));
            if (this.nativeCatalog.some((n) => n.present)) this.seedNatives = null; // materialized — the live catalog is the truth now
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
            rendererConfig: this.inner?.renderer.getConfig() ?? undefined,
            drawings: this.inner ? this.inner.drawings.toJSON() : undefined,
            indicators: (() => {
                // A restored ledger still waiting for its async halves (shared-manifest
                // resolution, native-catalog probe) must not be wiped by an early save.
                const present = this.nativeCatalog.filter((n) => n.present).map((n) => n.type);
                return {
                    manifest: this.instances.length > 0 ? this.instances.map((it) => it.entry.name) : (this.pendingManifestNames ?? []),
                    natives: present.length > 0 ? present : (this.seedNatives ?? []),
                };
            })(),
        };
    }

    destroy(): void {
        this.destroyed = true;
        this.offMarket();
        this.contextMenu.destroy();
        this.history.destroy();
        this.statusline?.destroy();
        this.watermark?.destroy();
        this.inner?.destroy();
        this.inner = null;
        this.host.remove();
    }
}
