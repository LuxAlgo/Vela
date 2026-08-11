// VelaWorkspace — the multi-chart shell: a CSS-Grid of ChartCells behind ONE shared
// data feed, wrapped in ONE shared chrome (topbar + layout dropdown, pickers, object
// tree, bottombar, keymap, alerts) that PROJECTS the ACTIVE cell and acts on it.
//
// The projection rule has exactly two triggers, and the chrome holds no state of its
// own: ① on `cell:active` the chrome rebinds wholesale (`projectActiveCell`); ② a
// cell's own events re-project only while that cell IS the active one (alerts are the
// exception — always aggregated, tagged by cell). Statusline/watermark/context-menu/
// undo-history are per-cell; everything else is shared.
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { VelaTheme, NativeBackend, VelaOptions } from '../core/options';
import type { VelaShellOptions } from '../widget/shell-options';
import { resolveTheme } from '../core/theme';
import { TypedEventBus } from '../core/events/EventBus';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import { sharedBarStore } from '../data/BarStore';
import { ensureUIHost, injectStyles, registerIcon, svg16 } from '../ui';
import { isEditableTarget, KeymapManager } from '../ui/keymap';
import { Menu } from '../ui/components/menu';
import type { Vela } from '../Vela';
import { Topbar, priceStyleLabel, priceStyleIcon } from '../widget/topbar';
import { Bottombar, RANGE_PRESETS } from '../widget/bottombar';
import { ObjectTree } from '../widget/object-tree';
import { DataWindow } from '../widget/data-window';
import type { ScriptRun } from '../core/script-run';
import { PanelDock } from '../widget/panel-dock';
import { SymbolPicker } from '../widget/symbol-picker';
import { IndicatorPicker } from '../widget/indicator-picker';
import { TimeframeQuick } from '../widget/timeframe-quick';
import { ShortcutsHelp } from '../widget/shortcuts-help';
import { Toast } from '../widget/toast';
import { Glider, ZOOM_IN, ZOOM_OUT, PAN_FAST } from '../widget/glide';
import { toolShortcutHints } from '../widget/tool-shortcuts';
import { legendActionsProviderFor, widgetActions, widgetAttachments } from '../widget/contributions';
import { LayoutModeController, type LayoutMode } from '../widget/layout-mode';
import { MobileBar } from '../widget/mobile-bar';
import { TimeframeDrawer } from '../widget/timeframe-drawer';
import { DrawingsDrawer } from '../widget/drawings-drawer';
import { MoreDrawer } from '../widget/more-drawer';
import { TimezoneDrawer } from '../widget/timezone-drawer';
import { PriceScaleDrawer } from '../widget/price-scale-drawer';
import { DrawingPill } from '../widget/drawing-pill';
import { priceStyleIds } from '../renderers/native/core/chartConfig';
import { resolveIndicators, type IndicatorManifest, type ResolvedIndicator } from '../widget/indicators';
import { DrawingToolbar } from '../renderers/native/drawings/DrawingToolbar';
import { applyAttributionMarkTheme, createAttributionMark, createCustomMark } from '../renderers/native/chrome/AttributionMark';
import { rendererDefaults } from '../core/renderer-defaults';
import { defaultToolbar, type DrawingTypeKey, type SerializedDrawing, type SnapMode } from '../core/drawings';
import { timeframeToMs } from '../data/timeframe';
import { syncTargets, rangesWithin, type SyncKind, type SyncOptions, type SyncSetting } from './sync';
import { encodeState, decodeState, sanitizeState, type WorkspaceState, type WorkspaceStorage } from './persist';
import { localStorageAdapter } from '../widget/persist';
import { ChartCell, seedDefaults, cellChartDefaults, type CellSeed, type CellBoot, type PooledCellState } from './ChartCell';
import { buildContext, type WorkspaceWidgetContext } from './context';
import {
    registerBuiltinLayouts,
    layouts,
    gridStyles,
    activeAfterLayout,
    orderAfterLayout,
    ensureLayout,
    layoutForGrid,
    layoutShape,
    occupancyGrid,
    type LayoutDefinition,
    type TrackSizes,
} from './layouts';
import { SplitterLayer, evenTracks } from './splitters';

/**
 * The workspace options: the widget's chart vocabulary + the shared shell surface + the
 * grid's own options. Every chart option given TOP-LEVEL (symbol, timeframe, priceStyle,
 * upColor, glow, defaultLanguage, …) is the DEFAULT of each cell — `cells` overrides it
 * per cell with the same words. `height` is the one chart option a grid cannot honor
 * (the layout sizes cells), so it is omitted from the type.
 */
export interface VelaWorkspaceOptions extends Omit<VelaOptions, 'height'>, VelaShellOptions {
    /** Initial layout — a registered id (`'1'`, `'2h'`, `'2v'`, `'4'`, `'8'`, or a
     *  plugin-registered one) or an inline definition. Default `'4'`. */
    layout?: string | LayoutDefinition;
    /** Per-cell overrides of the top-level chart defaults, keyed by a FREE-FORM cell
     *  name — the name is the cell's durable IDENTITY (persistence, `sync` groups,
     *  `ws.cell(name)`), never its position: DECLARATION ORDER fills the layout's
     *  slots (first declared → first slot). Fewer entries than slots ⇒ the remaining
     *  slots boot on the defaults (auto identity); more ⇒ the extras wait in the pool
     *  and appear when a larger layout reveals them. Purely-numeric names are rejected
     *  (JS object keys would reorder them). Same vocabulary as the widget, reduced to
     *  the per-cell seeds ({@link CellSeed}). */
    cells?: Record<string, CellSeed>;
    /** The ONE shared drawing toolbar, docked left of the grid and acting on the active
     *  cell (per-cell in-chart bars stay hidden either way; a `drawings` object still
     *  configures tools/persistence per cell). Default true. */
    drawingToolbar?: boolean;
    /** Sync links between cells: per kind, `true` = all cells, or a `{cellId: group}`
     *  record (only same-group cells follow each other). `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also toggleable from the
     *  layout dropdown); `drawings` copies each newly created drawing onto the
     *  followers and keeps the set linked — edits and removals follow (also
     *  toggleable from the shared drawing toolbar). Default: everything off.
     *  Change at runtime via `ws.sync.set(kind, setting)`. */
    sync?: SyncOptions;
    /** Above this many cells, EVERY cell uses the canvas2d backend (uniform look inside
     *  the browser's WebGL-context budget; glow is unavailable there). Default 8; an
     *  explicit `nativeBackend` other than `'auto'` wins over this policy. */
    maxWebglCells?: number;
}

/** A cell's {@link ScriptRun}, tagged with the cell it ran in. */
export type WorkspaceScriptRun = ScriptRun & { cell: string };

export interface WorkspaceEventMap extends Record<string, unknown> {
    /** The active cell changed (click/focus in a cell, or `setActiveCell`). */
    'cell:active': { id: string; prev: string | null };
    /**
     * A script computed in ANY cell — the per-chart `script:run` relayed up with its cell
     * identity, so one subscription covers the whole grid, cells added by a later layout
     * change included.
     */
    'script:run': WorkspaceScriptRun;
    /** The grid switched layouts (cells created/destroyed/restored around it). */
    'layout:changed': { layout: string };
    'cell:created': { id: string };
    'cell:destroyed': { id: string };
    /** The persistable state changed (debounced ~500ms) — re-pull `getState()` if you
     *  consume it. The signal custom persistence flows build on. */
    'state:changed': undefined;
}

const DEFAULT_TIMEFRAMES = ['1', '5', '15', '60', '240', 'D', 'W'];
const GAP_PX = 2; // grid gap — the visible seam between cells (splitter strips center on it)
const POOL_CAP = 16; // dormant slot states kept across layout shrinks
const TIME_AXIS_H = 22; // px the renderer reserves for a time axis (mirrors NativeRenderer's)
const ALERT_CAP = 50;

const STYLE_ID = 'vela-workspace';
const CSS = `
.vela-workspace { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--vela-bg); }
.vela-ws-main { position: relative; display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; }
.vela-ws-toolbar { position: relative; flex: none; }
.vela-ws-grid { position: relative; flex: 1 1 auto; min-width: 0; display: grid; gap: ${GAP_PX}px; background: var(--vela-border-soft); }
.vela-cell { background: var(--vela-bg); position: relative; }
/* Active-cell highlight: an overlay ring ABOVE the chart's own canvas stack (a plain
   outline on the cell is painted under them) — inert to the pointer. Scoped to
   multi-cell grids ([data-multi]): a single-cell layout always has an active cell,
   and ringing the only chart would just be noise. */
.vela-ws-grid[data-multi='1'] .vela-cell[data-active='1']::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--vela-fg-bright);
    pointer-events: none;
    z-index: 10;
}
/* Splitter hover mirrors the in-chart pane separator hover (CrosshairRenderer):
   a soft band over the whole grab target + a solid 2px line on the seam center. */
.vela-ws-splitter:hover { background: var(--vela-separator-hover-band); }
.vela-ws-splitter:hover::after { content: ''; position: absolute; background: var(--vela-separator-hover-line); }
.vela-ws-splitter[data-axis='cols']:hover::after { left: calc(50% - 1px); top: 0; width: 2px; height: 100%; }
.vela-ws-splitter[data-axis='rows']:hover::after { top: calc(50% - 1px); left: 0; height: 2px; width: 100%; }
/* Mobile: the docked drawing-toolbar column would eat a phone-width grid — the shell's
   drawings drawer + on-chart pill replace it (same policy as the widget's in-chart bar). */
[data-layout='mobile'] .vela-ws-toolbar { display: none; }
`;

/** Grid glyph for the topbar layout dropdown (stroke follows the button color). */
registerIcon('layout', svg16('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><path d="M8 1.5v13M1.5 8h13"/>'));

/**
 * The cell identities the `cells` option declares, in DECLARATION order — a cell's
 * NAME never encodes its position: the first declared entry fills the first layout
 * slot, and so on. Purely-numeric names are rejected with a warning (JS object
 * enumeration reorders integer-like keys ahead of everything, silently breaking the
 * declared order).
 */
export function declaredOrder(cells: Record<string, unknown> | undefined): string[] {
    const names = Object.keys(cells ?? {});
    for (const n of names) {
        if (/^\d+$/.test(n)) {
            console.warn(`[vela] workspace cell "${n}" ignored — a purely-numeric name cannot keep its declaration order (JS object key semantics); use e.g. "cell${n}"`);
        }
    }
    return names.filter((n) => !/^\d+$/.test(n));
}

/** The first `c<N>` name not already taken — identities for slots beyond the declared list. */
export function nextAutoCellId(taken: ReadonlySet<string>): string {
    for (let i = 1; ; i += 1) {
        if (!taken.has(`c${i}`)) return `c${i}`;
    }
}

export class VelaWorkspace {
    readonly root: HTMLElement;
    /** The shortcut system — one manager for the whole workspace, routed to the active cell. */
    readonly keymap: KeymapManager;

    private readonly gridEl: HTMLElement;
    private readonly events = new TypedEventBus<WorkspaceEventMap>();
    private readonly feed = new MultiProviderFeed();
    private readonly cellsById = new Map<string, ChartCell>();
    private readonly pool = new Map<string, PooledCellState>();
    private readonly trackSizes = new Map<string, TrackSizes>(); // per layout id (splitter drags)
    private readonly splitters: SplitterLayer;
    private readonly resizeObserver: ResizeObserver | null = null;
    private readonly opts: VelaWorkspaceOptions;
    private def: LayoutDefinition;
    /** Cell identities by SLOT POSITION — `order[i]` lives in the layout's i-th slot.
     *  Names come from the `cells` declaration order (then the persisted document);
     *  slots beyond the list get auto identities. Grows, never reorders. */
    private order: string[] = [];
    private activeId: string | null = null;
    private cellBackend: NativeBackend = 'auto';
    private destroyed = false;

    // ── shared chrome ──
    private readonly topbar: Topbar;
    private readonly bottombar: Bottombar | null;
    private readonly objectTree: ObjectTree;
    private readonly dataWindow: DataWindow;
    /** The side-panel column, shared by the whole grid. */
    private readonly dock: PanelDock;
    private readonly symbolPicker: SymbolPicker;
    /** Null when the host disabled it (`indicatorPicker: false`). */
    private readonly indicatorPicker: IndicatorPicker | null;
    private readonly tfQuick: TimeframeQuick;
    private shortcutsHelp: ShortcutsHelp | null = null;
    private readonly toast: Toast;
    private readonly glider = new Glider(() => (this.activeId ? (this.cellsById.get(this.activeId)?.chart ?? null) : null));
    private readonly drawToolbar: DrawingToolbar | null;
    /** The GLOBAL armed tool/magnet/stay (workspace policy) — re-applied to whichever cell
     *  takes the focus; only the ACTIVE cell ever holds a non-null tool. Measure/eraser
     *  stay transient and per-cell: they exit when the focus leaves. */
    private globalTool: DrawingTypeKey | null = null;
    private globalSnap: SnapMode = 'off';
    private globalStay = false;
    /** Live subscription to the ACTIVE cell's unified history (rebound on every projection). */
    private historyUnsub: (() => void) | null = null;
    /** Favorite drawing tools — a WORKSPACE preference (one star set, every cell). */
    private favs: string[] = [];
    /** Live sync configuration (mutable copy of the option). */
    private readonly syncOpts: SyncOptions = {};
    // ── persistence (state surface + adapter plumbing) ──
    private readonly persistKey: string | null;
    private readonly storage: WorkspaceStorage;
    private stateTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly onUnload = (): void => this.persistNow();
    /** Re-entrance guard around one propagation tick: followers' synchronous echoes
     *  (their setVisibleRange re-emits viewport:changed) must not re-propagate. */
    private syncBusy = false;
    /** Same guard for the drawings link: the propagated mutations' own `drawing:*`
     *  events fire synchronously inside the propagation loop and must not fan out again. */
    private drawingSyncBusy = false;
    /** LINKED drawings (the drawings sync): one map per synced set (cellId → that
     *  cell's drawing id), reachable from every member under its `cellId\0drawingId`
     *  key — any member finds its peers to push edits/removals onto. Survives a
     *  toggle-off (propagation freezes while the setting is off; re-enabling resumes
     *  edit/delete for these pairs). Cleared on reload / `applyState`. */
    private readonly drawingLinks = new Map<string, Map<string, string>>();
    private manifest: ResolvedIndicator[] = [];
    /** The shared manifest can no longer change instance sets — resolved, or no
     *  `indicators` option so nothing ever will. Gates the cells' ledger fallback. */
    private manifestSettled = false;
    private timezone: string;
    private openDialogs = 0;
    private alerts: Array<{ cellId: string; symbol: string; title: string; message: string; time: number }> = [];
    private alertsMenu: Menu | null = null;
    // ── mobile chrome (same components as the widget shell; CSS keys off data-layout
    // on the root, the drawers build lazily on first open and act on the ACTIVE cell) ──
    /** Writes `data-layout` on the root and pushes mode flips into every cell's renderer. */
    private layoutCtl!: LayoutModeController;
    private readonly mobileBar: MobileBar | null;
    private readonly drawingPill: DrawingPill;
    private tfDrawer: TimeframeDrawer | null = null;
    private drawingsDrawer: DrawingsDrawer | null = null;
    private moreDrawer: MoreDrawer | null = null;
    private timezoneDrawer: TimezoneDrawer | null = null;
    private priceScaleDrawer: PriceScaleDrawer | null = null;
    /** Plot-local y of the last price-axis long-press (targets the pane under the finger). */
    private priceScalePressY = 0;
    private readonly attachmentDisposers = new Map<string, () => void>();
    /** The single grid-wide attribution mark — re-inked on a live theme swap. */
    private attributionMark: HTMLElement | null = null;
    private readonly onRootKeydown = (ev: KeyboardEvent): void => this.routeTyping(ev);

    constructor(container: HTMLElement | string, opts: VelaWorkspaceOptions = {}) {
        registerBuiltinLayouts(); // idempotent — pickers and `layout` ids resolve from the registry
        const hostEl = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
        if (!hostEl) throw new Error(`VelaWorkspace: container not found: ${String(container)}`);
        this.opts = opts;
        // ── persistence boot: a SYNC storage restores before the first build (no flash
        // of defaults); an async adapter resolves later and late-applies via applyState.
        this.persistKey = opts.persist === undefined || opts.persist === false ? null : opts.persist === true ? 'vela-workspace' : opts.persist;
        this.storage = opts.storage ?? localStorageAdapter();
        let boot: WorkspaceState | null = null;
        if (this.persistKey !== null) {
            const raw = this.storage.get(this.persistKey);
            if (typeof raw === 'string') boot = decodeState(raw);
            else if (raw != null && typeof raw === 'object') {
                void raw.then((r) => {
                    if (!this.destroyed && r) this.applyState(decodeState(r));
                });
            }
            if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onUnload);
        }
        this.timezone = boot?.timezone ?? opts.timezone ?? 'Etc/UTC';
        if (boot?.favorites) this.favs = [...boot.favorites];
        const sync = boot?.sync ?? opts.sync;
        for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair', 'drawings'] as const) {
            this.applySyncSetting(kind, sync?.[kind]);
        }
        this.def = this.resolveLayout(boot?.layout && ensureLayout(boot.layout) ? boot.layout : (opts.layout ?? '4'));
        if (boot?.trackSizes) for (const [id, ts] of Object.entries(boot.trackSizes)) this.trackSizes.set(id, ts);
        if (boot?.charts) for (const { id, ...cs } of boot.charts) this.pool.set(id, cs);
        // Identity ↔ slot mapping: the persisted document's chart order wins (it IS the
        // saved arrangement); a fresh boot takes the `cells` declaration order.
        this.order = boot?.charts ? boot.charts.map((c) => c.id) : declaredOrder(opts.cells);
        const bootActive = boot?.activeCellId ?? null;

        const doc = hostEl.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.root = doc.createElement('div');
        this.root.className = 'vela-workspace';
        ensureUIHost(this.root, resolveTheme(opts.theme));

        // ONE shared feed: providers registered once; every cell's `chart.data` operates
        // on the same registry, symbol index, and closed-bar cache.
        for (const [name, make] of Object.entries(opts.providers ?? {})) void this.feed.registerProvider(name, make());
        void this.feed.ready().then(() => {
            if (!this.destroyed) this.refreshRetention(); // re-key on canonical tickers once indexes settle
        });

        // ── shared dialogs/pickers (they act on the ACTIVE cell at call time) ──
        this.symbolPicker = new SymbolPicker({
            host: this.root,
            onSelect: (ticker) => this.active.setSymbol(ticker),
            onOpenChange: (open) => {
                // In-chart dialogs (indicator inputs, chart settings) live inside a cell's
                // chart container, so opening the search from the topbar never hits their
                // outside-dismiss — close them on every cell explicitly.
                if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                this.trackDialog(open);
            },
        });
        this.symbolPicker.setSource(() => this.feed.symbols());
        // The picker exists only while the host keeps it (`indicatorPicker: false` removes
        // every entry point — topbar button, mobile-bar item, `/` — for hosts that replace
        // it with their own indicator UI). The shared manifest still resolves and auto-adds.
        this.indicatorPicker =
            opts.indicatorPicker !== false
                ? new IndicatorPicker({
                      host: this.root,
                      library: () => this.active.libraryRows(),
                      onChart: () => this.active.onChartRows(),
                      onAdd: (i) => this.active.addFromLibrary(i),
                      onRemove: (i) => this.active.removeFromChart(i),
                      onOpenChange: (open) => {
                          // Same rule as the symbol search: the renderer's in-chart dialogs never see
                          // an outside-dismiss from a topbar dialog — close them on every cell.
                          if (open) for (const cell of this.cells()) cell.chart.renderer.closeDialogs();
                          this.trackDialog(open);
                      },
                  })
                : null;
        const picker = this.indicatorPicker;
        this.tfQuick = new TimeframeQuick({
            host: this.root,
            onApply: (tf) => this.setActiveTimeframe(tf),
            onOpenChange: (open) => this.trackDialog(open),
        });

        // ── topbar (shared) — reflects the active cell; the layout dropdown reads the registry live ──
        this.topbar = new Topbar(this.root, {
            symbol: '',
            onSymbolClick: () => this.symbolPicker.open(),
            ...(picker ? { onIndicatorsClick: () => picker.open() } : {}),
            onUndoClick: () => this.active.history.undo(),
            onRedoClick: () => this.active.history.redo(),
            onScreenshotClick: () => this.active.downloadScreenshot(),
            onAlertsClick: (anchor) => this.openAlertsMenu(anchor),
            timeframe: '60',
            timeframes: opts.timeframes ?? DEFAULT_TIMEFRAMES,
            priceStyle: 'candles',
            onTimeframe: (tf) => this.setActiveTimeframe(tf),
            onPriceStyle: (style) => this.active.setPriceStyle(style),
            layout: {
                current: this.def.id,
                // The picker composes dynamic layouts on its grid canvas; registered
                // presets the canvas cannot express (bespoke plugin areas) list as rows.
                shape: () => layoutShape(this.def),
                presets: () => layouts().filter((l) => layoutShape(l) === null).map((l) => ({ id: l.id, label: l.label })),
                onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
                onSelectPreset: (id) => this.setLayout(id),
                // The SYNC switches reflect the simple all-cells form; flipping one
                // OVERRIDES a host-set group record with plain on/off (groups stay an
                // API-only shape).
                syncs: () => [
                    { id: 'symbol', label: 'Symbol', checked: this.syncOpts.symbol === true },
                    { id: 'timeframe', label: 'Interval', checked: this.syncOpts.timeframe === true },
                    { id: 'crosshair', label: 'Crosshair', checked: this.syncOpts.crosshair === true },
                ],
                onToggleSync: (id) => {
                    const kind = id as SyncKind;
                    this.sync.set(kind, this.syncOpts[kind] ? false : true);
                },
            },
            getContext: () => this.context(),
        });

        // ── main row: the shared drawing toolbar + the grid + the docked side panels ──
        const main = doc.createElement('div');
        main.className = 'vela-ws-main';
        let toolbarHost: HTMLElement | null = null;
        if (opts.drawingToolbar !== false) {
            toolbarHost = doc.createElement('div');
            toolbarHost.className = 'vela-ws-toolbar';
            main.appendChild(toolbarHost);
        }
        this.gridEl = doc.createElement('div');
        this.gridEl.className = 'vela-ws-grid';
        main.appendChild(this.gridEl);
        // One dock for the WHOLE grid (the panels follow the active cell), owning the built-ins,
        // the contributed panels, the single-open rule and the topbar's toggle group.
        this.dock = new PanelDock(main, {
            chrome: this.topbar,
            context: () => this.context(),
            changed: () => this.markStateDirty(),
        });
        this.objectTree = new ObjectTree(main);
        this.dataWindow = new DataWindow(main);
        this.dock.addBuiltIn({ id: 'dataWindow', title: 'Data window', icon: 'datawindow', order: 10, panel: this.dataWindow, onChart: (c) => this.dataWindow.onChart(c) });
        this.dock.addBuiltIn({ id: 'objects', title: 'Object tree', icon: 'objects', order: 20, panel: this.objectTree, onChart: (c) => this.objectTree.onChart(c) });
        this.dock.refresh();
        this.root.appendChild(main);
        this.toast = new Toast(this.gridEl);

        // ONE attribution mark for the whole grid (bottom-left, floating above the
        // bottom-left cell's time axis) — the cells disable their per-chart marks, and
        // this single mark is the NOTICE-required equivalent visible attribution. It
        // follows the app-wide default a plugin may have set for the attribution corner
        // (`registerRendererDefaults({ attribution })`): the cells read it through their
        // renderer, and the grid reads it here, so one setting covers every surface
        // instead of leaving this mark behind as the one a host cannot reach.
        const attribution = rendererDefaults().attribution;
        if (attribution !== false) {
            const background = resolveTheme(opts.theme).background;
            const mark =
                typeof attribution === 'string' && attribution.trim()
                    ? createCustomMark(doc, attribution, background)
                    : createAttributionMark(doc, background);
            Object.assign(mark.style, { left: '12px', bottom: `${TIME_AXIS_H + 10}px`, zIndex: '11' });
            this.gridEl.appendChild(mark);
            this.attributionMark = mark; // kept so a live theme swap re-inks it
        }

        // ONE drawing toolbar for the whole grid: commands go to the ACTIVE cell's
        // `chart.drawings` facade; the cell's own in-chart bar stays hidden (the cells
        // are built with `drawings: { toolbar: false }`). Focus returns to the active
        // chart after every press so drawing/chart shortcuts keep working.
        this.drawToolbar = toolbarHost
            ? new DrawingToolbar(
                  toolbarHost,
                  resolveTheme(opts.theme),
                  (type) => {
                      this.active.chart.drawings.setTool(type);
                      this.refocusActive();
                  },
                  (mode) => {
                      this.active.chart.drawings.setSnapMode(mode);
                      this.refocusActive();
                  },
                  () => {
                      const d = this.active.chart.drawings;
                      d.setMode(d.getMode() === 'measure' ? null : 'measure');
                      this.refocusActive();
                  },
                  () => {
                      const d = this.active.chart.drawings;
                      d.setMode(d.getMode() === 'eraser' ? null : 'eraser');
                      this.refocusActive();
                  },
                  // No refocus on a star: the flyout stays open for more browsing.
                  (type, on) => this.active.chart.drawings.setFavorite(type, on),
                  (on) => {
                      this.active.chart.drawings.setStayMode(on);
                      this.refocusActive();
                  },
                  {
                      dock: 'static',
                      // Drawings sync is a WORKSPACE link (same model as the layout
                      // dropdown's switches) — the bar only hosts its toggle.
                      onDrawingsSync: (on) => {
                          this.sync.set('drawings', on);
                          this.refocusActive();
                      },
                  },
              )
            : null;
        this.drawToolbar?.setDefinition(defaultToolbar());
        this.drawToolbar?.setVisible(true);
        // Sync settings applied before the bar existed (boot/persisted) — reflect now.
        this.drawToolbar?.setDrawingsSyncMode(!!this.syncOpts.drawings);

        this.bottombar =
            opts.bottombar !== false
                ? new Bottombar(this.root, {
                      timezone: this.timezone,
                      onRange: (preset) => {
                          this.active.applyRange(preset);
                          this.bottombar?.setActiveRange(preset.id);
                      },
                      onTimezone: (zone) => this.setTimezone(zone),
                      onSettingsClick: () => this.active.chart.renderer.openSettings(),
                  })
                : null;

        // The mobile bar is the bottom bar of the mobile size class — the same chrome
        // toggle governs both; CSS (data-layout) decides which one is visible. Every
        // route acts on the ACTIVE cell, exactly like the topbar it replaces.
        this.mobileBar =
            opts.bottombar !== false
                ? new MobileBar(this.root, {
                      symbol: '',
                      timeframe: '60',
                      onSymbolClick: () => this.symbolPicker.open(),
                      onTimeframeClick: () => this.openTimeframeDrawer(),
                      ...(picker ? { onIndicatorsClick: () => picker.open() } : {}),
                      getContext: () => this.context(),
                      onDrawingsClick: () => this.openDrawingsDrawer(),
                      onMoreClick: () => this.openMoreDrawer(),
                      onSettingsClick: () => this.active.chart.renderer.openSettings(),
                  })
                : null;
        // One pill for the whole grid — rebound to the active cell on every projection.
        this.drawingPill = new DrawingPill(this.gridEl);

        hostEl.appendChild(this.root);

        // Measured AFTER the root is in the DOM so the first evaluation sees a real width.
        this.layoutCtl = new LayoutModeController(this.root, opts.layoutMode ?? 'auto');
        this.layoutCtl.onChange((mode) => this.onLayoutModeChange(mode));

        this.splitters = new SplitterLayer(this.gridEl, {
            tracks: () => this.currentTracks(),
            grid: () => occupancyGrid(this.def),
            apply: (axis, weights) => this.applyTracks(axis, weights),
            reset: (axis) => this.applyTracks(axis, evenTracks(this.currentTracks()[axis].length)),
            gapPx: () => GAP_PX,
        });
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.splitters.layout());
            this.resizeObserver.observe(this.gridEl);
        }

        // ── one keymap at the workspace root, every binding routed to the ACTIVE cell ──
        this.keymap = new KeymapManager();
        this.keymap.attach(this.root);
        this.registerDefaultKeys();
        // Shortcut hints beside the bound tools in the shared toolbar's flyouts.
        this.drawToolbar?.setShortcuts(toolShortcutHints(this.keymap));
        this.root.addEventListener('keydown', this.onRootKeydown);
        this.root.tabIndex = -1; // focusable host so bare keystrokes land here

        this.cellBackend = this.backendFor(this.def);
        this.applyGrid();
        this.buildCells();
        this.syncCellPresentation();
        this.setActiveCell(bootActive != null && this.cellsById.has(bootActive) ? bootActive : (this.order[0] ?? null));
        // Shortcuts only fire while focus is INSIDE the workspace (the keymap listens
        // on the root) — autofocus makes them work before the first click.
        if (opts.autofocus) this.refocusActive();

        // The shared manifest resolves once; every FRESH cell seeds its enabled entries.
        if (opts.indicators !== undefined) {
            void resolveIndicators(opts.indicators).then((list) => {
                if (this.destroyed) return;
                this.manifest = list;
                this.manifestSettled = true; // from here each cell's live instance set is the truth, empty included
                for (const cell of this.cellsById.values()) cell.setManifest(list, true);
                this.projectActiveCell();
            });
        } else {
            this.manifestSettled = true; // nothing will ever resolve — settled empty from the start
        }
        this.mountAttachments();
    }

    // ── access ──────────────────────────────────────────────────
    /** The cell with identity `id` (its declared name, or `c<N>` when undeclared), or
     *  undefined when no live cell holds it. */
    cell(id: string): ChartCell | undefined {
        return this.cellsById.get(id);
    }

    /** Every live cell, in slot order. Enumerated over `order` — the IDENTITY space —
     *  never the layout's positional slot ids, which only coincide with it for a
     *  workspace whose cells are undeclared. Identities past the current layout size are
     *  pooled, not live, so they drop out here. */
    cells(): ChartCell[] {
        return this.order.map((id) => this.cellsById.get(id)).filter((c): c is ChartCell => c != null);
    }

    /** The ACTIVE cell — the one the shared chrome reflects and acts on. */
    get active(): ChartCell {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) throw new Error('VelaWorkspace has no active cell (destroyed?)');
        return cell;
    }

    /** Shortcut for `active.chart` — the same habit as `widget.chart`. LIVE: read it at
     *  the point of use; the durable identity to hold is the cell (or its id). */
    get chart(): Vela {
        return this.active.chart;
    }

    setActiveCell(id: string | null): void {
        if (id === this.activeId || this.destroyed) return;
        const prev = this.activeId;
        if (prev) {
            const el = this.cellsById.get(prev)?.host;
            if (el) delete el.dataset.active;
        }
        this.activeId = id; // switch FIRST — the departing cell's drawing:* events must not re-enter the mirrors
        const prevCell = prev ? this.cellsById.get(prev) : undefined;
        if (prevCell) {
            // Only the ACTIVE cell ever holds an armed tool or a transient mode: the
            // global tool re-arms on the next activation; measure/eraser don't follow.
            prevCell.chart.drawings.setTool(null);
            prevCell.chart.drawings.setMode(null);
        }
        if (id) {
            const el = this.cellsById.get(id)?.host;
            if (el) el.dataset.active = '1';
        }
        if (id) {
            this.projectActiveCell(); // trigger ① — the chrome rebinds to the new active cell
            this.events.emit('cell:active', { id, prev });
            this.markStateDirty();
        }
    }

    on<K extends keyof WorkspaceEventMap>(event: K, handler: (payload: WorkspaceEventMap[K]) => void): () => void {
        return this.events.on(event, handler);
    }

    /** The context handed to contributed actions/attachments (rebuilt per invocation). */
    context(): WorkspaceWidgetContext {
        return buildContext({
            // Null during early construction (the topbar projects actions before cells exist).
            active: () => (this.activeId ? (this.cellsById.get(this.activeId) ?? null) : null),
            cells: () => this.cells(),
            setActiveCell: (id) => this.setActiveCell(id),
            openSymbolSearch: (query) => this.symbolPicker.open(query ?? ''),
            togglePanel: (id, open) => this.dock.toggle(id, open),
            root: this.root,
            toast: (message, kind) => this.toast.show(message, kind),
        });
    }

    /** Re-project contributed topbar actions + side panels, and mount late-registered attachments. */
    refreshActions(): void {
        this.mountAttachments();
        this.topbar.renderActions();
        this.mobileBar?.renderActions();
        this.dock.refresh(); // rebuilt panels bind to the active cell's chart on their own
        // Re-project every cell's legend rows so a late registerLegendAction appears there too.
        for (const cell of this.cells()) cell.chart.renderer.setLegendActions(legendActionsProviderFor(cell.chart, () => this.context()));
    }

    /** The sync-link control surface: `set(kind, true | {cellId: group} | false)`,
     *  `get(kind)`, `state()`. Enabling a market/viewport link aligns the followers to
     *  the ACTIVE cell once, so the grid starts coherent; `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also a toggle in the layout
     *  dropdown). */
    readonly sync = {
        set: (kind: SyncKind, setting: SyncSetting | false | undefined): void => this.applySyncSetting(kind, setting === false ? undefined : setting, true),
        get: (kind: SyncKind): SyncSetting | undefined => this.syncOpts[kind],
        state: (): SyncOptions => ({ ...this.syncOpts }),
    };

    // ── state surface (the SDK's read/restore of the whole grid's config + content) ──
    /**
     * Snapshot the COMPLETE workspace state as a versioned, serializable document:
     * layout + splitter sizes, active cell, sync links, timezone, and — per slot, live
     * AND dormant — the market, the renderer's cosmetic config, the user-drawings
     * document, and the indicator ledger. This is what `persist` writes; hosts build
     * custom flows on it (server snapshots, share links, templates).
     */
    getState(): WorkspaceState {
        const byId = new Map<string, PooledCellState>();
        for (const [id, cs] of this.pool) byId.set(id, cs); // dormant slots
        for (const [id, cell] of this.cellsById) byId.set(id, cell.dehydrate()); // live slots win
        // The charts array is ORDERED — position i of the document is slot i on restore.
        const charts: WorkspaceState['charts'] = [];
        for (const id of this.order) {
            const cs = byId.get(id);
            if (cs) {
                charts.push({ id, ...cs });
                byId.delete(id);
            }
        }
        for (const [id, cs] of byId) charts.push({ id, ...cs }); // pooled strays keep restoring
        const state: WorkspaceState = { version: 1, layout: this.def.id, timezone: this.timezone, sync: { ...this.syncOpts }, charts };
        if (this.activeId) state.activeCellId = this.activeId;
        if (this.favs.length > 0) state.favorites = [...this.favs];
        if (this.trackSizes.size > 0) state.trackSizes = Object.fromEntries([...this.trackSizes].map(([k, v]) => [k, { ...v }]));
        const panels = this.dock.getState();
        if (panels) state.panels = panels;
        return state;
    }

    /**
     * Restore a state document produced by {@link getState} (untrusted-safe: malformed
     * fields are dropped). Replaces the WHOLE workspace state: prefs, sync links,
     * layout, and every slot — current cells are rebuilt from the document. A layout id
     * that is not registered keeps the current grid (register custom layouts first).
     */
    applyState(state: unknown): void {
        if (this.destroyed) return;
        const st = sanitizeState(state);
        if (!st) return;
        if (st.timezone) {
            this.timezone = st.timezone;
            this.bottombar?.setTimezone(st.timezone);
        }
        if (st.favorites) this.favs = [...st.favorites]; // newborn cells inherit below (buildCells)
        // Absent in documents written before the dock existed — those leave the column closed.
        this.dock.applyState(st.panels);
        for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair', 'drawings'] as const) this.applySyncSetting(kind, st.sync?.[kind]);
        this.trackSizes.clear();
        if (st.trackSizes) for (const [id, ts] of Object.entries(st.trackSizes)) this.trackSizes.set(id, ts);
        // Full rebuild from the document — every current slot is replaced by the restored one.
        for (const [id, cell] of [...this.cellsById]) {
            cell.destroy();
            this.cellsById.delete(id);
            this.events.emit('cell:destroyed', { id });
        }
        this.pool.clear();
        this.drawingLinks.clear(); // restored drawings carry new ids — old links are stale
        for (const { id, ...cs } of st.charts) this.pool.set(id, cs);
        this.order = st.charts.map((c) => c.id); // the document's arrangement IS the order
        const def = ensureLayout(st.layout);
        if (def) this.def = def;
        this.cellBackend = this.backendFor(this.def);
        this.applyGrid();
        this.buildCells();
        this.syncCellPresentation();
        this.topbar.setLayout(this.def.id);
        const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : (this.order[0] ?? null);
        if (nextActive === this.activeId) this.projectActiveCell();
        else this.setActiveCell(nextActive);
        this.refreshRetention();
        this.events.emit('layout:changed', { layout: this.def.id });
        this.markStateDirty();
    }

    /** Set the workspace-global display timezone — applied to EVERY cell. */
    setTimezone(zone: string): void {
        this.timezone = zone;
        this.bottombar?.setTimezone(zone);
        for (const cell of this.cellsById.values()) cell.chart.renderer.set('timezone', zone);
        this.markStateDirty();
    }

    /**
     * Swap the workspace theme at runtime — `'dark'`, `'light'`, or a full custom theme,
     * applied to the shared chrome (topbar, panels, drawing toolbar) and EVERY cell.
     * Also reached from any cell's chart settings → Canvas → Theme. The choice sticks:
     * cells rebuilt by later layout switches reconstruct with it.
     */
    setTheme(theme: NonNullable<VelaWorkspaceOptions['theme']>): void {
        if (this.destroyed) return;
        const t = resolveTheme(theme);
        this.opts.theme = theme;
        ensureUIHost(this.root, t); // token re-write re-skins all token-driven chrome in place
        this.drawToolbar?.setTheme(t);
        if (this.attributionMark) applyAttributionMarkTheme(this.attributionMark, t.background);
        // Each cell's own `setTheme` no-ops once the theme already matches, so the
        // per-cell `theme:changed` echoes (see wireCell) terminate immediately.
        for (const cell of this.cellsById.values()) cell.chart.setTheme(t);
    }

    // ── layout ──────────────────────────────────────────────────
    get layout(): LayoutDefinition {
        return this.def;
    }

    /**
     * Switch the grid. Cells are diffed BY IDENTITY (`order` head of the next size):
     * surviving cells keep their live charts untouched; cells past the new size
     * dehydrate into the pool; (re)appearing positions hydrate their identity from
     * the pool (or its seed). Crossing the WebGL budget rebuilds every cell through
     * the pool so the backend stays uniform.
     */
    setLayout(layout: string | LayoutDefinition): void {
        if (this.destroyed) return;
        const next = this.resolveLayout(layout);
        const nextBackend = this.backendFor(next);
        const rebuildAll = nextBackend !== this.cellBackend;
        // The ACTIVE chart always survives a shrink — it moves into the last kept
        // slot instead of pooling, so changing the grid never hides the chart the
        // user is working in.
        this.order = orderAfterLayout(this.order, next.cells.length, this.activeId);
        const keep = new Set(this.order.slice(0, next.cells.length));
        for (const [id, cell] of [...this.cellsById]) {
            if (!keep.has(id) || rebuildAll) {
                this.poolSet(id, cell.dehydrate());
                cell.destroy();
                this.cellsById.delete(id);
                this.events.emit('cell:destroyed', { id });
            }
        }
        this.def = next;
        this.cellBackend = nextBackend;
        this.applyGrid();
        this.buildCells();
        this.syncCellPresentation();
        this.topbar.setLayout(next.id);
        const nextActive = activeAfterLayout(this.activeId, this.order.slice(0, next.cells.length));
        if (nextActive === this.activeId) this.projectActiveCell(); // same slot, maybe a rebuilt cell
        else this.setActiveCell(nextActive);
        this.refreshRetention();
        this.events.emit('layout:changed', { layout: next.id });
        this.markStateDirty();
    }

    resize(): void {
        this.splitters.layout(); // each cell's renderer follows its own ResizeObserver
    }

    destroy(): void {
        if (this.destroyed) return;
        this.persistNow(); // snapshot while the cells are still alive
        this.destroyed = true;
        if (this.stateTimer != null) clearTimeout(this.stateTimer);
        if (this.persistKey !== null && typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
        this.resizeObserver?.disconnect();
        this.splitters.destroy();
        for (const [id, cell] of [...this.cellsById]) {
            cell.destroy();
            this.cellsById.delete(id);
        }
        for (const dispose of this.attachmentDisposers.values()) {
            try {
                dispose();
            } catch {
                /* attachment cleanup must never block destroy */
            }
        }
        this.attachmentDisposers.clear();
        this.root.removeEventListener('keydown', this.onRootKeydown);
        this.keymap.destroy();
        this.drawToolbar?.destroy();
        this.topbar.destroy();
        this.bottombar?.destroy();
        this.mobileBar?.destroy();
        this.drawingPill.destroy();
        this.tfDrawer?.destroy();
        this.drawingsDrawer?.destroy();
        this.moreDrawer?.destroy();
        this.timezoneDrawer?.destroy();
        this.priceScaleDrawer?.destroy();
        this.layoutCtl.destroy();
        this.dock.destroy(); // contributed panels; the two built-ins are ours to drop
        this.objectTree.destroy();
        this.dataWindow.destroy();
        this.symbolPicker.destroy();
        this.indicatorPicker?.destroy();
        this.tfQuick.destroy();
        this.shortcutsHelp?.destroy();
        this.toast.destroy();
        this.alertsMenu?.destroy();
        this.glider.stop();
        sharedBarStore.retain(new Set()); // back to the single-chart retention policy
        this.root.remove();
        this.events.clear();
    }

    // ── the projection rule (trigger ① — full rebind on activation) ──
    /** Re-project the shared chrome from the ACTIVE cell. The chrome holds no state of
     *  its own — this is a pure read of the cell, safe to call redundantly. */
    private projectActiveCell(): void {
        const cell = this.activeId ? this.cellsById.get(this.activeId) : undefined;
        if (!cell) return;
        this.topbar.setSymbol(cell.symbol);
        this.topbar.setTimeframe(cell.timeframe);
        this.topbar.setPriceStyle(cell.priceStyle);
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.topbar.renderActions(); // contributed `when()` gates may depend on the active cell
        this.mobileBar?.renderActions();
        this.mobileBar?.setSymbol(cell.symbol);
        this.mobileBar?.setTimeframe(cell.timeframe);
        this.drawingPill.onChart(cell.chart); // the pill mirrors the ACTIVE cell's tool state
        const pushHistory = (): void => this.topbar.setHistoryState(cell.history.canUndo, cell.history.canRedo);
        this.historyUnsub?.();
        this.historyUnsub = cell.history.onChange(pushHistory);
        pushHistory();
        this.objectTree.setSymbol(cell.symbol);
        this.dock.onChart(cell.chart); // every docked panel follows the active cell
        this.bottombar?.setActiveRange(cell.activeRangeId);
        this.indicatorPicker?.sync(); // the dialog may be open while the active cell changes
        this.glider.stop(); // a mid-glide switch must not steer the next cell's viewport
        // Shared drawing toolbar ⇄ the active cell: re-apply the GLOBAL tool + magnet + stay
        // to the cell taking focus, and reflect its (fresh) state on the bar.
        const d = cell.chart.drawings;
        if (d.getTool() !== this.globalTool) d.setTool(this.globalTool);
        if (d.getSnapMode() !== this.globalSnap) d.setSnapMode(this.globalSnap);
        if (d.getStayMode() !== this.globalStay) d.setStayMode(this.globalStay);
        if (this.drawToolbar) {
            this.drawToolbar.setActiveTool(this.globalTool);
            this.drawToolbar.setMagnetMode(this.globalSnap);
            this.drawToolbar.setStayMode(this.globalStay);
            const mode = d.getMode();
            this.drawToolbar.setMeasureActive(mode === 'measure');
            this.drawToolbar.setEraserActive(mode === 'eraser');
            this.drawToolbar.setFavorites(d.favorites());
        }
    }

    /** Put keyboard focus back on the active cell's chart surface (after a toolbar press
     *  stole it) so chart/drawing shortcuts keep working. */
    private refocusActive(): void {
        if (this.activeId) this.cellsById.get(this.activeId)?.chart.renderer.focus();
    }

    /** Debounced dirty mark: one `state:changed` (+ one storage write in persist mode)
     *  per burst of edits, flushed hard on unload/destroy. */
    private markStateDirty(): void {
        if (this.destroyed) return;
        if (this.stateTimer != null) clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => {
            this.stateTimer = null;
            this.events.emit('state:changed', undefined);
            this.persistNow();
        }, 500);
    }

    /** Write the current state through the storage adapter now (fire-and-forget). */
    private persistNow(): void {
        if (this.persistKey === null || this.destroyed) return;
        try {
            void this.storage.set(this.persistKey, encodeState(this.getState()));
        } catch {
            /* best-effort — a failing adapter must never break the workspace */
        }
    }

    // ── internals ───────────────────────────────────────────────
    private resolveLayout(layout: string | LayoutDefinition): LayoutDefinition {
        if (typeof layout !== 'string') return layout;
        // Registered ids first, then the picker's self-describing dynamic ids
        // (`g3x2`) — those synthesize without touching the registry.
        const def = ensureLayout(layout);
        if (!def) throw new Error(`[vela] unknown workspace layout "${layout}" — register it with registerLayout().`);
        return def;
    }

    private backendFor(def: LayoutDefinition): NativeBackend {
        // An explicit backend is the host's word — the WebGL budget policy only decides 'auto'.
        const explicit = this.opts.nativeBackend;
        if (explicit && explicit !== 'auto') return explicit;
        return def.cells.length > (this.opts.maxWebglCells ?? 8) ? 'canvas2d' : 'auto';
    }

    private currentTracks(): { cols: number[]; rows: number[] } {
        const sizes = this.trackSizes.get(this.def.id);
        return {
            cols: sizes?.cols?.length === this.def.cols.length ? [...sizes.cols] : [...this.def.cols],
            rows: sizes?.rows?.length === this.def.rows.length ? [...sizes.rows] : [...this.def.rows],
        };
    }

    private applyTracks(axis: 'cols' | 'rows', weights: number[]): void {
        const sizes = this.trackSizes.get(this.def.id) ?? {};
        sizes[axis] = weights;
        this.trackSizes.set(this.def.id, sizes);
        this.applyGrid();
        this.markStateDirty();
    }

    /** Apply the grid template (+ per-cell areas) and reposition the splitter strips.
     *  Geometry is keyed by SLOT (`perCell[slot.id]`); the cell living there is
     *  `order[i]` — the identity/position decoupling in one line. */
    private applyGrid(): void {
        const { container, perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        // The active-cell ring only exists on multi-cell grids (see the stylesheet).
        if (this.def.cells.length > 1) this.gridEl.dataset.multi = '1';
        else delete this.gridEl.dataset.multi;
        this.gridEl.style.gridTemplateColumns = container.gridTemplateColumns ?? '';
        this.gridEl.style.gridTemplateRows = container.gridTemplateRows ?? '';
        this.gridEl.style.gridTemplateAreas = container.gridTemplateAreas ?? '';
        for (const [i, slot] of this.def.cells.entries()) {
            const host = this.cellsById.get(this.order[i] ?? '')?.host;
            if (host) host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
        }
        this.splitters.layout();
    }

    /** Create the cells the current layout wants but don't exist yet (pool-first).
     *  A slot's CELL IDENTITY is `order[i]` (declaration order — never the slot's own
     *  positional id); slots past the declared list mint an auto identity once. */
    private buildCells(): void {
        const theme = resolveTheme(this.opts.theme);
        const { perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        for (const [i, slot] of this.def.cells.entries()) {
            let id = this.order[i];
            if (!id) {
                id = nextAutoCellId(new Set([...this.order, ...this.pool.keys(), ...this.cellsById.keys()]));
                this.order[i] = id;
            }
            if (this.cellsById.has(id)) continue;
            const pooled = this.pool.get(id);
            const seed: CellBoot = pooled ?? { ...seedDefaults(this.opts), ...(this.opts.cells?.[id] ?? {}) };
            this.pool.delete(id); // the slot is live again — its pooled state is consumed
            const cell = new ChartCell(id, this.gridEl, seed, {
                feed: this.feed,
                engines: this.opts.engines ?? {},
                chartDefaults: cellChartDefaults(this.opts),
                theme,
                live: this.opts.live ?? false,
                volume: this.opts.volume ?? true,
                statusline: this.opts.statusline !== false,
                watermark: this.opts.watermark !== false,
                nativeBackend: this.cellBackend,
                dialogHost: this.root,
                timezone: () => this.timezone,
                setTimezone: (zone) => this.setTimezone(zone),
                context: () => this.context(),
                activate: (id) => this.setActiveCell(id),
                onMarketChanged: (id) => this.onCellMarketChanged(id),
                onIndicatorsChanged: (id) => this.onCellIndicatorsChanged(id),
                onStateDirty: () => this.markStateDirty(),
                manifestSettled: () => this.manifestSettled,
            });
            cell.host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
            this.cellsById.set(id, cell);
            // A REBUILT active cell (backend flip, pool round-trip) gets a fresh host —
            // re-assert the highlight attribute setActiveCell put on the old one.
            if (id === this.activeId) cell.host.dataset.active = '1';
            this.wireCell(cell);
            // A fresh renderer starts desktop — push the live mode so touch gestures,
            // fullscreen dialogs and the scroll-button sizing apply from the first frame.
            cell.chart.renderer.setLayoutMode(this.layoutCtl.current);
            // The shared star set is a workspace pref — every newborn cell inherits it
            // silently (equal-set idempotence keeps the favorites event from echoing).
            if (this.favs.length > 0) cell.chart.drawings.setFavorites(this.favs as never[]);
            // The indicator ledger: a restored cell re-adds ITS recorded set (held until
            // the manifest resolves); a fresh cell seeds the manifest's enabled entries.
            cell.setManifest(this.manifest, pooled?.indicators == null);
            this.events.emit('cell:created', { id });
        }
        // DOM order = slot order (auto-flow layouts place row-major by child order).
        for (const [i] of this.def.cells.entries()) {
            const host = this.cellsById.get(this.order[i] ?? '')?.host;
            if (host) this.gridEl.appendChild(host);
        }
    }

    /** Per-cell chart subscriptions (trigger ② — the chart instance is stable for the
     *  cell's whole life, so these live and die with the cell). */
    private wireCell(cell: ChartCell): void {
        const chart = cell.chart;
        chart.on('indicator:error', ({ error }) => this.toast.show(`[${cell.id}] ${error.message}`, 'error', 5000));
        // Script runs relay up with the cell they came from, so ONE subscription on the
        // workspace covers a grid whose cells come and go. Each cell runs its own engine
        // session, so the `cell` field is what tells two identical scripts apart.
        chart.on('script:run', (run) => this.events.emit('script:run', { ...run, cell: cell.id }));
        chart.on('alert', (alert) => {
            this.alerts.unshift({ cellId: cell.id, symbol: cell.symbol, title: alert.title ?? 'Alert', message: alert.message, time: alert.time });
            if (this.alerts.length > ALERT_CAP) this.alerts.pop();
            this.toast.show(`[${cell.id} · ${cell.symbol}] ${alert.title ? alert.title + ' — ' : ''}${alert.message}`, 'info', 4000);
            this.topbar.setAlertCount(this.alerts.length);
        });
        // Favorites are a WORKSPACE preference: one shared toolbar, one star set — a star
        // toggled in any cell re-applies to every other cell (and the shared bar), and
        // the mirror is what `getState()` persists.
        chart.on('drawing:favorites', ({ favorites }) => {
            this.favs = favorites;
            for (const other of this.cellsById.values()) {
                if (other !== cell) other.chart.drawings.setFavorites(favorites as never[]);
            }
            this.drawToolbar?.setFavorites(favorites as never[]);
            this.markStateDirty();
        });
        // Crosshair sync: mirror THIS cell's pointer time onto its same-group followers
        // as ghost markers. Leave already emits `time: null` — the clear rides along.
        chart.renderer.onCrosshairMove((e) => this.propagateCrosshair(cell.id, e.time));
        // Drawing edits are cell state (the per-slot drawings document) — persistable.
        // When the drawings link is on, a CREATED drawing copies onto the same-group
        // cells and the set stays LINKED: edits and removals of any member follow
        // (the guard stops the propagated mutations from fanning out again).
        chart.on('drawing:created', ({ id }) => {
            this.propagateDrawing(cell.id, id);
            this.markStateDirty();
        });
        // Placement progress mirrors LIVE as ghosts on the same-group cells; the end of
        // the placement carries `null`, which clears them (the created copy takes over).
        chart.on('drawing:draft', ({ doc }) => this.propagateDraft(cell.id, doc));
        chart.on('drawing:edited', ({ id }) => {
            this.propagateDrawingEdit(cell.id, id);
            this.markStateDirty();
        });
        chart.on('drawing:removed', ({ id }) => {
            this.propagateDrawingRemoval(cell.id, id);
            this.markStateDirty();
        });
        // Tool/magnet/mode reflection (trigger ②): the ACTIVE cell's drawing state drives
        // the shared bar and the global mirrors — whatever the source (bar press, keymap,
        // API, a one-shot tool disarming itself after placement).
        chart.on('drawing:tool', ({ type }) => {
            if (cell.id !== this.activeId) return;
            this.globalTool = type;
            this.drawToolbar?.setActiveTool(type);
        });
        chart.on('drawing:snap', ({ mode }) => {
            if (cell.id !== this.activeId) return;
            this.globalSnap = mode;
            this.drawToolbar?.setMagnetMode(mode);
        });
        chart.on('drawing:stay', ({ on }) => {
            if (cell.id !== this.activeId) return;
            this.globalStay = on;
            this.drawToolbar?.setStayMode(on);
        });
        chart.on('drawing:mode', ({ mode }) => {
            if (cell.id !== this.activeId) return;
            this.drawToolbar?.setMeasureActive(mode === 'measure');
            this.drawToolbar?.setEraserActive(mode === 'eraser');
        });
        // Viewport sync: every applied pan/zoom/fit propagates to the same-group cells.
        chart.on('viewport:changed', (range) => this.propagateViewport(cell.id, range));
        // A theme picked in ONE cell (its settings dialog's Canvas → Theme) re-skins the
        // WHOLE workspace — shared chrome plus every other cell.
        chart.on('theme:changed', (t) => this.setTheme(t));
        // Mobile: long-press an axis strip → timezone / price-scale sheet (desktop keeps
        // the right-click menu). The press's own pointerdown already activated the cell.
        chart.renderer.onAxisLongPress((e) => {
            if (this.layoutCtl.current !== 'mobile') return;
            if (e.axis === 'time') this.openTimezoneDrawer();
            else this.openPriceScaleDrawer(e.y);
        });
    }

    // ── sync links ──────────────────────────────────────────────
    private applySyncSetting(kind: SyncKind, setting: SyncSetting | undefined, align = false): void {
        if (setting == null || setting === false) delete this.syncOpts[kind];
        else this.syncOpts[kind] = setting;
        if (kind === 'drawings') {
            // Placement ghosts are stale under the new setting. Link pairs stay —
            // turning off freezes propagation; turning on resumes edit/delete for
            // drawings paired earlier (never copies unpaired ones onto peers).
            for (const cell of this.cellsById.values()) cell.chart.drawings.setExternalGhost(null);
            // The toggle lives on the shared drawing toolbar; keep it truthful.
            this.drawToolbar?.setDrawingsSyncMode(!!setting);
            this.markStateDirty();
            return;
        }
        if (kind === 'crosshair') {
            // Any setting change invalidates current ghosts — they rebuild on the next
            // pointer move under the NEW grouping (and vanish entirely when disabled).
            for (const cell of this.cellsById.values()) cell.chart.renderer.setExternalCrosshair(null);
            // A renderer without the seam silently never shows ghosts — warn only when
            // enabling while NO cell can display one (e.g. minimal custom renderers).
            if (setting && ![...this.cellsById.values()].some((c) => c.chart.renderer.supportsExternalCrosshair)) {
                console.warn('[vela] crosshair sync: no cell renderer supports an external crosshair — nothing will show.');
            }
            // Refresh the layout dropdown's switch state (absent during constructor boot).
            if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
            this.markStateDirty();
            return; // no market/viewport alignment applies to a pointer link
        }
        // Symbol/interval switches live in the layout dropdown too — keep an open
        // panel truthful when the setting flips through the API.
        if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
        this.markStateDirty();
        if (align && setting && this.activeId) {
            if (kind === 'viewport') {
                const range = this.cellsById.get(this.activeId)?.chart.getVisibleRange();
                if (range) this.propagateViewport(this.activeId, range);
            } else {
                this.propagateMarket(this.activeId);
            }
        }
    }

    /**
     * Mirror an origin cell's pointer time onto its same-group followers as GHOST
     * crosshairs (`renderer.setExternalCrosshair`). Leaving the origin propagates
     * `null` (the event already carries it) and clears every ghost. No busy guard
     * needed: an external crosshair never re-emits `onCrosshairMove` — the flow is
     * one-way by port contract, so no echo loop can exist.
     */
    private propagateCrosshair(originId: string, time: number | null): void {
        if (this.destroyed) return;
        const setting = this.syncOpts.crosshair;
        if (!setting) return;
        for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
            this.cellsById.get(id)?.chart.renderer.setExternalCrosshair(time);
        }
    }

    /**
     * Push an origin cell's visible range onto its same-group followers. Loop-safe two
     * ways: the busy guard eats the followers' SYNCHRONOUS echoes (their setVisibleRange
     * re-emits `viewport:changed` in the same tick), and the half-bar epsilon
     * short-circuits any async residue — a follower already within half of ITS OWN bar
     * interval is left alone, so cross-timeframe groups settle instead of oscillating.
     */
    private propagateViewport(originId: string, range: { from: number; to: number }): void {
        if (this.syncBusy || this.destroyed) return;
        const targets = syncTargets(originId, this.syncOpts.viewport, [...this.cellsById.keys()]);
        if (targets.length === 0) return;
        this.syncBusy = true;
        try {
            for (const id of targets) {
                const cell = this.cellsById.get(id);
                if (!cell) continue;
                const current = cell.chart.getVisibleRange();
                const tfMs = timeframeToMs(cell.timeframe);
                const eps = Number.isFinite(tfMs) ? tfMs / 2 : 0;
                if (current && rangesWithin(current, range, eps)) continue;
                cell.chart.setVisibleRange(range);
            }
        } finally {
            this.syncBusy = false;
        }
    }

    /**
     * Copy a freshly created drawing onto the origin's same-group followers (fresh ids
     * through `drawings.add` — anchors are time+price, so the copy lands at the same
     * spot whatever the follower shows) and register the whole set as LINKED: edits
     * and removals of any member follow while the link is on ({@link drawingLinks}).
     * The busy guard stops the copies' own `drawing:created` events from fanning out.
     */
    private propagateDrawing(originId: string, drawingId: string): void {
        if (this.drawingSyncBusy || this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
        if (!doc) return;
        this.drawingSyncBusy = true;
        try {
            const group = new Map([[originId, drawingId]]);
            for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
                const copy = this.cellsById.get(id)?.chart.drawings.add(doc.type, {
                    paneId: doc.paneId,
                    anchors: doc.anchors,
                    style: doc.style,
                    text: doc.text,
                    props: doc.props,
                });
                if (copy) group.set(id, copy.id);
            }
            if (group.size > 1) {
                for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\u0000${dId}`, group);
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /** Mirror an in-progress placement (its current ghost, `null` = placement ended)
     *  onto the origin's same-group followers — the live half of the drawings link;
     *  the created copy replaces the ghosts when the placement completes. One-way by
     *  contract (an external ghost never re-emits drafts), so no busy guard needed. */
    private propagateDraft(originId: string, doc: SerializedDrawing | null): void {
        if (this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
            this.cellsById.get(id)?.chart.drawings.setExternalGhost(doc);
        }
    }

    /** Push a linked drawing's edited CONTENT (anchors, style, text, per-type props)
     *  onto its same-group peers — any member propagates, not just the original. */
    private propagateDrawingEdit(originId: string, drawingId: string): void {
        if (this.drawingSyncBusy || this.destroyed) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        const group = this.drawingLinks.get(`${originId}\u0000${drawingId}`);
        if (!group) return;
        const doc = this.cellsById.get(originId)?.chart.drawings.all().find((d) => d.id === drawingId);
        if (!doc) return;
        this.drawingSyncBusy = true;
        try {
            for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
                const peerId = group.get(id);
                if (peerId == null) continue;
                this.cellsById.get(id)?.chart.drawings.update(peerId, {
                    anchors: doc.anchors,
                    style: doc.style,
                    text: doc.text,
                    props: doc.props,
                });
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /** Remove a linked drawing's peers with it. The removed member always leaves its
     *  link group (whatever the setting); peers are only deleted while the link is on.
     *  A propagated peer removal re-enters here under the busy guard and just cleans
     *  its own link key. */
    private propagateDrawingRemoval(originId: string, drawingId: string): void {
        if (this.destroyed) return;
        const key = `${originId}\u0000${drawingId}`;
        const group = this.drawingLinks.get(key);
        if (!group) return;
        this.drawingLinks.delete(key);
        group.delete(originId);
        if (this.drawingSyncBusy) return;
        const setting = this.syncOpts.drawings;
        if (!setting) return;
        this.drawingSyncBusy = true;
        try {
            for (const id of syncTargets(originId, setting, [...this.cellsById.keys()])) {
                const peerId = group.get(id);
                if (peerId != null) this.cellsById.get(id)?.chart.drawings.remove(peerId);
            }
        } finally {
            this.drawingSyncBusy = false;
        }
    }

    /**
     * Push an origin cell's symbol/timeframe onto its same-group followers (fired from
     * `market:changed`). Convergence comes from IDEMPOTENCE, not the guard: a follower's
     * own (async) `market:changed` propagates back, but every peer already carries the
     * value, so the cell setters no-op and the wave dies.
     */
    private propagateMarket(originId: string): void {
        if (this.syncBusy || this.destroyed) return;
        const origin = this.cellsById.get(originId);
        if (!origin) return;
        const ids = [...this.cellsById.keys()];
        this.syncBusy = true;
        try {
            if (origin.symbol) {
                for (const id of syncTargets(originId, this.syncOpts.symbol, ids)) this.cellsById.get(id)?.setSymbol(origin.symbol);
            }
            for (const id of syncTargets(originId, this.syncOpts.timeframe, ids)) this.cellsById.get(id)?.setTimeframe(origin.timeframe);
        } finally {
            this.syncBusy = false;
        }
    }

    /** Trigger ② — a cell's market changed: retention + sync always; chrome only if active. */
    private onCellMarketChanged(id: string): void {
        this.refreshRetention();
        this.propagateMarket(id);
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setSymbol(cell.symbol);
        this.topbar.setTimeframe(cell.timeframe);
        this.mobileBar?.setSymbol(cell.symbol);
        this.mobileBar?.setTimeframe(cell.timeframe);
        this.objectTree.setSymbol(cell.symbol);
    }

    /** Trigger ② — a cell's indicator ledger changed: count + picker only if active. */
    private onCellIndicatorsChanged(id: string): void {
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.indicatorPicker?.sync();
    }

    /** Timeframe changes routed from the topbar menu / quick entry (chip state follows). */
    private setActiveTimeframe(tf: string): void {
        this.bottombar?.setActiveRange(null);
        this.active.setTimeframe(tf);
    }

    /** The mode flipped (container resized across the breakpoint, or a coarse-pointer
     *  change). Close the open surfaces — a desktop card must not linger over the
     *  mobile chrome (and vice versa) — and re-present every cell's own chrome. */
    private onLayoutModeChange(mode: LayoutMode): void {
        this.symbolPicker.close();
        this.indicatorPicker?.close();
        this.tfDrawer?.close();
        this.drawingsDrawer?.close();
        this.moreDrawer?.close();
        this.timezoneDrawer?.close();
        this.priceScaleDrawer?.close();
        this.alertsMenu?.destroy();
        this.alertsMenu = null;
        for (const cell of this.cellsById.values()) {
            cell.chart.renderer.closeDialogs();
            cell.chart.renderer.setLayoutMode(mode);
        }
        this.syncCellPresentation(); // the legend's overview override is mode-scoped
    }

    /** Push the layout-shape-dependent chrome onto every cell: multi-cell grids keep
     *  the status line on one row (segments that don't fit hide), and on MOBILE their
     *  legends' fold chip routes to the object tree instead of unfolding in place —
     *  per-indicator controls live there (the legend rows have no room in a grid cell). */
    private syncCellPresentation(): void {
        const multi = this.def.cells.length > 1;
        const overview = multi && this.layoutCtl.current === 'mobile' ? (): void => this.dock.toggle('objects', true) : null;
        for (const cell of this.cellsById.values()) {
            cell.setStatuslineFit(multi);
            cell.chart.renderer.setLegendOverviewAction(overview);
        }
    }

    // ── mobile drawers (built on first open; every read is live and hits the ACTIVE cell) ──

    private openTimeframeDrawer(): void {
        this.tfDrawer ??= new TimeframeDrawer({
            host: this.root,
            timeframes: this.opts.timeframes ?? DEFAULT_TIMEFRAMES,
            ranges: RANGE_PRESETS,
            currentTimeframe: () => this.active.timeframe,
            activeRange: () => this.active.activeRangeId,
            onTimeframe: (tf) => this.setActiveTimeframe(tf),
            onRange: (preset) => {
                this.active.applyRange(preset);
                this.bottombar?.setActiveRange(preset.id); // the desktop bar stays truthful across a mode flip
            },
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.tfDrawer.open();
    }

    private openDrawingsDrawer(): void {
        this.drawingsDrawer ??= new DrawingsDrawer({
            host: this.root,
            toolbar: () => defaultToolbar(), // the shared static toolbar's definition (see constructor)
            currentTool: () => this.active.chart.drawings.getTool(),
            isFavorite: (type) => this.active.chart.drawings.isFavorite(type),
            onFavorite: (type, on) => this.active.chart.drawings.setFavorite(type, on),
            onSelect: (type) => this.active.chart.drawings.setTool(type),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.drawingsDrawer.open();
    }

    private openMoreDrawer(): void {
        this.moreDrawer ??= new MoreDrawer({
            host: this.root,
            onUndo: () => this.active.history.undo(),
            onRedo: () => this.active.history.redo(),
            onScreenshot: () => this.active.downloadScreenshot(),
            canUndo: () => this.active.history.canUndo,
            canRedo: () => this.active.history.canRedo,
            priceStyles: () => priceStyleIds().map((id) => ({ id, label: priceStyleLabel(id), icon: priceStyleIcon(id) })),
            priceStyle: () => this.active.priceStyle,
            onPriceStyle: (id) => this.active.setPriceStyle(id),
            panels: () => [...this.dock.list()],
            onTogglePanel: (id) => this.dock.toggle(id),
            alerts: () => this.alerts.map((a) => ({ title: `[${a.cellId} · ${a.symbol}] ${a.title}`, message: a.message, time: a.time })),
            // Left-aligned actions have their own bottom-bar stop — only the rest
            // lands in the drawer, or every left action would appear twice.
            actions: () =>
                widgetActions('topbar', this.context())
                    .filter((a) => a.align !== 'left')
                    .map((a) => ({ label: a.label, icon: a.icon, run: () => a.run(this.context()) })),
            // The desktop layout dropdown's whole surface — the grid canvas, the
            // non-canvas presets and the sync switches — relocated into the kebab
            // drawer (the topbar is hidden on mobile). Same reads as the topbar block.
            layout: {
                shape: () => layoutShape(this.def),
                presets: () =>
                    layouts()
                        .filter((l) => layoutShape(l) === null)
                        .map((l) => ({ id: l.id, label: l.label, checked: l.id === this.def.id })),
                onSelectGrid: (rows, cols) => this.setLayout(layoutForGrid(rows, cols)),
                onSelectPreset: (id) => this.setLayout(id),
                syncs: () => [
                    { id: 'symbol', label: 'Symbol', checked: this.syncOpts.symbol === true },
                    { id: 'timeframe', label: 'Interval', checked: this.syncOpts.timeframe === true },
                    { id: 'crosshair', label: 'Crosshair', checked: this.syncOpts.crosshair === true },
                ],
                onToggleSync: (id) => {
                    const kind = id as SyncKind;
                    this.sync.set(kind, this.syncOpts[kind] ? false : true);
                },
            },
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.moreDrawer.open();
    }

    private openTimezoneDrawer(): void {
        this.timezoneDrawer ??= new TimezoneDrawer({
            host: this.root,
            timezone: () => this.timezone,
            onTimezone: (zone) => this.setTimezone(zone),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.timezoneDrawer.open();
    }

    private openPriceScaleDrawer(y: number): void {
        this.priceScalePressY = y;
        this.priceScaleDrawer ??= new PriceScaleDrawer({
            host: this.root,
            chart: () => (this.activeId ? (this.cellsById.get(this.activeId)?.chart ?? null) : null),
            pressY: () => this.priceScalePressY,
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.priceScaleDrawer.open();
    }

    /** The aggregated alerts bell — entries carry their cell; selecting one activates it. */
    private openAlertsMenu(anchor: HTMLElement): void {
        this.alertsMenu?.destroy();
        const items = this.alerts.length
            ? this.alerts.map((a, i) => ({
                  id: String(i),
                  label: `[${a.cellId} · ${a.symbol}] ${new Date(a.time).toLocaleTimeString()} · ${a.title}: ${a.message}`.slice(0, 80),
              }))
            : [{ id: 'none', label: 'No alerts yet', disabled: true }];
        this.alertsMenu = new Menu({
            host: this.root,
            items,
            onSelect: (id) => {
                const alert = this.alerts[Number(id)];
                if (alert && this.cellsById.has(alert.cellId)) this.setActiveCell(alert.cellId);
            },
        });
        const r = anchor.getBoundingClientRect();
        this.alertsMenu.openAt(r.left, r.bottom + 4);
    }

    /** Mount registered attachments not yet mounted on this workspace (idempotent per id). */
    private mountAttachments(): void {
        for (const att of widgetAttachments()) {
            if (this.attachmentDisposers.has(att.id)) continue;
            try {
                this.attachmentDisposers.set(att.id, att.mount(this.context()));
            } catch (err) {
                console.warn(`[vela] workspace attachment "${att.id}" failed to mount:`, err);
            }
        }
    }

    /** The default shortcut set — every binding acts on the ACTIVE cell. */
    private registerDefaultKeys(): void {
        this.keymap.register({ id: 'chart.screenshot', keys: 'mod+alt+s', label: 'Download a chart screenshot', category: 'Chart', run: () => this.active.downloadScreenshot() });
        this.keymap.register({ id: 'chart.reset-view', keys: 'alt+r', label: 'Reset view (all history)', category: 'Chart', run: () => this.active.chart.setVisibleRangePreset('ALL') });
        this.keymap.register({ id: 'chart.toggle-log', keys: 'alt+l', label: 'Toggle logarithmic scale', category: 'Chart', run: () => this.active.chart.renderer.set('logScale', !this.active.chart.renderer.get('logScale')) });
        this.keymap.register({
            id: 'chart.toggle-percent',
            keys: 'alt+p',
            label: 'Toggle percent scale',
            category: 'Chart',
            run: () => {
                const mode = this.active.chart.renderer.get('scaleMode');
                this.active.chart.renderer.set('scaleMode', mode === 'percent' ? 'price' : 'percent');
            },
        });
        this.keymap.register({ id: 'drawings.trendline', keys: 'alt+t', label: 'Arm the trend line tool', category: 'Drawings', run: () => this.active.chart.drawings.setTool('trendline') });
        this.keymap.register({
            id: 'drawings.hline-cursor',
            keys: 'alt+h',
            label: 'Horizontal line at the cursor price',
            category: 'Drawings',
            run: () => {
                const c = this.active;
                if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add('hline', { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
            },
        });
        this.keymap.register({
            id: 'drawings.vline-cursor',
            keys: 'alt+v',
            label: 'Vertical line at the cursor time',
            category: 'Drawings',
            run: () => {
                const c = this.active;
                if (c.lastCrossTime != null && c.lastCrossPrice != null) c.chart.drawings.add('vline', { anchors: [{ time: c.lastCrossTime, price: c.lastCrossPrice }] });
            },
        });
        this.keymap.register({ id: 'history.undo', keys: ['mod+z'], label: 'Undo (active chart)', category: 'Edit', run: () => this.active.history.undo() });
        this.keymap.register({ id: 'history.redo', keys: ['mod+y', 'mod+shift+z'], label: 'Redo (active chart)', category: 'Edit', run: () => this.active.history.redo() });
        this.keymap.register({ id: 'view.zoom-in', keys: 'mod+arrowup', label: 'Zoom in', category: 'Chart', run: () => this.glider.zoom(ZOOM_IN) });
        this.keymap.register({ id: 'view.zoom-out', keys: 'mod+arrowdown', label: 'Zoom out', category: 'Chart', run: () => this.glider.zoom(ZOOM_OUT) });
        // Pan keys mirror a drag exactly (same clamp, same easing) — see Vela.panBy.
        this.keymap.register({ id: 'view.pan-left', keys: 'mod+arrowleft', label: 'Pan toward history', category: 'Chart', run: () => this.active.chart.panBy(-PAN_FAST) });
        this.keymap.register({ id: 'view.pan-right', keys: 'mod+arrowright', label: 'Pan toward now', category: 'Chart', run: () => this.active.chart.panBy(PAN_FAST) });
        if (this.indicatorPicker) {
            this.keymap.register({ id: 'indicators.open', keys: '/', label: 'Open the indicator picker', category: 'Indicators', run: () => this.indicatorPicker?.open() });
        }
        this.keymap.register({
            id: 'help.shortcuts',
            keys: '?',
            label: 'Show this shortcuts panel',
            category: 'Help',
            run: () => {
                this.shortcutsHelp ??= new ShortcutsHelp(this.keymap, this.root, (open) => this.trackDialog(open));
                this.shortcutsHelp.open();
            },
        });
    }

    /** Bare-typing router: letters → symbol search (seeded), digits → timeframe entry. */
    private routeTyping(ev: KeyboardEvent): void {
        if (this.destroyed || this.openDialogs > 0) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        if (isEditableTarget(ev)) return; // never hijack a keystroke someone is TYPING
        const key = ev.key;
        if (/^[a-zA-Z]$/.test(key)) {
            ev.preventDefault();
            this.symbolPicker.open(key.toUpperCase());
        } else if (/^[0-9]$/.test(key)) {
            ev.preventDefault();
            this.tfQuick.open(key);
        }
    }

    private trackDialog(open: boolean): void {
        this.openDialogs = Math.max(0, this.openDialogs + (open ? 1 : -1));
        if (open) this.keymap.pushScope('dialog');
        else this.keymap.popScope('dialog');
    }

    /** Pool a dehydrated slot state (bounded — oldest entries drop past the cap). */
    private poolSet(id: string, state: PooledCellState): void {
        this.pool.delete(id);
        this.pool.set(id, state);
        if (this.pool.size > POOL_CAP) {
            const oldest = this.pool.keys().next().value;
            if (oldest != null) this.pool.delete(oldest);
        }
    }

    /**
     * Declare every live cell's symbol to the shared bar cache so one cell's load never
     * evicts the others' history (multi-symbol retention). Keys are CANONICAL tickers —
     * resolved through the registry when its indexes are ready, raw until then (refreshed
     * again on `feed.ready()`).
     */
    private refreshRetention(): void {
        const symbols = new Set<string>();
        for (const cell of this.cellsById.values()) {
            const raw = cell.symbol;
            if (!raw) continue;
            symbols.add(this.feed.resolveSymbol(raw)?.ticker ?? raw);
        }
        sharedBarStore.retain(symbols);
    }
}
