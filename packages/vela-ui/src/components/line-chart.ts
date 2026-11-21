// LineChart: a compact area chart with a hover readout (equity curves, P&L over time): one line
// over a fading area, in the profit tone when its last point ends at or above the baseline and
// the loss tone below it, with optional axis labels under and beside the plot.
import { css, defineStyles } from '../lib/css';
import { chartFrame, escapeXml, niceStep, showTip } from '../lib/chart';
import { defineComponent } from '../lib/define';
import { pageUid } from '../lib/page';
import { t } from '../lib/t';

export const lineChartDef = defineComponent({
    name: 'line-chart',
    parts: ['root', 'label', 'area', 'line', 'dot', 'tip'],
    settings: { 'tip-radius': '3px', 'tip-shadow': t.shadow, 'tip-z': '2', 'tip-bg': t.surface.elev, 'stroke-width': '2' },
});

export interface LinePoint {
    x: number;
    y: number;
}

export interface LineChartProps {
    /** Axis label size in px (default 10). */
    axisFont?: number;
    /** The hover readout of a point. */
    format?: (p: LinePoint, index: number) => string | Node;
    /** The area fills down (or up) to this value (default 0). */
    baseline?: number;
    /** Label the x axis under the plot and the y axis beside it. */
    axes?: boolean;
    xFormat?: (x: number) => string;
    yFormat?: (y: number) => string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface LineChartHandle {
    readonly el: HTMLElement;
    setData(points: readonly LinePoint[]): void;
    /** Show or drop the axis labels; dropped, the plot takes their room. */
    setAxes(on: boolean): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-line-chart',
    css`
        @layer vela.ui {
            [data-slot='line-chart'] {
                --_ink: ${t.profit};
                position: relative;
                width: 100%;
                height: 100%;

                &[data-tone='loss'] {
                    --_ink: ${t.loss};
                }
                & > svg {
                    display: block;
                    width: 100%;
                    height: 100%;
                    overflow: visible;
                }
            }
            [data-slot='line-chart-label'] {
                fill: ${t.fg.muted};
            }
            [data-slot='line-chart-line'] {
                fill: none;
                stroke: var(--_ink);
                stroke-width: ${lineChartDef.vars['stroke-width']};
                stroke-linejoin: round;
                vector-effect: non-scaling-stroke;
            }
            [data-slot='line-chart-dot'] {
                fill: var(--_ink);
                opacity: 0;

                &[data-on] {
                    opacity: 1;
                }
            }
            [data-slot='line-chart-tip'] {
                position: absolute;
                z-index: ${lineChartDef.vars['tip-z']};
                top: 0;
                pointer-events: none;
                padding: 8px;
                border-radius: ${lineChartDef.vars['tip-radius']};
                border: 1px solid ${t.border};
                background: ${lineChartDef.vars['tip-bg']};
                color: ${t.fg.bright};
                box-shadow: ${lineChartDef.vars['tip-shadow']};
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

export function createLineChart(props: LineChartProps = {}): LineChartHandle {
    injectStyles(document);
    let points: readonly LinePoint[] = [];
    let axes = !!props.axes;
    const id = pageUid('vela-line-chart');
    const font = props.axisFont ?? 10;
    const slot = (part: (typeof lineChartDef.parts)[number]) => `data-slot="${lineChartDef.slot(part)}"`;
    const axisRight = (): number => (axes ? Math.round(56 + (font - 10) * 3) : 0);
    const axisBottom = (): number => (axes ? Math.round(font * 1.4 + 4) : 0);

    const dims = () => {
        const w = frame.el.clientWidth - axisRight();
        const ht = frame.el.clientHeight - axisBottom();
        if (w < 4 || ht < 4 || points.length < 2) return null;
        const base = props.baseline ?? 0;
        let minY = base;
        let maxY = base;
        for (const p of points) {
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        if (minY === maxY) maxY = minY + 1;
        const pad = (maxY - minY) * 0.08;
        return { w, h: ht, minY: minY - pad, maxY: maxY + pad, minX: points[0]!.x, maxX: points[points.length - 1]!.x };
    };

    const draw = (): void => {
        const d = dims();
        if (!d) {
            frame.svg.replaceChildren();
            return;
        }
        const sx = (x: number): number => (d.maxX === d.minX ? 0 : ((x - d.minX) / (d.maxX - d.minX)) * d.w);
        const sy = (y: number): number => d.h - ((y - d.minY) / (d.maxY - d.minY)) * d.h;
        const base = sy(props.baseline ?? 0);
        const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
        const area = `${line}L${sx(d.maxX).toFixed(1)},${base.toFixed(1)}L0,${base.toFixed(1)}Z`;
        const gain = points[points.length - 1]!.y >= (props.baseline ?? 0);
        frame.el.dataset.tone = gain ? 'profit' : 'loss';
        // Denser toward the line: the top for a gain, the bottom for a loss.
        const fade = [0.85, 0.65, 0.45, 0.3, 0.15, 0.05];
        const stops = (gain ? fade : [...fade].reverse()).map((o, i) => `<stop offset="${i / 5}" style="stop-color: var(--_ink); stop-opacity: ${o}"/>`).join('');
        let labels = '';
        if (axes) {
            const label = (x: number, y: number, text: string, anchor: string): string => `<text ${slot('label')} x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${font}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
            const step = niceStep(d.maxY - d.minY, Math.max(2, Math.floor(d.h / 42)));
            for (let v = Math.ceil(d.minY / step) * step; v <= d.maxY; v += step) {
                const y = sy(v);
                if (y < font / 2 || y > d.h - 2) continue;
                labels += label(d.w + 8, y + font / 3, props.yFormat ? props.yFormat(Math.abs(v) < step / 2 ? 0 : v) : v.toFixed(0), 'start');
            }
            const ticks = Math.max(2, Math.floor(d.w / 107));
            let last = '';
            for (let i = 0; i <= ticks; i += 1) {
                const x = d.minX + ((d.maxX - d.minX) * i) / ticks;
                const text = props.xFormat ? props.xFormat(x) : String(Math.round(x));
                if (text === last) continue;
                last = text;
                labels += label(Math.min(d.w - 20, Math.max(20, sx(x))), d.h + font + 4, text, 'middle');
            }
        }
        frame.svg.setAttribute('viewBox', `0 0 ${d.w + axisRight()} ${d.h + axisBottom()}`);
        frame.svg.innerHTML =
            `<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
            labels +
            `<path ${slot('area')} d="${area}" fill="url(#${id}-g)"/>` +
            `<path ${slot('line')} d="${line}"/>` +
            `<circle ${slot('dot')} r="4"/>`;
    };

    const frame = chartFrame(lineChartDef.slot('root'), lineChartDef.slot('tip'), props.className, draw);
    const hover = (e: PointerEvent | null): void => {
        const d = dims();
        const dot = frame.svg.querySelector<SVGCircleElement>(`[data-slot="${lineChartDef.slot('dot')}"]`);
        if (!d || !e || !dot) {
            frame.tip.hidden = true;
            dot?.removeAttribute('data-on');
            return;
        }
        const target = d.minX + ((e.clientX - frame.el.getBoundingClientRect().left) / d.w) * (d.maxX - d.minX);
        let index = 0;
        for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i]!.x - target) < Math.abs(points[index]!.x - target)) index = i;
        const best = points[index]!;
        const px = d.maxX === d.minX ? 0 : ((best.x - d.minX) / (d.maxX - d.minX)) * d.w;
        const py = d.h - ((best.y - d.minY) / (d.maxY - d.minY)) * d.h;
        dot.setAttribute('cx', String(px));
        dot.setAttribute('cy', String(py));
        dot.setAttribute('data-on', '');
        showTip(frame.tip, props.format ? props.format(best, index) : String(best.y), { w: d.w + axisRight(), h: d.h + axisBottom() }, px, py);
    };
    frame.el.addEventListener('pointermove', hover);
    frame.el.addEventListener('pointerleave', () => hover(null));

    return {
        el: frame.el,
        setData(next) {
            points = next;
            draw();
        },
        setAxes(on) {
            if (on === axes) return;
            axes = on;
            draw();
        },
        destroy() {
            frame.disconnect();
            frame.el.remove();
        },
    };
}
