// Object tree — a docked side panel listing everything on the chart: panes with their
// indicators (eye = suspend/resume, ✕ = remove) and the user drawings. Kept in sync via
// the chart's event bus; rebound to each new chart instance after a widget rebuild.
import type { Vela } from '../Vela';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { tickerIconEl } from './symbol-icon';

const STYLE_ID = 'vela-widget-objtree';
const CSS = `
.vela-ot[hidden] { display: none !important; }
.vela-ot {
    width: 280px;
    flex: none;
    border-left: 1px solid var(--vela-border);
    display: flex;
    flex-direction: column;
    color: var(--vela-fg);
    font-size: 13px;
    box-sizing: border-box;
    background: var(--vela-bg);
}
.vela-ot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 10px 14px;
    border-bottom: 1px solid var(--vela-border);
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
}
.vela-ot-close {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 13px;
}
.vela-ot-close:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-ot-body { flex: 1; overflow: auto; padding: 8px; }
.vela-ot-body::-webkit-scrollbar { width: 8px; }
.vela-ot-body::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
.vela-ot-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 6px;
    border-radius: 6px;
    cursor: default;
}
.vela-ot-row:hover { background: var(--vela-hover); }
.vela-ot-row .vela-icon { color: var(--vela-fg-muted); width: 18px; justify-content: center; }
.vela-ot-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ot-row[data-hidden] .vela-ot-name { opacity: 0.45; }
.vela-ot-row[data-selected] { background: var(--vela-hover); }
.vela-ot-row[data-selected] .vela-ot-name { color: var(--vela-fg-bright); }
.vela-ot-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
}
.vela-ot-dicon { width: 18px; text-align: center; color: var(--vela-fg-muted); flex: none; }
.vela-ot-btn {
    all: unset;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--vela-fg-muted);
    font-size: 11px;
    line-height: 1;
    visibility: hidden;
}
.vela-ot-row:hover .vela-ot-btn { visibility: visible; }
.vela-ot-row .vela-ot-eye { visibility: visible; }
.vela-ot-btn:hover { background: var(--vela-active); color: var(--vela-fg); }
.vela-ot-paneops { display: flex; align-items: center; gap: 4px; padding: 4px 6px; }
.vela-ot-paneops .vela-ot-btn { visibility: visible; font-size: 10px; }
.vela-ot-panetitle { flex: 1; color: var(--vela-fg-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
`;

const REFRESH_EVENTS = [
    'indicator:added',
    'indicator:removed',
    'indicator:moved',
    'indicator:visibility',
    'pane:changed',
    'drawing:created',
    'drawing:edited',
    'drawing:removed',
    'drawing:selected',
] as const;

export class ObjectTree {
    readonly el: HTMLElement;
    private header!: HTMLElement;
    private body!: HTMLElement;
    private chart: Vela | null = null;
    private selectedDrawing: string | null = null;
    private symbolName = '';
    private unsubs: Array<() => void> = [];

    constructor(host: HTMLElement) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
        this.el = host.ownerDocument.createElement('div');
        this.el.className = 'vela-ot';
        this.el.hidden = true; // closed by default; the topbar button toggles
        const doc0 = host.ownerDocument;
        this.header = doc0.createElement('div');
        this.header.className = 'vela-ot-header';
        const hTitle = doc0.createElement('span');
        hTitle.textContent = 'Object tree';
        const hClose = doc0.createElement('button');
        hClose.className = 'vela-ot-close';
        hClose.textContent = '✕';
        hClose.addEventListener('click', () => this.toggle(false));
        this.header.append(hTitle, hClose);
        this.body = doc0.createElement('div');
        this.body.className = 'vela-ot-body';
        this.el.append(this.header, this.body);
        host.appendChild(this.el);

        this.el.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('.vela-ot-btn');
            if (!btn || !this.chart) return;
            const { action, kind, id } = btn.dataset;
            if (!id) return;
            if (kind === 'indicator') {
                const handle = this.chart.indicators().find((h) => h.id === id);
                if (!handle) return;
                if (action === 'eye') handle.setVisible(!handle.visible);
                else if (action === 'remove') handle.remove();
            } else if (kind === 'drawing') {
                if (action === 'eye') {
                    const d = this.chart.drawings.all().find((x) => x.id === id);
                    if (d) this.chart.drawings.show(id, !d.visible);
                } else if (action === 'remove') this.chart.drawings.remove(id);
            }
            this.refresh();
        });
    }

    get open(): boolean {
        return !this.el.hidden;
    }

    toggle(open = this.el.hidden): void {
        this.el.hidden = !open;
        if (open) this.refresh();
    }

    setSymbol(symbol: string): void {
        this.symbolName = symbol;
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.detach();
        this.chart = chart;
        for (const ev of REFRESH_EVENTS) {
            this.unsubs.push(chart.on(ev, () => this.refresh()));
        }
        this.unsubs.push(chart.on('drawing:selected', ({ id }) => (this.selectedDrawing = id)));
        this.refresh();
    }

    destroy(): void {
        this.detach();
        this.el.remove();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.chart = null;
    }

    private row(name: string, kind: 'indicator' | 'drawing', id: string, visible: boolean): HTMLElement {
        const doc = this.el.ownerDocument;
        const row = doc.createElement('div');
        row.className = 'vela-ot-row';
        if (!visible) row.dataset.hidden = '1';
        const label = doc.createElement('span');
        label.className = 'vela-ot-name';
        label.textContent = name;
        const eye = doc.createElement('button');
        eye.className = 'vela-ot-btn';
        eye.textContent = visible ? '👁' : '−';
        eye.title = visible ? 'Hide' : 'Show';
        Object.assign(eye.dataset, { action: 'eye', kind, id });
        const rm = doc.createElement('button');
        rm.className = 'vela-ot-btn';
        rm.textContent = '✕';
        rm.title = 'Remove';
        Object.assign(rm.dataset, { action: 'remove', kind, id });
        row.append(label, eye, rm);
        return row;
    }

    private refresh(): void {
        if (this.el.hidden || !this.chart) return;
        const doc = this.el.ownerDocument;
        this.body.replaceChildren();

        const mkRow = (icon: HTMLElement, name: string, opts: { dim?: boolean; onEye?: () => void; eyeOn?: boolean; onTrash?: () => void; selected?: boolean; onClick?: () => void }): HTMLElement => {
            const row = doc.createElement('div');
            row.className = 'vela-ot-row';
            if (opts.selected) row.dataset.selected = '1';
            if (opts.dim) row.dataset.hidden = '1';
            const label = doc.createElement('span');
            label.className = 'vela-ot-name';
            label.textContent = name;
            row.append(icon, label);
            if (opts.onEye) {
                const eye = doc.createElement('button');
                eye.className = 'vela-ot-btn vela-ot-eye';
                eye.innerHTML = opts.eyeOn === false ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 8s2.5-4.2 6.5-4.2S14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" opacity="0.4"/><path d="m3 13 10-10"/></svg>' : '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 8s2.5-4.2 6.5-4.2S14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/></svg>';
                eye.title = opts.eyeOn === false ? 'Show' : 'Hide';
                eye.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onEye!();
                });
                row.appendChild(eye);
            }
            if (opts.onTrash) {
                const rm = doc.createElement('button');
                rm.className = 'vela-ot-btn';
                rm.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.5 4.5h11M6.5 2.5h3M5.5 4.5l.5 9a1 1 0 0 0 1 .9h2a1 1 0 0 0 1-.9l.5-9M6.8 7v4.5M9.2 7v4.5"/></svg>';
                rm.title = 'Remove';
                rm.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onTrash!();
                });
                row.appendChild(rm);
            }
            if (opts.onClick) row.addEventListener('click', opts.onClick);
            return row;
        };

        // Indicators (every pane), reference-style flat rows. The pane model carries the
        // resolved display titles (handle.title can lag until prepare completes).
        const titleById = new Map<string, string>();
        for (const pane of this.chart.panes.list()) for (const ind of pane.indicators) titleById.set(ind.id, ind.title);
        for (const h of this.chart.indicators()) {
            this.body.appendChild(
                mkRow(iconEl('indicators', doc), titleById.get(h.id) ?? h.title ?? 'Indicator', {
                    dim: !h.visible,
                    eyeOn: h.visible,
                    onEye: () => {
                        h.setVisible(!h.visible);
                        this.refresh();
                    },
                    onTrash: () => {
                        h.remove();
                        this.refresh();
                    },
                }),
            );
        }

        // The price series row (eye toggles candle visibility).
        const symbol = this.symbolName;
        const base = symbol.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || symbol;
        const av = tickerIconEl(doc, base || 'P', symbol || 'Price', 'vela-ot-avatar');
        const candlesOn = this.chart.renderer.get('candleVisible') !== false;
        this.body.appendChild(
            mkRow(av, symbol || 'Price', {
                dim: !candlesOn,
                eyeOn: candlesOn,
                onEye: () => {
                    this.chart?.renderer.set('candleVisible', !candlesOn);
                    this.refresh();
                },
            }),
        );

        // Pane ops for study panes (move/collapse/maximize).
        const paneCount = this.chart.panes.list().length;
        for (const pane of this.chart.panes.list()) {
            if (pane.kind === 'price') continue;
            const ops = doc.createElement('div');
            ops.className = 'vela-ot-paneops';
            const title = doc.createElement('span');
            title.className = 'vela-ot-panetitle';
            title.textContent = `Pane ${pane.order + 1}`;
            ops.appendChild(title);
            const op = (label: string, tip: string, fn: () => void): void => {
                const b = doc.createElement('button');
                b.className = 'vela-ot-btn';
                b.textContent = label;
                b.title = tip;
                b.addEventListener('click', fn);
                ops.appendChild(b);
            };
            if (pane.order > 1) op('▲', 'Move pane up', () => this.chart?.panes.move(pane.id, 'up'));
            if (pane.order < paneCount - 1) op('▼', 'Move pane down', () => this.chart?.panes.move(pane.id, 'down'));
            op(pane.collapsed ? '⊞' : '—', pane.collapsed ? 'Expand' : 'Collapse', () => this.chart?.panes.collapse(pane.id, !pane.collapsed));
            op('⛶', pane.maximized ? 'Restore' : 'Maximize', () => this.chart?.panes.maximize(pane.maximized ? null : pane.id));
            this.body.appendChild(ops);
        }

        // Drawings — click selects on the chart.
        for (const d of this.chart.drawings.all()) {
            const icon = doc.createElement('span');
            icon.className = 'vela-ot-dicon';
            icon.textContent = '✏';
            this.body.appendChild(
                mkRow(icon, d.text?.value ? `${d.type} — ${d.text.value}` : d.type, {
                    dim: !d.visible,
                    selected: d.id === this.selectedDrawing,
                    eyeOn: d.visible,
                    onEye: () => {
                        this.chart?.drawings.show(d.id, !d.visible);
                        this.refresh();
                    },
                    onTrash: () => {
                        this.chart?.drawings.remove(d.id);
                        this.refresh();
                    },
                    onClick: () => this.chart?.drawings.select([d.id]),
                }),
            );
        }
    }
}
