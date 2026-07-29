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
import type { ThemeName, VelaTheme, NativeBackend } from '../core/options';
import { resolveTheme } from '../core/theme';
import { TypedEventBus } from '../core/events/EventBus';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import { sharedBarStore } from '../data/BarStore';
import { ensureUIHost, injectStyles, registerIcon } from '../ui';
import { KeymapManager } from '../ui/keymap';
import { Menu } from '../ui/components/menu';
import type { Vela } from '../Vela';
import { Topbar } from '../widget/topbar';
import { Bottombar } from '../widget/bottombar';
import { ObjectTree } from '../widget/object-tree';
import { SymbolPicker } from '../widget/symbol-picker';
import { IndicatorPicker } from '../widget/indicator-picker';
import { TimeframeQuick } from '../widget/timeframe-quick';
import { ShortcutsHelp } from '../widget/shortcuts-help';
import { Toast } from '../widget/toast';
import { Glider, ZOOM_IN, ZOOM_OUT, PAN_FAST } from '../widget/glide';
import { toolShortcutHints } from '../widget/tool-shortcuts';
import { widgetAttachments } from '../widget/contributions';
import { resolveIndicators, type IndicatorManifest, type ResolvedIndicator } from '../widget/indicators';
import { DrawingToolbar } from '../renderers/native/drawings/DrawingToolbar';
import { createAttributionMark } from '../renderers/native/chrome/AttributionMark';
import { defaultToolbar, type DrawingTypeKey, type SnapMode } from '../core/drawings';
import { timeframeToMs } from '../data/timeframe';
import { syncTargets, rangesWithin, type SyncKind, type SyncOptions, type SyncSetting } from './sync';
import { encodeState, decodeState, sanitizeState, memoryStorageAdapter, type WorkspaceState, type WorkspaceStorage } from './persist';
import { ChartCell, type CellSeed, type PooledCellState } from './ChartCell';
import { buildContext, type WorkspaceWidgetContext } from './context';
import {
    registerBuiltinLayouts,
    layoutDefinition,
    layouts,
    gridStyles,
    activeAfterLayout,
    type LayoutDefinition,
    type TrackSizes,
} from './layouts';
import { SplitterLayer, evenTracks } from './splitters';

export interface VelaWorkspaceOptions {
    /** Initial layout — a registered id (`'1'`, `'2h'`, `'2v'`, `'4'`, `'8'`, or a
     *  plugin-registered one) or an inline definition. Default `'4'`. */
    layout?: string | LayoutDefinition;
    /** Per-slot market seeds, keyed by canonical cell id (`c1`…). Unseeded slots use `defaults`. */
    cells?: Record<string, CellSeed>;
    /** Fallback seed for slots without an entry in `cells`. */
    defaults?: CellSeed;
    /** Provider factories — called ONCE and registered on the single shared feed. */
    providers?: Record<string, () => DataProvider>;
    /** Scripting-engine factories — called once PER CELL (e.g. a worker engine per cell). */
    engines?: Record<string, () => ScriptingEngine>;
    /** Indicator manifest (inline JSON or a URL) — resolved ONCE; `enabled` entries
     *  auto-add to every FRESH cell (pool-restored cells re-add their own set). */
    indicators?: string | IndicatorManifest;
    /** Topbar timeframe presets. */
    timeframes?: string[];
    /** Workspace-global display timezone (IANA; applied to EVERY cell). Default 'Etc/UTC'. */
    timezone?: string;
    theme?: ThemeName | VelaTheme;
    live?: boolean;
    volume?: boolean;
    statusline?: boolean;
    watermark?: boolean;
    bottombar?: boolean;
    /** Focus the active chart when the workspace mounts so keyboard shortcuts work from
     *  the first keystroke — no initial click needed. Default false: an embedded
     *  workspace must never steal the page's focus from the host's own controls. */
    autofocus?: boolean;
    /** The ONE shared drawing toolbar, docked left of the grid and acting on the active
     *  cell (per-cell in-chart bars stay hidden either way). Default true. */
    drawingToolbar?: boolean;
    /** Sync links between cells: per kind, `true` = all cells, or a `{cellId: group}`
     *  record (only same-group cells follow each other). `crosshair` mirrors the
     *  pointer time as ghost crosshairs on the followers (also toggleable from the
     *  layout dropdown). Default: everything off. Change at runtime via
     *  `ws.sync.set(kind, setting)`. */
    sync?: SyncOptions;
    /** Persist the workspace state and restore it as defaults (`true` = key
     *  'vela-workspace'; a string is the key). The state document is what
     *  `getState()` returns; writes are debounced and flushed on unload/destroy. */
    persist?: boolean | string;
    /** Storage backend for `persist` — DEFAULT: an in-memory, session-lived adapter
     *  (a destroyed and re-created workspace restores; a reload starts fresh).
     *  Plug any {@link WorkspaceStorage} (sync or async) for durable persistence. */
    storage?: WorkspaceStorage;
    /** Above this many cells, EVERY cell uses the canvas2d backend (uniform look inside
     *  the browser's WebGL-context budget; glow is unavailable there). Default 8. */
    maxWebglCells?: number;
}

export interface WorkspaceEventMap extends Record<string, unknown> {
    /** The active cell changed (click/focus in a cell, or `setActiveCell`). */
    'cell:active': { id: string; prev: string | null };
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
   outline on the cell is painted under them) — inert to the pointer. */
.vela-cell[data-active='1']::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--vela-accent-bright, var(--vela-accent));
    pointer-events: none;
    z-index: 10;
}
.vela-ws-splitter:hover { background: var(--vela-accent); opacity: 0.35; }
`;

/** Grid glyph for the topbar layout dropdown (stroke follows the button color). */
registerIcon(
    'layout',
    '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><path d="M8 1.5v13M1.5 8h13"/></svg>',
);

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
    private activeId: string | null = null;
    private cellBackend: NativeBackend = 'auto';
    private destroyed = false;

    // ── shared chrome ──
    private readonly topbar: Topbar;
    private readonly bottombar: Bottombar | null;
    private readonly objectTree: ObjectTree;
    private readonly symbolPicker: SymbolPicker;
    private readonly indicatorPicker: IndicatorPicker;
    private readonly tfQuick: TimeframeQuick;
    private shortcutsHelp: ShortcutsHelp | null = null;
    private readonly toast: Toast;
    private readonly glider = new Glider(() => (this.activeId ? (this.cellsById.get(this.activeId)?.chart ?? null) : null));
    private readonly drawToolbar: DrawingToolbar | null;
    /** The GLOBAL armed tool/magnet (workspace policy) — re-applied to whichever cell
     *  takes the focus; only the ACTIVE cell ever holds a non-null tool. Measure/eraser
     *  stay transient and per-cell: they exit when the focus leaves. */
    private globalTool: DrawingTypeKey | null = null;
    private globalSnap: SnapMode = 'off';
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
    private manifest: ResolvedIndicator[] = [];
    private timezone: string;
    private openDialogs = 0;
    private alerts: Array<{ cellId: string; symbol: string; title: string; message: string; time: number }> = [];
    private alertsMenu: Menu | null = null;
    private readonly attachmentDisposers = new Map<string, () => void>();
    private readonly onRootKeydown = (ev: KeyboardEvent): void => this.routeTyping(ev);

    constructor(container: HTMLElement | string, opts: VelaWorkspaceOptions = {}) {
        registerBuiltinLayouts(); // idempotent — pickers and `layout` ids resolve from the registry
        const hostEl = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
        if (!hostEl) throw new Error(`VelaWorkspace: container not found: ${String(container)}`);
        this.opts = opts;
        // ── persistence boot: a SYNC storage restores before the first build (no flash
        // of defaults); an async adapter resolves later and late-applies via applyState.
        this.persistKey = opts.persist === undefined || opts.persist === false ? null : opts.persist === true ? 'vela-workspace' : opts.persist;
        this.storage = opts.storage ?? memoryStorageAdapter();
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
        for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair'] as const) {
            this.applySyncSetting(kind, sync?.[kind]);
        }
        this.def = this.resolveLayout(boot?.layout && layoutDefinition(boot.layout) ? boot.layout : (opts.layout ?? '4'));
        if (boot?.trackSizes) for (const [id, ts] of Object.entries(boot.trackSizes)) this.trackSizes.set(id, ts);
        if (boot?.charts) for (const { id, ...cs } of boot.charts) this.pool.set(id, cs);
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
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.symbolPicker.setSource(() => this.feed.symbols());
        this.indicatorPicker = new IndicatorPicker({
            host: this.root,
            library: () => this.active.libraryRows(),
            onChart: () => this.active.onChartRows(),
            onAdd: (i) => this.active.addFromLibrary(i),
            onRemove: (i) => this.active.removeFromChart(i),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.tfQuick = new TimeframeQuick({
            host: this.root,
            onApply: (tf) => this.setActiveTimeframe(tf),
            onOpenChange: (open) => this.trackDialog(open),
        });

        // ── topbar (shared) — reflects the active cell; the layout dropdown reads the registry live ──
        this.topbar = new Topbar(this.root, {
            symbol: '',
            onSymbolClick: () => this.symbolPicker.open(),
            onIndicatorsClick: () => this.indicatorPicker.open(),
            onObjectsClick: () => this.objectTree.toggle(),
            onScreenshotClick: () => this.active.downloadScreenshot(),
            onSettingsClick: () => this.active.chart.renderer.openSettings(),
            onAlertsClick: (anchor) => this.openAlertsMenu(anchor),
            onDataWindowClick: () => {
                const next = !this.active.chart.renderer.get('dataWindow');
                this.active.chart.renderer.set('dataWindow', next);
                return next;
            },
            dataWindowOn: false,
            timeframe: '60',
            timeframes: opts.timeframes ?? DEFAULT_TIMEFRAMES,
            priceStyle: 'candles',
            onTimeframe: (tf) => this.setActiveTimeframe(tf),
            onPriceStyle: (style) => this.active.setPriceStyle(style),
            layout: {
                current: this.def.id,
                options: () => layouts().map((l) => ({ id: l.id, label: l.label })),
                onSelect: (id) => this.setLayout(id),
                // Workspace-wide view toggles live under the grid presets. The check
                // reflects the simple all-cells form; flipping OVERRIDES a host-set
                // group record with plain on/off (groups stay an API-only shape).
                toggles: () => [{ id: 'crosshair-sync', label: 'Sync crosshair', checked: this.syncOpts.crosshair === true }],
                onToggle: (id) => {
                    if (id === 'crosshair-sync') this.sync.set('crosshair', this.syncOpts.crosshair ? false : true);
                },
            },
            getContext: () => this.context(),
        });

        // ── main row: the shared drawing toolbar + the grid + the docked object tree ──
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
        this.objectTree = new ObjectTree(main);
        this.root.appendChild(main);
        this.toast = new Toast(this.gridEl);

        // ONE attribution mark for the whole grid (bottom-left, floating above the
        // bottom-left cell's time axis) — the cells disable their per-chart marks, and
        // this single mark is the NOTICE-required equivalent visible attribution.
        const mark = createAttributionMark(doc, resolveTheme(opts.theme).textColor);
        Object.assign(mark.style, { left: '12px', bottom: `${TIME_AXIS_H + 10}px`, zIndex: '11' });
        this.gridEl.appendChild(mark);

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
                  { dock: 'static' },
              )
            : null;
        this.drawToolbar?.setDefinition(defaultToolbar());
        this.drawToolbar?.setVisible(true);

        this.bottombar =
            opts.bottombar !== false
                ? new Bottombar(this.root, {
                      timezone: this.timezone,
                      onRange: (preset) => {
                          this.active.applyRange(preset);
                          this.bottombar?.setActiveRange(preset.id);
                      },
                      onTimezone: (zone) => this.setTimezone(zone),
                  })
                : null;

        hostEl.appendChild(this.root);

        this.splitters = new SplitterLayer(this.gridEl, {
            tracks: () => this.currentTracks(),
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
        this.setActiveCell(bootActive != null && this.cellsById.has(bootActive) ? bootActive : (this.def.cells[0]?.id ?? null));
        // Shortcuts only fire while focus is INSIDE the workspace (the keymap listens
        // on the root) — autofocus makes them work before the first click.
        if (opts.autofocus) this.refocusActive();

        // The shared manifest resolves once; every FRESH cell seeds its enabled entries.
        if (opts.indicators !== undefined) {
            void resolveIndicators(opts.indicators).then((list) => {
                if (this.destroyed) return;
                this.manifest = list;
                for (const cell of this.cellsById.values()) cell.setManifest(list, true);
                this.projectActiveCell();
            });
        }
        this.mountAttachments();
    }

    // ── access ──────────────────────────────────────────────────
    /** The cell in slot `id`, or undefined when the current layout has no such slot. */
    cell(id: string): ChartCell | undefined {
        return this.cellsById.get(id);
    }

    /** Every live cell, in layout slot order. */
    cells(): ChartCell[] {
        return this.def.cells.map((c) => this.cellsById.get(c.id)).filter((c): c is ChartCell => c != null);
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
            root: this.root,
            toast: (message, kind) => this.toast.show(message, kind),
        });
    }

    /** Re-project contributed topbar actions + mount late-registered attachments. */
    refreshActions(): void {
        this.mountAttachments();
        this.topbar.renderActions();
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
        const charts = [...byId].map(([id, cs]) => ({ id, ...cs }));
        const state: WorkspaceState = { version: 1, layout: this.def.id, timezone: this.timezone, sync: { ...this.syncOpts }, charts };
        if (this.activeId) state.activeCellId = this.activeId;
        if (this.favs.length > 0) state.favorites = [...this.favs];
        if (this.trackSizes.size > 0) state.trackSizes = Object.fromEntries([...this.trackSizes].map(([k, v]) => [k, { ...v }]));
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
        for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair'] as const) this.applySyncSetting(kind, st.sync?.[kind]);
        this.trackSizes.clear();
        if (st.trackSizes) for (const [id, ts] of Object.entries(st.trackSizes)) this.trackSizes.set(id, ts);
        // Full rebuild from the document — every current slot is replaced by the restored one.
        for (const [id, cell] of [...this.cellsById]) {
            cell.destroy();
            this.cellsById.delete(id);
            this.events.emit('cell:destroyed', { id });
        }
        this.pool.clear();
        for (const { id, ...cs } of st.charts) this.pool.set(id, cs);
        const def = layoutDefinition(st.layout);
        if (def) this.def = def;
        this.cellBackend = this.backendFor(this.def);
        this.applyGrid();
        this.buildCells();
        this.topbar.setLayout(this.def.id);
        const nextActive = st.activeCellId && this.cellsById.has(st.activeCellId) ? st.activeCellId : (this.def.cells[0]?.id ?? null);
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

    // ── layout ──────────────────────────────────────────────────
    get layout(): LayoutDefinition {
        return this.def;
    }

    /**
     * Switch the grid. Cells are diffed BY SLOT ID: surviving slots keep their live
     * charts untouched; removed slots dehydrate into the pool; (re)appearing slots
     * hydrate from the pool (or their seed). Crossing the WebGL budget rebuilds every
     * cell through the pool so the backend stays uniform.
     */
    setLayout(layout: string | LayoutDefinition): void {
        if (this.destroyed) return;
        const next = this.resolveLayout(layout);
        const nextBackend = this.backendFor(next);
        const rebuildAll = nextBackend !== this.cellBackend;
        const keep = new Set(next.cells.map((c) => c.id));
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
        this.topbar.setLayout(next.id);
        const nextActive = activeAfterLayout(this.activeId, next.cells.map((c) => c.id));
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
        this.objectTree.destroy();
        this.symbolPicker.destroy();
        this.indicatorPicker.destroy();
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
        this.objectTree.setSymbol(cell.symbol);
        this.objectTree.onChart(cell.chart);
        this.bottombar?.setActiveRange(cell.activeRangeId);
        this.indicatorPicker.sync(); // the dialog may be open while the active cell changes
        this.glider.stop(); // a mid-glide switch must not steer the next cell's viewport
        // Shared drawing toolbar ⇄ the active cell: re-apply the GLOBAL tool + magnet to
        // the cell taking focus, and reflect its (fresh) state on the bar.
        const d = cell.chart.drawings;
        if (d.getTool() !== this.globalTool) d.setTool(this.globalTool);
        if (d.getSnapMode() !== this.globalSnap) d.setSnapMode(this.globalSnap);
        if (this.drawToolbar) {
            this.drawToolbar.setActiveTool(this.globalTool);
            this.drawToolbar.setMagnetMode(this.globalSnap);
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
        const def = layoutDefinition(layout);
        if (!def) throw new Error(`[vela] unknown workspace layout "${layout}" — register it with registerLayout().`);
        return def;
    }

    private backendFor(def: LayoutDefinition): NativeBackend {
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

    /** Apply the grid template (+ per-cell areas) and reposition the splitter strips. */
    private applyGrid(): void {
        const { container, perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        this.gridEl.style.gridTemplateColumns = container.gridTemplateColumns ?? '';
        this.gridEl.style.gridTemplateRows = container.gridTemplateRows ?? '';
        this.gridEl.style.gridTemplateAreas = container.gridTemplateAreas ?? '';
        for (const [id, styles] of Object.entries(perCell)) {
            const host = this.cellsById.get(id)?.host;
            if (host) host.style.gridArea = styles.gridArea ?? '';
        }
        this.splitters.layout();
    }

    /** Create the cells the current layout wants but don't exist yet (pool-first). */
    private buildCells(): void {
        const theme = resolveTheme(this.opts.theme);
        const { perCell } = gridStyles(this.def, this.trackSizes.get(this.def.id));
        for (const slot of this.def.cells) {
            if (this.cellsById.has(slot.id)) continue;
            const pooled = this.pool.get(slot.id);
            const seed: PooledCellState = pooled ?? { ...(this.opts.defaults ?? {}), ...(this.opts.cells?.[slot.id] ?? {}) };
            this.pool.delete(slot.id); // the slot is live again — its pooled state is consumed
            const cell = new ChartCell(slot.id, this.gridEl, seed, {
                feed: this.feed,
                engines: this.opts.engines ?? {},
                theme,
                live: this.opts.live ?? false,
                volume: this.opts.volume ?? true,
                statusline: this.opts.statusline !== false,
                watermark: this.opts.watermark !== false,
                nativeBackend: this.cellBackend,
                dialogHost: this.root,
                timezone: () => this.timezone,
                context: () => this.context(),
                activate: (id) => this.setActiveCell(id),
                onMarketChanged: (id) => this.onCellMarketChanged(id),
                onIndicatorsChanged: (id) => this.onCellIndicatorsChanged(id),
                onStateDirty: () => this.markStateDirty(),
            });
            cell.host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
            this.cellsById.set(slot.id, cell);
            this.wireCell(cell);
            // The shared star set is a workspace pref — every newborn cell inherits it
            // silently (equal-set idempotence keeps the favorites event from echoing).
            if (this.favs.length > 0) cell.chart.drawings.setFavorites(this.favs as never[]);
            // The indicator ledger: a restored cell re-adds ITS recorded set (held until
            // the manifest resolves); a fresh cell seeds the manifest's enabled entries.
            cell.setManifest(this.manifest, pooled?.indicators == null);
            this.events.emit('cell:created', { id: slot.id });
        }
        // DOM order = slot order (auto-flow layouts place row-major by child order).
        for (const slot of this.def.cells) {
            const host = this.cellsById.get(slot.id)?.host;
            if (host) this.gridEl.appendChild(host);
        }
    }

    /** Per-cell chart subscriptions (trigger ② — the chart instance is stable for the
     *  cell's whole life, so these live and die with the cell). */
    private wireCell(cell: ChartCell): void {
        const chart = cell.chart;
        chart.on('indicator:error', ({ error }) => this.toast.show(`[${cell.id}] ${error.message}`, 'error', 5000));
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
        chart.on('drawing:created', () => this.markStateDirty());
        chart.on('drawing:edited', () => this.markStateDirty());
        chart.on('drawing:removed', () => this.markStateDirty());
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
        chart.on('drawing:mode', ({ mode }) => {
            if (cell.id !== this.activeId) return;
            this.drawToolbar?.setMeasureActive(mode === 'measure');
            this.drawToolbar?.setEraserActive(mode === 'eraser');
        });
        // Viewport sync: every applied pan/zoom/fit propagates to the same-group cells.
        chart.on('viewport:changed', (range) => this.propagateViewport(cell.id, range));
    }

    // ── sync links ──────────────────────────────────────────────
    private applySyncSetting(kind: SyncKind, setting: SyncSetting | undefined, align = false): void {
        if (setting == null || setting === false) delete this.syncOpts[kind];
        else this.syncOpts[kind] = setting;
        if (kind === 'crosshair') {
            // Any setting change invalidates current ghosts — they rebuild on the next
            // pointer move under the NEW grouping (and vanish entirely when disabled).
            for (const cell of this.cellsById.values()) cell.chart.renderer.setExternalCrosshair(null);
            // A renderer without the seam silently never shows ghosts — warn only when
            // enabling while NO cell can display one (e.g. minimal custom renderers).
            if (setting && ![...this.cellsById.values()].some((c) => c.chart.renderer.supportsExternalCrosshair)) {
                console.warn('[vela] crosshair sync: no cell renderer supports an external crosshair — nothing will show.');
            }
            // Refresh the layout dropdown's toggle check (absent during constructor boot).
            if (this.topbar && this.def) this.topbar.setLayout(this.def.id);
            this.markStateDirty();
            return; // no market/viewport alignment applies to a pointer link
        }
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
        this.objectTree.setSymbol(cell.symbol);
    }

    /** Trigger ② — a cell's indicator ledger changed: count + picker only if active. */
    private onCellIndicatorsChanged(id: string): void {
        this.markStateDirty();
        if (id !== this.activeId) return;
        const cell = this.cellsById.get(id);
        if (!cell) return;
        this.topbar.setIndicatorCount(cell.indicatorCount);
        this.indicatorPicker.sync();
    }

    /** Timeframe changes routed from the topbar menu / quick entry (chip state follows). */
    private setActiveTimeframe(tf: string): void {
        this.bottombar?.setActiveRange(null);
        this.active.setTimeframe(tf);
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
        this.keymap.register({ id: 'indicators.open', keys: '/', label: 'Open the indicator picker', category: 'Indicators', run: () => this.indicatorPicker.open() });
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
        const t = ev.target as Partial<HTMLElement> | null;
        const tag = (t?.tagName ?? '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable === true) return;
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
