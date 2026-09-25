// The DatePicker controller (vela/ui) — panel navigation and picking, no DOM.
import { describe, it, expect } from 'vitest';
import { datePickerController } from '../src/ui/components/date-picker';

const TODAY = new Date(2026, 8, 24);

describe('datePickerController', () => {
    it('opens on the selected month, pads the first week, rings today', () => {
        const c = datePickerController({ value: '2026-09-10', today: TODAY });
        expect(c.header()).toEqual({ month: 'September', monthVisible: true, year: '2026', yearDisabled: false });
        const cells = c.cells();
        expect(cells.filter((x) => x.blank)).toHaveLength(2); // 1 Sep 2026 is a Tuesday
        expect(cells.find((x) => x.checked)?.value).toBe('2026-09-10');
        expect(cells.find((x) => x.today)?.value).toBe('2026-09-24');
    });

    it('steps months across the year boundary, and years / decades on the other panels', () => {
        const c = datePickerController({ value: '2026-12-05', today: TODAY });
        c.step(1);
        expect([c.year, c.month]).toEqual([2027, 0]);
        c.showMonths();
        c.step(-1);
        expect(c.year).toBe(2026);
        c.showYears();
        expect(c.header().year).toBe('2020-2029');
        c.step(1);
        expect(c.header().year).toBe('2030-2039');
        expect(c.cells().filter((x) => x.outside).map((x) => x.value)).toEqual([2029, 2040]);
    });

    it('a year leads to its months, a month to its days, and only a day is a pick', () => {
        const c = datePickerController({ today: TODAY });
        c.showYears();
        expect(c.choose(c.cells().find((x) => x.value === 2021)!)).toBeNull();
        expect(c.panel).toBe('month');
        expect(c.choose(c.cells()[2]!)).toBeNull(); // March
        expect([c.panel, c.year, c.month]).toEqual(['date', 2021, 2]);
        const picked = c.choose(c.cells().find((x) => x.value === '2021-03-15')!);
        expect(picked).toBe('2021-03-15');
        expect(c.value).toBe('2021-03-15');
    });
});
