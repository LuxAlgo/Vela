// BarChart: vertical bars around a zero line with a hover readout (daily P&L, a distribution),
// in the profit tone above zero and the loss tone below unless a bar names its own; optionally
// a value axis with gridlines and a title, slanted labels, and dashed markers.
import { css, defineStyles } from '../lib/css';
import { chartFrame, compactNumber, escapeXml, showTip, valueAxis } from '../lib/chart';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';

export const barChartDef = defineComponent({
    name: 'bar-chart',
    parts: ['root', 'grid', 'label', 'bar', 'marker', 'tip'],
    settings: { 'tip-radius': '3px', 'tip-shadow': t.shadow, 'tip-z': '2', 'tip-bg': t.surface.elev },
});

export interface BarDatum {
    label: string;
    value: number;
    /** The bar's tone (default: by its sign). */
    tone?: 'profit' | 'loss' | 'muted';
}

export interface BarChartProps {
    /** The hover readout of a bar. */
    format?: (d: BarDatum) => string | Node;
    /** Label every Nth bar under the axis (default: as many as fit). */
    labelEvery?: number;
    /** A value axis on the start side, with gridlines. */
    axes?: boolean;
    /** The value axis's title, written up its side. */
    axisTitle?: string;
    /** Slant the bar labels (long labels on many bars). */
    slantLabels?: boolean;
    yFormat?: (v: number) => string;
    /** What a bar's label reads under the axis (default: the label itself). */
    labelFormat?: (label: string) => string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface BarChartHandle {
    readonly el: HTMLElement;
    /** `markers` are dashed vertical lines at fractional bar positions (0: the first bar's
     *  start edge), each in its own ink. */
    setData(data: readonly BarDatum[], markers?: ReadonlyArray<{ at: number; color: string }>): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-bar-chart',
    css`
        @layer vela.ui {
            [data-slot='bar-chart'] {
                position: relative;
                width: 100%;
                height: 100%;

                & > svg {
                    display: block;
                    width: 100%;
                    height: 100%;
                    overflow: visible;
                }
            }
            [data-slot='bar-chart-grid'] {
                stroke: color-mix(in srgb, ${t.fg.bright} 5%, transparent);

                &[data-zero] {
                    stroke: color-mix(in srgb, ${t.fg.bright} 20%, transparent);
                }
                &[data-base] {
                    stroke: ${t.border};
                }
            }
            [data-slot='bar-chart-label'] {
                fill: ${t.fg.muted};
                font-size: 10px;

                &[data-title] {
                    font-size: 11px;
                }
            }
            [data-slot='bar-chart-bar'] {
                fill: ${t.profit};

                &[data-tone='loss'] {
                    fill: ${t.loss};
                }
                &[data-tone='muted'] {
                    fill: ${t.fg.faint};
                }
                &[data-thin] {
                    opacity: 0.85;
                }
            }
            [data-slot='bar-chart-marker'] {
                stroke-width: 2;
                stroke-dasharray: 4 3;
            }
            [data-slot='bar-chart-tip'] {
                position: absolute;
                z-index: ${barChartDef.vars['tip-z']};
                top: 0;
                pointer-events: none;
                padding: 8px;
                border-radius: ${barChartDef.vars['tip-radius']};
                border: 1px solid ${t.border};
                background: ${barChartDef.vars['tip-bg']};
                color: ${t.fg.bright};
                box-shadow: ${barChartDef.vars['tip-shadow']};
                font-size: 12px;
                line-height: 1.35;
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
                transition:
                    left ${t.dur.fast} ease-out,
                    top ${t.dur.fast} ease-out;

                &[data-instant] {
                    transition: none;
                }
            }
        }
    `,
);

export function createBarChart(props: BarChartProps = {}): BarChartHandle {
    injectStyles(document);
    let data: readonly BarDatum[] = [];
    let markers: ReadonlyArray<{ at: number; color: string }> = [];
    const slot = (part: (typeof barChartDef.parts)[number]) => `data-slot="${barChartDef.slot(part)}"`;

    const geometry = () => {
        const w = frame.el.clientWidth;
        const ht = frame.el.clientHeight;
        if (w < 4 || ht < 24 || data.length === 0) return null;
        const left = props.axes ? (props.axisTitle ? 54 : 40) : 0;
        const top = props.axes ? 6 : 0;
        const plotH = ht - top - (props.slantLabels ? 46 : 16);
        const lo = Math.min(0, ...data.map((d) => d.value));
        const hi = Math.max(0, ...data.map((d) => d.value));
        const axis = props.axes ? valueAxis(lo, hi, 4) : { min: lo, max: hi, step: 0, ticks: [] as number[] };
        const range = axis.max - axis.min || 1;
        return { w, h: ht, left, top, plotH, bw: (w - left) / data.length, zero: top + (axis.max / range) * plotH, scale: plotH / range, ticks: axis.ticks };
    };

    const draw = (): void => {
        const g = geometry();
        if (!g) {
            frame.svg.replaceChildren();
            return;
        }
        const every = props.labelEvery ?? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((g.w - g.left) / (props.slantLabels ? 32 : 56)))));
        const label = (x: number, y: number, text: string, anchor: string, extra = ''): string =>
            `<text ${slot('label')} x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"${extra}>${escapeXml(text)}</text>`;
        let body = '';
        if (props.axes) {
            const fmt = props.yFormat ?? compactNumber;
            for (const v of g.ticks) {
                const y = g.zero - v * g.scale;
                body += `<line ${slot('grid')}${v === 0 ? ' data-zero=""' : ''} x1="${g.left}" x2="${g.w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
                body += label(g.left - 6, y + 3, fmt(v), 'end');
            }
            if (props.axisTitle) {
                const cy = g.top + g.plotH / 2;
                body += label(10, cy, props.axisTitle, 'middle', ` data-title="" transform="rotate(-90 10 ${cy.toFixed(1)})"`);
            }
        } else body += `<line ${slot('grid')} data-base="" x1="0" x2="${g.w}" y1="${g.zero}" y2="${g.zero}"/>`;
        const barW = props.axes ? Math.max(1, Math.min(g.bw * 0.62, 48)) : Math.max(1, g.bw - Math.min(4, g.bw * 0.2));
        data.forEach((d, i) => {
            const cx = g.left + i * g.bw + g.bw / 2;
            const ht = Math.max(1, Math.abs(d.value) * g.scale);
            const y = d.value >= 0 ? g.zero - ht : g.zero;
            const tone = d.tone ?? (d.value >= 0 ? 'profit' : 'loss');
            body += `<rect ${slot('bar')} data-tone="${tone}"${props.axes ? '' : ' data-thin=""'} x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${ht.toFixed(1)}" rx="${props.axes ? 2 : 1.5}"/>`;
            if (i % every !== 0) return;
            const ly = g.top + g.plotH + 12;
            const text = props.labelFormat ? props.labelFormat(d.label) : d.label;
            body += props.slantLabels ? label(cx, ly, text, 'end', ` transform="rotate(-45 ${cx.toFixed(1)} ${ly.toFixed(1)})"`) : label(cx, g.h - 3, text, 'middle');
        });
        for (const m of markers) {
            const x = g.left + m.at * g.bw;
            body += `<line ${slot('marker')} style="stroke: ${escapeXml(m.color)}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${g.top}" y2="${(g.top + g.plotH).toFixed(1)}"/>`;
        }
        frame.svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
        frame.svg.innerHTML = body;
    };

    const frame = chartFrame(barChartDef.slot('root'), barChartDef.slot('tip'), props.className, draw);
    frame.el.addEventListener('pointermove', (e) => {
        const g = geometry();
        if (!g) return;
        const i = Math.floor((e.clientX - frame.el.getBoundingClientRect().left - g.left) / g.bw);
        const d = data[i];
        if (!d) {
            frame.tip.hidden = true;
            return;
        }
        const top = d.value >= 0 ? g.zero - Math.abs(d.value) * g.scale : g.zero + Math.abs(d.value) * g.scale;
        showTip(frame.tip, props.format ? props.format(d) : `${d.label}: ${d.value}`, g, g.left + i * g.bw + g.bw / 2, top);
    });
    frame.el.addEventListener('pointerleave', () => (frame.tip.hidden = true));

    return {
        el: frame.el,
        setData(next, nextMarkers = []) {
            data = next;
            markers = nextMarkers;
            draw();
        },
        destroy() {
            frame.disconnect();
            frame.el.remove();
        },
    };
}
