// Floating drawing pill (mobile) — the on-chart remnant of the hidden drawing toolbar.
// While a tool is armed (or the eraser is on) it floats over the plot with the armed
// tool's glyph, the magnet cycle, stay-in-drawing-mode, the eraser, and a ✕ to disarm.
// Widget chrome over the PUBLIC drawings facade only: it drives `chart.drawings` and
// follows the drawing:* events, so any path that arms/disarms a tool (drawer, keyboard
// shortcut, API) keeps it truthful. Only shown in the mobile size class — desktop keeps
// the docked toolbar.
import type { Vela } from '../Vela';
import { iconEl, iconMarkup } from '@luxalgo/vela-ui/icons';
import { injectStyles } from '@luxalgo/vela-ui/styles';
import { getDrawingType, type SnapMode } from '../core/drawings';
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageLike } from '../core/i18n/types';

const TEXT = {
    magnet: msg('widget.drawingPill.magnet', 'Magnet snap'),
    stay: msg('widget.drawingPill.stay', 'Stay in drawing mode'),
    eraser: msg('widget.drawingPill.eraser', 'Eraser'),
    exit: msg('widget.drawingPill.exit', 'Exit drawing mode'),
};

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
    box-sizing: border-box;
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
    top: 5px;
    right: 5px;
    display: none;
    align-items: flex-end;
    gap: 1px;
    color: var(--vela-accent);
}
.vela-drawpill-badge[data-strength] { display: inline-flex; }
.vela-drawpill-badge > i { display: block; width: 2px; height: 4px; border-radius: 1px; background: currentColor; }
.vela-drawpill-badge > i + i { height: 7px; opacity: 0.3; }
.vela-drawpill-badge[data-strength='strong'] > i + i { opacity: 1; }
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

        const btn = (icon: string, label: MessageLike, onClick: () => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.className = 'vela-drawpill-btn';
            b.setAttribute('aria-label', this.t(label));
            this.labels.push({ el: b, label });
            b.appendChild(iconEl(icon, doc));
            b.addEventListener('click', onClick);
            return b;
        };

        this.magnetBtn = btn('magnet', TEXT.magnet, () => {
            const order: SnapMode[] = ['off', 'weak', 'strong'];
            const cur = this.chart?.drawings.getSnapMode() ?? 'off';
            this.chart?.drawings.setSnapMode(order[(order.indexOf(cur) + 1) % order.length]!);
        });
        // The magnet's strength as signal bars, one lit for weak and both for strong: a
        // letter cannot tell them apart in languages where both words share an initial.
        this.magnetBadge = doc.createElement('span');
        this.magnetBadge.className = 'vela-drawpill-badge';
        this.magnetBadge.setAttribute('aria-hidden', 'true');
        this.magnetBadge.append(doc.createElement('i'), doc.createElement('i'));
        this.magnetBtn.appendChild(this.magnetBadge);
        this.stayBtn = btn(iconMarkup('pen-lock') ? 'pen-lock' : 'pen', TEXT.stay, () => {
            this.chart?.drawings.setStayMode(!this.chart.drawings.getStayMode());
        });
        this.eraserBtn = btn('eraser', TEXT.eraser, () => {
            this.chart?.drawings.setMode(this.chart.drawings.getMode() === 'eraser' ? null : 'eraser');
        });
        const close = btn('close', TEXT.exit, () => {
            this.chart?.drawings.setTool(null);
            this.chart?.drawings.setMode(null);
        });

        this.el.append(this.toolGlyph, this.magnetBtn, this.stayBtn, this.eraserBtn, close);
        host.appendChild(this.el);
    }

    private chartSubs: Array<() => void> = [];
    /** Each button's accessible name, re-read in the chart's language on every sync. */
    private readonly labels: Array<{ el: HTMLElement; label: MessageLike }> = [];

    private t(text: MessageLike): string {
        return textOf(this.chart?.i18n, text);
    }

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

    /** Re-read the labels in the chart's language. */
    relocalize(): void {
        this.sync();
    }

    private sync(): void {
        for (const { el, label } of this.labels) el.setAttribute('aria-label', this.t(label));
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
        if (snap === 'off') delete this.magnetBadge.dataset.strength;
        else this.magnetBadge.dataset.strength = snap;
        this.stayBtn.dataset.on = drawings.getStayMode() ? '1' : '';
        this.eraserBtn.dataset.on = eraser ? '1' : '';
    }

    destroy(): void {
        for (const off of this.chartSubs) off();
        this.chartSubs = [];
        this.el.remove();
    }
}
