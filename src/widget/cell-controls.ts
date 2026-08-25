// Per-cell view controls — a hover cluster pinned to the bottom-center of a workspace
// cell: zoom out / zoom in / maximize-or-restore / reset view. Revealed by cursor
// proximity, the same affordance as the renderer's scroll-to-realtime button, and
// styled like the pane clusters (a neutral scrim pill over chart content).
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

const STYLE_ID = 'vela-cell-controls';
const CSS = `
.vela-cc-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;line-height:0;font-size:12px;color:var(--vela-fg-muted);cursor:pointer;}
.vela-cc-btn svg{display:block;}
.vela-cc-btn:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-cc-on,.vela-cc-on:hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
`;

/**
 * Is the pointer near the cluster's resting spot (bottom-center of the cell)? PURE —
 * `x`/`y` are cell-local coordinates, `width`/`height` the cell's size.
 */
export function nearBottomCenter(x: number, y: number, width: number, height: number, proximityPx = CELL_CONTROLS_PROXIMITY_PX): boolean {
    const cx = width / 2;
    const cy = height - CONTROLS_BOTTOM_PX - CLUSTER_H / 2;
    return Math.hypot(x - cx, y - cy) <= proximityPx;
}

export interface CellControlsDeps {
    /** The cell's LIVE chart (null once the cell is destroyed). */
    chart(): Vela | null;
    /** Reset the cell's view — the context menu's "Reset view" action. */
    reset(): void;
    /** Whether maximize applies at all (multi-cell grids only — a lone chart has
     *  nothing to trade space with, same rule as the pane cluster's maximize). */
    canMaximize(): boolean;
    /** Is THIS cell the maximized one? */
    isMaximized(): boolean;
    toggleMaximize(): void;
}

/**
 * Owns the cluster DOM inside one cell host. Zooming eases through its own
 * {@link Glider} on THIS cell's chart (the buttons act on the cell they live in,
 * whatever the active cell is); maximize/reset route to the deps.
 */
export class CellControls {
    private readonly root: HTMLDivElement;
    private readonly glider: Glider;
    private near = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly deps: CellControlsDeps,
    ) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.glider = new Glider(deps.chart);
        this.root = host.ownerDocument.createElement('div');
        Object.assign(this.root.style, {
            position: 'absolute',
            left: '50%',
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

    /** Rebuild the buttons (the maximize gate or the maximized state changed). */
    refresh(): void {
        this.root.textContent = '';
        this.root.appendChild(this.button('minus', 'Zoom out', () => this.glider.zoom(ZOOM_OUT)));
        this.root.appendChild(this.button('plus', 'Zoom in', () => this.glider.zoom(ZOOM_IN)));
        if (this.deps.canMaximize()) {
            const maximized = this.deps.isMaximized();
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

    private readonly onHostMove = (e: PointerEvent): void => {
        const rect = this.host.getBoundingClientRect();
        this.setNear(nearBottomCenter(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
    };

    private readonly onHostLeave = (): void => this.setNear(false);

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
