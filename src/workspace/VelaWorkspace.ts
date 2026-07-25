// VelaWorkspace — the multi-chart shell: a CSS-Grid of ChartCells behind ONE shared
// data feed, with stable slot ids (`c1`…`cN`), an ACTIVE cell, resizable splitters,
// and a state pool so layout changes never lose a slot's market/config/drawings.
// The shared chrome (topbar, pickers, drawing toolbar…) projects onto the active
// cell and lands in the next phase — this file is the skeleton it plugs into.
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { ThemeName, VelaTheme, NativeBackend } from '../core/options';
import { resolveTheme } from '../core/theme';
import { TypedEventBus } from '../core/events/EventBus';
import { MultiProviderFeed } from '../data/MultiProviderFeed';
import { sharedBarStore } from '../data/BarStore';
import { ensureUIHost, injectStyles } from '../ui';
import type { Vela } from '../Vela';
import { ChartCell, type CellSeed, type PooledCellState } from './ChartCell';
import {
    registerBuiltinLayouts,
    layoutDefinition,
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
    theme?: ThemeName | VelaTheme;
    live?: boolean;
    volume?: boolean;
    statusline?: boolean;
    watermark?: boolean;
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
}

const GAP_PX = 2; // grid gap — the visible seam between cells (splitter strips center on it)
const POOL_CAP = 16; // dormant slot states kept across layout shrinks

const STYLE_ID = 'vela-workspace';
const CSS = `
.vela-workspace { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--vela-bg); }
.vela-ws-grid { position: relative; flex: 1 1 auto; min-height: 0; display: grid; gap: ${GAP_PX}px; background: var(--vela-border-soft); }
.vela-cell { background: var(--vela-bg); }
.vela-cell[data-active='1'] { outline: 1px solid var(--vela-accent); outline-offset: -1px; z-index: 1; }
.vela-ws-splitter:hover { background: var(--vela-accent); opacity: 0.35; }
`;

export class VelaWorkspace {
    readonly root: HTMLElement;
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

    constructor(container: HTMLElement | string, opts: VelaWorkspaceOptions = {}) {
        registerBuiltinLayouts(); // idempotent — pickers and `layout` ids resolve from the registry
        const hostEl = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
        if (!hostEl) throw new Error(`VelaWorkspace: container not found: ${String(container)}`);
        this.opts = opts;
        this.def = this.resolveLayout(opts.layout ?? '4');

        const doc = hostEl.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.root = doc.createElement('div');
        this.root.className = 'vela-workspace';
        ensureUIHost(this.root, resolveTheme(opts.theme));
        this.gridEl = doc.createElement('div');
        this.gridEl.className = 'vela-ws-grid';
        this.root.appendChild(this.gridEl);
        hostEl.appendChild(this.root);

        // ONE shared feed: providers registered once; every cell's `chart.data` operates
        // on the same registry, symbol index, and closed-bar cache.
        for (const [name, make] of Object.entries(opts.providers ?? {})) void this.feed.registerProvider(name, make());
        void this.feed.ready().then(() => {
            if (!this.destroyed) this.refreshRetention(); // re-key on canonical tickers once indexes settle
        });

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

        this.cellBackend = this.backendFor(this.def);
        this.applyGrid();
        this.buildCells();
        this.setActiveCell(this.def.cells[0]?.id ?? null);
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
        this.activeId = id;
        if (id) {
            const el = this.cellsById.get(id)?.host;
            if (el) el.dataset.active = '1';
        }
        if (id) this.events.emit('cell:active', { id, prev });
    }

    on<K extends keyof WorkspaceEventMap>(event: K, handler: (payload: WorkspaceEventMap[K]) => void): () => void {
        return this.events.on(event, handler);
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
        this.setActiveCell(activeAfterLayout(this.activeId, next.cells.map((c) => c.id)));
        this.refreshRetention();
        this.events.emit('layout:changed', { layout: next.id });
    }

    resize(): void {
        this.splitters.layout(); // each cell's renderer follows its own ResizeObserver
    }

    destroy(): void {
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.splitters.destroy();
        for (const [id, cell] of [...this.cellsById]) {
            cell.destroy();
            this.cellsById.delete(id);
        }
        sharedBarStore.retain(new Set()); // back to the single-chart retention policy
        this.root.remove();
        this.events.clear();
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
            const seed: PooledCellState = this.pool.get(slot.id) ?? { ...(this.opts.defaults ?? {}), ...(this.opts.cells?.[slot.id] ?? {}) };
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
                activate: (id) => this.setActiveCell(id),
                onMarketChanged: () => this.refreshRetention(),
            });
            cell.host.style.gridArea = perCell[slot.id]?.gridArea ?? '';
            this.cellsById.set(slot.id, cell);
            this.events.emit('cell:created', { id: slot.id });
        }
        // DOM order = slot order (auto-flow layouts place row-major by child order).
        for (const slot of this.def.cells) {
            const host = this.cellsById.get(slot.id)?.host;
            if (host) this.gridEl.appendChild(host);
        }
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
