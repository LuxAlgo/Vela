// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSparkline } from '@luxalgo/vela-ui/sparkline';

const slots = (el: Element) => [...el.children].map((c) => c.getAttribute('data-slot'));

describe('sparkline', () => {
    it('draws a line in the profit tone when it ends at or above where it started', () => {
        const { el } = createSparkline({ values: [1, 3, 2, 4] });
        expect(el.getAttribute('data-slot')).toBe('sparkline');
        expect(el.getAttribute('data-tone')).toBe('profit');
        expect(slots(el)).toEqual(['sparkline-line']);
        expect(el.getAttribute('viewBox')).toBe('0 0 56 20');
    });

    it('reads its tone against the baseline, which it draws with the area', () => {
        const spark = createSparkline({ values: [5, 6, 4], area: true, baseline: 4.5, width: 80, height: 24 });
        expect(spark.el.getAttribute('data-tone')).toBe('loss');
        expect(slots(spark.el)).toEqual(['sparkline-area', 'sparkline-baseline', 'sparkline-line']);
        spark.setValues([5, 6, 7]);
        expect(spark.el.getAttribute('data-tone')).toBe('profit');
    });

    it('draws nothing from fewer than two finite values', () => {
        expect(createSparkline({ values: [1, Number.NaN] }).el.children).toHaveLength(0);
    });
});
