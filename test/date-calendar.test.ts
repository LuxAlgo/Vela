// @vitest-environment jsdom
// The `input.time` calendar, driven through the settings dialog the user actually opens:
// the legend gear's dialog → the date field's chevron → the popover. Clicks are plain
// `click()`, which the popover's pointerdown outside-dismiss ignores, so the panel stays
// up between assertions.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DARK_THEME } from '../src/core/theme';
import { IndicatorInputsDialog, type InputsUIChange } from '../src/renderers/shared/IndicatorInputsDialog';

const SELECTED = '2024-03-15T09:30:00';

interface Harness {
    /** The open calendar popover. */
    cal: HTMLElement;
    /** Values committed to the `input.time`, newest last. */
    changes: InputsUIChange[];
    /** The most recent commit. */
    committed(): InputsUIChange | undefined;
    close(): void;
}

function openCalendar(current = Date.parse(SELECTED)): Harness {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const changes: InputsUIChange[] = [];
    const dialog = new IndicatorInputsDialog({
        container: host,
        theme: () => DARK_THEME,
        mobile: () => false,
        dialogHost: () => host,
        symbolPicker: () => null,
        onChange: (c) => changes.push(c),
        onBackdropClose: () => {},
    });
    dialog.open({
        id: 'ind',
        title: 'Test',
        inputs: [{ key: 't', title: 'Start', type: 'time', defval: current }],
        values: { t: current },
        props: [],
        propValues: {},
    });
    (document.querySelector('.vela-ind-combo-chevron') as HTMLButtonElement).click();
    return {
        cal: document.querySelector('.vela-ind-cal') as HTMLElement,
        changes,
        committed: () => changes[changes.length - 1],
        close: () => dialog.close(),
    };
}

const all = (cal: HTMLElement, sel: string): HTMLButtonElement[] => [...cal.querySelectorAll(sel)] as HTMLButtonElement[];
const monthSwitch = (cal: HTMLElement): HTMLButtonElement => all(cal, '.vela-date-picker-switch')[0]!;
const yearSwitch = (cal: HTMLElement): HTMLButtonElement => all(cal, '.vela-date-picker-switch')[1]!;
const prev = (cal: HTMLElement): HTMLButtonElement => all(cal, '.vela-date-picker-nav')[0]!;
const next = (cal: HTMLElement): HTMLButtonElement => all(cal, '.vela-date-picker-nav')[1]!;
const cells = (cal: HTMLElement): HTMLButtonElement[] => all(cal, '.vela-date-picker-cell');
const labels = (cal: HTMLElement): string[] => cells(cal).map((c) => c.textContent ?? '');
const day = (cal: HTMLElement, n: number): HTMLButtonElement =>
    all(cal, '.vela-date-picker-day').find((b) => b.textContent === String(n))!;
const pick = (cal: HTMLElement, label: string): void => {
    cells(cal).find((c) => c.textContent === label)!.click();
};

describe('input.time calendar — month and year panels', () => {
    let h: Harness;

    beforeEach(() => {
        // jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
        if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
            (globalThis as { CSS?: unknown }).CSS = { ...(globalThis as { CSS?: object }).CSS, escape: (s: string) => s };
        }
        h = openCalendar();
    });

    afterEach(() => {
        h.close();
        document.body.replaceChildren();
    });

    it('opens on the stored date, with the month and year as switches', () => {
        expect(monthSwitch(h.cal).textContent).toBe('March');
        expect(yearSwitch(h.cal).textContent).toBe('2024');
        expect(day(h.cal, 15).dataset.checked).toBe('1');
    });

    it('the month switch opens the twelve months, and picking one returns to its days', () => {
        monthSwitch(h.cal).click();
        expect(labels(h.cal)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
        expect(cells(h.cal)[2]!.dataset.checked).toBe('1'); // the selected date's own month
        expect(monthSwitch(h.cal).hidden).toBe(true); // the month IS the panel now

        pick(h.cal, 'Jan');
        expect(monthSwitch(h.cal).textContent).toBe('January');
        expect(yearSwitch(h.cal).textContent).toBe('2024');
        expect(day(h.cal, 31)).toBeTruthy();
    });

    it('the year switch opens the decade, and picking one leads to the months', () => {
        yearSwitch(h.cal).click();
        expect(yearSwitch(h.cal).textContent).toBe('2020-2029');
        // The decade, padded to a full grid: the years on either side read as outside it.
        expect(labels(h.cal)).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030']);
        expect(cells(h.cal)[0]!.dataset.outside).toBe('1');
        expect(cells(h.cal)[11]!.dataset.outside).toBe('1');
        expect(cells(h.cal)[5]!.dataset.checked).toBe('1'); // 2024

        pick(h.cal, '2020');
        expect(yearSwitch(h.cal).textContent).toBe('2020');
        expect(labels(h.cal)).toContain('Jan');
    });

    it('the arrows step the panel on screen — a month, a year, then a decade', () => {
        next(h.cal).click();
        expect(monthSwitch(h.cal).textContent).toBe('April');
        prev(h.cal).click();
        prev(h.cal).click();
        expect(monthSwitch(h.cal).textContent).toBe('February');

        monthSwitch(h.cal).click();
        next(h.cal).click();
        expect(yearSwitch(h.cal).textContent).toBe('2025');

        yearSwitch(h.cal).click();
        next(h.cal).click();
        expect(yearSwitch(h.cal).textContent).toBe('2030-2039');
        prev(h.cal).click();
        prev(h.cal).click();
        expect(yearSwitch(h.cal).textContent).toBe('2010-2019');
    });

    it('a year, then a month, then a day commits that timestamp', () => {
        yearSwitch(h.cal).click();
        pick(h.cal, '2026');
        pick(h.cal, 'Jul');
        day(h.cal, 4).click();
        expect(h.committed()).toEqual({ indicatorId: 'ind', key: 't', value: Date.parse('2026-07-04T09:30:00') });
    });

    it('picking a day straight from the opening month still commits it', () => {
        day(h.cal, 20).click();
        expect(h.committed()?.value).toBe(Date.parse('2024-03-20T09:30:00'));
    });
});
