import type { VelaTheme } from '../../../core/options';
import { attachChromeTooltip } from '../../shared/chrome-tooltip';
import { AXIS_MASTER_W } from './axisLayout';

/** A pane as seen by the axis scale buttons (its pixel band + current scale state). */
export interface AxisScaleView {
    id: string;
    top: number;
    height: number;
    collapsed: boolean;
    /** Autoscale on — the pane's master scale holds no frozen (manual) window. */
    auto: boolean;
    log: boolean;
}

export interface AxisScaleButtonsDeps {
    panes(): AxisScaleView[];
    /** Total right-gutter width in px (master column + merged-scale columns). */
    rightAxis(): number;
    onToggleAuto(paneId: string): void;
    onToggleLog(paneId: string): void;
}

const STYLE_ID = 'vela-axis-scale-buttons';

const BTN_PX = 18; // square hit target per letter button
const BTN_GAP = 4; // air between A and L — close enough to read as a pair
/** The chrome's 1px vertical frame at the data/gutter seam (`drawPriceAxes`). The strip
 *  stays INSIDE the scale — it must not paint over that line. */
const AXIS_BORDER = 1;
const CLUSTER_W = AXIS_MASTER_W - AXIS_BORDER;
/** Solid chart-background strip spanning the master scale column (inside the axis frame),
 *  flush with the pane's bottom edge and a little above the buttons, so axis tick labels
 *  never show through. No border, no radius — it is a backdrop, not a chip. */
const PAD_TOP = 8;
const PAD_BOTTOM = 6;
const CLUSTER_H = BTN_PX + PAD_TOP + PAD_BOTTOM;
/** Panes shorter than this skip the buttons — they would sit on top of the tick labels. */
const MIN_PANE_H = 48;

/** Hover/active states as CSS so they track the theme tokens (same idiom as PaneControls). */
function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.vela-axis-btn{display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--vela-radius-sm);background:transparent;cursor:pointer;font:600 10px/1 -apple-system,Segoe UI,sans-serif;color:var(--vela-fg-muted);}
.vela-axis-btn:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-axis-on,.vela-axis-on:hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
`;
    document.head.appendChild(st);
}

/**
 * Inline A (auto) / L (log) buttons at the bottom of a pane's price scale, revealed while
 * the cursor hovers that pane's master scale column. Each toggles its mode for the hovered
 * pane; an active mode wears the selected (inverse-chip) button style. A DOM overlay on
 * the plot, matching the pane-controls pattern.
 */
export class AxisScaleButtons {
    private readonly cluster: HTMLDivElement;
    private readonly autoBtn: HTMLButtonElement;
    private readonly logBtn: HTMLButtonElement;
    private readonly tipDisposers: Array<() => void> = [];
    private hoverPaneId: string | null = null;

    constructor(private readonly plot: HTMLElement, private theme: VelaTheme, private readonly deps: AxisScaleButtonsDeps) {
        ensureStyles();
        this.cluster = document.createElement('div');
        Object.assign(this.cluster.style, {
            position: 'absolute',
            display: 'none',
            justifyContent: 'center',
            alignItems: 'center',
            gap: `${BTN_GAP}px`,
            padding: `${PAD_TOP}px 0 ${PAD_BOTTOM}px`,
            width: `${CLUSTER_W}px`,
            boxSizing: 'border-box',
            zIndex: '6',
            pointerEvents: 'auto',
        });
        this.applyTheme();
        this.autoBtn = this.button('A', 'Auto (fits data to screen)', () => this.deps.onToggleAuto(this.hoverPaneId ?? ''));
        this.logBtn = this.button('L', 'Logarithmic scale', () => this.deps.onToggleLog(this.hoverPaneId ?? ''));
        this.cluster.append(this.autoBtn, this.logBtn);
        this.plot.appendChild(this.cluster);
        // Track hover on the PLOT so moving the cursor onto the buttons themselves — plot
        // children above the canvas — keeps them revealed instead of flickering away.
        this.plot.addEventListener('pointermove', this.onPlotMove);
        this.plot.addEventListener('pointerleave', this.onPlotLeave);
    }

    private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', title); // not `title` — native tooltips are banned on renderer chrome
        b.textContent = label;
        b.className = 'vela-axis-btn';
        Object.assign(b.style, { width: `${BTN_PX}px`, height: `${BTN_PX}px` });
        this.tipDisposers.push(attachChromeTooltip(b, {
            host: this.plot,
            theme: () => this.theme,
            text: () => title,
            placement: 'above',
        }));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            this.sync();
        });
        return b;
    }

    /** Reveal over the master scale column of the pane under the cursor (mouse only —
     *  touch has no hover, and a drag-rescale on the axis must not sprout buttons). */
    private readonly onPlotMove = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return;
        const rect = this.plot.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const gutterLeft = rect.width - this.deps.rightAxis();
        let hit: string | null = null;
        if (x >= gutterLeft && x <= gutterLeft + AXIS_MASTER_W) {
            const y = e.clientY - rect.top;
            for (const p of this.deps.panes()) {
                if (p.collapsed || p.height < MIN_PANE_H) continue;
                if (y >= p.top && y <= p.top + p.height) { hit = p.id; break; }
            }
        }
        this.setHoverPane(hit);
        if (hit) this.sync(); // scale state can change under a still cursor (dblclick reset, drag)
    };

    private readonly onPlotLeave = (): void => this.setHoverPane(null);

    /** Re-tint the chip when the plot background/border change (theme swap, config edit). */
    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.applyTheme();
    }

    /** The strip is SOLID chart background: the buttons cover axis labels, never blend with them. */
    private applyTheme(): void {
        this.cluster.style.background = this.theme.background;
    }

    private setHoverPane(paneId: string | null): void {
        if (this.hoverPaneId === paneId) return;
        this.hoverPaneId = paneId;
        this.reposition();
    }

    /** Re-place (or hide) the cluster after a hover or pane-layout change. */
    reposition(): void {
        const pane = this.hoverPaneId ? this.deps.panes().find((p) => p.id === this.hoverPaneId) : undefined;
        if (!pane || pane.collapsed || pane.height < MIN_PANE_H) {
            this.cluster.style.display = 'none';
            return;
        }
        // Flush with the pane's bottom edge, inset 1px from the axis frame so the scale
        // border stays visible. The extra PAD_TOP is the air above the letters.
        this.cluster.style.right = `${this.deps.rightAxis() - AXIS_MASTER_W}px`;
        this.cluster.style.top = `${pane.top + pane.height - CLUSTER_H}px`;
        this.cluster.style.display = 'flex';
        this.sync();
    }

    /** Reflect the hovered pane's current auto/log state on the buttons. */
    private sync(): void {
        const pane = this.deps.panes().find((p) => p.id === this.hoverPaneId);
        if (!pane) return;
        this.autoBtn.classList.toggle('vela-axis-on', pane.auto);
        this.logBtn.classList.toggle('vela-axis-on', pane.log);
    }

    destroy(): void {
        this.plot.removeEventListener('pointermove', this.onPlotMove);
        this.plot.removeEventListener('pointerleave', this.onPlotLeave);
        for (const dispose of this.tipDisposers) dispose();
        this.tipDisposers.length = 0;
        this.cluster.remove();
    }
}
