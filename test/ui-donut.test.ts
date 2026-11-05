// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { t } from '@luxalgo/vela-ui';
import { createDonut } from '@luxalgo/vela-ui/donut';

describe('donut', () => {
    const segments = [
        { value: 6, label: 'Wins', color: t.profit.var },
        { value: 4, label: 'Losses', color: t.loss.var },
        { value: 0, label: 'Even', color: t.fg.muted.var },
    ];

    it('splits its ring by value, with the figure and caption in the middle', () => {
        const { el } = createDonut({ segments, center: '60%', caption: 'win rate' });
        const ring = el.querySelector('[data-slot="donut-ring"]')!;
        const arcs = [...ring.querySelectorAll<SVGElement>('[data-slot="donut-segment"]')];
        expect(arcs).toHaveLength(2);
        const c = 2 * Math.PI * 42;
        expect(Number(arcs[0]!.getAttribute('stroke-dasharray')!.split(' ')[0])).toBeCloseTo(c * 0.6, 5);
        expect(arcs[1]!.style.stroke).toBe('var(--vela-loss)');
        expect(ring.querySelector('[data-slot="donut-figure"]')!.textContent).toBe('60%');
        expect(ring.querySelector('[data-slot="donut-caption"]')!.textContent).toBe('win rate');
    });

    it('lists every segment in its legend, empty ones included', () => {
        const donut = createDonut({ segments, center: '60%' });
        const items = [...donut.el.querySelectorAll('[data-slot="donut-item"]')].map((i) => i.textContent);
        expect(items).toEqual(['Wins6', 'Losses4', 'Even0']);
        donut.set([{ value: 1, label: 'All', color: t.profit.var }], '100%');
        expect(donut.el.querySelectorAll('[data-slot="donut-item"]')).toHaveLength(1);
        expect(donut.el.querySelector('[data-slot="donut-caption"]')).toBeNull();
    });
});
