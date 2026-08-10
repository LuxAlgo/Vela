// Floating drawing pill (mobile) — the on-chart remnant of the hidden drawing toolbar.
// While a tool is armed (or the eraser is on) it floats over the plot with the armed
// tool's glyph, the magnet cycle, stay-in-drawing-mode, the eraser, and a ✕ to disarm.
// Widget chrome over the PUBLIC drawings facade only: it drives `chart.drawings` and
// follows the drawing:* events, so any path that arms/disarms a tool (drawer, keyboard
// shortcut, API) keeps it truthful. Only shown in the mobile size class — desktop keeps
// the docked toolbar.
import type { Vela } from '../Vela';
import { iconEl, iconMarkup } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { getDrawingType, type SnapMode } from '../core/drawings';

const STYLE_ID = 'vela-widget-drawing-pill';
const CSS = `
.vela-drawpill { display: none; }
[data-layout='mobile'] .vela-drawpill {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    z-index: 7;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 999px;
    background: var(--vela-surface);
    box-shadow: var(--vela-shadow-dialog);
    color: var(--vela-fg);
}
[data-layout='mobile'] .vela-drawpill[hidden] { display: none !important; }
.vela-drawpill-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--vela-hover);
    color: var(--vela-accent);
}
.vela-drawpill-tool svg { width: 22px; height: 22px; }
.vela-drawpill-btn {
    all: unset;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}
.vela-drawpill-btn:active { background: var(--vela-hover); }
.vela-drawpill-btn[data-on='1'] { color: var(--vela-accent); background: var(--vela-hover); }
.vela-drawpill-btn .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-drawpill-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 8px;
    font-weight: 700;
    color: var(--vela-accent);
}
`;

export class DrawingPill {
    private readonly el: HTMLElement;
    private readonly toolGlyph: HTMLElement;
    private readonly magnetBtn: HTMLButtonElement;
    private readonly magnetBadge: HTMLElement;
    private readonly stayBtn: HTMLButtonElement;
    private readonly eraserBtn: HTMLButtonElement;
    private chart: Vela | null = null;

    constructor(host: HTMLElement) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = 'vela-drawpill';
        this.el.hidden = true;

        this.toolGlyph = doc.createElement('span');
        this.toolGlyph.className = 'vela-drawpill-tool';

        const btn = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-drawpill-btn';
            b.setAttribute('aria-label', label);
            b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.magnetBtn = btn('magnet', 'Magnet snap', () => {
            const order: SnapMode[] = ['off', 'weak', 'strong'];
            const cur = this.chart?.drawings.getSnapMode() ?? 'off';
            this.chart?.drawings.setSnapMode(order[(order.indexOf(cur) + 1) % order.length]!);
        });
        this.magnetBadge = doc.createElement('span');
        this.magnetBadge.className = 'vela-drawpill-badge';
        this.magnetBtn.appendChild(this.magnetBadge);
        this.stayBtn = btn(iconMarkup('pen-lock') ? 'pen-lock' : 'pen', 'Stay in drawing mode', () => {
            this.chart?.drawings.setStayMode(!this.chart.drawings.getStayMode());
        });
        this.eraserBtn = btn('eraser', 'Eraser', () => {
            this.chart?.drawings.setMode(this.chart.drawings.getMode() === 'eraser' ? null : 'eraser');
        });
        const close = btn('close', 'Exit drawing mode', () => {
            this.chart?.drawings.setTool(null);
            this.chart?.drawings.setMode(null);
        });

        this.el.append(this.toolGlyph, this.magnetBtn, this.stayBtn, this.eraserBtn, close);
        host.appendChild(this.el);
    }

    private chartSubs: Array<() => void> = [];

    /** Rebind to another chart (a rebuild, or the workspace's active cell changing) —
     *  the previous chart's subscriptions are dropped so only one chart drives the pill. */
    onChart(chart: Vela): void {
        for (const off of this.chartSubs) off();
        this.chart = chart;
        this.chartSubs = [
            chart.on('drawing:tool', () => this.sync()),
            chart.on('drawing:snap', () => this.sync()),
            chart.on('drawing:stay', () => this.sync()),
            chart.on('drawing:mode', () => this.sync()),
        ];
        this.sync();
    }

    private sync(): void {
        const drawings = this.chart?.drawings;
        if (!drawings || !drawings.supported) {
            this.el.hidden = true;
            return;
        }
        const tool = drawings.getTool();
        const eraser = drawings.getMode() === 'eraser';
        this.el.hidden = tool === null && !eraser;
        if (this.el.hidden) return;
        this.toolGlyph.innerHTML = tool !== null ? (getDrawingType(tool)?.icon ?? '') : (iconMarkup('eraser') ?? '');
        const snap = drawings.getSnapMode();
        this.magnetBtn.dataset.on = snap !== 'off' ? '1' : '';
        this.magnetBadge.textContent = snap === 'weak' ? 'W' : snap === 'strong' ? 'S' : '';
        this.stayBtn.dataset.on = drawings.getStayMode() ? '1' : '';
        this.eraserBtn.dataset.on = eraser ? '1' : '';
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.el.remove();
    }
}
