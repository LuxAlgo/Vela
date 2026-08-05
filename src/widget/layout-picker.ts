// Layout picker — the topbar's LAYOUT dropdown. Instead of choosing from a fixed
// preset list, the panel composes the layout on a bounded 4×4 grid canvas, driven by
// ONE three-way switch:
//   • Grid — hover previews the full rows×cols rectangle from the top-left (the
//     table-insert idiom); a click applies it immediately.
//   • Columns / Rows — each click sets a track's chart stack along that orientation
//     (clicking a stack's exact end clears it); Apply commits. Switching between the
//     two orientations keeps the painted pattern in place (its conjugate) instead of
//     transposing it.
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

const STYLE_ID = 'vela-widget-layout-picker-v7';
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
/* LAYOUT column sized to the canvas — caption stacks under it, not beside it. */
.vela-lp-layout { width: 148px; display: flex; flex-direction: column; align-items: center; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-caption-row,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 4px; }
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
/* Two-line caption left, icon-only orientation trio right. */
.vela-lp-caption-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: 8px;
}
.vela-lp-caption {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    color: var(--vela-fg-muted);
    font-size: var(--vela-font-size-sm);
    line-height: 1.25;
    letter-spacing: 0.3px;
    font-variant-numeric: tabular-nums;
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
/* Icon-only orientation trio — pictograms are self-explanatory; tooltips name them. */
.vela-lp-modes { display: inline-flex; flex: none; gap: 2px; padding: 2px; background: var(--vela-hover); border-radius: 6px; }
.vela-lp-mode {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    transition: color var(--vela-dur-fast) var(--vela-ease), background var(--vela-dur-fast) var(--vela-ease), transform 120ms var(--vela-ease);
}
.vela-lp-mode .vela-icon { font-size: 13px; width: 13px; height: 13px; }
.vela-lp-mode:hover { color: var(--vela-fg-bright); }
.vela-lp-mode:active { transform: scale(0.96); }
.vela-lp-mode[data-active='1'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
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
    private readonly caption: HTMLElement;
    private readonly infoTip: Tooltip;
    private readonly modeTips: Tooltip[] = [];
    private readonly modeBtns: Record<PickerMode, HTMLButtonElement>;
    private readonly presetsEl: HTMLElement;
    private readonly syncEl: HTMLElement;
    private readonly commitEl: HTMLElement;
    private readonly applyBtn: HTMLButtonElement;

    private isOpen = false;
    /** The three-way switch state: 'grid' picks rectangles, the axes paint stacks. */
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

        // ── left column: the LAYOUT canvas ──
        const layoutCol = doc.createElement('div');
        layoutCol.className = 'vela-lp-layout';
        const layoutHeading = doc.createElement('div');
        layoutHeading.className = 'vela-lp-heading';
        const headingText = doc.createElement('span');
        headingText.textContent = 'Layout';
        const badge = doc.createElement('span');
        badge.className = 'vela-lp-badge';
        badge.textContent = '?';
        layoutHeading.append(headingText, badge);
        layoutCol.appendChild(layoutHeading);
        this.infoTip = new Tooltip(badge, {
            host: opts.host,
            placement: 'bottom',
            content: () => this.tipNode(),
        });

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

        // Caption + icon-only orientation trio on one row (pictograms name themselves;
        // tooltips reassure on hover). No ORIENTATION heading — it belongs to Layout.
        const captionRow = doc.createElement('div');
        captionRow.className = 'vela-lp-caption-row';
        this.caption = doc.createElement('div');
        this.caption.className = 'vela-lp-caption';
        captionRow.appendChild(this.caption);
        const modes = doc.createElement('div');
        modes.className = 'vela-lp-modes';
        const modeBtn = (label: string, icon: string, mode: PickerMode): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-lp-mode';
            b.setAttribute('aria-label', label);
            b.append(iconEl(icon, doc));
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
        captionRow.appendChild(modes);
        layoutCol.appendChild(captionRow);

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
        // Mode is sticky: Columns/Rows stay selected across close/reopen until the
        // user switches. Only the canvas is re-seeded from the live layout shape.
        const shape = this.opts.shape();
        this.counts = this.seedCounts(shape);
        if (this.mode !== 'grid' && shape && 'counts' in shape && shape.axis !== this.mode) {
            this.counts = conjugate(this.counts);
        }
        this.hover = null;
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

    /** Mode-aware help copy for the LAYOUT "?" badge. */
    private tipNode(): HTMLElement {
        const tip = this.doc.createElement('div');
        tip.className = 'vela-lp-tip';
        tip.textContent =
            this.mode === 'grid'
                ? 'Click a square to apply that columns × rows layout.'
                : this.mode === 'columns'
                  ? "Click squares to set each column's chart stack, then Apply."
                  : "Click squares to set each row's chart stack, then Apply.";
        return tip;
    }

    /** Project the interaction state onto the DOM (squares, caption, switch, Apply). */
    private render(): void {
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
        if (this.mode === 'grid') {
            this.setCaption(preview ? [`${preview.cols} × ${preview.rows}`] : ['Pick a grid']);
            this.commitEl.style.display = 'none';
        } else {
            const active = this.counts.filter((n) => n > 0);
            const total = active.reduce((a, b) => a + b, 0);
            const noun = this.mode === 'columns' ? 'column' : 'row';
            this.setCaption(
                total > 0
                    ? [
                          `${total} chart${total === 1 ? '' : 's'}`,
                          `${active.length} ${noun}${active.length === 1 ? '' : 's'}`,
                      ]
                    : ['Click to add'],
            );
            this.commitEl.style.display = '';
            this.applyBtn.disabled = total === 0;
        }
    }

    /** Stack caption lines under the canvas (n charts / n columns — not one long inline). */
    private setCaption(lines: readonly string[]): void {
        this.caption.replaceChildren(
            ...lines.map((t) => {
                const line = this.doc.createElement('span');
                line.textContent = t;
                return line;
            }),
        );
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
