// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createFigure, toneOf } from '@luxalgo/vela-ui/figure';

describe('figure', () => {
    it('shows a figure under its label, the line hidden until it has one', () => {
        const figure = createFigure({ label: 'Net P&L' });
        const [label, value, sub] = [...figure.el.children] as HTMLElement[];
        expect(figure.el.getAttribute('data-slot')).toBe('figure');
        expect(label!.textContent).toBe('Net P&L');
        expect(value!.textContent).toBe('—');
        expect(sub!.hidden).toBe(true);
        expect(figure.el.getAttribute('data-tone')).toBe('neutral');
    });

    it('takes a new figure, tone and line', () => {
        const figure = createFigure({ label: 'Win rate', value: '50%' });
        figure.set('+1,240', toneOf(1240), '12 trades');
        expect(figure.el.getAttribute('data-tone')).toBe('profit');
        expect(figure.el.textContent).toContain('+1,240');
        expect((figure.el.lastElementChild as HTMLElement).hidden).toBe(false);
        figure.set('-30', toneOf(-30));
        expect(figure.el.getAttribute('data-tone')).toBe('loss');
        expect((figure.el.lastElementChild as HTMLElement).hidden).toBe(true);
        expect(toneOf(0)).toBe('neutral');
    });
});
