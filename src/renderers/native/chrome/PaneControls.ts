import { icon } from '../../../core/icons';
import type { VelaTheme } from '../../../core/options';

/** A pane as seen by the hover controls (a thin projection of the renderer's PaneNode). */
export interface PaneControlView {
    id: string;
    kind: 'price' | 'study';
    collapsed: boolean;
    maximized: boolean;
    top: number;
    height: number;
    /** Position among panes (0 = topmost) + total, to gate move-up/down. */
    index: number;
    count: number;
}

export interface PaneControlsDeps {
    panes(): PaneControlView[];
    /** Right-gutter width in px — the cluster pins just left of the axis columns. */
    rightAxis(): number;
    onMove(paneId: string, dir: 'up' | 'down'): void;
    onToggleCollapse(paneId: string): void;
    onToggleMaximize(paneId: string): void;
}

const ICONS = {
    up: icon('chevron-up'),
    down: icon('chevron-down'),
    collapse: icon('pane-collapse'),
    expand: icon('pane-expand'),
    maximize: icon('maximize'),
    restore: icon('restore'),
};

const STYLE_ID = 'vela-pane-controls';

/** The cluster's glyph size. Icons inherit it from the slot, so it is set once in CSS. */
const ICON_PX = 12;

/** The cluster's scrim pill. It floats over CHART CONTENT (candles of any color), not over a
 *  panel, so it stays a neutral darkening rather than a themed surface. */
const CLUSTER_PILL = 'rgba(0,0,0,0.28)';

/** Hover/active states as CSS, so they can never lag behind a pointer or drift from the
 *  tokens (the buttons only carry their per-instance color/opacity inline). */
function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.vela-pc-btn{display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;line-height:0;font-size:${ICON_PX}px;color:var(--vela-fg-muted);}
.vela-pc-btn svg{display:block;}
.vela-pc-btn:not(:disabled):hover{opacity:1 !important;background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-pc-on,.vela-pc-on:not(:disabled):hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
`;
    document.head.appendChild(st);
}

/**
 * Per-pane hover button cluster, pinned to the top-right of each pane's data area (just
 * left of the axis columns). Shown while the cursor is inside that pane; a collapsed pane
 * additionally keeps a standalone expand chip visible so it can always be re-expanded. Study panes
 * get move-up / move-down / collapse / maximize / remove; the price pane gets maximize only.
 * A DOM overlay in the plot, matching the settings-button + legend pattern.
 */
export class PaneControls {
    private readonly root: HTMLDivElement;
    private readonly clusters = new Map<string, HTMLDivElement>();
    private hoverPaneId: string | null = null;

    constructor(private readonly plot: HTMLElement, private theme: VelaTheme, private readonly deps: PaneControlsDeps) {
        ensureStyles();
        this.root = document.createElement('div');
        Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '6' });
        this.plot.appendChild(this.root);
        // Track hover on the PLOT (not the data canvas) so moving the cursor onto a cluster —
        // a plot child that sits above the canvas — keeps its own pane's cluster revealed,
        // instead of the canvas's pointerleave hiding it before it can be clicked.
        this.plot.addEventListener('pointermove', this.onPlotMove);
        this.plot.addEventListener('pointerleave', this.onPlotLeave);
        this.refresh();
    }

    /** Reveal the cluster for the pane under the cursor, resolved from the pointer's y in the plot. */
    private readonly onPlotMove = (e: PointerEvent): void => {
        const rect = this.plot.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let hit: string | null = null;
        for (const p of this.deps.panes()) {
            if (y >= p.top && y <= p.top + p.height) { hit = p.id; break; }
        }
        this.setHoverPane(hit);
    };

    private readonly onPlotLeave = (): void => this.setHoverPane(null);

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.refresh();
    }

    /** Rebuild the clusters (pane set / kind / collapse-maximize state changed). */
    refresh(): void {
        const panes = this.deps.panes();
        const seen = new Set<string>();
        for (const p of panes) {
            seen.add(p.id);
            let cluster = this.clusters.get(p.id);
            if (!cluster) {
                cluster = document.createElement('div');
                Object.assign(cluster.style, {
                    position: 'absolute',
                    display: 'flex',
                    gap: '2px',
                    padding: '2px',
                    borderRadius: 'var(--vela-radius-md)',
                    background: CLUSTER_PILL,
                    pointerEvents: 'auto',
                });
                this.root.appendChild(cluster);
                this.clusters.set(p.id, cluster);
            }
            this.buildButtons(cluster, p);
        }
        for (const [id, cluster] of this.clusters) {
            if (!seen.has(id)) { cluster.remove(); this.clusters.delete(id); }
        }
        this.reposition();
    }

    private buildButtons(cluster: HTMLDivElement, p: PaneControlView): void {
        cluster.textContent = '';
        if (p.kind === 'study') {
            cluster.appendChild(this.button(ICONS.up, 'Move pane up', p.index <= 1, () => this.deps.onMove(p.id, 'up'), { role: 'up' }));
            cluster.appendChild(this.button(ICONS.down, 'Move pane down', p.index >= p.count - 1, () => this.deps.onMove(p.id, 'down'), { role: 'down' }));
            cluster.appendChild(
                this.button(p.collapsed ? ICONS.expand : ICONS.collapse, p.collapsed ? 'Expand pane' : 'Collapse pane', false, () => this.deps.onToggleCollapse(p.id), {
                    role: 'collapse',
                    // A collapsed pane keeps its expand button permanently visible; the "selected"
                    // white-on-black chip makes it read as an active state the user can always click.
                    selected: p.collapsed,
                }),
            );
        }
        // Maximize only makes sense when there's more than one pane to trade space between —
        // a lone price pane can't be "expanded", so it gets no button (and thus no cluster).
        if (p.count > 1) {
            cluster.appendChild(
                this.button(p.maximized ? ICONS.restore : ICONS.maximize, p.maximized ? 'Restore pane' : 'Maximize pane', false, () => this.deps.onToggleMaximize(p.id), { role: 'maximize' }),
            );
        }
    }

    private button(
        svg: string,
        title: string,
        disabled: boolean,
        onClick: () => void,
        opts: { role: 'up' | 'down' | 'collapse' | 'maximize'; selected?: boolean },
    ): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = title;
        b.innerHTML = svg;
        b.disabled = disabled;
        b.dataset.role = opts.role;
        const selected = opts.selected === true;
        // Selected (e.g. the expand toggle of a collapsed pane) is an inverse chip, fully
        // opaque — it must read on its own, without the cluster's dark pill behind it.
        // Ink lives in the stylesheet (muted at rest, bright on hover, inverse when selected);
        // only the disabled fade stays inline.
        b.className = selected ? 'vela-pc-btn vela-pc-on' : 'vela-pc-btn';
        Object.assign(b.style, {
            cursor: disabled ? 'default' : 'pointer',
            width: '20px',
            height: '20px',
            opacity: disabled ? '0.3' : '1',
        });
        if (!disabled) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    }

    /** Reposition each cluster to the top-right of its pane's data area. */
    reposition(): void {
        const rightPx = this.deps.rightAxis() + 6;
        const byId = new Map(this.deps.panes().map((p) => [p.id, p]));
        for (const [id, cluster] of this.clusters) {
            const p = byId.get(id);
            if (!p) { cluster.style.display = 'none'; continue; }
            const hovered = id === this.hoverPaneId;
            // An empty cluster (e.g. a lone price pane with no maximize) never shows.
            const hasButtons = cluster.children.length > 0;
            // A collapsed pane keeps its cluster visible so the expand chip is always reachable.
            const visible = hasButtons && (hovered || p.collapsed) && p.height > 8;
            cluster.style.right = `${rightPx}px`;
            // Center the cluster inside the ~26px collapsed strip (24 = cluster height incl. padding).
            cluster.style.top = p.collapsed
                ? `${p.top + Math.max(1, Math.round((p.height - 24) / 2))}px`
                : `${p.top + 4}px`;
            cluster.style.display = visible ? 'flex' : 'none';
            if (!visible) continue;
            // Without hover only the expand chip shows, standalone: drop the dark pill so the white
            // chip reads on its own. Its siblings stay laid out (visibility:hidden, not display:none)
            // so the expand chip keeps the exact slot it occupies once the full cluster reveals on hover.
            const soloExpand = p.collapsed && !hovered;
            cluster.style.background = soloExpand ? 'transparent' : CLUSTER_PILL;
            for (const child of cluster.children) {
                const btn = child as HTMLElement;
                btn.style.display = 'inline-flex';
                btn.style.visibility = soloExpand && btn.dataset.role !== 'collapse' ? 'hidden' : 'visible';
            }
        }
    }

    /** Show the cluster for the pane the cursor is in (null hides all). */
    setHoverPane(paneId: string | null): void {
        if (this.hoverPaneId === paneId) return;
        this.hoverPaneId = paneId;
        this.reposition();
    }

    destroy(): void {
        this.plot.removeEventListener('pointermove', this.onPlotMove);
        this.plot.removeEventListener('pointerleave', this.onPlotLeave);
        this.root.remove();
        this.clusters.clear();
    }
}
