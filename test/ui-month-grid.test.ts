// @vitest-environment jsdom
// The kit's MonthGrid: a month of day cells, each with a figure, a tone and a line. Weeks
// start on the translator's first day; with onSelect the days are buttons the arrow keys walk.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonthGrid, type MonthGridDay } from '@luxalgo/vela-ui/month-grid';

afterEach(() => document.body.replaceChildren());

const DAYS: Record<string, MonthGridDay> = {
    '2026-11-06': { value: '+1,240', detail: '3 trades', tone: 'profit' },
    '2026-11-09': { value: '-310', tone: 'loss' },
    '2026-11-10': { value: '0', tone: 'neutral', label: 'Flat day' },
};
const slots = (el: HTMLElement) => [...el.children].map((c) => c.getAttribute('data-slot')!.replace('month-grid-', ''));
const day = (el: HTMLElement, date: string) => el.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('month-grid', () => {
    it('lays a month out in weeks under the weekdays, padded with blanks', () => {
        // November 2026 starts on a Sunday and has 30 days.
        const grid = createMonthGrid({ month: '2026-11', days: DAYS });
        const s = slots(grid.el);
        expect(grid.el.getAttribute('data-slot')).toBe('month-grid');
        expect(s.slice(0, 7)).toEqual(Array(7).fill('weekday'));
        expect([...grid.el.children].slice(0, 7).map((c) => c.textContent)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
        expect(s.slice(7, 37)).toEqual(Array(30).fill('day'));
        expect(s.slice(37)).toEqual(Array(5).fill('blank'));
        expect(grid.month).toBe('2026-11');
    });

    it("starts the week on the translator's first day", () => {
        const i18n = { t: (m: { defaultMessage: string } | string) => (typeof m === 'string' ? m : m.defaultMessage), weekStart: 1 as const };
        const grid = createMonthGrid({ month: '2026-11', i18n });
        expect(grid.el.children[0]!.textContent).toBe('Mo');
        // Sunday the 1st closes the first week: six blanks before it.
        expect(slots(grid.el).slice(7, 14)).toEqual([...Array(6).fill('blank'), 'day']);
    });

    it("draws each day's figure, line and tone", () => {
        const grid = createMonthGrid({ month: '2026-11', days: DAYS, today: '2026-11-06', selected: '2026-11-09' });
        const fri = day(grid.el, '2026-11-06');
        expect(fri.getAttribute('data-tone')).toBe('profit');
        expect(fri.hasAttribute('data-today')).toBe(true);
        expect(fri.querySelector('[data-slot="month-grid-date"]')!.textContent).toBe('6');
        expect(fri.querySelector('[data-slot="month-grid-value"]')!.textContent).toBe('+1,240');
        expect(fri.querySelector('[data-slot="month-grid-detail"]')!.textContent).toBe('3 trades');
        expect(day(grid.el, '2026-11-09').hasAttribute('data-checked')).toBe(true);
        expect(day(grid.el, '2026-11-02').querySelector('[data-slot="month-grid-value"]')).toBeNull();
        // Not choosable: plain cells, out of the tab order.
        expect(fri.tagName).toBe('DIV');
        expect(fri.hasAttribute('tabindex')).toBe(false);
    });

    it('makes the days buttons that say their date and figure', () => {
        const onSelect = vi.fn();
        const grid = createMonthGrid({ month: '2026-11', days: DAYS, today: '2026-11-06', onSelect });
        document.body.append(grid.el);
        const fri = day(grid.el, '2026-11-06');
        expect(fri.tagName).toBe('BUTTON');
        expect(fri.getAttribute('aria-label')).toBe('Friday, November 6, 2026, +1,240, 3 trades');
        expect(fri.getAttribute('aria-current')).toBe('date');
        expect(day(grid.el, '2026-11-10').getAttribute('aria-label')).toBe('Flat day');
        // Today takes Tab into the grid.
        expect([...grid.el.querySelectorAll('[tabindex="0"]')]).toEqual([fri]);
        day(grid.el, '2026-11-09').click();
        expect(onSelect).toHaveBeenCalledWith('2026-11-09');
        expect(day(grid.el, '2026-11-09').tabIndex).toBe(0);
        expect(fri.tabIndex).toBe(-1);
    });

    it('walks the days with the arrow keys, Home and End', () => {
        const onSelect = vi.fn();
        const grid = createMonthGrid({ month: '2026-11', onSelect, selected: '2026-11-06' });
        document.body.append(grid.el);
        const walk = (from: string, k: string) => {
            day(grid.el, from).focus();
            key(day(grid.el, from), k);
            return (document.activeElement as HTMLElement).dataset.date;
        };
        expect(walk('2026-11-06', 'ArrowRight')).toBe('2026-11-07');
        expect(walk('2026-11-07', 'ArrowDown')).toBe('2026-11-14');
        expect(walk('2026-11-14', 'ArrowLeft')).toBe('2026-11-13');
        expect(walk('2026-11-13', 'Home')).toBe('2026-11-08');
        expect(walk('2026-11-08', 'End')).toBe('2026-11-14');
        expect(walk('2026-11-03', 'ArrowUp')).toBe('2026-11-03');
        expect(walk('2026-11-29', 'End')).toBe('2026-11-30');
        expect(day(grid.el, '2026-11-30').tabIndex).toBe(0);
        key(day(grid.el, '2026-11-30'), 'Enter');
        expect(onSelect).toHaveBeenCalledWith('2026-11-30');
    });

    it('moves to another month and new figures', () => {
        const grid = createMonthGrid({ month: '2026-11', days: DAYS });
        grid.setMonth('2026-12');
        expect(grid.month).toBe('2026-12');
        expect(grid.el.querySelectorAll('[data-slot="month-grid-day"]').length).toBe(31);
        grid.setDays({ '2026-12-24': { value: '+90', tone: 'profit' } });
        expect(day(grid.el, '2026-12-24').getAttribute('data-tone')).toBe('profit');
        grid.setSelected('2026-12-24');
        expect(day(grid.el, '2026-12-24').hasAttribute('data-checked')).toBe(true);
    });
});
