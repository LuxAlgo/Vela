import type { VelaTheme } from '../../core/options';

/** One indicator/series readout line in the data window. */
export interface DataWindowRow {
    label: string;
    value: string;
    color: string;
}

/** The OHLC block at the top of the data window (already formatted). */
export interface DataWindowOHLC {
    o: string;
    h: string;
    l: string;
    c: string;
    vol?: string;
    /** Close ≥ open → tint the values with the up color, else the down color. */
    up: boolean;
}

export interface DataWindowData {
    /** The hovered bar's timestamp, pre-formatted (empty ⇒ no header). */
    title: string;
    ohlc: DataWindowOHLC | null;
    rows: DataWindowRow[];
}

/** One indicator's readout: its title plus a row per plot/series. */
export interface DataWindowGroup {
    name: string;
    rows: DataWindowRow[];
}

/**
 * A structured data-window snapshot for host UIs that want to lay it out themselves —
 * the bar's timestamp split into date + time, the OHLCV block, and one group per
 * indicator (rather than a single flat row list). See `NativeRenderer.getDataWindowReadout`.
 */
export interface DataWindowReadout {
    /** Bar date, pre-formatted (e.g. `2026-07-03`); empty when there is no bar. */
    date: string;
    /** Bar time of day, pre-formatted `HH:MM`; empty when there is no bar. */
    time: string;
    ohlc: DataWindowOHLC | null;
    groups: DataWindowGroup[];
}

/**
 * A floating "data window" — a DOM panel showing the OHLCV of the
 * bar under the crosshair plus the value of every indicator series at that bar. It
 * is renderer chrome (a positioned overlay on the chart container), bound to crosshair
 * updates by the renderer; when the cursor leaves the plot the renderer feeds it the
 * latest bar instead, so it always shows something useful.
 */
export class DataWindow {
    private readonly root: HTMLDivElement;
    private rightInset = 8;

    constructor(
        private readonly container: HTMLElement,
        private theme: VelaTheme,
    ) {
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        this.root = document.createElement('div');
        this.applyShell();
        container.appendChild(this.root);
    }

    /** Clear the right axis width so the panel never overlaps the price-axis labels. */
    setRightInset(px: number): void {
        this.rightInset = px + 8;
        this.root.style.right = `${this.rightInset}px`;
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.applyShell();
    }

    update(data: DataWindowData): void {
        this.root.replaceChildren();
        if (data.title) {
            const head = document.createElement('div');
            head.textContent = data.title;
            head.style.cssText = `opacity:0.7;margin-bottom:4px;white-space:nowrap;`;
            this.root.appendChild(head);
        }
        if (data.ohlc) {
            const color = data.ohlc.up ? this.theme.upColor : this.theme.downColor;
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:auto auto;gap:1px 10px;margin-bottom:4px;';
            const pairs: Array<[string, string]> = [
                ['O', data.ohlc.o],
                ['H', data.ohlc.h],
                ['L', data.ohlc.l],
                ['C', data.ohlc.c],
            ];
            if (data.ohlc.vol !== undefined) pairs.push(['V', data.ohlc.vol]);
            for (const [k, v] of pairs) {
                const key = document.createElement('span');
                key.textContent = k;
                key.style.cssText = 'opacity:0.6;';
                const val = document.createElement('span');
                val.textContent = v;
                val.style.cssText = `text-align:right;color:${color};font-variant-numeric:tabular-nums;`;
                grid.appendChild(key);
                grid.appendChild(val);
            }
            this.root.appendChild(grid);
        }
        for (const row of data.rows) {
            const line = document.createElement('div');
            line.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap;';
            const dot = document.createElement('span');
            dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:${row.color};`;
            const lbl = document.createElement('span');
            lbl.textContent = row.label;
            lbl.style.cssText = 'opacity:0.85;overflow:hidden;text-overflow:ellipsis;max-width:150px;';
            const val = document.createElement('span');
            val.textContent = row.value;
            val.style.cssText = 'margin-left:auto;font-variant-numeric:tabular-nums;';
            line.append(dot, lbl, val);
            this.root.appendChild(line);
        }
    }

    setVisible(visible: boolean): void {
        this.root.style.display = visible ? 'block' : 'none';
    }

    destroy(): void {
        this.root.remove();
    }

    private applyShell(): void {
        this.root.style.cssText = `position:absolute;top:8px;right:${this.rightInset}px;z-index:6;pointer-events:none;min-width:150px;background:${withAlpha(this.theme.background, 0.82)};border:1px solid ${this.theme.borderColor};border-radius:6px;padding:7px 9px;color:${this.theme.textColor};font:11px -apple-system,Segoe UI,sans-serif;line-height:1.5;`;
    }
}

function withAlpha(color: string, alpha: number): string {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color.trim());
    if (!m) return color;
    const r = parseInt(m[1] ?? '0', 16);
    const g = parseInt(m[2] ?? '0', 16);
    const b = parseInt(m[3] ?? '0', 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
