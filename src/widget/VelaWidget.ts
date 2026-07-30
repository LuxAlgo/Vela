// VelaWidget — the batteries-included chart app: topbar + chart host (statusline,
// watermark overlays) + bottombar, built on the vela/ui kit around a headless Vela core.
// Symbol/timeframe/depth changes switch the market IN PLACE (`chart.setMarket`) — the
// inner chart instance survives, so indicators, user drawings, renderer config and event
// subscriptions all carry over. `rebuild()` (destroy + recreate + re-register
// providers/engines/indicators) remains only for construction-level changes.
// Cosmetic state (price style, timezone) survives rebuilds via renderer features.
import { Vela } from '../Vela';
import { registerBuiltinChartTypes } from '../chart-types/builtins';
import type { VelaOptions } from '../core/options';
import { resolveTheme } from '../core/theme';
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import { ensureUIHost, injectStyles } from '../ui';
import { KeymapManager } from '../ui/keymap';
import { Topbar } from './topbar';
import { Statusline } from './statusline';
import { Watermark } from './watermark';
import { Bottombar, type RangePreset } from './bottombar';
import { SymbolPicker } from './symbol-picker';
import { ObjectTree } from './object-tree';
import { DataWindow } from './data-window';
import { ShortcutsHelp } from './shortcuts-help';
import { ChartContextMenu } from './context-menu';
import { widgetAttachments, type WidgetContext } from './contributions';
import { IndicatorPicker } from './indicator-picker';
import { TimeframeQuick } from './timeframe-quick';
import { parsePersisted, legacyWidgetState, localStorageAdapter, type WidgetStorage } from './persist';
import { encodeState, decodeState, sanitizeState, type WorkspaceState, type CellState } from '../state/document';
import { readUrlState, writeUrlState } from './url-state';
import { Glider, ZOOM_IN, ZOOM_OUT, PAN_FAST } from './glide';
import { toolShortcutHints } from './tool-shortcuts';
import { WidgetHistory } from './history';
import { Toast } from './toast';
import { Menu } from '../ui/components/menu';
import { resolveIndicators, type IndicatorManifest, type ResolvedIndicator } from './indicators';
import type { IndicatorHandle } from '../core/IndicatorHandle';

export interface VelaWidgetOptions extends VelaOptions {
    /** Provider factories, keyed by provider name — called on every chart (re)build. */
    providers?: Record<string, () => DataProvider>;
    /** Scripting-engine factories, keyed by language — called on every chart (re)build. */
    engines?: Record<string, () => ScriptingEngine>;
    /** Indicator manifest (inline JSON) or a URL returning it — see widget/indicators.ts. */
    indicators?: string | IndicatorManifest;
    /** Topbar timeframe presets (chart timeframe values). */
    timeframes?: string[];
    /** Initial price style (default 'candles'); changed live via the topbar dropdown. */
    priceStyle?: string;
    /** Initial display timezone (IANA; default 'Etc/UTC'). */
    timezone?: string;
    /** Chrome toggles (all default true). */
    statusline?: boolean;
    watermark?: boolean;
    bottombar?: boolean;
    /** Focus the chart when it mounts so keyboard shortcuts work from the first
     *  keystroke — no initial click needed. Default false: an embedded chart must
     *  never steal the page's focus from the host's own controls. */
    autofocus?: boolean;
    /** Bring the chart back AS YOU LEFT IT: the widget persists its full state — the
     *  unified single-cell document `getState()` returns (market, prefs, renderer
     *  config, user drawings, indicators) — and restores it at construction. `true`
     *  uses the key 'vela-widget'; a string is the storage key. Legacy three-key
     *  payloads (pre-unified) migrate transparently on the first save. */
    persist?: boolean | string;
    /** Storage backend for `persist` — defaults to localStorage. Inject any
     *  `WidgetStorage` (sync or async) for custom backends (REST, IndexedDB, …). */
    storage?: WidgetStorage;
    /** Mirror symbol/timeframe/style/timezone in the URL query (shareable links). A URL
     *  param wins over persisted state at load. Default false. */
    urlState?: boolean;
}

const DEFAULT_TIMEFRAMES = ['1', '5', '15', '60', '240', 'D', 'W'];

// The topbar's own styles live in the Topbar component (it injects them itself, so a
// workspace reusing the component gets them too); only the widget SHELL layout stays here.
const WIDGET_STYLE_ID = 'vela-widget';
const WIDGET_CSS = `
.vela-widget { display: flex; flex-direction: column; width: 100%; height: 100%; background: var(--vela-bg); }
.vela-widget-main { display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; }
.vela-widget-chart { position: relative; flex: 1 1 auto; min-width: 0; }
`;

export class VelaWidget {
    readonly root: HTMLElement;
    /** The shortcut system — widget modules and plugins register their bindings here. */
    readonly keymap: KeymapManager;

    private readonly opts: VelaWidgetOptions;
    private readonly chartHost: HTMLElement;
    private readonly topbar: Topbar;
    private readonly statusline: Statusline | null;
    private readonly watermark: Watermark | null;
    private readonly bottombar: Bottombar | null;
    private readonly objectTree: ObjectTree;
    private readonly dataWindow: DataWindow;
    private shortcutsHelp: ShortcutsHelp | null = null;
    private readonly contextMenu: ChartContextMenu;
    private readonly symbolPicker: SymbolPicker;
    private readonly indicatorPicker: IndicatorPicker;
    private readonly tfQuick: TimeframeQuick;
    private inner: Vela | null = null;
    /** The manifest library (loaded once). */
    private manifest: ResolvedIndicator[] = [];
    /** Live instances — the SAME entry may be added several times. */
    private instances: Array<{ entry: ResolvedIndicator; handle: IndicatorHandle | null }> = [];
    /** Native-indicator catalog of the CURRENT chart (refreshed per rebuild/change). */
    private nativeCatalog: Array<{ type: string; title: string; supported: boolean; present: boolean; beta?: boolean }> = [];
    private readonly storageKey: string | null;
    private readonly storage: WidgetStorage;
    private openDialogs = 0;
    private readonly onRootKeydown = (ev: KeyboardEvent): void => this.routeTyping(ev);
    private symbol: string;
    private timeframe: string;
    private priceStyle: string;
    private timezone: string;
    private bars: number;
    private watermarkOn: boolean;
    private pendingRange: RangePreset | null = null;
    /** Extra fetch depth the ACTIVE range chip needs — a view concern, kept apart from the
     *  user's own `bars` setting so a preset never overwrites their preference. */
    private rangeBars = 0;
    private toast: Toast | null = null;
    private alerts: Array<{ title: string; message: string; time: number }> = [];
    private alertsMenu: Menu | null = null;
    private readonly glider = new Glider(() => this.inner);
    /** Unified app+drawings undo timeline (Ctrl+Z / Ctrl+Y). Late-resolves the CURRENT
     *  inner chart so steps recorded before a rebuild never act on a destroyed instance. */
    readonly history = new WidgetHistory(() => this.inner);
    private lastCrossPrice: number | null = null;
    private lastCrossTime: number | null = null;
    /** Renderer cosmetic template carried across rebuilds (and persisted when enabled). */
    private savedConfig: unknown = null;
    /** User-drawings document carried across rebuilds (and persisted when enabled). */
    private savedDrawings: unknown = null;
    /** A restored indicator ledger waiting for the manifest to resolve. */
    private pendingIndicators: { manifest: string[]; natives: string[] } | null = null;
    /** Volume presence decided by a RESTORED ledger (null = follow the option). */
    private ledgerVolume: boolean | null = null;
    /** True when the boot state came from the LEGACY three-key layout — the first
     *  unified save then drops the old `:config`/`:drawings` sub-keys. */
    private legacyKeys = false;
    private stateTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly stateListeners = new Set<() => void>();
    /** Favorite drawing-tool types — mirrored from chart events, reapplied on rebuilds. */
    private favs: string[] = [];
    /** Mounted attachment disposers (by id), torn down at destroy. */
    private readonly attachmentDisposers = new Map<string, () => void>();
    private readonly onUnload = (): void => this.persistNow();
    private indicatorsPromise: Promise<ResolvedIndicator[]> | null = null;
    private destroyed = false;
    private buildSeq = 0;

    constructor(container: HTMLElement | string, opts: VelaWidgetOptions) {
        const hostEl = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
        if (!hostEl) throw new Error(`VelaWidget: container not found: ${String(container)}`);
        // The topbar style dropdown reads chart-type labels — register the built-ins
        // before any chrome renders (idempotent; the Vela constructor does it too).
        registerBuiltinChartTypes();
        this.opts = opts;
        this.storageKey = opts.persist === undefined || opts.persist === false ? null : opts.persist === true ? 'vela-widget' : opts.persist;
        this.storage = opts.storage ?? localStorageAdapter();
        // ── persistence boot (same protocol as the workspace): ONE unified state
        // document under the main key — the widget is the single-cell case of the
        // shared format. A SYNC storage restores before the first build; an async
        // adapter resolves later and late-applies via applyState. A LEGACY three-key
        // payload (prefs + `:config` + `:drawings`) migrates transparently: read once
        // here, rewritten unified on the first save.
        let boot: WorkspaceState | null = null;
        if (this.storageKey !== null) {
            const raw = this.storage.get(this.storageKey);
            if (raw instanceof Promise) void this.bootAsync(raw);
            else {
                boot = raw != null ? decodeState(raw) : null;
                if (!boot) boot = this.bootLegacySync(raw);
            }
            window.addEventListener('beforeunload', this.onUnload);
        }
        const bootCell = boot ? (boot.charts.find((c) => c.id === 'c1') ?? boot.charts[0]) : undefined;
        const fromUrl = opts.urlState ? readUrlState(typeof location !== 'undefined' ? location.search : '') : {};
        this.symbol = fromUrl.symbol ?? bootCell?.symbol ?? opts.symbol ?? '';
        this.timeframe = fromUrl.timeframe ?? bootCell?.timeframe ?? opts.timeframe ?? '60';
        this.priceStyle = fromUrl.priceStyle ?? bootCell?.priceStyle ?? opts.priceStyle ?? 'candles';
        this.timezone = fromUrl.timezone ?? boot?.timezone ?? opts.timezone ?? 'Etc/UTC';
        this.bars = Number(fromUrl.bars ?? bootCell?.bars ?? opts.bars ?? 1000);
        this.watermarkOn = bootCell?.watermark !== undefined ? bootCell.watermark : opts.watermark !== false;
        this.favs = boot?.favorites ? [...boot.favorites] : [];
        this.savedConfig = bootCell?.rendererConfig ?? null;
        this.savedDrawings = bootCell?.drawings ?? null;
        this.pendingIndicators = bootCell?.indicators ?? null;
        // A restored ledger decides the auto-added volume too (a chart persisted
        // without it must come back without it); no ledger → the option default.
        this.ledgerVolume = bootCell?.indicators ? bootCell.indicators.natives.includes('volume') : null;

        const doc = hostEl.ownerDocument;
        injectStyles(WIDGET_STYLE_ID, WIDGET_CSS, doc);
        this.root = doc.createElement('div');
        this.root.className = 'vela-widget';
        ensureUIHost(this.root, resolveTheme(opts.theme));

        this.symbolPicker = new SymbolPicker({
            host: this.root,
            onSelect: (ticker) => this.setSymbol(ticker),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.indicatorPicker = new IndicatorPicker({
            host: this.root,
            library: () => [
                ...this.nativeCatalog
                    .filter((n) => n.supported)
                    .map((n) => ({ name: n.title, category: 'Vela', native: true, nativeType: n.type, beta: n.beta })),
                ...this.manifest.map((e) => ({ name: e.name, language: e.language, category: e.category })),
            ],
            onChart: () => [
                ...this.nativeCatalog.filter((n) => n.present).map((n) => ({ name: n.title, native: true, nativeType: n.type })),
                ...this.instances.map((it) => ({ name: it.entry.name, language: it.entry.language })),
            ],
            onAdd: (i) => {
                const natives = this.nativeCatalog.filter((n) => n.supported);
                if (i < natives.length) this.addNative(natives[i]!.type);
                else this.addInstance(i - natives.length);
            },
            onRemove: (i) => {
                const present = this.nativeCatalog.filter((n) => n.present);
                if (i < present.length) this.removeNative(present[i]!.type);
                else this.removeInstance(i - present.length);
            },
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.tfQuick = new TimeframeQuick({
            host: this.root,
            onApply: (tf) => this.setTimeframe(tf),
            onOpenChange: (open) => this.trackDialog(open),
        });
        this.topbar = new Topbar(this.root, {
            symbol: this.symbol,
            onSymbolClick: () => this.symbolPicker.open(),
            onIndicatorsClick: () => this.indicatorPicker.open(),
            onObjectsClick: () => this.objectTree.toggle(),
            onScreenshotClick: () => this.downloadScreenshot(),
            onAlertsClick: (anchor) => this.openAlertsMenu(anchor),
            onDataWindowClick: () => this.dataWindow.toggle(),
            timeframe: this.timeframe,
            timeframes: opts.timeframes ?? DEFAULT_TIMEFRAMES,
            priceStyle: this.priceStyle,
            onTimeframe: (tf) => this.setTimeframe(tf),
            onPriceStyle: (style) => this.setPriceStyle(style),
            getContext: () => this.context(),
        });

        const main = doc.createElement('div');
        main.className = 'vela-widget-main';
        this.chartHost = doc.createElement('div');
        this.chartHost.className = 'vela-widget-chart';
        main.appendChild(this.chartHost);
        this.objectTree = new ObjectTree(main);
        this.dataWindow = new DataWindow(main);
        // The docked panels are exclusive — one column at a time, so the chart keeps its width.
        this.objectTree.onOpenChange = (open) => {
            this.topbar.setPanelActive('objects', open);
            if (open) this.dataWindow.toggle(false);
        };
        this.dataWindow.onOpenChange = (open) => {
            this.topbar.setPanelActive('dataWindow', open);
            if (open) this.objectTree.toggle(false);
        };
        this.root.appendChild(main);

        this.contextMenu = new ChartContextMenu(this.chartHost, {
            screenshot: () => this.downloadScreenshot(),
            resetView: () => this.inner?.renderer.set('autoScale', true),
            getContext: () => this.context(),
        });
        this.toast = new Toast(this.chartHost);
        this.watermark = opts.watermark !== false ? new Watermark(this.chartHost, this.symbol, this.timeframe) : null;
        this.watermark?.setVisible(this.watermarkOn);
        this.statusline = opts.statusline !== false ? new Statusline(this.chartHost, this.symbol) : null;
        this.statusline?.setMeta(this.timeframe, typeof opts.provider === 'string' ? opts.provider : '');
        this.bottombar =
            opts.bottombar !== false
                ? new Bottombar(this.root, {
                      timezone: this.timezone,
                      onRange: (preset) => this.applyRange(preset),
                      onTimezone: (zone) => this.setTimezone(zone),
                      onSettingsClick: () => this.inner?.renderer.openSettings(),
                  })
                : null;

        hostEl.appendChild(this.root);

        this.keymap = new KeymapManager();
        this.keymap.attach(this.root);
        this.keymap.register({
            id: 'chart.screenshot',
            keys: 'mod+alt+s',
            label: 'Download a chart screenshot',
            category: 'Chart',
            run: () => this.downloadScreenshot(),
        });
        this.keymap.register({ id: 'chart.reset-view', keys: 'alt+r', label: 'Reset view (all history)', category: 'Chart', run: () => this.inner?.setVisibleRangePreset('ALL') });
        this.keymap.register({ id: 'chart.toggle-log', keys: 'alt+l', label: 'Toggle logarithmic scale', category: 'Chart', run: () => this.inner?.renderer.set('logScale', !this.inner.renderer.get('logScale')) });
        this.keymap.register({
            id: 'chart.toggle-percent',
            keys: 'alt+p',
            label: 'Toggle percent scale',
            category: 'Chart',
            run: () => {
                const mode = this.inner?.renderer.get('scaleMode');
                this.inner?.renderer.set('scaleMode', mode === 'percent' ? 'price' : 'percent');
            },
        });
        this.keymap.register({ id: 'drawings.trendline', keys: 'alt+t', label: 'Arm the trend line tool', category: 'Drawings', run: () => this.inner?.drawings.setTool('trendline') });
        this.keymap.register({
            id: 'drawings.hline-cursor',
            keys: 'alt+h',
            label: 'Horizontal line at the cursor price',
            category: 'Drawings',
            run: () => {
                if (this.lastCrossPrice != null && this.lastCrossTime != null)
                    this.inner?.drawings.add('hline', { anchors: [{ time: this.lastCrossTime, price: this.lastCrossPrice }] });
            },
        });
        this.keymap.register({
            id: 'drawings.vline-cursor',
            keys: 'alt+v',
            label: 'Vertical line at the cursor time',
            category: 'Drawings',
            run: () => {
                if (this.lastCrossTime != null && this.lastCrossPrice != null)
                    this.inner?.drawings.add('vline', { anchors: [{ time: this.lastCrossTime, price: this.lastCrossPrice }] });
            },
        });
        this.keymap.register({ id: 'history.undo', keys: ['mod+z'], label: 'Undo', category: 'Edit', run: () => this.history.undo() });
        this.keymap.register({ id: 'history.redo', keys: ['mod+y', 'mod+shift+z'], label: 'Redo', category: 'Edit', run: () => this.history.redo() });
        this.keymap.register({ id: 'view.zoom-in', keys: 'mod+arrowup', label: 'Zoom in', category: 'Chart', run: () => this.glider.zoom(ZOOM_IN) });
        this.keymap.register({ id: 'view.zoom-out', keys: 'mod+arrowdown', label: 'Zoom out', category: 'Chart', run: () => this.glider.zoom(ZOOM_OUT) });
        // Pan keys mirror a drag exactly (same clamp, same easing) — see Vela.panBy.
        this.keymap.register({ id: 'view.pan-left', keys: 'mod+arrowleft', label: 'Pan toward history', category: 'Chart', run: () => this.inner?.panBy(-PAN_FAST) });
        this.keymap.register({ id: 'view.pan-right', keys: 'mod+arrowright', label: 'Pan toward now', category: 'Chart', run: () => this.inner?.panBy(PAN_FAST) });
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
        // Type-to-act routing (any printable, so outside keymap chords): letters open the
        // symbol search seeded with the char, digits open the timeframe quick entry.
        this.root.addEventListener('keydown', this.onRootKeydown);
        this.root.tabIndex = -1; // focusable host so bare keystrokes land here

        this.rebuild();
        this.mountAttachments();
        // Shortcuts only fire while focus is INSIDE the widget (the keymap listens on
        // the root) — autofocus makes them work before the first click.
        if (opts.autofocus) this.inner?.renderer.focus();
    }

    /** Mount registered attachments not yet mounted on this widget (idempotent per id). */
    private mountAttachments(): void {
        for (const att of widgetAttachments()) {
            if (this.attachmentDisposers.has(att.id)) continue;
            try {
                this.attachmentDisposers.set(att.id, att.mount(this.context()));
            } catch (err) {
                console.warn(`[vela] widget attachment "${att.id}" failed to mount:`, err);
            }
        }
    }

    /** The context handed to contributed actions (see `registerWidgetAction`). */
    context(): WidgetContext {
        // `chart` resolves lazily: the context is also built during early construction
        // (topbar projection) when no inner chart exists yet — only touching `.chart`
        // then would throw, and only if an action's `when()` actually reads it.
        const self = this;
        return {
            get chart() {
                return self.chart;
            },
            symbol: this.symbol,
            timeframe: this.timeframe,
            priceStyle: this.priceStyle,
            setSymbol: (symbol) => this.setSymbol(symbol),
            setTimeframe: (tf) => this.setTimeframe(tf),
            setPriceStyle: (style) => this.setPriceStyle(style),
            openSymbolSearch: (query) => this.symbolPicker.open(query ?? ''),
            host: this.root,
            toast: (message, kind) => this.toast?.show(message, kind),
        };
    }

    /** The recent engine alerts (topbar bell). */
    private openAlertsMenu(anchor: HTMLElement): void {
        this.alertsMenu?.destroy();
        const items = this.alerts.length
            ? this.alerts.map((a, i) => ({
                  id: String(i),
                  label: `${new Date(a.time).toLocaleTimeString()} · ${a.title}: ${a.message}`.slice(0, 70),
              }))
            : [{ id: 'none', label: 'No alerts yet', disabled: true }];
        this.alertsMenu = new Menu({ host: this.root, items, onSelect: () => {} });
        const r = anchor.getBoundingClientRect();
        this.alertsMenu.openAt(r.left, r.bottom + 4);
    }

    /** Re-project contributed topbar actions (after late registrations). */
    refreshActions(): void {
        this.mountAttachments();
        this.topbar.renderActions();
    }

    /** The inner headless chart of the CURRENT build — becomes a new instance after a
     *  symbol/timeframe change; don't cache it across awaits. */
    get chart(): Vela {
        if (!this.inner) throw new Error('VelaWidget is destroyed');
        return this.inner;
    }

    /** Chrome that must follow the timeframe wherever it changes from (menu, quick entry,
     *  range chip, API). Keeping it in one place is what stopped the status line from
     *  drifting out of sync with the topbar. */
    private syncTimeframeChrome(tf: string): void {
        this.timeframe = tf;
        this.topbar.setTimeframe(tf);
        this.watermark?.update(this.symbol, tf);
        this.statusline?.setMeta(tf, typeof this.opts.provider === 'string' ? this.opts.provider : '');
    }

    setTimeframe(tf: string): void {
        if (tf === this.timeframe || this.destroyed) return;
        // Leaving range mode: drop the chip highlight AND its fetch budget (back to the
        // user's own `bars`). Done HERE so every path — menu, quick entry, keyboard,
        // public API, plugins — behaves the same.
        this.bottombar?.setActiveRange(null);
        this.rangeBars = 0;
        this.syncTimeframeChrome(tf);
        this.markStateDirty();
        // In-place switch (no rebuild): indicators re-execute, drawings/config survive.
        // `bars` re-asserts the user's own depth, shedding a range chip's deeper budget.
        void this.inner?.setMarket({ timeframe: tf, bars: this.bars });
    }

    setSymbol(symbol: string): void {
        if (symbol === this.symbol || this.destroyed) return;
        this.symbol = symbol;
        this.topbar.setSymbol(symbol);
        this.statusline?.setSymbol(symbol);
        this.objectTree.setSymbol(symbol);
        this.watermark?.update(symbol, this.timeframe);
        this.markStateDirty();
        // In-place switch (no rebuild) — the chart instance, indicators, and drawings survive.
        void this.inner?.setMarket({ symbol });
    }

    // ── state surface (same triplet as the workspace: getState / applyState / state:changed) ──

    /**
     * Snapshot the COMPLETE widget state as the unified shell document — the SAME
     * format `VelaWorkspace.getState()` returns, with a single `c1` cell: market,
     * display prefs, the renderer config document, the user-drawings document, and
     * the indicator ledger. This is what `persist` writes; hosts build custom flows
     * on it (server snapshots, share links, templates) — and a saved widget state
     * drops into a workspace slot as-is.
     */
    getState(): WorkspaceState {
        const cell: CellState = {};
        // Market identity from the LIVE config when possible — an in-flight setMarket
        // must be captured as the intent (persist-on-close correctness).
        const live = this.inner?.market;
        const symbol = live?.symbol ?? this.symbol;
        if (symbol) cell.symbol = symbol;
        const provider = live?.provider ?? (typeof this.opts.provider === 'string' ? this.opts.provider : undefined);
        if (provider) cell.provider = provider;
        cell.timeframe = live?.timeframe ?? this.timeframe;
        cell.priceStyle = this.priceStyle;
        if (this.bars > 0) cell.bars = this.bars;
        cell.watermark = this.watermarkOn;
        if (this.inner) {
            cell.rendererConfig = this.inner.renderer.getConfig();
            cell.drawings = this.inner.drawings.toJSON();
        } else {
            if (this.savedConfig != null) cell.rendererConfig = this.savedConfig;
            if (this.savedDrawings != null) cell.drawings = this.savedDrawings;
        }
        const present = this.nativeCatalog.filter((n) => n.present).map((n) => n.type);
        cell.indicators = {
            // A restored ledger still waiting for the manifest must not be wiped by an
            // early save — report the pending names until instances materialize.
            manifest: this.instances.length > 0 ? this.instances.map((it) => it.entry.name) : (this.pendingIndicators?.manifest ?? []),
            natives: present.length > 0 ? present : (this.pendingIndicators?.natives ?? []),
        };
        const state: WorkspaceState = { version: 1, layout: '1', activeCellId: 'c1', timezone: this.timezone, charts: [{ id: 'c1', ...cell }] };
        if (this.favs.length > 0) state.favorites = [...this.favs];
        return state;
    }

    /**
     * Restore a state document produced by {@link getState} — or by a WORKSPACE (the
     * first cell of a multi-cell document applies). Untrusted-safe: malformed fields
     * are dropped. Applied IN PLACE: the chart instance survives (market switches via
     * `setMarket`), config/drawings/indicators are replaced. With `urlState` enabled,
     * URL params still win over the document's market/prefs fields.
     */
    applyState(state: unknown): void {
        if (this.destroyed) return;
        const st = sanitizeState(state);
        if (!st) return;
        const cell = st.charts.find((c) => c.id === 'c1') ?? st.charts[0];
        const fromUrl = this.opts.urlState ? readUrlState(typeof location !== 'undefined' ? location.search : '') : {};
        const tz = fromUrl.timezone ?? st.timezone;
        if (tz && tz !== this.timezone) this.setTimezone(tz);
        if (st.favorites) {
            this.favs = [...st.favorites];
            this.inner?.drawings.setFavorites(this.favs as never[]);
        }
        if (cell) {
            const style = fromUrl.priceStyle ?? cell.priceStyle;
            if (style && style !== this.priceStyle) this.setPriceStyle(style);
            if (cell.watermark !== undefined && cell.watermark !== this.watermarkOn) this.setWatermarkVisible(cell.watermark);
            if (cell.rendererConfig != null) {
                this.savedConfig = cell.rendererConfig;
                this.inner?.renderer.applyConfig(cell.rendererConfig);
            }
            if (cell.drawings != null) {
                this.savedDrawings = cell.drawings;
                this.inner?.drawings.fromJSON(cell.drawings);
            }
            if (cell.indicators) this.applyIndicatorLedger(cell.indicators);
            // Market last, as ONE in-place switch — `market:changed` re-syncs the chrome.
            const symbol = fromUrl.symbol ?? cell.symbol;
            const timeframe = fromUrl.timeframe ?? cell.timeframe;
            const bars = Number(fromUrl.bars ?? cell.bars ?? 0);
            const next: { symbol?: string; timeframe?: string; bars?: number } = {};
            if (symbol && symbol !== this.symbol) next.symbol = symbol;
            if (timeframe && timeframe !== this.timeframe) next.timeframe = timeframe;
            if (bars > 0 && bars !== this.bars) {
                this.bars = bars;
                next.bars = Math.max(bars, this.rangeBars);
            }
            if (Object.keys(next).length > 0) void this.inner?.setMarket(next);
        }
        this.markStateDirty();
    }

    /** Subscribe to `state:changed` — the persistable state changed (debounced ~500ms);
     *  re-pull {@link getState}. Returns an unsubscribe function. */
    on(event: 'state:changed', handler: () => void): () => void {
        if (event !== 'state:changed') return () => undefined;
        this.stateListeners.add(handler);
        return () => this.stateListeners.delete(handler);
    }

    /** Replace the indicator ledger: natives converge to the listed set (volume
     *  included — removing it sticks, the core's auto-add respects the opt-out),
     *  manifest instances are re-created by name — held until the manifest resolves. */
    private applyIndicatorLedger(led: { manifest: string[]; natives: string[] }): void {
        const chart = this.inner;
        if (!chart) return;
        this.ledgerVolume = led.natives.includes('volume');
        for (const type of led.natives) {
            if (!this.nativeCatalog.some((n) => n.type === type && n.present)) chart.addNativeIndicator(type);
        }
        for (const n of this.nativeCatalog) {
            if (n.present && !led.natives.includes(n.type)) chart.addNativeIndicator(n.type).remove();
        }
        for (const it of [...this.instances]) this.dropInstance(it);
        if (this.manifest.length > 0) {
            for (const name of led.manifest) {
                const entry = this.manifest.find((e) => e.name === name);
                if (entry) this.instances.push({ entry, handle: this.addToChart(chart, entry) });
            }
            this.pendingIndicators = null;
        } else {
            this.pendingIndicators = led; // manifest still resolving — consumed on resolution
        }
        this.refreshNativeCatalog();
        this.syncIndicatorCount();
    }

    /** SYNC boot fallback: a LEGACY three-key payload read at construction. */
    private bootLegacySync(rawMain: string | null): WorkspaceState | null {
        if (this.storageKey === null) return null;
        const cfg = this.storage.get(`${this.storageKey}:config`);
        const drw = this.storage.get(`${this.storageKey}:drawings`);
        if (cfg instanceof Promise || drw instanceof Promise) return null; // mixed sync/async adapter — treat as fresh
        const doc = sanitizeState(legacyWidgetState(parsePersisted(rawMain), cfg, drw));
        if (doc) this.legacyKeys = true;
        return doc;
    }

    /** ASYNC boot: resolve the unified document (or migrate a legacy payload), then
     *  late-apply it — the widget built with option defaults in the meantime. */
    private async bootAsync(rawMain: Promise<string | null>): Promise<void> {
        let doc: WorkspaceState | null = null;
        try {
            const raw = await rawMain;
            doc = raw != null ? decodeState(raw) : null;
            if (!doc && this.storageKey !== null) {
                const [cfg, drw] = await Promise.all([
                    Promise.resolve(this.storage.get(`${this.storageKey}:config`)),
                    Promise.resolve(this.storage.get(`${this.storageKey}:drawings`)),
                ]);
                doc = sanitizeState(legacyWidgetState(parsePersisted(raw), cfg, drw));
                if (doc) this.legacyKeys = true;
            }
        } catch {
            doc = null;
        }
        if (doc && !this.destroyed) this.applyState(doc);
    }

    /** Show/hide the symbol watermark behind the chart (persisted). */
    setWatermarkVisible(visible: boolean): void {
        this.watermarkOn = visible;
        this.watermark?.setVisible(visible);
        this.markStateDirty();
    }

    /** Applied LIVE (renderer feature) — no rebuild; persists across rebuilds. */
    setPriceStyle(style: string): void {
        this.priceStyle = style;
        this.topbar.setPriceStyle(style);
        this.inner?.renderer.set('priceStyle', style);
        this.markStateDirty();
    }

    /** Applied LIVE (renderer feature) — no rebuild; persists across rebuilds. */
    setTimezone(zone: string): void {
        this.timezone = zone;
        this.bottombar?.setTimezone(zone);
        this.inner?.renderer.set('timezone', zone);
        this.markStateDirty();
    }

    /**
     * Range chip: switch to the preset's timeframe, fetch enough history for its window,
     * and frame it once ready. The in-place `setMarket` loads the depth, so it also runs
     * when only the DEPTH grows (same timeframe, deeper window).
     */
    applyRange(preset: RangePreset): void {
        if (this.destroyed) return;
        this.pendingRange = preset;
        const tfChanged = preset.tf !== this.timeframe;
        const deeper = preset.bars > Math.max(this.bars, this.rangeBars);
        this.rangeBars = preset.bars;
        if (tfChanged) this.syncTimeframeChrome(preset.tf);
        if (tfChanged || deeper) {
            // The preset frames the FIRST paint of the new depth (no flash), then is
            // re-asserted once painted so a deeper backfill landing behind stays framed.
            void this.inner
                ?.setMarket({ timeframe: preset.tf, bars: Math.max(this.bars, this.rangeBars), visibleRange: preset.preset })
                .then(() => {
                    if (!this.destroyed && this.pendingRange === preset) {
                        this.inner?.setVisibleRangePreset(preset.preset);
                        this.pendingRange = null;
                    }
                });
        } else {
            this.inner?.setVisibleRangePreset(preset.preset);
            this.pendingRange = null;
        }
    }

    destroy(): void {
        this.destroyed = true;
        // Flush BEFORE tearing the chart down — getConfig/toJSON need it alive.
        this.persistNow();
        this.inner?.destroy();
        this.inner = null;
        for (const dispose of this.attachmentDisposers.values()) {
            try {
                dispose();
            } catch {
                /* attachment cleanup must never block destroy */
            }
        }
        this.attachmentDisposers.clear();
        window.removeEventListener('beforeunload', this.onUnload);
        this.root.removeEventListener('keydown', this.onRootKeydown);
        this.topbar.destroy();
        this.objectTree.destroy();
        this.dataWindow.destroy();
        this.shortcutsHelp?.destroy();
        this.contextMenu.destroy();
        this.symbolPicker.destroy();
        this.indicatorPicker.destroy();
        this.tfQuick.destroy();
        this.statusline?.destroy();
        this.watermark?.destroy();
        this.bottombar?.destroy();
        this.toast?.destroy();
        this.alertsMenu?.destroy();
        this.glider.stop();
        this.history.destroy();
        this.keymap.destroy();
        this.root.remove();
    }

    /** Destroy + recreate the inner chart with the current symbol/timeframe, then
     *  re-register providers/engines, rebind chrome, and re-add manifest indicators. */
    private rebuild(): void {
        const seq = ++this.buildSeq;
        if (this.inner) {
            this.savedConfig = this.inner.renderer.getConfig();
            this.savedDrawings = this.inner.drawings.toJSON();
        }
        this.inner?.destroy();

        const {
            providers,
            engines,
            indicators,
            timeframes: _timeframes,
            priceStyle: _priceStyle,
            timezone: _timezone,
            statusline: _statusline,
            watermark: _watermark,
            bottombar: _bottombar,
            ...chartOpts
        } = this.opts;
        const chart = new Vela(this.chartHost, {
            ...chartOpts,
            symbol: this.symbol,
            timeframe: this.timeframe,
            bars: Math.max(this.bars, this.rangeBars),
            volume: this.ledgerVolume ?? chartOpts.volume,
            // A pending range chip frames the FIRST paint (no preview flash, no re-frame).
            ...(this.pendingRange ? { visibleRange: this.pendingRange.preset } : {}),
        });
        for (const [name, make] of Object.entries(providers ?? {})) chart.data.registerProvider(name, make());
        for (const [language, make] of Object.entries(engines ?? {})) chart.registerEngine(language, make());
        this.inner = chart;

        this.symbolPicker.setSource(() => chart.data.symbols());
        this.objectTree.setSymbol(this.symbol);
        this.objectTree.onChart(chart);
        this.dataWindow.onChart(chart);
        this.contextMenu.onChart(chart);
        this.refreshNativeCatalog();
        chart.on('indicator:added', () => {
            this.refreshNativeCatalog();
            this.markStateDirty();
        });
        chart.on('indicator:removed', ({ id }) => {
            // Out-of-band removals (legend ✕, object tree, handle.remove()) must drop
            // the matching manifest-instance ledger entry too — a stale entry kept the
            // name in the persisted document and resurrected the indicator on reload.
            // The picker path splices first, so this lookup no-ops there (idempotent).
            const idx = this.instances.findIndex((it) => it.handle?.id === id);
            if (idx >= 0) {
                this.instances.splice(idx, 1);
                this.syncIndicatorCount();
            }
            this.refreshNativeCatalog();
            this.markStateDirty();
        });
        // A restored ledger: natives re-add immediately (no manifest needed); manifest
        // entries wait for the resolution below (the exact set wins over `enabled`).
        if (this.pendingIndicators) for (const type of this.pendingIndicators.natives) chart.addNativeIndicator(type);
        // Market switches happen IN PLACE (`setMarket`) — the chart instance survives, so
        // reflect them from the event: per-symbol native support may differ, the statusline's
        // resting OHLC belongs to the old market, and an out-of-band switch (host code calling
        // chart.setMarket directly) must still update the chrome. The widget's own setters
        // already synced most of it — the guards make this a cheap no-op then.
        chart.on('market:changed', ({ symbol, timeframe }) => {
            this.refreshNativeCatalog();
            if (this.statusline) this.statusline.onChart(chart); // drop the old market's resting OHLC
            if (symbol !== this.symbol) {
                this.symbol = symbol;
                this.topbar.setSymbol(symbol);
                this.statusline?.setSymbol(symbol);
                this.objectTree.setSymbol(symbol);
                this.watermark?.update(symbol, this.timeframe);
            }
            if (timeframe !== this.timeframe) this.syncTimeframeChrome(timeframe);
        });
        this.history.onChart(chart);
        chart.on('alert', (alert) => {
            this.alerts.unshift({ title: alert.title ?? 'Alert', message: alert.message, time: alert.time });
            if (this.alerts.length > 20) this.alerts.pop();
            this.toast?.show(`${alert.title ? alert.title + ' — ' : ''}${alert.message}`, 'info', 4000);
            this.topbar.setAlertCount(this.alerts.length);
        });
        chart.on('indicator:error', ({ error }) => this.toast?.show(error.message, 'error', 5000));
        // Favorite drawing tools: reapply across rebuilds, mirror + persist user toggles.
        if (this.favs.length > 0) chart.drawings.setFavorites(this.favs as never[]);
        chart.on('drawing:favorites', ({ favorites }) => {
            this.favs = favorites;
            this.markStateDirty();
        });
        // Shortcut hints beside the bound tools in the toolbar flyouts (e.g. 'Alt+T').
        if (chart.drawings.supported) chart.drawings.setToolShortcuts(toolShortcutHints(this.keymap));
        // User drawings: every change path (mouse tools, eraser, undo/redo, programmatic
        // add/remove) converges on these three events — persist debounced off them.
        chart.on('drawing:created', () => this.markStateDirty());
        chart.on('drawing:edited', () => this.markStateDirty());
        chart.on('drawing:removed', () => this.markStateDirty());
        chart.renderer.onCrosshairMove((e) => {
            this.lastCrossPrice = e.price;
            this.lastCrossTime = e.time;
        });
        this.topbar.renderActions(); // when() gates may depend on the new chart/context
        if (this.savedConfig != null) chart.renderer.applyConfig(this.savedConfig);
        if (this.savedDrawings != null) chart.drawings.fromJSON(this.savedDrawings);
        // Cosmetic state carried across rebuilds (renderer defaults are candles/UTC).
        if (this.priceStyle !== 'candles') chart.renderer.set('priceStyle', this.priceStyle);
        if (this.timezone !== 'Etc/UTC') chart.renderer.set('timezone', this.timezone);
        this.statusline?.onChart(chart);
        const advanced = {
            title: 'Advanced',
            placement: 'end' as const,
            rows: [
                {
                    kind: 'select' as const,
                    label: 'Bars to fetch',
                    options: ['500', '1000', '2000', '5000', '10000', '20000'],
                    get: () => String(this.bars),
                    set: (v: string) => {
                        this.bars = Number(v);
                        this.markStateDirty();
                        void this.inner?.setMarket({ bars: Math.max(this.bars, this.rangeBars) });
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
            chart.renderer.setSettingsSections([
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
            chart.renderer.setSettingsSections([advanced, watermarkSection]);
        }

        void chart.ready().then(() => {
            if (this.buildSeq !== seq || this.destroyed) return;
            // The chart already framed this window on its first paint (`visibleRange`
            // above). Re-assert it once at ready so a deeper backfill landing behind the
            // first paint still ends on the requested window, then drop the request.
            if (this.pendingRange) {
                chart.setVisibleRangePreset(this.pendingRange.preset);
                this.pendingRange = null;
            }
        });

        if (this.manifest.length || this.instances.length) {
            // Later rebuilds: re-mount every live instance on the fresh chart.
            for (const it of this.instances) it.handle = this.addToChart(chart, it.entry);
            this.syncIndicatorCount();
        } else if (indicators !== undefined) {
            this.indicatorsPromise ??= resolveIndicators(indicators).then((list) => {
                // First resolution: the library + one instance per `enabled` entry —
                // unless a RESTORED ledger names the exact set (then it wins, empty included).
                this.manifest = list;
                const pending = this.pendingIndicators;
                this.instances = pending
                    ? pending.manifest
                          .map((name) => list.find((e) => e.name === name))
                          .filter((e): e is ResolvedIndicator => e != null)
                          .map((entry) => ({ entry, handle: null }))
                    : list.filter((e) => e.enabled).map((entry) => ({ entry, handle: null }));
                if (pending) this.pendingIndicators = null;
                return list;
            });
            void this.indicatorsPromise.then(() => {
                // A newer rebuild (or destroy) may have superseded this chart while resolving.
                if (this.buildSeq !== seq || this.destroyed) return;
                for (const it of this.instances) {
                    it.handle = this.addToChart(chart, it.entry);
                }
                this.syncIndicatorCount();
            });
        }
    }

    /** Refresh the native catalog (supported/present flags) for the current chart. */
    private refreshNativeCatalog(): void {
        const chart = this.inner;
        if (!chart) return;
        void chart.availableNativeIndicators().then((list) => {
            if (this.inner !== chart || this.destroyed) return;
            this.nativeCatalog = list.map((n) => ({ type: n.type, title: n.title, supported: n.supported, present: n.present, beta: n.beta }));
            this.syncIndicatorCount();
            this.indicatorPicker.sync(); // the dialog may be open while the catalog lands
        });
    }

    /** Add a native indicator (single-instance per type — the core dedupes). */
    private addNative(type: string): void {
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

    /** Add ONE instance of a manifest entry (repeatable — duplicates are legitimate). */
    private addInstance(libraryIndex: number): void {
        const entry = this.manifest[libraryIndex];
        if (!entry || this.destroyed) return;
        const it = { entry, handle: this.inner ? this.addToChart(this.inner, entry) : null };
        this.instances.push(it);
        this.syncIndicatorCount();
        const snapshot = it;
        this.history.push({
            undo: () => this.dropInstance(snapshot),
            redo: () => {
                snapshot.handle = this.inner ? this.addToChart(this.inner, snapshot.entry) : null;
                this.instances.push(snapshot);
                this.syncIndicatorCount();
            },
        });
    }

    /** Remove one live instance (picker trash). */
    private removeInstance(instanceIndex: number): void {
        const it = this.instances[instanceIndex];
        if (!it || this.destroyed) return;
        this.dropInstance(it);
        const snapshot = it;
        this.history.push({
            undo: () => {
                snapshot.handle = this.inner ? this.addToChart(this.inner, snapshot.entry) : null;
                this.instances.push(snapshot);
                this.syncIndicatorCount();
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
        this.syncIndicatorCount();
    }

    private syncIndicatorCount(): void {
        this.topbar.setIndicatorCount(this.instances.length + this.nativeCatalog.filter((n) => n.present).length);
    }

    private addToChart(chart: Vela, ind: ResolvedIndicator): IndicatorHandle | null {
        try {
            return chart.addIndicator(ind.script, ind.language !== undefined ? { language: ind.language } : undefined);
        } catch (err) {
            console.warn(`[vela] indicator "${ind.name}" failed to add:`, err);
            return null;
        }
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

    private downloadScreenshot(): void {
        const url = this.inner?.renderer.screenshot();
        if (!url) return;
        const a = this.root.ownerDocument.createElement('a');
        a.href = url;
        a.download = `${this.symbol || 'chart'}-${this.timeframe}.png`;
        a.click();
    }

    /** The persistable state changed: debounce (~500ms), then notify `state:changed`
     *  listeners and flush — the same cadence as the workspace. */
    private markStateDirty(): void {
        if (this.destroyed) return;
        if (this.stateTimer != null) clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => {
            this.stateTimer = null;
            for (const listener of [...this.stateListeners]) listener();
            this.persistNow();
        }, 500);
    }

    /** Write the unified state document through the adapter (persist mode only) — also
     *  the unload/destroy flush. The first save after a LEGACY boot rewrites the main
     *  key in the unified format and drops the old `:config`/`:drawings` sub-keys. */
    private persistNow(): void {
        if (this.stateTimer != null) {
            clearTimeout(this.stateTimer);
            this.stateTimer = null;
        }
        const state = this.getState();
        if (this.storageKey !== null) {
            try {
                void this.storage.set(this.storageKey, encodeState(state));
            } catch {
                /* best-effort */
            }
            if (this.legacyKeys) {
                this.legacyKeys = false;
                try {
                    void this.storage.remove?.(`${this.storageKey}:config`);
                    void this.storage.remove?.(`${this.storageKey}:drawings`);
                } catch {
                    /* best-effort */
                }
            }
        }
        if (this.opts.urlState) {
            writeUrlState({
                symbol: this.symbol,
                timeframe: this.timeframe,
                priceStyle: this.priceStyle,
                timezone: this.timezone,
                bars: String(this.bars),
                watermark: this.watermarkOn ? '1' : '0',
                favorites: this.favs.join(','),
            });
        }
    }
}
