// Layout picker — the topbar's LAYOUT dropdown, two tabs over one canvas column:
//   • Presets — curated multi-chart splits as clickable pictogram tiles (1 large +
//     2 small, 1 wide + 2 below, column/row stripes, …); the ⇄ tile mirrors the
//     asymmetric splits. A click applies the preset immediately.
//   • Grid — a bounded 4×4 canvas with an icon-only mode trio under it: Grid mode
//     hover-previews the full rows×cols rectangle from the top-left (the
//     table-insert idiom) and applies on click; Columns/Rows modes paint per-track
//     chart stacks (click a stack's exact end to clear it) and commit via Apply.
//     Switching Columns ↔ Rows keeps the painted pattern in place (its conjugate).
// Registered layouts that are NOT expressible on the canvas (bespoke plugin presets)
// list as labeled rows under it, and the workspace SYNC switches sit beside the grid.
//
// The panel is a lightweight anchored popover (outside-pointerdown + Escape dismiss)
// rather than a kit Menu: it mixes a canvas, a mode switch and switch rows, which is
// beyond the menu machine's item model. The host element provides the theme
// tokens (the panel portals inside it, same as the menu positioner).
import { injectStyles } from '../ui/styles';
import { iconEl, registerIcon, svg16 } from '../ui/icons';
import { Tooltip } from '../ui/components/tooltip';

// Switch glyphs: a uniform 2×2 grid, full-height columns, full-width rows.
registerIcon('layout-grid', svg16('<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/>'));
registerIcon('layout-columns', svg16('<rect x="1.5" y="1.5" width="5.5" height="13" rx="1"/><rect x="9" y="1.5" width="5.5" height="13" rx="1"/>'));
registerIcon('layout-rows', svg16('<rect x="1.5" y="1.5" width="13" height="5.5" rx="1"/><rect x="1.5" y="9" width="13" height="5.5" rx="1"/>'));

const STYLE_ID = 'vela-widget-layout-picker-v11';
// One monochrome selection language across the panel: lit cells, the active
// orientation segment, sync ON switches, and Apply all speak --vela-selected-*.
const CSS = `
.vela-lp-layer { position: absolute; z-index: var(--vela-z-menu); }
.vela-lp {
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    padding: 10px 12px 10px;
    font-size: 13px;
    user-select: none;
    transform-origin: top;
    animation: vela-lp-in var(--vela-dur-fast) var(--vela-ease);
}
@keyframes vela-lp-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-lp-cols { display: flex; align-items: stretch; gap: 14px; }
.vela-lp-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
    margin-bottom: 10px;
}
/* "?" help badge: hover it for the mode explainer. */
.vela-lp-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg-muted);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0;
    cursor: default;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-badge:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-lp-tip { display: flex; flex-direction: column; gap: 4px; max-width: 230px; white-space: normal; }
.vela-lp-vsep { width: 1px; flex: none; align-self: stretch; background: var(--vela-border-faint); }
/* Layout column sized to the preset tiles; the Grid canvas centers inside it. */
.vela-lp-layout { width: 168px; display: flex; flex-direction: column; align-items: center; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-tabs-row,
.vela-lp-layout > .vela-lp-tools,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
/* Presets | Grid tabs with the "?" help badge to their right. */
.vela-lp-tabs-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.vela-lp-tabs { display: flex; flex: 1 1 auto; gap: 2px; padding: 2px; background: var(--vela-hover); border-radius: 6px; box-sizing: border-box; min-width: 0; }
.vela-lp-tab {
    all: unset;
    flex: 1 1 0;
    text-align: center;
    padding: 5px 0;
    border-radius: 5px;
    cursor: pointer;
    font-size: var(--vela-font-size-md);
    font-weight: 550;
    color: var(--vela-fg-muted);
    transition: color var(--vela-dur-fast) var(--vela-ease), background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-tab:hover { color: var(--vela-fg-bright); }
.vela-lp-tab[data-active='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
/* Preset tiles: mini layout pictograms; the flip tile mirrors the asymmetric splits. */
.vela-lp-tiles { display: grid; grid-template-columns: repeat(3, 52px); grid-auto-rows: 52px; gap: 6px; }
.vela-lp-tile {
    all: unset;
    box-sizing: border-box;
    position: relative;
    border-radius: 6px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease), transform 120ms var(--vela-ease);
}
.vela-lp-tile:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
.vela-lp-tile:active { transform: scale(0.96); }
.vela-lp-tile[data-checked='1'] { border-color: var(--vela-fg-bright); box-shadow: 0 0 0 1px var(--vela-fg-bright); }
.vela-lp-tile-canvas { position: absolute; inset: 6px; }
.vela-lp-tile-pane { position: absolute; border-radius: 2px; background: var(--vela-fg-faint); transition: background var(--vela-dur-fast) var(--vela-ease); }
.vela-lp-tile:hover .vela-lp-tile-pane { background: var(--vela-fg-muted); }
.vela-lp-tile[data-checked='1'] .vela-lp-tile-pane { background: var(--vela-selected-bg); }
.vela-lp-tile-flip { display: inline-flex; align-items: center; justify-content: center; font-size: 15px; color: var(--vela-fg-muted); }
.vela-lp-tile-flip:hover { color: var(--vela-fg-bright); }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 4px; margin-top: 3px; }
.vela-lp-sq {
    all: unset;
    box-sizing: border-box;
    border-radius: 4px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-sq:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
/* Selected/previewed squares — same inverse chip as the active mode + Apply. */
.vela-lp-sq[data-on='1'] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
}
/* Mode trio under the canvas (Grid tab only) — icon always, label only when active. */
.vela-lp-tools {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 10px;
}
.vela-lp-presets { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.vela-lp-preset { all: unset; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--vela-fg-muted); font-size: 12px; white-space: nowrap; transition: transform 120ms var(--vela-ease); }
.vela-lp-preset:hover { background: var(--vela-hover); }
.vela-lp-preset:active { transform: scale(0.98); }
.vela-lp-preset[data-checked='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-sync { display: flex; flex-direction: column; gap: 4px; min-width: 118px; }
.vela-lp-sync-row { all: unset; display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.vela-lp-sync-row:hover { background: var(--vela-hover); }
.vela-lp-sync-row .vela-lp-label { flex: 1 1 auto; }
/* Toggle pill — same control language as the menu's switch rows, monochrome ON state. */
.vela-lp-switch {
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lp-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-lp-switch.on { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }
.vela-lp-switch.on::after { transform: translateX(16px); background: var(--vela-selected-fg); }
.vela-lp-modes { display: inline-flex; flex: none; gap: 2px; padding: 2px; background: var(--vela-hover); border-radius: 6px; }
.vela-lp-mode {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 24px;
    height: 22px;
    padding: 0 5px;
    border-radius: 4px;
    cursor: pointer;
    font-size: var(--vela-font-size-sm);
    font-weight: 550;
    color: var(--vela-fg-muted);
    transition: color var(--vela-dur-fast) var(--vela-ease), background var(--vela-dur-fast) var(--vela-ease), transform 120ms var(--vela-ease), padding 120ms var(--vela-ease);
}
.vela-lp-mode .vela-icon { font-size: 13px; width: 13px; height: 13px; flex: none; }
.vela-lp-mode .vela-lp-mode-label { display: none; }
.vela-lp-mode:hover { color: var(--vela-fg-bright); }
.vela-lp-mode:active { transform: scale(0.96); }
.vela-lp-mode[data-active='1'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); padding: 0 8px; }
.vela-lp-mode[data-active='1'] .vela-lp-mode-label { display: inline; }
/* Commit footer: full panel width, right-aligned. */
.vela-lp-commit {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--vela-border-faint);
}
.vela-lp-apply {
    all: unset;
    padding: 5px 18px;
    border-radius: 5px;
    background: var(--vela-selected-bg);
    color: var(--vela-selected-fg);
    font-size: var(--vela-font-size-md);
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--vela-dur-fast) var(--vela-ease), transform 120ms var(--vela-ease);
}
.vela-lp-apply:hover:not(:disabled) { opacity: 0.85; }
.vela-lp-apply:active:not(:disabled) { transform: scale(0.96); }
.vela-lp-apply:disabled { opacity: 0.35; cursor: default; }
`;

/** The picker canvas is a fixed 4×4 — 16 cells, the workspace pool capacity. */
const GRID = 4;

/**
 * Re-read a stack staircase along the other axis: track i's new count is how many
 * old tracks reached past i. Same lit cells on the canvas, other orientation.
 */
function conjugate(counts: readonly number[]): number[] {
    const next = [0, 0, 0, 0];
    for (let i = 0; i < GRID; i += 1) next[i] = counts.filter((n) => n > i).length;
    return next;
}

/** Custom-mode stacking orientation. */
export type LayoutPickerAxis = 'columns' | 'rows';

/** The three-way switch: uniform grid, column stacks, or row stacks. */
type PickerMode = 'grid' | LayoutPickerAxis;

/** The two panel tabs. */
type PickerTab = 'presets' | 'grid';

/** A Presets-tab tile: a stack split committed through onSelectStacks. */
interface TilePreset {
    counts: readonly number[];
    axis: LayoutPickerAxis;
    label: string;
    /** Label once the ⇄ tile has mirrored the split (counts reversed). */
    flipLabel?: string;
}

/** Curated splits, the most useful multi-chart setups first. */
const TILE_PRESETS: readonly TilePreset[] = [
    { counts: [2, 2], axis: 'columns', label: '2 × 2 grid' },
    { counts: [1, 1], axis: 'columns', label: '2 side by side' },
    { counts: [1, 1], axis: 'rows', label: '2 stacked' },
    { counts: [1, 2], axis: 'columns', label: '1 large + 2 small', flipLabel: '2 small + 1 large' },
    { counts: [1, 3], axis: 'columns', label: '1 large + 3 small', flipLabel: '3 small + 1 large' },
    { counts: [1, 2], axis: 'rows', label: '1 wide + 2 below', flipLabel: '2 above + 1 wide' },
    { counts: [1, 3], axis: 'rows', label: '1 wide + 3 below', flipLabel: '3 above + 1 wide' },
    { counts: [2, 2, 2], axis: 'columns', label: '3 × 2 grid' },
];

/** Canonical key for a stack split — uniform splits collapse to their grid key. */
function stacksKey(counts: readonly number[], axis: LayoutPickerAxis): string {
    if (counts.every((n) => n === counts[0])) {
        const rows = axis === 'columns' ? counts[0] : counts.length;
        const cols = axis === 'columns' ? counts.length : counts[0];
        return `g${rows}x${cols}`;
    }
    return `${axis}:${counts.join('-')}`;
}

/** Canonical key for the current layout shape (null = not canvas-expressible). */
function shapeKey(shape: LayoutPickerShape | null): string | null {
    if (!shape) return null;
    if ('rows' in shape) return `g${shape.rows}x${shape.cols}`;
    return stacksKey(shape.counts, shape.axis);
}

/** The current layout's footprint on the canvas (mirrors the workspace's LayoutShape). */
export type LayoutPickerShape = { rows: number; cols: number } | { counts: number[]; axis: LayoutPickerAxis };

export interface LayoutPickerOptions {
    /** Topbar button that toggles the panel. */
    trigger: HTMLElement;
    /** Positioning/theming host (the widget root — the panel portals inside it). */
    host: HTMLElement;
    /** Current layout's canvas shape (null = a preset the canvas cannot express). */
    shape: () => LayoutPickerShape | null;
    /** Registered layouts NOT expressible on the canvas — rendered as labeled rows. */
    presets: () => Array<{ id: string; label: string; checked: boolean }>;
    onSelectGrid: (rows: number, cols: number) => void;
    /** Stack-mode commit: per-column or per-row chart stacks, per `axis`. */
    onSelectStacks: (counts: number[], axis: LayoutPickerAxis) => void;
    onSelectPreset: (id: string) => void;
    /** SYNC switch rows (re-read on every open and after every toggle). */
    syncs: () => Array<{ id: string; label: string; checked: boolean }>;
    onToggleSync: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export class LayoutPicker {
    private readonly opts: LayoutPickerOptions;
    private readonly doc: Document;
    private readonly layer: HTMLElement;
    private readonly squares: HTMLButtonElement[] = []; // row-major, 16 entries
    private readonly infoTip: Tooltip;
    private readonly modeTips: Tooltip[] = [];
    private readonly modeBtns: Record<PickerMode, HTMLButtonElement>;
    private readonly tabBtns: Record<PickerTab, HTMLButtonElement>;
    private readonly tilesEl: HTMLElement;
    private readonly canvasEl: HTMLElement;
    private readonly modesEl: HTMLElement;
    private readonly toolsEl: HTMLElement;
    private readonly presetsEl: HTMLElement;
    private readonly syncEl: HTMLElement;
    private readonly commitEl: HTMLElement;
    private readonly applyBtn: HTMLButtonElement;

    private isOpen = false;
    /** Active panel tab (sticky across close/reopen). */
    private tab: PickerTab = 'presets';
    /** ⇄ state: mirrors the asymmetric preset splits (large pane right/bottom). */
    private flipped = false;
    /** Three-way switch state: 'grid' picks rectangles, the axes paint stacks. */
    private mode: PickerMode = 'grid';
    /** Stack-mode stacks along the active axis (0 = empty track). */
    private counts: number[] = [0, 0, 0, 0];
    /** Grid-mode hover preview (1-based rows/cols), null = show current shape. */
    private hover: { rows: number; cols: number } | null = null;

    private readonly onDocPointerDown = (e: PointerEvent): void => {
        const t = e.target as Node | null;
        if (t && (this.layer.contains(t) || this.opts.trigger.contains(t))) return;
        this.close();
    };
    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') this.close();
    };

    constructor(opts: LayoutPickerOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
        const doc = this.doc;

        this.layer = doc.createElement('div');
        this.layer.className = 'vela-ui-layer vela-lp-layer';
        this.layer.style.display = 'none';
        const panel = doc.createElement('div');
        panel.className = 'vela-lp';
        this.layer.appendChild(panel);

        const cols = doc.createElement('div');
        cols.className = 'vela-lp-cols';
        panel.appendChild(cols);

        // ── left column: Presets | Grid tabs over the picker canvas ──
        const layoutCol = doc.createElement('div');
        layoutCol.className = 'vela-lp-layout';
        const tabsRow = doc.createElement('div');
        tabsRow.className = 'vela-lp-tabs-row';
        const tabs = doc.createElement('div');
        tabs.className = 'vela-lp-tabs';
        const tabBtn = (label: string, tab: PickerTab): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-lp-tab';
            b.textContent = label;
            b.addEventListener('click', () => {
                if (this.tab === tab) return;
                this.tab = tab;
                this.hover = null;
                this.infoTip.setContent(() => this.tipNode());
                this.render();
            });
            tabs.appendChild(b);
            return b;
        };
        this.tabBtns = { presets: tabBtn('Presets', 'presets'), grid: tabBtn('Grid', 'grid') };
        tabsRow.appendChild(tabs);
        const badge = doc.createElement('span');
        badge.className = 'vela-lp-badge';
        badge.textContent = '?';
        tabsRow.appendChild(badge);
        this.infoTip = new Tooltip(badge, {
            host: opts.host,
            placement: 'bottom',
            content: () => this.tipNode(),
        });
        layoutCol.appendChild(tabsRow);

        // Presets tab: curated split pictograms (built by buildTiles, rebuilt on ⇄).
        this.tilesEl = doc.createElement('div');
        this.tilesEl.className = 'vela-lp-tiles';
        layoutCol.appendChild(this.tilesEl);
        this.buildTiles();

        const grid = doc.createElement('div');
        grid.className = 'vela-lp-grid';
        for (let r = 0; r < GRID; r += 1) {
            for (let c = 0; c < GRID; c += 1) {
                const sq = doc.createElement('button');
                sq.className = 'vela-lp-sq';
                sq.dataset.r = String(r);
                sq.dataset.c = String(c);
                sq.setAttribute('aria-label', `${c + 1} × ${r + 1}`);
                this.squares.push(sq);
                grid.appendChild(sq);
            }
        }
        layoutCol.appendChild(grid);
        this.canvasEl = grid;

        // Grid-tab mode trio: rectangle pick (Grid) or composable per-track stacks
        // (Columns/Rows). Icon always; label only on the active segment.
        const modes = doc.createElement('div');
        modes.className = 'vela-lp-modes';
        const modeBtn = (label: string, icon: string, mode: PickerMode): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-lp-mode';
            b.setAttribute('aria-label', label);
            b.append(iconEl(icon, doc));
            const text = doc.createElement('span');
            text.className = 'vela-lp-mode-label';
            text.textContent = label;
            b.appendChild(text);
            b.addEventListener('click', () => this.setMode(mode));
            this.modeTips.push(new Tooltip(b, { host: opts.host, placement: 'bottom', content: label }));
            modes.appendChild(b);
            return b;
        };
        this.modeBtns = {
            grid: modeBtn('Grid', 'layout-grid', 'grid'),
            columns: modeBtn('Columns', 'layout-columns', 'columns'),
            rows: modeBtn('Rows', 'layout-rows', 'rows'),
        };
        this.modesEl = modes;

        this.toolsEl = doc.createElement('div');
        this.toolsEl.className = 'vela-lp-tools';
        this.toolsEl.appendChild(modes);
        layoutCol.appendChild(this.toolsEl);

        this.presetsEl = doc.createElement('div');
        this.presetsEl.className = 'vela-lp-presets';
        layoutCol.appendChild(this.presetsEl);
        cols.appendChild(layoutCol);

        const vsep = doc.createElement('div');
        vsep.className = 'vela-lp-vsep';
        cols.appendChild(vsep);

        // ── right column: the SYNC switches ──
        const syncCol = doc.createElement('div');
        const syncHeading = doc.createElement('div');
        syncHeading.className = 'vela-lp-heading';
        syncHeading.textContent = 'Sync';
        syncCol.appendChild(syncHeading);
        this.syncEl = doc.createElement('div');
        this.syncEl.className = 'vela-lp-sync';
        syncCol.appendChild(this.syncEl);
        cols.appendChild(syncCol);

        // ── Commit footer: Apply alone, full panel width (stack modes only) ──
        const commit = doc.createElement('div');
        commit.className = 'vela-lp-commit';
        this.applyBtn = doc.createElement('button');
        this.applyBtn.className = 'vela-lp-apply';
        this.applyBtn.textContent = 'Apply';
        this.applyBtn.addEventListener('click', () => {
            if (this.mode === 'grid') return;
            const counts = this.counts.filter((n) => n > 0);
            if (counts.length === 0) return;
            this.close();
            this.opts.onSelectStacks(counts, this.mode);
        });
        commit.appendChild(this.applyBtn);
        panel.appendChild(commit);
        this.commitEl = commit;

        // ── canvas interactions ──
        grid.addEventListener('pointerdown', (e) => {
            const sq = this.squareAt(e);
            if (!sq) return;
            e.preventDefault();
            const { r, c } = this.squarePos(sq);
            if (this.mode === 'grid') {
                this.close();
                this.opts.onSelectGrid(r + 1, c + 1);
                return;
            }
            // Stack modes: a click on a stack's exact end toggles that track off, any
            // other square sets the stack size — so one click grows, shrinks, or
            // clears without a separate eraser. The track/size axes follow the mode.
            const track = this.mode === 'columns' ? c : r;
            const size = this.mode === 'columns' ? r + 1 : c + 1;
            this.counts[track] = this.counts[track] === size ? 0 : size;
            this.render();
        });
        grid.addEventListener('pointermove', (e) => {
            if (this.mode !== 'grid') return;
            const sq = this.squareAt(e);
            if (!sq) return;
            const { r, c } = this.squarePos(sq);
            if (this.hover?.rows !== r + 1 || this.hover?.cols !== c + 1) {
                this.hover = { rows: r + 1, cols: c + 1 };
                this.render();
            }
        });
        grid.addEventListener('pointerleave', () => {
            if (this.mode === 'grid' && this.hover) {
                this.hover = null;
                this.render();
            }
        });

        opts.trigger.addEventListener('click', () => this.toggle());
        opts.trigger.setAttribute('aria-haspopup', 'true');
        opts.trigger.setAttribute('aria-expanded', 'false');
        opts.host.appendChild(this.layer);
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        if (this.isOpen) return;
        this.isOpen = true;
        // The canvas starts on the CURRENT layout: rectangle pick for grids, the
        // matching stack mode for column/row splits.
        const shape = this.opts.shape();
        this.mode = shape && 'counts' in shape ? shape.axis : 'grid';
        this.counts = this.seedCounts(shape);
        this.hover = null;
        // Open on the tab that shows the CURRENT layout: Presets when a tile matches
        // (following the ⇄ state the layout was made with), Grid for anything else
        // the canvas can express; otherwise keep the last tab (sticky).
        const key = shapeKey(shape);
        const keysFor = (flipped: boolean) =>
            TILE_PRESETS.map((def) => stacksKey(flipped ? [...def.counts].reverse() : [...def.counts], def.axis));
        if (key && keysFor(this.flipped).includes(key)) {
            this.tab = 'presets';
        } else if (key && keysFor(!this.flipped).includes(key)) {
            this.flipped = !this.flipped;
            this.buildTiles();
            this.tab = 'presets';
        } else if (shape) {
            this.tab = 'grid';
        }
        this.infoTip.setContent(() => this.tipNode());
        this.refresh();
        this.layer.style.display = '';
        this.position();
        this.opts.trigger.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.addEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(true);
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.layer.style.display = 'none';
        this.opts.trigger.setAttribute('aria-expanded', 'false');
        this.doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(false);
    }

    /** Re-read shape/presets/syncs and re-render (no-op while closed — `open` re-reads). */
    refresh(): void {
        if (!this.isOpen) return;
        this.renderPresets();
        this.renderSyncs();
        this.render();
    }

    destroy(): void {
        this.close();
        this.infoTip.destroy();
        for (const tip of this.modeTips) tip.destroy();
        this.layer.remove();
    }

    // ── internals ──
    /** Stacks along the given axis seeded from a shape (uniform grids become stacks). */
    private seedCounts(shape: LayoutPickerShape | null): number[] {
        const counts = [0, 0, 0, 0];
        if (shape && 'counts' in shape) {
            for (const [i, n] of shape.counts.slice(0, GRID).entries()) counts[i] = Math.min(GRID, n);
        } else if (shape) {
            const axis = this.mode === 'rows' ? 'rows' : 'columns';
            const tracks = axis === 'columns' ? shape.cols : shape.rows;
            const size = axis === 'columns' ? shape.rows : shape.cols;
            for (let i = 0; i < Math.min(GRID, tracks); i += 1) counts[i] = Math.min(GRID, size);
        }
        return counts;
    }

    private squareAt(e: PointerEvent): HTMLButtonElement | null {
        const sq = (e.target as Element | null)?.closest?.('.vela-lp-sq');
        return sq instanceof HTMLButtonElement ? sq : null;
    }

    private squarePos(sq: HTMLButtonElement): { r: number; c: number } {
        return { r: Number(sq.dataset.r), c: Number(sq.dataset.c) };
    }

    private setMode(mode: PickerMode): void {
        if (this.mode === mode) return;
        const from = this.mode;
        this.mode = mode;
        this.hover = null;
        if (mode !== 'grid') {
            if (from === 'grid') {
                // Entering a stack mode starts from what the canvas currently shows —
                // including a stack layout painted along the OTHER axis.
                const shape = this.opts.shape();
                this.counts = this.seedCounts(shape);
                if (shape && 'counts' in shape && shape.axis !== mode) this.counts = conjugate(this.counts);
            } else {
                // Columns ↔ Rows keeps the PAINTED PATTERN in place instead of
                // transposing it, re-reading the same staircase along the other axis.
                this.counts = conjugate(this.counts);
            }
        }
        this.infoTip.setContent(() => this.tipNode());
        this.render();
    }

    /** Tab- and mode-aware help copy for the "?" badge. */
    private tipNode(): HTMLElement {
        const tip = this.doc.createElement('div');
        tip.className = 'vela-lp-tip';
        tip.textContent =
            this.tab !== 'grid'
                ? 'Click a preset to apply it — ⇄ mirrors the split presets.'
                : this.mode === 'grid'
                  ? 'Click a square to apply that columns × rows layout.'
                  : this.mode === 'columns'
                    ? "Click squares to set each column's chart stack, then Apply."
                    : "Click squares to set each row's chart stack, then Apply.";
        return tip;
    }

    /** (Re)build the preset tiles for the current ⇄ state. */
    private buildTiles(): void {
        const doc = this.doc;
        this.tilesEl.replaceChildren();
        for (const def of TILE_PRESETS) {
            const counts = this.flipped ? [...def.counts].reverse() : [...def.counts];
            const label = (this.flipped ? def.flipLabel : undefined) ?? def.label;
            const tile = doc.createElement('button');
            tile.className = 'vela-lp-tile';
            tile.dataset.key = stacksKey(counts, def.axis);
            tile.setAttribute('aria-label', label);
            const canvas = doc.createElement('span');
            canvas.className = 'vela-lp-tile-canvas';
            for (let i = 0; i < counts.length; i += 1) {
                const size = counts[i] ?? 0;
                for (let j = 0; j < size; j += 1) {
                    const pane = doc.createElement('span');
                    pane.className = 'vela-lp-tile-pane';
                    const [x, y, w, h] =
                        def.axis === 'columns'
                            ? [i / counts.length, j / size, 1 / counts.length, 1 / size]
                            : [j / size, i / counts.length, 1 / size, 1 / counts.length];
                    pane.style.left = `calc(${x * 100}% + 1px)`;
                    pane.style.top = `calc(${y * 100}% + 1px)`;
                    pane.style.width = `calc(${w * 100}% - 2px)`;
                    pane.style.height = `calc(${h * 100}% - 2px)`;
                    canvas.appendChild(pane);
                }
            }
            tile.appendChild(canvas);
            tile.addEventListener('click', () => {
                this.close();
                this.opts.onSelectStacks([...counts], def.axis);
            });
            this.tilesEl.appendChild(tile);
        }
        // ⇄ — mirror the asymmetric splits (large pane right/bottom instead of left/top).
        const flip = doc.createElement('button');
        flip.className = 'vela-lp-tile vela-lp-tile-flip';
        flip.textContent = '⇄';
        flip.setAttribute('aria-label', 'Mirror presets');
        flip.addEventListener('click', () => {
            this.flipped = !this.flipped;
            this.buildTiles();
            this.render();
        });
        this.tilesEl.appendChild(flip);
    }

    /** Project the interaction state onto the DOM (tabs, tiles, squares, mode). */
    private render(): void {
        for (const [tab, btn] of Object.entries(this.tabBtns)) {
            btn.dataset.active = this.tab === tab ? '1' : '';
        }
        this.tilesEl.style.display = this.tab === 'presets' ? '' : 'none';
        this.canvasEl.style.display = this.tab === 'grid' ? '' : 'none';
        this.toolsEl.style.display = this.tab === 'grid' ? '' : 'none';
        this.modesEl.style.display = '';
        const preview = this.mode === 'grid' ? (this.hover ?? this.gridShape()) : null;
        for (const sq of this.squares) {
            const { r, c } = this.squarePos(sq);
            const on =
                this.mode === 'grid'
                    ? preview !== null && r < preview.rows && c < preview.cols
                    : this.mode === 'columns'
                      ? r < (this.counts[c] ?? 0)
                      : c < (this.counts[r] ?? 0);
            if (on) sq.dataset.on = '1';
            else delete sq.dataset.on;
        }
        for (const [mode, btn] of Object.entries(this.modeBtns)) {
            btn.dataset.active = this.mode === mode ? '1' : '';
        }
        // Tile checked state mirrors the CURRENT layout, whichever tab is visible.
        const key = shapeKey(this.opts.shape());
        for (const tile of this.tilesEl.querySelectorAll<HTMLElement>('.vela-lp-tile')) {
            tile.dataset.checked = tile.dataset.key && tile.dataset.key === key ? '1' : '';
        }
        // Apply commits stack painting; rectangle picks and presets apply on click.
        const stackMode = this.tab === 'grid' && this.mode !== 'grid';
        this.commitEl.style.display = stackMode ? '' : 'none';
        if (stackMode) {
            this.applyBtn.disabled = this.counts.every((n) => n <= 0);
        }
    }

    private gridShape(): { rows: number; cols: number } | null {
        const shape = this.opts.shape();
        return shape && 'rows' in shape ? shape : null;
    }

    private renderPresets(): void {
        const doc = this.doc;
        this.presetsEl.replaceChildren();
        const presets = this.opts.presets();
        this.presetsEl.style.display = presets.length > 0 ? '' : 'none';
        for (const p of presets) {
            const b = doc.createElement('button');
            b.className = 'vela-lp-preset';
            b.textContent = p.label;
            if (p.checked) b.dataset.checked = '1';
            b.addEventListener('click', () => {
                this.close();
                this.opts.onSelectPreset(p.id);
            });
            this.presetsEl.appendChild(b);
        }
    }

    private renderSyncs(): void {
        const doc = this.doc;
        this.syncEl.replaceChildren();
        for (const s of this.opts.syncs()) {
            const row = doc.createElement('button');
            row.className = 'vela-lp-sync-row';
            const label = doc.createElement('span');
            label.className = 'vela-lp-label';
            label.textContent = s.label;
            const pill = doc.createElement('span');
            pill.className = 'vela-lp-switch' + (s.checked ? ' on' : '');
            pill.setAttribute('aria-hidden', 'true');
            row.setAttribute('role', 'switch');
            row.setAttribute('aria-checked', String(s.checked));
            row.append(label, pill);
            row.addEventListener('click', () => {
                this.opts.onToggleSync(s.id);
                this.renderSyncs(); // switches stay open — flip, see, flip again
            });
            this.syncEl.appendChild(row);
        }
    }

    /** Anchor under the trigger, clamped to the host's right edge. */
    private position(): void {
        const hostRect = this.opts.host.getBoundingClientRect();
        const trigRect = this.opts.trigger.getBoundingClientRect();
        let left = trigRect.left - hostRect.left;
        const top = trigRect.bottom - hostRect.top + 4;
        const width = this.layer.offsetWidth;
        if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - 8 - width);
        this.layer.style.left = `${left}px`;
        this.layer.style.top = `${top}px`;
    }
}
