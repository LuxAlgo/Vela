// Data window — a docked side panel, the object tree's sibling, showing the bar under the
// crosshair: its date and time, its OHLCV, then every indicator's value there, one section per
// indicator. The readout arrives pre-formatted from the renderer (`renderer.dataWindowReadout`),
// so the panel only lays it out. Hover updates ride the crosshair seam; resting updates come from
// the chart's live `bar` event and the indicator/pane events that change what the readout holds.
// Rebound to each new chart instance after a widget rebuild.
import type { Vela } from '../Vela';
import type { DataWindowReadout } from '../core/ports/IChartRenderer';
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { Translator } from '../core/i18n/types';
import { injectChromeStyles } from '../ui/chromeStyles';
import { SidePanel } from './side-panel';
import { css } from '@luxalgo/vela-ui/css';
import { t } from '@luxalgo/vela-ui/t';

const TEXT = {
    title: msg('widget.dataWindow.title', 'Data window'),
    timeSection: msg('widget.dataWindow.timeSection', 'Time'),
    date: msg('widget.dataWindow.date', 'Date'),
    time: msg('widget.dataWindow.time', 'Time'),
    open: msg('widget.dataWindow.open', 'Open'),
    high: msg('widget.dataWindow.high', 'High'),
    low: msg('widget.dataWindow.low', 'Low'),
    close: msg('widget.dataWindow.close', 'Close'),
    volume: msg('widget.dataWindow.volume', 'Volume'),
    priceSection: msg('widget.dataWindow.priceSection', 'Price'),
    noData: msg('widget.dataWindow.noData', 'No data'),
    noReadout: msg('widget.dataWindow.noReadout', 'This renderer provides no data readout.'),
};

/** The panel's title (also its toggle's tooltip). */
export const DATA_WINDOW_TITLE = TEXT.title;

const STYLE_ID = 'vela-widget-datawindow';
const CSS = css`@layer vela.chrome {

.vela-dw-group {
    padding: 10px 8px 4px;
    margin-top: 4px;
    border-top: 1px solid ${t.border};
    color: ${t.fg.muted};
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.vela-dw-group:first-child { border-top: none; margin-top: 0; padding-top: 8px; }
/* The readout is DATA, not chrome: selectable (an exception to the UI-wide
   user-select:none) so values can be copied out. The panel header stays chrome. */
.vela-dw-group, .vela-dw-row { user-select: text; -webkit-user-select: text; cursor: text; }
.vela-dw-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 8px;
    border-radius: ${t.radius.sm};
}
.vela-dw-row:hover { background: ${t.hover}; }
.vela-dw-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${t.fg.bright}; }
/* Values are left-to-right isolates (dir="ltr"), so a sign keeps its place in a right-to-left page. */
.vela-dw-value { margin-inline-start: auto; font-variant-numeric: tabular-nums; white-space: nowrap; unicode-bidi: isolate; }
.vela-dw-empty { padding: 20px 10px; text-align: center; color: ${t.fg.muted}; font-size: 12px; }

}`;

/** Events that change what the readout holds — indicator values, plots, or the live bar. */
const REFRESH_EVENTS = ['bar', 'context:changed', 'indicator:added', 'indicator:removed', 'indicator:visibility', 'indicator:moved', 'pane:changed', 'market:changed', 'history:complete'] as const;

/** One readout line. `color` empty ⇒ the value inherits the panel's text color. */
export interface DataWindowLine {
    label: string;
    value: string;
    color: string;
}

/** A titled block of readout lines. */
export interface DataWindowSection {
    title: string;
    lines: DataWindowLine[];
}

const EM_DASH = '—';

/**
 * Lay a readout out as sections: the bar's Time, its Price block (tinted with the bar's
 * direction), then one section per indicator with a line per plot in the plot's own color.
 * Empty when the chart holds no bar to read.
 */
export function dataWindowSections(readout: DataWindowReadout, i18n?: Translator | null): DataWindowSection[] {
    const t = (m: (typeof TEXT)[keyof typeof TEXT]): string => textOf(i18n, m);
    const sections: DataWindowSection[] = [];
    if (readout.date || readout.time) {
        sections.push({
            title: t(TEXT.timeSection),
            lines: [
                { label: t(TEXT.date), value: readout.date || EM_DASH, color: '' },
                { label: t(TEXT.time), value: readout.time || EM_DASH, color: '' },
            ],
        });
    }
    const { ohlc } = readout;
    if (ohlc) {
        const color = ohlc.up ? 'var(--vela-up)' : 'var(--vela-down)';
        const lines: DataWindowLine[] = [
            { label: t(TEXT.open), value: ohlc.o, color },
            { label: t(TEXT.high), value: ohlc.h, color },
            { label: t(TEXT.low), value: ohlc.l, color },
            { label: t(TEXT.close), value: ohlc.c, color },
        ];
        if (ohlc.vol !== undefined) lines.push({ label: t(TEXT.volume), value: ohlc.vol, color });
        sections.push({ title: t(TEXT.priceSection), lines });
    }
    for (const group of readout.groups) {
        sections.push({ title: group.name, lines: group.rows.map((r) => ({ label: r.label, value: r.value, color: r.color })) });
    }
    return sections;
}

export class DataWindow extends SidePanel {
    private chart: Vela | null = null;
    private unsubs: Array<() => void> = [];

    constructor(host: HTMLElement, i18n?: Translator) {
        super(host, TEXT.title, 'vela-dw', i18n ? { i18n } : {});
        injectChromeStyles(STYLE_ID, CSS, host.ownerDocument);
    }

    override toggle(open = !this.open, instant = false): void {
        super.toggle(open, instant);
        if (open) this.refresh();
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.detach();
        this.chart = chart;
        for (const ev of REFRESH_EVENTS) this.unsubs.push(chart.on(ev, () => this.refresh()));
        this.unsubs.push(chart.renderer.onCrosshairMove(() => this.refresh()));
        this.refresh();
    }

    override destroy(): void {
        this.detach();
        super.destroy();
    }

    override relocalize(): void {
        super.relocalize();
        this.refresh();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.chart = null;
    }

    private refresh(): void {
        if (this.el.hidden || !this.chart) return;
        const doc = this.el.ownerDocument;
        const readout = this.chart.renderer.dataWindowReadout();
        this.body.replaceChildren();
        const sections = readout ? dataWindowSections(readout, this.i18n) : [];
        if (sections.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-dw-empty';
            empty.textContent = this.t(readout ? TEXT.noData : TEXT.noReadout);
            this.body.appendChild(empty);
            return;
        }
        for (const section of sections) {
            const head = doc.createElement('div');
            head.className = 'vela-dw-group';
            head.textContent = section.title;
            this.body.appendChild(head);
            for (const line of section.lines) {
                const row = doc.createElement('div');
                row.className = 'vela-dw-row';
                const label = doc.createElement('span');
                label.className = 'vela-dw-label';
                label.textContent = line.label;
                const value = doc.createElement('span');
                value.className = 'vela-dw-value';
                value.dir = 'ltr';
                value.textContent = line.value;
                if (line.color) value.style.color = line.color;
                row.append(label, value);
                this.body.appendChild(row);
            }
        }
    }
}
