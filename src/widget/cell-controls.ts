// Per-cell view controls — a hover cluster pinned to the bottom-center of a
// workspace cell's PRICE PLOT (the candles, not the price-scale gutter): a drag
// handle to move the chart within the grid, zoom out / zoom in, maximize-or-
// restore, and reset view. Revealed by cursor proximity, the same affordance as
// the renderer's scroll-to-realtime button, and styled like the pane clusters
// (a neutral scrim pill over chart content).
import { icon } from '../core/icons';
import { injectStyles } from '../ui/styles';
import { Glider, ZOOM_IN, ZOOM_OUT } from './glide';
import type { Vela } from '../Vela';

/** Cursor distance (px, from the cluster center) that reveals the cluster —
 *  mirrors the scroll-to-realtime button's proximity radius. */
export const CELL_CONTROLS_PROXIMITY_PX = 120;

/** px the renderer reserves for a time axis (mirrors NativeRenderer's TIME_AXIS_H). */
const TIME_AXIS_H = 22;
/** Cluster bottom inset — above the time axis, level with the scroll button. */
const CONTROLS_BOTTOM_PX = TIME_AXIS_H + 12;
/** Cluster height incl. padding (20px buttons + 2px padding each side). */
const CLUSTER_H = 24;

/** The cluster's scrim pill — floats over chart content, so a neutral darkening
 *  rather than a themed surface (same value as the pane clusters). */
const CLUSTER_PILL = 'rgba(0,0,0,0.65)';

/**
 * CSS `left` that centers the cluster on the plot (candles), not the full cell.
 * `--vela-toolbar-gutter` / `--vela-scale-gutter` are published on the mount
 * container (the cell host) by the renderer.
 */
export const CLUSTER_LEFT_CSS =
    'calc((100% + var(--vela-toolbar-gutter, 0px) - var(--vela-scale-gutter, 0px)) / 2)';

const STYLE_ID = 'vela-cell-controls';
const CSS = `
.vela-cc-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;line-height:0;font-size:12px;color:var(--vela-fg-muted);cursor:pointer;}
.vela-cc-btn svg{display:block;}
.vela-cc-btn:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-cc-on,.vela-cc-on:hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
.vela-cc-grip{cursor:grab;touch-action:none;}
.vela-cc-grip:active{cursor:grabbing;}
`;

/** Horizontal center of the plot (candles) in cell-local x — the scale gutter
 *  is the price axis, the toolbar gutter is the drawings dock. PURE. */
export function plotCenterX(width: number, toolbarGutter = 0, scaleGutter = 0): number {
    return (width + toolbarGutter - scaleGutter) / 2;
}

/**
 * Is the pointer near the cluster's resting spot (bottom-center of the plot)?
 * PURE — `x`/`y` are cell-local coordinates, `width`/`height` the cell's size.
 * Pass the renderer gutters so the hotspot tracks the visual center when a
 * price axis (or drawings toolbar) is reserved.
 */
export function nearBottomCenter(
    x: number,
    y: number,
    width: number,
    height: number,
    proximityPx = CELL_CONTROLS_PROXIMITY_PX,
    gutters: { toolbar?: number; scale?: number } = {},
): boolean {
    const cx = plotCenterX(width, gutters.toolbar ?? 0, gutters.scale ?? 0);
    const cy = height - CONTROLS_BOTTOM_PX - CLUSTER_H / 2;
    return Math.hypot(x - cx, y - cy) <= proximityPx;
}

export interface CellControlsDeps {
    /** The cell's LIVE chart (null once the cell is destroyed). */
    chart(): Vela | null;
    /** Reset the cell's view — the context menu's "Reset view" action. */
    reset(): void;
    /** Whether the grid holds more than one cell — gates maximize (a lone chart has
     *  nothing to trade space with, same rule as the pane cluster's maximize) and
     *  the drag handle (nowhere to move to). */
    multiCell(): boolean;
    /** Is THIS cell the maximized one? */
    isMaximized(): boolean;
    toggleMaximize(): void;
    /** Hit-test for the drag handle: the OTHER live cell under a viewport point
     *  (null over this cell, the chrome, or outside the grid). */
    dragTargetAt(x: number, y: number): string | null;
    /** Live highlight of the would-be drop cell while a grip drag is underway
     *  (null clears — also called on cancel). */
    previewDrop(id: string | null): void;
    /** Commit a grip drag: this cell and `targetId` trade slots. */
    dropOn(targetId: string): void;
}

/**
 * Owns the cluster DOM inside one cell host. Zooming eases through its own
 * {@link Glider} on THIS cell's chart (the buttons act on the cell they live in,
 * whatever the active cell is); maximize/reset/drag route to the deps.
 */
export class CellControls {
    private readonly root: HTMLDivElement;
    private readonly glider: Glider;
    private near = false;
    /** A grip drag is underway — the proximity reveal must not hide the cluster
     *  while captured pointer moves sweep across the whole grid. */
    private dragging = false;
    /** Mobile: the proximity reveal is meaningless without a cursor — the mobile
     *  bar's maximize stop replaces the cluster. */
    private suspended = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly deps: CellControlsDeps,
    ) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.glider = new Glider(deps.chart);
        this.root = host.ownerDocument.createElement('div');
        Object.assign(this.root.style, {
            position: 'absolute',
            left: CLUSTER_LEFT_CSS,
            bottom: `${CONTROLS_BOTTOM_PX}px`,
            transform: 'translateX(-50%)',
            zIndex: '6',
            display: 'none', // revealed by cursor proximity (onHostMove)
            gap: '2px',
            padding: '2px',
            borderRadius: 'var(--vela-radius-md)',
            background: CLUSTER_PILL,
            pointerEvents: 'auto',
        });
        // Hover on the HOST (not a canvas child) so moving the cursor onto the cluster —
        // a host child above the canvases — keeps it revealed instead of hiding it.
        this.host.addEventListener('pointermove', this.onHostMove);
        this.host.addEventListener('pointerleave', this.onHostLeave);
        this.host.appendChild(this.root);
        this.refresh();
    }

    /** Rebuild the buttons (the multi-cell gate or the maximized state changed). */
    refresh(): void {
        this.root.textContent = '';
        const multi = this.deps.multiCell();
        const maximized = multi && this.deps.isMaximized();
        // The drag handle only exists when there is somewhere to move to: never on a
        // single-cell grid, and not while this chart covers the grid.
        if (multi && !maximized) this.root.appendChild(this.makeGrip());
        this.root.appendChild(this.button('minus', 'Zoom out', () => this.glider.zoom(ZOOM_OUT)));
        this.root.appendChild(this.button('plus', 'Zoom in', () => this.glider.zoom(ZOOM_IN)));
        if (multi) {
            this.root.appendChild(
                this.button(maximized ? 'restore' : 'maximize', maximized ? 'Restore layout' : 'Maximize chart', () => this.deps.toggleMaximize(), {
                    // The maximized state reads as an inverse chip (white-on-dark, dark-on-light),
                    // the same active-state affordance as a collapsed pane's expand button.
                    selected: maximized,
                }),
            );
        }
        this.root.appendChild(
            this.button('reset', 'Reset chart', () => {
                this.glider.stop(); // a running zoom glide must not fight the reset
                this.deps.reset();
            }),
        );
    }

    private button(iconId: string, title: string, onClick: () => void, opts: { selected?: boolean } = {}): HTMLButtonElement {
        const b = this.host.ownerDocument.createElement('button');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.className = opts.selected === true ? 'vela-cc-btn vela-cc-on' : 'vela-cc-btn';
        b.innerHTML = icon(iconId);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    }

    /** The drag handle (2×3 dot grip): press and drag onto another cell to trade
     *  slots with it. The preview highlight follows the pointer; releasing outside
     *  any other cell cancels. */
    private makeGrip(): HTMLButtonElement {
        const b = this.host.ownerDocument.createElement('button');
        b.type = 'button';
        b.title = 'Drag to move chart';
        b.setAttribute('aria-label', 'Drag to move chart');
        b.className = 'vela-cc-btn vela-cc-grip';
        b.innerHTML = icon('grip');
        b.addEventListener('pointerdown', (e) => this.onGripDown(b, e));
        return b;
    }

    private onGripDown(btn: HTMLButtonElement, e: PointerEvent): void {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        try {
            btn.setPointerCapture(e.pointerId);
        } catch {
            // a synthetic/already-released pointer can't be captured — the move/up pair below still works
        }
        this.dragging = true;
        let target: string | null = null;
        const move = (ev: PointerEvent): void => {
            target = this.deps.dragTargetAt(ev.clientX, ev.clientY);
            this.deps.previewDrop(target);
        };
        const finish = (commit: boolean) => (): void => {
            this.dragging = false;
            this.deps.previewDrop(null);
            btn.removeEventListener('pointermove', move);
            btn.removeEventListener('pointerup', onUp);
            btn.removeEventListener('pointercancel', onCancel);
            if (commit && target != null) this.deps.dropOn(target);
        };
        const onUp = finish(true);
        const onCancel = finish(false);
        btn.addEventListener('pointermove', move);
        btn.addEventListener('pointerup', onUp);
        btn.addEventListener('pointercancel', onCancel);
    }

    /** Mobile flips the cluster off entirely (and hides it if currently revealed). */
    setSuspended(on: boolean): void {
        this.suspended = on;
        if (on) this.setNear(false);
    }

    /** Live renderer gutters on the cell host (0 when unpublished — a test stub). */
    private hostGutters(): { toolbar: number; scale: number } {
        const view = this.host.ownerDocument.defaultView;
        if (!view) return { toolbar: 0, scale: 0 };
        const cs = view.getComputedStyle(this.host);
        return {
            toolbar: Number.parseFloat(cs.getPropertyValue('--vela-toolbar-gutter')) || 0,
            scale: Number.parseFloat(cs.getPropertyValue('--vela-scale-gutter')) || 0,
        };
    }

    private readonly onHostMove = (e: PointerEvent): void => {
        if (this.suspended) return;
        if (this.dragging) return; // captured drag moves sweep the grid — keep the cluster up
        const rect = this.host.getBoundingClientRect();
        this.setNear(nearBottomCenter(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, CELL_CONTROLS_PROXIMITY_PX, this.hostGutters()));
    };

    private readonly onHostLeave = (): void => {
        if (this.dragging) return;
        this.setNear(false);
    };

    private setNear(near: boolean): void {
        if (near === this.near) return;
        this.near = near;
        this.root.style.display = near ? 'flex' : 'none';
    }

    destroy(): void {
        this.glider.stop();
        this.host.removeEventListener('pointermove', this.onHostMove);
        this.host.removeEventListener('pointerleave', this.onHostLeave);
        this.root.remove();
    }
}
