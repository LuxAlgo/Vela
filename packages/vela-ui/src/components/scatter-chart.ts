// ScatterChart: dots on two value axes with an optional dashed trend line and a hover readout
// (a trade's P&L against its length). Each point names its ink: a token's `var()` or a color.
import { css, defineStyles } from '../lib/css';
import { chartFrame, compactNumber, escapeXml, niceStep, showTip } from '../lib/chart';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';

export const scatterChartDef = defineComponent({
    name: 'scatter-chart',
    parts: ['root', 'grid', 'label', 'point', 'trend', 'focus', 'tip'],
    settings: { 'tip-radius': '3px', 'tip-shadow': t.shadow, 'tip-z': '2', 'tip-bg': t.surface.elev },
});

export interface ScatterPoint {
    x: number;
    y: number;
    /** The dot's ink: a token's `var()` (`t.profit.var`) or a color. */
    color: string;
}

export interface ScatterChartProps {
    /** Written under the x axis. */
    xTitle?: string;
    /** Written up the y axis. */
    yTitle?: string;
    /** The hover readout of a point. */
    format?: (p: ScatterPoint, index: number) => string | Node;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ScatterChartHandle {
    readonly el: HTMLElement;
    /** `trend` is drawn as a dashed line through its points (the ends of a fitted line). */
    setData(points: readonly ScatterPoint[], trend?: ReadonlyArray<{ x: number; y: number }>): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-scatter-chart',
    css`
        @layer vela.ui {
            [data-slot='scatter-chart'] {
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
            [data-slot='scatter-chart-grid'] {
                stroke: color-mix(in srgb, ${t.fg.bright} 5%, transparent);

                &[data-zero] {
                    stroke: color-mix(in srgb, ${t.fg.bright} 20%, transparent);
                }
                &[data-base] {
                    stroke: color-mix(in srgb, ${t.fg.bright} 10%, transparent);
                }
            }
            [data-slot='scatter-chart-label'] {
                fill: ${t.fg.muted};
                font-size: 10px;

                &[data-title] {
                    font-size: 11px;
                }
            }
            [data-slot='scatter-chart-trend'] {
                fill: none;
                stroke: ${t.fg.muted};
                stroke-width: 2;
                stroke-dasharray: 6 4;
            }
            [data-slot='scatter-chart-focus'] {
                fill: none;
                stroke-width: 2;
                opacity: 0;

                &[data-on] {
                    opacity: 0.6;
                }
            }
            [data-slot='scatter-chart-tip'] {
                position: absolute;
                z-index: ${scatterChartDef.vars['tip-z']};
                top: 0;
                pointer-events: none;
                padding: 8px;
                border-radius: ${scatterChartDef.vars['tip-radius']};
                border: 1px solid ${t.border};
                background: ${scatterChartDef.vars['tip-bg']};
                color: ${t.fg.bright};
                box-shadow: ${scatterChartDef.vars['tip-shadow']};
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

export function createScatterChart(props: ScatterChartProps = {}): ScatterChartHandle {
    injectStyles(document);
    let points: readonly ScatterPoint[] = [];
    let trend: ReadonlyArray<{ x: number; y: number }> = [];
    const slot = (part: (typeof scatterChartDef.parts)[number]) => `data-slot="${scatterChartDef.slot(part)}"`;

    const geometry = () => {
        const w = frame.el.clientWidth;
        const ht = frame.el.clientHeight;
        if (w < 40 || ht < 40 || points.length === 0) return null;
        const left = props.yTitle ? 58 : 44;
        const top = 8;
        const plotW = w - left - 10;
        const plotH = ht - top - (props.xTitle ? 38 : 22);
        const xs = points.map((p) => p.x);
        const ys = [0, ...points.map((p) => p.y), ...trend.map((p) => p.y)];
        const xStep = niceStep(Math.max(...xs) - Math.min(0, ...xs) || 1, Math.max(2, Math.floor(plotW / 90)));
        const yStep = niceStep(Math.max(...ys) - Math.min(...ys) || 1, Math.max(2, Math.floor(plotH / 50)));
        const x0 = Math.floor(Math.min(0, ...xs) / xStep) * xStep;
        // The x axis ends just past the last dot (1% of the span), not on the next round tick.
        const xMax = Math.max(...xs);
        const g = { w, h: ht, left, top, plotW, plotH, x0, x1: xMax > x0 ? xMax + (xMax - x0) * 0.01 : x0 + xStep, y0: Math.floor(Math.min(...ys) / yStep) * yStep, y1: Math.ceil(Math.max(...ys) / yStep) * yStep || yStep, xStep, yStep };
        return { ...g, sx: (x: number) => g.left + ((x - g.x0) / (g.x1 - g.x0)) * g.plotW, sy: (y: number) => g.top + g.plotH - ((y - g.y0) / (g.y1 - g.y0 || 1)) * g.plotH };
    };

    const draw = (): void => {
        const g = geometry();
        if (!g) {
            frame.svg.replaceChildren();
            return;
        }
        const label = (x: number, y: number, text: string, anchor: string, extra = ''): string =>
            `<text ${slot('label')} x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"${extra}>${escapeXml(text)}</text>`;
        let body = '';
        for (let v = g.y0; v <= g.y1 + g.yStep / 2; v += g.yStep) {
            const y = g.sy(v);
            body += `<line ${slot('grid')} x1="${g.left}" x2="${g.left + g.plotW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
            body += label(g.left - 6, y + 3, compactNumber(Math.abs(v) < g.yStep / 2 ? 0 : v), 'end');
        }
        for (let i = 0; g.x0 + i * g.xStep <= g.x1 + 1e-9; i += 1) {
            const v = g.x0 + i * g.xStep;
            const x = g.sx(v);
            body += `<line ${slot('grid')} x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${g.top}" y2="${g.top + g.plotH}"/>`;
            body += label(x, g.top + g.plotH + 14, compactNumber(v), 'middle');
        }
        const zero = g.sy(0).toFixed(1);
        body += `<line ${slot('grid')} data-zero="" x1="${g.left}" x2="${g.left + g.plotW}" y1="${zero}" y2="${zero}"/>`;
        body += `<line ${slot('grid')} data-base="" x1="${g.left}" x2="${g.left + g.plotW}" y1="${g.top + g.plotH}" y2="${g.top + g.plotH}"/>`;
        if (props.xTitle) body += label(g.left + g.plotW / 2, g.h - 4, props.xTitle, 'middle', ' data-title=""');
        if (props.yTitle) {
            const cy = g.top + g.plotH / 2;
            body += label(12, cy, props.yTitle, 'middle', ` data-title="" transform="rotate(-90 12 ${cy.toFixed(1)})"`);
        }
        for (const p of points) body += `<circle ${slot('point')} style="fill: ${escapeXml(p.color)}" cx="${g.sx(p.x).toFixed(1)}" cy="${g.sy(p.y).toFixed(1)}" r="4"/>`;
        if (trend.length > 1) body += `<path ${slot('trend')} d="${trend.map((p, i) => `${i ? 'L' : 'M'}${g.sx(p.x).toFixed(1)},${g.sy(p.y).toFixed(1)}`).join('')}"/>`;
        body += `<circle ${slot('focus')} r="6"/>`;
        frame.svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
        frame.svg.innerHTML = body;
    };

    const frame = chartFrame(scatterChartDef.slot('root'), scatterChartDef.slot('tip'), props.className, draw);
    const hover = (e: PointerEvent | null): void => {
        const g = geometry();
        const focus = frame.svg.querySelector<SVGCircleElement>(`[data-slot="${scatterChartDef.slot('focus')}"]`);
        if (!g || !e || !focus) {
            frame.tip.hidden = true;
            focus?.removeAttribute('data-on');
            return;
        }
        const rect = frame.el.getBoundingClientRect();
        let index = -1;
        let best = Infinity;
        points.forEach((p, i) => {
            const dist = Math.hypot(g.sx(p.x) - (e.clientX - rect.left), g.sy(p.y) - (e.clientY - rect.top));
            if (dist < best) {
                best = dist;
                index = i;
            }
        });
        const p = points[index];
        if (!p || best > 24) {
            frame.tip.hidden = true;
            focus.removeAttribute('data-on');
            return;
        }
        focus.setAttribute('cx', String(g.sx(p.x)));
        focus.setAttribute('cy', String(g.sy(p.y)));
        focus.style.stroke = p.color;
        focus.setAttribute('data-on', '');
        showTip(frame.tip, props.format ? props.format(p, index) : `${p.x}, ${p.y}`, g, g.sx(p.x), g.sy(p.y));
    };
    frame.el.addEventListener('pointermove', hover);
    frame.el.addEventListener('pointerleave', () => hover(null));

    return {
        el: frame.el,
        setData(next, nextTrend = []) {
            points = next;
            trend = nextTrend;
            draw();
        },
        destroy() {
            frame.disconnect();
            frame.el.remove();
        },
    };
}
