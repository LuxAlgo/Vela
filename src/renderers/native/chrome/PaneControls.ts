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
    up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    // eye-slash style "hide / collapse" and a restore chevron pair, mirroring the reference screenshots
    collapse: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>',
    expand: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>',
    maximize: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 0-2 2h-3"/></svg>',
    restore: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/></svg>',
};

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
                    borderRadius: '6px',
                    background: 'rgba(0,0,0,0.28)',
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
        Object.assign(b.style, {
            cursor: disabled ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            padding: '0',
            border: 'none',
            borderRadius: '4px',
            // Selected (e.g. the expand toggle of a collapsed pane): solid white chip with a
            // black glyph, fully opaque — visible even without the cluster's dark pill behind it.
            background: selected ? '#ffffff' : 'transparent',
            color: selected ? '#000000' : this.theme.textColor,
            opacity: selected ? '1' : disabled ? '0.3' : '0.75',
            lineHeight: '0',
        });
        if (!disabled) {
            if (selected) {
                b.addEventListener('mouseenter', () => { b.style.opacity = '1'; b.style.background = '#ffffff'; });
                b.addEventListener('mouseleave', () => { b.style.opacity = '1'; b.style.background = '#ffffff'; });
            } else {
                b.addEventListener('mouseenter', () => { b.style.opacity = '1'; b.style.background = 'rgba(255,255,255,0.12)'; });
                b.addEventListener('mouseleave', () => { b.style.opacity = '0.75'; b.style.background = 'transparent'; });
            }
            b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        }
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
            cluster.style.background = soloExpand ? 'transparent' : 'rgba(0,0,0,0.28)';
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
