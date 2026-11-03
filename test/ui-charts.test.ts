// @vitest-environment jsdom
// The kit's SVG charts and the axis math they share.
import { describe, expect, it } from 'vitest';
import { t } from '@luxalgo/vela-ui';
import { compactNumber, niceStep, valueAxis } from '@luxalgo/vela-ui/chart';
import { createBarChart } from '@luxalgo/vela-ui/bar-chart';
import { createLineChart } from '@luxalgo/vela-ui/line-chart';
import { createScatterChart } from '@luxalgo/vela-ui/scatter-chart';

/** jsdom lays nothing out: give a chart's root the size its parent would. */
function sized<T extends { el: HTMLElement }>(chart: T, w = 400, h = 200): T {
    Object.defineProperty(chart.el, 'clientWidth', { value: w });
    Object.defineProperty(chart.el, 'clientHeight', { value: h });
    return chart;
}
const all = (el: Element, slot: string) => [...el.querySelectorAll(`[data-slot="${slot}"]`)];

describe('axis math', () => {
    it('steps by 1, 2 or 5 times a power of ten', () => {
        expect(niceStep(100, 4)).toBe(50);
        expect(niceStep(7, 4)).toBe(2);
        expect(niceStep(0.9, 3)).toBeCloseTo(0.5);
    });

    it('widens a value axis to whole steps, with zero on a tick', () => {
        const axis = valueAxis(-37, 112, 4);
        expect(axis.min).toBeLessThanOrEqual(-37);
        expect(axis.max).toBeGreaterThanOrEqual(112);
        expect(axis.ticks).toContain(0);
        expect(axis.ticks[0]).toBe(axis.min);
        expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
    });

    it('writes compact numbers', () => {
        expect(compactNumber(1234)).toBe('1.2k');
        expect(compactNumber(-3_400_000)).toBe('-3.4M');
        expect(compactNumber(0.25)).toBe('0.25');
    });
});

describe('bar-chart', () => {
    it('draws a bar per datum, toned by sign unless it names its own tone', () => {
        const chart = sized(createBarChart({ axes: true, axisTitle: 'P&L' }));
        chart.setData([{ label: 'Mon', value: 40 }, { label: 'Tue', value: -15 }, { label: 'Wed', value: 5, tone: 'muted' }], [{ at: 1, color: t.accent.var }]);
        const bars = all(chart.el, 'bar-chart-bar');
        expect(bars.map((b) => b.getAttribute('data-tone'))).toEqual(['profit', 'loss', 'muted']);
        expect(all(chart.el, 'bar-chart-grid').some((g) => g.hasAttribute('data-zero'))).toBe(true);
        expect(all(chart.el, 'bar-chart-label').some((l) => l.hasAttribute('data-title') && l.textContent === 'P&L')).toBe(true);
        expect((all(chart.el, 'bar-chart-marker')[0] as SVGElement).getAttribute('style')).toBe('stroke: var(--vela-accent)');
    });

    it('draws nothing without room or data', () => {
        const chart = createBarChart();
        chart.setData([{ label: 'Mon', value: 1 }]);
        expect(chart.el.querySelector('svg')!.children).toHaveLength(0);
    });
});

describe('line-chart', () => {
    it('takes the profit tone when it ends at or above its baseline, the loss tone below', () => {
        const chart = sized(createLineChart({ axes: true }));
        chart.setData([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 3 }]);
        expect(chart.el.dataset.tone).toBe('profit');
        expect(all(chart.el, 'line-chart-line')).toHaveLength(1);
        expect(all(chart.el, 'line-chart-label').length).toBeGreaterThan(0);
        chart.setData([{ x: 0, y: 0 }, { x: 1, y: -2 }]);
        expect(chart.el.dataset.tone).toBe('loss');
        chart.setAxes(false);
        expect(all(chart.el, 'line-chart-label')).toHaveLength(0);
    });
});

describe('scatter-chart', () => {
    it('draws a dot per point in its own ink, and the trend through its ends', () => {
        const chart = sized(createScatterChart({ xTitle: 'Bars held', yTitle: 'P&L' }));
        chart.setData([{ x: 3, y: 20, color: t.profit.var }, { x: 10, y: -5, color: t.loss.var }], [{ x: 0, y: 10 }, { x: 12, y: 0 }]);
        const dots = all(chart.el, 'scatter-chart-point') as SVGElement[];
        expect(dots.map((d) => d.getAttribute('style'))).toEqual(['fill: var(--vela-profit)', 'fill: var(--vela-loss)']);
        expect(all(chart.el, 'scatter-chart-trend')).toHaveLength(1);
        expect(all(chart.el, 'scatter-chart-label').filter((l) => l.hasAttribute('data-title')).map((l) => l.textContent)).toEqual(['Bars held', 'P&L']);
    });
});
