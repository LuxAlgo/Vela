// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStat, toneOf } from '@luxalgo/vela-ui/stat';

describe('stat', () => {
    it('shows a figure under its label, the line hidden until it has one', () => {
        const stat = createStat({ label: 'Net P&L' });
        const [label, value, sub] = [...stat.el.children] as HTMLElement[];
        expect(stat.el.getAttribute('data-slot')).toBe('stat');
        expect(label!.textContent).toBe('Net P&L');
        expect(value!.textContent).toBe('—');
        expect(sub!.hidden).toBe(true);
        expect(stat.el.getAttribute('data-tone')).toBe('neutral');
    });

    it('takes a new figure, tone and line', () => {
        const stat = createStat({ label: 'Win rate', value: '50%' });
        stat.set('+1,240', toneOf(1240), '12 trades');
        expect(stat.el.getAttribute('data-tone')).toBe('profit');
        expect(stat.el.textContent).toContain('+1,240');
        expect((stat.el.lastElementChild as HTMLElement).hidden).toBe(false);
        stat.set('-30', toneOf(-30));
        expect(stat.el.getAttribute('data-tone')).toBe('loss');
        expect((stat.el.lastElementChild as HTMLElement).hidden).toBe(true);
        expect(toneOf(0)).toBe('neutral');
    });
});
